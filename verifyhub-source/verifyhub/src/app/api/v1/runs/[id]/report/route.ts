// VerifyHub API — /api/v1/runs/[id]/report
// Returns the structured verification report in JSON or HTML format.

import { NextRequest, NextResponse } from 'next/server'
import * as path from 'path'
import * as fs from 'fs'
import * as store from '@/server/verifyhub/store'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: runId } = await params
  const format = req.nextUrl.searchParams.get('format') || 'json'
  const reportsDir = path.join(store.runEvidenceDir(runId), 'reports')

  if (format === 'html') {
    const htmlPath = path.join(reportsDir, 'report.html')
    if (fs.existsSync(htmlPath)) {
      const htmlContent = fs.readFileSync(htmlPath, 'utf8')
      return new NextResponse(htmlContent, {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Disposition': `inline; filename="verifyhub-report-${runId.slice(0, 8)}.html"`,
        },
      })
    }
  }

  // JSON format
  const jsonPath = path.join(reportsDir, 'report.json')
  if (fs.existsSync(jsonPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
      return NextResponse.json(data)
    } catch {}
  }

  // Fallback to synthesizing from database records
  const run = await db.run.findUnique({
    where: { id: runId },
    include: {
      session: { include: { steps: { orderBy: { index: 'asc' } } } },
      evidence: { orderBy: { createdAt: 'asc' } },
      events: { orderBy: { createdAt: 'asc' } },
    },
  })

  if (!run) {
    return NextResponse.json({ error: 'run not found' }, { status: 404 })
  }

  return NextResponse.json({
    runId: run.id,
    number: run.number,
    status: run.status,
    result: run.result,
    checksPassed: run.checksPassed,
    checksTotal: run.checksTotal,
    durationMs: run.durationMs,
    previewUrl: run.previewUrl,
    session: run.session,
    evidence: run.evidence,
    events: run.events,
  })
}
