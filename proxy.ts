import { type NextRequest } from 'next/server'
import { getOrCreateDemoSession } from '@/lib/demoSession'
import { updateSession } from '@/lib/supabase/proxy'

export async function proxy(request: NextRequest) {
  const { response, user } = await updateSession(request)

  if (request.headers.get('sec-fetch-dest') !== 'document') {
    return response
  }

  if (user) {
    return response
  }

  const { setCookieHeader } = getOrCreateDemoSession(request)
  if (setCookieHeader) {
    response.headers.append('Set-Cookie', setCookieHeader)
  }

  return response
}

export const config = {
  matcher: [
    '/',
    '/drill/:path*',
    '/dashboard/:path*',
    '/library/:path*',
    '/study/:path*',
    '/login',
  ],
}
