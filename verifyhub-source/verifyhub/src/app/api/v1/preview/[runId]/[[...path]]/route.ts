// VerifyHub API — /api/v1/preview/[runId]/[[...path]]
// Universal Live Preview proxy:
// 1. Proxies running applications inside local/docker runners (127.0.0.1:{port})
// 2. Proxies external URL targets (https://...) with X-Frame-Options & CSP stripping so they embed smoothly
// 3. Serves static project files (HTML, CSS, JS, assets) with SPA fallbacks if the runner has finished
// 4. Renders interactive workspace code explorer if the project has no HTML entry

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getRunnerHandle } from '@/server/verifyhub/runner'
import * as store from '@/server/verifyhub/store'
import { findProjectRoot } from '@/server/verifyhub/detect'
import * as pathMod from 'path'
import * as fs from 'fs'

export const dynamic = 'force-dynamic'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.ts': 'text/plain; charset=utf-8',
  '.tsx': 'text/plain; charset=utf-8',
  '.jsx': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.py': 'text/plain; charset=utf-8',
  '.php': 'text/plain; charset=utf-8',
  '.go': 'text/plain; charset=utf-8',
  '.rs': 'text/plain; charset=utf-8',
  '.sh': 'text/plain; charset=utf-8',
  '.yml': 'text/plain; charset=utf-8',
  '.yaml': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.map': 'application/json; charset=utf-8',
}

/**
 * Rewrites HTML to ensure all relative and root-relative resources resolve through
 * the VerifyHub preview proxy, disables frame-busting scripts, and intercepts fetch/XHR.
 */
