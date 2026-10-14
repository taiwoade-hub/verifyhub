// VerifyHub — ngrok tunnel service.
// Starts an ngrok process for a run's internal port when the binary and auth
// token are available; otherwise reports honestly that the internal preview
// proxy is used instead.

import { spawn, execSync } from 'child_process'
import { getNgrok } from './integrations'

export interface TunnelResult {
  ok: boolean
  url?: string
  tunnelId?: string
  provider: 'ngrok' | 'none'
  detail: string
}

export function ngrokBinaryAvailable(): boolean {
  try {
    execSync('which ngrok', { timeout: 3000, stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

export async function startTunnel(port: number, runId: string): Promise<TunnelResult> {
  const { config } = await getNgrok()
  const token = config.authToken || process.env.NGROK_AUTHTOKEN
  const bin = ngrokBinaryAvailable()

  if (!bin) {
    return {
      ok: false,
      provider: 'none',
      detail: 'ngrok binary not found — serving through the VerifyHub internal preview proxy',
    }
  }
  if (!token) {
    return {
      ok: false,
      provider: 'none',
      detail: 'ngrok auth token not configured (Settings → ngrok or NGROK_AUTHTOKEN) — internal preview proxy in use',
    }
  }

  return new Promise<TunnelResult>((resolve) => {
    const args = ['http', String(port), '--log=stdout', '--log-format=json']
    if (config.domain) args.push('--domain=' + config.domain)
    const child = spawn('ngrok', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''

    const fail = (detail: string) => {
      try {
        child.kill('SIGKILL')
      } catch {
        /* ignore */
      }
      resolve({ ok: false, provider: 'none', detail })
    }

    const timer = setTimeout(() => fail('ngrok did not report a tunnel within 12s'), 12_000)

    child.stdout?.on('data', (d: Buffer) => {
      stdout += d.toString()
      for (const line of stdout.split('\n')) {
        if (!line.trim()) continue
        try {
          const evt = JSON.parse(line)
          if (evt.op === 'start' && evt.tunnel?.public_url && !String(evt.tunnel.public_url).includes('404')) {
            // ngrok prints a 404 probe URL first; the second one is real
            const url = evt.tunnel.public_url as string
            if (url.startsWith('https')) {
              clearTimeout(timer)
              resolve({
                ok: true,
                url,
                tunnelId: evt.tunnel?.ID || evt.tunnel?.id || `ngrok-${runId.slice(-6)}`,
                provider: 'ngrok',
                detail: 'ngrok tunnel established',
              })
              return
            }
          }
        } catch {
          /* non-JSON line */
        }
      }
    })
    child.stderr?.on('data', (d: Buffer) => {
      const text = d.toString()
      if (/authentication failed|ERR_NGROK/i.test(text)) fail('ngrok authentication failed — check the auth token')
    })
    child.on('error', () => fail('failed to spawn ngrok'))
  })
}

export function stopTunnel(tunnelId: string): void {
  if (!tunnelId.startsWith('ngrok-')) return
  try {
    // ngrok agent v3: stop by killing the process bound to the tunnel
    execSync("pkill -f 'ngrok http' || true", { timeout: 4000, stdio: 'pipe' })
  } catch {
    /* ignore */
  }
}

// Fetch active tunnels from the local ngrok API (best-effort)
export async function queryNgrokApi(): Promise<{ ok: boolean; tunnels: { name: string; publicUrl: string; proto: string }[] }> {
  try {
    const res = await fetch('http://127.0.0.1:4040/api/tunnels', { signal: AbortSignal.timeout(2000) })
    if (!res.ok) return { ok: false, tunnels: [] }
    const data = (await res.json()) as { tunnels?: { name: string; public_url: string; proto: string }[] }
    return {
      ok: true,
      tunnels: (data.tunnels || []).map((t) => ({ name: t.name, publicUrl: t.public_url, proto: t.proto })),
    }
  } catch {
    return { ok: false, tunnels: [] }
  }
}
