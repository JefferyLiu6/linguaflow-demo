import { checkGlobalDailyAiLimit } from '@/lib/globalRateLimit'
import type { RequestActor } from '@/lib/requestActor'
import { resolveRequestActor } from '@/lib/requestActor'
import { checkRateLimit, tooManyRequests } from '@/lib/rateLimit'
import { RATE_LIMIT } from '@/lib/rateLimitConfig'
import { applySupabaseResponseHeaders } from '@/lib/supabase/server'

type AiRoute = 'generate' | 'tutor' | 'planner' | 'study-assist'

function appendGuestCookie(response: Response, setCookieHeader?: string): Response {
  if (!setCookieHeader) {
    return response
  }

  const headers = new Headers(response.headers)
  headers.append('Set-Cookie', setCookieHeader)

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

export function applyRequestActorResponseHeaders(
  response: Response,
  actor: Pick<RequestActor, 'setGuestCookieHeader' | 'responseHeaders'>,
): Response {
  const withGuestCookie = appendGuestCookie(response, actor.setGuestCookieHeader)

  if (!actor.responseHeaders) {
    return withGuestCookie
  }

  return applySupabaseResponseHeaders(withGuestCookie, actor.responseHeaders)
}

export async function enforceAiRateLimit(request: Request, route: AiRoute) {
  const responseHeaders = new Headers()
  const actor = await resolveRequestActor(request, { responseHeaders })

  const actorMinute = checkRateLimit(
    `${route}:a:m:${actor.actorKey}`,
    RATE_LIMIT.ai[route].sessionMinute,
    RATE_LIMIT.windows.minuteMs,
  )
  if (!actorMinute.ok) {
    return applyRequestActorResponseHeaders(tooManyRequests(actorMinute.retryAfter), actor)
  }

  const actorDaily = checkRateLimit(
    `ai:a:d:${actor.actorKey}`,
    RATE_LIMIT.ai[route].sessionDaily,
    RATE_LIMIT.windows.dayMs,
  )
  if (!actorDaily.ok) {
    return applyRequestActorResponseHeaders(tooManyRequests(actorDaily.retryAfter), actor)
  }

  const ipMinute = checkRateLimit(
    `${route}:ip:m:${actor.ip}`,
    RATE_LIMIT.ai[route].ipMinute,
    RATE_LIMIT.windows.minuteMs,
  )
  if (!ipMinute.ok) {
    return applyRequestActorResponseHeaders(tooManyRequests(ipMinute.retryAfter), actor)
  }

  const ipDaily = checkRateLimit(
    `ai:ip:d:${actor.ip}`,
    RATE_LIMIT.ai[route].ipDaily,
    RATE_LIMIT.windows.dayMs,
  )
  if (!ipDaily.ok) {
    return applyRequestActorResponseHeaders(tooManyRequests(ipDaily.retryAfter), actor)
  }

  const globalDaily = await checkGlobalDailyAiLimit()
  if (!globalDaily.ok) {
    return applyRequestActorResponseHeaders(tooManyRequests(globalDaily.retryAfter), actor)
  }

  return actor
}

export function appendGuestCookieHeader(response: Response, setCookieHeader?: string): Response {
  return appendGuestCookie(response, setCookieHeader)
}
