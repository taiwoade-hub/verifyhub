// VerifyHub API — /api/v1/telegram/connect — bot token + chat id

import { NextRequest, NextResponse } from 'next/server'
import { getTelegram, saveTelegram, telegramMe } from '@/server/verifyhub/integrations'

export const dynamic = 'force-dynamic'

export async function GET() {
  const { connected, config } = await getTelegram()
  return NextResponse.json({
    connected,
    chatId: config.chatId || null,
    hasToken: Boolean(config.botToken || process.env.TELEGRAM_BOT_TOKEN),
  })
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { botToken?: string; chatId?: string; disconnect?: boolean }
  if (body.disconnect) {
    await saveTelegram({}, false)
    return NextResponse.json({ ok: true, connected: false })
  }
  const { config } = await getTelegram()
  const botToken = (body.botToken || config.botToken || '').trim()
  const chatId = (body.chatId ?? config.chatId ?? '').trim()
  if (!botToken) return NextResponse.json({ error: 'bot token required' }, { status: 400 })

  // validate token via getMe
  try {
    const prev = { ...config }
    await saveTelegram({ ...prev, botToken, chatId }, false)
    const me = await telegramMe()
    if (!me.ok) {
      await saveTelegram(prev, false)
      return NextResponse.json({ error: me.error }, { status: 400 })
    }
    if (!chatId) {
      return NextResponse.json({ ok: true, username: me.username, needsChatId: true })
    }
    await saveTelegram({ botToken, chatId }, true)
    return NextResponse.json({ ok: true, connected: true, username: me.username })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'could not reach Telegram' },
      { status: 502 }
    )
  }
}
