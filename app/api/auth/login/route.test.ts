import { beforeEach, describe, expect, it, vi } from 'vitest'

const getSupabaseConfigMock = vi.hoisted(() => vi.fn())
const signInWithPasswordMock = vi.hoisted(() => vi.fn())
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
        signInWithPassword: signInWithPasswordMock,
      },
    }
  })
})

describe('/api/auth/login', () => {
  it('returns 503 when Supabase auth is not configured', async () => {
    getSupabaseConfigMock.mockReturnValue(null)

    const response = await POST(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'learner@example.com', password: 'secret123' }),
      }),
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: 'Supabase auth is not configured.',
    })
  })

  it('signs in with password and returns the normalized user payload', async () => {
    getSupabaseConfigMock.mockReturnValue({ url: 'https://example.supabase.co', publishableKey: 'anon-key' })
    signInWithPasswordMock.mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
          email: 'learner@example.com',
        },
      },
      error: null,
    })

    const response = await POST(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'learner@example.com', password: 'secret123' }),
      }),
    )

    expect(signInWithPasswordMock).toHaveBeenCalledWith({
      email: 'learner@example.com',
      password: 'secret123',
    })
    await expect(response.json()).resolves.toEqual({
      userId: 'user-1',
      email: 'learner@example.com',
    })
    expect(response.headers.get('Cache-Control')).toBe('private, no-cache, no-store')
    expect(response.headers.get('Pragma')).toBe('no-cache')
  })
})
