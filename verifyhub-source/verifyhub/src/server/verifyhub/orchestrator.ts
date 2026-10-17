// VerifyHub — run orchestrator.
// Drives the full state machine:
//   QUEUED → PREPARING → CLONING → INSTALLING → BUILDING → STARTING →
//   HEALTH_CHECK → EXPOSING → READY → KANE_VERIFYING → COLLECTING_EVIDENCE →
//   COMPLETED   (or FAILED / CANCELLED / TIMEOUT)
//
// Responsibilities:
//  - persist every status change as a RunEvent (immutable history)
//  - stream logs (system/stdout/stderr/kane) to DB + websocket
//  - start/stop runners (local or docker), health check, tunnels
//  - run the verification engine, persist steps + evidence
//  - fire Telegram notifications
//  - schedule runner (cron) tick loop
//  - cleanup: stop engine, stop tunnel, destroy container/process, keep data

import { db, withDbRetry } from '@/lib/db'
import { detectProject, findProjectRoot } from './detect'
import { readConfigFromDisk, parseConfig } from './config'
import * as store from './store'
import * as runner from './runner'
import { resolveEngine } from './engines'
import { startTunnel, stopTunnel } from './ngrok'
import { broadcastRun } from './bus'
import * as fs from 'fs'
import * as path from 'path'
import { getTelegram, getPreferences, telegramSend, telegramSendPhoto, telegramSendVideo, telegramSendDocument, formatRunMessage, downloadRepoTarball } from './integrations'
import { isActive, stageProgress, type RunStatus, type VerifyHubConfig } from './types'

interface OrchestratorState {
  cancelled: Set<string>
  running: Set<string>
  seq: Map<string, number>
  schedulerTimer?: ReturnType<typeof setInterval>
}

const g = globalThis as unknown as { __verifyhub?: OrchestratorState }

function state(): OrchestratorState {
  if (!g.__verifyhub) {
    g.__verifyhub = { cancelled: new Set(), running: new Set(), seq: new Map() }
  }
  return g.__verifyhub
}

store.ensureDirs()

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

async function nextSeq(runId: string): Promise<number> {
  const s = state()
  const v = (s.seq.get(runId) || 0) + 1
  s.seq.set(runId, v)
  return v
}

async function addLog(runId: string, stream: 'system' | 'stdout' | 'stderr' | 'kane', line: string): Promise<void> {
  const seq = await nextSeq(runId)
  try {
    await withDbRetry(() =>
      db.runLog.create({ data: { runId, stream, line: line.slice(0, 4000), seq } })
    )
  } catch (e) {
    console.warn(`[orchestrator] addLog failed for run ${runId}:`, e)
  }
  try {
    await broadcastRun(runId, 'log.append', { runId, stream, line: line.slice(0, 4000), seq, ts: Date.now() })
  } catch {
    /* broadcast is best effort */
  }
}

async function addEvent(
  runId: string,
  type: string,
  message: string,
  data?: unknown,
  status?: string
): Promise<void> {
  try {
    await withDbRetry(() =>
      db.runEvent.create({
        data: { runId, type, message: message.slice(0, 2000), data: data ? JSON.stringify(data) : null, status: status || null },
      })
    )
  } catch (e) {
    console.warn(`[orchestrator] addEvent failed for run ${runId}:`, e)
  }
  try {
    await broadcastRun(runId, type, { runId, type, message, data, status, ts: Date.now() })
  } catch {
    /* broadcast is best effort */
  }
}

async function setStatus(runId: string, status: RunStatus, extra?: { error?: string; result?: string }): Promise<void> {
  const data: Record<string, unknown> = { status, stage: status, progress: stageProgress(status) }
  if (extra?.error) data.error = extra.error
  if (extra?.result) data.result = extra.result
  if (['COMPLETED', 'FAILED', 'CANCELLED', 'TIMEOUT'].includes(status)) {
    data.finishedAt = new Date()
  }
  await withDbRetry(() => db.run.update({ where: { id: runId }, data }))
  await addEvent(runId, 'run.status', `Status: ${status}`, { status })
  try {
    await broadcastRun(runId, 'run.status', { runId, status, progress: stageProgress(status) })
  } catch {}
}

