// VerifyHub API — /api/v1/projects/[id]/config — .verifyhub.yml
// GET  returns raw + parsed config
// PUT  validates and saves a new .verifyhub.yml

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { parseConfig, SAMPLE_CONFIG_YML } from '@/server/verifyhub/config'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const project = await db.project.findUnique({ where: { id } })
  if (!project) return NextResponse.json({ error: 'project not found' }, { status: 404 })
  const raw = project.config
  const config = parseConfig(raw)
  return NextResponse.json({ raw: raw || SAMPLE_CONFIG_YML, config, isDefault: !raw })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = (await req.json()) as { config: string }
  try {
    const parsed = parseConfig(body.config)
    if (!parsed.verification?.instructions?.length) {
      return NextResponse.json({ error: 'config must contain at least one verification instruction' }, { status: 400 })
    }
    const project = await db.project.update({ where: { id }, data: { config: body.config } })
    return NextResponse.json({ project })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'invalid YAML' },
      { status: 400 }
    )
  }
}
