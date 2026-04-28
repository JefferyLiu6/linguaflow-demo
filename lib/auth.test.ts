import { beforeEach, describe, expect, it, vi } from 'vitest'

const getSupabaseConfigMock = vi.hoisted(() => vi.fn())
const createServerSupabaseClientMock = vi.hoisted(() => vi.fn())
const applySupabaseResponseHeadersMock = vi.hoisted(() => vi.fn((response: Response) => response))

vi.mock('@/lib/supabase/config', () => ({
  getSupabaseConfig: getSupabaseConfigMock,
}))

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: createServerSupabaseClientMock,
  applySupabaseResponseHeaders: applySupabaseResponseHeadersMock,
}))

import { getAuthenticatedUser, withAuthenticatedUser } from './auth'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('auth helpers', () => {
  it('returns null when Supabase is not configured', async () => {
    getSupabaseConfigMock.mockReturnValue(null)

    await expect(getAuthenticatedUser()).resolves.toBeNull()
    expect(createServerSupabaseClientMock).not.toHaveBeenCalled()
  })

  it('normalizes an authenticated user from verified claims', async () => {
    getSupabaseConfigMock.mockReturnValue({ url: 'https://example.supabase.co', publishableKey: 'anon-key' })
    createServerSupabaseClientMock.mockResolvedValue({
      auth: {
        getClaims: vi.fn().mockResolvedValue({
          data: { claims: { sub: 'user-1', email: 'learner@example.com' } },
          error: null,
        }),
      },
    })

    await expect(getAuthenticatedUser()).resolves.toEqual({
      userId: 'user-1',
      email: 'learner@example.com',
    })
  })

  it('returns 401 from the route wrapper when no authenticated user is present', async () => {
    getSupabaseConfigMock.mockReturnValue({ url: 'https://example.supabase.co', publishableKey: 'anon-key' })
    createServerSupabaseClientMock.mockResolvedValue({
      auth: {
        getClaims: vi.fn().mockResolvedValue({
          data: null,
          error: null,
        }),
      },
    })

    const handler = withAuthenticatedUser(async (_request, user) => Response.json(user))
    const response = await handler(new Request('http://localhost/api/protected'))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(createServerSupabaseClientMock).toHaveBeenCalledWith({
      responseHeaders: expect.any(Headers),
    })
    expect(applySupabaseResponseHeadersMock).toHaveBeenCalledTimes(1)
  })

  it('applies Supabase response headers to successful authenticated route responses', async () => {
    getSupabaseConfigMock.mockReturnValue({ url: 'https://example.supabase.co', publishableKey: 'anon-key' })
    createServerSupabaseClientMock.mockResolvedValue({
      auth: {
        getClaims: vi.fn().mockResolvedValue({
          data: { claims: { sub: 'user-1', email: 'learner@example.com' } },
          error: null,
        }),
      },
    })

    const handler = withAuthenticatedUser(async (_request, user) => Response.json(user))
    const response = await handler(new Request('http://localhost/api/protected'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      userId: 'user-1',
      email: 'learner@example.com',
    })
    expect(createServerSupabaseClientMock).toHaveBeenCalledWith({
      responseHeaders: expect.any(Headers),
    })
    expect(applySupabaseResponseHeadersMock).toHaveBeenCalledTimes(1)
  })
})
