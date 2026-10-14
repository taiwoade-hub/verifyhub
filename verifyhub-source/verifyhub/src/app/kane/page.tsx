'use client'

// VerifyHub — Kane view. The verification engine control room: live sessions
// on top, most recent verifications underneath.

import Link from 'next/link'
import { ScanEye, ArrowRight } from 'lucide-react'
import { Shell } from '@/components/verifyhub/shell'
import { Loading, ErrorNote, Empty, Panel, StatusBadge, ResultBadge, StepIcon, Mono } from '@/components/verifyhub/bits'
import { useApi, fmtDuration, fmtRelative, type Run } from '@/lib/vh-api'

function SessionCard({ run }: { run: Run }) {
  const steps = run.session?.steps || []
  const passed = steps.filter((s) => s.status === 'passed').length
  return (
    <Link
      href={`/runs/${run.id}`}
      className="group block rounded-lg border border-sky-500/25 bg-sky-500/5 p-4 transition-colors hover:border-sky-400/50"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-sky-400" />
          </span>
          <p className="truncate text-sm font-medium">
            {run.project?.name} <Mono className="text-xs text-sky-300">#{run.number}</Mono>
          </p>
        </div>
        <StatusBadge status={run.status} />
      </div>
      <p className="mt-2 line-clamp-1 text-xs text-muted-foreground">
        {run.previewUrl ? `target: ${run.previewUrl}` : 'target pending…'}
      </p>
      <p className="mt-1 text-[11px] text-zinc-500">
        {steps.length ? `${passed}/${steps.length} checks passed` : 'waiting for engine'}
        {run.session?.engine ? ` · ${run.session.engine}` : ''}
      </p>
      <span className="mt-2 inline-flex items-center gap-1 text-xs text-sky-300 group-hover:underline">
        Watch live <ArrowRight className="h-3 w-3" />
      </span>
    </Link>
  )
}

function KaneInner() {
  const active = useApi<{ runs: Run[] }>('/api/v1/runs?status=active', 2500)
  const recent = useApi<{ runs: Run[] }>('/api/v1/runs?limit=50', 6000)

  const verified = (recent.data?.runs || []).filter(
    (r) => r.status === 'COMPLETED' && (r.session || r.checksTotal > 0)
  )

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-6 py-6">
      <section className="flex items-start gap-4 rounded-lg border border-border bg-gradient-to-b from-[#141419] to-[#111114] px-5 py-4">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-emerald-500/15 text-emerald-400">
          <ScanEye className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-base font-semibold">Kane verification engine</h2>
          <p className="mt-0.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Kane is one engine in the VerifyHub abstraction. When the Kane CLI is present it drives a real
            browser; otherwise the built-in HTTP probe engine performs genuine checks and says so honestly.
            Engine choice is per project via <Mono className="text-emerald-400">.verifyhub.yml</Mono>.
          </p>
        </div>
      </section>

      {active.error && <ErrorNote error={active.error} />}
      {active.loading && !active.data && <Loading />}

      {/* Live sessions */}
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">Live sessions</h3>
        {active.data && active.data.runs.length === 0 ? (
          <Empty
            icon={<ScanEye className="h-8 w-8" />}
            title="No active verification right now"
            hint="Start a run from any project and Kane's session will appear here, live."
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {active.data?.runs.map((run) => <SessionCard key={run.id} run={run} />)}
          </div>
        )}
      </section>

      {/* Recent verifications */}
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">Recent verifications</h3>
        {verified.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-xs text-muted-foreground">
            Finished verifications land here with their steps, result and evidence.
          </p>
        ) : (
          <div className="space-y-2">
            {verified.slice(0, 12).map((run) => (
              <Link
                key={run.id}
                href={`/runs/${run.id}`}
                className="group flex items-center gap-3 rounded-lg border border-border bg-[#111114] px-4 py-2.5 transition-colors hover:border-zinc-600"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">
                    <span className="font-mono text-xs text-emerald-400">#{run.number}</span>{' '}
                    <span className="font-medium">{run.project?.name}</span>
                  </p>
                  <p className="truncate text-[11px] text-zinc-500">
                    {run.session?.engine || 'engine'}
                    {run.session?.durationMs ? ` · ${fmtDuration(run.session.durationMs)}` : ''}
                    {` · ${fmtRelative(run.createdAt)}`}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  {(run.session?.steps || []).slice(0, 5).map((s) => (
                    <span key={s.id} title={s.name}><StepIcon status={s.status} /></span>
                  ))}
                </div>
                <ResultBadge result={run.result} checksPassed={run.checksPassed} checksTotal={run.checksTotal} />
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

export default function KanePage() {
  return (
    <Shell title="Kane" subtitle="verification engine sessions">
      <KaneInner />
    </Shell>
  )
}
