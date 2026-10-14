// VerifyHub API — /api/v1/runs/[id]/logs?since=<seq> — polled log tail

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const since = parseInt(req.nextUrl.searchParams.get('since') || '0', 10) || 0
  const logs = await db.runLog.findMany({
    where: { runId: id, seq: { gt: since } },
    orderBy: { seq: 'asc' },
    take: 500,
  })
  return NextResponse.json({ logs })
}
