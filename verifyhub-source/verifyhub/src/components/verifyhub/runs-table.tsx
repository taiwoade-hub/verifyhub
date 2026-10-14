'use client'

// VerifyHub — shared runs table used by dashboard / runs / project views.

import Link from 'next/link'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { StatusBadge, ResultBadge, Mono } from '@/components/verifyhub/bits'
import { fmtDuration, fmtRelative, type Run } from '@/lib/vh-api'

export function RunsTable({ runs, showProject = true, emptyLabel = 'No runs yet' }: {
  runs: Run[]
  showProject?: boolean
  emptyLabel?: string
}) {
  if (!runs.length) {
    return <p className="py-8 text-center text-sm text-muted-foreground">{emptyLabel}</p>
  }
  return (
    <Table>
      <TableHeader>
        <TableRow className="border-border hover:bg-transparent">
          <TableHead className="h-9 text-xs">Run</TableHead>
          {showProject && <TableHead className="h-9 text-xs">Project</TableHead>}
          <TableHead className="h-9 text-xs">Status</TableHead>
          <TableHead className="h-9 text-xs">Result</TableHead>
          <TableHead className="h-9 text-xs">Trigger</TableHead>
          <TableHead className="h-9 text-xs">Duration</TableHead>
          <TableHead className="h-9 text-right text-xs">Started</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {runs.map((run) => (
          <TableRow key={run.id} className="border-border">
            <TableCell className="py-2">
              <Link href={`/runs/${run.id}`} className="font-mono text-xs text-emerald-400 hover:underline">
                #{run.number}
              </Link>
            </TableCell>
            {showProject && (
              <TableCell className="max-w-[200px] truncate py-2 text-sm">
                <Link href={`/projects/${run.projectId}`} className="hover:text-emerald-400 hover:underline">
                  {run.project?.name || run.projectId}
                </Link>
              </TableCell>
            )}
            <TableCell className="py-2"><StatusBadge status={run.status} /></TableCell>
            <TableCell className="py-2">
              <ResultBadge result={run.result} checksPassed={run.checksPassed} checksTotal={run.checksTotal} />
            </TableCell>
            <TableCell className="py-2"><Mono className="text-zinc-500">{run.trigger}</Mono></TableCell>
            <TableCell className="py-2 text-xs text-zinc-400">{fmtDuration(run.durationMs)}</TableCell>
            <TableCell className="py-2 text-right text-xs text-zinc-500">{fmtRelative(run.createdAt)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
