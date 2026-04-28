import { beforeEach, describe, expect, it, vi } from 'vitest'

const getAuthStateMock = vi.hoisted(() => vi.fn())
const applySupabaseResponseHeadersMock = vi.hoisted(() => vi.fn((response: Response) => response))

vi.mock('@/lib/auth', () => ({
  getAuthState: getAuthStateMock,
}))

vi.mock('@/lib/supabase/server', () => ({
  applySupabaseResponseHeaders: applySupabaseResponseHeadersMock,
}))

import { GET } from './route'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('/api/auth/me', () => {
  it('returns the normalized authenticated user state', async () => {
    getAuthStateMock.mockResolvedValue({
      user: {
        userId: 'user-1',
        email: 'learner@example.com',
      },
    })

    const response = await GET()

    await expect(response.json()).resolves.toEqual({
      userId: 'user-1',
      email: 'learner@example.com',
    })
    expect(getAuthStateMock).toHaveBeenCalledWith({
      responseHeaders: expect.any(Headers),
    })
    expect(applySupabaseResponseHeadersMock).toHaveBeenCalledTimes(1)
  })
})
