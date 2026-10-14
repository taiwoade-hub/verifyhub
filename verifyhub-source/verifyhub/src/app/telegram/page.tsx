'use client'

// VerifyHub — Telegram integration. Bot token + chat id with validation,
// notification preferences, and a view of recent notification deliveries.

import { useState } from 'react'
import { Send, CheckCircle2, XCircle, MinusCircle, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Shell } from '@/components/verifyhub/shell'
import { Loading, ErrorNote, Panel, Mono } from '@/components/verifyhub/bits'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useApi, apiSend } from '@/lib/vh-api'

interface TelegramState {
  connected: boolean
  chatId: string | null
  hasToken: boolean
}

interface NotificationRow {
  id: string
  kind: string
  title: string
  body: string
  status: string
  error?: string | null
  createdAt: string
}

function StatusDot({ status }: { status: string }) {
  if (status === 'sent') return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
  if (status === 'failed') return <XCircle className="h-3.5 w-3.5 text-red-400" />
  if (status === 'skipped') return <MinusCircle className="h-3.5 w-3.5 text-zinc-500" />
  return <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-500" />
}

function ConnectCard() {
  const { data, error, refresh } = useApi<TelegramState>('/api/v1/telegram/connect')
  const [botToken, setBotToken] = useState('')
  const [chatId, setChatId] = useState('')
  const [busy, setBusy] = useState(false)
  const [needsChatId, setNeedsChatId] = useState(false)

  if (error) return <ErrorNote error={error} />
  if (!data) return <Loading label="Checking Telegram…" />

  const connect = async () => {
    setBusy(true)
    try {
      const res = await apiSend<{ ok: boolean; username?: string; needsChatId?: boolean; connected?: boolean }>(
        '/api/v1/telegram/connect',
        'POST',
        { botToken: botToken.trim() || undefined, chatId: chatId.trim() || undefined }
      )
      if (res.needsChatId) {
        setNeedsChatId(true)
        toast.info(`Token valid (@${res.username}) — now send any message to the bot and enter your chat id`)
      } else if (res.connected) {
        toast.success('Telegram connected — verification results will be delivered')
        setBotToken('')
        setChatId('')
        setNeedsChatId(false)
        refresh()
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'connect failed')
    } finally {
      setBusy(false)
    }
  }

  const disconnect = async () => {
    setBusy(true)
    try {
      await apiSend('/api/v1/telegram/connect', 'POST', { disconnect: true })
      toast.info('Telegram disconnected')
      refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      {data.connected ? (
        <div className="flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <Send className="h-5 w-5 text-emerald-400" />
            <div>
              <p className="text-sm font-medium text-emerald-300">Bot connected</p>
              <p className="text-[11px] text-zinc-500">Delivering to chat <Mono className="text-zinc-300">{data.chatId}</Mono></p>
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={disconnect} disabled={busy} className="h-7 gap-1 border-zinc-700 text-xs">
            Disconnect
          </Button>
        </div>
      ) : (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="token" className="text-xs">Bot token <span className="text-muted-foreground">(from @BotFather)</span></Label>
            <Input
              id="token"
              type="password"
              placeholder="123456:ABC-DEF…"
              value={botToken}
              onChange={(e) => setBotToken(e.target.value)}
              className="bg-zinc-900 font-mono text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="chat" className="text-xs">
              Chat ID {needsChatId && <span className="text-amber-400">— required to finish setup</span>}
            </Label>
            <div className="flex gap-2">
              <Input
                id="chat"
                placeholder="e.g. 812345678"
                value={chatId}
                onChange={(e) => setChatId(e.target.value)}
                className="bg-zinc-900 font-mono text-xs"
              />
              <Button onClick={connect} disabled={busy || (!botToken.trim() && !data.hasToken) || (needsChatId && !chatId.trim())} className="gap-1.5 bg-emerald-600 text-xs text-white hover:bg-emerald-500">
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                {needsChatId ? 'Finish' : 'Validate'}
              </Button>
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              The token is validated against Telegram getMe. To find your chat id: message your bot once
              and read it from https://api.telegram.org/bot&lt;token&gt;/getUpdates.
            </p>
          </div>
        </>
      )}
    </div>
  )
}

function PreferencesCard() {
  const { data, error, refresh } = useApi<{
    preferences: { notifyOnStart?: boolean; notifyOnReady?: boolean; notifyOnComplete?: boolean }
  }>('/api/v1/integrations')

  if (error) return <ErrorNote error={error} />
  if (!data) return <Loading />

  const prefs = data.preferences
  const set = async (patch: Record<string, boolean>) => {
    try {
      await apiSend('/api/v1/integrations', 'PATCH', { preferences: patch })
      refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'update failed')
    }
  }

  return (
    <ul className="space-y-3 text-sm">
      {([
        ['notifyOnReady', 'Runner ready', 'Ping when the app is live and Kane is about to start'],
        ['notifyOnComplete', 'Verification finished', 'Final result with checks passed and preview URL'],
      ] as const).map(([key, label, hint]) => (
        <li key={key} className="flex items-center justify-between gap-4">
          <div>
            <p className="font-medium">{label}</p>
            <p className="text-[11px] text-muted-foreground">{hint}</p>
          </div>
          <Switch checked={Boolean(prefs[key])} onCheckedChange={(v) => set({ [key]: v })} />
        </li>
      ))}
    </ul>
  )
}

function DeliveriesCard() {
  const { data } = useApi<{ notifications: NotificationRow[] }>('/api/v1/notifications', 6000)
  const rows = data?.notifications || []
  if (!rows.length) return <p className="text-xs text-muted-foreground">Deliveries appear after runs finish.</p>
  return (
    <ul className="divide-y divide-border text-xs">
      {rows.slice(0, 12).map((n) => (
        <li key={n.id} className="flex items-center gap-2.5 py-2">
          <StatusDot status={n.status} />
          <span className="min-w-0 flex-1 truncate text-zinc-300">{n.title}</span>
          {n.error && <span className="max-w-[240px] truncate text-red-400">{n.error}</span>}
        </li>
      ))}
    </ul>
  )
}

function TelegramInner() {
  return (
    <div className="mx-auto max-w-4xl space-y-5 px-6 py-6">
      <Panel title="Connection"><ConnectCard /></Panel>
      <Panel title="Notification preferences"><PreferencesCard /></Panel>
      <Panel title="Recent deliveries" bodyClass="px-4 py-2"><DeliveriesCard /></Panel>
    </div>
  )
}

export default function TelegramPage() {
  return (
    <Shell title="Telegram" subtitle="verification results on your phone">
      <TelegramInner />
    </Shell>
  )
}