export { addLog, addEvent }

// ---------------------------------------------------------------------------
// Scheduler (cron loop)
// ---------------------------------------------------------------------------

// Minimal cron support: "every Nm", "every Nh", and 5-field cron with * / , -
function cronMatches(expr: string, d: Date): boolean {
  const e = expr.trim().toLowerCase()
  const every = /^every\s+(\d+)\s*(m|min|minute|minutes|h|hour|hours)$/.exec(e)
  if (every) {
    const n = parseInt(every[1], 10)
    const unit = every[2]
    if (unit.startsWith('h')) return d.getMinutes() === 0 && d.getMinutes() % (n * 1) === 0 && d.getMilliseconds() < 30_000
    return d.getMinutes() % n === 0
  }
  if (/^daily at \d{2}:\d{2}$/i.test(e) || /^\d{2}:\d{2}$/.test(e)) {
    const t = /\d{2}:\d{2}/.exec(e)![0]
    const [h, m] = t.split(':').map(Number)
    return d.getHours() === h && d.getMinutes() === m
  }
  const fields = e.split(/\s+/)
  if (fields.length !== 5) return false
  const [min, hour, dom, mon, dow] = fields
  const matchField = (f: string, val: number): boolean => {
    if (f === '*') return true
    return f.split(',').some((part) => {
      const step = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part)
      if (!step) return false
      let ok = true
      if (step[1] !== '*') {
        if (step[1].includes('-')) {
          const [a, b] = step[1].split('-').map(Number)
          ok = val >= a && val <= b
        } else {
          ok = val === Number(step[1])
        }
      }
      if (step[2]) ok = ok && val % Number(step[2]) === (step[1] === '*' ? 0 : Number(step[1]) % Number(step[2]))
      return ok
    })
  }
  return (
    matchField(min, d.getMinutes()) &&
    matchField(hour, d.getHours()) &&
    matchField(dom, d.getDate()) &&
    matchField(mon, d.getMonth() + 1) &&
    matchField(dow, d.getDay())
  )
}

export async function schedulerTick(): Promise<void> {
  const now = new Date()
  now.setSeconds(0, 0)
  try {
    const schedules = await db.schedule.findMany({ where: { enabled: true }, include: { project: true } })
    for (const sch of schedules) {
      const last = sch.lastRunAt
      // Only fire once per matching minute
      if (last && Math.floor(last.getTime() / 60_000) === Math.floor(now.getTime() / 60_000)) continue
      if (cronMatches(sch.cron, now)) {
        await db.schedule.update({ where: { id: sch.id }, data: { lastRunAt: now } })
        const run = await createRun(sch.projectId, { trigger: 'schedule', branch: sch.branch || undefined })
        await addEvent(run.id, 'run.created', `Scheduled run triggered (${sch.cron})`, { schedule: sch.name })
      }
    }
  } catch {
    /* scheduler is best-effort; never crash the API */
  }
}

export function ensureScheduler(): void {
  const s = state()
  if (s.schedulerTimer) return
  s.schedulerTimer = setInterval(() => {
    void schedulerTick()
  }, 30_000)
  void schedulerTick()
}

// ---------------------------------------------------------------------------
// Run creation + lifecycle
// ---------------------------------------------------------------------------

export async function createRun(
  projectId: string,
  opts: {
    trigger?: string
    branch?: string
    commitSha?: string
    engine?: string
    browser?: string
    recordVideo?: boolean
    instructions?: string[]
    configOverride?: VerifyHubConfig
  } = {}
): Promise<{ id: string; number: number }> {
  const project = await withDbRetry(() => db.project.findUniqueOrThrow({ where: { id: projectId } }))
  const count = await withDbRetry(() => db.run.count({ where: { projectId } }))
  const run = await withDbRetry(() =>
    db.run.create({
      data: {
        projectId,
        number: count + 1,
        status: 'QUEUED',
        trigger: opts.trigger || 'manual',
        sourceType: project.sourceType,
        branch: opts.branch || project.gitBranch || null,
        commitSha: opts.commitSha || project.gitCommit || null,
        startedAt: new Date(),
      },
    })
  )
  await addEvent(run.id, 'run.created', `Run #${run.number} created (${opts.trigger || 'manual'})`, {
    project: project.name,
  })
  try {
    await broadcastRun(run.id, 'run.created', { runId: run.id, number: run.number, projectId })
  } catch {}
  // fire and forget
  void executeRun(run.id, opts).catch(async (err) => {
    await addLog(run.id, 'stderr', `orchestrator error: ${err?.message || err}`)
    await setStatus(run.id, 'FAILED', { error: String(err?.message || err), result: 'error' })
    await finalizeRun(run.id, 'error')
  })
  return { id: run.id, number: run.number }
}

