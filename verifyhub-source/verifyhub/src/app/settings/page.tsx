'use client'

// VerifyHub — Settings. Runtime/integration self-reporting, ngrok tunnel
// configuration, notification preferences, runner security posture.

import { useState } from 'react'
import {
  Container, TerminalSquare, ScanEye, Globe, Github, Send, ShieldCheck,
  Loader2, CheckCircle2, XCircle, Save,
} from 'lucide-react'
import { toast } from 'sonner'
import { Shell } from '@/components/verifyhub/shell'
import { Loading, ErrorNote, Panel, Mono } from '@/components/verifyhub/bits'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useApi, apiSend, type IntegrationState } from '@/lib/vh-api'

const KIND_ICON: Record<string, typeof Container> = {
  runtime: TerminalSquare,
  tunnel: Globe,
  engine: ScanEye,
  notification: Send,
  source: Github,
}

function StatusList() {
  const { data, error, loading, refresh } = useApi<IntegrationState>('/api/v1/integrations', 10_000)
  if (error) return <ErrorNote error={error} />
  if (!data) return <Loading />
  return (
    <ul className="divide-y divide-border">
      {data.statuses.map((s) => {
        const Icon = KIND_ICON[s.kind] || Container
        return (
          <li key={s.key} className="flex items-center gap-3 py-2.5">
            <Icon className="h-4 w-4 shrink-0 text-zinc-500" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{s.name}</p>
              <p className="truncate text-[11px] text-muted-foreground">{s.detail}</p>
            </div>
            {s.connected ? (
              <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5" /> ready
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[11px] text-zinc-500">
                <XCircle className="h-3.5 w-3.5" /> unavailable
              </span>
            )}
          </li>
        )
      })}
      <li className="pt-2">
        <Button size="sm" variant="ghost" onClick={refresh} className="h-7 gap-1 text-xs text-zinc-400">
          <Loader2 className="h-3 w-3" /> Re-probe environment
        </Button>
      </li>
    </ul>
  )
}

function NgrokCard() {
  const { data, refresh } = useApi<IntegrationState>('/api/v1/integrations')
  const [token, setToken] = useState('')
  const [domain, setDomain] = useState('')
  const [busy, setBusy] = useState(false)
  if (!data) return <Loading />
  const configured = data.ngrok.configured

  const save = async () => {
    setBusy(true)
    try {
      await apiSend('/api/v1/integrations', 'PATCH', {
        ngrok: {
          ...(token.trim() ? { authToken: token.trim() } : {}),
          ...(domain.trim() !== '' ? { domain: domain.trim() } : {}),
        },
      })
      toast.success('ngrok settings saved')
      setToken('')
      refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'save failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-muted-foreground">
        ngrok exposes each runner to a public HTTPS URL so Kane and the live browser can reach it.
        Without it, VerifyHub serves previews through its own internal proxy — honestly reported per run.
        Status: {configured ? <span className="text-emerald-400">configured</span> : <span className="text-amber-400">not configured</span>}
        {data.ngrok.domain ? <> · reserved domain <Mono className="text-zinc-300">{data.ngrok.domain}</Mono></> : null}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="ngtoken" className="text-xs">Auth token</Label>
          <Input id="ngtoken" type="password" placeholder="NGROK_AUTHTOKEN" value={token} onChange={(e) => setToken(e.target.value)} className="bg-zinc-900 font-mono text-xs" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ngdomain" className="text-xs">Reserved domain <span className="text-muted-foreground">(optional)</span></Label>
          <Input id="ngdomain" placeholder="your-name.ngrok.app" value={domain} onChange={(e) => setDomain(e.target.value)} className="bg-zinc-900 font-mono text-xs" />
        </div>
      </div>
      <Button onClick={save} disabled={busy} className="h-8 gap-1.5 bg-emerald-600 text-xs text-white hover:bg-emerald-500">
        <Save className="h-3.5 w-3.5" /> Save ngrok settings
      </Button>
    </div>
  )
}

function PrefsCard() {
  const { data, refresh } = useApi<IntegrationState>('/api/v1/integrations')
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
        ['notifyOnStart', 'Run started', 'A nudge the moment a verification kicks off'],
        ['notifyOnReady', 'Runner ready', 'Application is live and Kane is starting'],
        ['notifyOnComplete', 'Verification finished', 'Final result, checks and preview URL'],
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

function SettingsInner() {
  return (
    <div className="mx-auto max-w-4xl space-y-5 px-6 py-6">
      <Panel title="Environment & integrations" right={<ShieldCheck className="h-3.5 w-3.5 text-zinc-600" />}>
        <StatusList />
        <p className="mt-3 rounded border border-border bg-zinc-900/60 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
          Security posture: runners execute with CPU/memory limits, non-root user, dropped capabilities and a
          temporary filesystem. The Docker socket is never mounted into project containers, and runner
          workspaces are destroyed after every run while evidence is preserved.
        </p>
      </Panel>

      <Panel title="ngrok tunnel"><NgrokCard /></Panel>
      <Panel title="Notification preferences"><PrefsCard /></Panel>
    </div>
  )
}

export default function SettingsPage() {
  return (
    <Shell title="Settings" subtitle="environment, tunnels and notification behavior">
      <SettingsInner />
    </Shell>
  )
}