function rewriteHtml(html: string, runId: string, upstreamOrigin?: string): string {
  const previewBase = `/api/v1/preview/${runId}/`

  const helperScript = `
  <script data-verifyhub-preview="true">
  (function() {
    try {
      if (window.top !== window.self) {
        window.top = window.self;
      }
    } catch(e) {}

    var b = ${JSON.stringify(previewBase)};

    if (typeof window.fetch === 'function') {
      var _f = window.fetch;
      window.fetch = function(u, i) {
        if (typeof u === 'string') {
          if (u.startsWith('/') && !u.startsWith('/api/v1/preview/')) {
            u = b + u.replace(/^\\/+/, '');
          }
        } else if (u && u.url && typeof u.url === 'string') {
          var urlStr = u.url;
          if (urlStr.startsWith(window.location.origin + '/') && !urlStr.includes('/api/v1/preview/')) {
            var rel = urlStr.replace(window.location.origin, '').replace(/^\\/+/, '');
            u = new Request(b + rel, u);
          }
        }
        return _f.call(this, u, i);
      };
    }

    if (typeof XMLHttpRequest !== 'undefined') {
      var _o = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function(m, u) {
        var args = Array.prototype.slice.call(arguments);
        if (typeof u === 'string' && u.startsWith('/') && !u.startsWith('/api/v1/preview/')) {
          args[1] = b + u.replace(/^\\/+/, '');
        }
        return _o.apply(this, args);
      };
    }

    document.addEventListener('click', function(e) {
      var a = e.target && e.target.closest ? e.target.closest('a') : null;
      if (a && a.target && (a.target === '_top' || a.target === '_parent')) {
        a.target = '_self';
      }
    }, true);
  })();
  </script>`

  let modified = html

  // Replace upstream origin absolute links with preview proxy paths if provided
  if (upstreamOrigin) {
    const originRegex = new RegExp(upstreamOrigin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=[/?"\'`])', 'gi')
    modified = modified.replace(originRegex, `/api/v1/preview/${runId}`)
  }

  // Rewrite root-relative src and href attributes (excluding //, http, mailto, etc.)
  modified = modified.replace(
    /\b(href|src|action)=["']\/((?!api\/v1\/preview\/|\/)[^"']*)["']/gi,
    `$1="${previewBase}$2"`
  )

  // Inject <base> tag and helper script
  const baseTag = `<base href="${previewBase}">\n${helperScript}`
  if (/<head(\s[^>]*)?>/i.test(modified)) {
    // If base tag already exists, replace it; otherwise prepend to head
    if (/<base\s+[^>]*>/i.test(modified)) {
      modified = modified.replace(/<base\s+[^>]*>/i, baseTag)
    } else {
      modified = modified.replace(/<head(\s[^>]*)?>/i, `$&\n  ${baseTag}`)
    }
  } else if (/<html(\s[^>]*)?>/i.test(modified)) {
    modified = modified.replace(/<html(\s[^>]*)?>/i, `$&\n<head>\n  ${baseTag}\n</head>`)
  } else {
    modified = `<head>\n  ${baseTag}\n</head>\n` + modified
  }

  return modified
}

/**
 * Interactive code and file browser for projects without an HTML index file (Python, Node API, etc.)
 */
function renderCodeViewerHtml(
  run: any,
  fileList: string[],
  selectedFile?: string,
  fileContent?: string
): string {
  const projectName = run?.project?.name || 'Workspace'
  const title = selectedFile ? `${selectedFile} — ${projectName}` : projectName
  const escapedContent = (fileContent || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  const totalLines = fileContent ? fileContent.split('\n').length : 0
  const totalBytes = fileContent ? Buffer.byteLength(fileContent, 'utf8') : 0

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title} — VerifyHub Live Preview</title>
  <style>
    :root { color-scheme: dark; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #09090b; color: #f4f4f5; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    header { display: flex; align-items: center; justify-content: space-between; padding: 12px 20px; border-bottom: 1px solid #27272a; background: #111114; }
    .badge { background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3); padding: 3px 8px; border-radius: 9999px; font-size: 11px; font-weight: 600; display: inline-flex; align-items: center; gap: 4px; }
    .badge-dot { width: 6px; height: 6px; border-radius: 9999px; background: #10b981; }
    .container { display: flex; height: calc(100vh - 53px); }
    .sidebar { width: 280px; border-right: 1px solid #27272a; background: #0d0d10; overflow-y: auto; padding: 12px; }
    .sidebar h4 { font-size: 11px; text-transform: uppercase; color: #71717a; margin-bottom: 8px; letter-spacing: 0.05em; font-weight: 600; }
    .file-link { display: flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 6px; font-family: ui-monospace, monospace; font-size: 12px; color: #a1a1aa; text-decoration: none; word-break: break-all; margin-bottom: 2px; transition: all 0.15s; }
    .file-link:hover { background: #1f1f23; color: #f4f4f5; }
    .file-link.active { background: rgba(16, 185, 129, 0.15); color: #10b981; font-weight: 500; border: 1px solid rgba(16, 185, 129, 0.3); }
    .main { flex: 1; overflow: auto; padding: 20px; background: #09090b; }
    .toolbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
    .stats { font-size: 11px; color: #71717a; font-family: ui-monospace, monospace; }
    pre { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 13px; line-height: 1.6; background: #111114; border: 1px solid #27272a; border-radius: 8px; padding: 16px; overflow-x: auto; color: #e4e4e7; }
  </style>
</head>
<body>
  <header>
    <div style="display: flex; align-items: center; gap: 10px;">
      <strong style="font-size: 14px; font-weight: 600;">${projectName}</strong>
      <span style="font-size: 12px; color: #71717a;">Workspace Explorer</span>
    </div>
    <span class="badge"><span class="badge-dot"></span> Preserved Workspace</span>
  </header>
  <div class="container">
    <div class="sidebar">
      <h4>Files (${fileList.length})</h4>
      ${fileList.map((f) => `<a href="/api/v1/preview/${run.id}/${f}" class="file-link ${f === selectedFile ? 'active' : ''}">📄 ${f}</a>`).join('')}
    </div>
    <div class="main">
      <div class="toolbar">
        <h3 style="font-size: 13px; font-family: ui-monospace, monospace; color: #10b981;">📄 ${selectedFile || 'Workspace'}</h3>
        <span class="stats">${totalLines} lines · ${totalBytes} bytes</span>
      </div>
      <pre><code>${escapedContent || '// Select a file from the explorer on the left'}</code></pre>
    </div>
  </div>
</body>
</html>`
}

/**
 * Serves static project files from disk with SPA routing fallback and HTML rewriting.
 */
async function serveStaticFallback(run: any, pathSegments: string[], req: NextRequest) {
  try {
    const pDir = store.projectDir(run.projectId)
    if (!fs.existsSync(pDir)) return null
    const root = findProjectRoot(pDir)
    const subdirs = ['', 'dist', 'build', 'out', 'public', '.output/public', 'web', 'site', 'src', 'www', 'pages', 'docs']

    let rel = pathSegments.join('/')

    // Case 1: Root request (rel is empty or index.html)
    if (!rel || rel === 'index.html') {
      let indexFile: string | null = null
      for (const sub of subdirs) {
        const candidate = sub ? pathMod.join(root, sub, 'index.html') : pathMod.join(root, 'index.html')
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          indexFile = candidate
          break
        }
      }

      if (indexFile) {
        const rawHtml = fs.readFileSync(indexFile, 'utf8')
        const enhancedHtml = rewriteHtml(rawHtml, run.id)
        return new NextResponse(enhancedHtml, {
          status: 200,
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'access-control-allow-origin': '*',
            'x-verifyhub-preview': 'static-html',
          },
        })
      }

      // No index.html found -> Render interactive workspace file explorer
      const files: string[] = []
      try {
        const walk = (dir: string, curRel = '') => {
          if (files.length > 200) return
          for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === '__pycache__' || e.name === 'venv' || e.name === '.verifyhub-venv') continue
            const childRel = curRel ? `${curRel}/${e.name}` : e.name
            if (e.isFile()) files.push(childRel)
            else if (e.isDirectory()) walk(pathMod.join(dir, e.name), childRel)
          }
        }
        walk(root)
      } catch {}

      if (files.length > 0) {
        // Pick primary entry file
        const preferred = files.find((f) => /^(main|app|index|server)\.(py|js|ts|jsx|tsx|html)$/i.test(pathMod.basename(f))) ||
          files.find((f) => /^package\.json$|^README\.md$/i.test(pathMod.basename(f))) ||
          files[0]
        const content = fs.existsSync(pathMod.join(root, preferred)) ? fs.readFileSync(pathMod.join(root, preferred), 'utf8') : '// Empty workspace'
        return new NextResponse(renderCodeViewerHtml(run, files, preferred, content), {
          status: 200,
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'access-control-allow-origin': '*',
            'x-verifyhub-preview': 'workspace-viewer',
          },
        })
      }
    }

    // Case 2: Specific file requested
    let targetFile = pathMod.join(root, rel)
    if (!fs.existsSync(targetFile) || fs.statSync(targetFile).isDirectory()) {
      for (const sub of subdirs) {
        if (!sub) continue
        const alt = pathMod.join(root, sub, rel)
        if (fs.existsSync(alt) && fs.statSync(alt).isFile()) {
          targetFile = alt
          break
        }
      }
    }

    // Case 3: SPA client-side routing fallback (for non-file paths that accept html)
    if (!fs.existsSync(targetFile) || fs.statSync(targetFile).isDirectory()) {
      const isAssetPath = /\.[a-zA-Z0-9]{2,5}$/.test(rel)
      if (!isAssetPath) {
        for (const sub of subdirs) {
          const alt = sub ? pathMod.join(root, sub, 'index.html') : pathMod.join(root, 'index.html')
          if (fs.existsSync(alt) && fs.statSync(alt).isFile()) {
            const rawHtml = fs.readFileSync(alt, 'utf8')
            const enhancedHtml = rewriteHtml(rawHtml, run.id)
            return new NextResponse(enhancedHtml, {
              status: 200,
              headers: {
                'content-type': 'text/html; charset=utf-8',
                'access-control-allow-origin': '*',
                'x-verifyhub-preview': 'spa-fallback',
              },
            })
          }
        }
      }
    }

    if (fs.existsSync(targetFile) && fs.statSync(targetFile).isFile()) {
      const ext = pathMod.extname(targetFile).toLowerCase()
      if (ext === '.html' || ext === '.htm') {
        const rawHtml = fs.readFileSync(targetFile, 'utf8')
        return new NextResponse(rewriteHtml(rawHtml, run.id), {
          status: 200,
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'access-control-allow-origin': '*',
          },
        })
      }

      const content = fs.readFileSync(targetFile)
      return new NextResponse(content, {
        status: 200,
        headers: {
          'content-type': MIME[ext] || 'application/octet-stream',
          'access-control-allow-origin': '*',
          'cache-control': 'public, max-age=3600',
        },
      })
    }
  } catch {}
  return null
}

async function proxy(req: NextRequest, runId: string, pathSegments: string[]) {
  // 1. Check if there is an active local or Docker runner process for this run
  const handle = getRunnerHandle(runId)
  if (handle) {
    const rel = '/' + pathSegments.join('/')
    const url = `${handle.internalUrl}${rel}${req.nextUrl.search}`
    try {
      const headers = new Headers()
      const ct = req.headers.get('content-type')
      if (ct) headers.set('content-type', ct)
      const accept = req.headers.get('accept')
      if (accept) headers.set('accept', accept)

      const method = req.method
      const body = method === 'GET' || method === 'HEAD' ? undefined : await req.arrayBuffer()
      const upstream = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(15_000) })

      const resHeaders = new Headers()
      const passthrough = ['content-type', 'cache-control', 'location', 'content-disposition', 'etag']
      for (const h of passthrough) {
        const v = upstream.headers.get(h)
        if (v) resHeaders.set(h, v)
      }
      resHeaders.set('access-control-allow-origin', '*')

      const upstreamCt = upstream.headers.get('content-type') || ''
      if (upstreamCt.includes('text/html')) {
        const text = await upstream.text()
        const enhanced = rewriteHtml(text, runId)
        return new NextResponse(enhanced, { status: upstream.status, headers: resHeaders })
      }

      const buf = await upstream.arrayBuffer()
      return new NextResponse(buf, { status: upstream.status, headers: resHeaders })
    } catch {
      // If runner fetch temporarily fails, fall through to static fallback below
    }
  }

  // 2. Runner is inactive or completed — query run & project
  const run = await db.run.findUnique({
    where: { id: runId },
    include: { project: true, evidence: true },
  })

  if (!run) {
    return new NextResponse('Verification run not found', { status: 404 })
  }

  // 3. External URL target: proxy the live website with iframe framing protection removed
  const isExternal =
    run.sourceType === 'url' ||
    run.project.sourceType === 'url' ||
    Boolean(
      run.previewUrl &&
        /^https?:\/\//i.test(run.previewUrl) &&
        !run.previewUrl.includes('127.0.0.1') &&
        !run.previewUrl.includes('localhost')
    )

  if (isExternal) {
    const targetBase = run.project.sourceUrl || run.previewUrl
    if (targetBase) {
      try {
        const base = new URL(targetBase)
        let targetUrl: string
        if (pathSegments.length > 0) {
          const basePath = base.pathname.endsWith('/') ? base.pathname : base.pathname + '/'
          targetUrl = new URL(pathSegments.join('/') + req.nextUrl.search, base.origin + basePath).toString()
        } else {
          targetUrl = new URL(base.pathname + (base.pathname.endsWith('/') ? '' : '') + req.nextUrl.search, base.origin).toString()
        }

        const headers = new Headers()
        headers.set(
          'User-Agent',
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
        )
        headers.set(
          'Accept',
          req.headers.get('accept') || 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8'
        )
        headers.set('Accept-Language', req.headers.get('accept-language') || 'en-US,en;q=0.9')
        const ct = req.headers.get('content-type')
        if (ct) headers.set('content-type', ct)

        const method = req.method
        const body = method === 'GET' || method === 'HEAD' ? undefined : await req.arrayBuffer()
        const upstream = await fetch(targetUrl, {
          method,
          headers,
          body,
          redirect: 'follow',
          signal: AbortSignal.timeout(15_000),
        })

        const resHeaders = new Headers()
        const passthrough = ['content-type', 'cache-control', 'location', 'etag']
        for (const h of passthrough) {
          const v = upstream.headers.get(h)
          if (v) resHeaders.set(h, v)
        }
        resHeaders.set('access-control-allow-origin', '*')
        resHeaders.set('x-verifyhub-preview', 'live-external')

        const upstreamCt = upstream.headers.get('content-type') || ''
        if (upstreamCt.includes('text/html')) {
          const text = await upstream.text()
          const enhanced = rewriteHtml(text, runId, base.origin)
          return new NextResponse(enhanced, { status: upstream.status, headers: resHeaders })
        }

        const buf = await upstream.arrayBuffer()
        return new NextResponse(buf, { status: upstream.status, headers: resHeaders })
      } catch (err) {
        const errorHtml = `<!doctype html><html><head><meta charset="utf-8"><title>Target Unreachable</title>
<style>body{background:#0b0b0e;color:#a1a1aa;font-family:ui-sans-serif,system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0}
div{text-align:center;max-width:440px;padding:24px;border:1px solid #27272a;border-radius:12px;background:#111114}
h1{color:#f4f4f5;font-weight:600;font-size:16px;margin-bottom:8px}p{font-size:13px;line-height:1.5;color:#71717a;margin-bottom:16px}
a{display:inline-block;padding:8px 16px;border-radius:6px;background:#10b981;color:#09090b;text-decoration:none;font-weight:600;font-size:12px}</style></head>
<body><div><h1>Live Target Temporarily Unreachable</h1>
<p>VerifyHub live preview proxy was unable to connect to ${targetBase}.</p>
<a href="${targetBase}" target="_blank" rel="noreferrer">Open Direct Target ↗</a></div></body></html>`
        return new NextResponse(errorHtml, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })
      }
    }
  }

  // 4. Try serving static files directly from workspace disk
  const staticRes = await serveStaticFallback(run, pathSegments, req)
  if (staticRes) return staticRes

  // 5. Preserved workspace or verification snapshot view
  const screenshots = (run.evidence || []).filter((e: any) => e.kind === 'screenshot' || e.mimeType?.startsWith('image/'))
  const primaryScreenshot = screenshots[0]?.content || null

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${run.project.name} — VerifyHub Live Preview</title>
<style>body{background:#09090b;color:#a1a1aa;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;padding:20px;box-sizing:border-box}
.card{text-align:center;max-width:540px;width:100%;background:#111114;border:1px solid #27272a;border-radius:12px;padding:28px}
h1{color:#f4f4f5;font-weight:600;font-size:17px;margin-bottom:6px}
p{font-size:13px;color:#71717a;line-height:1.5;margin-bottom:16px}
.badge{display:inline-flex;align-items:center;gap:5px;background:rgba(16,185,129,0.15);color:#10b981;border:1px solid rgba(16,185,129,0.3);padding:3px 10px;border-radius:9999px;font-size:11px;font-weight:600;margin-bottom:14px}
.badge-dot{width:6px;height:6px;border-radius:50%;background:#10b981}
.preview-img{max-width:100%;max-height:280px;object-fit:contain;border-radius:8px;border:1px solid #27272a;margin-top:12px;background:#050507}
.footer{margin-top:16px;font-size:11px;color:#52525b}
</style></head>
<body><div class="card">
  <span class="badge"><span class="badge-dot"></span> Verification Completed</span>
  <h1>${run.project.name} · Run #${run.number}</h1>
  <p>Evidence and verification checks have been captured and preserved in VerifyHub.</p>
  ${primaryScreenshot ? `<img src="${primaryScreenshot}" class="preview-img" alt="Captured view" />` : ''}
  <div class="footer">Workspace files & Playwright recordings remain preserved.</div>
</div></body></html>`

  return new NextResponse(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ runId: string; path?: string[] }> }) {
  const { runId, path } = await params
  return proxy(req, runId, (path || []).filter(Boolean))
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ runId: string; path?: string[] }> }) {
  const { runId, path } = await params
  return proxy(req, runId, (path || []).filter(Boolean))
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ runId: string; path?: string[] }> }) {
  const { runId, path } = await params
  return proxy(req, runId, (path || []).filter(Boolean))
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ runId: string; path?: string[] }> }) {
  const { runId, path } = await params
  return proxy(req, runId, (path || []).filter(Boolean))
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ runId: string; path?: string[] }> }) {
  const { runId, path } = await params
  return proxy(req, runId, (path || []).filter(Boolean))
}

export async function HEAD(req: NextRequest, { params }: { params: Promise<{ runId: string; path?: string[] }> }) {
  const { runId, path } = await params
  return proxy(req, runId, (path || []).filter(Boolean))
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS',
      'access-control-allow-headers': '*',
    },
  })
}
