'use client'

// VerifyHub — Project workspace. Explorer + detection overview + config editor
// + run history. The "Run verification" action is always one click away.

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import {
  ChevronDown,
  ChevronRight,
  File as FileIcon,
  FolderClosed,
  Play,
  Loader2,
  Save,
  Globe,
  Github,
  FileArchive,
  PackageOpen,
  FolderGit2,
  ExternalLink,
} from 'lucide-react'
import { toast } from 'sonner'
import { Shell } from '@/components/verifyhub/shell'
import {
  Panel, Loading, ErrorNote, Empty, Mono, StatusBadge, ResultBadge, PageHeader,
} from '@/components/verifyhub/bits'
import { RunsTable } from '@/components/verifyhub/runs-table'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { useApi, apiSend, fmtDuration, fmtRelative, type Project, type Run, type DetectionResult } from '@/lib/vh-api'
import type { FileNode } from '@/server/verifyhub/store'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// File explorer
// ---------------------------------------------------------------------------

function TreeItem({ node, depth, onOpen, activePath }: {
  node: FileNode
  depth: number
  onOpen: (path: string) => void
  activePath: string | null
}) {
  const [open, setOpen] = useState(depth < 1)
  if (node.type === 'dir') {
    return (
      <div>
        <button
          className="flex w-full items-center gap-1 rounded px-2 py-1 text-left text-xs text-zinc-300 hover:bg-zinc-800/70"
          style={{ paddingLeft: 8 + depth * 12 }}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <ChevronDown className="h-3 w-3 shrink-0 text-zinc-500" /> : <ChevronRight className="h-3 w-3 shrink-0 text-zinc-500" />}
          {open ? <FolderClosed className="h-3.5 w-3.5 shrink-0 text-sky-400/70" /> : <FolderClosed className="h-3.5 w-3.5 shrink-0 text-zinc-500" />}
          <span className="truncate">{node.name}</span>
        </button>
        {open &&
          node.children?.map((child) => (
            <TreeItem key={child.path} node={child} depth={depth + 1} onOpen={onOpen} activePath={activePath} />
          ))}
      </div>
    )
  }
  const active = activePath === node.path
  return (
    <button
      className={cn(
        'flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs',
        active ? 'bg-emerald-500/10 text-emerald-400' : 'text-zinc-400 hover:bg-zinc-800/70'
      )}
      style={{ paddingLeft: 8 + depth * 12 + 14 }}
      onClick={() => onOpen(node.path)}
    >
      <FileIcon className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
      <span className="truncate">{node.name}</span>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Detection overview
// ---------------------------------------------------------------------------

function DetectionView({ project, detection }: { project: Project; detection: DetectionResult | null }) {
  const rows: [string, string][] = detection
    ? [
        ['Language', detection.language],
        ['Framework', detection.framework],
        ['Package manager', detection.packageManager],
        ['Install', detection.installCommand || '—'],
        ['Build', detection.buildCommand || '—'],
        ['Start', detection.startCommand || '—'],
        ['Port', detection.port ? String(detection.port) : '—'],
        ['Health check', `GET ${detection.healthPath} (${detection.healthStrategy})`],
      ]
    : [
        ['Language', project.detectedLanguage || '—'],
        ['Framework', project.detectedFramework || '—'],
        ['Package manager', project.detectedPackageManager || '—'],
        ['Install', project.detectedInstall || '—'],
        ['Build', project.detectedBuild || '—'],
        ['Start', project.detectedStart || '—'],
        ['Port', project.detectedPort ? String(project.detectedPort) : '—'],
      ]

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <tbody>
            {rows.map(([k, v], i) => (
              <tr key={k} className={i % 2 ? 'bg-zinc-900/40' : ''}>
                <td className="w-44 border-b border-border px-3 py-2 text-xs uppercase tracking-wider text-muted-foreground">{k}</td>
                <td className="border-b border-border px-3 py-2 font-mono text-xs text-zinc-200">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {detection?.notes?.length ? (
        <Panel title="Detection notes">
          <ul className="space-y-1 text-xs text-muted-foreground">
            {detection.notes.map((n, i) => (
              <li key={i} className="flex gap-2"><span className="text-emerald-400">•</span>{n}</li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {project.sourceType === 'url' && project.sourceUrl && (
        <Panel title="Live target">
          <a href={project.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-emerald-400 hover:underline">
            {project.sourceUrl} <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </Panel>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Config editor (.verifyhub.yml)
// ---------------------------------------------------------------------------

function ConfigView({ projectId }: { projectId: string }) {
  const { data, refresh } = useApi<{ raw: string; isDefault: boolean }>(`/api/v1/projects/${projectId}/config`)
  const [value, setValue] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (data && value === null) setValue(data.raw)
  }, [data, value])

  const save = async () => {
    if (value === null) return
    setSaving(true)
    try {
      await apiSend(`/api/v1/projects/${projectId}/config`, 'PUT', { config: value })
      toast.success('.verifyhub.yml saved')
      refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'invalid config')
    } finally {
      setSaving(false)
    }
  }

  if (!data) return <Loading label="Loading config…" />
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Mono className="text-xs text-zinc-500">.verifyhub.yml {data.isDefault && <span className="text-zinc-600">(default — not yet saved)</span>}</Mono>
        <Button size="sm" onClick={save} disabled={saving || value === null} className="h-7 gap-1.5 bg-emerald-600 text-xs text-white hover:bg-emerald-500">
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
          Save
        </Button>
      </div>
      <Textarea
        value={value ?? ''}
        onChange={(e) => setValue(e.target.value)}
        spellCheck={false}
        className="min-h-[340px] resize-y bg-zinc-950 font-mono text-xs leading-relaxed text-zinc-200 focus-visible:ring-emerald-500/40"
      />
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Instructions are executed by the verification engine. Kane (browser engine) performs full flows; the built-in
        HTTP probe engine translates instructions into real HTTP checks and records the evidence.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function WorkspaceInner() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const id = params.id
  const { data, error, loading, refresh } = useApi<{ project: Project }>(`/api/v1/projects/${id}`, 5000)
  const tree = useApi<{ tree: FileNode[]; note?: string }>(`/api/v1/projects/${id}/tree`)
  const [activeFile, setActiveFile] = useState<{ path: string; content: string; size: number } | null>(null)
  const [fileLoading, setFileLoading] = useState(false)
  const [starting, setStarting] = useState(false)
  const [detection, setDetection] = useState<DetectionResult | null>(null)

  const project = data?.project

  useEffect(() => {
    if (project?.detectedLanguage && !detection) {
      setDetection({
        language: project.detectedLanguage,
        framework: project.detectedFramework || '—',
        packageManager: project.detectedPackageManager || '—',
        installCommand: project.detectedInstall || undefined,
        buildCommand: project.detectedBuild || undefined,
        startCommand: project.detectedStart || undefined,
        port: project.detectedPort || undefined,
        healthPath: '/',
        healthStrategy: 'http',
        files: [],
        notes: [],
      })
    }
  }, [project, detection])

  const openFile = useCallback(
    async (path: string) => {
      setFileLoading(true)
      try {
        const res = await fetch(`/api/v1/projects/${id}/file?path=${encodeURIComponent(path)}`, { cache: 'no-store' })
        const body = (await res.json()) as { content?: string; size?: number; error?: string }
        if (!res.ok) throw new Error(body.error || 'could not read file')
        setActiveFile({ path, content: body.content || '', size: body.size || 0 })
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'file read failed')
      } finally {
        setFileLoading(false)
      }
    },
    [id]
  )

  const startRun = async () => {
    setStarting(true)
    try {
      const { run } = await apiSend<{ run: Run }>(`/api/v1/projects/${id}/runs`, 'POST', {
        engine: 'playwright',
        browser: 'firefox',
        recordVideo: true,
      })
      toast.success(`Run #${run.number} started (Firefox)`)
      router.push(`/runs/${run.id}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'failed to start run')
    } finally {
      setStarting(false)
    }
  }

  const sourceIcon = useMemo(() => {
    if (!project) return FolderGit2
    return project.sourceType === 'github' ? Github : project.sourceType === 'url' ? Globe : project.sourceType === 'upload' ? FileArchive : PackageOpen
  }, [project])

  if (loading && !data) {
    return (
      <Shell title="Project">
        <Loading />
      </Shell>
    )
  }
  if (error || !project) {
    return (
      <Shell title="Project">
        <div className="mx-auto max-w-3xl px-6 py-6"><ErrorNote error={error || 'project not found'} /></div>
      </Shell>
    )
  }

  const SourceIcon = sourceIcon
  const latestRuns = project.runs || []

  return (
    <Shell
      title={project.name}
      subtitle={
        <span className="inline-flex items-center gap-1.5">
          <SourceIcon className="h-3.5 w-3.5" />
          <Mono className="text-zinc-500">{project.gitRepo || project.sourceUrl || project.sourceType}</Mono>
        </span>
      }
      actions={
        <Button size="sm" onClick={startRun} disabled={starting} className="h-8 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-500">
          {starting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          Run verification
        </Button>
      }
    >
      <div className="mx-auto max-w-7xl px-6 py-5">
        <Tabs defaultValue="explorer">
          <TabsList className="bg-zinc-900">
            <TabsTrigger value="explorer" className="text-xs">Explorer</TabsTrigger>
            <TabsTrigger value="overview" className="text-xs">Detection</TabsTrigger>
            <TabsTrigger value="config" className="text-xs">.verifyhub.yml</TabsTrigger>
            <TabsTrigger value="runs" className="text-xs">Runs</TabsTrigger>
          </TabsList>

          {/* Explorer */}
          <TabsContent value="explorer" className="mt-4">
            {project.sourceType === 'url' ? (
              <Empty
                icon={<Globe className="h-8 w-8" />}
                title="Live URL project"
                hint="This project verifies an already-running application, so there is no file tree."
              />
            ) : (
              <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
                <Panel title="Explorer" bodyClass="max-h-[560px] overflow-y-auto p-2" className="self-start">
                  {tree.loading && <Loading label="Loading tree…" />}
                  {tree.error && <ErrorNote error={tree.error} />}
                  {tree.data && tree.data.tree.length === 0 && (
                    <p className="px-2 py-4 text-xs leading-relaxed text-muted-foreground">
                      {tree.data.note || 'Source files appear here after the first run downloads the project.'}
                    </p>
                  )}
                  {tree.data && tree.data.tree.map((node) => (
                    <TreeItem key={node.path} node={node} depth={0} onOpen={openFile} activePath={activeFile?.path || null} />
                  ))}
                </Panel>
                <Panel title={activeFile ? activeFile.path : 'File preview'} bodyClass="p-0">
                  {fileLoading && <Loading label="Reading file…" />}
                  {!fileLoading && !activeFile && (
                    <p className="px-4 py-10 text-center text-xs text-muted-foreground">
                      Select a file in the explorer to inspect it.
                    </p>
                  )}
                  {!fileLoading && activeFile && (
                    <>
                      <div className="flex items-center justify-between border-b border-border px-3 py-1.5 text-[11px] text-zinc-500">
                        <Mono className="text-zinc-400">{activeFile.path}</Mono>
                        <span>{activeFile.size} bytes · read-only</span>
                      </div>
                      <pre className="max-h-[520px] overflow-auto p-4 font-mono text-xs leading-relaxed text-zinc-300">
                        {activeFile.content}
                      </pre>
                    </>
                  )}
                </Panel>
              </div>
            )}
          </TabsContent>

          {/* Detection */}
          <TabsContent value="overview" className="mt-4">
            <DetectionView project={project} detection={detection} />
          </TabsContent>

          {/* Config */}
          <TabsContent value="config" className="mt-4">
            <ConfigView projectId={id} />
          </TabsContent>

          {/* Runs */}
          <TabsContent value="runs" className="mt-4 space-y-4">
            {latestRuns.length === 0 ? (
              <Empty
                icon={<Play className="h-8 w-8" />}
                title="No runs for this project yet"
                hint="Hit “Run verification” — VerifyHub will prepare the environment, start the app and launch the verification engine."
              />
            ) : (
              <Panel title={`Run history (${project.runs ? project.runs.length : 0} most recent)`} bodyClass="p-0">
                <RunsTable runs={latestRuns} showProject={false} />
              </Panel>
            )}
            {latestRuns[0] && (
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <StatusBadge status={latestRuns[0].status} />
                <ResultBadge result={latestRuns[0].result} checksPassed={latestRuns[0].checksPassed} checksTotal={latestRuns[0].checksTotal} />
                {latestRuns[0].durationMs && <span>last run took {fmtDuration(latestRuns[0].durationMs)}</span>}
                <span>{fmtRelative(latestRuns[0].createdAt)}</span>
                <Link href={`/runs/${latestRuns[0].id}`} className="ml-auto text-emerald-400 hover:underline">
                  Open latest run →
                </Link>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </Shell>
  )
}

export default function ProjectPage() {
  return <WorkspaceInner />
}
