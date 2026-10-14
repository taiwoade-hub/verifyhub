// VerifyHub — runner layer.
//
// Two runner backends:
//  - LocalRunner: executes projects directly on the host with strict
//    timeouts (used in the sandbox / local dev where Docker-in-Docker is
//    unavailable). Still treats the workspace as disposable.
//  - DockerRunner: production path. Builds/starts an isolated container per
//    run with CPU/memory limits, non-root execution, no docker socket and
//    temporary filesystem.
//
// Both implement the same contract: prepare → install → build → start →
// health check → expose internal URL, then cleanup().

import { spawn, type ChildProcess } from 'child_process'
import * as http from 'http'
import * as fs from 'fs'
import * as path from 'path'
import * as net from 'net'
import type { DetectionResult } from './types'

export interface RunnerLogFn {
  (stream: 'system' | 'stdout' | 'stderr', line: string): Promise<void>
}

export interface RunnerStartOptions {
  runId: string
  root: string // project files root on disk
  detection: DetectionResult
  log: RunnerLogFn
  signal: AbortSignal
  installTimeoutMs?: number
  startTimeoutMs?: number
  buildTimeoutMs?: number
}

export interface RunnerHandle {
  runnerId: string
  mode: 'local' | 'docker'
  port: number
  internalUrl: string
  healthPath: string
  child?: ChildProcess
  server?: http.Server
}

const PORT_RANGE_START = 4300
const allocatedPorts = new Set<number>()
const activeRuns = new Map<string, RunnerHandle>()

export function getRunnerHandle(runId: string): RunnerHandle | undefined {
  return activeRuns.get(runId)
}

function allocatePort(): number {
  let port = PORT_RANGE_START
  while (allocatedPorts.has(port)) port++
  return port
}

/** Reserve a port that is truly free: not tracked by us AND without a live listener. */
async function reservePort(): Promise<number> {
  const start = allocatePort()
  let port = start
  while ((await portOpen(port, 250)) && port < start + 100) {
    port++
  }
  if (port >= start + 100) throw new Error('no free runner port available in the runner port range')
  allocatedPorts.add(port)
  return port
}

function killTree(pid: number | undefined, signal: 'SIGTERM' | 'SIGKILL'): void {
  if (!pid) return
  try {
    // negative pid targets the whole process group (children spawned detached)
    process.kill(-pid, signal)
  } catch {
    try {
      process.kill(pid, signal)
    } catch {
      /* already gone */
    }
  }
}

export function releasePort(port: number): void {
  allocatedPorts.delete(port)
}

function substitutePort(cmd: string, port: number): string {
  return cmd.replace(/__PORT__/g, String(port)).replace(/\$PORT/g, String(port))
}

async function portOpen(port: number, timeoutMs = 1200): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    const done = (ok: boolean) => {
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
    socket.connect(port, '127.0.0.1')
  })
}

export async function healthCheck(
  port: number,
  healthPath: string,
  timeoutMs: number,
  log: RunnerLogFn,
  signal: AbortSignal
): Promise<{ ok: boolean; status?: number; error?: string }> {
  const deadline = Date.now() + timeoutMs
  const url = `http://127.0.0.1:${port}${healthPath}`
  let attempts = 0
  while (Date.now() < deadline) {
    if (signal.aborted) return { ok: false, error: 'aborted' }
    attempts++
    try {
      const controller = new AbortController()
      const t = setTimeout(() => controller.abort(), 3000)
      const res = await fetch(url, { signal: controller.signal })
      clearTimeout(t)
      if (res.status < 500) {
        await log('system', `[health] ${url} → ${res.status} OK (attempt ${attempts})`)
        return { ok: true, status: res.status }
      }
      await log('system', `[health] ${url} → ${res.status} (attempt ${attempts})`)
    } catch {
      if (attempts % 5 === 1) await log('system', `[health] waiting for ${url} (attempt ${attempts})`)
      // also accept a raw TCP listener as healthy for slow frameworks
      if (await portOpen(port)) {
        await log('system', `[health] TCP port ${port} listening; continuing`)
        return { ok: true }
      }
    }
    await new Promise((r) => setTimeout(r, 1500))
  }
  return { ok: false, error: `health check timed out after ${Math.round(timeoutMs / 1000)}s` }
}

