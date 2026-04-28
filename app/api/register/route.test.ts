import { beforeEach, describe, expect, it, vi } from 'vitest'

const getSupabaseConfigMock = vi.hoisted(() => vi.fn())
const signUpMock = vi.hoisted(() => vi.fn())
const createServerSupabaseClientMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/supabase/config', () => ({
  getSupabaseConfig: getSupabaseConfigMock,
}))

vi.mock('@/lib/supabase/server', () => ({
  applySupabaseResponseHeaders: <T extends Response>(response: T, responseHeaders: Headers) => {
    responseHeaders.forEach((value, key) => {
      response.headers.set(key, value)
    })
    return response
  },
  createServerSupabaseClient: createServerSupabaseClientMock,
}))

import { POST } from './route'

beforeEach(() => {
  vi.clearAllMocks()
  createServerSupabaseClientMock.mockImplementation(async (options?: { responseHeaders?: Headers }) => {
    options?.responseHeaders?.set('Cache-Control', 'private, no-cache, no-store')
    options?.responseHeaders?.set('Pragma', 'no-cache')

    return {
      auth: {
        signUp: signUpMock,
      },
    }
  })
})

describe('/api/register', () => {
  it('returns a clear error when signup succeeds without creating a session', async () => {
    getSupabaseConfigMock.mockReturnValue({ url: 'https://example.supabase.co', publishableKey: 'anon-key' })
    signUpMock.mockResolvedValue({
      data: {
        user: { id: 'user-1', email: 'learner@example.com' },
        session: null,
      },
      error: null,
    })

    const response = await POST(
      new Request('http://localhost/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'learner@example.com', password: 'secret123' }),
      }),
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'Signup succeeded but no session was created. Disable email confirmation for v1.',
    })
    expect(response.headers.get('Cache-Control')).toBe('private, no-cache, no-store')
    expect(response.headers.get('Pragma')).toBe('no-cache')
  })
})
