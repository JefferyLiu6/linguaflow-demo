import { beforeEach, describe, expect, it, vi } from 'vitest'

const drillSessionFindManyMock = vi.hoisted(() => vi.fn())
const drillSessionUpsertMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth', () => ({
  withAuthenticatedUser: (handler: (request: Request, user: { userId: string; email: string | null }) => Promise<Response>) =>
    (request: Request) => handler(request, { userId: 'user-1', email: 'learner@example.com' }),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    drillSession: {
      findMany: drillSessionFindManyMock,
      upsert: drillSessionUpsertMock,
    },
  },
}))

import { GET, POST } from './route'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('/api/sessions', () => {
  it('scopes session reads by authenticated user id', async () => {
    drillSessionFindManyMock.mockResolvedValue([
      {
        clientSessionId: 'session-1',
        date: 1,
        drillType: 'phrase',
        correct: 4,
        total: 4,
        accuracy: 100,
        avgTime: 8.5,
        results: [],
        language: 'es',
      },
    ])

    const response = await GET(new Request('http://localhost/api/sessions'))

    expect(drillSessionFindManyMock).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      orderBy: { date: 'desc' },
    })
    await expect(response.json()).resolves.toEqual([
      {
        id: 'session-1',
        date: 1,
        drillType: 'phrase',
        correct: 4,
        total: 4,
        accuracy: 100,
        avgTime: 8.5,
        results: [],
        language: 'es',
      },
    ])
  })

  it('sanitizes malformed stored drill results before returning them', async () => {
    drillSessionFindManyMock.mockResolvedValue([
      {
        clientSessionId: 'session-bad',
        date: 3,
        drillType: 'translation',
        correct: 1,
        total: 2,
        accuracy: 50,
        avgTime: 9.2,
        language: 'es',
        results: [
          null,
          { correct: true },
          {
            item: {
              id: 'item-1',
              type: 'translation',
              instruction: 'Translate to Spanish.',
              prompt: 'Hello.',
              answer: 'Hola.',
              promptLang: 'en-US',
            },
            correct: true,
            timedOut: false,
            userAnswer: 'Hola.',
            timeUsed: 6.4,
          },
        ],
      },
    ])

    const response = await GET(new Request('http://localhost/api/sessions'))

    await expect(response.json()).resolves.toEqual([
      {
        id: 'session-bad',
        date: 3,
        drillType: 'translation',
        correct: 1,
        total: 2,
        accuracy: 50,
        avgTime: 9.2,
        language: 'es',
        results: [
          {
            item: {
              id: 'item-1',
              type: 'translation',
              instruction: 'Translate to Spanish.',
              prompt: 'Hello.',
              answer: 'Hola.',
              promptLang: 'en-US',
            },
            correct: true,
            timedOut: false,
            userAnswer: 'Hola.',
            timeUsed: 6.4,
          },
        ],
      },
    ])
  })

  it('upserts session writes using the authenticated user scope and client session id', async () => {
    const response = await POST(
      new Request('http://localhost/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'session-2',
          date: 2,
          drillType: 'sentence',
          correct: 3,
          total: 5,
          accuracy: 60,
          avgTime: 11.2,
          results: [],
          language: 'fr',
        }),
      }),
    )

    expect(drillSessionUpsertMock).toHaveBeenCalledWith({
      where: {
        userId_clientSessionId: {
          userId: 'user-1',
          clientSessionId: 'session-2',
        },
      },
      create: expect.objectContaining({
        userId: 'user-1',
        clientSessionId: 'session-2',
        drillType: 'sentence',
        language: 'fr',
      }),
      update: expect.objectContaining({
        userId: 'user-1',
        clientSessionId: 'session-2',
      }),
    })
    await expect(response.json()).resolves.toEqual({ ok: true })
  })

  it('rejects malformed nested session results on write', async () => {
    const response = await POST(
      new Request('http://localhost/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'session-invalid',
          date: 2,
          drillType: 'sentence',
          correct: 1,
          total: 2,
          accuracy: 50,
          avgTime: 5.5,
          results: [{ correct: true }],
          language: 'fr',
        }),
      }),
    )

    expect(response.status).toBe(400)
    expect(drillSessionUpsertMock).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid session payload.',
    })
  })
})
