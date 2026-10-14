// VerifyHub — external service integrations.
// GitHub REST (PAT or unauthenticated), Telegram Bot API, ngrok tunneling,
// and integration status self-reporting used by the Settings page.

import crypto from 'crypto'
import { db } from '@/lib/db'

// ---------------------------------------------------------------------------
// Integration settings storage (DB-backed, env as fallback)
// ---------------------------------------------------------------------------

export interface GithubConfig {
  token?: string
  webhookSecret?: string
  username?: string
}

export interface TelegramConfig {
  botToken?: string
  chatId?: string
}

export interface NgrokConfig {
  authToken?: string
  domain?: string
}

export interface PreferencesConfig {
  notifyOnStart?: boolean
  notifyOnReady?: boolean
  notifyOnComplete?: boolean
}

async function getIntegration<T extends object>(id: string): Promise<{ connected: boolean; config: T }> {
  const row = await db.integration.findUnique({ where: { id } })
  if (!row) return { connected: false, config: {} as T }
  try {
    return { connected: row.connected, config: JSON.parse(row.config) as T }
  } catch {
    return { connected: false, config: {} as T }
  }
}

async function setIntegration(id: string, config: object, connected: boolean): Promise<void> {
  await db.integration.upsert({
    where: { id },
    create: { id, config: JSON.stringify(config), connected },
    update: { config: JSON.stringify(config), connected },
  })
}

export const getGithub = () => getIntegration<GithubConfig>('github')
export const getTelegram = () => getIntegration<TelegramConfig>('telegram')
export const getNgrok = () => getIntegration<NgrokConfig>('ngrok')
export const getPreferences = () =>
  getIntegration<PreferencesConfig>('preferences').then((r) => ({
    connected: r.connected,
    config: { notifyOnStart: false, notifyOnReady: true, notifyOnComplete: true, ...r.config },
  }))

export const saveGithub = (c: Partial<GithubConfig>, connected: boolean) => setIntegration('github', c, connected)
export const saveTelegram = (c: Partial<TelegramConfig>, connected: boolean) => setIntegration('telegram', c, connected)
export const saveNgrok = (c: Partial<NgrokConfig>, connected: boolean) => setIntegration('ngrok', c, connected)
export const savePreferences = (c: PreferencesConfig) => setIntegration('preferences', c, true)

export function githubToken(): string | undefined {
  return process.env.GITHUB_TOKEN || undefined
}

export function githubWebhookSecret(): string {
  return process.env.GITHUB_WEBHOOK_SECRET || 'verifyhub-dev-webhook-secret'
}

/** GitHub auth headers — prefers the DB-stored PAT, falls back to env. */
export async function githubAuthHeaders(): Promise<Record<string, string>> {
  const h: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'VerifyHub/1.0',
  }
  let token = process.env.GITHUB_TOKEN
  try {
    const { config, connected } = await getGithub()
    if (connected && config.token) token = config.token
  } catch {
    /* db not ready */
  }
  if (token) h.Authorization = `Bearer ${token}`
  return h
}

// ---------------------------------------------------------------------------
// GitHub REST
// ---------------------------------------------------------------------------

export interface RepoInfo {
  id: number
  full_name: string
  name: string
  description: string | null
  html_url: string
  default_branch: string
  language: string | null
  stargazers_count: number
  updated_at: string
  private: boolean
}

export async function listGithubRepos(): Promise<{ repos: RepoInfo[]; authenticated: boolean; user?: string }> {
  const headers = await githubAuthHeaders()
  const base = 'https://api.github.com'
  if (headers.Authorization) {
    const userRes = await fetch(`${base}/user`, { headers })
    if (!userRes.ok) throw new Error(`GitHub token invalid (${userRes.status})`)
    const user = (await userRes.json()) as { login: string }
    const reposRes = await fetch(`${base}/user/repos?per_page=30&sort=updated&affiliation=owner,collaborator`, { headers })
    const repos = reposRes.ok ? ((await reposRes.json()) as RepoInfo[]) : []
    return { repos, authenticated: true, user: user.login }
  }
  // unauthenticated: nothing meaningful to list; UI will rely on public URL input
  return { repos: [], authenticated: false }
}

