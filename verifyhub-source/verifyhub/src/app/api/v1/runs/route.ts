// VerifyHub API — /api/v1/runs — list runs (optionally filtered)

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ensureScheduler } from '@/server/verifyhub/orchestrator'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  ensureScheduler()
  const projectId = req.nextUrl.searchParams.get('projectId') || undefined
  const status = req.nextUrl.searchParams.get('status') || undefined
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') || '50', 10) || 50, 200)

  const runs = await db.run.findMany({
    where: {
      ...(projectId ? { projectId } : {}),
      ...(status === 'active'
        ? { status: { in: ['QUEUED', 'PREPARING', 'CLONING', 'INSTALLING', 'BUILDING', 'STARTING', 'HEALTH_CHECK', 'EXPOSING', 'READY', 'KANE_VERIFYING', 'COLLECTING_EVIDENCE'] } }
        : status
          ? { status }
          : {}),
    },
    include: { project: { select: { id: true, name: true, sourceType: true, detectedFramework: true } } },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
  return NextResponse.json({ runs })
}
