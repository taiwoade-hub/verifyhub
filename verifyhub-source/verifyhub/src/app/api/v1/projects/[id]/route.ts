// VerifyHub API — /api/v1/projects/[id]
// GET    detail (project + recent runs)
// PATCH  rename / update config
// DELETE remove project + workspace

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import * as store from '@/server/verifyhub/store'
import * as path from 'path'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const project = await db.project.findUnique({
    where: { id },
    include: { runs: { orderBy: { createdAt: 'desc' }, take: 10 } },
  })
  if (!project) return NextResponse.json({ error: 'project not found' }, { status: 404 })
  return NextResponse.json({ project })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = (await req.json()) as { name?: string; config?: string | null; gitBranch?: string }
  const data: Record<string, unknown> = {}
  if (body.name !== undefined) data.name = body.name
  if (body.config !== undefined) data.config = body.config
  if (body.gitBranch !== undefined) data.gitBranch = body.gitBranch
  const project = await db.project.update({ where: { id }, data })
  return NextResponse.json({ project })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await db.project.delete({ where: { id } })
  store.rmdir(path.join(store.PROJECTS_DIR, id))
  return NextResponse.json({ ok: true })
}
