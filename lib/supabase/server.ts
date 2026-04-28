import { createServerClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { requireSupabaseConfig } from '@/lib/supabase/config'

interface CreateServerSupabaseClientOptions {
  responseHeaders?: Headers
}

export async function createServerSupabaseClient(
  options?: CreateServerSupabaseClientOptions,
): Promise<SupabaseClient> {
  const { url, publishableKey } = requireSupabaseConfig()
  const cookieStore = await cookies()
  const responseHeaders = options?.responseHeaders

  return createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet, headersToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options)
          })
        } catch {
          // Server Components cannot always write cookies. Proxy handles refreshes.
        }

        if (responseHeaders) {
          Object.entries(headersToSet).forEach(([key, value]) => {
            responseHeaders.set(key, value)
          })
        }
      },
    },
  })
}

export function applySupabaseResponseHeaders<T extends Response>(
  response: T,
  responseHeaders: Headers,
): T {
  if ([...responseHeaders.keys()].length === 0) {
    return response
  }

  const headers = new Headers(response.headers)
  responseHeaders.forEach((value, key) => {
    headers.set(key, value)
  })

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  }) as T
}
