// VerifyHub — automatic project detection engine.
// Inspects a project directory and determines language, framework, package
// manager, install/build/start commands, expected port and health-check
// strategy. Designed to run any codebase: index.html, static web, Node, Python,
// PHP, Go, Rust, and arbitrary code files.

import * as fs from 'fs'
import * as path from 'path'
import type { DetectionResult } from './types'

interface RuleContext {
  root: string
  exists: (name: string) => boolean
  read: (name: string) => string | null
  readJson: (name: string) => Record<string, unknown> | null
  findFile: (pattern: RegExp, maxDepth?: number) => string | null
}

function makeContext(root: string): RuleContext {
  const cache = new Map<string, string | null>()
  return {
    root,
    exists(name) {
      if (!cache.has(name)) {
        try {
          cache.set(name, fs.existsSync(path.join(root, name)) ? '1' : null)
        } catch {
          cache.set(name, null)
        }
      }
      return cache.get(name) === '1'
    },
    read(name) {
      try {
        if (!this.exists(name)) return null
        return fs.readFileSync(path.join(root, name), 'utf8')
      } catch {
        return null
      }
    },
    readJson(name) {
      const raw = this.read(name)
      if (!raw) return null
      try {
        return JSON.parse(raw) as Record<string, unknown>
      } catch {
        return null
      }
    },
    findFile(pattern: RegExp, maxDepth = 4): string | null {
      const walk = (dir: string, depth: number): string | null => {
        if (depth > maxDepth) return null
        let entries: fs.Dirent[]
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true })
        } catch {
          return null
        }
        for (const e of entries) {
          if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'vendor') continue
          const full = path.join(dir, e.name)
          const rel = path.relative(root, full).replace(/\\/g, '/')
          if (e.isFile() && pattern.test(e.name)) {
            return rel
          }
          if (e.isDirectory()) {
            const found = walk(full, depth + 1)
            if (found) return found
          }
        }
        return null
      }
      return walk(root, 0)
    },
  }
}

function findRootDir(startDir: string): string {
  // If the project root contains a single top-level directory, descend into it
  // (typical for GitHub tarballs and zips like `my-project-main/`).
  try {
    const entries = fs.readdirSync(startDir, { withFileTypes: true })
    const dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    const files = entries.filter((e) => e.isFile())
    if (files.length === 0 && dirs.length === 1) {
      const inner = path.join(startDir, dirs[0].name)
      return findRootDir(inner)
    }
  } catch {
    /* ignore */
  }
  return startDir
}

function listRootFiles(root: string, depth = 1): string[] {
  try {
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name)
      .slice(0, 500)
  } catch {
    return []
  }
}

