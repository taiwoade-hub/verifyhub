'use client'

// VerifyHub — GitHub integration. Connect a PAT, browse repositories, add one
// as a verification project. Unauthenticated users can still add public repos
// by URL from the New Verification dialog.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Github, Star, GitBranch, Link2, RefreshCw, LogOut, Plus, Lock } from 'lucide-react'
import { toast } from 'sonner'
import { Shell } from '@/components/verifyhub/shell'
import { Loading, ErrorNote, Empty, Panel, Mono } from '@/components/verifyhub/bits'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useApi, apiSend, apiGet, fmtRelative } from '@/lib/vh-api'

interface Repo {
  id: number
  full_name: string
  description: string | null
  html_url: string
  default_branch: string
  language: string | null
  stargazers_count: number
  updated_at: string
  private: boolean
}

function ConnectForm({ onConnected }: { onConnected: () => void }) {
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const { data, refresh } = useApi<{ connected: boolean; username: string | null; hasToken: boolean }>('/api/v1/github/connect')

  const connect = async () => {
    setBusy(true)
    try {
      const res = await apiSend<{ ok: boolean; username: string }>('/api/v1/github/connect', 'POST', { token: token.trim() })
      toast.success(`Connected to GitHub as ${res.username}`)
      setToken('')
      refresh()
      onConnected()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'connect failed')
    } finally {
      setBusy(false)
    }
  }

  const disconnect = async () => {
    setBusy(true)
    try {
      await apiSend('/api/v1/github/connect', 'POST', { disconnect: true })
      toast.info('GitHub disconnected')
      refresh()
      onConnected()
    } finally {
      setBusy(false)
    }
  }

  if (!data) return <Loading label="Checking connection…" />

  if (data.connected) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <Github className="h-5 w-5 text-emerald-400" />
          <div>
            <p className="text-sm font-medium text-emerald-300">Connected as {data.username}</p>
            <p className="text-[11px] text-zinc-500">Private repositories are listed; webhooks use GITHUB_WEBHOOK_SECRET.</p>
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={disconnect} disabled={busy} className="h-7 gap-1 border-zinc-700 text-xs">
          <LogOut className="h-3 w-3" /> Disconnect
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="pat" className="text-xs">Personal access token (classic, repo scope)</Label>
        <div className="flex gap-2">
          <Input
            id="pat"
            type="password"
            placeholder="ghp_…"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="bg-zinc-900 font-mono text-xs"
          />
          <Button onClick={connect} disabled={busy || !token.trim()} className="gap-1.5 bg-emerald-600 text-xs text-white hover:bg-emerald-500">
            <Link2 className="h-3.5 w-3.5" /> Connect
          </Button>
        </div>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          The token is stored in VerifyHub and used to list your repositories and download sources for
          verification. Without it, you can still add public repositories by URL.
        </p>
      </div>
    </div>
  )
}

function RepoBrowser() {
  const [refreshKey, setRefreshKey] = useState(0)
  const [adding, setAdding] = useState<string | null>(null)
  const { data, error, loading } = useApi<{ repos: Repo[]; authenticated: boolean; user?: string }>(
    `/api/v1/github/repos?key=${refreshKey}`
  )
  const router = useRouter()

  const addProject = async (repo: Repo) => {
    setAdding(repo.full_name)
    try {
      const { project } = await apiSend<{ project: { id: string } }>('/api/v1/projects', 'POST', {
        sourceType: 'github',
        sourceUrl: repo.html_url,
        branch: repo.default_branch,
      })
      toast.success(`${repo.full_name} added`)
      router.push(`/projects/${project.id}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'failed to add repository')
    } finally {
      setAdding(null)
    }
  }

  if (loading && !data) return <Loading />
  if (error) return <ErrorNote error={error} />
  if (!data) return null

  if (!data.authenticated) {
    return (
      <Empty
        icon={<Github className="h-9 w-9" />}
        title="Not connected"
        hint="Connect a personal access token above to browse your repositories. Public repositories can still be added via the New Verification dialog."
      />
    )
  }

  if (data.repos.length === 0) {
    return <Empty icon={<Github className="h-9 w-9" />} title="No repositories found" hint="The token may not have access to any repositories." />
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{data.repos.length} repositories for {data.user}</p>
        <Button size="sm" variant="ghost" onClick={() => setRefreshKey((k) => k + 1)} className="h-7 gap-1 text-xs text-zinc-400">
          <RefreshCw className="h-3 w-3" /> Refresh
        </Button>
      </div>
      {data.repos.map((repo) => (
        <div key={repo.id} className="flex items-center gap-3 rounded-lg border border-border bg-[#111114] px-4 py-3">
          <Github className="h-4 w-4 shrink-0 text-zinc-500" />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 truncate text-sm font-medium">
              <Mono className="text-zinc-200">{repo.full_name}</Mono>
              {repo.private && <Lock className="h-3 w-3 text-amber-400" />}
            </p>
            <p className="truncate text-[11px] text-zinc-500">
              {repo.language || '—'} · {repo.description || 'no description'}
            </p>
          </div>
          <span className="hidden shrink-0 items-center gap-1 text-[11px] text-zinc-500 sm:flex">
            <Star className="h-3 w-3" /> {repo.stargazers_count}
          </span>
          <span className="hidden shrink-0 items-center gap-1 text-[11px] text-zinc-500 md:flex">
            <GitBranch className="h-3 w-3" /> {repo.default_branch}
          </span>
          <span className="hidden w-20 shrink-0 text-right text-[11px] text-zinc-600 lg:block">
            {fmtRelative(repo.updated_at)}
          </span>
          <Button
            size="sm"
            onClick={() => addProject(repo)}
            disabled={adding === repo.full_name}
            className="h-7 gap-1 bg-emerald-600 px-2.5 text-xs text-white hover:bg-emerald-500"
          >
            <Plus className="h-3 w-3" /> Add
          </Button>
        </div>
      ))}
    </div>
  )
}

function GithubInner() {
  const [key, setKey] = useState(0)
  return (
    <div className="mx-auto max-w-4xl space-y-5 px-6 py-6">
      <Panel title="Connection">
        <ConnectForm onConnected={() => setKey((k) => k + 1)} />
      </Panel>
      <Panel title="Repositories">
        <RepoBrowserWrapper key={key} />
      </Panel>
    </div>
  )
}

function RepoBrowserWrapper() {
  // remounts when the connection changes so the repo list reloads
  return <RepoBrowser />
}

export default function GithubPage() {
  return (
    <Shell title="GitHub" subtitle="repositories, branches and webhook-driven verification">
      <GithubInner />
    </Shell>
  )
}
