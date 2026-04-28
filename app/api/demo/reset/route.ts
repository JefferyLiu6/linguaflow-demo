import { NextResponse } from 'next/server'
import { checkRateLimit, getIp, tooManyRequests } from '@/lib/rateLimit'
import { getOrCreateDemoSession } from '@/lib/demoSession'
import { RATE_LIMIT } from '@/lib/rateLimitConfig'

function appendSetCookieHeader(response: Response, setCookieHeader?: string): Response {
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

// Demo utility endpoint: resets client UX state only.
// It intentionally does NOT clear server-side quotas.
export async function POST(req: Request) {
  const { sessionId, setCookieHeader } = getOrCreateDemoSession(req)
  const ip = getIp(req)
  const burst = checkRateLimit(
    `reset:s:m:${sessionId}`,
    RATE_LIMIT.reset.sessionBurst,
    RATE_LIMIT.windows.resetBurstMs,
  )
  if (!burst.ok) {
    return appendSetCookieHeader(tooManyRequests(burst.retryAfter), setCookieHeader)
  }
  const dailySession = checkRateLimit(
    `reset:s:d:${sessionId}`,
    RATE_LIMIT.reset.sessionDaily,
    RATE_LIMIT.windows.dayMs,
  )
  if (!dailySession.ok) {
    return appendSetCookieHeader(tooManyRequests(dailySession.retryAfter), setCookieHeader)
  }
  const dailyIp = checkRateLimit(
    `reset:ip:d:${ip}`,
    RATE_LIMIT.reset.ipDaily,
    RATE_LIMIT.windows.dayMs,
  )
  if (!dailyIp.ok) {
    return appendSetCookieHeader(tooManyRequests(dailyIp.retryAfter), setCookieHeader)
  }

  return appendSetCookieHeader(
    NextResponse.json({ ok: true, clearedBuckets: 0 }),
    setCookieHeader,
  )
}
