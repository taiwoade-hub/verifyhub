// VerifyHub — shared domain types and run state machine.

export const RUN_STAGES = [
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

export type RunStage = (typeof RUN_STAGES)[number]

export const FAILURE_STAGES = ['FAILED', 'CANCELLED', 'TIMEOUT'] as const
export type FailureStage = (typeof FAILURE_STAGES)[number]

export type RunStatus = RunStage | FailureStage

export const ACTIVE_STATUSES: RunStatus[] = [
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
]

export function isActive(status: string): boolean {
  return (ACTIVE_STATUSES as string[]).includes(status)
}

export function stageProgress(stage: string): number {
  const idx = RUN_STAGES.indexOf(stage as RunStage)
  if (stage === 'COMPLETED') return 100
  if (idx < 0) return 0
  return Math.round((idx / (RUN_STAGES.length - 1)) * 100)
}

// ---------------------------------------------------------------------------
// WebSocket event names (contract between orchestrator and UI)
// ---------------------------------------------------------------------------

export const WS_EVENTS = [
  'run.created',
  'run.status',
  'runner.created',
  'project.detected',
  'install.started',
  'install.completed',
  'application.started',
  'health_check',
  'ngrok.connected',
  'kane.started',
  'kane.action',
  'kane.screenshot',
  'kane.error',
  'kane.completed',
  'run.completed',
  'log.append',
] as const

export type WsEvent = (typeof WS_EVENTS)[number]

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

export interface DetectionResult {
  language: string // node | python | static | unknown
  languageVersion?: string
  framework: string
  packageManager: string // npm | pnpm | yarn | bun | pip | poetry | none
  installCommand?: string
  buildCommand?: string
  startCommand?: string
  port?: number
  healthPath: string
  healthStrategy: 'http' | 'tcp'
  files: string[] // notable files that drove the decision
  notes: string[]
}

// ---------------------------------------------------------------------------
// .verifyhub.yml
// ---------------------------------------------------------------------------

export interface VerifyHubConfig {
  name?: string
  runtime?: { type?: string }
  verification?: {
    engine?: string
    url?: string
    instructions?: string[]
    timeoutSeconds?: number
  }
  notifications?: { telegram?: boolean }
  schedule?: { enabled?: boolean; cron?: string }
}

export const DEFAULT_CONFIG: VerifyHubConfig = {
  runtime: { type: 'auto' },
  verification: {
    engine: 'kane',
    url: 'auto',
    instructions: ['Open homepage', 'Test navigation'],
    timeoutSeconds: 120,
  },
  notifications: { telegram: false },
  schedule: { enabled: false },
}

// ---------------------------------------------------------------------------
// Engine events
// ---------------------------------------------------------------------------

export interface EngineStepUpdate {
  index: number
  name: string
  status: 'pending' | 'running' | 'passed' | 'failed' | 'skipped'
  detail?: string
  durationMs?: number
}

export interface EngineContext {
  runId: string
  targetUrl: string
  internalUrl: string
  instructions: string[]
  timeoutSeconds: number
  onStep: (update: EngineStepUpdate) => Promise<void>
  onLog: (stream: 'kane' | 'system', line: string) => Promise<void>
  onEvent: (type: string, message: string, data?: unknown, status?: string) => Promise<void>
  onEvidence: (e: { kind: string; label: string; content?: string; mimeType?: string }) => Promise<void>
  signal: AbortSignal
}

export interface EngineResult {
  result: 'passed' | 'failed' | 'error'
  checksPassed: number
  checksTotal: number
  summary: string
}

export interface VerificationEngine {
  name: string
  mode: 'cli' | 'probe' | 'simulated'
  available(): Promise<boolean>
  unavailableReason?: string
  verify(ctx: EngineContext): Promise<EngineResult>
}
