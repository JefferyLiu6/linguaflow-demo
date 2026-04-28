import { beforeEach, describe, expect, it, vi } from 'vitest'

const getOrCreateDemoSessionMock = vi.hoisted(() => vi.fn())
const checkRateLimitMock = vi.hoisted(() => vi.fn())
const getIpMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/demoSession', () => ({
  getOrCreateDemoSession: getOrCreateDemoSessionMock,
}))

vi.mock('@/lib/rateLimit', () => ({
  checkRateLimit: checkRateLimitMock,
  getIp: getIpMock,
  tooManyRequests: (retryAfter: number) =>
    new Response(
      JSON.stringify({ error: `Rate limit exceeded. Retry in ${retryAfter}s.` }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(retryAfter),
        },
      },
    ),
}))

vi.mock('@/lib/rateLimitConfig', () => ({
  RATE_LIMIT: {
    reset: {
      sessionBurst: 1,
      sessionDaily: 1,
      ipDaily: 1,
    },
    windows: {
      resetBurstMs: 1_000,
      dayMs: 86_400_000,
    },
  },
}))

import { POST } from './route'

beforeEach(() => {
  vi.clearAllMocks()
  getIpMock.mockReturnValue('10.0.9.1')
  getOrCreateDemoSessionMock.mockReturnValue({
    sessionId: 'guest-123',
    setCookieHeader: 'linguaflow_demo_sid=guest-123; Path=/; HttpOnly',
  })
})

describe('/api/demo/reset throttled responses', () => {
  it('returns a native 429 response with the demo cookie attached', async () => {
    checkRateLimitMock.mockReturnValueOnce({ ok: false, retryAfter: 12 })

    const response = await POST(new Request('http://localhost/api/demo/reset', { method: 'POST' }))

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('12')
    expect(response.headers.get('Set-Cookie')).toContain('linguaflow_demo_sid=guest-123')
    await expect(response.json()).resolves.toEqual({
      error: 'Rate limit exceeded. Retry in 12s.',
    })
  })
})