async function executeRun(
  runId: string,
  runOpts?: {
    engine?: string
    browser?: string
    recordVideo?: boolean
    instructions?: string[]
    configOverride?: VerifyHubConfig
  }
): Promise<void> {
  const s = state()
  if (s.running.has(runId)) return
  s.running.add(runId)

  const run = await withDbRetry(() => db.run.findUniqueOrThrow({ where: { id: runId }, include: { project: true } }))
  const project = run.project
  const abort = new AbortController()
  const cancelled = () => s.cancelled.has(runId)

  const log = async (stream: 'system' | 'stdout' | 'stderr' | 'kane', line: string) => {
    if (line.trim()) await addLog(runId, stream, line)
  }

  try {
    // ---------------- PREPARING ----------------
    await setStatus(runId, 'PREPARING')
    store.ensureDirs()
    const projectId = project.id
    const projectWork = store.projectDir(projectId)
    store.ensureDirs()

    // Non-URL projects always have (or will receive) files in the project workspace:
    //  - upload/example: extracted/copied at creation time
    //  - github: cloned into the workspace during CLONING below
    let sourceRoot = project.sourceType !== 'url' ? projectWork : null

    // ---------------- CLONING ----------------
    if (project.sourceType === 'github') {
      await setStatus(runId, 'CLONING')
      if (!project.gitRepo) throw new Error('project has no git repository configured')
      await log('system', `[git] downloading ${project.gitRepo} (${run.branch || project.gitBranch || 'default branch'})`)
      const fs = await import('fs')
      const tar = `/tmp/verifyhub-${runId}.tar.gz`
      let cloned = false
      try {
        const { commitSha } = await downloadRepoTarball(project.gitRepo, run.branch || project.gitBranch || '', tar)
        await store.extractTarball(tar, projectWork)
        fs.rmSync(tar, { force: true })
        if (commitSha) {
          await withDbRetry(() => db.run.update({ where: { id: runId }, data: { commitSha } }))
        }
        cloned = true
      } catch (tarErr) {
        // Fallback to git clone (supports GitLab, Bitbucket, self-hosted git, and direct git URLs)
        await log('system', `[git] tarball download fallback: cloning via git CLI...`)
        const { cloneGitRepo } = await import('./integrations')
        const gitUrl = project.sourceUrl || `https://github.com/${project.gitRepo}.git`
        const { commitSha } = await cloneGitRepo(gitUrl, run.branch || project.gitBranch || undefined, projectWork)
        if (commitSha) {
          await withDbRetry(() => db.run.update({ where: { id: runId }, data: { commitSha } }))
        }
        cloned = true
      }
      sourceRoot = projectWork
      await addEvent(runId, 'runner.created', 'repository downloaded and extracted', { repo: project.gitRepo })
      await log('system', '[git] extraction complete')
    } else if (project.sourceType === 'url') {
      await addEvent(runId, 'runner.created', 'live URL target — no runner needed', { url: project.sourceUrl })
    } else {
      await addEvent(runId, 'runner.created', `source ready from ${project.sourceType}`, { path: sourceRoot })
    }

    // ---------------- URL-only runs ----------------
    if (project.sourceType === 'url') {
      const target = project.sourceUrl!
      const config = project.config ? parseConfig(project.config) : undefined
      await withDbRetry(() =>
        db.run.update({
          where: { id: runId },
          data: { status: 'READY', stage: 'READY', progress: stageProgress('READY'), previewUrl: target, internalUrl: target, tunnelProvider: 'none', runnerMode: 'none' },
        })
      )
      await addEvent(runId, 'ngrok.connected', `target URL: ${target}`, { url: target })
      await notify(runId, project.name, 'run.ready', target)
      await runVerification(runId, target, target, abort.signal, runOpts?.configOverride || config, runOpts)
      await setStatus(runId, 'COMPLETED')
      await finalizeRun(runId)
      return
    }

    if (!sourceRoot) throw new Error('no source directory available for this run')

    const root = findProjectRoot(sourceRoot)

    // ---------------- DETECTION ----------------
    const detection = detectProject(root)
    await withDbRetry(() => db.run.update({ where: { id: runId }, data: { detected: JSON.stringify(detection) } }))
    await withDbRetry(() =>
      db.project.update({
        where: { id: projectId },
        data: {
          detectedLanguage: detection.language,
          detectedFramework: detection.framework,
          detectedPackageManager: detection.packageManager,
          detectedInstall: detection.installCommand || null,
          detectedBuild: detection.buildCommand || null,
          detectedStart: detection.startCommand || null,
          detectedPort: detection.port || null,
          config: project.config || (readConfigFromDisk(root).raw ? readConfigFromDisk(root).raw : null),
        },
      })
    )
    await addEvent(runId, 'project.detected', `Detected ${detection.language} · ${detection.framework}`, {
      detection,
    })
    await log('system', `[detect] language=${detection.language} framework=${detection.framework} pm=${detection.packageManager}`)
    for (const note of detection.notes) await log('system', `[detect] ${note}`)

    // load .verifyhub.yml if present
    const cfg = readConfigFromDisk(root)
    let config: VerifyHubConfig = cfg.config
    if (project.config) config = parseConfig(project.config)
    if (cfg.raw) await log('system', '[config] .verifyhub.yml found and applied')

    // ---------------- RUNNER ----------------
    await setStatus(runId, 'INSTALLING')
    await addEvent(runId, 'install.started', `Installing dependencies (${detection.packageManager})`)

    const useDocker = process.env.VERIFYHUB_RUNNER === 'docker'
    let handle: runner.RunnerHandle | null = null

    if (useDocker && (await runner.dockerAvailable())) {
      handle = await runner.dockerStart({ runId, root, detection, log, signal: abort.signal })
    } else {
      if (detection.language === 'unknown' || !detection.startCommand) {
        detection.language = 'static'
        detection.framework = detection.framework === 'Unknown' ? 'Static / Code Workspace' : detection.framework
        detection.startCommand = 'static-server'
        detection.port = 8080
        detection.healthPath = '/'
      }
      handle = await runner.localStart({ runId, root, detection, log, signal: abort.signal })
    }

    await db.run.update({
      where: { id: runId },
      data: { runnerId: handle.runnerId, runnerMode: handle.mode, internalUrl: handle.internalUrl },
    })
    await addEvent(runId, 'install.completed', 'dependencies installed', { mode: handle.mode })
    await addEvent(runId, 'application.started', `application starting on ${handle.internalUrl}`)

    // ---------------- HEALTH CHECK ----------------
    await setStatus(runId, 'HEALTH_CHECK')
    const hc = await runner.healthCheck(handle.port, handle.healthPath, 90_000, log, abort.signal)
    if (!hc.ok) throw new Error(hc.error || 'application did not become healthy')

    // ---------------- EXPOSING ----------------
    await setStatus(runId, 'EXPOSING')
    const tunnel = await startTunnel(handle.port, runId)
    const previewUrl = tunnel.url || `/api/v1/preview/${runId}/`
    await db.run.update({
      where: { id: runId },
      data: {
        previewUrl,
        tunnelProvider: tunnel.provider,
        tunnelId: tunnel.tunnelId || null,
        status: 'READY',
        stage: 'READY',
        progress: stageProgress('READY'),
      },
    })
    await addEvent(
      runId,
      'ngrok.connected',
      tunnel.ok ? `public URL: ${tunnel.url}` : tunnel.detail,
      { url: previewUrl, provider: tunnel.provider },
      tunnel.ok ? 'success' : 'info'
    )
    await notify(runId, project.name, 'run.ready', previewUrl)

    // ---------------- VERIFICATION ----------------
    const targetUrl = tunnel.ok ? tunnel.url! : `http://127.0.0.1:${handle.port}`
    await runVerification(runId, targetUrl, `http://127.0.0.1:${handle.port}`, abort.signal, runOpts?.configOverride || config, runOpts)

    // ---------------- COMPLETED ----------------
    await setStatus(runId, 'COMPLETED')
    await finalizeRun(runId)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const cancelledRun = cancelled()
    if (cancelledRun) {
      await setStatus(runId, 'CANCELLED', { result: 'error' })
    } else if (/timed out/i.test(message)) {
      await setStatus(runId, 'TIMEOUT', { error: message, result: 'error' })
    } else {
      await setStatus(runId, 'FAILED', { error: message, result: 'error' })
    }
    await log('system', `[runner] run ended: ${message}`)
    await finalizeRun(runId, 'error', message)
  } finally {
    s.running.delete(runId)
    s.cancelled.delete(runId)
  }
}

