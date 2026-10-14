'use client'

// VerifyHub — frontend API helpers, shared types and polling hooks.
// Live updates use short polling (the API exposes incremental ?since= tails),
// which works in every environment; the socket.io feed accelerates nothing critical.

import { useCallback, useEffect, useRef, useState } from 'react'

// ---------------------------------------------------------------------------
// Domain types (JSON shapes returned by /api/v1)
// ---------------------------------------------------------------------------

export interface Project {
  id: string
  name: string
  description?: string | null
  sourceType: 'github' | 'upload' | 'url' | 'example'
  sourceUrl?: string | null
  gitRepo?: string | null
  gitBranch?: string | null
  detectedLanguage?: string | null
  detectedFramework?: string | null
  detectedPackageManager?: string | null
  detectedInstall?: string | null
  detectedBuild?: string | null
  detectedStart?: string | null
  detectedPort?: number | null
  config?: string | null
  lastRunAt?: string | null
  createdAt: string
  updatedAt: string
  runCount?: number
  runs?: Run[]
}

export interface RunEvent {
  id: string
  runId: string
  type: string
  message: string
  status?: string | null
  data?: string | null
  createdAt: string
}

export interface RunLog {
  id: string
  runId: string
  stream: 'system' | 'stdout' | 'stderr' | 'kane'
  line: string
  seq: number
  createdAt: string
}

export interface VerificationStep {
  id: string
  index: number
  name: string
  status: 'pending' | 'running' | 'passed' | 'failed' | 'skipped'
  detail?: string | null
  durationMs?: number | null
}

export interface VerificationSession {
  id: string
  engine: string
  engineMode?: string | null
  status: string
  targetUrl?: string | null
  instructions?: string | null
  result?: string | null
  summary?: string | null
  durationMs?: number | null
  steps: VerificationStep[]
}

export interface Evidence {
  id: string
  kind: string
  label: string
  content?: string | null
  mimeType?: string | null
  size?: number | null
  createdAt: string
}

export interface Run {
  id: string
  number: number
  projectId: string
  project?: { id: string; name: string; sourceType?: string; detectedFramework?: string | null }
  status: string
  trigger: string
  sourceType: string
  branch?: string | null
  commitSha?: string | null
  stage?: string | null
  progress: number
  detected?: string | null
  runnerId?: string | null
  runnerMode?: string | null
  previewUrl?: string | null
  internalUrl?: string | null
  tunnelProvider?: string | null
  result?: string | null
  checksPassed: number
  checksTotal: number
  error?: string | null
  startedAt?: string | null
  finishedAt?: string | null
  durationMs?: number | null
  createdAt: string
  events?: RunEvent[]
  session?: VerificationSession | null
  evidence?: Evidence[]
}

export interface DetectionResult {
  language: string
  framework: string
  packageManager: string
  installCommand?: string
  buildCommand?: string
  startCommand?: string
  port?: number
  healthPath: string
  healthStrategy?: 'http' | 'tcp'
  files: string[]
  notes: string[]
}

export interface DashboardStats {
  totalProjects: number
  totalRuns: number
  activeRuns: number
  failedRuns: number
  successRate: number | null
  scheduledProjects: number
  recentRuns: Run[]
  perDay: { date: string; total: number; passed: number; failed: number }[]
}

export interface Schedule {
  id: string
  projectId: string
  project?: { id: string; name: string }
  name: string
  cron: string
  branch?: string | null
  telegram: boolean
  enabled: boolean
  lastRunAt?: string | null
  createdAt: string
}

export interface IntegrationStatus {
  key: string
  name: string
  connected: boolean
  detail: string
  kind: 'runtime' | 'tunnel' | 'engine' | 'notification' | 'source'
}

export interface IntegrationState {
  statuses: IntegrationStatus[]
  preferences: { notifyOnStart?: boolean; notifyOnReady?: boolean; notifyOnComplete?: boolean }
  ngrok: { configured: boolean; domain?: string | null }
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function handle<T>(res: Response): Promise<T> {
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    /* empty body */
  }
  if (!res.ok) {
    const msg = (body as { error?: string })?.error || `request failed (HTTP ${res.status})`
    throw new ApiError(msg, res.status)
  }
  return body as T
}

export function apiGet<T>(url: string): Promise<T> {
  return fetch(url, { cache: 'no-store' }).then((r) => handle<T>(r))
}

export function apiSend<T>(url: string, method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', body?: unknown): Promise<T> {
  return fetch(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then((r) => handle<T>(r))
}

export function apiUpload<T>(url: string, formData: FormData): Promise<T> {
  return fetch(url, { method: 'POST', body: formData }).then((r) => handle<T>(r))
}

// ---------------------------------------------------------------------------
// Polling data hook
// ---------------------------------------------------------------------------

export function useApi<T>(url: string | null, pollMs = 0): {
  data: T | null
  error: string | null
  loading: boolean
  refresh: () => void
} {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)

  const refresh = useCallback(() => {
    if (!url) return
    apiGet<T>(url)
      .then((d) => {
        if (mounted.current) {
          setData(d)
          setError(null)
        }
      })
      .catch((e) => {
        if (mounted.current) setError(e instanceof Error ? e.message : String(e))
      })
  }, [url])

  useEffect(() => {
    if (!url) return
    refresh()
    let timer: ReturnType<typeof setInterval> | null = null
    if (pollMs > 0) timer = setInterval(refresh, pollMs)
    return () => {
      if (timer) clearInterval(timer)
    }
  }, [url, pollMs, refresh])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  // Derived state — no sync setState inside effects.
  const loading = Boolean(url) && data === null && !error
  const viewData = url ? data : null

  return { data: viewData, error, loading, refresh }
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

export function fmtDuration(ms?: number | null): string {
  if (!ms || ms < 0) return '—'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rs = s % 60
  return `${m}m ${rs.toString().padStart(2, '0')}s`
}

export function fmtRelative(iso?: string | null): string {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 45_000) return 'just now'
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`
  return `${Math.round(diff / 86_400_000)}d ago`
}

export function fmtBytes(n?: number | null): string {
  if (!n && n !== 0) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

// ---------------------------------------------------------------------------
// Status presentation
// ---------------------------------------------------------------------------

export function statusTone(status: string): 'active' | 'ok' | 'fail' | 'warn' | 'idle' {
  if (['COMPLETED'].includes(status)) return 'ok'
  if (['FAILED', 'TIMEOUT'].includes(status)) return 'fail'
  if (status === 'CANCELLED') return 'warn'
  if (['QUEUED', 'PREPARING'].includes(status)) return 'idle'
  return 'active'
}

export function stepTone(status: string): 'ok' | 'fail' | 'warn' | 'active' | 'idle' {
  if (status === 'passed') return 'ok'
  if (status === 'failed') return 'fail'
  if (status === 'skipped') return 'warn'
  if (status === 'running') return 'active'
  return 'idle'
}

export const STAGE_LABELS = [
  'QUEUED',
  'PREPARING',
  'CLONING',
  'INSTALLING',
  'BUILDING',
  'STARTING',
  'HEALTH_CHECK',
  'EXPOSING',
  'READY',
  'KANE_VERIFYING',
  'COLLECTING_EVIDENCE',
  'COMPLETED',
] as const