function detectNode(ctx: RuleContext, files: string[]): DetectionResult | null {
  const pkg = ctx.readJson('package.json')
  if (!pkg) {
    // Check for standalone Node.js entry without package.json
    const standaloneEntry = ['index.js', 'server.js', 'app.js', 'main.js'].find((f) => ctx.exists(f))
    if (standaloneEntry) {
      return {
        language: 'node',
        framework: 'Node.js (Standalone)',
        packageManager: 'none',
        installCommand: undefined,
        buildCommand: undefined,
        startCommand: `node ${standaloneEntry}`,
        port: 3000,
        healthPath: '/',
        healthStrategy: 'http',
        files: [standaloneEntry],
        notes: [`Standalone Node.js script detected (${standaloneEntry})`],
      }
    }
    return null
  }

  const notes: string[] = []
  const used: string[] = ['package.json']
  const deps = {
    ...((pkg.dependencies as Record<string, string>) || {}),
    ...((pkg.devDependencies as Record<string, string>) || {}),
  }
  const scripts = (pkg.scripts as Record<string, string>) || {}
  const has = (d: string) => Boolean(deps[d])

  // package manager (lock files win)
  let packageManager = 'npm'
  if (ctx.exists('pnpm-lock.yaml')) packageManager = 'pnpm'
  else if (ctx.exists('yarn.lock')) packageManager = 'yarn'
  else if (ctx.exists('bun.lockb') || ctx.exists('bun.lock')) packageManager = 'bun'
  else if (ctx.exists('package-lock.json')) packageManager = 'npm'
  if (packageManager !== 'npm') used.push(`${packageManager === 'bun' ? 'bun.lock' : packageManager + '-lock.yaml'}`)

  const installCommand =
    packageManager === 'pnpm'
      ? 'pnpm install --frozen-lockfile'
      : packageManager === 'yarn'
        ? 'yarn install --frozen-lockfile'
        : packageManager === 'bun'
          ? 'bun install'
          : ctx.exists('package-lock.json')
            ? 'npm ci --no-audit --no-fund'
            : 'npm install --no-audit --no-fund'

  // framework
  let framework = 'Node.js'
  let port = 3000
  let startCommand: string | undefined
  let buildCommand: string | undefined

  if (has('next')) {
    framework = 'Next.js'
    port = 3000
    buildCommand = scripts.build ? 'npm run build' : undefined
    startCommand = scripts.start ? 'npm run start' : 'npx next start -p ${PORT}'
    notes.push('Next.js detected via package.json dependencies')
  } else if (ctx.exists('vite.config.ts') || ctx.exists('vite.config.js') || ctx.exists('vite.config.mts')) {
    framework = has('react') ? 'Vite + React' : has('vue') ? 'Vite + Vue' : 'Vite'
    used.push('vite.config.*')
    port = 5173
    buildCommand = scripts.build ? 'npm run build' : undefined
    startCommand = 'npm run dev -- --host 0.0.0.0 --port ${PORT} --strictPort'
    notes.push('Vite config detected; dev server used for preview')
  } else if (ctx.exists('angular.json')) {
    framework = 'Angular'
    used.push('angular.json')
    port = 4200
    buildCommand = scripts.build ? 'npm run build' : undefined
    startCommand = 'npx ng serve --host 0.0.0.0 --port ${PORT}'
  } else if (has('express')) {
    framework = 'Express'
    notes.push('Express detected via dependencies')
    startCommand = scripts.start ? 'npm run start' : 'node index.js'
    port = 3000
  } else if (has('fastify')) {
    framework = 'Fastify'
    startCommand = scripts.start ? 'npm run start' : 'node index.js'
    port = 3000
  } else if (has('react') || has('react-dom')) {
    framework = 'React'
    startCommand = scripts.start ? 'npm run start' : 'npx serve -l ${PORT} .'
  }

  // Prefer explicit main / scripts.start
  if (!startCommand) {
    if (scripts.start) startCommand = 'npm run start'
    else if (scripts.dev && framework === 'Node.js') startCommand = 'npm run dev'
    else if (typeof pkg.main === 'string') startCommand = `node ${pkg.main}`
    else if (ctx.exists('index.js')) startCommand = 'node index.js'
    else if (ctx.exists('server.js')) startCommand = 'node server.js'
    else if (ctx.exists('app.js')) startCommand = 'node app.js'
  }
  if (!buildCommand && scripts.build && framework !== 'Express' && framework !== 'Node.js') {
    buildCommand = 'npm run build'
  }
  if (scripts.build && !buildCommand) buildCommand = 'npm run build'

  // Honour a PORT env convention when scripts reference it
  if (startCommand && /next start|serve|fastify/.test(startCommand)) {
    startCommand = startCommand.replace(/\$\{PORT\}/g, '__PORT__')
  }

  return {
    language: 'node',
    framework,
    packageManager,
    installCommand,
    buildCommand,
    startCommand,
    port,
    healthPath: '/',
    healthStrategy: 'http',
    files: used,
    notes,
  }
}

