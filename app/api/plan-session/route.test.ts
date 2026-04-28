import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getAuthenticatedUserMock = vi.hoisted(() => vi.fn())
const findManyMock              = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth', () => ({
  getAuthenticatedUser: getAuthenticatedUserMock,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    drillSession: {
      findMany: findManyMock,
    },
  },
}))

import { POST } from './route'

function requestId() {
  return Math.random().toString(36).slice(2)
}

function buildRequest(body: BodyInit, init?: { ip?: string; cookie?: string; bypassCache?: boolean }) {
  const headers = new Headers({ 'Content-Type': 'application/json' })
  if (init?.ip) headers.set('x-forwarded-for', init.ip)
  if (init?.cookie) headers.set('cookie', init.cookie)
  if (init?.bypassCache) headers.set('X-Bypass-Cache', '1')
  return new Request('http://localhost/api/plan-session', { method: 'POST', headers, body })
}

function validResult(itemId: string, correct = false) {
  return {
    item: {
      id: itemId,
      type: 'substitution',
      category: 'sentence',
      topic: 'work',
      instruction: 'Replace.',
      prompt: 'Please [help]',
      answer: 'assist',
      promptLang: 'en-US',
    },
    correct,
    timedOut: false,
    userAnswer: correct ? 'assist' : 'help',
    timeUsed: 8,
  }
}

function validSession(id: string, opts?: { language?: string }) {
  return {
    id,
    date: 1_745_000_000_000,
    drillType: 'sentence',
    correct: 1,
    total: 2,
    accuracy: 50,
    avgTime: 8,
    results: [validResult('en07'), validResult('en09', true)],
    language: opts?.language ?? 'en',
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  getAuthenticatedUserMock.mockReset()
  findManyMock.mockReset()
})

beforeEach(() => {
  getAuthenticatedUserMock.mockResolvedValue(null)
})

