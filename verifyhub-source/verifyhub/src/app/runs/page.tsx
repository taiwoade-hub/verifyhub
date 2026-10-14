'use client'

// VerifyHub — Runs list across all projects, with status filter.

import { useState } from 'react'
import { PlayCircle } from 'lucide-react'
import { Shell } from '@/components/verifyhub/shell'
import { Loading, ErrorNote, Empty, Panel } from '@/components/verifyhub/bits'
import { RunsTable } from '@/components/verifyhub/runs-table'
import { useApi, type Run } from '@/lib/vh-api'
import { cn } from '@/lib/utils'

const FILTERS = [
  { key: '', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'COMPLETED', label: 'Completed' },
  { key: 'FAILED', label: 'Failed' },
] as const

function RunsInner() {
  const [filter, setFilter] = useState('')
  const url = filter ? `/api/v1/runs?status=${filter}&limit=100` : '/api/v1/runs?limit=100'
  const { data, error, loading } = useApi<{ runs: Run[] }>(url, 3500)

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <div className="mb-4 flex items-center gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs transition-colors',
              filter === f.key
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                : 'border-border text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && <ErrorNote error={error} />}
      {loading && !data && <Loading />}

      {data && (
        <Panel bodyClass="p-0">
          {data.runs.length === 0 ? (
            <Empty
              icon={<PlayCircle className="h-9 w-9" />}
              title={filter ? 'No runs match this filter' : 'No verification runs yet'}
              hint="Every verification run — manual, webhook or scheduled — shows up here with its full history."
            />
          ) : (
            <RunsTable runs={data.runs} emptyLabel="No runs match this filter" />
          )}
        </Panel>
      )}
    </div>
  )
}

export default function RunsPage() {
  return (
    <Shell title="Runs" subtitle="verification history across all projects">
      <RunsInner />
    </Shell>
  )
}
