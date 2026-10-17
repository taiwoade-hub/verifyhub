// VerifyHub API — /api/v1/projects
// GET  /api/v1/projects           list projects with latest run
// POST /api/v1/projects           create project (github | url | example)

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ensureScheduler } from '@/server/verifyhub/orchestrator'
import { detectProject, findProjectRoot } from '@/server/verifyhub/detect'
import * as store from '@/server/verifyhub/store'
import { getPublicRepo } from '@/server/verifyhub/integrations'
import { EXAMPLES } from '@/server/verifyhub/examples'
import * as fs from 'fs'
import * as path from 'path'

export const dynamic = 'force-dynamic'

export async function GET() {
  ensureScheduler()
  const projects = await db.project.findMany({
    orderBy: { updatedAt: 'desc' },
    include: { runs: { orderBy: { createdAt: 'desc' }, take: 3 } },
  })
  const counts = await db.run.groupBy({ by: ['projectId'], _count: { _all: true } })
  const countMap = new Map(counts.map((c) => [c.projectId, c._count._all]))
  return NextResponse.json({
    projects: projects.map((p) => ({ ...p, runCount: countMap.get(p.id) || 0 })),
  })
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      name?: string
      sourceType: 'github' | 'url' | 'example'
      sourceUrl?: string
      branch?: string
      exampleId?: string
      config?: string
    }

    if (!body.sourceType) {
      return NextResponse.json({ error: 'sourceType is required' }, { status: 400 })
    }

    // ------------------------------------------------------------------
    // Git repository (GitHub, GitLab, Bitbucket, self-hosted, .git)
    // ------------------------------------------------------------------
    if (body.sourceType === 'github' || body.sourceType === ('git' as any)) {
      const raw = (body.sourceUrl || '').trim()
      if (!raw) {
        return NextResponse.json(
          { error: 'provide a Git repository URL (e.g. https://github.com/owner/repo or any git URL)' },
          { status: 400 }
        )
      }
      const ghMatch = /^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)/i.exec(raw) || /^([\w.-]+)\/([\w.-]+)$/.exec(raw)
      if (ghMatch) {
        const ownerRepo = `${ghMatch[1]}/${ghMatch[2].replace(/\.git$/, '')}`
        let repoName = ghMatch[2].replace(/\.git$/, '')
        let branch = body.branch || 'main'
        let description: string | null = null
        try {
          const info = await getPublicRepo(ownerRepo)
          if (info) {
            repoName = info.name
            branch = body.branch || info.default_branch
            description = info.description || null
          }
        } catch {
          // GitHub API rate limit or offline — fallback to repo name
        }
        const project = await db.project.create({
          data: {
            name: body.name?.trim() || repoName,
            description: description || `Git repository ${ownerRepo}`,
            sourceType: 'github',
            sourceUrl: raw.startsWith('http') ? raw : `https://github.com/${ownerRepo}`,
            gitRepo: ownerRepo,
            gitBranch: branch,
            config: body.config || null,
          },
        })
        return NextResponse.json({ project }, { status: 201 })
      }

      // Non-GitHub Git URL (GitLab, Bitbucket, self-hosted, direct .git URL)
      const cleanUrl = raw.replace(/\.git$/i, '')
      const parts = cleanUrl.split('/')
      const repoName = parts[parts.length - 1] || 'git-project'
      const ownerRepo = parts.slice(-2).join('/')
      const project = await db.project.create({
        data: {
          name: body.name?.trim() || repoName,
          description: `Git repository (${cleanUrl})`,
          sourceType: 'github',
          sourceUrl: raw,
          gitRepo: ownerRepo || repoName,
          gitBranch: body.branch?.trim() || 'main',
          config: body.config || null,
        },
      })
      return NextResponse.json({ project }, { status: 201 })
    }

    // ------------------------------------------------------------------
    // Existing live URL
    // ------------------------------------------------------------------
    if (body.sourceType === 'url') {
      let raw = (body.sourceUrl || '').trim()
      if (raw && !/^https?:\/\//i.test(raw)) {
        raw = 'https://' + raw
      }
      let url: URL
      try {
        url = new URL(raw)
      } catch {
        return NextResponse.json({ error: 'invalid URL' }, { status: 400 })
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return NextResponse.json({ error: 'URL must use http or https' }, { status: 400 })
      }
      // SSRF guard: refuse obvious internal targets
      const host = url.hostname
      if (/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.)/.test(host) || host === '::1') {
        return NextResponse.json(
          { error: 'internal addresses are not allowed for live URL verification' },
          { status: 400 }
        )
      }
      const project = await db.project.create({
        data: {
          name: body.name?.trim() || url.hostname,
          sourceType: 'url',
          sourceUrl: url.toString(),
          config: body.config || null,
        },
      })
      return NextResponse.json({ project }, { status: 201 })
    }

    // ------------------------------------------------------------------
    // Example project (bundled sample imported into the workspace)
    // ------------------------------------------------------------------
    if (body.sourceType === 'example') {
      const example = EXAMPLES.find((e) => e.id === body.exampleId)
      if (!example) {
        return NextResponse.json({ error: 'unknown example id' }, { status: 400 })
      }
      const project = await db.project.create({
        data: {
          name: body.name?.trim() || example.name,
          description: example.description,
          sourceType: 'example',
          config: body.config || null,
        },
      })
      const dest = store.projectDir(project.id)
      fs.mkdirSync(dest, { recursive: true })
      for (const file of example.files) {
        const target = store.safeJoin(dest, file.path)
        if (!target) continue
        fs.mkdirSync(path.dirname(target), { recursive: true })
        fs.writeFileSync(target, file.content)
      }
      // run detection immediately so the UI has metadata before the first run
      const root = findProjectRoot(dest)
      const d = detectProject(root)
      const cfgPath = path.join(root, '.verifyhub.yml')
      const updated = await db.project.update({
        where: { id: project.id },
        data: {
          detectedLanguage: d.language,
          detectedFramework: d.framework,
          detectedPackageManager: d.packageManager,
          detectedInstall: d.installCommand || null,
          detectedBuild: d.buildCommand || null,
          detectedStart: d.startCommand || null,
          detectedPort: d.port || null,
          config: fs.existsSync(cfgPath) ? fs.readFileSync(cfgPath, 'utf8') : null,
        },
      })
      return NextResponse.json({ project: updated, detection: d }, { status: 201 })
    }

    // ------------------------------------------------------------------
    // Direct code / HTML snippet
    // ------------------------------------------------------------------
    if (body.sourceType === ('code' as any)) {
      const code = ((body as any).code || '').trim()
      if (!code) {
        return NextResponse.json({ error: 'code content is required' }, { status: 400 })
      }
      const fileName = (body as any).fileName?.trim() || 'index.html'
      const isHtml = /\.html?$/i.test(fileName)
      const project = await db.project.create({
        data: {
          name: body.name?.trim() || (isHtml ? 'Interactive Web App' : 'Code Project'),
          description: `Direct code (${fileName})`,
          sourceType: 'upload',
          config: body.config || null,
        },
      })
      const dest = store.projectDir(project.id)
      fs.mkdirSync(dest, { recursive: true })
      fs.writeFileSync(path.join(dest, fileName), code, 'utf8')
      if (isHtml && fileName.toLowerCase() !== 'index.html') {
        fs.writeFileSync(path.join(dest, 'index.html'), code, 'utf8')
      }
      const root = findProjectRoot(dest)
      const d = detectProject(root)
      const cfgPath = path.join(root, '.verifyhub.yml')
      const updated = await db.project.update({
        where: { id: project.id },
        data: {
          detectedLanguage: d.language,
          detectedFramework: d.framework,
          detectedPackageManager: d.packageManager,
          detectedInstall: d.installCommand || null,
          detectedBuild: d.buildCommand || null,
          detectedStart: d.startCommand || null,
          detectedPort: d.port || null,
          config: fs.existsSync(cfgPath) ? fs.readFileSync(cfgPath, 'utf8') : null,
        },
      })
      return NextResponse.json({ project: updated, detection: d }, { status: 201 })
    }

    // ------------------------------------------------------------------
    // Local directory on host machine
    // ------------------------------------------------------------------
    if (body.sourceType === ('local' as any)) {
      const localPath = ((body as any).localPath || '').trim()
      if (!localPath) {
        return NextResponse.json({ error: 'local folder path is required' }, { status: 400 })
      }
      const resolvedPath = path.resolve(localPath)
      if (!fs.existsSync(resolvedPath)) {
        return NextResponse.json({ error: `folder does not exist at "${localPath}"` }, { status: 404 })
      }
      const stat = fs.statSync(resolvedPath)
      if (!stat.isDirectory()) {
        return NextResponse.json({ error: `path "${localPath}" is not a directory` }, { status: 400 })
      }
      const projectName = body.name?.trim() || path.basename(resolvedPath) || 'Local Project'
      const project = await db.project.create({
        data: {
          name: projectName,
          description: `Imported from local folder: ${resolvedPath}`,
          sourceType: 'upload',
          localPath: resolvedPath,
          config: body.config || null,
        },
      })
      const dest = store.projectDir(project.id)
      fs.mkdirSync(dest, { recursive: true })
      store.copyDirRecursive(resolvedPath, dest)

      const root = findProjectRoot(dest)
      const d = detectProject(root)
      const cfgPath = path.join(root, '.verifyhub.yml')
      const updated = await db.project.update({
        where: { id: project.id },
        data: {
          detectedLanguage: d.language,
          detectedFramework: d.framework,
          detectedPackageManager: d.packageManager,
          detectedInstall: d.installCommand || null,
          detectedBuild: d.buildCommand || null,
          detectedStart: d.startCommand || null,
          detectedPort: d.port || null,
          config: fs.existsSync(cfgPath) ? fs.readFileSync(cfgPath, 'utf8') : null,
        },
      })
      return NextResponse.json({ project: updated, detection: d }, { status: 201 })
    }

    return NextResponse.json({ error: 'unsupported sourceType' }, { status: 400 })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'failed to create project' },
      { status: 500 }
    )
  }
}
