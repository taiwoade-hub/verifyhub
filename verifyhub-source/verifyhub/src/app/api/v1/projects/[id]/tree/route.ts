// VerifyHub API — /api/v1/projects/[id]/tree — file explorer tree

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import * as store from '@/server/verifyhub/store'
import * as fs from 'fs'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const project = await db.project.findUnique({ where: { id } })
  if (!project) return NextResponse.json({ error: 'project not found' }, { status: 404 })
  if (!project.localPath && project.sourceType !== 'example' && project.sourceType !== 'github') {
    return NextResponse.json({ tree: [], note: 'live URL projects have no file tree' })
  }
  const dir = store.projectDir(id)
  if (!fs.existsSync(dir)) {
    return NextResponse.json({ tree: [], note: 'source will be available after the first run clones/downloads it' })
  }
  return NextResponse.json({ tree: store.buildTree(dir) })
}
