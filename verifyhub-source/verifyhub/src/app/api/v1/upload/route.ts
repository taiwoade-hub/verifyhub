// VerifyHub API — /api/v1/upload — multipart upload (ZIP, tar, HTML, single code files) → project + extraction

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import * as store from '@/server/verifyhub/store'
import { detectProject, findProjectRoot } from '@/server/verifyhub/detect'
import * as path from 'path'
import * as fs from 'fs'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData()
    const allFiles = form.getAll('files').concat(form.getAll('file')).filter((f): f is File => f instanceof File)
    const relativePaths = (form.getAll('paths') as string[]).map((p) => String(p).trim())
    const rawCode = form.get('code') as string | null

    let projectName = (form.get('name') as string | null)?.trim() || ''

    if (allFiles.length === 0 && (!rawCode || !rawCode.trim())) {
      return NextResponse.json({ error: 'provide a file, archive, folder, or code' }, { status: 400 })
    }

    // Check size limit (max 50 MB total)
    const totalSize = allFiles.reduce((sum, f) => sum + f.size, 0)
    if (totalSize > 50 * 1024 * 1024) {
      return NextResponse.json({ error: 'upload exceeds 50 MB limit' }, { status: 413 })
    }

    const isFolder = allFiles.length > 1 || relativePaths.some((p) => p.includes('/'))
    const singleFile = allFiles.length === 1 ? allFiles[0] : null
    const singleName = singleFile ? singleFile.name : (form.get('fileName') as string | null)?.trim() || 'index.html'
    const lowerName = singleName.toLowerCase()
    const isArchive = !isFolder && singleFile && (lowerName.endsWith('.zip') || lowerName.endsWith('.tar.gz') || lowerName.endsWith('.tgz') || lowerName.endsWith('.tar'))
    const isHtml = !isFolder && (lowerName.endsWith('.html') || lowerName.endsWith('.htm'))

    if (!projectName) {
      if (isFolder) {
        // Derive folder name from first relative path or generic
        const firstRel = relativePaths[0] || (singleFile?.name || '')
        const topDir = firstRel.split('/')[0]
        projectName = topDir && topDir !== '.' ? topDir : 'Uploaded Project'
      } else if (isArchive) {
        projectName = singleName.replace(/\.(zip|tar\.gz|tgz|tar)$/i, '')
      } else {
        projectName = singleName.replace(/\.(html|htm|js|py|ts)$/i, '') || 'HTML Project'
      }
    }

    const project = await db.project.create({
      data: {
        name: projectName,
        sourceType: 'upload',
        description: isFolder
          ? `uploaded project folder (${allFiles.length} files)`
          : isArchive
            ? `uploaded archive ${singleName}`
            : `uploaded ${singleName}`,
      },
    })
    const dest = store.projectDir(project.id)
    fs.mkdirSync(dest, { recursive: true })

    let fileCount = 0

    if (isFolder) {
      // Multiple files or folder upload preserving paths
      for (let i = 0; i < allFiles.length; i++) {
        const f = allFiles[i]
        const relPath = relativePaths[i] || f.name
        // Clean leading slash or ./
        const cleanRel = relPath.replace(/^(\.\/|\/)+/, '')
        const targetPath = store.safeJoin(dest, cleanRel)
        if (!targetPath) continue
        fs.mkdirSync(path.dirname(targetPath), { recursive: true })
        const buf = Buffer.from(await f.arrayBuffer())
        fs.writeFileSync(targetPath, buf)
        fileCount++
      }
    } else if (isArchive && singleFile) {
      const fileBuffer = Buffer.from(await singleFile.arrayBuffer())
      const tmp = path.join(store.DATA_DIR, `upload-${Date.now()}-${singleName}`)
      fs.mkdirSync(store.DATA_DIR, { recursive: true })
      fs.writeFileSync(tmp, fileBuffer)
      try {
        if (lowerName.endsWith('.zip')) {
          const extracted = store.extractZip(tmp, dest)
          fileCount = extracted.fileCount
        } else {
          const extracted = store.extractTarball(tmp, dest)
          fileCount = extracted.fileCount
        }
      } catch (err) {
        await db.project.delete({ where: { id: project.id } })
        return NextResponse.json(
          { error: `could not extract archive: ${err instanceof Error ? err.message : 'corrupt archive'}` },
          { status: 400 }
        )
      } finally {
        fs.rmSync(tmp, { force: true })
      }
    } else if (singleFile) {
      // Single code file (e.g. index.html)
      const fileBuffer = Buffer.from(await singleFile.arrayBuffer())
      const targetPath = path.join(dest, singleName)
      fs.writeFileSync(targetPath, fileBuffer)
      if (isHtml && singleName.toLowerCase() !== 'index.html') {
        fs.writeFileSync(path.join(dest, 'index.html'), fileBuffer)
      }
      fileCount = 1
    } else if (rawCode) {
      // Raw pasted code
      const targetPath = path.join(dest, singleName)
      fs.writeFileSync(targetPath, rawCode, 'utf8')
      if (isHtml && singleName.toLowerCase() !== 'index.html') {
        fs.writeFileSync(path.join(dest, 'index.html'), rawCode, 'utf8')
      }
      fileCount = 1
    }

    // Detection so the UI shows metadata immediately
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
    return NextResponse.json({ project, fileCount, detection: d }, { status: 201 })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'upload failed' },
      { status: 500 }
    )
  }
}
