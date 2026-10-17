'use client'

// VerifyHub — "New Verification" dialog.
// Clear 5-way launcher cards:
// 1. Git Clone (GitHub, GitLab, Bitbucket, self-hosted, direct .git)
// 2. Add Folder (Drag & drop project directory, native folder picker, or ZIP)
// 3. Add Website (Verify any live URL with Playwright browser)
// 4. HTML / Code (Write/paste code with quick interactive templates)
// 5. Sample Apps (1-click pre-bundled examples)

import { useRef, useState, useEffect, type DragEvent, type ChangeEvent } from 'react'
import { useRouter } from 'next/navigation'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Loader2,
  Github,
  Globe,
  PackageOpen,
  ArrowRight,
  Code2,
  Play,
  UploadCloud,
  Folder,
  FileCode,
  FolderUp,
  Sparkles,
  Check,
  CheckCircle2,
} from 'lucide-react'
import { apiSend, apiUpload, type Project, type DetectionResult, type Run } from '@/lib/vh-api'
import { ErrorNote } from '@/components/verifyhub/bits'
import { cn } from '@/lib/utils'

interface ExampleMeta {
  id: string
  name: string
  description: string
  language: string
  framework: string
}

type VerificationTab = 'git' | 'folder' | 'website' | 'code' | 'example'

export interface HtmlTemplate {
  id: string
  title: string
  description: string
  fileName: string
  defaultName: string
  code: string
}

