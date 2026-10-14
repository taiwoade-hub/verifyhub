// VerifyHub API — /api/v1/schedules — verification schedules

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

const CRON_PRESETS = [
  { label: 'Every 30 minutes', value: '*/30 * * * *' },
  { label: 'Every hour', value: '0 * * * *' },
  { label: 'Daily at 02:00', value: '0 2 * * *' },
  { label: 'Weekly (Mon 09:00)', value: '0 9 * * 1' },
]

export async function GET() {
  const schedules = await db.schedule.findMany({
    include: { project: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json({ schedules, presets: CRON_PRESETS })
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    projectId: string
    name?: string
    cron: string
    branch?: string
    telegram?: boolean
  }
  if (!body.projectId || !body.cron) {
    return NextResponse.json({ error: 'projectId and cron are required' }, { status: 400 })
  }
  const project = await db.project.findUnique({ where: { id: body.projectId } })
  if (!project) return NextResponse.json({ error: 'project not found' }, { status: 404 })

  // basic cron validation: 5 fields or "every Nm/Nh" shorthand
  const e = body.cron.trim().toLowerCase()
  const valid = /^\*\/\d+ \* \* \* \*$/.test(e) || /^[\d*/-]+ [\d*/-]+ [\d*/-]+ [\d*/-]+ [\d*/-]+$/.test(e)
  if (!valid) {
    return NextResponse.json({ error: 'cron must be a 5-field expression (e.g. */30 * * * *)' }, { status: 400 })
  }

  const schedule = await db.schedule.create({
    data: {
      projectId: body.projectId,
      name: body.name?.trim() || `${project.name} · ${body.cron}`,
      cron: body.cron.trim(),
      branch: body.branch || project.gitBranch,
      telegram: body.telegram ?? true,
    },
  })
  return NextResponse.json({ schedule }, { status: 201 })
}
