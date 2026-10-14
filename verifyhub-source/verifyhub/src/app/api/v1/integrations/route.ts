// VerifyHub API — /api/v1/integrations
// GET   statuses of every integration (docker, node, python, kane, ngrok, github, telegram)
// PATCH preferences (notification toggles)

import { NextRequest, NextResponse } from 'next/server'
import { integrationStatuses, getPreferences, savePreferences, getNgrok, saveNgrok } from '@/server/verifyhub/integrations'

export const dynamic = 'force-dynamic'

export async function GET() {
  const statuses = await integrationStatuses()
  const prefs = await getPreferences()
  const ngrok = await getNgrok()
  return NextResponse.json({
    statuses,
    preferences: prefs.config,
    ngrok: { configured: Boolean(ngrok.config.authToken || process.env.NGROK_AUTHTOKEN), domain: ngrok.config.domain || null },
  })
}

export async function PATCH(req: NextRequest) {
  const body = (await req.json()) as {
    preferences?: { notifyOnStart?: boolean; notifyOnReady?: boolean; notifyOnComplete?: boolean }
    ngrok?: { authToken?: string; domain?: string }
  }
  if (body.preferences) {
    const current = await getPreferences()
    await savePreferences({ ...current.config, ...body.preferences })
  }
  if (body.ngrok) {
    const current = await getNgrok()
    const authToken = body.ngrok.authToken !== undefined ? body.ngrok.authToken : current.config.authToken
    const domain = body.ngrok.domain !== undefined ? body.ngrok.domain : current.config.domain
    await saveNgrok({ authToken, domain }, Boolean(authToken))
  }
  const statuses = await integrationStatuses()
  const prefs = await getPreferences()
  return NextResponse.json({ ok: true, statuses, preferences: prefs.config })
}
