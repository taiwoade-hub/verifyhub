// VerifyHub — Browser Engine Manager.
// Manages detection, health checks, diagnostic startup, selection,
// and automatic fallback between Kane CLI and Playwright engines.

import type { VerificationEngine } from './types'
import { KaneCliEngine, HttpProbeEngine } from './engines'
import { PlaywrightEngine, type PlaywrightEngineOptions } from './playwright-engine'

export type EngineSelectionMode = 'auto' | 'kane' | 'playwright'

export interface EngineStatusInfo {
  name: string
  mode: string
  available: boolean
  operational: boolean
  detail: string
  isDefault: boolean
}

export interface EngineResolutionResult {
  engine: VerificationEngine
  requested: string
  selected: string
  fallbackFrom?: string
  fallbackReason?: string
  diagnostics: string[]
}

export class BrowserEngineManager {
  private static instance: BrowserEngineManager
  private kaneEngine?: KaneCliEngine
  private httpProbeEngine?: HttpProbeEngine

  private constructor() {}

  public static getInstance(): BrowserEngineManager {
    if (!BrowserEngineManager.instance) {
      BrowserEngineManager.instance = new BrowserEngineManager()
    }
    return BrowserEngineManager.instance
  }

  private getKane(): KaneCliEngine {
    if (!this.kaneEngine) {
      this.kaneEngine = new KaneCliEngine()
    }
    return this.kaneEngine
  }

  private getHttpProbe(): HttpProbeEngine {
    if (!this.httpProbeEngine) {
      this.httpProbeEngine = new HttpProbeEngine()
    }
    return this.httpProbeEngine
  }

  private getPlaywright(options?: PlaywrightEngineOptions): PlaywrightEngine {
    return new PlaywrightEngine(options || { browserName: 'firefox' })
  }

  /**
   * Diagnostic check for all supported engines.
   */
  public async getEngineStatuses(): Promise<EngineStatusInfo[]> {
    const pw = this.getPlaywright()
    const kaneAvail = await this.getKane().available()
    const pwAvail = await pw.available()

    return [
      {
        name: 'playwright',
        mode: 'cli / browser',
        available: pwAvail,
        operational: pwAvail,
        detail: pwAvail
          ? 'Playwright browser automation active (Firefox / Chromium)'
          : pw.unavailableReason || 'Playwright libraries missing',
        isDefault: true,
      },
      {
        name: 'kane',
        mode: 'cli',
        available: kaneAvail,
        operational: kaneAvail,
        detail: kaneAvail ? 'Kane CLI binary found and executable' : 'Kane CLI not installed (run `npm i -g @taiwoade/kane` or use Playwright)',
        isDefault: false,
      },
      {
        name: 'http-probe',
        mode: 'probe',
        available: true,
        operational: true,
        detail: 'Lightweight HTTP crawler fallback (no browser required)',
        isDefault: false,
      },
    ]
  }

  /**
   * Resolve the active verification engine based on configuration and availability.
   * Auto mode: Kane if available -> Playwright -> HTTP probe fallback.
   * Kane mode: Kane explicitly, or error if unavailable.
   * Playwright mode: Playwright explicitly, or HTTP probe if Playwright cannot run.
   */
  public async resolve(
    requestedMode: string | undefined,
    options?: PlaywrightEngineOptions
  ): Promise<EngineResolutionResult> {
    const mode = (requestedMode || 'auto').toLowerCase().trim()
    const diagnostics: string[] = []

    // 1. Explicit Playwright request
    if (mode === 'playwright') {
      const pw = this.getPlaywright(options)
      if (await pw.available()) {
        diagnostics.push('Playwright selected explicitly and verified available')
        return {
          engine: pw,
          requested: 'playwright',
          selected: 'playwright',
          diagnostics,
        }
      }
      diagnostics.push(`Playwright requested but unavailable: ${pw.unavailableReason}`)
      return {
        engine: this.getHttpProbe(),
        requested: 'playwright',
        selected: 'http-probe',
        fallbackFrom: 'playwright',
        fallbackReason: pw.unavailableReason || 'Playwright browser failed to initialize',
        diagnostics,
      }
    }

    // 2. Explicit Kane request
    if (mode === 'kane') {
      const kane = this.getKane()
      const kaneOk = await kane.available()
      if (kaneOk) {
        diagnostics.push('Kane CLI selected explicitly and available on PATH')
        return {
          engine: kane,
          requested: 'kane',
          selected: 'kane',
          diagnostics,
        }
      }
      diagnostics.push('Kane CLI requested explicitly but binary not found on PATH')
      // Clean fallback with explicit reason recorded
      const pw = this.getPlaywright(options)
      const pwOk = await pw.available()
      const fallbackEngine = pwOk ? pw : this.getHttpProbe()
      return {
        engine: fallbackEngine,
        requested: 'kane',
        selected: fallbackEngine.name,
        fallbackFrom: 'kane',
        fallbackReason: 'Kane CLI binary not found on PATH. Automatically resolved fallback engine.',
        diagnostics,
      }
    }

    // 3. Auto Mode (default)
    // Check Kane first
    const kane = this.getKane()
    const kaneAvailable = await kane.available()
    if (kaneAvailable) {
      diagnostics.push('Auto mode: Kane CLI detected and operational; using Kane CLI')
      return {
        engine: kane,
        requested: 'auto',
        selected: 'kane',
        diagnostics,
      }
    }

    // Kane not available -> check Playwright
    diagnostics.push('Auto mode: Kane CLI not found; checking Playwright...')
    const pw = this.getPlaywright(options)
    const pwAvailable = await pw.available()
    if (pwAvailable) {
      diagnostics.push('Auto mode: Playwright active; using Playwright')
      return {
        engine: pw,
        requested: 'auto',
        selected: 'playwright',
        fallbackFrom: 'kane',
        fallbackReason: 'Kane CLI not installed; switched to Playwright browser automation',
        diagnostics,
      }
    }

    // Last resort fallback
    diagnostics.push('Auto mode: Falling back to HTTP probe engine')
    return {
      engine: this.getHttpProbe(),
      requested: 'auto',
      selected: 'http-probe',
      fallbackFrom: 'playwright',
      fallbackReason: 'Browser binaries unavailable; using honest HTTP probe verification',
      diagnostics,
    }
  }
}

export const engineManager = BrowserEngineManager.getInstance()
