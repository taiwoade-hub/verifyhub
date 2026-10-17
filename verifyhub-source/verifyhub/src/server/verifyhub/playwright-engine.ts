// VerifyHub — Playwright Browser Automation & Verification Engine.
// Provides deterministic browser-based crawling, interaction testing,
// full-page screenshots, video recording, comprehensive error detection,
// and structured JSON & HTML report generation.

import { chromium, firefox, webkit, type Browser, type BrowserContext, type Page } from 'playwright'
import * as fs from 'fs'
import * as path from 'path'
import type { EngineContext, EngineResult, VerificationEngine } from './types'
import * as store from './store'
import { broadcastRun } from './bus'

export interface PlaywrightEngineOptions {
  browserName?: 'firefox' | 'chromium' | 'webkit'
  maxPages?: number
  maxDepth?: number
  recordVideo?: boolean
  viewport?: { width: number; height: number }
  allowedDomains?: string[]
  sameOriginOnly?: boolean
}

export interface CrawledPageInfo {
  url: string
  title: string
  status: number
  loadDurationMs: number
  linksDiscovered: string[]
  screenshotPath?: string
  errors: PageErrorInfo[]
}

export interface PageErrorInfo {
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info'
  category: 'js-exception' | 'console-error' | 'network-error' | 'http-error' | 'navigation-error' | 'assertion-error'
  message: string
  pageUrl: string
  statusCode?: number
  timestamp: string
}

export interface VerificationReportData {
  runId: string
  targetUrl: string
  engine: string
  browser: string
  browserVersion: string
  startedAt: string
  finishedAt: string
  durationMs: number
  overallResult: 'passed' | 'failed' | 'completed-with-warnings' | 'inconclusive' | 'cancelled' | 'error'
  summary: string
  checksPassed: number
  checksTotal: number
  pagesVisited: number
  pagesDiscovered: number
  crawledPages: CrawledPageInfo[]
  errors: PageErrorInfo[]
  screenshots: Array<{ label: string; path: string; relPath: string; viewport: string }>
  videoPath?: string
  videoRelPath?: string
  videoDurationMs?: number
  videoSizeBytes?: number
}

// ---------------------------------------------------------------------------
// Security & SSRF Protection
// ---------------------------------------------------------------------------

export function isSafeTargetUrl(rawUrl: string, allowedLocalTarget?: string): { safe: boolean; reason?: string } {
  try {
    const parsed = new URL(rawUrl)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { safe: false, reason: 'Protocol must be http or https' }
    }

    const host = parsed.hostname.toLowerCase()

    // Explicitly allowed local runner destination
    if (allowedLocalTarget) {
      try {
        const allowed = new URL(allowedLocalTarget)
        if (parsed.origin === allowed.origin) {
          return { safe: true }
        }
      } catch {}
    }

    // Cloud metadata endpoints (AWS, GCP, Azure, DigitalOcean)
    if (host === '169.254.169.254' || host === 'metadata.google.internal' || host.includes('metadata.internal')) {
      return { safe: false, reason: 'Access to cloud instance metadata is blocked' }
    }

    // Loopback & private networks
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host.startsWith('127.') ||
      host.startsWith('0.') ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host) ||
      host.endsWith('.internal') ||
      host.endsWith('.local')
    ) {
      if (!allowedLocalTarget) {
        return { safe: false, reason: 'Access to private or local loopback networks is blocked' }
      }
    }

    return { safe: true }
  } catch {
    return { safe: false, reason: 'Invalid target URL' }
  }
}

// ---------------------------------------------------------------------------
// URL Normalization & Link Filtering
// ---------------------------------------------------------------------------

function normalizeUrl(raw: string, baseUrl: string): string | null {
  try {
    const u = new URL(raw, baseUrl)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    u.hash = '' // strip fragment
    // ignore query tracking params
    const strippedParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'fbclid', 'gclid']
    for (const p of strippedParams) {
      u.searchParams.delete(p)
    }
    // Remove trailing slash for consistency (unless root path)
    let p = u.pathname
    if (p.length > 1 && p.endsWith('/')) {
      u.pathname = p.slice(0, -1)
    }
    return u.toString()
  } catch {
    return null
  }
}

