'use client'

// VerifyHub — Projects list. Cards with detected stack, run stats, quick Run.

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  FolderGit2,
  Github,
  Globe,
  FileArchive,
  PackageOpen,
  Play,
  ChevronRight,
  Loader2,
  GitBranch,
  Plus,
} from 'lucide-react'
import { toast } from 'sonner'
import { Shell, useShell } from '@/components/verifyhub/shell'
import { Loading, ErrorNote, Empty, Mono, StatusBadge } from '@/components/verifyhub/bits'
import { Button } from '@/components/ui/button'
import { useApi, apiSend, fmtRelative, type Project, type Run } from '@/lib/vh-api'

const SOURCE_ICON = {
  github: Github,
  url: Globe,
  upload: FileArchive,
  example: PackageOpen,
} as const

function SourceChip({ project }: { project: Project }) {
  const Icon = SOURCE_ICON[project.sourceType] || FolderGit2
  const label =
    project.sourceType === 'github'
      ? project.gitRepo
      : project.sourceType === 'url'
        ? (() => {
            try {
              return new URL(project.sourceUrl || 'https://x').hostname
            } catch {
              return project.sourceUrl || ''
            }
          })()
        : project.sourceType
  return (
    <span className="inline-flex max-w-[220px] items-center gap-1.5 rounded bg-zinc-800/80 px-1.5 py-0.5 text-[11px] text-zinc-400">
      <Icon className="h-3 w-3 shrink-0" />
      <Mono className="truncate">{label}</Mono>
    </span>
  )
}

function ProjectCard({ project, onRun, running }: { project: Project; onRun: (p: Project) => void; running: boolean }) {
  const latest = project.runs?.[0]
  return (
    <div className="group flex flex-col rounded-lg border border-border bg-[#111114] transition-colors hover:border-zinc-600">
      <Link href={`/projects/${project.id}`} className="flex-1 px-4 pt-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="truncate text-sm font-semibold group-hover:text-emerald-400">{project.name}</h3>
          <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-zinc-600 transition-transform group-hover:translate-x-0.5 group-hover:text-emerald-400" />
        </div>
        {project.description && (
          <p className="mt-1 line-clamp-2 min-h-[2rem] text-xs leading-relaxed text-muted-foreground">
            {project.description}
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <SourceChip project={project} />
          {project.detectedFramework && (
            <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[11px] text-emerald-400">
              {project.detectedFramework}
            </span>
          )}
          {project.gitBranch && (
            <span className="inline-flex items-center gap-1 rounded bg-zinc-800/80 px-1.5 py-0.5 text-[11px] text-zinc-400">
              <GitBranch className="h-3 w-3" />
              {project.gitBranch}
            </span>
          )}
        </div>
      </Link>
      <div className="mt-3 flex items-center justify-between border-t border-border px-4 py-2.5">
        <div className="text-[11px] text-zinc-500">
          {project.runCount ? `${project.runCount} run${project.runCount > 1 ? 's' : ''}` : 'never run'}
          {latest && <> · <StatusBadge status={latest.status} className="scale-90" /></>}
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1 border-zinc-700 px-2.5 text-xs hover:border-emerald-500/50 hover:bg-emerald-500/10 hover:text-emerald-400"
          disabled={running}
          onClick={() => onRun(project)}
        >
          {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
          Run
        </Button>
      </div>
    </div>
  )
}

function ProjectsInner() {
  const router = useRouter()
  const { openNew } = useShell()
  const { data, error, loading, refresh } = useApi<{ projects: Project[] }>('/api/v1/projects', 5000)
  const [runningId, setRunningId] = useState<string | null>(null)

  const run = async (project: Project) => {
    setRunningId(project.id)
    try {
      const { run } = await apiSend<{ run: Run }>(`/api/v1/projects/${project.id}/runs`, 'POST', {})
      toast.success(`Run #${run.number} started`)
      refresh()
      router.push(`/runs/${run.id}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'failed to start run')
    } finally {
      setRunningId(null)
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      {error && <ErrorNote error={error} />}
      {loading && !data && <Loading />}

      {data && data.projects.length === 0 && (
        <Empty
          icon={<FolderGit2 className="h-10 w-10" />}
          title="No projects yet"
          hint="Add a GitHub repository, folder, live URL, or interactive app — VerifyHub detects the stack and prepares a runnable environment automatically."
          action={
            <Button size="sm" onClick={openNew} className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-500">
              <Plus className="h-3.5 w-3.5" />
              Add Verification
            </Button>
          }
        />
      )}

      {data && data.projects.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.projects.map((p) => (
            <ProjectCard key={p.id} project={p} onRun={run} running={runningId === p.id} />
          ))}
        </div>
      )}
    </div>
  )
}

export default function ProjectsPage() {
  return (
    <Shell title="Projects" subtitle="everything connected to VerifyHub">
      <ProjectsInner />
    </Shell>
  )
}
