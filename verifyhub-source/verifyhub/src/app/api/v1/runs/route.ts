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

export async function POST(req: NextRequest) {
  try {
    ensureScheduler()
    const body = (await req.json().catch(() => ({}))) as {
      projectId?: string
      url?: string
      name?: string
      engine?: string
      browser?: string
      recordVideo?: boolean
      instructions?: string[]
      branch?: string
      commitSha?: string
    }

    let projectId = body.projectId
    if (!projectId && body.url) {
      let raw = body.url.trim()
      if (raw && !/^https?:\/\//i.test(raw)) {
        raw = 'https://' + raw
      }
      let parsedUrl: URL
      try {
        parsedUrl = new URL(raw)
      } catch {
        return NextResponse.json({ error: 'invalid URL' }, { status: 400 })
      }
      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        return NextResponse.json({ error: 'URL must use http or https' }, { status: 400 })
      }
      const host = parsedUrl.hostname
      if (/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.)/.test(host) || host === '::1') {
        return NextResponse.json(
          { error: 'internal addresses are not allowed for live URL verification' },
          { status: 400 }
        )
      }

      // Check if project already exists for this URL
      let project = await db.project.findFirst({
        where: { sourceType: 'url', sourceUrl: parsedUrl.toString() },
      })
      if (!project) {
        project = await db.project.create({
          data: {
            name: body.name?.trim() || parsedUrl.hostname,
            sourceType: 'url',
            sourceUrl: parsedUrl.toString(),
            config: `version: 1\nverification:\n  engine: ${body.engine || 'playwright'}\n  browser: ${body.browser || 'firefox'}\n  recordVideo: ${body.recordVideo !== false}\n`,
          },
        })
      }
      projectId = project.id
    }

    if (!projectId) {
      return NextResponse.json({ error: 'either projectId or url is required' }, { status: 400 })
    }

    const { createRun } = await import('@/server/verifyhub/orchestrator')
    const run = await createRun(projectId, {
      trigger: 'api',
      branch: body.branch,
      commitSha: body.commitSha,
      engine: body.engine,
      browser: body.browser,
      recordVideo: body.recordVideo,
      instructions: body.instructions,
    })

    return NextResponse.json({ run, projectId }, { status: 201 })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}

