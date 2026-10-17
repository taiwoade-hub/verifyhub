'use client'

// VerifyHub — small shared presentation components.

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { statusTone, stepTone, STAGE_LABELS } from '@/lib/vh-api'
import {
  CheckCircle2,
  XCircle,
  MinusCircle,
  Loader2,
  CircleDashed,
  Clock,
} from 'lucide-react'

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

const TONES: Record<string, string> = {
  ok: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
  fail: 'border-red-500/30 bg-red-500/10 text-red-400',
  warn: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
  active: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
  idle: 'border-zinc-600/40 bg-zinc-800/60 text-zinc-400',
}

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const tone = statusTone(status)
  const live = tone === 'active'
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium',
        TONES[tone],
        className
      )}
    >
      {live && <Loader2 className="h-3 w-3 animate-spin" />}
      {status.replace(/_/g, ' ')}
    </span>
  )
}

export function ResultBadge({ result, checksPassed, checksTotal, className }: {
  result?: string | null
  checksPassed?: number
  checksTotal?: number
  className?: string
}) {
  if (!result) return null
  const tone = result === 'passed' ? 'ok' : result === 'failed' ? 'fail' : 'warn'
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium', TONES[tone], className)}>
      {result === 'passed' ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
      {result.toUpperCase()}
      {typeof checksPassed === 'number' && typeof checksTotal === 'number' && checksTotal > 0 && (
        <span className="opacity-80">{checksPassed}/{checksTotal}</span>
      )}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Step icon (verification timeline)
// ---------------------------------------------------------------------------

export function StepIcon({ status }: { status: string }) {
  const tone = stepTone(status)
  const cls = {
    ok: 'text-emerald-400',
    fail: 'text-red-400',
    warn: 'text-amber-400',
    active: 'text-sky-300',
    idle: 'text-zinc-600',
  }[tone]
  if (status === 'passed') return <CheckCircle2 className={cn('h-4 w-4', cls)} />
  if (status === 'failed') return <XCircle className={cn('h-4 w-4', cls)} />
  if (status === 'skipped') return <MinusCircle className={cn('h-4 w-4', cls)} />
  if (status === 'running') return <Loader2 className={cn('h-4 w-4 animate-spin', cls)} />
  if (status === 'pending') return <Clock className={cn('h-4 w-4', cls)} />
  return <CircleDashed className={cn('h-4 w-4', cls)} />
}

// ---------------------------------------------------------------------------
// Stage progress (run state machine)
// ---------------------------------------------------------------------------

export function StageProgress({ status, className }: { status: string; className?: string }) {
  const failed = ['FAILED', 'CANCELLED', 'TIMEOUT'].includes(status)
  const activeIdx = STAGE_LABELS.indexOf(status as (typeof STAGE_LABELS)[number])
  return (
    <div className={cn('flex flex-wrap gap-1', className)}>
      {STAGE_LABELS.map((stage, i) => {
        const done = activeIdx >= 0 && i < activeIdx
        const current = stage === status
        return (
          <span
            key={stage}
            className={cn(
              'rounded px-1.5 py-0.5 text-[10px] font-medium tracking-wide',
              current && !failed
                ? 'bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/40'
                : current && failed
                  ? 'bg-red-500/15 text-red-300 ring-1 ring-red-500/40'
                  : done
                    ? 'bg-emerald-500/10 text-emerald-400/80'
                    : 'bg-zinc-800/60 text-zinc-600'
            )}
          >
            {stage.replace(/_/g, ' ')}
          </span>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

export function PageHeader({ title, description, children }: {
  title: string
  description?: string
  children?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border px-6 py-5">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  )
}

export function Panel({ title, right, children, className, bodyClass }: {
  title?: ReactNode
  right?: ReactNode
  children: ReactNode
  className?: string
  bodyClass?: string
}) {
  return (
    <section className={cn('rounded-lg border border-border bg-[#111114]', className)}>
      {title && (
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <div className="text-xs font-semibold uppercase tracking-wider text-zinc-400">{title}</div>
          {right}
        </div>
      )}
      <div className={cn('p-4', bodyClass)}>{children}</div>
    </section>
  )
}

export function Empty({ icon, title, hint, action }: {
  icon?: ReactNode
  title: string
  hint?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border px-6 py-14 text-center">
      {icon && <div className="text-zinc-600">{icon}</div>}
      <div>
        <p className="text-sm font-medium text-zinc-300">{title}</p>
        {hint && <p className="mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">{hint}</p>}
      </div>
      {action}
    </div>
  )
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label}
    </div>
  )
}

export function ErrorNote({ error }: { error: string }) {
  return (
    <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
      {error}
    </div>
  )
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <code className={cn('font-mono text-[12px]', className)}>{children}</code>
}
