// VerifyHub API — /api/v1/runs/[id]/cancel

import { NextRequest, NextResponse } from 'next/server'
import { cancelRun } from '@/server/verifyhub/orchestrator'

export const dynamic = 'force-dynamic'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await cancelRun(id)
  return NextResponse.json({ ok: true })
}