// ---------------------------------------------------------------------------
// Verification phase
// ---------------------------------------------------------------------------

async function runVerification(
  runId: string,
  targetUrl: string,
  internalUrl: string,
  signal: AbortSignal,
  configOverride?: VerifyHubConfig,
  runOpts?: { engine?: string; browser?: string; recordVideo?: boolean; instructions?: string[] }
): Promise<void> {
  const run = await db.run.findUniqueOrThrow({ where: { id: runId }, include: { project: true } })
  await setStatus(runId, 'KANE_VERIFYING')

  const cfg = configOverride || (run.project.config ? parseConfig(run.project.config) : undefined)
  const instructions = runOpts?.instructions || cfg?.verification?.instructions || ['Open homepage', 'Test navigation']
  const timeoutSeconds = cfg?.verification?.timeoutSeconds || 120
  const requestedEngine = runOpts?.engine || cfg?.verification?.engine || 'auto'
  const browserName = ((runOpts?.browser || (cfg?.verification as any)?.browser || 'firefox')) as 'firefox' | 'chromium' | 'webkit'
  const recordVideo = runOpts?.recordVideo !== undefined ? runOpts.recordVideo : ((cfg?.verification as any)?.recordVideo !== false)

  const { engine, fallbackFrom, fallbackReason, diagnostics } = await resolveEngine(requestedEngine, {
    browserName,
    recordVideo,
  })
  if (fallbackFrom) {
    await addEvent(
      runId,
      'kane.started',
      `${fallbackFrom} unavailable — falling back to ${engine.name}${fallbackReason ? ` (${fallbackReason})` : ''}`,
      { requested: fallbackFrom, engine: engine.name, fallbackReason, diagnostics },
      'info'
    )
  } else {
    await addEvent(runId, 'kane.started', `Verification started with ${engine.name} (${browserName})`, {
      engine: engine.name,
      browser: browserName,
      diagnostics,
    })
  }

  const session = await withDbRetry(() =>
    db.verificationSession.create({
      data: {
        runId,
        engine: engine.name,
        engineMode: engine.mode,
        status: 'running',
        targetUrl,
        instructions: JSON.stringify(instructions),
        startedAt: new Date(),
      },
    })
  )

  // seed steps in a single atomic batch
  await withDbRetry(() =>
    db.verificationStep.createMany({
      data: instructions.map((name, index) => ({
        sessionId: session.id,
        runId,
        index,
        name,
        status: 'pending',
      })),
    })
  )
  const stepRows = await db.verificationStep.findMany({
    where: { sessionId: session.id },
    orderBy: { index: 'asc' },
  })

  const t0 = Date.now()
  try {
    const result = await engine.verify({
      runId,
      targetUrl,
      internalUrl,
      instructions,
      timeoutSeconds,
      signal,
      onStep: async (update) => {
        const row = stepRows[update.index]
        if (!row) return
        try {
          await withDbRetry(() =>
            db.verificationStep.update({
              where: { id: row.id },
              data: { status: update.status, detail: update.detail, durationMs: update.durationMs },
            })
          )
        } catch (err) {
          console.warn(`[orchestrator] onStep update failed:`, err)
        }
        try {
          await broadcastRun(runId, 'kane.action', {
            runId,
            step: update.index + 1,
            name: update.name,
            status: update.status,
            detail: update.detail,
            durationMs: update.durationMs,
          })
        } catch {}
      },
      onLog: async (stream, line) => {
        await addLog(runId, stream, line)
      },
      onEvent: async (type, message, data, status) => {
        await addEvent(runId, type, message, data, status)
      },
      onEvidence: async (e) => {
        try {
          await withDbRetry(() =>
            db.evidence.create({
              data: {
                runId,
                kind: e.kind,
                label: e.label,
                content: e.content,
                mimeType: e.mimeType,
                size: (e as any).size ?? (e.content ? e.content.length : 0),
                path: (e as any).path || null,
              },
            })
          )
        } catch (err) {
          console.warn(`[orchestrator] onEvidence create failed:`, err)
        }
      },
    })

    const durationMs = Date.now() - t0
    await withDbRetry(() =>
      db.verificationSession.update({
        where: { id: session.id },
        data: {
          status: result.result === 'error' ? 'failed' : 'completed',
          result: result.result,
          summary: result.summary,
          durationMs,
          finishedAt: new Date(),
        },
      })
    )
    await withDbRetry(() =>
      db.run.update({
        where: { id: runId },
        data: { checksPassed: result.checksPassed, checksTotal: result.checksTotal, result: result.result },
      })
    )
    await addEvent(
      runId,
      'kane.completed',
      result.summary,
      { result: result.result, checksPassed: result.checksPassed, checksTotal: result.checksTotal },
      result.result === 'passed' ? 'success' : 'error'
    )
    try {
      await broadcastRun(runId, 'kane.completed', { runId, ...result })
    } catch {}
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    try {
      await withDbRetry(() =>
        db.verificationSession.update({
          where: { id: session.id },
          data: { status: 'failed', result: 'error', summary: message, durationMs: Date.now() - t0, finishedAt: new Date() },
        })
      )
    } catch {}
    await addEvent(runId, 'kane.error', `verification engine error: ${message}`, null, 'error')
    throw err
  }
}

