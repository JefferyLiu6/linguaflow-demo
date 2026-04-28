import { beforeEach, describe, expect, it, vi } from 'vitest'

const drillSessionCountMock = vi.hoisted(() => vi.fn())
const drillSessionCreateManyMock = vi.hoisted(() => vi.fn())
const userSettingsFindUniqueMock = vi.hoisted(() => vi.fn())
const userSettingsCreateMock = vi.hoisted(() => vi.fn())
const customListFindUniqueMock = vi.hoisted(() => vi.fn())
const customListCreateMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth', () => ({
  withAuthenticatedUser: (handler: (request: Request, user: { userId: string; email: string | null }) => Promise<Response>) =>
    (request: Request) => handler(request, { userId: 'user-1', email: 'learner@example.com' }),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    drillSession: {
      count: drillSessionCountMock,
      createMany: drillSessionCreateManyMock,
    },
    userSettings: {
      findUnique: userSettingsFindUniqueMock,
      create: userSettingsCreateMock,
    },
    customList: {
      findUnique: customListFindUniqueMock,
      create: customListCreateMock,
    },
  },
}))

import { POST } from './route'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('/api/import-demo-data', () => {
  it('handles per-category import decisions independently', async () => {
    drillSessionCountMock.mockResolvedValue(0)
    userSettingsFindUniqueMock.mockResolvedValue({ userId: 'user-1', language: 'es' })
    customListFindUniqueMock.mockResolvedValue(null)
    customListCreateMock.mockRejectedValue(new Error('database write failed'))

    const response = await POST(
      new Request('http://localhost/api/import-demo-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessions: [
            {
              id: 'session-1',
              date: 1,
              drillType: 'phrase',
              correct: 4,
              total: 4,
              accuracy: 100,
              avgTime: 8.1,
              results: [],
              language: 'es',
            },
          ],
          language: 'fr',
          customList: [
            {
              id: 'custom-1',
              type: 'translation',
              instruction: 'Translate the term.',
              prompt: 'Hello',
              answer: 'Hola',
              promptLang: 'en-US',
            },
          ],
        }),
      }),
    )

    expect(drillSessionCreateManyMock).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          userId: 'user-1',
          clientSessionId: 'session-1',
        }),
      ],
      skipDuplicates: true,
    })
    expect(userSettingsCreateMock).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toEqual({
      sessions: 'imported',
      language: 'skipped_existing',
      customList: 'failed',
    })
  })
})
