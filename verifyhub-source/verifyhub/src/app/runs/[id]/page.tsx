'use client'

// VerifyHub — Run detail. THE signature view: watch the verification happen.
// Live browser (preview proxy or tunnel) + Kane activity timeline + terminal
// logs + evidence, all updating in near real time while the run is active.

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import {
  ExternalLink,
  RefreshCw,
  Square,
  MonitorPlay,
  Terminal as TerminalIcon,
  Paperclip,
  ChevronDown,
  ChevronRight,
  ScanEye,
  ArrowLeft,
} from 'lucide-react'
import { toast } from 'sonner'
import { Shell } from '@/components/verifyhub/shell'
import { Panel, Loading, ErrorNote, StatusBadge, ResultBadge, StepIcon, StageProgress, Mono } from '@/components/verifyhub/bits'
import { Button } from '@/components/ui/button'
import {
  useApi, apiSend, fmtDuration, fmtRelative, fmtBytes,
  type Run, type RunLog, type Evidence,
} from '@/lib/vh-api'
import { cn } from '@/lib/utils'

const TERMINAL_STATUSES = ['COMPLETED', 'FAILED', 'CANCELLED', 'TIMEOUT']

function isActiveRun(status: string): boolean {
  return !TERMINAL_STATUSES.includes(status)
}

// ---------------------------------------------------------------------------
// Live browser
// ---------------------------------------------------------------------------

function LiveBrowser({ run }: { run: Run }) {
  const [nonce, setNonce] = useState(0)
  const verifying = run.status === 'KANE_VERIFYING' || isActiveRun(run.status)

  const src = useMemo(() => {
    if (run.previewUrl && /^https?:\/\//.test(run.previewUrl)) return run.previewUrl
    if (run.previewUrl && run.previewUrl.startsWith('/api/v1/preview/')) return run.previewUrl
    if (run.status === 'COMPLETED' || isActiveRun(run.status)) return `/api/v1/preview/${run.id}/`
    return null
  }, [run.previewUrl, run.status, run.id])

  return (
    <Panel
      title="Kane — live browser"
      className="overflow-hidden"
      bodyClass="p-0"
      right={
        <div className="flex items-center gap-2">
          {verifying && isActiveRun(run.status) ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[11px] font-medium text-sky-300">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-sky-400" />
              </span>
              VERIFYING
            </span>
          ) : (
            <ResultBadge result={run.result} checksPassed={run.checksPassed} checksTotal={run.checksTotal} />
          )}
          {src && (
            <>
              <Button size="sm" variant="ghost" className="h-6 gap-1 px-2 text-[11px] text-zinc-400 hover:text-foreground" onClick={() => setNonce((n) => n + 1)}>
                <RefreshCw className="h-3 w-3" />
                Reload
              </Button>
              <a
                href={src}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-6 items-center gap-1 rounded px-2 text-[11px] text-zinc-400 hover:bg-zinc-800 hover:text-foreground"
              >
                <ExternalLink className="h-3 w-3" />
                Open
              </a>
            </>
          )}
        </div>
      }
    >
      <div className="relative h-[380px] bg-[#0a0a0c]">
        {src ? (
          <iframe
            key={nonce}
            src={src}
            title="live preview"
            className="h-full w-full border-0 bg-white"
            sandbox="allow-scripts allow-same-origin allow-forms"
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <MonitorPlay className="h-9 w-9 text-zinc-700" />
            <p className="text-sm text-zinc-400">Preview unavailable</p>
            <p className="max-w-sm text-xs leading-relaxed text-zinc-600">
              The runner was cleaned up after this run finished. Evidence, logs and the final
              report below are preserved.
            </p>
          </div>
        )}
      </div>
      {run.previewUrl && /^https?:\/\//.test(run.previewUrl) && (
        <div className="border-t border-border px-3 py-1.5">
          <Mono className="text-[11px] text-emerald-400">{run.previewUrl}</Mono>
        </div>
      )}
    </Panel>
  )
}

// ---------------------------------------------------------------------------
// Kane activity (verification steps + session summary)
// ---------------------------------------------------------------------------

