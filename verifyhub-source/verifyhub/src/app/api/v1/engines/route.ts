// VerifyHub API — /api/v1/engines
// Returns engine availability, diagnostics, operational health, and browser capabilities.

import { NextResponse } from 'next/server'
import { engineManager } from '@/server/verifyhub/engine-manager'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const statuses = await engineManager.getEngineStatuses()
    return NextResponse.json({
      engines: statuses,
      defaultEngine: 'playwright',
      supportedBrowsers: ['firefox', 'chromium', 'webkit'],
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'failed to query engine status' },
      { status: 500 }
    )
  }
}
