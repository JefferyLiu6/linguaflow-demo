import { beforeEach, describe, expect, it, vi } from 'vitest'

const getAuthenticatedUserMock = vi.hoisted(() => vi.fn())
const getOrCreateDemoSessionMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth', () => ({
  getAuthenticatedUser: getAuthenticatedUserMock,
}))

vi.mock('@/lib/demoSession', () => ({
  getOrCreateDemoSession: getOrCreateDemoSessionMock,
}))

import { resolveRequestActor } from './requestActor'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('resolveRequestActor', () => {
  it('prefers the authenticated user over a guest cookie', async () => {
    getAuthenticatedUserMock.mockResolvedValue({
      userId: 'user-1',
      email: 'learner@example.com',
    })

    const actor = await resolveRequestActor(
      new Request('http://localhost/api/tutor', {
        headers: {
          cookie: 'linguaflow_demo_sid=guest-123',
          'x-forwarded-for': '10.0.0.1',
        },
      }),
    )

    expect(actor).toMatchObject({
      kind: 'user',
      actorKey: 'user:user-1',
      ip: '10.0.0.1',
      guestSessionId: null,
    })
    expect(getOrCreateDemoSessionMock).not.toHaveBeenCalled()
  })

  it('falls back to the guest demo cookie when no authenticated user exists', async () => {
    getAuthenticatedUserMock.mockResolvedValue(null)
    getOrCreateDemoSessionMock.mockReturnValue({
      sessionId: 'guest-123',
      setCookieHeader: 'linguaflow_demo_sid=guest-123; Path=/; HttpOnly',
    })

    const actor = await resolveRequestActor(
      new Request('http://localhost/api/generate-drills', {
        headers: {
          'x-forwarded-for': '10.0.0.2',
        },
      }),
    )

    expect(actor).toMatchObject({
      kind: 'guest',
      actorKey: 'guest:guest-123',
      ip: '10.0.0.2',
      guestSessionId: 'guest-123',
      setGuestCookieHeader: 'linguaflow_demo_sid=guest-123; Path=/; HttpOnly',
    })
  })

  it('passes a response-header sink through to authenticated actor resolution', async () => {
    const responseHeaders = new Headers()
    getAuthenticatedUserMock.mockResolvedValue({
      userId: 'user-2',
      email: 'auth@example.com',
    })

    await resolveRequestActor(
      new Request('http://localhost/api/tutor', {
        headers: { 'x-forwarded-for': '10.0.0.3' },
      }),
      { responseHeaders },
    )

    expect(getAuthenticatedUserMock).toHaveBeenCalledWith({ responseHeaders })
  })
})
