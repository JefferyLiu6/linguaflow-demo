import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseConfig } from '@/lib/supabase/config'
import { applySupabaseResponseHeaders, createServerSupabaseClient } from '@/lib/supabase/server'

export interface AuthenticatedUser {
  userId: string
  email: string | null
}

interface AuthRequestOptions {
  responseHeaders?: Headers
}

export function userFromClaims(
  claims: Record<string, unknown> | null | undefined,
): AuthenticatedUser | null {
  if (!claims) {
    return null
  }

  const userId = typeof claims.sub === 'string' ? claims.sub : null
  if (!userId) {
    return null
  }

  return {
    userId,
    email: typeof claims.email === 'string' ? claims.email : null,
  }
}

export async function getAuthenticatedUserFromClient(
  supabase: SupabaseClient,
): Promise<AuthenticatedUser | null> {
  const { data, error } = await supabase.auth.getClaims()
  if (error) {
    return null
  }

  return userFromClaims(data?.claims as Record<string, unknown> | undefined)
}

export async function getAuthenticatedUser(
  options?: AuthRequestOptions,
): Promise<AuthenticatedUser | null> {
  if (!getSupabaseConfig()) {
    return null
  }

  const supabase = await createServerSupabaseClient({
    responseHeaders: options?.responseHeaders,
  })
  return getAuthenticatedUserFromClient(supabase)
}

export async function getAuthState(
  options?: AuthRequestOptions,
): Promise<{ user: AuthenticatedUser | null }> {
  return { user: await getAuthenticatedUser(options) }
}

export function withAuthenticatedUser<TRequest extends Request = Request>(
  handler: (request: TRequest, user: AuthenticatedUser) => Promise<Response>,
) {
  return async function authenticatedHandler(request: TRequest): Promise<Response> {
    if (!getSupabaseConfig()) {
      return NextResponse.json(
        { error: 'Supabase auth is not configured.' },
        { status: 503 },
      )
    }

    const responseHeaders = new Headers()
    const user = await getAuthenticatedUser({ responseHeaders })
    if (!user) {
      return applySupabaseResponseHeaders(
        NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
        responseHeaders,
      )
    }

    return applySupabaseResponseHeaders(await handler(request, user), responseHeaders)
  }
}
