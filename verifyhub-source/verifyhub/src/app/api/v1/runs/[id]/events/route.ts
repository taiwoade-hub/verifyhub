// VerifyHub API — /api/v1/runs/[id]/events — verification timeline

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const events = await db.runEvent.findMany({
    where: { runId: id },
    orderBy: { createdAt: 'asc' },
    take: 300,
  })
  return NextResponse.json({ events })
}
