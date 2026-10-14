// VerifyHub API — /api/v1/schedules/[id] — patch / delete a schedule

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = (await req.json()) as { enabled?: boolean; cron?: string; name?: string; telegram?: boolean }
  const data: Record<string, unknown> = {}
  if (body.enabled !== undefined) data.enabled = body.enabled
  if (body.cron !== undefined) data.cron = body.cron
  if (body.name !== undefined) data.name = body.name
  if (body.telegram !== undefined) data.telegram = body.telegram
  const schedule = await db.schedule.update({ where: { id }, data })
  return NextResponse.json({ schedule })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await db.schedule.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