describe('/api/plan-session', () => {
  it('returns 400 for invalid JSON', async () => {
    const res = await POST(buildRequest('{not json', { ip: `10.20.0.${requestId()}` }))
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'Invalid JSON body' })
  })

  it('returns 400 when language is not en', async () => {
    const res = await POST(
      buildRequest(JSON.stringify({ language: 'es', sessions: [] }), { ip: `10.20.1.${requestId()}` }),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(String(body.error)).toMatch(/English/)
  })

  it('returns 400 when guest sessions is not an array', async () => {
    const res = await POST(
      buildRequest(JSON.stringify({ language: 'en', sessions: 'not-an-array' }), {
        ip: `10.20.2.${requestId()}`,
      }),
    )
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'sessions must be an array' })
  })

  it('returns 400 when guest sessions are all malformed (sanitized to empty)', async () => {
    // Each entry is missing required fields → sanitizeSessionRecords drops them all.
    const res = await POST(
      buildRequest(
        JSON.stringify({
          language: 'en',
          sessions: [{ foo: 'bar' }, { id: 1, date: 'not-a-number' }, null],
        }),
        { ip: `10.20.3.${requestId()}` },
      ),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/At least 2 English sessions/)
  })

  it('returns 400 with < 2 valid English sessions in guest body', async () => {
    const res = await POST(
      buildRequest(
        JSON.stringify({ language: 'en', sessions: [validSession('s1')] }),
        { ip: `10.20.4.${requestId()}` },
      ),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/At least 2 English sessions/)
  })

  it('does NOT throw on malformed guest payload — sanitizes silently and 400s on insufficient data', async () => {
    // Mixed array: one valid English session, one garbage object, one Spanish session.
    // Sanitizer keeps the English one only → still under the threshold → 400 (not 500).
    const res = await POST(
      buildRequest(
        JSON.stringify({
          language: 'en',
          sessions: [
            validSession('good-en-1'),
            { totally: 'malformed' },
            validSession('good-es-1', { language: 'es' }),
          ],
        }),
        { ip: `10.20.5.${requestId()}` },
      ),
    )
    expect(res.status).toBe(400)  // not 500
  })

  it('forwards 2+ guest sessions to the agent and remaps snake → camel', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          weak_points: [{ label: 'formal_register', severity: 0.7, evidence: ['en07'] }],
          recommended_drill_types: ['sentence', 'vocab'],
          recommended_topics: ['work', 'daily'],
          next_session_plan: { language: 'en', drill_type: 'sentence', topic: 'work', count: 10 },
          study_cards_to_review: [{ item_id: 'en07', prompt: '...', reason: 'incorrect' }],
          self_confidence: 0.7,
          confidence: 0.92,
          rationale: 'A sufficiently long rationale that the validator should accept.',
          source: 'model',
          fallback_reason: null,
          model: 'openai/gpt-4o-mini',
          elapsed_ms: 1200,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    const req = buildRequest(
      JSON.stringify({
        language: 'en',
        sessions: [validSession('s1'), validSession('s2')],
      }),
      { ip: `10.20.6.${requestId()}` },
    )

    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    // Wire is camelCase
    expect(body.recommendedDrillTypes).toEqual(['sentence', 'vocab'])
    expect(body.nextSessionPlan).toEqual({ language: 'en', drillType: 'sentence', topic: 'work', count: 10 })
    expect(body.weakPoints[0].label).toBe('formal_register')
    expect(body.studyCardsToReview[0].itemId).toBe('en07')
    expect(body.fallbackReason).toBeNull()

    // Agent payload is snake_case
    const agentPayload = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(agentPayload.language).toBe('en')
    expect(agentPayload.sessions[0]).toMatchObject({
      drill_type: 'sentence',
      results: [
        expect.objectContaining({ item_id: 'en07', expected_answer: 'assist', time_used: 8 }),
        expect.objectContaining({ item_id: 'en09', correct: true }),
      ],
    })
  })

  it('forwards bypass_cache=true when X-Bypass-Cache: 1 is present', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          weak_points: [], recommended_drill_types: ['sentence'], recommended_topics: ['daily'],
          next_session_plan: { language: 'en', drill_type: 'sentence', topic: 'daily', count: 10 },
          study_cards_to_review: [],
          self_confidence: 0, confidence: 1, rationale: 'A sufficiently long rationale.',
          source: 'heuristic_fallback', fallback_reason: null,
          model: 'heuristic', elapsed_ms: 0,
        }),
        { status: 200 },
      ),
    )
    await POST(
      buildRequest(
        JSON.stringify({ language: 'en', sessions: [validSession('s1'), validSession('s2')] }),
        { ip: `10.20.7.${requestId()}`, bypassCache: true },
      ),
    )
    const agentPayload = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(agentPayload.bypass_cache).toBe(true)
  })

  it('uses Prisma history (not body.sessions) for authenticated users', async () => {
    getAuthenticatedUserMock.mockResolvedValue({ userId: 'user-1', email: 'x@example.com' })
    findManyMock.mockResolvedValue([
      {
        clientSessionId: 'authed-1',
        date: 1_745_000_000_000,
        drillType: 'sentence',
        language: 'en',
        correct: 1, total: 2, accuracy: 50, avgTime: 8,
        results: [
          {
            item: validSession('s1').results[0].item,
            correct: false, timedOut: false, userAnswer: '', timeUsed: 8,
          },
        ],
      },
      {
        clientSessionId: 'authed-2',
        date: 1_744_000_000_000,
        drillType: 'sentence',
        language: 'en',
        correct: 1, total: 1, accuracy: 100, avgTime: 5,
        results: [
          {
            item: validSession('s1').results[1].item,
            correct: true, timedOut: false, userAnswer: 'assist', timeUsed: 5,
          },
        ],
      },
    ])

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        weak_points: [], recommended_drill_types: ['sentence'], recommended_topics: ['work'],
        next_session_plan: { language: 'en', drill_type: 'sentence', topic: 'work', count: 10 },
        study_cards_to_review: [],
        self_confidence: 0, confidence: 1, rationale: 'A sufficiently long rationale.',
        source: 'heuristic_fallback', fallback_reason: null, model: 'heuristic', elapsed_ms: 0,
      }), { status: 200 }),
    )

    // Body sessions are present but should be IGNORED in favor of Prisma history.
    const decoyPoison = [{ totally: 'malformed' }]

    const res = await POST(
      buildRequest(
        JSON.stringify({ language: 'en', sessions: decoyPoison }),
        { ip: `10.20.8.${requestId()}` },
      ),
    )
    expect(res.status).toBe(200)
    expect(findManyMock).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'user-1', language: 'en' },
    }))
    const agentPayload = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(agentPayload.sessions.map((s: { id: string }) => s.id)).toEqual(['authed-1', 'authed-2'])
  })

  it('returns 502 when the agent is unreachable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'))
    const res = await POST(
      buildRequest(
        JSON.stringify({ language: 'en', sessions: [validSession('s1'), validSession('s2')] }),
        { ip: `10.20.9.${requestId()}` },
      ),
    )
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.error).toMatch(/agent is not running/i)
  })

  it('propagates agent error status + message', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ detail: 'something specific went wrong' }), { status: 503 }),
    )
    const res = await POST(
      buildRequest(
        JSON.stringify({ language: 'en', sessions: [validSession('s1'), validSession('s2')] }),
        { ip: `10.20.10.${requestId()}` },
      ),
    )
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.error).toBe('something specific went wrong')
  })
})