export const HTML_TEMPLATES: HtmlTemplate[] = [
  {
    id: 'minimal',
    title: 'Clean HTML5 Starter',
    description: 'Clean, lightweight boilerplate with button click test',
    fileName: 'index.html',
    defaultName: 'HTML5 Web App',
    code: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>My Web App</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #09090b; color: #f4f4f5; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 1rem; }
    .card { background: #18181b; border: 1px solid #27272a; padding: 2rem; border-radius: 0.75rem; text-align: center; max-width: 420px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
    h1 { color: #10b981; margin-bottom: 0.5rem; font-size: 1.5rem; }
    p { color: #a1a1aa; font-size: 0.9rem; line-height: 1.5; margin-bottom: 1.25rem; }
    button { background: #10b981; color: white; border: none; padding: 0.65rem 1.25rem; border-radius: 0.5rem; font-weight: 600; cursor: pointer; transition: background 0.15s; }
    button:hover { background: #059669; }
  </style>
</head>
<body>
  <div class="card">
    <h1>VerifyHub Ready</h1>
    <p>This application executes directly with automated browser testing, screenshot captures, and session video recording.</p>
    <button onclick="this.innerText='Verified Live!'">Click to Test Interaction</button>
  </div>
</body>
</html>`,
  },
  {
    id: 'modern-app',
    title: 'Interactive Web App',
    description: 'Glassmorphic card with live counter, reactive status badge, and modal dialog',
    fileName: 'index.html',
    defaultName: 'Interactive Web Application',
    code: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Interactive App</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #09090b; color: #fff; min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; margin: 0; padding: 1.5rem; }
    .box { background: #18181b; border: 1px solid #27272a; border-radius: 1rem; padding: 2rem; max-width: 480px; width: 100%; text-align: center; }
    .badge { background: rgba(16,185,129,0.15); color: #34d399; padding: 0.25rem 0.65rem; border-radius: 999px; font-size: 0.75rem; font-weight: 600; }
    h1 { font-size: 1.75rem; margin: 0.75rem 0 0.5rem; }
    p { color: #a1a1aa; font-size: 0.9rem; line-height: 1.5; margin-bottom: 1.5rem; }
    .counter { font-size: 2rem; font-weight: 700; color: #38bdf8; margin-bottom: 1rem; }
    .btn-row { display: flex; gap: 0.5rem; justify-content: center; }
    button { background: #10b981; color: white; border: none; padding: 0.6rem 1.2rem; border-radius: 0.5rem; font-weight: 600; cursor: pointer; }
    button.sec { background: #27272a; color: #e4e4e7; }
  </style>
</head>
<body>
  <div class="box">
    <span class="badge">● Automated Verification</span>
    <h1>Interactive App</h1>
    <p>Playwright navigates the DOM, verifies user interactions, and captures multi-viewport evidence.</p>
    <div class="counter" id="num">0</div>
    <div class="btn-row">
      <button onclick="document.getElementById('num').innerText = ++count">Count +</button>
      <button class="sec" onclick="document.getElementById('num').innerText = count > 0 ? --count : 0">Count -</button>
      <button class="sec" onclick="alert('Dialog triggered')">Modal</button>
    </div>
  </div>
  <script>let count = 0;</script>
</body>
</html>`,
  },
  {
    id: 'saas-dashboard',
    title: 'SaaS Dashboard',
    description: 'Analytics metrics, responsive charts, filterable status list',
    fileName: 'index.html',
    defaultName: 'SaaS Analytics Dashboard',
    code: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SaaS Dashboard</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: system-ui, sans-serif; }
    body { background: #0a0a0c; color: #f4f4f5; padding: 2rem 1.5rem; }
    .header { max-width: 900px; margin: 0 auto 1.5rem; display: flex; justify-content: space-between; align-items: center; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; max-width: 900px; margin: 0 auto 1.5rem; }
    .card { background: #141418; border: 1px solid #27272a; border-radius: 0.75rem; padding: 1.25rem; }
    .num { font-size: 1.75rem; font-weight: 800; color: #10b981; margin-top: 0.25rem; }
    button { background: #10b981; color: white; border: none; padding: 0.5rem 1rem; border-radius: 0.5rem; font-weight: 600; cursor: pointer; }
  </style>
</head>
<body>
  <div class="header">
    <h2>Analytics Dashboard</h2>
    <button onclick="alert('Export ready!')">Export Report</button>
  </div>
  <div class="grid">
    <div class="card"><div style="color: #71717a; font-size: 0.8rem;">Pass Rate</div><div class="num">99.4%</div></div>
    <div class="card"><div style="color: #71717a; font-size: 0.8rem;">Average Latency</div><div class="num" style="color: #38bdf8;">142ms</div></div>
    <div class="card"><div style="color: #71717a; font-size: 0.8rem;">Active Sessions</div><div class="num" style="color: #f59e0b;">24</div></div>
  </div>
</body>
</html>`,
  },
  {
    id: 'feedback-form',
    title: 'Contact Form',
    description: 'HTML5 form with client-side validation and success feedback banner',
    fileName: 'index.html',
    defaultName: 'Contact & Validation Form',
    code: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Contact Form</title>
  <style>
    body { background: #0b0f19; color: #f8fafc; font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 1rem; }
    .box { background: #111827; border: 1px solid #1f2937; border-radius: 1rem; padding: 2rem; width: 100%; max-width: 440px; }
    input, textarea { width: 100%; background: #1e293b; border: 1px solid #334155; border-radius: 0.5rem; padding: 0.65rem; color: #fff; margin: 0.4rem 0 1rem; box-sizing: border-box; }
    button { width: 100%; background: #0284c7; color: white; border: none; padding: 0.75rem; border-radius: 0.5rem; font-weight: 600; cursor: pointer; }
    .ok { display: none; background: rgba(16,185,129,0.2); border: 1px solid #10b981; color: #6ee7b7; padding: 0.75rem; border-radius: 0.5rem; text-align: center; margin-top: 1rem; }
  </style>
</head>
<body>
  <div class="box">
    <h3>Feedback & Verification</h3>
    <form onsubmit="event.preventDefault(); document.getElementById('ok').style.display='block';">
      <label>Name</label><input type="text" required placeholder="Jane Doe">
      <label>Email</label><input type="email" required placeholder="jane@example.com">
      <button type="submit">Submit Form</button>
      <div class="ok" id="ok">Form submitted successfully!</div>
    </form>
  </div>
</body>
</html>`,
  },
]

async function fetchExamples(): Promise<ExampleMeta[]> {
  const res = await fetch('/api/v1/examples', { cache: 'no-store' })
  if (!res.ok) return []
  const data = (await res.json()) as { examples: ExampleMeta[] }
  return data.examples
}

export function NewVerificationDialog({ open, onOpenChange }: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Default active tab is Git Clone so the user immediately sees Git/Folder/Website options
  const [activeTab, setActiveTab] = useState<VerificationTab>('git')

  useEffect(() => {
    if (open) {
      setActiveTab('git')
      setError(null)
    }
  }, [open])

  // 1. Git URL State
  const [gitUrl, setGitUrl] = useState('')
  const [gitBranch, setGitBranch] = useState('')
  const [gitProjectName, setGitProjectName] = useState('')

  // 2. Folder Drop & Upload State
  const folderInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [uploadedFiles, setUploadedFiles] = useState<Array<{ file: File; path: string }>>([])
  const [uploadName, setUploadName] = useState('')
  const [localPathInput, setLocalPathInput] = useState('')

  // 3. Live Website State
  const [liveUrl, setLiveUrl] = useState('')
  const [websiteName, setWebsiteName] = useState('')

  // 4. HTML / Code State
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('minimal')
  const [snippetCode, setSnippetCode] = useState<string>(HTML_TEMPLATES[0].code)
  const [snippetFileName, setSnippetFileName] = useState<string>('index.html')
  const [snippetName, setSnippetName] = useState<string>('HTML5 Web App')

  // 5. Examples State
  const [examples, setExamples] = useState<ExampleMeta[] | null>(null)

  // Automation Engine and verification settings
  const [engine, setEngine] = useState<'playwright-firefox' | 'playwright-chromium' | 'kane' | 'auto'>('playwright-firefox')
  const [recordVideo, setRecordVideo] = useState(true)
  const [autoRun, setAutoRun] = useState(true)

  const selectedEngine = engine === 'playwright-firefox' ? 'playwright' : engine === 'playwright-chromium' ? 'playwright' : engine
  const selectedBrowser = engine === 'playwright-chromium' ? 'chromium' : 'firefox'
  const configYaml = `version: 1\nverification:\n  engine: ${selectedEngine}\n  browser: ${selectedBrowser}\n  recordVideo: ${recordVideo}\n`

  const visible = open
  if (visible && examples === null && !busy) {
    setExamples([])
    fetchExamples().then(setExamples).catch(() => setExamples([]))
  }

  const selectTemplate = (template: HtmlTemplate) => {
    setSelectedTemplateId(template.id)
    setSnippetCode(template.code)
    setSnippetFileName(template.fileName)
    setSnippetName(template.defaultName)
  }

  const closeAndGo = (projectId?: string) => {
    onOpenChange(false)
    if (projectId) router.push(`/projects/${projectId}`)
    else router.refresh()
  }

  const handleCreatedProject = async (projectId: string) => {
    if (autoRun) {
      try {
        const { run } = await apiSend<{ run: Run }>(`/api/v1/projects/${projectId}/runs`, 'POST', {
          engine: selectedEngine,
          browser: selectedBrowser,
          recordVideo,
        })
        onOpenChange(false)
        router.push(`/runs/${run.id}`)
        return
      } catch {
        // fallback to project page
      }
    }
    closeAndGo(projectId)
  }

  // 1. Submit Git Repository
  const createGit = async () => {
    if (!gitUrl.trim()) {
      setError('provide a Git repository URL')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const { project } = await apiSend<{ project: Project }>('/api/v1/projects', 'POST', {
        sourceType: 'github',
        sourceUrl: gitUrl.trim(),
        branch: gitBranch.trim() || undefined,
        name: gitProjectName.trim() || undefined,
        config: configYaml,
      })
      await handleCreatedProject(project.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to add repository')
    } finally {
      setBusy(false)
    }
  }

  // 2. Submit Folder or Uploaded Files
  const uploadFiles = async () => {
    if (uploadedFiles.length === 0) {
      setError('choose a folder or file first')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const fd = new FormData()
      for (const item of uploadedFiles) {
        fd.append('files', item.file)
        fd.append('paths', item.path)
      }
      if (uploadName.trim()) fd.append('name', uploadName.trim())
      const { project } = await apiUpload<{ project: Project; fileCount: number; detection: DetectionResult }>(
        '/api/v1/upload',
        fd
      )
      await handleCreatedProject(project.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'upload failed')
    } finally {
      setBusy(false)
    }
  }

  // 2b. Submit Local Server Path
  const importLocalPath = async () => {
    if (!localPathInput.trim()) {
      setError('enter a local project path')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const { project } = await apiSend<{ project: Project }>('/api/v1/projects', 'POST', {
        sourceType: 'local',
        localPath: localPathInput.trim(),
        name: uploadName.trim() || undefined,
        config: configYaml,
      })
      await handleCreatedProject(project.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to import local folder')
    } finally {
      setBusy(false)
    }
  }

  // 3. Submit Live Website
  const createWebsite = async () => {
    let url = liveUrl.trim()
    if (!url) {
      setError('provide a website URL')
      return
    }
    if (!/^https?:\/\//i.test(url)) {
      url = 'https://' + url
    }
    setBusy(true)
    setError(null)
    try {
      const { project } = await apiSend<{ project: Project }>('/api/v1/projects', 'POST', {
        sourceType: 'url',
        sourceUrl: url,
        name: websiteName.trim() || undefined,
        config: configYaml,
      })
      await handleCreatedProject(project.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to add website')
    } finally {
      setBusy(false)
    }
  }

  // 4. Submit HTML / Code Snippet
  const createSnippet = async () => {
    if (!snippetCode.trim()) {
      setError('paste or write HTML / code first')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const { project } = await apiSend<{ project: Project }>('/api/v1/projects', 'POST', {
        sourceType: 'code',
        code: snippetCode,
        fileName: snippetFileName.trim() || 'index.html',
        name: snippetName.trim() || undefined,
        config: configYaml,
      })
      await handleCreatedProject(project.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to create project')
    } finally {
      setBusy(false)
    }
  }

  // 5. Submit Bundled Example
  const createExample = async (exampleId: string) => {
    setBusy(true)
    setError(null)
    try {
      const { project } = await apiSend<{ project: Project }>('/api/v1/projects', 'POST', {
        sourceType: 'example',
        exampleId,
        config: configYaml,
      })
      await handleCreatedProject(project.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to load example')
    } finally {
      setBusy(false)
    }
  }

  // Handlers for folder drag & drop
  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(true)
  }

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
  }

  const handleDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)

    const items = e.dataTransfer.items
    if (!items || items.length === 0) return

    const collected: Array<{ file: File; path: string }> = []
    const traverseEntry = async (entry: any, currentPath = '') => {
      if (entry.isFile) {
        await new Promise<void>((resolve) => {
          entry.file((file: File) => {
            collected.push({ file, path: currentPath ? `${currentPath}/${file.name}` : file.name })
            resolve()
          })
        })
      } else if (entry.isDirectory) {
        const dirReader = entry.createReader()
        const readAll = async () => {
          await new Promise<void>((resolve) => {
            dirReader.readEntries(async (entries: any[]) => {
              if (entries.length === 0) {
                resolve()
                return
              }
              for (const child of entries) {
                await traverseEntry(child, currentPath ? `${currentPath}/${entry.name}` : entry.name)
              }
              await readAll()
              resolve()
            })
          })
        }
        await readAll()
      }
    }

    setBusy(true)
    try {
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        const entry = (item as any).webkitGetAsEntry ? (item as any).webkitGetAsEntry() : null
        if (entry) {
          await traverseEntry(entry)
        } else {
          const f = item.getAsFile()
          if (f) collected.push({ file: f, path: f.name })
        }
      }
      setUploadedFiles(collected)
      if (collected.length > 0 && !uploadName) {
        const first = collected[0].path.split('/')[0]
        setUploadName(first || 'Dropped Project')
      }
    } finally {
      setBusy(false)
    }
  }

  const handleFolderSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    const items: Array<{ file: File; path: string }> = []
    for (let i = 0; i < files.length; i++) {
      const f = files[i]
      items.push({ file: f, path: f.webkitRelativePath || f.name })
    }
    setUploadedFiles(items)
    const topName = items[0]?.path.split('/')[0]
    if (topName && !uploadName) setUploadName(topName)
  }

  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    const items: Array<{ file: File; path: string }> = []
    for (let i = 0; i < files.length; i++) {
      const f = files[i]
      items.push({ file: f, path: f.name })
    }
    setUploadedFiles(items)
    if (items[0] && !uploadName) {
      setUploadName(items[0].file.name.replace(/\.[^.]+$/, ''))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl sm:max-w-3xl max-h-[92vh] overflow-y-auto border-border bg-[#111114] text-foreground p-6">
        <DialogHeader className="mb-2">
          <DialogTitle className="flex items-center gap-2 text-base font-semibold">
            <Sparkles className="h-4 w-4 text-emerald-400" />
            New Verification
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Choose how you want to add your project or website for automated verification.
          </DialogDescription>
        </DialogHeader>

        {/* PROMINENT 5-CARD METHOD SELECTOR */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 my-2">
          {/* Card 1: Git Clone */}
          <button
            type="button"
            onClick={() => { setActiveTab('git'); setError(null); }}
            className={cn(
              'group relative flex flex-col items-start rounded-xl border p-3 text-left transition-all',
              activeTab === 'git'
                ? 'border-emerald-500 bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/50'
                : 'border-border/80 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700 hover:bg-zinc-900'
            )}
          >
            <div className="flex w-full items-center justify-between mb-1.5">
              <div className={cn(
                'rounded-lg p-2 transition-colors',
                activeTab === 'git' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-zinc-800 text-zinc-400 group-hover:text-emerald-400'
              )}>
                <Github className="h-4 w-4" />
              </div>
              {activeTab === 'git' && (
                <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#10b981]" />
              )}
            </div>
            <span className="font-semibold text-xs text-foreground">Git Clone</span>
            <span className="text-[10px] text-muted-foreground mt-0.5 line-clamp-1">GitHub, GitLab, Git</span>
          </button>

          {/* Card 2: Add Folder */}
          <button
            type="button"
            onClick={() => { setActiveTab('folder'); setError(null); }}
            className={cn(
              'group relative flex flex-col items-start rounded-xl border p-3 text-left transition-all',
              activeTab === 'folder'
                ? 'border-sky-500 bg-sky-500/10 text-sky-300 ring-1 ring-sky-500/50'
                : 'border-border/80 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700 hover:bg-zinc-900'
            )}
          >
            <div className="flex w-full items-center justify-between mb-1.5">
              <div className={cn(
                'rounded-lg p-2 transition-colors',
                activeTab === 'folder' ? 'bg-sky-500/20 text-sky-400' : 'bg-zinc-800 text-zinc-400 group-hover:text-sky-400'
              )}>
                <FolderUp className="h-4 w-4" />
              </div>
              {activeTab === 'folder' && (
                <span className="h-2 w-2 rounded-full bg-sky-400 shadow-[0_0_8px_#38bdf8]" />
              )}
            </div>
            <span className="font-semibold text-xs text-foreground">Add Folder</span>
            <span className="text-[10px] text-muted-foreground mt-0.5 line-clamp-1">Drop, browse, or ZIP</span>
          </button>

          {/* Card 3: Add Website */}
          <button
            type="button"
            onClick={() => { setActiveTab('website'); setError(null); }}
            className={cn(
              'group relative flex flex-col items-start rounded-xl border p-3 text-left transition-all',
              activeTab === 'website'
                ? 'border-purple-500 bg-purple-500/10 text-purple-300 ring-1 ring-purple-500/50'
                : 'border-border/80 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700 hover:bg-zinc-900'
            )}
          >
            <div className="flex w-full items-center justify-between mb-1.5">
              <div className={cn(
                'rounded-lg p-2 transition-colors',
                activeTab === 'website' ? 'bg-purple-500/20 text-purple-400' : 'bg-zinc-800 text-zinc-400 group-hover:text-purple-400'
              )}>
                <Globe className="h-4 w-4" />
              </div>
              {activeTab === 'website' && (
                <span className="h-2 w-2 rounded-full bg-purple-400 shadow-[0_0_8px_#a855f7]" />
              )}
            </div>
            <span className="font-semibold text-xs text-foreground">Add Website</span>
            <span className="text-[10px] text-muted-foreground mt-0.5 line-clamp-1">Live URL & web apps</span>
          </button>

          {/* Card 4: HTML / Code */}
          <button
            type="button"
            onClick={() => { setActiveTab('code'); setError(null); }}
            className={cn(
              'group relative flex flex-col items-start rounded-xl border p-3 text-left transition-all',
              activeTab === 'code'
                ? 'border-amber-500 bg-amber-500/10 text-amber-300 ring-1 ring-amber-500/50'
                : 'border-border/80 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700 hover:bg-zinc-900'
            )}
          >
            <div className="flex w-full items-center justify-between mb-1.5">
              <div className={cn(
                'rounded-lg p-2 transition-colors',
                activeTab === 'code' ? 'bg-amber-500/20 text-amber-400' : 'bg-zinc-800 text-zinc-400 group-hover:text-amber-400'
              )}>
                <Code2 className="h-4 w-4" />
              </div>
              {activeTab === 'code' && (
                <span className="h-2 w-2 rounded-full bg-amber-400 shadow-[0_0_8px_#f59e0b]" />
              )}
            </div>
            <span className="font-semibold text-xs text-foreground">HTML / Code</span>
            <span className="text-[10px] text-muted-foreground mt-0.5 line-clamp-1">Snippets & templates</span>
          </button>

          {/* Card 5: Sample Apps */}
          <button
            type="button"
            onClick={() => { setActiveTab('example'); setError(null); }}
            className={cn(
              'group relative flex flex-col items-start rounded-xl border p-3 text-left transition-all col-span-2 sm:col-span-1',
              activeTab === 'example'
                ? 'border-rose-500 bg-rose-500/10 text-rose-300 ring-1 ring-rose-500/50'
                : 'border-border/80 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700 hover:bg-zinc-900'
            )}
          >
            <div className="flex w-full items-center justify-between mb-1.5">
              <div className={cn(
                'rounded-lg p-2 transition-colors',
                activeTab === 'example' ? 'bg-rose-500/20 text-rose-400' : 'bg-zinc-800 text-zinc-400 group-hover:text-rose-400'
              )}>
                <PackageOpen className="h-4 w-4" />
              </div>
              {activeTab === 'example' && (
                <span className="h-2 w-2 rounded-full bg-rose-400 shadow-[0_0_8px_#f43f5e]" />
              )}
            </div>
            <span className="font-semibold text-xs text-foreground">Sample Apps</span>
            <span className="text-[10px] text-muted-foreground mt-0.5 line-clamp-1">1-click demos</span>
          </button>
        </div>

        {error && (
          <div className="my-2">
            <ErrorNote error={error} />
          </div>
        )}

        {/* ---------------- SECTION 1: GIT CLONE ---------------- */}
        {activeTab === 'git' && (
          <div className="space-y-3.5 pt-1">
            <div className="rounded-lg border border-border/80 bg-zinc-950/60 p-4 space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="repo" className="text-xs font-medium text-foreground">
                  Git Repository URL
                </Label>
                <Input
                  id="repo"
                  placeholder="https://github.com/owner/repo or https://gitlab.com/owner/repo"
                  value={gitUrl}
                  onChange={(e) => setGitUrl(e.target.value)}
                  className="bg-zinc-900 font-mono text-xs"
                />
                <p className="text-[11px] text-muted-foreground">
                  Supports GitHub, GitLab, Bitbucket, self-hosted Git repositories, and direct .git clone URLs.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="branch" className="text-xs">Branch <span className="text-muted-foreground">(optional)</span></Label>
                  <Input
                    id="branch"
                    placeholder="main"
                    value={gitBranch}
                    onChange={(e) => setGitBranch(e.target.value)}
                    className="bg-zinc-900 font-mono text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="gitpname" className="text-xs">Project Name <span className="text-muted-foreground">(optional)</span></Label>
                  <Input
                    id="gitpname"
                    placeholder="Auto-derived from repo"
                    value={gitProjectName}
                    onChange={(e) => setGitProjectName(e.target.value)}
                    className="bg-zinc-900 text-xs"
                  />
                </div>
              </div>

              <div className="space-y-1.5 pt-1">
                <span className="text-[11px] text-muted-foreground">Quick test repositories:</span>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    ['taiwoade-hub/verifyhub', 'VerifyHub Core'],
                    ['https://github.com/tastejs/todomvc.git', 'TodoMVC App'],
                  ].map(([url, label]) => (
                    <button
                      key={url}
                      type="button"
                      onClick={() => setGitUrl(url)}
                      className="rounded border border-border bg-zinc-900 px-2 py-0.5 text-[10.5px] text-zinc-300 hover:border-emerald-500/50 hover:text-emerald-400"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <EngineOptionsBox
              engine={engine}
              setEngine={setEngine}
              recordVideo={recordVideo}
              setRecordVideo={setRecordVideo}
              autoRun={autoRun}
              setAutoRun={setAutoRun}
            />

            <Button
              onClick={createGit}
              disabled={busy || !gitUrl.trim()}
              className="w-full gap-2 bg-emerald-600 text-white hover:bg-emerald-500 h-9 font-medium"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Clone Repository & Launch Verification
            </Button>
          </div>
        )}

        {/* ---------------- SECTION 2: ADD FOLDER ---------------- */}
        {activeTab === 'folder' && (
          <div className="space-y-3.5 pt-1">
            {/* Drag and Drop Box */}
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => folderInputRef.current?.click()}
              className={cn(
                'relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition-all cursor-pointer',
                dragOver
                  ? 'border-sky-500 bg-sky-500/10'
                  : uploadedFiles.length > 0
                    ? 'border-sky-500/60 bg-zinc-900/80'
                    : 'border-border/80 bg-zinc-950/60 hover:border-zinc-600 hover:bg-zinc-900/40'
              )}
            >
              <div className="grid h-12 w-12 place-items-center rounded-full bg-zinc-900 border border-border mb-2">
                <UploadCloud className={cn('h-6 w-6', dragOver || uploadedFiles.length > 0 ? 'text-sky-400' : 'text-zinc-400')} />
              </div>
              <p className="text-sm font-medium text-foreground">
                {uploadedFiles.length > 0
                  ? `Selected: ${uploadedFiles.length} file${uploadedFiles.length > 1 ? 's' : ''}`
                  : 'Drag & drop a project folder here, or click to browse'}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Drag a complete project directory, an archive (.zip / .tar.gz), or choose below
              </p>

              {uploadedFiles.length > 0 && (
                <div className="mt-2.5 flex flex-wrap items-center justify-center gap-1 max-h-16 overflow-y-auto px-4">
                  {uploadedFiles.slice(0, 4).map((f, i) => (
                    <span key={i} className="rounded bg-zinc-800 px-2 py-0.5 text-[10.5px] font-mono text-zinc-300">
                      {f.path}
                    </span>
                  ))}
                  {uploadedFiles.length > 4 && (
                    <span className="text-[10.5px] text-zinc-500">+{uploadedFiles.length - 4} more files</span>
                  )}
                </div>
              )}
            </div>

            {/* Hidden native pickers */}
            <input
              ref={folderInputRef}
              type="file"
              // @ts-expect-error webkitdirectory is standard in modern browsers
              webkitdirectory=""
              directory=""
              multiple
              className="hidden"
              onChange={handleFolderSelect}
            />
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip,.tar,.tar.gz,.tgz,.html,.htm,.js,.py,.php,.ts,text/*"
              multiple
              className="hidden"
              onChange={handleFileSelect}
            />

            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => folderInputRef.current?.click()}
                className="gap-1.5 text-xs border-border bg-zinc-900 hover:bg-zinc-800"
              >
                <Folder className="h-3.5 w-3.5 text-sky-400" />
                Select Project Folder from Computer
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                className="gap-1.5 text-xs border-border bg-zinc-900 hover:bg-zinc-800"
              >
                <FileCode className="h-3.5 w-3.5 text-emerald-400" />
                Select ZIP / Archive File
              </Button>
            </div>

            {/* Local Server Path Option */}
            <div className="rounded-lg border border-border/70 bg-zinc-900/40 p-3 space-y-2">
              <Label htmlFor="lpath" className="text-xs flex items-center justify-between">
                <span>Or import local directory from server</span>
                <span className="text-[10.5px] text-muted-foreground font-normal">e.g. /home/user/my-app</span>
              </Label>
              <div className="flex gap-2">
                <Input
                  id="lpath"
                  placeholder="/path/to/local/project"
                  value={localPathInput}
                  onChange={(e) => setLocalPathInput(e.target.value)}
                  className="bg-zinc-900 text-xs font-mono"
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={importLocalPath}
                  disabled={busy || !localPathInput.trim()}
                  className="shrink-0 text-xs h-9 bg-zinc-800 hover:bg-zinc-700 text-foreground"
                >
                  Import Path
                </Button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="upname" className="text-xs">Project Name <span className="text-muted-foreground">(optional)</span></Label>
              <Input
                id="upname"
                placeholder="My Project App"
                value={uploadName}
                onChange={(e) => setUploadName(e.target.value)}
                className="bg-zinc-900 text-xs"
              />
            </div>

            <EngineOptionsBox
              engine={engine}
              setEngine={setEngine}
              recordVideo={recordVideo}
              setRecordVideo={setRecordVideo}
              autoRun={autoRun}
              setAutoRun={setAutoRun}
            />

            <Button
              onClick={uploadFiles}
              disabled={busy || uploadedFiles.length === 0}
              className="w-full gap-2 bg-sky-600 text-white hover:bg-sky-500 h-9 font-medium"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Upload Folder & Launch Verification
            </Button>
          </div>
        )}

        {/* ---------------- SECTION 3: ADD WEBSITE ---------------- */}
        {activeTab === 'website' && (
          <div className="space-y-3.5 pt-1">
            <div className="rounded-lg border border-border/80 bg-zinc-950/60 p-4 space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="url" className="text-xs font-medium text-foreground">
                  Public Website URL
                </Label>
                <Input
                  id="url"
                  placeholder="https://example.com"
                  value={liveUrl}
                  onChange={(e) => setLiveUrl(e.target.value)}
                  className="bg-zinc-900 font-mono text-xs"
                />
                <p className="text-[11px] text-muted-foreground">
                  Playwright navigates the site, records session video (.webm), captures multi-device screenshots, and checks for console & network errors.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="urlname" className="text-xs">Display Name <span className="text-muted-foreground">(optional)</span></Label>
                <Input
                  id="urlname"
                  placeholder="Auto-derived from hostname"
                  value={websiteName}
                  onChange={(e) => setWebsiteName(e.target.value)}
                  className="bg-zinc-900 text-xs"
                />
              </div>

              <div className="space-y-1.5 pt-1">
                <span className="text-[11px] text-muted-foreground">Quick test websites:</span>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    'https://news.ycombinator.com',
                    'https://example.com',
                    'https://playwright.dev',
                  ].map((site) => (
                    <button
                      key={site}
                      type="button"
                      onClick={() => setLiveUrl(site)}
                      className="rounded border border-border bg-zinc-900 px-2 py-0.5 text-[10.5px] text-zinc-300 hover:border-purple-500/50 hover:text-purple-400"
                    >
                      {site}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <EngineOptionsBox
              engine={engine}
              setEngine={setEngine}
              recordVideo={recordVideo}
              setRecordVideo={setRecordVideo}
              autoRun={autoRun}
              setAutoRun={setAutoRun}
            />

            <Button
              onClick={createWebsite}
              disabled={busy || !liveUrl.trim()}
              className="w-full gap-2 bg-purple-600 text-white hover:bg-purple-500 h-9 font-medium"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Launch Website Verification Run
            </Button>
          </div>
        )}

        {/* ---------------- SECTION 4: HTML / CODE ---------------- */}
        {activeTab === 'code' && (
          <div className="space-y-3.5 pt-1">
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Starter Templates</Label>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                {HTML_TEMPLATES.map((tpl) => (
                  <button
                    key={tpl.id}
                    type="button"
                    onClick={() => selectTemplate(tpl)}
                    className={cn(
                      'flex flex-col items-start rounded-lg border p-2 text-left transition-all',
                      selectedTemplateId === tpl.id
                        ? 'border-amber-500 bg-amber-500/10 text-amber-300 ring-1 ring-amber-500/40'
                        : 'border-border bg-zinc-900/60 text-zinc-400 hover:border-zinc-700 hover:bg-zinc-900'
                    )}
                  >
                    <div className="flex w-full items-center justify-between">
                      <span className="font-medium text-xs text-foreground">{tpl.title}</span>
                      {selectedTemplateId === tpl.id && <Check className="h-3 w-3 text-amber-400" />}
                    </div>
                    <span className="mt-0.5 line-clamp-1 text-[10px] text-muted-foreground">{tpl.description}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-2">
              <div className="flex-1 space-y-1">
                <Label htmlFor="sname" className="text-xs">Project Name</Label>
                <Input
                  id="sname"
                  placeholder="My HTML Web App"
                  value={snippetName}
                  onChange={(e) => setSnippetName(e.target.value)}
                  className="bg-zinc-900 text-xs"
                />
              </div>
              <div className="w-[140px] space-y-1">
                <Label htmlFor="sfile" className="text-xs">Entry File</Label>
                <Input
                  id="sfile"
                  value={snippetFileName}
                  onChange={(e) => setSnippetFileName(e.target.value)}
                  className="bg-zinc-900 font-mono text-xs"
                />
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label htmlFor="scode" className="text-xs">HTML / Code Editor</Label>
                <span className="text-[10.5px] text-zinc-500">Served instantly via VerifyHub sandbox</span>
              </div>
              <Textarea
                id="scode"
                rows={6}
                value={snippetCode}
                onChange={(e) => setSnippetCode(e.target.value)}
                placeholder="<!DOCTYPE html>..."
                className="font-mono text-xs leading-relaxed bg-[#0a0a0c] border-border resize-y max-h-48"
              />
            </div>

            <EngineOptionsBox
              engine={engine}
              setEngine={setEngine}
              recordVideo={recordVideo}
              setRecordVideo={setRecordVideo}
              autoRun={autoRun}
              setAutoRun={setAutoRun}
            />

            <Button
              onClick={createSnippet}
              disabled={busy || !snippetCode.trim()}
              className="w-full gap-2 bg-amber-600 text-white hover:bg-amber-500 h-9 font-medium"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Launch HTML Code Verification
            </Button>
          </div>
        )}

        {/* ---------------- SECTION 5: SAMPLE APPS ---------------- */}
        {activeTab === 'example' && (
          <div className="space-y-2.5 pt-1">
            <p className="text-xs text-muted-foreground mb-2">
              Select any pre-configured sample project to import and run immediate verification:
            </p>
            {examples === null || examples.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">Loading sample projects…</p>
            ) : (
              examples.map((ex) => (
                <button
                  key={ex.id}
                  onClick={() => createExample(ex.id)}
                  disabled={busy}
                  className="group flex w-full items-start gap-3 rounded-lg border border-border bg-zinc-900/60 p-3 text-left transition-colors hover:border-emerald-500/40 hover:bg-zinc-900 disabled:opacity-50"
                >
                  <PackageOpen className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{ex.name}</span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">{ex.description}</span>
                    <span className="mt-1 inline-block rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
                      {ex.framework}
                    </span>
                  </span>
                  <ArrowRight className="mt-1 h-3.5 w-3.5 shrink-0 text-zinc-600 transition-transform group-hover:translate-x-0.5 group-hover:text-emerald-400" />
                </button>
              ))
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function EngineOptionsBox({
  engine,
  setEngine,
  recordVideo,
  setRecordVideo,
  autoRun,
  setAutoRun,
}: {
  engine: 'playwright-firefox' | 'playwright-chromium' | 'kane' | 'auto'
  setEngine: (e: 'playwright-firefox' | 'playwright-chromium' | 'kane' | 'auto') => void
  recordVideo: boolean
  setRecordVideo: (v: boolean) => void
  autoRun: boolean
  setAutoRun: (v: boolean) => void
}) {
  return (
    <div className="rounded-lg border border-border/70 bg-zinc-950/70 p-3 space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-zinc-300">Automation Engine & Browser</span>
        <span className="font-mono text-[11px] text-emerald-400 flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3" />
          Playwright Firefox (Default)
        </span>
      </div>

      <div className="grid grid-cols-2 gap-1.5 text-xs sm:grid-cols-4">
        <button
          type="button"
          onClick={() => setEngine('playwright-firefox')}
          className={cn(
            'flex items-center justify-between rounded border px-2.5 py-1.5 text-left transition-all',
            engine === 'playwright-firefox'
              ? 'border-emerald-500 bg-emerald-500/10 text-emerald-300'
              : 'border-border bg-zinc-900 text-zinc-400 hover:bg-zinc-800'
          )}
        >
          <span className="font-medium text-[11px]">Firefox</span>
          <span className="rounded bg-emerald-500/20 px-1 py-0.5 text-[9px] font-semibold uppercase text-emerald-300">
            Default
          </span>
        </button>

        <button
          type="button"
          onClick={() => setEngine('playwright-chromium')}
          className={cn(
            'flex items-center justify-between rounded border px-2.5 py-1.5 text-left transition-all',
            engine === 'playwright-chromium'
              ? 'border-emerald-500 bg-emerald-500/10 text-emerald-300'
              : 'border-border bg-zinc-900 text-zinc-400 hover:bg-zinc-800'
          )}
        >
          <span className="font-medium text-[11px]">Chromium</span>
        </button>

        <button
          type="button"
          onClick={() => setEngine('kane')}
          className={cn(
            'flex items-center justify-between rounded border px-2.5 py-1.5 text-left transition-all',
            engine === 'kane'
              ? 'border-emerald-500 bg-emerald-500/10 text-emerald-300'
              : 'border-border bg-zinc-900 text-zinc-400 hover:bg-zinc-800'
          )}
        >
          <span className="font-medium text-[11px]">Kane CLI</span>
        </button>

        <button
          type="button"
          onClick={() => setEngine('auto')}
          className={cn(
            'flex items-center justify-between rounded border px-2.5 py-1.5 text-left transition-all',
            engine === 'auto'
              ? 'border-emerald-500 bg-emerald-500/10 text-emerald-300'
              : 'border-border bg-zinc-900 text-zinc-400 hover:bg-zinc-800'
          )}
        >
          <span className="font-medium text-[11px]">Auto</span>
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between pt-1 text-[11px] text-zinc-400 gap-2">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={recordVideo}
            onChange={(e) => setRecordVideo(e.target.checked)}
            className="rounded accent-emerald-500 h-3.5 w-3.5"
          />
          Record session video (.webm)
        </label>

        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={autoRun}
            onChange={(e) => setAutoRun(e.target.checked)}
            className="rounded accent-emerald-500 h-3.5 w-3.5"
          />
          Launch verification immediately
        </label>
      </div>
    </div>
  )
}
