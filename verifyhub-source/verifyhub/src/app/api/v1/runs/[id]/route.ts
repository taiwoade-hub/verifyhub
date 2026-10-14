// VerifyHub API — /api/v1/runs/[id] — full run detail for the run page

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const run = await db.run.findUnique({
    where: { id },
    include: {
      project: { select: { id: true, name: true, sourceType: true, sourceUrl: true, gitRepo: true, gitBranch: true, detectedFramework: true, detectedLanguage: true } },
      events: { orderBy: { createdAt: 'asc' }, take: 200 },
      session: { include: { steps: { orderBy: { index: 'asc' } } } },
      evidence: { orderBy: { createdAt: 'asc' } },
    },
  })
  if (!run) return NextResponse.json({ error: 'run not found' }, { status: 404 })
  return NextResponse.json({ run })
}
