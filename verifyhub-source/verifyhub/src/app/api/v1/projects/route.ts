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
    // GitHub
    // ------------------------------------------------------------------
    if (body.sourceType === 'github') {
      const raw = (body.sourceUrl || '').trim()
      const m = /^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)/i.exec(raw) || /^([\w.-]+)\/([\w.-]+)$/.exec(raw)
      if (!m) {
        return NextResponse.json(
          { error: 'provide a GitHub repository URL like https://github.com/owner/repo' },
          { status: 400 }
        )
      }
      const ownerRepo = `${m[1]}/${m[2].replace(/\.git$/, '')}`
      const info = await getPublicRepo(ownerRepo)
      if (!info) {
        return NextResponse.json({ error: `repository ${ownerRepo} not found or inaccessible` }, { status: 404 })
      }
      const branch = body.branch || info.default_branch
      const project = await db.project.create({
        data: {
          name: body.name?.trim() || info.name,
          description: info.description || null,
          sourceType: 'github',
          sourceUrl: info.html_url,
          gitRepo: ownerRepo,
          gitBranch: branch,
          config: body.config || null,
        },
      })
      return NextResponse.json({ project }, { status: 201 })
    }

    // ------------------------------------------------------------------
    // Existing live URL
    // ------------------------------------------------------------------
    if (body.sourceType === 'url') {
      const raw = (body.sourceUrl || '').trim()
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
      await db.project.update({
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
    // ------------------------------------------------------------------
    // Direct code (e.g. index.html or raw code snippet)
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
          name: body.name?.trim() || (isHtml ? 'HTML Project' : 'Code Project'),
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
      await db.project.update({
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
      return NextResponse.json({ project }, { status: 201 })
    }

    return NextResponse.json({ error: 'unsupported sourceType' }, { status: 400 })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'failed to create project' },
      { status: 500 }
    )
  }
}
