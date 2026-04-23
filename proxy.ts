import { type NextRequest, NextResponse } from 'next/server'
import { createDemoSession } from '@/lib/demoSession'

// Demo mode — all routes are publicly accessible, no auth required
export function proxy(request: NextRequest) {
  const response = NextResponse.next()

  // Only rotate the demo cookie for top-level document requests.
  if (request.headers.get('sec-fetch-dest') !== 'document') {
    return response
  }

  const { setCookieHeader } = createDemoSession()
  response.headers.append('Set-Cookie', setCookieHeader)
  return response
}

export const config = {
  matcher: [
    '/',
    '/drill/:path*',
    '/dashboard/:path*',
    '/library/:path*',
    '/study/:path*',
  ],
}
