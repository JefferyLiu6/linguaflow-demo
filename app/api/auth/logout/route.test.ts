import { beforeEach, describe, expect, it, vi } from 'vitest'

const getSupabaseConfigMock = vi.hoisted(() => vi.fn())
const signOutMock = vi.hoisted(() => vi.fn())
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
        signOut: signOutMock,
      },
    }
  })
})

describe('/api/auth/logout', () => {
  it('clears the session and preserves Supabase no-cache headers', async () => {
    getSupabaseConfigMock.mockReturnValue({ url: 'https://example.supabase.co', publishableKey: 'anon-key' })
    signOutMock.mockResolvedValue({ error: null })

    const response = await POST()

    expect(signOutMock).toHaveBeenCalled()
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(response.headers.get('Cache-Control')).toBe('private, no-cache, no-store')
    expect(response.headers.get('Pragma')).toBe('no-cache')
  })
})
