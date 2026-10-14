// VerifyHub API — /api/v1/dashboard — KPI stats for the dashboard view

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ensureScheduler } from '@/server/verifyhub/orchestrator'

export const dynamic = 'force-dynamic'

const ACTIVE = [
  'QUEUED', 'PREPARING', 'CLONING', 'INSTALLING', 'BUILDING',
  'STARTING', 'HEALTH_CHECK', 'EXPOSING', 'READY', 'KANE_VERIFYING', 'COLLECTING_EVIDENCE',
]

export async function GET() {
  ensureScheduler()
  const [totalProjects, totalRuns, activeRuns, failedRuns, completedRuns, schedules] = await Promise.all([
    db.project.count(),
    db.run.count(),
    db.run.count({ where: { status: { in: ACTIVE } } }),
    db.run.count({ where: { status: 'FAILED' } }),
    db.run.count({ where: { result: 'passed' } }),
    db.schedule.count({ where: { enabled: true } }),
  ])

  const recentRuns = await db.run.findMany({
    include: { project: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 8,
  })

  // success rate over finished runs
  const finished = await db.run.count({ where: { status: { in: ['COMPLETED', 'FAILED', 'CANCELLED', 'TIMEOUT'] } } })
  const successRate = finished > 0 ? Math.round((completedRuns / finished) * 100) : null

  // runs per day for the last 14 days (sparkline data)
  const since = new Date(Date.now() - 13 * 24 * 3600 * 1000)
  since.setHours(0, 0, 0, 0)
  const runs = await db.run.findMany({
    where: { createdAt: { gte: since } },
    select: { createdAt: true, result: true, status: true },
  })
  const perDay: { date: string; total: number; passed: number; failed: number }[] = []
  for (let i = 0; i < 14; i++) {
    const dayStart = new Date(since.getTime() + i * 24 * 3600 * 1000)
    const dayEnd = new Date(dayStart.getTime() + 24 * 3600 * 1000)
    const inDay = runs.filter((r) => r.createdAt >= dayStart && r.createdAt < dayEnd)
    perDay.push({
      date: dayStart.toISOString().slice(5, 10),
      total: inDay.length,
      passed: inDay.filter((r) => r.result === 'passed').length,
      failed: inDay.filter((r) => r.result && r.result !== 'passed').length,
    })
  }

  return NextResponse.json({
    totalProjects,
    totalRuns,
    activeRuns,
    failedRuns,
    successRate,
    scheduledProjects: schedules,
    recentRuns,
    perDay,
  })
}
