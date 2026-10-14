// VerifyHub API — /api/v1/projects/[id]/file?path=src/main.py — read a file

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import * as store from '@/server/verifyhub/store'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const rel = req.nextUrl.searchParams.get('path')
  if (!rel) return NextResponse.json({ error: 'path query parameter required' }, { status: 400 })
  const project = await db.project.findUnique({ where: { id } })
  if (!project) return NextResponse.json({ error: 'project not found' }, { status: 404 })
  if (project.sourceType === 'url') {
    return NextResponse.json({ error: 'live URL projects have no files' }, { status: 400 })
  }
  const dir = store.projectDir(id)
  const file = store.readFileIn(dir, rel)
  if (!file) return NextResponse.json({ error: 'file not found' }, { status: 404 })
  return NextResponse.json({ path: rel, content: file.content, size: file.size })
}
