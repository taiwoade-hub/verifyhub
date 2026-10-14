// VerifyHub API — /api/v1/examples — bundled example projects metadata

import { NextResponse } from 'next/server'
import { EXAMPLES } from '@/server/verifyhub/examples'

export const dynamic = 'force-static'

export async function GET() {
  return NextResponse.json({
    examples: EXAMPLES.map((e) => ({
      id: e.id,
      name: e.name,
      description: e.description,
      language: e.language,
      framework: e.framework,
    })),
  })
}
