import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getAuthenticatedUserMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth', () => ({
  getAuthenticatedUser: getAuthenticatedUserMock,
}))

import { POST } from './route'

function requestId() {
  return Math.random().toString(36).slice(2)
}

function buildRequest(body: BodyInit, init?: { ip?: string; cookie?: string }) {
  const headers = new Headers({ 'Content-Type': 'application/json' })
  if (init?.ip) headers.set('x-forwarded-for', init.ip)
  if (init?.cookie) headers.set('cookie', init.cookie)

  return new Request('http://localhost/api/generate-drills', {
    method: 'POST',
    headers,
    body,
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  getAuthenticatedUserMock.mockReset()
})

beforeEach(() => {
  getAuthenticatedUserMock.mockResolvedValue(null)
})

describe('/api/generate-drills', () => {
  it('applies Supabase cache-control headers when auth refresh writes them', async () => {
    getAuthenticatedUserMock.mockImplementation(async (options?: { responseHeaders?: Headers }) => {
      options?.responseHeaders?.set('Cache-Control', 'private, no-cache, no-store')
      options?.responseHeaders?.set('Pragma', 'no-cache')

      return {
        userId: 'user-1',
        email: 'learner@example.com',
      }
    })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          drills: [],
          model: 'openai/gpt-4o-mini',
          elapsed_ms: 12,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    )

    const res = await POST(
      buildRequest(JSON.stringify({ mode: 'guided' }), {
        ip: `10.0.9.${requestId()}`,
        cookie: 'linguaflow_demo_sid=guest-123',
      }),
    )

    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('private, no-cache, no-store')
    expect(res.headers.get('Pragma')).toBe('no-cache')
    expect(res.headers.get('Set-Cookie')).toBeNull()
  })

  it('returns 400 for invalid JSON', async () => {
    const req = buildRequest('{"mode":', { ip: `10.0.0.${requestId()}` })

    const res = await POST(req)

    expect(res.status).toBe(400)
    expect(res.headers.get('Set-Cookie')).toContain('linguaflow_demo_sid=')
    await expect(res.json()).resolves.toEqual({ error: 'Invalid JSON body' })
  })

  it('maps frontend payloads to agent payloads and remaps the response', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          drills: [
            {
              id: 'ai_1',
              type: 'translation',
              instruction: 'Translate to Spanish.',
              prompt: 'Hello.',
              answer: 'Hola.',
              prompt_lang: 'en-US',
            },
          ],
          model: 'openai/gpt-4o-mini',
          elapsed_ms: 321,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    )

    const req = buildRequest(
      JSON.stringify({
        mode: 'guided',
        language: 'French',
        count: 3,
        topic: 'travel',
        difficulty: 'a1',
        grammar: 'mixed',
        drillType: 'translation',
      }),
      { ip: `10.0.1.${requestId()}` },
    )

    const res = await POST(req)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('http://localhost:8000/generate')
    expect(init).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    expect(JSON.parse(String(init?.body))).toEqual({
      mode: 'guided',
      language: 'French',
      count: 3,
      model: 'openai/gpt-4o-mini',
      raw_prompt: '',
      guided: {
        topic: 'travel',
        difficulty: 'a1',
        grammar: 'mixed',
        drill_type: 'translation',
      },
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('Set-Cookie')).toContain('linguaflow_demo_sid=')
    await expect(res.json()).resolves.toEqual({
      drills: [
        {
          id: 'ai_1',
          type: 'translation',
          instruction: 'Translate to Spanish.',
          prompt: 'Hello.',
          answer: 'Hola.',
          promptLang: 'en-US',
        },
      ],
      model: 'openai/gpt-4o-mini',
      elapsedMs: 321,
    })
  })

  it('surfaces upstream agent errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ detail: 'Model overloaded' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const req = buildRequest(JSON.stringify({ mode: 'raw', rawPrompt: 'hello' }), {
      ip: `10.0.2.${requestId()}`,
    })

    const res = await POST(req)

    expect(res.status).toBe(503)
    expect(res.headers.get('Set-Cookie')).toContain('linguaflow_demo_sid=')
    await expect(res.json()).resolves.toEqual({ error: 'Model overloaded' })
  })
})