// ---------------------------------------------------------------------------
// Finalization + notifications
// ---------------------------------------------------------------------------

async function finalizeRun(runId: string, kind: 'ok' | 'error' = 'ok', errorMessage?: string): Promise<void> {
  const run = await db.run.findUniqueOrThrow({ where: { id: runId }, include: { project: true } })
  const finishedAt = new Date()
  const startedAt = run.startedAt || run.createdAt
  const durationMs = finishedAt.getTime() - startedAt.getTime()

  const checks = await db.verificationStep.findMany({ where: { runId } })
  const passed = checks.filter((c) => c.status === 'passed').length
  const total = checks.filter((c) => c.status !== 'skipped').length || run.checksTotal

  await db.run.update({
    where: { id: runId },
    data: {
      finishedAt,
      durationMs,
      checksPassed: run.checksPassed || passed,
      checksTotal: run.checksTotal || total,
      result: run.result || (kind === 'error' ? 'error' : undefined),
    },
  })

  // cleanup runner + tunnel (evidence already persisted in DB)
  await runner.cleanup(runId)
  await runner.dockerCleanup(runId)
  if (run.tunnelId) stopTunnel(run.tunnelId)
  await addEvent(runId, 'run.completed', `Run #${run.number} finished`, {
    result: run.result || (kind === 'error' ? 'error' : 'passed'),
    durationMs,
  })
  await broadcastRun(runId, 'run.completed', {
    runId,
    result: run.result || (kind === 'error' ? 'error' : 'passed'),
    durationMs,
  })

  await notify(
    runId,
    run.project.name,
    kind === 'error' ? 'run.failed' : 'run.completed',
    run.previewUrl || undefined,
    errorMessage
  )
}

