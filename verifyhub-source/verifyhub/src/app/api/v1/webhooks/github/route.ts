// VerifyHub API — /api/v1/webhooks/github
// Receives GitHub push events, verifies the HMAC signature, and creates an
// automatic verification run for the matching project.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { verifyGithubSignature, githubWebhookSecret } from '@/server/verifyhub/integrations'
import { createRun } from '@/server/verifyhub/orchestrator'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const raw = await req.text()
  const signature = req.headers.get('x-hub-signature-256')
  const event = req.headers.get('x-github-event') || 'unknown'
  const secret = githubWebhookSecret()

  const signatureValid = verifyGithubSignature(raw, signature, secret)
  let payload: {
    repository?: { full_name?: string }
    after?: string
    ref?: string
    action?: string
    pull_request?: { head?: { sha?: string; ref?: string }; base?: { ref?: string } }
  } | null = null
  try {
    payload = JSON.parse(raw)
  } catch {
    /* ignore */
  }

  const delivery = await db.webhookDelivery.create({
    data: {
      source: 'github',
      event,
      signatureValid,
      payload: raw.slice(0, 20_000),
    },
  })

  if (!signatureValid) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
  }

  const repoFullName = payload?.repository?.full_name
  if (!repoFullName) {
    return NextResponse.json({ ok: true, note: 'no repository in payload' })
  }

  const project = await db.project.findFirst({ where: { gitRepo: repoFullName } })
  if (!project) {
    return NextResponse.json({ ok: true, note: `no VerifyHub project tracks ${repoFullName}` })
  }

  if (event === 'push') {
    const branch = (payload?.ref || '').replace('refs/heads/', '') || project.gitBranch || 'main'
    const run = await createRun(project.id, {
      trigger: 'webhook',
      branch,
      commitSha: payload?.after || undefined,
    })
    await db.webhookDelivery.update({ where: { id: delivery.id }, data: { handled: true } })
    return NextResponse.json({ ok: true, runId: run.id, runNumber: run.number })
  }

  if (event === 'pull_request' && ['opened', 'synchronize', 'reopened'].includes(payload?.action || '')) {
    const run = await createRun(project.id, {
      trigger: 'webhook',
      branch: payload?.pull_request?.head?.ref || project.gitBranch || 'main',
      commitSha: payload?.pull_request?.head?.sha || undefined,
    })
    await db.webhookDelivery.update({ where: { id: delivery.id }, data: { handled: true } })
    return NextResponse.json({ ok: true, runId: run.id, runNumber: run.number })
  }

  return NextResponse.json({ ok: true, note: `event ${event} ignored` })
}