function ActivityTimeline({ run }: { run: Run }) {
  const session = run.session
  const steps = session?.steps || []

  return (
    <Panel title="Kane activity" bodyClass="p-0" right={
      session ? (
        <Mono className="text-[10px] text-zinc-500">
          {session.engine}{session.engineMode ? ` · ${session.engineMode}` : ''}
        </Mono>
      ) : null
    }>
      <div className="max-h-[380px] overflow-y-auto">
        {steps.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-muted-foreground">
            Verification steps appear here once the engine starts.
          </p>
        ) : (
          <ul className="divide-y divide-border/60">
            {steps.map((step, i) => (
              <li key={step.id ? `${step.id}-${step.index ?? i}` : `step-${step.index ?? i}`} className="flex items-start gap-2.5 px-3.5 py-2.5">
                <span className="mt-0.5"><StepIcon status={step.status} /></span>
                <div className="min-w-0 flex-1">
                  <p className={cn('text-xs font-medium', step.status === 'failed' ? 'text-red-300' : 'text-zinc-200')}>
                    {step.name}
                  </p>
                  {step.detail && (
                    <p className="mt-0.5 break-words text-[11px] leading-relaxed text-muted-foreground">{step.detail}</p>
                  )}
                </div>
                {step.durationMs != null && (
                  <span className="mt-0.5 shrink-0 font-mono text-[10px] text-zinc-600">{Math.round(step.durationMs)}ms</span>
                )}
              </li>
            ))}
          </ul>
        )}
        {session?.summary && (
          <div
            className={cn(
              'border-t px-3.5 py-2.5 text-xs',
              session.result === 'passed'
                ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-300'
                : session.result === 'failed'
                  ? 'border-red-500/20 bg-red-500/5 text-red-300'
                  : 'border-amber-500/20 bg-amber-500/5 text-amber-300'
            )}
          >
            {session.summary}
          </div>
        )}
      </div>
    </Panel>
  )
}

// ---------------------------------------------------------------------------
// Terminal (logs)
// ---------------------------------------------------------------------------

const STREAM_COLORS: Record<string, string> = {
  system: 'text-sky-300/90',
  stdout: 'text-zinc-300',
  stderr: 'text-red-300/90',
  kane: 'text-emerald-300/90',
}

