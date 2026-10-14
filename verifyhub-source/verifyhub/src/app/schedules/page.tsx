'use client'

// VerifyHub — Schedules. Cron-driven automatic verification.

import { useState } from 'react'
import { Clock3, Plus, Trash2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Switch } from '@/components/ui/switch'
import { Shell } from '@/components/verifyhub/shell'
import { Loading, ErrorNote, Empty, Panel, Mono, PageHeader } from '@/components/verifyhub/bits'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { useApi, apiSend, fmtRelative, type Schedule, type Project } from '@/lib/vh-api'

function CreateSchedule({ onCreated }: { onCreated: () => void }) {
  const projects = useApi<{ projects: Project[] }>('/api/v1/projects')
  const { data: schedData } = useApi<{ presets: { label: string; value: string }[] }>('/api/v1/schedules')
  const [projectId, setProjectId] = useState('')
  const [cron, setCron] = useState('*/30 * * * *')
  const [branch, setBranch] = useState('')
  const [telegram, setTelegram] = useState(true)
  const [busy, setBusy] = useState(false)

  const create = async () => {
    if (!projectId) {
      toast.error('choose a project first')
      return
    }
    setBusy(true)
    try {
      await apiSend('/api/v1/schedules', 'POST', { projectId, cron: cron.trim(), branch: branch.trim() || undefined, telegram })
      toast.success('Schedule created')
      setProjectId('')
      setBranch('')
      onCreated()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'failed to create schedule')
    } finally {
      setBusy(false)
    }
  }

  const projectsList = projects.data?.projects || []

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">Project</Label>
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger className="bg-zinc-900 text-xs">
              <SelectValue placeholder={projectsList.length ? 'Select a project' : 'No projects yet'} />
            </SelectTrigger>
            <SelectContent>
              {projectsList.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Cadence</Label>
          <Select value={cron} onValueChange={setCron}>
            <SelectTrigger className="bg-zinc-900 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(schedData?.presets || []).map((p) => (
                <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Branch <span className="text-muted-foreground">(optional)</span></Label>
          <Input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="project default" className="bg-zinc-900 font-mono text-xs" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Custom cron <span className="text-muted-foreground">(overrides preset)</span></Label>
          <Input value={cron} onChange={(e) => setCron(e.target.value)} className="bg-zinc-900 font-mono text-xs" />
        </div>
      </div>
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-xs text-zinc-400">
          <Switch checked={telegram} onCheckedChange={setTelegram} />
          Notify via Telegram
        </label>
        <Button onClick={create} disabled={busy} className="h-8 gap-1.5 bg-emerald-600 text-xs text-white hover:bg-emerald-500">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Create schedule
        </Button>
      </div>
    </div>
  )
}

function SchedulesInner() {
  const { data, error, loading, refresh } = useApi<{ schedules: Schedule[] }>('/api/v1/schedules', 8000)

  const toggle = async (s: Schedule) => {
    try {
      await apiSend(`/api/v1/schedules/${s.id}`, 'PATCH', { enabled: !s.enabled })
      refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'update failed')
    }
  }

  const remove = async (s: Schedule) => {
    try {
      await apiSend(`/api/v1/schedules/${s.id}`, 'DELETE')
      toast.info('Schedule removed')
      refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'delete failed')
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5 px-6 py-6">
      <Panel title="New schedule">
        <CreateSchedule onCreated={refresh} />
      </Panel>

      {error && <ErrorNote error={error} />}
      {loading && !data && <Loading />}

      {data && (
        <Panel title={`Active schedules (${data.schedules.filter((s) => s.enabled).length})`} bodyClass="p-0">
          {data.schedules.length === 0 ? (
            <p className="px-4 py-8 text-center text-xs text-muted-foreground">
              No schedules yet — create one above and VerifyHub will verify automatically.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {data.schedules.map((s) => (
                <li key={s.id} className="flex items-center gap-3 px-4 py-3">
                  <Clock3 className="h-4 w-4 shrink-0 text-amber-400" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{s.name}</p>
                    <p className="truncate text-[11px] text-zinc-500">
                      <Mono>{s.cron}</Mono>
                      {s.branch ? ` · ${s.branch}` : ''}
                      {s.telegram ? ' · telegram on' : ''}
                      {s.lastRunAt ? ` · last fired ${fmtRelative(s.lastRunAt)}` : ' · never fired'}
                    </p>
                  </div>
                  <Switch checked={s.enabled} onCheckedChange={() => toggle(s)} />
                  <Button size="icon" variant="ghost" onClick={() => remove(s)} className="h-7 w-7 text-zinc-500 hover:text-red-400">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        The scheduler ticks every 30 seconds and matches both standard 5-field cron expressions and the
        presets above. Every fired schedule creates a normal run — visible in Runs with the trigger
        <Mono className="mx-1 text-emerald-400">schedule</Mono> — so results, evidence and notifications behave exactly like manual runs.
      </p>
    </div>
  )
}

export default function SchedulesPage() {
  return (
    <Shell title="Schedules" subtitle="automatic verification on a cadence">
      <SchedulesInner />
    </Shell>
  )
}