async function notify(
  runId: string,
  projectName: string,
  kind: string,
  previewUrl?: string,
  errorMessage?: string
): Promise<void> {
  try {
    const prefs = await getPreferences()
    const tg = await getTelegram()
    const run = await db.run.findUnique({ where: { id: runId } })
    if (!run) return

    if (kind === 'run.ready' && !prefs.config.notifyOnReady) return
    if (kind === 'run.completed' && !prefs.config.notifyOnComplete) return
    if (kind === 'run.failed' && !prefs.config.notifyOnComplete) return
    if (!tg.connected && !process.env.TELEGRAM_BOT_TOKEN) {
      await db.notification.create({
        data: {
          runId,
          kind,
          title: `Run #${run.number} — ${kind.replace('run.', '')}`,
          body: 'Telegram not configured; notification skipped',
          status: 'skipped',
        },
      })
      return
    }
    const chatId = tg.config.chatId
    if (!chatId) throw new Error('telegram chat id not set')

    const html =
      kind === 'run.ready'
        ? [
            '🤖 <b>VerifyHub</b>',
            '',
            `Project: <b>${projectName.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</b>`,
            '',
            '🐳 Runner created',
            '🌐 Public URL ready',
            '',
            `Preview: ${previewUrl || '(internal preview)'}`,
            '',
            '🤖 Kane is starting verification…',
          ].join('\n')
        : formatRunMessage(
            projectName,
            {
              number: run.number,
              result: run.result,
              checksPassed: run.checksPassed,
              checksTotal: run.checksTotal,
              previewUrl,
              durationMs: run.durationMs,
              error: errorMessage || run.error,
              commitSha: run.commitSha,
            },
            kind
          )
    const res = await telegramSend(chatId, html)
    await db.notification.create({
      data: {
        runId,
        kind,
        title: `Run #${run.number} — ${kind.replace('run.', '')}`,
        body: html.replace(/<[^>]+>/g, ''),
        status: res.ok ? 'sent' : 'failed',
        error: res.error,
      },
    })

    // If verification completed/failed, deliver key evidence (screenshots, video, report)
    if (kind === 'run.completed' || kind === 'run.failed') {
      try {
        const evidenceDir = store.runEvidenceDir(runId)
        // 1. Send up to 2 key screenshots
        const screenshotsDir = path.join(evidenceDir, 'screenshots')
        if (fs.existsSync(screenshotsDir)) {
          const files = fs.readdirSync(screenshotsDir).filter((f) => f.endsWith('.png'))
          for (const f of files.slice(0, 2)) {
            const shotPath = path.join(screenshotsDir, f)
            await telegramSendPhoto(chatId, shotPath, `📸 Screenshot: ${f.replace(/_\d+\.png$/, '')}`)
          }
        }

        // 2. Send video recording if present
        const videosDir = path.join(evidenceDir, 'videos')
        if (fs.existsSync(videosDir)) {
          const vFiles = fs.readdirSync(videosDir).filter((f) => f.endsWith('.webm') || f.endsWith('.mp4'))
          if (vFiles.length > 0) {
            const videoPath = path.join(videosDir, vFiles[0])
            await telegramSendVideo(chatId, videoPath, `🎥 Full browser verification recording (#${run.number})`)
          }
        }

        // 3. Send HTML report document
        const reportPath = path.join(evidenceDir, 'reports', 'report.html')
        if (fs.existsSync(reportPath)) {
          await telegramSendDocument(chatId, reportPath, `📊 Interactive Verification Report (#${run.number})`)
        }
      } catch (mediaErr) {
        console.warn(`[telegram] Non-fatal error delivering media evidence:`, mediaErr)
      }
    }
  } catch (err) {
    await db.notification
      .create({
        data: {
          runId,
          kind,
          title: `Run notification (${kind})`,
          body: 'failed to send',
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
        },
      })
      .catch(() => undefined)
  }
}

// ---------------------------------------------------------------------------
// Cancel
// ---------------------------------------------------------------------------

export async function cancelRun(runId: string): Promise<void> {
  const s = state()
  s.cancelled.add(runId)
  await addEvent(runId, 'run.status', 'Cancellation requested', null, 'info')
  await runner.cleanup(runId)
  await runner.dockerCleanup(runId)
}
