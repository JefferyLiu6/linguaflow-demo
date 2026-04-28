import { createServerClient } from '@supabase/ssr'
import { type NextRequest, NextResponse } from 'next/server'
import { getSupabaseConfig } from '@/lib/supabase/config'
import { userFromClaims, type AuthenticatedUser } from '@/lib/auth'

export async function updateSession(request: NextRequest): Promise<{
  response: NextResponse
  user: AuthenticatedUser | null
}> {
  const response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })

  const config = getSupabaseConfig()
  if (!config) {
    return { response, user: null }
  }

  const supabase = createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options)
        })
        Object.entries(headers).forEach(([key, value]) => {
          response.headers.set(key, value)
        })
      },
    },
  })

  const { data, error } = await supabase.auth.getClaims()
  if (error) {
    return { response, user: null }
  }

  return { response, user: userFromClaims(data?.claims as Record<string, unknown> | undefined) }
}
