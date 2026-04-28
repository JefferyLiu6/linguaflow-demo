import { afterEach, describe, expect, it, vi } from 'vitest'

// Mock Supabase auth
vi.mock('@/lib/supabase/config', () => ({
  getSupabaseConfig: () => ({ url: 'http://supabase.test', anonKey: 'test-key' }),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(),
  applySupabaseResponseHeaders: (_res: Response) => _res,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    aiResponseFeedback: {
      upsert: vi.fn().mockResolvedValue({}),
    },
  },
}))

import { POST } from './route'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'

const VALID_BODY = {
  responseId:       'resp-001',
  surface:          'study',
  mode:             'explain_card',
  helpful:          true,
  language:         'English',
  itemId:           'en01',
  source:           { id: 'en_formal_register_precision', title: 'Formal Register Precision' },
  userPrompt:       null,
  assistantMessage: 'This card tests formal register precision.',
  model:            'openai/gpt-4o-mini',
}

function buildRequest(body: unknown) {
  return new Request('http://localhost/api/ai-feedback', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })
}

function mockAuthenticatedUser(userId = 'user-uuid-123') {
  const mockClient = {
    auth: {
      getClaims: vi.fn().mockResolvedValue({
        data: { claims: { sub: userId, email: 'test@test.com' } },
        error: null,
      }),
    },
  }
  vi.mocked(createServerSupabaseClient).mockResolvedValue(mockClient as never)
  return userId
}

function mockUnauthenticated() {
  const mockClient = {
    auth: {
      getClaims: vi.fn().mockResolvedValue({ data: null, error: new Error('not authenticated') }),
    },
  }
  vi.mocked(createServerSupabaseClient).mockResolvedValue(mockClient as never)
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/ai-feedback', () => {
  it('returns 401 for unauthenticated requests', async () => {
    mockUnauthenticated()
    const res = await POST(buildRequest(VALID_BODY))
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('returns 400 when responseId is missing', async () => {
    mockAuthenticatedUser()
    const res = await POST(buildRequest({ ...VALID_BODY, responseId: '' }))
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringContaining('responseId') })
  })

  it('returns 400 when surface is invalid', async () => {
    mockAuthenticatedUser()
    const res = await POST(buildRequest({ ...VALID_BODY, surface: 'planner' }))
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringContaining('surface') })
  })

  it('returns 400 when helpful is not boolean', async () => {
    mockAuthenticatedUser()
    const res = await POST(buildRequest({ ...VALID_BODY, helpful: 'yes' }))
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringContaining('helpful') })
  })

  it('returns 400 when source.id is missing', async () => {
    mockAuthenticatedUser()
    const res = await POST(buildRequest({ ...VALID_BODY, source: { id: '', title: 'title' } }))
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringContaining('source.id') })
  })

  it('persists feedback and returns { ok: true } for valid authenticated request', async () => {
    const userId = mockAuthenticatedUser()
    const res = await POST(buildRequest(VALID_BODY))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true })

    expect(vi.mocked(prisma.aiResponseFeedback.upsert)).toHaveBeenCalledTimes(1)
    const call = vi.mocked(prisma.aiResponseFeedback.upsert).mock.calls[0]![0]
    expect(call.where).toEqual({ userId_responseId: { userId, responseId: 'resp-001' } })
    expect(call.create).toMatchObject({
      userId,
      responseId:       'resp-001',
      surface:          'study',
      mode:             'explain_card',
      helpful:          true,
      language:         'English',
      itemId:           'en01',
      sourceId:         'en_formal_register_precision',
      sourceTitle:      'Formal Register Precision',
      assistantMessage: 'This card tests formal register precision.',
      model:            'openai/gpt-4o-mini',
    })
  })

  it('upsert is called with the same data for create and update (idempotent)', async () => {
    mockAuthenticatedUser()
    await POST(buildRequest(VALID_BODY))
    const call = vi.mocked(prisma.aiResponseFeedback.upsert).mock.calls[0]![0]
    // create and update payloads must be equal so double-clicks are no-ops
    expect(call.create).toEqual(call.update)
  })

  it('accepts both tutor and study as valid surfaces', async () => {
    mockAuthenticatedUser()
    const tutorRes = await POST(buildRequest({ ...VALID_BODY, surface: 'tutor', mode: 'explain' }))
    expect(tutorRes.status).toBe(200)
    const studyRes = await POST(buildRequest({ ...VALID_BODY, surface: 'study', mode: 'freeform_help' }))
    expect(studyRes.status).toBe(200)
  })

  it('allows userPrompt to be null', async () => {
    mockAuthenticatedUser()
    const res = await POST(buildRequest({ ...VALID_BODY, userPrompt: null }))
    expect(res.status).toBe(200)
    const call = vi.mocked(prisma.aiResponseFeedback.upsert).mock.calls[0]![0]
    expect(call.create.userPrompt).toBeNull()
  })
})
