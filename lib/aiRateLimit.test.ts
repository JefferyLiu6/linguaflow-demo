import { describe, expect, it } from 'vitest'
import { appendGuestCookieHeader, applyRequestActorResponseHeaders } from './aiRateLimit'
import { tooManyRequests } from './rateLimit'

describe('appendGuestCookieHeader', () => {
  it('returns a new response when adding a guest cookie to a rate-limit response', async () => {
    const response = appendGuestCookieHeader(
      tooManyRequests(12),
      'linguaflow_demo_sid=guest-123; Path=/; HttpOnly',
    )

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('12')
    expect(response.headers.get('Set-Cookie')).toContain('linguaflow_demo_sid=guest-123')
    await expect(response.json()).resolves.toEqual({
      error: 'Rate limit exceeded. Retry in 12s.',
    })
  })
})

describe('applyRequestActorResponseHeaders', () => {
  it('merges guest cookies with Supabase cache headers', async () => {
    const response = applyRequestActorResponseHeaders(
      Response.json({ ok: true }),
      {
        setGuestCookieHeader: 'linguaflow_demo_sid=guest-123; Path=/; HttpOnly',
        responseHeaders: new Headers({
          'Cache-Control': 'private, no-cache, no-store',
          Pragma: 'no-cache',
        }),
      },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Set-Cookie')).toContain('linguaflow_demo_sid=guest-123')
    expect(response.headers.get('Cache-Control')).toBe('private, no-cache, no-store')
    expect(response.headers.get('Pragma')).toBe('no-cache')
    await expect(response.json()).resolves.toEqual({ ok: true })
  })
})
