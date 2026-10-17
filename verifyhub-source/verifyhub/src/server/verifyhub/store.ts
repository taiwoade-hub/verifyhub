// VerifyHub — workspace store. Owns the on-disk layout for projects, run
// logs and evidence. All user code lives under verifyhub-data/, never inside
// the application source tree.

import * as fs from 'fs'
import * as path from 'path'
import { execSync } from 'child_process'
import AdmZip from 'adm-zip'

export const DATA_DIR = process.env.VERIFYHUB_DATA_DIR
  ? path.resolve(process.env.VERIFYHUB_DATA_DIR)
  : path.join(process.cwd(), 'verifyhub-data')
export const PROJECTS_DIR = path.join(DATA_DIR, 'projects')
export const RUNS_DIR = path.join(DATA_DIR, 'runs')

export function ensureDirs(): void {
  for (const dir of [DATA_DIR, PROJECTS_DIR, RUNS_DIR]) {
    try {
      fs.mkdirSync(dir, { recursive: true })
    } catch (e) {
      console.warn(`[verifyhub:store] Failed to ensure dir ${dir}:`, e)
    }
  }
}

export function projectDir(projectId: string): string {
  return path.join(PROJECTS_DIR, projectId, 'src')
}

export function runDir(runId: string): string {
  return path.join(RUNS_DIR, runId)
}

export function runEvidenceDir(runId: string): string {
  return path.join(runDir(runId), 'evidence')
}

/** Resolve a relative path inside a base dir, refusing traversal outside it. */
export function safeJoin(base: string, relative: string): string | null {
  const target = path.resolve(base, '.' + path.sep + relative)
  if (!target.startsWith(path.resolve(base) + path.sep) && target !== path.resolve(base)) return null
  return target
}

export function extractZip(zipPath: string, destDir: string): { root: string; fileCount: number } {
  const zip = new AdmZip(zipPath)
  ensureDirs()
  fs.mkdirSync(destDir, { recursive: true })
  zip.extractAllTo(destDir, true)
  // Count extracted files (bounded)
  let fileCount = 0
  const walk = (dir: string, depth: number) => {
    if (depth > 8 || fileCount > 5000) return
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isFile()) fileCount++
      else if (e.isDirectory()) walk(path.join(dir, e.name), depth + 1)
    }
  }
  walk(destDir, 0)
  return { root: destDir, fileCount }
}

export function extractTarball(tarPath: string, destDir: string): { root: string; fileCount: number } {
  // GitHub tarballs are .tar.gz — use the system tar (available in the sandbox).
  fs.mkdirSync(destDir, { recursive: true })
  execSync(`tar -xzf "${tarPath}" -C "${destDir}"`, { timeout: 60_000 })
  let fileCount = 0
  const walk = (dir: string, depth: number) => {
    if (depth > 8 || fileCount > 5000) return
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isFile()) fileCount++
      else if (e.isDirectory()) walk(path.join(dir, e.name), depth + 1)
    }
  }
  walk(destDir, 0)
  return { root: destDir, fileCount }
}

export function copyDirRecursive(src: string, dest: string, maxFiles = 10_000): number {
  fs.mkdirSync(dest, { recursive: true })
  let count = 0
  const walk = (from: string, to: string, depth: number) => {
    if (depth > 12 || count >= maxFiles) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(from, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (IGNORED.has(entry.name) || entry.name.startsWith('.')) continue
      const srcPath = path.join(from, entry.name)
      const destPath = path.join(to, entry.name)
      if (entry.isDirectory()) {
        try {
          fs.mkdirSync(destPath, { recursive: true })
          walk(srcPath, destPath, depth + 1)
        } catch {
          /* ignore */
        }
      } else if (entry.isFile()) {
        try {
          fs.copyFileSync(srcPath, destPath)
          count++
        } catch {
          /* ignore */
        }
      }
    }
  }
  walk(src, dest, 0)
  return count
}

export interface FileNode {
  name: string
  path: string
  type: 'file' | 'dir'
  children?: FileNode[]
  size?: number
}

const IGNORED = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  '__pycache__',
  '.venv',
  'venv',
  '.cache',
  '.turbo',
])

export function buildTree(root: string, maxDepth = 5): FileNode[] {
  const walk = (dir: string, depth: number, rel: string): FileNode[] => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return []
    }
    const nodes: FileNode[] = []
    for (const e of entries) {
      if (e.name.startsWith('.') && e.name !== '.verifyhub.yml') continue
      if (IGNORED.has(e.name)) continue
      const childRel = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) {
        if (depth >= maxDepth) {
          nodes.push({ name: e.name, path: childRel, type: 'dir', children: [] })
        } else {
          nodes.push({
            name: e.name,
            path: childRel,
            type: 'dir',
            children: walk(path.join(dir, e.name), depth + 1, childRel),
          })
        }
      } else if (e.isFile()) {
        let size = 0
        try {
          size = fs.statSync(path.join(dir, e.name)).size
        } catch {
          /* ignore */
        }
        nodes.push({ name: e.name, path: childRel, type: 'file', size })
      }
    }
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    return nodes.slice(0, 200)
  }
  return walk(root, 0, '')
}

export function readFileIn(root: string, relative: string): { content: string; size: number } | null {
  const target = safeJoin(root, relative)
  if (!target) return null
  try {
    const stat = fs.statSync(target)
    if (!stat.isFile()) return null
    if (stat.size > 512 * 1024) {
      return { content: '// File too large to display (> 512 KB)', size: stat.size }
    }
    return { content: fs.readFileSync(target, 'utf8'), size: stat.size }
  } catch {
    return null
  }
}

export function dirSize(dir: string): number {
  let total = 0
  const walk = (d: string, depth: number) => {
    if (depth > 8) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = path.join(d, e.name)
      try {
        if (e.isFile()) total += fs.statSync(p).size
        else if (e.isDirectory()) walk(p, depth + 1)
      } catch {
        /* ignore */
      }
    }
  }
  walk(dir, 0)
  return total
}

export function rmdir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}
