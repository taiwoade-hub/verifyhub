// VerifyHub API — /api/v1/runs/[id]/evidence — evidence gallery

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const evidence = await db.evidence.findMany({
    where: { runId: id },
    orderBy: { createdAt: 'asc' },
  })
  return NextResponse.json({ evidence })
}
