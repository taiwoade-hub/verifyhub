// VerifyHub API — /api/v1/github/connect — store a GitHub PAT

import { NextRequest, NextResponse } from 'next/server'
import { getGithub, saveGithub } from '@/server/verifyhub/integrations'

export const dynamic = 'force-dynamic'

export async function GET() {
  const { connected, config } = await getGithub()
  return NextResponse.json({
    connected,
    username: config.username || null,
    hasToken: Boolean(config.token),
  })
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { token?: string; disconnect?: boolean }
  if (body.disconnect) {
    await saveGithub({ webhookSecret: undefined }, false)
    const { config } = await getGithub()
    await saveGithub({ webhookSecret: config.webhookSecret }, false)
    return NextResponse.json({ ok: true, connected: false })
  }
  const token = (body.token || '').trim()
  if (!token) return NextResponse.json({ error: 'token required' }, { status: 400 })

  // validate token against GitHub
  try {
    const res = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'VerifyHub/1.0' },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) {
      return NextResponse.json({ error: `GitHub rejected the token (HTTP ${res.status})` }, { status: 400 })
    }
    const user = (await res.json()) as { login: string }
    const { config } = await getGithub()
    await saveGithub({ ...config, token, username: user.login }, true)
    return NextResponse.json({ ok: true, connected: true, username: user.login })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'could not reach GitHub' },
      { status: 502 }
    )
  }
}
