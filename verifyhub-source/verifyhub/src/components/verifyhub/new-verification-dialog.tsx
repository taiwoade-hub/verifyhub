'use client'

// VerifyHub — "New Verification" dialog.
// Five entry paths: Direct HTML/Code, File/ZIP Upload, GitHub repository, Live URL, Bundled Examples.
// Creating a project lands the user on its workspace to hit "Run verification".

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Loader2, Github, FileArchive, Globe, PackageOpen, ArrowRight, Code2 } from 'lucide-react'
import { apiSend, apiUpload, type Project, type DetectionResult } from '@/lib/vh-api'
import { ErrorNote } from '@/components/verifyhub/bits'

interface ExampleMeta {
  id: string
  name: string
  description: string
  language: string
  framework: string
}

const DEFAULT_HTML_SNIPPET = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>My Web App</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .card { background: #1e293b; padding: 2.5rem; border-radius: 1rem; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5); text-align: center; max-width: 480px; }
    h1 { color: #38bdf8; margin-bottom: 0.5rem; font-size: 1.8rem; }
    p { color: #94a3b8; font-size: 1rem; line-height: 1.5; }
    button { background: #0284c7; color: white; border: none; padding: 0.75rem 1.5rem; border-radius: 0.5rem; font-weight: 600; cursor: pointer; margin-top: 1.5rem; transition: background 0.2s; }
    button:hover { background: #0369a1; }
  </style>
</head>
<body>
  <div class="card">
    <h1>VerifyHub Ready</h1>
    <p>This HTML application runs instantly. AI verification and live browser preview are fully supported.</p>
    <button onclick="alert('Verified live!')">Test Interaction</button>
  </div>
</body>
</html>`

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

  // code tab
  const [snippetCode, setSnippetCode] = useState(DEFAULT_HTML_SNIPPET)
  const [snippetFileName, setSnippetFileName] = useState('index.html')
  const [snippetName, setSnippetName] = useState('')

  // github
  const [repoUrl, setRepoUrl] = useState('')
  const [branch, setBranch] = useState('')
  // url
  const [liveUrl, setLiveUrl] = useState('')
  const [name, setName] = useState('')
  // upload
  const fileRef = useRef<HTMLInputElement>(null)
  // examples
  const [examples, setExamples] = useState<ExampleMeta[] | null>(null)

  const visible = open
  if (visible && examples === null && !busy) {
    setExamples([])
    fetchExamples().then(setExamples).catch(() => setExamples([]))
  }

  const closeAndGo = (projectId?: string) => {
    onOpenChange(false)
    if (projectId) router.push(`/projects/${projectId}`)
    else router.refresh()
  }

  const createSnippet = async () => {
    if (!snippetCode.trim()) {
      setError('paste or write HTML / code first')
      return
    }
    setBusy(true); setError(null)
    try {
      const { project } = await apiSend<{ project: Project }>('/api/v1/projects', 'POST', {
        sourceType: 'code',
        code: snippetCode,
        fileName: snippetFileName.trim() || 'index.html',
        name: snippetName.trim() || undefined,
      })
      closeAndGo(project.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed')
    } finally {
      setBusy(false)
    }
  }

  const createGithub = async () => {
    setBusy(true); setError(null)
    try {
      const { project } = await apiSend<{ project: Project }>('/api/v1/projects', 'POST', {
        sourceType: 'github',
        sourceUrl: repoUrl.trim(),
        branch: branch.trim() || undefined,
      })
      closeAndGo(project.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed')
    } finally {
      setBusy(false)
    }
  }

  const createUrl = async () => {
    setBusy(true); setError(null)
    try {
      const { project } = await apiSend<{ project: Project }>('/api/v1/projects', 'POST', {
        sourceType: 'url',
        sourceUrl: liveUrl.trim(),
        name: name.trim() || undefined,
      })
      closeAndGo(project.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed')
    } finally {
      setBusy(false)
    }
  }

  const upload = async () => {
    const file = fileRef.current?.files?.[0]
    if (!file) {
      setError('choose a file or archive (.html, .zip, etc.) first')
      return
    }
    setBusy(true); setError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      if (name.trim()) fd.append('name', name.trim())
      const { project } = await apiUpload<{ project: Project; fileCount: number; detection: DetectionResult }>(
        '/api/v1/upload',
        fd
      )
      closeAndGo(project.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'upload failed')
    } finally {
      setBusy(false)
    }
  }

  const createExample = async (exampleId: string) => {
    setBusy(true); setError(null)
    try {
      const { project } = await apiSend<{ project: Project }>('/api/v1/projects', 'POST', {
        sourceType: 'example',
        exampleId,
      })
      closeAndGo(project.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl border-border bg-[#111114] text-foreground">
        <DialogHeader>
          <DialogTitle>New verification</DialogTitle>
          <DialogDescription>
            Run and verify HTML code, full archives, GitHub repositories, or live applications.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="code" className="mt-1">
          <TabsList className="grid h-9 w-full grid-cols-5 bg-zinc-900">
            <TabsTrigger value="code" className="gap-1 text-xs"><Code2 className="h-3.5 w-3.5" />HTML / Code</TabsTrigger>
            <TabsTrigger value="upload" className="gap-1 text-xs"><FileArchive className="h-3.5 w-3.5" />Upload</TabsTrigger>
            <TabsTrigger value="github" className="gap-1 text-xs"><Github className="h-3.5 w-3.5" />GitHub</TabsTrigger>
            <TabsTrigger value="url" className="gap-1 text-xs"><Globe className="h-3.5 w-3.5" />Live URL</TabsTrigger>
            <TabsTrigger value="example" className="gap-1 text-xs"><PackageOpen className="h-3.5 w-3.5" />Examples</TabsTrigger>
          </TabsList>

          <div className="pt-4">
            {error && <div className="mb-3"><ErrorNote error={error} /></div>}

            <TabsContent value="code" className="mt-0 space-y-3">
              <div className="flex gap-3">
                <div className="flex-1 space-y-1.5">
                  <Label htmlFor="sname">Project name <span className="text-muted-foreground">(optional)</span></Label>
                  <Input
                    id="sname"
                    placeholder="My HTML App"
                    value={snippetName}
                    onChange={(e) => setSnippetName(e.target.value)}
                    className="bg-zinc-900 text-xs"
                  />
                </div>
                <div className="w-[180px] space-y-1.5">
                  <Label htmlFor="sfile">Filename</Label>
                  <Input
                    id="sfile"
                    value={snippetFileName}
                    onChange={(e) => setSnippetFileName(e.target.value)}
                    className="bg-zinc-900 font-mono text-xs"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="scode">Code / HTML Content</Label>
                  <button
                    type="button"
                    onClick={() => setSnippetCode(DEFAULT_HTML_SNIPPET)}
                    className="text-[11px] text-emerald-400 hover:underline"
                  >
                    Reset to template
                  </button>
                </div>
                <Textarea
                  id="scode"
                  rows={10}
                  value={snippetCode}
                  onChange={(e) => setSnippetCode(e.target.value)}
                  placeholder="<!DOCTYPE html>..."
                  className="font-mono text-xs leading-relaxed bg-[#0a0a0c] border-border resize-y"
                />
              </div>
              <Button onClick={createSnippet} disabled={busy || !snippetCode.trim()} className="w-full gap-2 bg-emerald-600 text-white hover:bg-emerald-500">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                Run & Verify Code
              </Button>
            </TabsContent>

            <TabsContent value="upload" className="mt-0 space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="zip">Upload file (.html, .zip, .tar.gz, any code file)</Label>
                <Input
                  id="zip"
                  ref={fileRef}
                  type="file"
                  accept=".zip,.tar,.tar.gz,.tgz,.html,.htm,.js,.py,.php,.ts,.json,text/*"
                  className="bg-zinc-900 text-xs file:mr-3 file:rounded file:border-0 file:bg-zinc-800 file:px-2 file:py-1 file:text-xs file:text-zinc-200"
                />
                <p className="text-[11px] text-muted-foreground">
                  Upload an index.html file directly, or any code archive (.zip / .tar.gz).
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="zipname">Project name <span className="text-muted-foreground">(optional)</span></Label>
                <Input id="zipname" value={name} onChange={(e) => setName(e.target.value)} className="bg-zinc-900 text-xs" />
              </div>
              <Button onClick={upload} disabled={busy} className="w-full gap-2 bg-emerald-600 text-white hover:bg-emerald-500">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileArchive className="h-4 w-4" />}
                Upload & Launch
              </Button>
            </TabsContent>

            <TabsContent value="github" className="mt-0 space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="repo">Repository URL</Label>
                <Input
                  id="repo"
                  placeholder="https://github.com/owner/repo"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  className="bg-zinc-900 font-mono text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="branch">Branch <span className="text-muted-foreground">(optional)</span></Label>
                <Input
                  id="branch"
                  placeholder="main"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  className="bg-zinc-900 font-mono text-xs"
                />
              </div>
              <Button onClick={createGithub} disabled={busy || !repoUrl.trim()} className="w-full gap-2 bg-emerald-600 text-white hover:bg-emerald-500">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                Add repository
              </Button>
            </TabsContent>

            <TabsContent value="url" className="mt-0 space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="url">Public URL of an already-running app</Label>
                <Input
                  id="url"
                  placeholder="https://example.com"
                  value={liveUrl}
                  onChange={(e) => setLiveUrl(e.target.value)}
                  className="bg-zinc-900 font-mono text-xs"
                />
                <p className="text-[11px] text-muted-foreground">
                  No runner needed — the verification engine probes the URL directly.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="urlname">Display name <span className="text-muted-foreground">(optional)</span></Label>
                <Input id="urlname" value={name} onChange={(e) => setName(e.target.value)} className="bg-zinc-900 text-xs" />
              </div>
              <Button onClick={createUrl} disabled={busy || !liveUrl.trim()} className="w-full gap-2 bg-emerald-600 text-white hover:bg-emerald-500">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                Add live URL
              </Button>
            </TabsContent>

            <TabsContent value="example" className="mt-0 space-y-2">
              {examples === null || examples.length === 0 ? (
                <p className="py-6 text-center text-xs text-muted-foreground">Loading bundled examples…</p>
              ) : (
                examples.map((ex) => (
                  <button
                    key={ex.id}
                    onClick={() => createExample(ex.id)}
                    disabled={busy}
                    className="group flex w-full items-start gap-3 rounded-lg border border-border bg-zinc-900/60 px-3 py-2.5 text-left transition-colors hover:border-emerald-500/40 hover:bg-zinc-900 disabled:opacity-50"
                  >
                    <PackageOpen className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{ex.name}</span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">{ex.description}</span>
                      <span className="mt-1 inline-block rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">{ex.framework}</span>
                    </span>
                    <ArrowRight className="mt-1 h-3.5 w-3.5 shrink-0 text-zinc-600 transition-transform group-hover:translate-x-0.5 group-hover:text-emerald-400" />
                  </button>
                ))
              )}
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