// ---------------------------------------------------------------------------
// Static file server (real, for static uploads / examples)
// ---------------------------------------------------------------------------

function startStaticServer(root: string, port: number): Promise<http.Server> {
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
    '.py': 'text/plain; charset=utf-8',
    '.php': 'text/plain; charset=utf-8',
    '.go': 'text/plain; charset=utf-8',
    '.rs': 'text/plain; charset=utf-8',
    '.sh': 'text/plain; charset=utf-8',
    '.yml': 'text/plain; charset=utf-8',
    '.yaml': 'text/plain; charset=utf-8',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
  }

  // Find HTML entry if available
  const subdirs = ['', 'public', 'dist', 'build', 'web', 'site', 'src', 'www', 'pages', 'docs']
  const findHtmlEntry = (): string | null => {
    for (const sub of subdirs) {
      const p = sub ? path.join(root, sub, 'index.html') : path.join(root, 'index.html')
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return p
    }
    // Search for any .html in root
    try {
      const entries = fs.readdirSync(root, { withFileTypes: true })
      const firstHtml = entries.find((e) => e.isFile() && /\.html?$/i.test(e.name))
      if (firstHtml) return path.join(root, firstHtml.name)
    } catch {}
    return null
  }

  const renderCodeViewerHtml = (title: string, fileList: string[], selectedFile?: string, fileContent?: string): string => {
    const escapedContent = (fileContent || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title} — VerifyHub Live Preview</title>
  <style>
    :root { color-scheme: dark; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; background: #09090b; color: #f4f4f5; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    header { display: flex; align-items: center; justify-content: space-between; padding: 14px 24px; border-bottom: 1px solid #27272a; background: #111114; }
    .badge { background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3); padding: 3px 8px; border-radius: 9999px; font-size: 11px; font-weight: 600; }
    .container { display: flex; height: calc(100vh - 57px); }
    .sidebar { width: 260px; border-right: 1px solid #27272a; background: #0d0d10; overflow-y: auto; padding: 12px; }
    .sidebar h4 { font-size: 11px; text-transform: uppercase; color: #71717a; margin-bottom: 8px; letter-spacing: 0.05em; }
    .file-link { display: block; padding: 6px 10px; border-radius: 6px; font-family: monospace; font-size: 12px; color: #a1a1aa; text-decoration: none; word-break: break-all; margin-bottom: 2px; }
    .file-link:hover, .file-link.active { background: #1f1f23; color: #10b981; }
    .main { flex: 1; overflow: auto; padding: 20px; }
    pre { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 13px; line-height: 1.6; background: #111114; border: 1px solid #27272a; border-radius: 8px; padding: 16px; overflow-x: auto; color: #e4e4e7; }
  </style>
</head>
<body>
  <header>
    <div>
      <strong style="font-size: 15px;">VerifyHub Live Workspace Preview</strong>
      <span style="font-size: 12px; color: #71717a; margin-left: 10px;">${selectedFile || 'Workspace'}</span>
    </div>
    <span class="badge">Live & Healthy</span>
  </header>
  <div class="container">
    <div class="sidebar">
      <h4>Project Files</h4>
      ${fileList.map((f) => `<a href="/${encodeURIComponent(f)}" class="file-link ${f === selectedFile ? 'active' : ''}">${f}</a>`).join('')}
    </div>
    <div class="main">
      ${selectedFile ? `<h3 style="font-size: 14px; font-family: monospace; margin-bottom: 12px; color: #10b981;">📄 ${selectedFile}</h3>` : ''}
      <pre><code>${escapedContent || '// Select a file to inspect'}</code></pre>
    </div>
  </div>
</body>
</html>`
  }

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const urlPath = decodeURIComponent((req.url || '/').split('?')[0])
        res.setHeader('Access-Control-Allow-Origin', '*')

        if (urlPath === '/' || urlPath === '') {
          const htmlEntry = findHtmlEntry()
          if (htmlEntry && fs.existsSync(htmlEntry)) {
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
            fs.createReadStream(htmlEntry).pipe(res)
            return
          }
          // No HTML entry -> render live directory code preview
          const files: string[] = []
          try {
            const walk = (dir: string, rel = '') => {
              if (files.length > 100) return
              for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
                if (e.name.startsWith('.') || e.name === 'node_modules') continue
                const childRel = rel ? `${rel}/${e.name}` : e.name
                if (e.isFile()) files.push(childRel)
                else if (e.isDirectory()) walk(path.join(dir, e.name), childRel)
              }
            }
            walk(root)
          } catch {}
          const firstFile = files[0]
          const content = firstFile && fs.existsSync(path.join(root, firstFile)) ? fs.readFileSync(path.join(root, firstFile), 'utf8') : '// Empty workspace'
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
          res.end(renderCodeViewerHtml('Code Workspace', files, firstFile, content))
          return
        }

        let rel = urlPath.replace(/^\/+/, '')
        let file = path.join(root, rel)

        // Try direct file or in subdirectories
        if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
          for (const sub of subdirs) {
            if (!sub) continue
            const alt = path.join(root, sub, rel)
            if (fs.existsSync(alt) && fs.statSync(alt).isFile()) {
              file = alt
              break
            }
          }
        }

        if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
          // SPA index.html fallback
          const htmlEntry = findHtmlEntry()
          if (htmlEntry && fs.existsSync(htmlEntry)) {
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
            fs.createReadStream(htmlEntry).pipe(res)
            return
          }
          res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
          res.end('404 Not Found')
          return
        }

        const ext = path.extname(file).toLowerCase()
        res.writeHead(200, { 'content-type': MIME[ext] || 'text/plain; charset=utf-8' })
        fs.createReadStream(file).pipe(res)
      } catch {
        res.writeHead(500, { 'content-type': 'text/plain' })
        res.end('500 Internal Server Error')
      }
    })
    server.once('error', reject)
    server.listen(port, '0.0.0.0', () => resolve(server))
  })
}

// ---------------------------------------------------------------------------
// Local runner
// ---------------------------------------------------------------------------

function runCommand(
  cmd: string,
  cwd: string,
  timeoutMs: number,
  log: RunnerLogFn,
  signal: AbortSignal,
  env?: Record<string, string>
): Promise<{ code: number | null; timedOut: boolean }> {
  return new Promise((resolve) => {
    const parts = cmd.split(/\s+/)
    const bin = parts[0]
    const args = parts.slice(1)
    const child = spawn(bin, args, {
      cwd,
      env: { ...process.env, ...env, CI: '1', NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true, // own process group so killTree reaches grandchildren
    })
    const timer = setTimeout(() => {
      killTree(child.pid, 'SIGKILL')
      resolve({ code: null, timedOut: true })
    }, timeoutMs)
    const onAbort = () => {
      clearTimeout(timer)
      killTree(child.pid, 'SIGKILL')
      resolve({ code: null, timedOut: false })
    }
    signal.addEventListener('abort', onAbort, { once: true })
    child.stdout?.on('data', (d: Buffer) => {
      for (const line of d.toString().split('\n')) {
        const t = line.trimEnd()
        if (t) void log('stdout', t)
      }
    })
    child.stderr?.on('data', (d: Buffer) => {
      for (const line of d.toString().split('\n')) {
        const t = line.trimEnd()
        if (t) void log('stderr', t)
      }
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      void log('stderr', `spawn error: ${err.message}`)
      resolve({ code: null, timedOut: false })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      resolve({ code, timedOut: false })
    })
  })
}

export async function localStart(opts: RunnerStartOptions): Promise<RunnerHandle> {
  const { runId, root, detection, log, signal } = opts
  const installTimeout = opts.installTimeoutMs ?? 120_000
  const buildTimeout = opts.buildTimeoutMs ?? 120_000
  const startTimeout = opts.startTimeoutMs ?? 60_000
  const port = await reservePort()

  const handle: RunnerHandle = {
    runnerId: `verify-run-${runId.slice(-6)}`,
    mode: 'local',
    port,
    internalUrl: `http://127.0.0.1:${port}`,
    healthPath: detection.healthPath || '/',
  }
  activeRuns.set(runId, handle)

  try {
    if (detection.language === 'static') {
      await log('system', `[runner] starting static file server on port ${port}`)
      handle.server = await startStaticServer(root, port)
      return handle
    }

    // Python projects: system pip is typically PEP 668 "externally managed",
    // so give every Python project an isolated per-project virtualenv and run
    // install/start inside it. The venv lives in the (disposable) workspace.
    let venvBin: string | null = null
    let installCommand = detection.installCommand
    let extraEnv: Record<string, string> = {}

    if (detection.language === 'python') {
      const venvDir = path.join(root, '.verifyhub-venv')
      const venvPython = path.join(venvDir, 'bin', 'python')
      if (!fs.existsSync(venvPython)) {
        await log('system', '[runner] python: creating isolated virtualenv .verifyhub-venv')
        await runCommand('python3 -m venv .verifyhub-venv', root, 120_000, log, signal)
        if (!fs.existsSync(venvPython)) {
          throw new Error('could not create a virtualenv — python3-venv is required to run Python projects')
        }
      }
      venvBin = path.join(venvDir, 'bin')
      extraEnv = { PATH: `${venvBin}:${process.env.PATH || ''}` }
      if (installCommand) {
        installCommand = installCommand.replace(/(^|[\s;])(pip3?)(\s)/, `$1${venvBin}/pip$3`)
      }
      await log('system', '[runner] python: virtualenv ready — installs and start run inside it')
    }

    if (installCommand) {
      await log('system', `[runner] $ ${installCommand}`)
      const res = await runCommand(installCommand, root, installTimeout, log, signal, extraEnv)
      if (res.timedOut) throw new Error(`install timed out after ${installTimeout / 1000}s`)
      if (res.code !== 0 && res.code !== null) throw new Error(`install failed with exit code ${res.code}`)
    }

    if (detection.buildCommand) {
      await log('system', `[runner] $ ${detection.buildCommand}`)
      const res = await runCommand(detection.buildCommand, root, buildTimeout, log, signal, extraEnv)
      if (res.timedOut) throw new Error(`build timed out after ${buildTimeout / 1000}s`)
      if (res.code !== 0 && res.code !== null) throw new Error(`build failed with exit code ${res.code}`)
    }

    if (!detection.startCommand) throw new Error('no start command could be detected for this project')

    const startCmd = substitutePort(detection.startCommand, port)
    await log('system', `[runner] $ ${startCmd}`)
    const { spawn: _s } = await import('child_process')
    const parts = startCmd.split(/\s+/)
    const child = _s(parts[0], parts.slice(1), {
      cwd: root,
      detached: true, // own process group so cleanup reaches npm → node chains
      env: {
        ...process.env,
        ...extraEnv,
        PORT: String(port),
        HOST: '0.0.0.0',
        CI: '1',
        NO_COLOR: '1',
        NODE_ENV: 'development',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    handle.child = child
    child.stdout?.on('data', (d: Buffer) => {
      for (const line of d.toString().split('\n')) {
        const t = line.trimEnd()
        if (t) void log('stdout', t)
      }
    })
    child.stderr?.on('data', (d: Buffer) => {
      for (const line of d.toString().split('\n')) {
        const t = line.trimEnd()
        if (t) void log('stderr', t)
      }
    })
    child.on('close', (code) => {
      if (code !== null && code !== 0) void log('stderr', `[runner] application exited with code ${code}`)
    })

    // give the process a moment; fail fast if it dies immediately
    await new Promise((r) => setTimeout(r, 1500))
    if (child.exitCode !== null) throw new Error(`application exited immediately with code ${child.exitCode}`)
    return handle
  } catch (err) {
    await cleanup(runId)
    throw err
  }
}

export async function cleanup(runId: string): Promise<void> {
  const handle = activeRuns.get(runId)
  if (!handle) return
  activeRuns.delete(runId)
  if (handle.child) {
    killTree(handle.child.pid, 'SIGTERM')
    setTimeout(() => killTree(handle.child?.pid, 'SIGKILL'), 3000)
  }
  if (handle.server) {
    await new Promise<void>((resolve) => handle.server!.close(() => resolve()))
  }
  releasePort(handle.port)
}

// ---------------------------------------------------------------------------
// Docker runner (production path)
// ---------------------------------------------------------------------------

export async function dockerAvailable(): Promise<boolean> {
  try {
    const { execSync } = await import('child_process')
    execSync('docker info --format "{{.ServerVersion}}"', { timeout: 5000, stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

export async function dockerStart(opts: RunnerStartOptions): Promise<RunnerHandle> {
  const { runId, root, detection, log, signal } = opts
  const port = await reservePort()
  const containerName = `verify-run-${runId.slice(-8)}`
  const handle: RunnerHandle = {
    runnerId: containerName,
    mode: 'docker',
    port,
    internalUrl: `http://127.0.0.1:${port}`,
    healthPath: detection.healthPath || '/',
  }
  activeRuns.set(runId, handle)

  // Security posture per VerifyHub security model: resource limits, non-root,
  // no docker socket, temp filesystem, restricted capabilities.
  const securityFlags = [
    '--memory', '512m',
    '--cpus', '1.0',
    '--pids-limit', '128',
    '--security-opt', 'no-new-privileges',
    '--cap-drop', 'ALL',
    '--read-only', // writable tmpfs added below
    '--tmpfs', '/tmp:rw,size=64m',
    '--user', '1000:1000',
    '--network', 'bridge',
  ]

  const hasDockerfile = fs.existsSync(path.join(root, 'Dockerfile'))
  const portFlag = `-p 127.0.0.1:${port}:${detection.port ?? 3000}`

  try {
    if (hasDockerfile) {
      await log('system', `[docker] building image for ${containerName}`)
      const build = await runCommand(`docker build -t ${containerName} .`, root, 300_000, log, signal)
      if (build.code !== 0) throw new Error('docker build failed')
      await runCommand(
        `docker run -d --name ${containerName} ${securityFlags.join(' ')} ${portFlag} ${containerName}`,
        root,
        60_000,
        log,
        signal
      )
    } else {
      // Volume-mounted runtime image per language
      const image = detection.language === 'python' ? 'python:3.12-slim' : 'node:22-slim'
      await log('system', `[docker] starting ${image} with mounted workspace`)
      const cmds = [
        ...(detection.installCommand ? [detection.installCommand] : []),
        detection.startCommand ? substitutePort(detection.startCommand, detection.port ?? 3000) : '',
      ].filter(Boolean)
      const sh = cmds.join(' && ')
      await runCommand(
        `docker run -d --name ${containerName} ${securityFlags.join(' ')} ${portFlag} -v ${root}:/app -w /app -e PORT=${
          detection.port ?? 3000
        } ${image} sh -c "${sh.replace(/"/g, '\\"')}"`,
        root,
        60_000,
        log,
        signal
      )
    }
    return handle
  } catch (err) {
    await dockerCleanup(runId)
    throw err
  }
}

export async function dockerCleanup(runId: string): Promise<void> {
  const handle = activeRuns.get(runId)
  if (!handle) return
  activeRuns.delete(runId)
  try {
    const { execSync } = await import('child_process')
    execSync(`docker rm -f ${handle.runnerId}`, { timeout: 15_000, stdio: 'pipe' })
  } catch {
    /* ignore */
  }
  releasePort(handle.port)
}

export async function dockerLogs(runId: string, log: RunnerLogFn): Promise<void> {
  const handle = activeRuns.get(runId)
  if (!handle || handle.mode !== 'docker') return
  try {
    const { execSync } = await import('child_process')
    const out = execSync(`docker logs --tail 50 ${handle.runnerId}`, { timeout: 10_000 }).toString()
    for (const line of out.split('\n')) if (line.trim()) await log('stdout', line)
  } catch {
    /* ignore */
  }
}

export { runCommand, portOpen }
