// VerifyHub API — /api/v1/github/repos — repository browser

import { NextResponse } from 'next/server'
import { listGithubRepos, getPublicRepo, listBranches } from '@/server/verifyhub/integrations'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const repo = url.searchParams.get('repo')
  const branchesFor = url.searchParams.get('branches')

  try {
    if (repo) {
      const info = await getPublicRepo(repo)
      if (!info) return NextResponse.json({ error: `repository ${repo} not found` }, { status: 404 })
      const branches = await listBranches(repo)
      return NextResponse.json({ repo: info, branches })
    }
    if (branchesFor) {
      const branches = await listBranches(branchesFor)
      return NextResponse.json({ branches })
    }
    const { repos, authenticated, user } = await listGithubRepos()
    return NextResponse.json({ repos, authenticated, user })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'github request failed' },
      { status: 502 }
    )
  }
}
