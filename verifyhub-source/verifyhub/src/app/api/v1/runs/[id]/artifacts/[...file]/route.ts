// VerifyHub API — /api/v1/runs/[id]/artifacts/[...file]
// Serves artifact files (screenshots, videos, HTML reports, JSON data)
// with range request support for video streaming.

import { NextRequest, NextResponse } from 'next/server'
import * as path from 'path'
import * as fs from 'fs'
import * as store from '@/server/verifyhub/store'

export const dynamic = 'force-dynamic'

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; file: string[] }> }
) {
  const { id: runId, file: fileSegments } = await params
  if (!fileSegments || fileSegments.length === 0) {
    return NextResponse.json({ error: 'file path required' }, { status: 400 })
  }

  const evidenceDir = store.runEvidenceDir(runId)
  const relPath = fileSegments.join('/')
  const resolvedPath = store.safeJoin(evidenceDir, relPath)

  if (!resolvedPath || !fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) {
    // Also try looking in subdirectories if segment missed it
    const fileName = fileSegments[fileSegments.length - 1]
    const candidates = [
      path.join(evidenceDir, 'screenshots', fileName),
      path.join(evidenceDir, 'videos', fileName),
      path.join(evidenceDir, 'reports', fileName),
      path.join(evidenceDir, fileName),
    ]
    const found = candidates.find((c) => fs.existsSync(c) && fs.statSync(c).isFile())
    if (!found) {
      return NextResponse.json({ error: 'artifact not found' }, { status: 404 })
    }
    return serveFile(req, found)
  }

  return serveFile(req, resolvedPath)
}

function serveFile(req: NextRequest, filePath: string): NextResponse {
  const stat = fs.statSync(filePath)
  const ext = path.extname(filePath).toLowerCase()
  const contentType = MIME_TYPES[ext] || 'application/octet-stream'

  // Video streaming with HTTP Range header support
  const range = req.headers.get('range')
  if (range && (ext === '.webm' || ext === '.mp4')) {
    const parts = range.replace(/bytes=/, '').split('-')
    const start = parseInt(parts[0], 10)
    const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1
    const chunkSize = end - start + 1

    const fileStream = fs.createReadStream(filePath, { start, end })
    // @ts-expect-error Node readable stream to Web standard Response
    return new Response(fileStream, {
      status: 206,
      headers: {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(chunkSize),
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600',
      },
    }) as unknown as NextResponse
  }

  const fileBuffer = fs.readFileSync(filePath)
  return new NextResponse(fileBuffer, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(stat.size),
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
