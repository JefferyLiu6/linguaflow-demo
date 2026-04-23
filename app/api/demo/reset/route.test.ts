import { describe, expect, it } from 'vitest'

import { POST } from './route'

function requestId() {
  return Math.random().toString(36).slice(2)
}

function buildRequest(init?: { ip?: string; cookie?: string }) {
  const headers = new Headers()
  if (init?.ip) headers.set('x-forwarded-for', init.ip)
  if (init?.cookie) headers.set('cookie', init.cookie)

  return new Request('http://localhost/api/demo/reset', {
    method: 'POST',
    headers,
  })
}

describe('/api/demo/reset', () => {
  it('returns ok and sets a demo session cookie for a new browser', async () => {
    const res = await POST(buildRequest({ ip: `10.0.7.${requestId()}` }))

    expect(res.status).toBe(200)
    expect(res.headers.get('Set-Cookie')).toContain('linguaflow_demo_sid=')
    await expect(res.json()).resolves.toEqual({ ok: true, clearedBuckets: 0 })
  })

  it('applies the burst limit for repeated reset requests from the same session', async () => {
    const cookie = `linguaflow_demo_sid=reset-${requestId()}`
    const ip = `10.0.8.${requestId()}`

    const first = await POST(buildRequest({ ip, cookie }))
    const second = await POST(buildRequest({ ip, cookie }))

    expect(first.status).toBe(200)
    expect(second.status).toBe(429)
    await expect(second.json()).resolves.toEqual({
      error: expect.stringContaining('Rate limit exceeded. Retry in'),
    })
  })
})