export async function getPublicRepo(ownerRepo: string): Promise<RepoInfo | null> {
  const res = await fetch(`https://api.github.com/repos/${ownerRepo}`, { headers: await githubAuthHeaders() })
  if (!res.ok) return null
  return (await res.json()) as RepoInfo
}

export async function listBranches(ownerRepo: string): Promise<string[]> {
  const res = await fetch(`https://api.github.com/repos/${ownerRepo}/branches?per_page=30`, {
    headers: await githubAuthHeaders(),
  })
  if (!res.ok) return []
  const branches = (await res.json()) as { name: string }[]
  return branches.map((b) => b.name)
}

export async function downloadRepoTarball(
  ownerRepo: string,
  branch: string,
  destPath: string
): Promise<{ commitSha?: string }> {
  const headers = await githubAuthHeaders()
  const url = `https://api.github.com/repos/${ownerRepo}/tarball/${encodeURIComponent(branch)}`
  const res = await fetch(url, { headers })
  if (!res.ok) throw new Error(`failed to download repository tarball (HTTP ${res.status})`)
  const buf = Buffer.from(await res.arrayBuffer())
  const fs = await import('fs')
  fs.writeFileSync(destPath, buf)
  // best-effort commit sha from headers
  const sha = res.headers.get('x-github-commit') || undefined
  return { commitSha: sha }
}

export function verifyGithubSignature(payload: string, signature: string | null, secret: string): boolean {
  if (!signature) return false
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex')
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Telegram Bot API
// ---------------------------------------------------------------------------

export interface TelegramSendResult {
  ok: boolean
  error?: string
}

export async function telegramSend(chatId: string, html: string): Promise<TelegramSendResult> {
  const { config } = await getTelegram()
  const token = config.botToken || process.env.TELEGRAM_BOT_TOKEN
  if (!token || !chatId) return { ok: false, error: 'telegram not configured' }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: html, parse_mode: 'HTML', disable_web_page_preview: false }),
    })
    const data = (await res.json()) as { ok: boolean; description?: string }
    if (!data.ok) return { ok: false, error: data.description || `HTTP ${res.status}` }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function telegramMe(): Promise<{ ok: boolean; username?: string; error?: string }> {
  const { config } = await getTelegram()
  const token = config.botToken || process.env.TELEGRAM_BOT_TOKEN
  if (!token) return { ok: false, error: 'bot token not configured' }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`)
    const data = (await res.json()) as { ok: boolean; result?: { username: string }; description?: string }
    if (!data.ok) return { ok: false, error: data.description || 'invalid token' }
    return { ok: true, username: data.result?.username }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export function formatRunMessage(project: string, run: { number: number; result?: string | null; checksPassed: number; checksTotal: number; previewUrl?: string | null; durationMs?: number | null; error?: string | null; commitSha?: string | null }, kind: string): string {
  const statusIcon = kind === 'run.failed' ? '❌' : '✅'
  const dur = run.durationMs ? `${Math.floor(run.durationMs / 60000)}m ${Math.round((run.durationMs % 60000) / 1000)}s` : undefined
  const lines = [
    `🤖 <b>VerifyHub</b>`,
    ``,
    `Project: <b>${escapeHtml(project)}</b>`,
    run.commitSha ? `Commit: <code>${run.commitSha.slice(0, 7)}</code>` : `Run: #${run.number}`,
    ``,
    `Status: ${statusIcon} <b>${kind === 'run.failed' ? 'FAILED' : 'PASSED'}</b>`,
    `${run.checksPassed}/${run.checksTotal} checks passed.`,
  ]
  if (dur) lines.push(`Duration: ${dur}`)
  if (run.error) lines.push(`Failed: ${escapeHtml(run.error.slice(0, 200))}`)
  if (run.previewUrl) lines.push(``, `Preview: ${run.previewUrl}`)
  lines.push(``, `Evidence: available in VerifyHub`)
  return lines.join('\n')
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// ---------------------------------------------------------------------------
// Integration status (self-reporting, shown in Settings)
// ---------------------------------------------------------------------------