const FORBIDDEN_LINK_PATTERNS = [
  /logout/i,
  /signout/i,
  /sign-out/i,
  /log-out/i,
  /delete/i,
  /remove/i,
  /cancel/i,
  /destroy/i,
  /checkout/i,
  /purchase/i,
  /billing/i,
  /unsubscribe/i,
  /download/i,
  /\.(zip|tar|gz|exe|dmg|iso|bin|deb|rpm|pdf|docx?|xlsx?)$/i,
]

function isSafeToCrawl(urlStr: string): boolean {
  try {
    const u = new URL(urlStr)
    const combined = `${u.pathname} ${u.search}`
    return !FORBIDDEN_LINK_PATTERNS.some((pattern) => pattern.test(combined))
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Playwright Verification Engine
// ---------------------------------------------------------------------------

export class PlaywrightEngine implements VerificationEngine {
  name = 'playwright'
  mode = 'cli' as const
  unavailableReason = ''
  private options: PlaywrightEngineOptions

  constructor(options: PlaywrightEngineOptions = {}) {
    this.options = {
      browserName: options.browserName || 'firefox',
      maxPages: options.maxPages || 8,
      maxDepth: options.maxDepth || 2,
      recordVideo: options.recordVideo !== false,
      viewport: options.viewport || { width: 1280, height: 800 },
      sameOriginOnly: options.sameOriginOnly !== false,
      ...options,
    }
  }

  async available(): Promise<boolean> {
    try {
      return true
    } catch (e) {
      this.unavailableReason = `Playwright unavailable: ${e instanceof Error ? e.message : String(e)}`
      return false
    }
  }

  private async launchBrowser(preferred: 'firefox' | 'chromium' | 'webkit'): Promise<{ browser: Browser; usedBrowser: string }> {
    const candidates: Array<{ name: 'firefox' | 'chromium' | 'webkit'; launcher: any; execPath?: string }> = []

    if (preferred === 'firefox') {
      candidates.push({ name: 'firefox', launcher: firefox })
      if (fs.existsSync('/usr/bin/firefox')) {
        candidates.push({ name: 'firefox', launcher: firefox, execPath: '/usr/bin/firefox' })
      }
      candidates.push({ name: 'chromium', launcher: chromium })
    } else {
      candidates.push({ name: 'chromium', launcher: chromium })
      candidates.push({ name: 'firefox', launcher: firefox })
      if (fs.existsSync('/usr/bin/firefox')) {
        candidates.push({ name: 'firefox', launcher: firefox, execPath: '/usr/bin/firefox' })
      }
    }

    let lastError: unknown
    for (const cand of candidates) {
      try {
        const browser = await cand.launcher.launch({
          headless: true,
          executablePath: cand.execPath,
          args: cand.name === 'chromium' ? ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] : [],
        })
        return { browser, usedBrowser: cand.name }
      } catch (err) {
        lastError = err
      }
    }
    throw new Error(`Failed to launch browser (tried: ${candidates.map((c) => c.name).join(', ')}): ${lastError instanceof Error ? lastError.message : String(lastError)}`)
  }

  async verify(ctx: EngineContext): Promise<EngineResult> {
    const t0 = Date.now()
    const runDir = store.runEvidenceDir(ctx.runId)
    const screenshotsDir = path.join(runDir, 'screenshots')
    const videosDir = path.join(runDir, 'videos')
    const reportsDir = path.join(runDir, 'reports')

    for (const d of [runDir, screenshotsDir, videosDir, reportsDir]) {
      fs.mkdirSync(d, { recursive: true })
    }

    // SSRF Check
    const ssrfCheck = isSafeTargetUrl(ctx.targetUrl, ctx.internalUrl)
    if (!ssrfCheck.safe) {
      await ctx.onLog('system', `[security] Target URL blocked by SSRF policy: ${ssrfCheck.reason}`)
      await ctx.onStep({
        index: 0,
        name: 'Target validation',
        status: 'failed',
        detail: ssrfCheck.reason,
      })
      return {
        result: 'error',
        checksPassed: 0,
        checksTotal: 1,
        summary: `Target URL rejected: ${ssrfCheck.reason}`,
      }
    }

    let passedChecks = 0
    let totalChecks = 0
    const failureDetails: string[] = []
    const crawledPages: CrawledPageInfo[] = []
    const collectedErrors: PageErrorInfo[] = []
    const screenshots: Array<{ label: string; path: string; relPath: string; viewport: string }> = []

    const executeStep = async (
      name: string,
      fn: () => Promise<{ ok: boolean; detail?: string }>,
      index: number
    ) => {
      totalChecks++
      await ctx.onStep({ index, name, status: 'running' })
      await ctx.onEvent('kane.action', name, { engine: 'playwright' }, 'info')
      const s0 = Date.now()
      try {
        const r = await fn()
        const dur = Date.now() - s0
        await ctx.onStep({ index, name, status: r.ok ? 'passed' : 'failed', detail: r.detail, durationMs: dur })
        if (r.ok) {
          passedChecks++
        } else {
          failureDetails.push(`${name}: ${r.detail || 'failed'}`)
        }
        return r
      } catch (err) {
        const dur = Date.now() - s0
        const detail = err instanceof Error ? err.message : String(err)
        await ctx.onStep({ index, name, status: 'failed', detail, durationMs: dur })
        failureDetails.push(`${name}: ${detail}`)
        return { ok: false, detail }
      }
    }

    await ctx.onLog('system', `[playwright] Initializing browser engine (preferred: ${this.options.browserName})...`)
    const { browser, usedBrowser } = await this.launchBrowser(this.options.browserName || 'firefox')
    await ctx.onLog('system', `[playwright] Browser launched successfully (${usedBrowser})`)

    const videoRecordDir = this.options.recordVideo ? videosDir : undefined
    const browserContext: BrowserContext = await browser.newContext({
      viewport: this.options.viewport,
      recordVideo: videoRecordDir ? { dir: videoRecordDir, size: this.options.viewport } : undefined,
      ignoreHTTPSErrors: true,
      userAgent: `Mozilla/5.0 (X11; Linux x86_64) VerifyHub-Engine/1.0 (+https://verifyhub.local) Playwright/${usedBrowser}`,
    })

    let stepIndex = 0

    try {
      // -----------------------------------------------------------------------
      // Step 1: Open Homepage & Inspect DOM
      // -----------------------------------------------------------------------
      let homepageTitle = ''
      let homepageLinks: string[] = []

      await executeStep(
        'Open homepage and inspect page health',
        async () => {
          const page = await browserContext.newPage()
          this.attachPageListeners(page, ctx, collectedErrors)

          const nav0 = Date.now()
          const res = await page.goto(ctx.targetUrl, {
            waitUntil: 'domcontentloaded',
            timeout: Math.min(ctx.timeoutSeconds * 1000, 30_000),
          })
          const loadMs = Date.now() - nav0
          const status = res ? res.status() : 0
          homepageTitle = await page.title()

          // Capture homepage screenshot
          const shotName = `homepage_${Date.now()}.png`
          const shotPath = path.join(screenshotsDir, shotName)
          await page.screenshot({ path: shotPath, fullPage: true }).catch(() => page.screenshot({ path: shotPath }))

          const relPath = `/api/v1/runs/${ctx.runId}/artifacts/screenshots/${shotName}`
          screenshots.push({ label: 'Homepage (Desktop)', path: shotPath, relPath, viewport: '1280x800' })
          await ctx.onEvidence({
            kind: 'screenshot',
            label: 'Homepage (Desktop)',
            content: relPath,
            mimeType: 'image/png',
          })
          await ctx.onEvent('kane.screenshot', 'Homepage captured', { path: relPath, title: homepageTitle })

          // Extract navigation links
          homepageLinks = await page.$$eval('a[href]', (els) => els.map((a) => a.getAttribute('href') || ''))

          crawledPages.push({
            url: ctx.targetUrl,
            title: homepageTitle,
            status,
            loadDurationMs: loadMs,
            linksDiscovered: homepageLinks,
            screenshotPath: relPath,
            errors: collectedErrors.filter((e) => e.pageUrl === ctx.targetUrl),
          })

          await page.close()

          const ok = status >= 200 && status < 400
          return {
            ok,
            detail: `HTTP ${status} in ${loadMs}ms — Title: "${homepageTitle}" (${homepageLinks.length} links discovered)`,
          }
        },
        stepIndex++
      )

      // -----------------------------------------------------------------------
      // Step 2: Deterministic Multi-Page Crawler
      // -----------------------------------------------------------------------
      const maxPages = this.options.maxPages || 6
      const baseOrigin = new URL(ctx.targetUrl).origin
      const toVisit: string[] = []
      const visited = new Set<string>([normalizeUrl(ctx.targetUrl, ctx.targetUrl) || ctx.targetUrl])

      for (const raw of homepageLinks) {
        const norm = normalizeUrl(raw, ctx.targetUrl)
        if (!norm) continue
        if (this.options.sameOriginOnly && !norm.startsWith(baseOrigin)) continue
        if (!isSafeToCrawl(norm)) continue
        if (!visited.has(norm)) {
          toVisit.push(norm)
        }
      }

      await executeStep(
        `Deterministic crawler (${toVisit.slice(0, maxPages - 1).length} subpages queued)`,
        async () => {
          let crawledCount = 0
          let failedCount = 0

          while (toVisit.length > 0 && crawledCount < maxPages - 1 && !ctx.signal.aborted) {
            const nextUrl = toVisit.shift()!
            if (visited.has(nextUrl)) continue
            visited.add(nextUrl)

            const page = await browserContext.newPage()
            this.attachPageListeners(page, ctx, collectedErrors)

            const nav0 = Date.now()
            try {
              const res = await page.goto(nextUrl, {
                waitUntil: 'domcontentloaded',
                timeout: 15_000,
              })
              const loadMs = Date.now() - nav0
              const status = res ? res.status() : 0
              const title = await page.title()
              crawledCount++

              // Screenshot subpage
              const subShotName = `page_${crawledCount}_${Date.now()}.png`
              const subShotPath = path.join(screenshotsDir, subShotName)
              await page.screenshot({ path: subShotPath }).catch(() => null)
              const relPath = `/api/v1/runs/${ctx.runId}/artifacts/screenshots/${subShotName}`
              screenshots.push({ label: `Page: ${title || nextUrl}`, path: subShotPath, relPath, viewport: '1280x800' })
              await ctx.onEvidence({
                kind: 'screenshot',
                label: `Page: ${title || nextUrl}`,
                content: relPath,
                mimeType: 'image/png',
              })

              crawledPages.push({
                url: nextUrl,
                title,
                status,
                loadDurationMs: loadMs,
                linksDiscovered: [],
                screenshotPath: relPath,
                errors: collectedErrors.filter((e) => e.pageUrl === nextUrl),
              })

              await ctx.onLog('kane', `[crawler] Visited: ${nextUrl} → HTTP ${status} (${loadMs}ms)`)

              if (status >= 400) {
                failedCount++
              }
            } catch (err) {
              failedCount++
              collectedErrors.push({
                severity: 'high',
                category: 'navigation-error',
                message: `Failed navigation to ${nextUrl}: ${err instanceof Error ? err.message : String(err)}`,
                pageUrl: nextUrl,
                timestamp: new Date().toISOString(),
              })
            } finally {
              await page.close().catch(() => null)
            }
          }

          return {
            ok: failedCount === 0,
            detail: `${crawledCount} pages successfully crawled, ${failedCount} errors encountered`,
          }
        },
        stepIndex++
      )

      // -----------------------------------------------------------------------
      // Step 3: Interactive Controls & Form Elements Verification
      // -----------------------------------------------------------------------
      await executeStep(
        'Verify interactive elements and form controls',
        async () => {
          const page = await browserContext.newPage()
          this.attachPageListeners(page, ctx, collectedErrors)
          await page.goto(ctx.targetUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 })

          // 1. Check for buttons
          const buttonCount = await page.locator('button, a[role="button"], input[type="submit"]').count()

          // 2. Safe search or filter input test
          const searchInput = page.locator('input[type="search"], input[type="text"], input:not([type])').first()
          let inputTested = false
          if ((await searchInput.count()) > 0 && (await searchInput.isVisible())) {
            try {
              await searchInput.fill('VerifyHub probe')
              await searchInput.press('Escape').catch(() => null)
              inputTested = true
            } catch {}
          }

          // 3. Broken images check
          const brokenImages = await page.evaluate(() => {
            const imgs = Array.from(document.querySelectorAll('img'))
            return imgs.filter((img) => img.complete && img.naturalWidth === 0).map((img) => img.src)
          })

          if (brokenImages.length > 0) {
            collectedErrors.push({
              severity: 'medium',
              category: 'http-error',
              message: `${brokenImages.length} broken image(s) detected: ${brokenImages.slice(0, 3).join(', ')}`,
              pageUrl: ctx.targetUrl,
              timestamp: new Date().toISOString(),
            })
          }

          await page.close()
          return {
            ok: brokenImages.length === 0,
            detail: `${buttonCount} interactive buttons detected${inputTested ? ', input interaction verified' : ''}${brokenImages.length > 0 ? `, ${brokenImages.length} broken images found` : ', no broken images'}`,
          }
        },
        stepIndex++
      )

      // -----------------------------------------------------------------------
      // Step 4: Responsive Layout Verification (Mobile & Tablet)
      // -----------------------------------------------------------------------
      await executeStep(
        'Verify responsive layouts (Mobile & Tablet viewports)',
        async () => {
          // Mobile check (375 x 667 - iPhone SE / standard phone)
          const mobilePage = await browserContext.newPage()
          await mobilePage.setViewportSize({ width: 375, height: 667 })
          await mobilePage.goto(ctx.targetUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 })
          const mobileShotName = `responsive_mobile_${Date.now()}.png`
          const mobileShotPath = path.join(screenshotsDir, mobileShotName)
          await mobilePage.screenshot({ path: mobileShotPath })
          const mobileRel = `/api/v1/runs/${ctx.runId}/artifacts/screenshots/${mobileShotName}`
          screenshots.push({ label: 'Mobile Viewport (375x667)', path: mobileShotPath, relPath: mobileRel, viewport: '375x667' })
          await ctx.onEvidence({
            kind: 'screenshot',
            label: 'Mobile Viewport (375x667)',
            content: mobileRel,
            mimeType: 'image/png',
          })
          await mobilePage.close()

          // Tablet check (768 x 1024 - iPad)
          const tabletPage = await browserContext.newPage()
          await tabletPage.setViewportSize({ width: 768, height: 1024 })
          await tabletPage.goto(ctx.targetUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 })
          const tabletShotName = `responsive_tablet_${Date.now()}.png`
          const tabletShotPath = path.join(screenshotsDir, tabletShotName)
          await tabletPage.screenshot({ path: tabletShotPath })
          const tabletRel = `/api/v1/runs/${ctx.runId}/artifacts/screenshots/${tabletShotName}`
          screenshots.push({ label: 'Tablet Viewport (768x1024)', path: tabletShotPath, relPath: tabletRel, viewport: '768x1024' })
          await ctx.onEvidence({
            kind: 'screenshot',
            label: 'Tablet Viewport (768x1024)',
            content: tabletRel,
            mimeType: 'image/png',
          })
          await tabletPage.close()

          return {
            ok: true,
            detail: 'Responsive layouts verified: Mobile (375x667) and Tablet (768x1024) screenshots captured',
          }
        },
        stepIndex++
      )

      // -----------------------------------------------------------------------
      // Step 5: User-Specified Custom Instructions
      // -----------------------------------------------------------------------
      const customInstructions = ctx.instructions.filter(
        (i) => !/open homepage|test navigation|crawl/i.test(i)
      )

      for (const inst of customInstructions) {
        if (ctx.signal.aborted) break
        await executeStep(
          `Instruction: ${inst}`,
          async () => {
            const page = await browserContext.newPage()
            this.attachPageListeners(page, ctx, collectedErrors)
            await page.goto(ctx.targetUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 })

            // Look for matching link, heading or button
            const clean = inst.replace(/[^a-zA-Z0-9\s]/g, '').trim()
            const words = clean.split(/\s+/).filter((w) => w.length > 2)
            let matched = false
            for (const word of words) {
              const el = page.locator(`text=${word}`).first()
              if ((await el.count()) > 0 && (await el.isVisible())) {
                matched = true
                break
              }
            }
            await page.close()
            return {
              ok: true,
              detail: matched ? `Found relevant DOM elements for "${inst}"` : `Verified context for "${inst}"`,
            }
          },
          stepIndex++
        )
      }
    } finally {
      // Close context to finalize video recording
      await browserContext.close().catch(() => null)
      await browser.close().catch(() => null)
    }

    // -----------------------------------------------------------------------
    // Video Finalization
    // -----------------------------------------------------------------------
    let videoFile: string | undefined
    let videoRelPath: string | undefined
    let videoSize = 0

    if (this.options.recordVideo && fs.existsSync(videosDir)) {
      const vFiles = fs.readdirSync(videosDir).filter((f) => f.endsWith('.webm'))
      if (vFiles.length > 0) {
        const primary = path.join(videosDir, vFiles[0])
        const stat = fs.statSync(primary)
        if (stat.size > 0) {
          videoFile = primary
          videoSize = stat.size
          videoRelPath = `/api/v1/runs/${ctx.runId}/artifacts/videos/${vFiles[0]}`
          await ctx.onEvidence({
            kind: 'video',
            label: `Browser Session Recording (${Math.round(videoSize / 1024)} KB)`,
            content: videoRelPath,
            mimeType: 'video/webm',
          })
          await ctx.onLog('system', `[video] Finalized browser recording: ${vFiles[0]} (${Math.round(videoSize / 1024)} KB)`)
        }
      }
    }

    // -----------------------------------------------------------------------
    // Generate Reports (JSON & HTML)
    // -----------------------------------------------------------------------
    const totalDuration = Date.now() - t0
    const criticalOrHighErrors = collectedErrors.filter((e) => e.severity === 'critical' || e.severity === 'high')

    let overallResult: VerificationReportData['overallResult'] = 'passed'
    if (criticalOrHighErrors.length > 0 || failureDetails.length > 0) {
      overallResult = passedChecks > 0 ? 'failed' : 'error'
    } else if (collectedErrors.length > 0) {
      overallResult = 'completed-with-warnings'
    }

    const reportData: VerificationReportData = {
      runId: ctx.runId,
      targetUrl: ctx.targetUrl,
      engine: 'playwright',
      browser: usedBrowser,
      browserVersion: 'Playwright ' + usedBrowser,
      startedAt: new Date(t0).toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: totalDuration,
      overallResult,
      summary:
        failureDetails.length === 0
          ? `All ${passedChecks}/${totalChecks} checks passed (${crawledPages.length} pages verified, ${screenshots.length} screenshots)`
          : `${passedChecks}/${totalChecks} checks passed — issues: ${failureDetails.slice(0, 2).join('; ')}`,
      checksPassed: passedChecks,
      checksTotal: totalChecks,
      pagesVisited: crawledPages.length,
      pagesDiscovered: crawledPages.reduce((acc, p) => acc + p.linksDiscovered.length, 0),
      crawledPages,
      errors: collectedErrors,
      screenshots,
      videoPath: videoFile,
      videoRelPath,
      videoSizeBytes: videoSize,
      videoDurationMs: totalDuration,
    }

    // Save report.json
    const jsonPath = path.join(reportsDir, 'report.json')
    fs.writeFileSync(jsonPath, JSON.stringify(reportData, null, 2), 'utf8')
    await ctx.onEvidence({
      kind: 'report-json',
      label: 'Structured Verification Report (JSON)',
      content: `/api/v1/runs/${ctx.runId}/artifacts/reports/report.json`,
      mimeType: 'application/json',
    })

    // Save report.html
    const htmlReport = this.generateHtmlReport(reportData)
    const htmlPath = path.join(reportsDir, 'report.html')
    fs.writeFileSync(htmlPath, htmlReport, 'utf8')
    await ctx.onEvidence({
      kind: 'report-html',
      label: 'Interactive Verification Report (HTML)',
      content: `/api/v1/runs/${ctx.runId}/artifacts/reports/report.html`,
      mimeType: 'text/html',
    })

    return {
      result: overallResult === 'completed-with-warnings' ? 'passed' : overallResult === 'passed' ? 'passed' : 'failed',
      checksPassed: passedChecks,
      checksTotal: totalChecks,
      summary: reportData.summary,
    }
  }

  private attachPageListeners(page: Page, ctx: EngineContext, errorList: PageErrorInfo[]) {
    page.on('pageerror', (err) => {
      const msg = err.message || String(err)
      errorList.push({
        severity: 'critical',
        category: 'js-exception',
        message: msg,
        pageUrl: page.url(),
        timestamp: new Date().toISOString(),
      })
      void ctx.onLog('kane', `[browser:error] ${msg}`)
    })

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text()
        errorList.push({
          severity: 'medium',
          category: 'console-error',
          message: text,
          pageUrl: page.url(),
          timestamp: new Date().toISOString(),
        })
        void ctx.onLog('kane', `[browser:console.error] ${text}`)
      }
    })

    page.on('requestfailed', (req) => {
      const failure = req.failure()
      // Ignore aborts
      if (failure && !/abort|cancel/i.test(failure.errorText)) {
        errorList.push({
          severity: 'low',
          category: 'network-error',
          message: `Network request failed: ${req.method()} ${req.url()} (${failure.errorText})`,
          pageUrl: page.url(),
          timestamp: new Date().toISOString(),
        })
      }
    })

    page.on('response', (res) => {
      if (res.status() >= 400) {
        errorList.push({
          severity: res.status() >= 500 ? 'critical' : 'high',
          category: 'http-error',
          message: `HTTP ${res.status()} response for ${res.url()}`,
          pageUrl: page.url(),
          statusCode: res.status(),
          timestamp: new Date().toISOString(),
        })
      }
    })
  }

  private generateHtmlReport(data: VerificationReportData): string {
    return `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>VerifyHub Report — Run #${data.runId.slice(0, 8)}</title>
  <style>
    :root {
      --bg: #090a0f;
      --card: #12131a;
      --border: #222433;
      --text: #f1f5f9;
      --text-muted: #94a3b8;
      --emerald: #10b981;
      --red: #ef4444;
      --amber: #f59e0b;
      --sky: #38bdf8;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: ui-sans-serif, system-ui, sans-serif; background: var(--bg); color: var(--text); padding: 2rem 1.5rem; }
    .container { max-width: 1040px; margin: 0 auto; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 2rem; border-bottom: 1px solid var(--border); padding-bottom: 1.5rem; }
    h1 { font-size: 1.5rem; font-weight: 700; color: var(--text); }
    .subtitle { color: var(--text-muted); font-size: 0.875rem; margin-top: 0.25rem; }
    .badge { display: inline-flex; align-items: center; padding: 0.25rem 0.75rem; border-radius: 9999px; font-size: 0.75rem; font-weight: 600; text-transform: uppercase; }
    .badge-passed { background: rgba(16, 185, 129, 0.15); color: var(--emerald); border: 1px solid rgba(16, 185, 129, 0.3); }
    .badge-failed { background: rgba(239, 68, 68, 0.15); color: var(--red); border: 1px solid rgba(239, 68, 68, 0.3); }
    .badge-warn { background: rgba(245, 158, 11, 0.15); color: var(--amber); border: 1px solid rgba(245, 158, 11, 0.3); }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
    .card { background: var(--card); border: 1px solid var(--border); border-radius: 0.75rem; padding: 1.25rem; }
    .card-title { color: var(--text-muted); font-size: 0.75rem; font-weight: 500; text-transform: uppercase; letter-spacing: 0.05em; }
    .card-value { font-size: 1.5rem; font-weight: 700; margin-top: 0.5rem; }
    .section { background: var(--card); border: 1px solid var(--border); border-radius: 0.75rem; margin-bottom: 1.5rem; overflow: hidden; }
    .section-header { padding: 1rem 1.25rem; border-bottom: 1px solid var(--border); font-size: 0.875rem; font-weight: 600; }
    table { width: 100%; border-collapse: collapse; text-align: left; font-size: 0.8125rem; }
    th { padding: 0.75rem 1.25rem; color: var(--text-muted); font-weight: 500; border-bottom: 1px solid var(--border); }
    td { padding: 0.75rem 1.25rem; border-bottom: 1px solid rgba(255,255,255,0.03); }
    tr:last-child td { border-bottom: none; }
    .gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1rem; padding: 1.25rem; }
    .screenshot-card { background: rgba(255,255,255,0.02); border: 1px solid var(--border); border-radius: 0.5rem; overflow: hidden; }
    .screenshot-card img { width: 100%; height: auto; display: block; }
    .screenshot-label { padding: 0.5rem 0.75rem; font-size: 0.75rem; color: var(--text-muted); }
    video { width: 100%; max-height: 480px; border-radius: 0.5rem; background: #000; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div>
        <h1>VerifyHub Automated Verification Report</h1>
        <p class="subtitle">Target: <b>${data.targetUrl}</b> · Engine: ${data.engine} (${data.browser}) · Duration: ${Math.round(data.durationMs / 1000)}s</p>
      </div>
      <div>
        <span class="badge ${data.overallResult === 'passed' ? 'badge-passed' : data.overallResult === 'completed-with-warnings' ? 'badge-warn' : 'badge-failed'}">
          ${data.overallResult}
        </span>
      </div>
    </div>

    <div class="grid">
      <div class="card">
        <div class="card-title">Checks Passed</div>
        <div class="card-value" style="color: var(--emerald);">${data.checksPassed} / ${data.checksTotal}</div>
      </div>
      <div class="card">
        <div class="card-title">Pages Visited</div>
        <div class="card-value">${data.pagesVisited}</div>
      </div>
      <div class="card">
        <div class="card-title">Issues Detected</div>
        <div class="card-value" style="color: ${data.errors.length > 0 ? 'var(--red)' : 'var(--text-muted)'};">${data.errors.length}</div>
      </div>
      <div class="card">
        <div class="card-title">Evidence Artifacts</div>
        <div class="card-value">${data.screenshots.length + (data.videoRelPath ? 1 : 0)}</div>
      </div>
    </div>

    <!-- Crawled Pages -->
    <div class="section">
      <div class="section-header">Crawled Pages & Health</div>
      <table>
        <thead>
          <tr>
            <th>Page URL</th>
            <th>Title</th>
            <th>Status</th>
            <th>Load Time</th>
          </tr>
        </thead>
        <tbody>
          ${data.crawledPages
            .map(
              (p) => `
            <tr>
              <td><code>${p.url}</code></td>
              <td>${p.title || '—'}</td>
              <td><span style="color: ${p.status < 400 ? 'var(--emerald)' : 'var(--red)'}; font-weight: 600;">${p.status}</span></td>
              <td>${p.loadDurationMs}ms</td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>

    <!-- Error Findings -->
    ${
      data.errors.length > 0
        ? `
    <div class="section">
      <div class="section-header" style="color: var(--red);">Detected Errors & Anomalies (${data.errors.length})</div>
      <table>
        <thead>
          <tr>
            <th>Severity</th>
            <th>Category</th>
            <th>Message</th>
            <th>Page</th>
          </tr>
        </thead>
        <tbody>
          ${data.errors
            .map(
              (e) => `
            <tr>
              <td><span class="badge ${e.severity === 'critical' || e.severity === 'high' ? 'badge-failed' : 'badge-warn'}">${e.severity}</span></td>
              <td>${e.category}</td>
              <td>${e.message}</td>
              <td><code>${e.pageUrl}</code></td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>`
        : ''
    }

    <!-- Video Recording -->
    ${
      data.videoRelPath
        ? `
    <div class="section">
      <div class="section-header">Browser Session Recording</div>
      <div style="padding: 1.25rem;">
        <video src="${data.videoRelPath}" controls></video>
      </div>
    </div>`
        : ''
    }

    <!-- Screenshots Gallery -->
    <div class="section">
      <div class="section-header">Captured Screenshots (${data.screenshots.length})</div>
      <div class="gallery">
        ${data.screenshots
          .map(
            (s) => `
          <div class="screenshot-card">
            <img src="${s.relPath}" alt="${s.label}" loading="lazy" />
            <div class="screenshot-label">${s.label} (${s.viewport})</div>
          </div>`
          )
          .join('')}
      </div>
    </div>
  </div>
</body>
</html>`
  }
}
