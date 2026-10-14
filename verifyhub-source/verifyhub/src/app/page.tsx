'use client'

// VerifyHub — Dashboard. KPIs, 14-day verification activity, recent runs.

import Link from 'next/link'
import {
  FolderGit2,
  Activity,
  ShieldCheck,
  CircleX,
  Clock3,
  ArrowRight,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from 'recharts'
import { Shell } from '@/components/verifyhub/shell'
import { Panel, Loading, ErrorNote, StatusBadge } from '@/components/verifyhub/bits'
import { RunsTable } from '@/components/verifyhub/runs-table'
import { useShell } from '@/components/verifyhub/shell'
import { useApi, fmtRelative, type DashboardStats } from '@/lib/vh-api'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

function Kpi({ icon: Icon, label, value, tone, hint }: {
  icon: typeof FolderGit2
  label: string
  value: string | number
  tone: string
  hint?: string
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-[#111114] px-4 py-3.5">
      <div className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-lg', tone)}>
        <Icon className="h-4.5 w-4.5" />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="truncate text-xl font-semibold leading-tight">{value}</p>
        {hint && <p className="text-[11px] text-zinc-500">{hint}</p>}
      </div>
    </div>
  )
}

function DashboardInner() {
  const { openNew } = useShell()
  const { data, error, loading } = useApi<DashboardStats>('/api/v1/dashboard', 4000)

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-6 py-6">
      {/* Intro */}
      <section className="rounded-lg border border-border bg-gradient-to-b from-[#141419] to-[#111114] px-6 py-5">
        <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-emerald-400">VerifyHub</p>
        <h2 className="mt-1 text-xl font-semibold tracking-tight">Build it. Run it. Let Kane verify it.</h2>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          VerifyHub turns code into a live application and lets AI verify that it actually works —
          isolated runner, live browser, structured evidence, real results.
        </p>
        <div className="mt-3">
          <Button size="sm" onClick={openNew} className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-500">
            Start a verification <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </section>

      {error && <ErrorNote error={error} />}
      {loading && !data && <Loading />}

      {data && (
        <>
          {/* KPI row */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Kpi icon={FolderGit2} label="Projects" value={data.totalProjects} tone="bg-zinc-800 text-zinc-300" />
            <Kpi icon={Activity} label="Active runs" value={data.activeRuns} tone="bg-sky-500/15 text-sky-300" />
            <Kpi
              icon={ShieldCheck}
              label="Success rate"
              value={data.successRate === null ? '—' : `${data.successRate}%`}
              tone="bg-emerald-500/15 text-emerald-400"
              hint="finished runs"
            />
            <Kpi icon={CircleX} label="Failed runs" value={data.failedRuns} tone="bg-red-500/15 text-red-400" />
            <Kpi icon={Clock3} label="Schedules" value={data.scheduledProjects} tone="bg-amber-500/15 text-amber-400" />
          </div>

          {/* Activity + recent */}
          <div className="grid gap-5 lg:grid-cols-5">
            <Panel title="Verification activity — last 14 days" className="lg:col-span-3">
              <div className="h-[180px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.perDay} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10, fill: '#71717a' }}
                      axisLine={{ stroke: '#27272a' }}
                      tickLine={false}
                      interval={2}
                    />
                    <Tooltip
                      cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                      contentStyle={{
                        background: '#18181b',
                        border: '1px solid #3f3f46',
                        borderRadius: 8,
                        fontSize: 12,
                        color: '#e4e4e7',
                      }}
                    />
                    <Bar dataKey="passed" stackId="a" fill="#10b981" radius={[0, 0, 0, 0]} />
                    <Bar dataKey="failed" stackId="a" fill="#ef4444" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2 flex items-center gap-4 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-emerald-500" /> passed</span>
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-red-500" /> failed</span>
              </div>
            </Panel>

            <Panel title="Recent runs" className="lg:col-span-2" bodyClass="p-0">
              {data.recentRuns.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No runs yet — start your first verification.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {data.recentRuns.slice(0, 7).map((run) => (
                    <li key={run.id}>
                      <Link
                        href={`/runs/${run.id}`}
                        className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-zinc-900/60"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm">
                            <span className="font-mono text-xs text-emerald-400">#{run.number}</span>{' '}
                            {run.project?.name}
                          </p>
                          <p className="text-[11px] text-zinc-500">{fmtRelative(run.createdAt)}</p>
                        </div>
                        <StatusBadge status={run.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          {/* Full recent table */}
          <Panel title="Runs" bodyClass="p-0">
            <RunsTable runs={data.recentRuns} emptyLabel="No verification runs yet." />
            {data.totalRuns > data.recentRuns.length && (
              <div className="border-t border-border px-4 py-2 text-right">
                <Link href="/runs" className="text-xs text-emerald-400 hover:underline">
                  View all {data.totalRuns} runs →
                </Link>
              </div>
            )}
          </Panel>
        </>
      )}
    </div>
  )
}

export default function DashboardPage() {
  return (
    <Shell title="Dashboard" subtitle="overview of everything VerifyHub is verifying">
      <DashboardInner />
    </Shell>
  )
}