export interface IntegrationStatus {
  key: string
  name: string
  connected: boolean
  detail: string
  kind: 'runtime' | 'tunnel' | 'engine' | 'notification' | 'source'
}

export async function integrationStatuses(): Promise<IntegrationStatus[]> {
  const statuses: IntegrationStatus[] = []

  // Docker
  let dockerDetail = 'docker CLI not found — using local runner with timeouts'
  let dockerOk = false
  try {
    const { execSync } = await import('child_process')
    const v = execSync('docker --version', { timeout: 4000, stdio: 'pipe' }).toString().trim()
    const info = execSync('docker info --format "{{.ServerVersion}}"', { timeout: 5000, stdio: 'pipe' }).toString().trim()
    dockerOk = true
    dockerDetail = `${v} (daemon ${info})`
  } catch {
    /* stays false */
  }
  statuses.push({ key: 'docker', name: 'Docker Runner', connected: dockerOk, detail: dockerDetail, kind: 'runtime' })

  // Runtimes
  for (const [key, name, bin, flag] of [
    ['node', 'Node.js', 'node', '--version'],
    ['bun', 'Bun', 'bun', '--version'],
    ['python3', 'Python 3', 'python3', '--version'],
  ] as const) {
    try {
      const { execSync } = await import('child_process')
      const v = execSync(`${bin} ${flag}`, { timeout: 3000, stdio: 'pipe' }).toString().trim()
      statuses.push({ key, name, connected: true, detail: v, kind: 'runtime' })
    } catch {
      statuses.push({ key, name, connected: false, detail: 'not installed', kind: 'runtime' })
    }
  }

  // Kane
  let kaneOk = false
  let kaneDetail = 'kane / kane-cli binary not found on PATH — HTTP probe engine is used instead'
  try {
    const { execSync } = await import('child_process')
    try {
      kaneDetail = execSync('which kane', { timeout: 3000, stdio: 'pipe' }).toString().trim()
      kaneOk = kaneDetail.length > 0
    } catch {
      kaneDetail = execSync('which kane-cli', { timeout: 3000, stdio: 'pipe' }).toString().trim()
      kaneOk = kaneDetail.length > 0
    }
  } catch {
    /* stays false */
  }
  statuses.push({ key: 'kane', name: 'Kane CLI', connected: kaneOk, detail: kaneDetail, kind: 'engine' })

  // ngrok
  const ngrok = await getNgrok()
  let ngrokBin = false
  try {
    const { execSync } = await import('child_process')
    execSync('which ngrok', { timeout: 3000, stdio: 'pipe' })
    ngrokBin = true
  } catch {
    /* ignore */
  }
  const ngrokToken = ngrok.config.authToken || process.env.NGROK_AUTHTOKEN
  statuses.push({
    key: 'ngrok',
    name: 'ngrok Tunnel',
    connected: Boolean(ngrokToken),
    detail: !ngrokToken
      ? 'auth token not configured (NGROK_AUTHTOKEN or Settings)'
      : !ngrokBin
        ? 'ready (using internal preview proxy — ngrok binary not found)'
        : 'ready',
    kind: 'tunnel',
  })

  // GitHub
  const gh = await getGithub()
  const envToken = Boolean(process.env.GITHUB_TOKEN)
  statuses.push({
    key: 'github',
    name: 'GitHub',
    connected: gh.connected || envToken,
    detail: gh.connected ? `connected as ${gh.config.username || 'user'}` : envToken ? 'GITHUB_TOKEN from environment' : 'not connected — public repos only',
    kind: 'source',
  })

  // Telegram
  const tg = await getTelegram()
  const tgEnv = Boolean(process.env.TELEGRAM_BOT_TOKEN)
  statuses.push({
    key: 'telegram',
    name: 'Telegram Bot',
    connected: tg.connected || tgEnv,
    detail: tg.connected ? `chat ${tg.config.chatId || 'not set'}` : tgEnv ? 'TELEGRAM_BOT_TOKEN from environment' : 'not configured',
    kind: 'notification',
  })

  return statuses
}
