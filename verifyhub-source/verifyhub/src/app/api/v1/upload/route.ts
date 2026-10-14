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
    const file = form.get('file')
    const rawCode = form.get('code') as string | null

    let fileName = 'index.html'
    let fileBuffer: Buffer

    if (file instanceof File) {
      if (file.size > 25 * 1024 * 1024) {
        return NextResponse.json({ error: 'file too large (max 25 MB)' }, { status: 413 })
      }
      fileName = file.name
      fileBuffer = Buffer.from(await file.arrayBuffer())
    } else if (rawCode && rawCode.trim()) {
      fileName = (form.get('fileName') as string | null)?.trim() || 'index.html'
      fileBuffer = Buffer.from(rawCode, 'utf8')
    } else {
      return NextResponse.json({ error: 'provide a file (.zip, .html, or code file) or paste code' }, { status: 400 })
    }

    const lowerName = fileName.toLowerCase()
    const isArchive = lowerName.endsWith('.zip') || lowerName.endsWith('.tar.gz') || lowerName.endsWith('.tgz') || lowerName.endsWith('.tar')
    const isHtml = lowerName.endsWith('.html') || lowerName.endsWith('.htm')

    const name =
      (form.get('name') as string | null)?.trim() ||
      fileName.replace(/\.(zip|tar\.gz|tgz|tar|html|htm|js|py|ts)$/i, '') ||
      'HTML Project'

    const project = await db.project.create({
      data: {
        name,
        sourceType: 'upload',
        description: isArchive ? `uploaded archive ${fileName}` : `uploaded ${fileName}`,
      },
    })
    const dest = store.projectDir(project.id)
    fs.mkdirSync(dest, { recursive: true })

    let fileCount = 1

    if (isArchive) {
      const tmp = path.join(store.DATA_DIR, `upload-${Date.now()}-${fileName}`)
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
    } else {
      // Single file upload (e.g. index.html, app.js, script.py)
      const targetPath = path.join(dest, fileName)
      fs.writeFileSync(targetPath, fileBuffer)
      // If it's an HTML file not named index.html, also write index.html copy for direct root serving
      if (isHtml && fileName.toLowerCase() !== 'index.html') {
        fs.writeFileSync(path.join(dest, 'index.html'), fileBuffer)
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
