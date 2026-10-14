// VerifyHub API — /api/v1/projects/[id]/runs
// POST start a new verification run for a project

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { createRun, ensureScheduler } from '@/server/verifyhub/orchestrator'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const project = await db.project.findUnique({ where: { id } })
  if (!project) return NextResponse.json({ error: 'project not found' }, { status: 404 })

  const body = (await req.json().catch(() => ({}))) as { branch?: string; commitSha?: string }

  // refuse to stack more than 2 concurrent active runs per project
  const active = await db.run.count({
    where: { projectId: id, status: { in: ['QUEUED', 'PREPARING', 'CLONING', 'INSTALLING', 'BUILDING', 'STARTING', 'HEALTH_CHECK', 'EXPOSING', 'READY', 'KANE_VERIFYING', 'COLLECTING_EVIDENCE'] } },
  })
  if (active >= 2) {
    return NextResponse.json(
      { error: 'this project already has 2 runs in progress — wait or cancel one first' },
      { status: 429 }
    )
  }

  ensureScheduler()
  const run = await createRun(id, { trigger: 'manual', branch: body.branch, commitSha: body.commitSha })
  return NextResponse.json({ run }, { status: 201 })
}