function Terminal({ runId, active }: { runId: string; active: boolean }) {
  const [logs, setLogs] = useState<RunLog[]>([])
  const boxRef = useRef<HTMLDivElement>(null)
  const lastSeq = useRef(0)
  const [follow, setFollow] = useState(true)

  // Reset when runId changes
  useEffect(() => {
    setLogs([])
    lastSeq.current = 0
  }, [runId])

  useEffect(() => {
    let stop = false
    const tick = async () => {
      try {
        const res = await fetch(`/api/v1/runs/${runId}/logs?since=${lastSeq.current}`, { cache: 'no-store' })
        if (!res.ok) return
        const data = (await res.json()) as { logs: RunLog[] }
        if (stop || !data.logs?.length) return
        const highestSeq = data.logs[data.logs.length - 1].seq
        if (highestSeq > lastSeq.current) {
          lastSeq.current = highestSeq
        }
        setLogs((prev) => {
          const map = new Map<string, RunLog>()
          for (const item of prev) {
            map.set(item.id || `seq-${item.seq}`, item)
          }
          for (const item of data.logs) {
            map.set(item.id || `seq-${item.seq}`, item)
          }
          return Array.from(map.values())
            .sort((a, b) => a.seq - b.seq)
            .slice(-800)
        })
      } catch {
        /* transient */
      }
    }
    void tick()
    const t = setInterval(tick, active ? 1200 : 4000)
    return () => {
      stop = true
      clearInterval(t)
    }
  }, [runId, active])

  useEffect(() => {
    if (follow && boxRef.current) {
      boxRef.current.scrollTop = boxRef.current.scrollHeight
    }
  }, [logs, follow])

  return (
    <Panel
      title="Terminal"
      bodyClass="p-0"
      right={
        <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-zinc-500">
          <input
            type="checkbox"
            checked={follow}
            onChange={(e) => setFollow(e.target.checked)}
            className="h-3 w-3 accent-emerald-500"
          />
          follow
        </label>
      }
    >
      <div ref={boxRef} className="h-[300px] overflow-y-auto bg-[#0a0a0c] p-3 font-mono text-[11.5px] leading-relaxed">
        {logs.length === 0 ? (
          <p className="text-zinc-600">$ waiting for runner output…</p>
        ) : (
          logs.map((l) => (
            <div key={l.id ? `${l.id}-${l.seq}` : `seq-${l.seq}`} className="flex gap-2">
              <span className="shrink-0 select-none text-zinc-700">{String(l.seq).padStart(3, '0')}</span>
              <span className={cn('whitespace-pre-wrap break-all', STREAM_COLORS[l.stream] || 'text-zinc-300')}>
                {l.line}
              </span>
            </div>
          ))
        )}
      </div>
    </Panel>
  )
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

function EvidenceList({ evidence }: { evidence: Evidence[] }) {
  const [openId, setOpenId] = useState<string | null>(null)
  if (!evidence.length) {
    return (
      <p className="px-4 py-6 text-center text-xs text-muted-foreground">
        Evidence (HTTP transcripts, logs, screenshots) is collected during verification.
      </p>
    )
  }
  return (
    <ul className="divide-y divide-border/60">
      {evidence.map((ev, i) => (
        <li key={ev.id ? `${ev.id}-${i}` : `evidence-${i}`}>
          <button
            className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-zinc-900/60"
            onClick={() => setOpenId((v) => (v === ev.id ? null : ev.id))}
          >
            {openId === ev.id ? <ChevronDown className="h-3.5 w-3.5 text-zinc-500" /> : <ChevronRight className="h-3.5 w-3.5 text-zinc-500" />}
            <Paperclip className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium text-zinc-200">{ev.label}</span>
              <span className="text-[11px] text-zinc-500">
                {ev.kind} · {fmtBytes(ev.size)}
              </span>
            </span>
          </button>
          {openId === ev.id && ev.content && (
            <pre className="max-h-[280px] overflow-auto border-t border-border bg-[#0a0a0c] p-3 font-mono text-[11px] leading-relaxed text-zinc-300">
              {ev.content}
            </pre>
          )}
        </li>
      ))}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function RunDetailInner() {
  const params = useParams<{ id: string }>()
  const runId = params.id
  const { data, error, loading, refresh } = useApi<{ run: Run }>(`/api/v1/runs/${runId}`, 1500)
  const [cancelling, setCancelling] = useState(false)

  const run = data?.run
  const active = run ? isActiveRun(run.status) : true

  // Stop polling once finished
  useEffect(() => {
    if (run && !active) {
      refresh()
    }
  }, [run?.status])

  const cancel = async () => {
    setCancelling(true)
    try {
      await apiSend(`/api/v1/runs/${runId}/cancel`, 'POST')
      toast.info('Cancellation requested')
      refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'cancel failed')
    } finally {
      setCancelling(false)
    }
  }

  if (loading && !run) {
    return (
      <Shell title="Run">
        <Loading />
      </Shell>
    )
  }
  if (error || !run) {
    return (
      <Shell title="Run">
        <div className="mx-auto max-w-3xl px-6 py-6"><ErrorNote error={error || 'run not found'} /></div>
      </Shell>
    )
  }

  return (
    <Shell
      title={
        <span className="inline-flex items-center gap-2">
          <Link href="/runs" className="text-zinc-500 hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          Run #{run.number}
          <span className="font-normal text-zinc-500">of {run.project?.name}</span>
        </span>
      }
      subtitle={<Mono className="text-zinc-600">{run.id}</Mono>}
      actions={
        <>
          {active && (
            <Button size="sm" variant="outline" onClick={cancel} disabled={cancelling} className="h-8 gap-1.5 border-red-500/40 text-xs text-red-300 hover:bg-red-500/10">
              <Square className="h-3 w-3" />
              Cancel
            </Button>
          )}
          <StatusBadge status={run.status} />
        </>
      }
    >
      <div className="mx-auto max-w-7xl space-y-4 px-6 py-5">
        {/* Meta strip */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-border bg-[#111114] px-4 py-3 text-xs text-zinc-400">
          <span>trigger <Mono className="text-zinc-200">{run.trigger}</Mono></span>
          {run.branch && <span>branch <Mono className="text-zinc-200">{run.branch}</Mono></span>}
          {run.commitSha && <span>commit <Mono className="text-zinc-200">{run.commitSha.slice(0, 7)}</Mono></span>}
          <span>runner <Mono className="text-zinc-200">{run.runnerMode || '—'}</Mono></span>
          <span>duration <Mono className="text-zinc-200">{fmtDuration(run.durationMs)}</Mono></span>
          <span>started <Mono className="text-zinc-200">{fmtRelative(run.startedAt || run.createdAt)}</Mono></span>
          {run.tunnelProvider && (
            <span>tunnel <Mono className="text-zinc-200">{run.tunnelProvider === 'ngrok' ? 'ngrok' : 'internal proxy'}</Mono></span>
          )}
        </div>

        {/* State machine strip */}
        <div className="rounded-lg border border-border bg-[#111114] px-4 py-3">
          <StageProgress status={run.status} />
          {run.error && (
            <p className="mt-2 rounded border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 font-mono text-[11px] text-red-300">
              {run.error}
            </p>
          )}
        </div>

        {/* Hero grid: live browser + activity */}
        <div className="grid gap-4 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <LiveBrowser run={run} />
          </div>
          <ActivityTimeline run={run} />
        </div>

        {/* Terminal + evidence */}
        <div className="grid gap-4 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <Terminal runId={run.id} active={active} />
          </div>
          <Panel title={`Evidence (${run.evidence?.length || 0})`} bodyClass="p-0" right={
            <ScanEye className="h-3.5 w-3.5 text-zinc-600" />
          }>
            <div className="max-h-[300px] overflow-y-auto">
              <EvidenceList evidence={run.evidence || []} />
            </div>
          </Panel>
        </div>
      </div>
    </Shell>
  )
}

export default function RunDetailPage() {
  return <RunDetailInner />
}
