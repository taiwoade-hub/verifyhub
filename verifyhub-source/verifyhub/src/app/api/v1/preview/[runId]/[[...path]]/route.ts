// VerifyHub API — /api/v1/preview/[runId]/[[...path]]
// Live preview proxy: serves the application running inside the runner (127.0.0.1:{port}),
// or falls back to serving static project files directly from the workspace if the runner has finished.

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
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

async function serveStaticFallback(run: any, reqPath: string[]) {
  try {
    const pDir = store.projectDir(run.projectId)
    if (!fs.existsSync(pDir)) return null
    const root = findProjectRoot(pDir)
    const subdirs = ['', 'public', 'dist', 'build', 'web', 'site', 'src', 'www', 'pages', 'docs']

    let rel = reqPath.join('/')
    if (!rel || rel === '') rel = 'index.html'

    let file = pathMod.join(root, rel)

    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      for (const sub of subdirs) {
        if (!sub) continue
        const alt = pathMod.join(root, sub, rel)
        if (fs.existsSync(alt) && fs.statSync(alt).isFile()) {
          file = alt
          break
        }
      }
    }

    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      // Look for any index.html
      for (const sub of subdirs) {
        const alt = sub ? pathMod.join(root, sub, 'index.html') : pathMod.join(root, 'index.html')
        if (fs.existsSync(alt) && fs.statSync(alt).isFile()) {
          file = alt
          break
        }
      }
    }

    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      const ext = pathMod.extname(file).toLowerCase()
      const content = fs.readFileSync(file)
      return new NextResponse(content, {
        status: 200,
        headers: {
          'content-type': MIME[ext] || 'text/plain; charset=utf-8',
          'access-control-allow-origin': '*',
        },
      })
    }
  } catch {}
  return null
}

async function proxy(req: NextRequest, runId: string, path: string[]) {
  const handle = getRunnerHandle(runId)
  if (!handle) {
    const run = await db.run.findUnique({ where: { id: runId }, include: { project: true } })
    if (run) {
      // Try serving static files directly from workspace disk
      const staticRes = await serveStaticFallback(run, path)
      if (staticRes) return staticRes
    }

    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Run ended</title>
<style>body{background:#0b0b0e;color:#a1a1aa;font-family:ui-monospace,monospace;display:grid;place-items:center;height:100vh;margin:0}
div{text-align:center}h1{color:#e4e4e7;font-weight:500;font-size:18px}p{font-size:13px}</style></head>
<body><div><h1>🔒 ${run ? run.project.name : 'Run'} — runner is not active</h1>
<p>The runner process for this verification has finished.</p>
<p>Evidence, logs, and verification reports remain preserved in VerifyHub.</p></div></body></html>`
    return new NextResponse(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })
  }

  const rel = '/' + (path || []).join('/')
  const url = `${handle.internalUrl}${rel}${req.nextUrl.search}`
  try {
    const headers = new Headers()
    const ct = req.headers.get('content-type')
    if (ct) headers.set('content-type', ct)
    const method = req.method
    const body = method === 'GET' || method === 'HEAD' ? undefined : await req.arrayBuffer()
    const upstream = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(15_000) })
    const resHeaders = new Headers()
    const passthrough = ['content-type', 'cache-control', 'location', 'content-disposition']
    for (const h of passthrough) {
      const v = upstream.headers.get(h)
      if (v) resHeaders.set(h, v)
    }
    resHeaders.set('access-control-allow-origin', '*')
    const buf = await upstream.arrayBuffer()
    return new NextResponse(buf, { status: upstream.status, headers: resHeaders })
  } catch (err) {
    return new NextResponse(
      `VerifyHub preview proxy error: ${err instanceof Error ? err.message : 'upstream unreachable'}`,
      { status: 502, headers: { 'content-type': 'text/plain' } }
    )
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ runId: string; path?: string[] }> }) {
  const { runId, path } = await params
  return proxy(req, runId, path || [])
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ runId: string; path?: string[] }> }) {
  const { runId, path } = await params
  return proxy(req, runId, path || [])
}
