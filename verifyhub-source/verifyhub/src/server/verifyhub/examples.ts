// VerifyHub — bundled example projects.
// Each example is written into the project workspace on creation and must be
// genuinely runnable by the runner (install → start → health check → verify).
// They double as end-to-end tests of the detection engine and pipeline.

export interface ExampleFile {
  path: string
  content: string
}

export interface ExampleProject {
  id: string
  name: string
  description: string
  language: string
  framework: string
  files: ExampleFile[]
}

const STATIC_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Aurora Notes — Simple notes that stay in your browser</title>
  <style>
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: ui-sans-serif, system-ui, sans-serif; background: #fafaf9; color: #1c1917; }
    header { display: flex; align-items: center; gap: 16px; padding: 18px 28px; border-bottom: 1px solid #e7e5e4; }
    .logo { width: 28px; height: 28px; border-radius: 8px; background: #0f766e; display: grid; place-items: center; color: #fff; font-weight: 700; }
    nav a { margin-left: 18px; color: #44403c; text-decoration: none; font-size: 14px; }
    nav a:hover { color: #0f766e; }
    main { max-width: 760px; margin: 0 auto; padding: 48px 24px; }
    h1 { font-size: 34px; margin: 0 0 12px; }
    p.lead { color: #57534e; font-size: 16px; line-height: 1.6; }
    .panel { margin-top: 28px; border: 1px solid #e7e5e4; border-radius: 12px; background: #fff; padding: 20px; }
    input { width: 100%; padding: 10px 12px; border: 1px solid #d6d3d1; border-radius: 8px; font-size: 14px; }
    button { margin-top: 10px; background: #0f766e; color: #fff; border: 0; border-radius: 8px; padding: 10px 16px; font-size: 14px; cursor: pointer; }
    ul { padding-left: 18px; }
    footer { padding: 24px 28px; color: #78716c; font-size: 13px; border-top: 1px solid #e7e5e4; }
  </style>
</head>
<body>
  <header>
    <div class="logo">A</div>
    <strong>Aurora Notes</strong>
    <nav>
      <a href="/">Home</a>
      <a href="/features.html">Features</a>
      <a href="/about.html">About</a>
    </nav>
  </header>
  <main>
    <h1>Notes that stay in your browser</h1>
    <p class="lead">Aurora Notes is a tiny offline-first notepad. Everything you type is stored locally — no accounts, no servers, no tracking.</p>
    <div class="panel">
      <label for="note"><strong>Quick note</strong></label>
      <input id="note" placeholder="Write something…" />
      <button onclick="save()">Save note</button>
      <ul id="notes"></ul>
    </div>
  </main>
  <footer>Aurora Notes · static example shipped with VerifyHub</footer>
  <script>
    function render() {
      const notes = JSON.parse(localStorage.getItem('aurora-notes') || '[]')
      document.getElementById('notes').innerHTML = notes.map(n => '<li>' + n + '</li>').join('')
    }
    function save() {
      const el = document.getElementById('note')
      if (!el.value.trim()) return
      const notes = JSON.parse(localStorage.getItem('aurora-notes') || '[]')
      notes.push(el.value.trim())
      localStorage.setItem('aurora-notes', JSON.stringify(notes))
      el.value = ''
      render()
    }
    render()
  </script>
</body>
</html>
`

const STATIC_FEATURES = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Features — Aurora Notes</title>
<style>body{font-family:ui-sans-serif,system-ui,sans-serif;margin:0;background:#fafaf9;color:#1c1917}
main{max-width:720px;margin:0 auto;padding:48px 24px}a{color:#0f766e}</style></head>
<body><main><h1>Features</h1><ul><li>Offline-first storage</li><li>Zero dependencies</li><li>Instant search (coming soon)</li></ul>
<p><a href="/">← Back home</a></p></main></body></html>
`

const STATIC_ABOUT = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>About — Aurora Notes</title>
<style>body{font-family:ui-sans-serif,system-ui,sans-serif;margin:0;background:#fafaf9;color:#1c1917}
main{max-width:720px;margin:0 auto;padding:48px 24px}a{color:#0f766e}</style></head>
<body><main><h1>About</h1><p>Aurora Notes is the bundled static example used to test the VerifyHub runner end to end.</p>
<p><a href="/">← Back home</a></p></main></body></html>
`

const EXPRESS_INDEX = `// Aurora Metrics — minimal Express service used as a VerifyHub example.
const express = require('express')
const app = express()
const PORT = process.env.PORT || 3000

app.use(express.json())

app.get('/', (req, res) => {
  res.type('html').send('<!doctype html><html><head><title>Aurora Metrics</title></head>' +
    '<body style="font-family:ui-monospace,monospace;padding:32px">' +
    '<h1>Aurora Metrics API</h1>' +
    '<p>Endpoints: <a href="/api/health">/api/health</a> · <a href="/api/metrics">/api/metrics</a> · /login</p>' +
    '</body></html>')
})

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'aurora-metrics', uptime: process.uptime() })
})

app.get('/api/metrics', (req, res) => {
  res.json({
    requests: Math.floor(process.uptime() * 7),
    memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    node: process.version,
  })
})

app.post('/login', (req, res) => {
  const { user } = req.body || {}
  if (!user) return res.status(400).json({ ok: false, error: 'user required' })
  res.json({ ok: true, token: 'demo-' + Buffer.from(user).toString('base64url') })
})

app.listen(PORT, () => console.log('aurora-metrics listening on port ' + PORT))
`

const EXPRESS_PKG = `{
  "name": "aurora-metrics",
  "version": "1.0.0",
  "private": true,
  "main": "index.js",
  "scripts": {
    "start": "node index.js"
  },
  "dependencies": {
    "express": "^4.19.2"
  }
}
`

const FASTAPI_MAIN = `"""Aurora Quotes — minimal FastAPI service used as a VerifyHub example."""
import os
import time
from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse

app = FastAPI(title="Aurora Quotes", version="1.0.0")
started = time.time()

QUOTES = [
    "Simplicity is the soul of efficiency.",
    "Verification is a habit, not a phase.",
    "Ship small, verify often.",
]


@app.get("/", response_class=HTMLResponse)
def home():
    return """<!doctype html><html><head><title>Aurora Quotes</title></head>
    <body style="font-family:ui-monospace,monospace;padding:32px">
    <h1>Aurora Quotes</h1>
    <p>Endpoints: <a href="/api/health">/api/health</a> · <a href="/api/quotes">/api/quotes</a> · /docs</p>
    </body></html>"""


@app.get("/api/health")
def health():
    return {"ok": True, "service": "aurora-quotes", "uptime": round(time.time() - started, 1)}


@app.get("/api/quotes")
def quotes():
    return {"count": len(QUOTES), "quotes": QUOTES}


@app.get("/api/quotes/{index}")
def quote(index: int):
    if index < 0 or index >= len(QUOTES):
        raise HTTPException(status_code=404, detail="quote not found")
    return {"index": index, "quote": QUOTES[index]}
`

const FASTAPI_REQ = `fastapi>=0.110
uvicorn[standard]>=0.29
`

const VITE_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Pulse Counter — Vite + React</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
`

const VITE_MAIN = `import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
`

const VITE_APP = `import React, { useState } from 'react'

export default function App() {
  const [count, setCount] = useState(0)
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', fontFamily: 'ui-sans-serif, system-ui' }}>
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: 28, marginBottom: 8 }}>Pulse Counter</h1>
        <p style={{ color: '#666', marginBottom: 20 }}>A minimal Vite + React example for VerifyHub.</p>
        <button
          onClick={() => setCount((c) => c + 1)}
          style={{ padding: '10px 22px', fontSize: 16, borderRadius: 10, border: '1px solid #ddd', cursor: 'pointer' }}
        >
          Count is {count}
        </button>
      </div>
    </main>
  )
}
`

const VITE_CSS = `body { margin: 0; background: #fdfdfc; color: #18181b; }
`

const VITE_PKG = `{
  "name": "pulse-counter",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.1",
    "vite": "^5.4.0"
  }
}
`

const VITE_CONFIG = `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { host: '0.0.0.0', strictPort: true },
})
`

const CONFIG_STATIC = `name: aurora-notes

verification:
  engine: kane
  instructions:
    - Open homepage
    - Test navigation

notifications:
  telegram: false
`

const CONFIG_EXPRESS = `name: aurora-metrics

verification:
  engine: kane
  instructions:
    - Open homepage
    - Test navigation
    - Test login

notifications:
  telegram: false
`

const CONFIG_FASTAPI = `name: aurora-quotes

verification:
  engine: kane
  instructions:
    - Open homepage
    - Test navigation

notifications:
  telegram: false
`

const CONFIG_VITE = `name: pulse-counter

verification:
  engine: kane
  instructions:
    - Open homepage

notifications:
  telegram: false
`

export const EXAMPLES: ExampleProject[] = [
  {
    id: 'static-html',
    name: 'Aurora Notes (Static HTML)',
    description: 'Zero-dependency static site with multi-page navigation — the fastest way to see a full VerifyHub run.',
    language: 'static',
    framework: 'Static HTML',
    files: [
      { path: 'index.html', content: STATIC_HTML },
      { path: 'features.html', content: STATIC_FEATURES },
      { path: 'about.html', content: STATIC_ABOUT },
      { path: '.verifyhub.yml', content: CONFIG_STATIC },
    ],
  },
  {
    id: 'express-api',
    name: 'Aurora Metrics (Express API)',
    description: 'Node.js + Express REST service with health, metrics and login endpoints. Tests npm install + start detection.',
    language: 'node',
    framework: 'Express',
    files: [
      { path: 'index.js', content: EXPRESS_INDEX },
      { path: 'package.json', content: EXPRESS_PKG },
      { path: '.verifyhub.yml', content: CONFIG_EXPRESS },
    ],
  },
  {
    id: 'fastapi',
    name: 'Aurora Quotes (FastAPI)',
    description: 'Python FastAPI service with JSON endpoints and OpenAPI docs. Tests pip install + uvicorn detection.',
    language: 'python',
    framework: 'FastAPI',
    files: [
      { path: 'main.py', content: FASTAPI_MAIN },
      { path: 'requirements.txt', content: FASTAPI_REQ },
      { path: '.verifyhub.yml', content: CONFIG_FASTAPI },
    ],
  },
  {
    id: 'vite-react',
    name: 'Pulse Counter (Vite + React)',
    description: 'Classic Vite + React SPA. Tests the Vite detection rule and the dev-server preview path.',
    language: 'node',
    framework: 'Vite + React',
    files: [
      { path: 'index.html', content: VITE_HTML },
      { path: 'package.json', content: VITE_PKG },
      { path: 'vite.config.js', content: VITE_CONFIG },
      { path: 'src/main.jsx', content: VITE_MAIN },
      { path: 'src/App.jsx', content: VITE_APP },
      { path: 'src/index.css', content: VITE_CSS },
      { path: '.verifyhub.yml', content: CONFIG_VITE },
    ],
  },
]
