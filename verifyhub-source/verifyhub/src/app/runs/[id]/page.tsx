'use client'

// VerifyHub — Run detail. THE signature view: watch the verification happen.
// Live browser (multi-viewport proxy/tunnel) + Video recording player +
// Screenshot gallery + Interactive HTML report + Activity timeline + Terminal.

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
  Smartphone,
  Tablet,
  Monitor,
  Camera,
  Video as VideoIcon,
  FileText,
  Download,
  Copy,
  Check,
  Maximize2,
  AlertCircle,
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
// Live browser & Multi-Viewport Verification Viewer
// ---------------------------------------------------------------------------

type BrowserTab = 'preview' | 'video' | 'screenshots' | 'report'
type ViewportMode = 'desktop' | 'tablet' | 'mobile'

function LiveBrowser({ run }: { run: Run }) {
  const [nonce, setNonce] = useState(0)
  const isExternalUrl = run.sourceType === 'url' || Boolean(run.previewUrl && !run.previewUrl.startsWith('/api/v1/preview/'))
  const [activeTab, setActiveTab] = useState<BrowserTab>(() => (isExternalUrl ? 'video' : 'preview'))
  const [viewport, setViewport] = useState<ViewportMode>('desktop')
  const [selectedScreenshot, setSelectedScreenshot] = useState<string | null>(null)

  const verifying = run.status === 'KANE_VERIFYING' || isActiveRun(run.status)

  const src = useMemo(() => {
    if (run.previewUrl && /^https?:\/\//.test(run.previewUrl)) return run.previewUrl
    if (run.previewUrl && run.previewUrl.startsWith('/api/v1/preview/')) return run.previewUrl
    if (run.status === 'COMPLETED' || isActiveRun(run.status)) return `/api/v1/preview/${run.id}/`
    return null
  }, [run.previewUrl, run.status, run.id])

  // Extract media evidence
  const screenshots = useMemo(() => {
    return (run.evidence || []).filter(
      (e) => e.kind === 'screenshot' || e.mimeType?.startsWith('image/')
    )
  }, [run.evidence])

  const videoEvidence = useMemo(() => {
    return (run.evidence || []).find(
      (e) => e.kind === 'video' || e.mimeType?.startsWith('video/')
    )
  }, [run.evidence])

  const htmlReportEvidence = useMemo(() => {
    return (run.evidence || []).find((e) => e.kind === 'report-html')
  }, [run.evidence])

  const videoSrc = useMemo(() => {
    if (videoEvidence?.content && videoEvidence.content.startsWith('/')) {
      return videoEvidence.content
    }
    return `/api/v1/runs/${run.id}/artifacts/videos/session.webm`
  }, [videoEvidence, run.id])

  const reportUrl = useMemo(() => {
    return `/api/v1/runs/${run.id}/report?format=html`
  }, [run.id])

  // Derive current active screenshot
  const currentScreenshot = selectedScreenshot || (screenshots.length > 0 ? (screenshots[0].content || null) : null)

  return (
    <Panel
      title={
        <div className="flex items-center gap-1">
          <span className="font-semibold text-zinc-100">Live Verification Viewer</span>
          {run.session?.engine && (
            <span className="ml-2 rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
              {run.session.engine}
            </span>
          )}
        </div>
      }
      className="overflow-hidden"
      bodyClass="p-0 flex flex-col"
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

          {activeTab === 'preview' && src && (
            <>
              {/* Viewport switchers */}
              <div className="flex items-center rounded-lg border border-border bg-zinc-900/80 p-0.5">
                <button
                  type="button"
                  title="Desktop (100% / 1280px)"
                  onClick={() => setViewport('desktop')}
                  className={cn(
                    'flex h-6 items-center gap-1 rounded px-2 text-[11px] transition-colors',
                    viewport === 'desktop' ? 'bg-zinc-800 text-foreground shadow-sm' : 'text-zinc-400 hover:text-zinc-200'
                  )}
                >
                  <Monitor className="h-3 w-3" />
                  <span className="hidden sm:inline">Desktop</span>
                </button>
                <button
                  type="button"
                  title="Tablet (768px)"
                  onClick={() => setViewport('tablet')}
                  className={cn(
                    'flex h-6 items-center gap-1 rounded px-2 text-[11px] transition-colors',
                    viewport === 'tablet' ? 'bg-zinc-800 text-foreground shadow-sm' : 'text-zinc-400 hover:text-zinc-200'
                  )}
                >
                  <Tablet className="h-3 w-3" />
                  <span className="hidden sm:inline">Tablet</span>
                </button>
                <button
                  type="button"
                  title="Mobile (375px)"
                  onClick={() => setViewport('mobile')}
                  className={cn(
                    'flex h-6 items-center gap-1 rounded px-2 text-[11px] transition-colors',
                    viewport === 'mobile' ? 'bg-zinc-800 text-foreground shadow-sm' : 'text-zinc-400 hover:text-zinc-200'
                  )}
                >
                  <Smartphone className="h-3 w-3" />
                  <span className="hidden sm:inline">Mobile</span>
                </button>
              </div>

              <Button
                size="sm"
                variant="ghost"
                className="h-6 gap-1 px-2 text-[11px] text-zinc-400 hover:text-foreground"
                onClick={() => setNonce((n) => n + 1)}
              >
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

          {activeTab === 'report' && (
            <a
              href={reportUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-6 items-center gap-1 rounded border border-border bg-zinc-800 px-2 text-[11px] text-zinc-200 hover:bg-zinc-700"
            >
              <ExternalLink className="h-3 w-3" />
              Full Page Report
            </a>
          )}
        </div>
      }
    >
      {/* Sub-navigation tabs: Preview / Video / Screenshots / Report */}
      <div className="flex items-center gap-1 border-b border-border bg-[#0d0d10] px-3 py-1.5">
        <button
          type="button"
          onClick={() => setActiveTab('preview')}
          className={cn(
            'inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors',
            activeTab === 'preview'
              ? 'bg-zinc-800 text-emerald-400'
              : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
          )}
        >
          <MonitorPlay className="h-3.5 w-3.5" />
          Live Preview
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('video')}
          className={cn(
            'inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors',
            activeTab === 'video'
              ? 'bg-zinc-800 text-emerald-400'
              : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
          )}
        >
          <VideoIcon className="h-3.5 w-3.5" />
          Session Video
          {videoEvidence && (
            <span className="rounded-full bg-emerald-500/20 px-1 text-[10px] text-emerald-300">
              HD
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('screenshots')}
          className={cn(
            'inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors',
            activeTab === 'screenshots'
              ? 'bg-zinc-800 text-emerald-400'
              : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
          )}
        >
          <Camera className="h-3.5 w-3.5" />
          Screenshots
          {screenshots.length > 0 && (
            <span className="rounded-full bg-zinc-700 px-1.5 text-[10px] text-zinc-300">
              {screenshots.length}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('report')}
          className={cn(
            'inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors',
            activeTab === 'report'
              ? 'bg-zinc-800 text-emerald-400'
              : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
          )}
        >
          <FileText className="h-3.5 w-3.5" />
          Verification Report
        </button>
      </div>

      {/* Main content display area */}
      <div className="relative h-[420px] overflow-hidden bg-[#0a0a0c]">
        {/* Tab 1: Live Preview (Iframe with Viewport Switching) */}
        {activeTab === 'preview' && (
          <div className="flex h-full w-full flex-col overflow-auto">
            {isExternalUrl && (
              <div className="flex items-center justify-between border-b border-border/80 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-300">
                <div className="flex items-center gap-1.5">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                  <span>External websites often block iframe embedding (X-Frame-Options: DENY).</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveTab('video')}
                    className="rounded bg-amber-500/20 px-2 py-0.5 text-[11px] font-medium text-amber-200 hover:bg-amber-500/30"
                  >
                    Watch Full Recording
                  </button>
                  <a
                    href={src || '#'}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-300 hover:bg-zinc-700"
                  >
                    Open Live
                  </a>
                </div>
              </div>
            )}
            <div className="flex flex-1 items-center justify-center p-2">
              {src ? (
                <div
                  className={cn(
                    'h-full transition-all duration-300',
                    viewport === 'desktop' && 'w-full',
                    viewport === 'tablet' && 'w-[768px] rounded-lg border border-zinc-700/60 shadow-2xl overflow-hidden',
                    viewport === 'mobile' && 'w-[375px] rounded-2xl border-4 border-zinc-700/80 shadow-2xl overflow-hidden'
                  )}
                >
                  <iframe
                    key={`${nonce}-${viewport}`}
                    src={src}
                    title="live preview"
                    className="h-full w-full border-0 bg-white"
                    sandbox="allow-scripts allow-same-origin allow-forms"
                  />
                </div>
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-center p-6">
                  <MonitorPlay className="h-9 w-9 text-zinc-700" />
                  <p className="text-sm text-zinc-400">Live preview unavailable</p>
                  <p className="max-w-sm text-xs leading-relaxed text-zinc-600">
                    Target site may be closed or proxy disconnected. Check the Session Video or Screenshots tab above for captured verification evidence.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab 2: Session Video Player */}
        {activeTab === 'video' && (
          <div className="flex h-full flex-col bg-black">
            <div className="flex flex-1 items-center justify-center p-2">
              <video
                controls
                playsInline
                src={videoSrc}
                className="max-h-full max-w-full rounded border border-zinc-800"
              >
                Your browser does not support the video tag.
              </video>
            </div>
            <div className="flex items-center justify-between border-t border-border bg-[#111114] px-3 py-1.5 text-xs text-zinc-400">
              <span className="flex items-center gap-1.5 font-mono text-[11px]">
                <VideoIcon className="h-3.5 w-3.5 text-emerald-400" />
                Playwright Full Browser Session (.webm)
              </span>
              <a
                href={videoSrc}
                download={`run-${run.number}-session.webm`}
                className="inline-flex items-center gap-1 rounded bg-zinc-800 px-2.5 py-1 text-[11px] text-zinc-200 hover:bg-zinc-700"
              >
                <Download className="h-3 w-3" />
                Download Recording
              </a>
            </div>
          </div>
        )}

        {/* Tab 3: Screenshot Gallery */}
        {activeTab === 'screenshots' && (
          <div className="flex h-full flex-col">
            {screenshots.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                <Camera className="h-9 w-9 text-zinc-700" />
                <p className="text-sm text-zinc-400">No screenshots captured yet</p>
                <p className="text-xs text-zinc-600">Screenshots are captured automatically during verification.</p>
              </div>
            ) : (
              <div className="flex h-full flex-col">
                {/* Large Preview */}
                <div className="flex flex-1 items-center justify-center overflow-auto bg-[#050507] p-2">
                  {currentScreenshot ? (
                    <img
                      src={currentScreenshot}
                      alt="Verification screenshot"
                      className="max-h-full max-w-full object-contain rounded shadow-lg"
                    />
                  ) : (
                    <p className="text-xs text-zinc-500">Select a screenshot below</p>
                  )}
                </div>

                {/* Thumbnails strip */}
                <div className="flex items-center gap-2 overflow-x-auto border-t border-border bg-[#111114] p-2">
                  {screenshots.map((s, idx) => {
                    const active = currentScreenshot === s.content
                    return (
                      <button
                        key={s.id || idx}
                        type="button"
                        onClick={() => setSelectedScreenshot(s.content || null)}
                        className={cn(
                          'flex shrink-0 items-center gap-2 rounded border px-2 py-1 text-left text-xs transition-all',
                          active
                            ? 'border-emerald-500 bg-emerald-500/10 text-emerald-300'
                            : 'border-border bg-zinc-900 text-zinc-400 hover:bg-zinc-800'
                        )}
                      >
                        <Camera className="h-3.5 w-3.5 shrink-0" />
                        <span className="max-w-[150px] truncate text-[11px] font-medium">{s.label}</span>
                      </button>
                    )
                  })}
                  {currentScreenshot && (
                    <a
                      href={currentScreenshot}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-auto inline-flex items-center gap-1 rounded bg-zinc-800 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-700"
                    >
                      <Maximize2 className="h-3 w-3" />
                      Full Size
                    </a>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab 4: Interactive HTML Report */}
        {activeTab === 'report' && (
          <div className="h-full w-full">
            <iframe
              src={reportUrl}
              title="Verification Report"
              className="h-full w-full border-0 bg-white"
            />
          </div>
        )}
      </div>

      {run.previewUrl && /^https?:\/\//.test(run.previewUrl) && (
        <div className="flex items-center justify-between border-t border-border px-3 py-1.5 text-xs">
          <Mono className="text-[11px] text-emerald-400">{run.previewUrl}</Mono>
          <span className="text-[11px] text-zinc-500">
            {run.session?.engine === 'playwright' ? 'Playwright Automated Browser' : 'Proxy Tunnel'}
          </span>
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
    <Panel
      title="Verification activity"
      bodyClass="p-0"
      right={
        session ? (
          <Mono className="text-[10px] text-zinc-500">
            {session.engine}
            {session.engineMode ? ` · ${session.engineMode}` : ''}
          </Mono>
        ) : null
      }
    >
      <div className="max-h-[420px] overflow-y-auto">
        {steps.length === 0 ? (
          <p className="px-4 py-8 text-center text-xs text-muted-foreground">
            Verification steps appear here once the engine starts.
          </p>
        ) : (
          <ul className="divide-y divide-border/60">
            {steps.map((step, i) => (
              <li
                key={step.id ? `${step.id}-${step.index ?? i}` : `step-${step.index ?? i}`}
                className="flex items-start gap-2.5 px-3.5 py-2.5"
              >
                <span className="mt-0.5">
                  <StepIcon status={step.status} />
                </span>
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      'text-xs font-medium',
                      step.status === 'failed' ? 'text-red-300' : 'text-zinc-200'
                    )}
                  >
                    {step.name}
                  </p>
                  {step.detail && (
                    <p className="mt-0.5 break-words text-[11px] leading-relaxed text-muted-foreground">
                      {step.detail}
                    </p>
                  )}
                </div>
                {step.durationMs != null && (
                  <span className="mt-0.5 shrink-0 font-mono text-[10px] text-zinc-600">
                    {Math.round(step.durationMs)}ms
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {session?.summary && (
          <div
            className={cn(
              'border-t px-3.5 py-2.5 text-xs leading-relaxed',
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
// Evidence List with Rich Visual Renderers
// ---------------------------------------------------------------------------

function EvidenceList({ evidence, runId }: { evidence: Evidence[]; runId: string }) {
  const [openId, setOpenId] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  if (!evidence.length) {
    return (
      <p className="px-4 py-8 text-center text-xs text-muted-foreground">
        Evidence (screenshots, session recording, HTML reports) is collected during verification.
      </p>
    )
  }

  const copyContent = (text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
    toast.success('Copied to clipboard')
  }

  return (
    <ul className="divide-y divide-border/60">
      {evidence.map((ev, i) => {
        const isOpen = openId === ev.id
        const isImage = ev.kind === 'screenshot' || ev.mimeType?.startsWith('image/')
        const isVideo = ev.kind === 'video' || ev.mimeType?.startsWith('video/')
        const isHtmlReport = ev.kind === 'report-html'
        const isJsonReport = ev.kind === 'report-json'

        return (
          <li key={ev.id ? `${ev.id}-${i}` : `evidence-${i}`}>
            <button
              className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-zinc-900/60"
              onClick={() => setOpenId((v) => (v === ev.id ? null : ev.id))}
            >
              {isOpen ? (
                <ChevronDown className="h-3.5 w-3.5 text-zinc-500" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 text-zinc-500" />
              )}
              {isImage ? (
                <Camera className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
              ) : isVideo ? (
                <VideoIcon className="h-3.5 w-3.5 shrink-0 text-sky-400" />
              ) : isHtmlReport || isJsonReport ? (
                <FileText className="h-3.5 w-3.5 shrink-0 text-amber-400" />
              ) : (
                <Paperclip className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium text-zinc-200">{ev.label}</span>
                <span className="text-[11px] text-zinc-500">
                  {ev.kind} {ev.size ? `· ${fmtBytes(ev.size)}` : ''}
                </span>
              </span>
            </button>

            {isOpen && (
              <div className="border-t border-border bg-[#0a0a0c] p-3 text-xs">
                {isImage && ev.content && (
                  <div className="space-y-2">
                    <img
                      src={ev.content}
                      alt={ev.label}
                      className="max-h-[260px] max-w-full rounded border border-border object-contain mx-auto"
                    />
                    <div className="flex justify-end">
                      <a
                        href={ev.content}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 rounded bg-zinc-800 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-700"
                      >
                        <ExternalLink className="h-3 w-3" />
                        Open Original Image
                      </a>
                    </div>
                  </div>
                )}

                {isVideo && (
                  <div className="space-y-2">
                    <video
                      controls
                      src={ev.content || `/api/v1/runs/${runId}/artifacts/videos/session.webm`}
                      className="w-full rounded border border-border"
                    />
                    <div className="flex justify-end">
                      <a
                        href={ev.content || `/api/v1/runs/${runId}/artifacts/videos/session.webm`}
                        download="session.webm"
                        className="inline-flex items-center gap-1 rounded bg-zinc-800 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-700"
                      >
                        <Download className="h-3 w-3" />
                        Download Video
                      </a>
                    </div>
                  </div>
                )}

                {isHtmlReport && (
                  <div className="flex items-center justify-between rounded border border-border bg-zinc-900/60 p-3">
                    <div>
                      <p className="font-medium text-zinc-200">Interactive Verification Report (HTML)</p>
                      <p className="text-[11px] text-zinc-500">Standalone report with findings, timings, and console logs</p>
                    </div>
                    <a
                      href={`/api/v1/runs/${runId}/report?format=html`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Open Report
                    </a>
                  </div>
                )}

                {isJsonReport && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[11px] text-zinc-400">report.json</span>
                      <a
                        href={`/api/v1/runs/${runId}/report?format=json`}
                        download="report.json"
                        className="inline-flex items-center gap-1 rounded bg-zinc-800 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-700"
                      >
                        <Download className="h-3 w-3" />
                        Download JSON
                      </a>
                    </div>
                  </div>
                )}

                {!isImage && !isVideo && !isHtmlReport && !isJsonReport && ev.content && (
                  <div className="relative">
                    <button
                      onClick={() => copyContent(ev.content || '', ev.id)}
                      className="absolute right-2 top-2 rounded bg-zinc-800 p-1 text-zinc-400 hover:text-zinc-200"
                      title="Copy content"
                    >
                      {copiedId === ev.id ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                    <pre className="max-h-[240px] overflow-auto rounded bg-zinc-950 p-2.5 font-mono text-[11px] leading-relaxed text-zinc-300">
                      {ev.content}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// Main Page
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
        <div className="mx-auto max-w-3xl px-6 py-6">
          <ErrorNote error={error || 'run not found'} />
        </div>
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
        <div className="flex items-center gap-2">
          {run.status === 'COMPLETED' && (
            <>
              <a
                href={`/api/v1/runs/${run.id}/report?format=html`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20"
              >
                <FileText className="h-3.5 w-3.5" />
                HTML Report
              </a>
              <a
                href={`/api/v1/runs/${run.id}/report?format=json`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-zinc-800 px-3 text-xs font-medium text-zinc-300 hover:bg-zinc-700"
              >
                <Download className="h-3.5 w-3.5" />
                JSON
              </a>
            </>
          )}

          {active && (
            <Button
              size="sm"
              variant="outline"
              onClick={cancel}
              disabled={cancelling}
              className="h-8 gap-1.5 border-red-500/40 text-xs text-red-300 hover:bg-red-500/10"
            >
              <Square className="h-3 w-3" />
              Cancel
            </Button>
          )}

          <StatusBadge status={run.status} />
        </div>
      }
    >
      <div className="mx-auto max-w-7xl space-y-4 px-6 py-5">
        {/* Meta strip */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-border bg-[#111114] px-4 py-3 text-xs text-zinc-400">
          <span>
            trigger <Mono className="text-zinc-200">{run.trigger}</Mono>
          </span>
          {run.session?.engine && (
            <span>
              engine <Mono className="text-emerald-400">{run.session.engine}</Mono>
            </span>
          )}
          {run.branch && (
            <span>
              branch <Mono className="text-zinc-200">{run.branch}</Mono>
            </span>
          )}
          {run.commitSha && (
            <span>
              commit <Mono className="text-zinc-200">{run.commitSha.slice(0, 7)}</Mono>
            </span>
          )}
          <span>
            runner <Mono className="text-zinc-200">{run.runnerMode || '—'}</Mono>
          </span>
          <span>
            duration <Mono className="text-zinc-200">{fmtDuration(run.durationMs)}</Mono>
          </span>
          <span>
            started <Mono className="text-zinc-200">{fmtRelative(run.startedAt || run.createdAt)}</Mono>
          </span>
          {run.tunnelProvider && (
            <span>
              tunnel <Mono className="text-zinc-200">{run.tunnelProvider === 'ngrok' ? 'ngrok' : 'internal proxy'}</Mono>
            </span>
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
            <Terminal key={run.id} runId={run.id} active={active} />
          </div>
          <Panel
            title={`Evidence (${run.evidence?.length || 0})`}
            bodyClass="p-0"
            right={<ScanEye className="h-3.5 w-3.5 text-zinc-600" />}
          >
            <div className="max-h-[300px] overflow-y-auto">
              <EvidenceList evidence={run.evidence || []} runId={run.id} />
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
