import { NextResponse, type NextRequest } from 'next/server'

// VerifyHub routes that should NEVER be rewritten
const VERIFYHUB_ROUTES = [
  '/api/',
  '/_next/',
  '/runs',
  '/projects',
  '/settings',
  '/kane',
  '/telegram',
  '/favicon.ico',
]

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // If already a known VerifyHub internal route or home, proceed normally
  if (pathname === '/' || VERIFYHUB_ROUTES.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.next()
  }

  // Check if this request originated from inside an active live preview iframe
  const referer = req.headers.get('referer') || ''
  const previewMatch = referer.match(/\/api\/v1\/preview\/([a-zA-Z0-9_-]+)/)

  if (previewMatch) {
    const runId = previewMatch[1]
    const cleanPath = pathname.replace(/^\/+/, '')
    const targetUrl = new URL(`/api/v1/preview/${runId}/${cleanPath}${req.nextUrl.search}`, req.url)
    return NextResponse.rewrite(targetUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for Next.js internal static assets
     */
    '/((?!_next/static|_next/image).*)',
  ],
}