function detectPython(ctx: RuleContext, files: string[]): DetectionResult | null {
  const req = ctx.read('requirements.txt')
  const pyproject = ctx.read('pyproject.toml')
  const pipfile = ctx.read('Pipfile')
  const standalonePy = ['main.py', 'app.py', 'server.py', 'index.py', 'api.py'].find((f) => ctx.exists(f))

  if (!req && !pyproject && !pipfile && !standalonePy) return null

  const notes: string[] = []
  const used: string[] = []
  const hay = ((req || '') + '\n' + (pyproject || '') + '\n' + (pipfile || '')).toLowerCase()

  let framework = 'Python'
  let port = 8000
  let startCommand: string | undefined

  const hasPy = (m: string) => new RegExp(`^\\s*${m}`, 'm').test(hay) || hay.includes(`"${m}"`) || hay.includes(`'${m}'`) || hay.includes(m)

  if (hasPy('fastapi')) {
    framework = 'FastAPI'
    port = 8000
    const entry = ['main.py', 'app.py'].find((f) => ctx.exists(f))
    const appVar = entry ? (fs.readFileSync(path.join(ctx.root, entry), 'utf8').match(/(\w+)\s*=\s*FastAPI\(/)?.[1] ?? 'app') : 'app'
    const moduleName = entry ? entry.replace(/\.py$/, '') : 'main'
    startCommand = `uvicorn ${moduleName}:${appVar} --host 0.0.0.0 --port __PORT__`
    used.push(entry || 'fastapi', 'requirements.txt')
    notes.push(`FastAPI app object "${appVar}" found in ${entry || 'assumed main.py'}`)
  } else if (ctx.exists('manage.py')) {
    framework = 'Django'
    port = 8000
    used.push('manage.py')
    startCommand = 'python manage.py runserver 0.0.0.0:__PORT__'
    notes.push('Django manage.py detected')
  } else if (hasPy('flask')) {
    framework = 'Flask'
    port = 5000
    const entry = ['app.py', 'main.py', 'wsgi.py'].find((f) => ctx.exists(f)) || 'app.py'
    startCommand = `python ${entry}`
    used.push(entry, 'requirements.txt')
    notes.push('Flask detected; entry assumed ' + entry)
  } else {
    const entry = standalonePy || ['main.py', 'app.py', 'server.py'].find((f) => ctx.exists(f))
    if (entry) {
      startCommand = `python ${entry}`
      used.push(entry)
      notes.push(`Python entry script "${entry}" detected`)
    }
  }

  const packageManager = pyproject ? 'pip' : 'pip'
  return {
    language: 'python',
    framework,
    packageManager,
    installCommand: req ? 'pip install -r requirements.txt' : pyproject ? 'pip install -e .' : undefined,
    buildCommand: undefined,
    startCommand,
    port,
    healthPath: '/',
    healthStrategy: 'http',
    files: used,
    notes,
  }
}

function detectOtherLanguages(ctx: RuleContext): DetectionResult | null {
  // PHP
  const phpEntry = ['index.php', 'app.php', 'server.php'].find((f) => ctx.exists(f)) || ctx.findFile(/\.php$/i)
  if (phpEntry) {
    return {
      language: 'php',
      framework: 'PHP Built-in Server',
      packageManager: ctx.exists('composer.json') ? 'composer' : 'none',
      installCommand: ctx.exists('composer.json') ? 'composer install' : undefined,
      buildCommand: undefined,
      startCommand: 'php -S 0.0.0.0:__PORT__',
      port: 8000,
      healthPath: '/',
      healthStrategy: 'http',
      files: [phpEntry],
      notes: [`PHP entry point "${phpEntry}" detected`],
    }
  }

  // Go
  if (ctx.exists('go.mod') || ctx.exists('main.go')) {
    return {
      language: 'go',
      framework: 'Go Server',
      packageManager: 'go',
      installCommand: 'go mod download',
      buildCommand: 'go build -o app .',
      startCommand: './app',
      port: 8080,
      healthPath: '/',
      healthStrategy: 'http',
      files: [ctx.exists('go.mod') ? 'go.mod' : 'main.go'],
      notes: ['Go project detected'],
    }
  }

  // Rust
  if (ctx.exists('Cargo.toml')) {
    return {
      language: 'rust',
      framework: 'Rust Cargo',
      packageManager: 'cargo',
      installCommand: undefined,
      buildCommand: 'cargo build',
      startCommand: 'cargo run',
      port: 8080,
      healthPath: '/',
      healthStrategy: 'http',
      files: ['Cargo.toml'],
      notes: ['Rust Cargo project detected'],
    }
  }

  return null
}

function detectStaticOrGeneric(ctx: RuleContext, files: string[]): DetectionResult {
  const used: string[] = []
  
  // Check for index.html in root or subfolders
  let htmlPath: string | null = null
  if (ctx.exists('index.html')) {
    htmlPath = 'index.html'
  } else if (ctx.exists('public/index.html')) {
    htmlPath = 'public/index.html'
  } else if (ctx.exists('src/index.html')) {
    htmlPath = 'src/index.html'
  } else if (ctx.exists('dist/index.html')) {
    htmlPath = 'dist/index.html'
  } else if (ctx.exists('build/index.html')) {
    htmlPath = 'build/index.html'
  } else if (ctx.exists('web/index.html')) {
    htmlPath = 'web/index.html'
  } else {
    htmlPath = ctx.findFile(/\.html?$/i)
  }

  if (htmlPath) {
    used.push(htmlPath)
  }
  if (ctx.exists('Dockerfile')) used.push('Dockerfile')
  if (ctx.exists('docker-compose.yml')) used.push('docker-compose.yml')

  const isHtml = Boolean(htmlPath)
  const frameworkName = isHtml
    ? (htmlPath === 'index.html' ? 'Static HTML / Web App' : `Static HTML (${htmlPath})`)
    : 'Static Code & Workspace Preview'

  return {
    language: 'static',
    framework: frameworkName,
    packageManager: 'none',
    installCommand: undefined,
    buildCommand: undefined,
    startCommand: 'static-server',
    port: 8080,
    healthPath: '/',
    healthStrategy: 'http',
    files: used.length > 0 ? used : files.slice(0, 8),
    notes: isHtml
      ? [`HTML entry point "${htmlPath}" detected; served via VerifyHub static runner`]
      : ['Generic code workspace detected; served with interactive code browser & live file preview'],
  }
}

export function detectProject(inputDir: string): DetectionResult {
  const root = findRootDir(inputDir)
  const ctx = makeContext(root)
  const files = listRootFiles(root)

  // 1. Node.js (package.json or standalone .js)
  const node = detectNode(ctx, files)
  if (node) return node

  // 2. Python (requirements.txt / pyproject.toml / standalone .py)
  const py = detectPython(ctx, files)
  if (py) return py

  // 3. Other languages (PHP, Go, Rust)
  const other = detectOtherLanguages(ctx)
  if (other) return other

  // 4. HTML, Static Sites, or Generic Codebases (Always runnable!)
  return detectStaticOrGeneric(ctx, files)
}

export function findProjectRoot(inputDir: string): string {
  return findRootDir(inputDir)
}
