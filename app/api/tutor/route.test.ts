import { afterEach, describe, expect, it, vi } from 'vitest'

import { POST } from './route'

function requestId() {
  return Math.random().toString(36).slice(2)
}

function buildRequest(body: BodyInit, init?: { ip?: string; cookie?: string }) {
  const headers = new Headers({ 'Content-Type': 'application/json' })
  if (init?.ip) headers.set('x-forwarded-for', init.ip)
  if (init?.cookie) headers.set('cookie', init.cookie)

  return new Request('http://localhost/api/tutor', {
    method: 'POST',
    headers,
    body,
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('/api/tutor', () => {
  it('validates required request fields', async () => {
    const missingItemRes = await POST(
      buildRequest(JSON.stringify({ messages: [{ role: 'user', content: 'help' }] }), {
        ip: `10.0.3.${requestId()}`,
      }),
    )
    expect(missingItemRes.status).toBe(400)
    expect(missingItemRes.headers.get('Set-Cookie')).toContain('linguaflow_demo_sid=')
    await expect(missingItemRes.json()).resolves.toEqual({ error: 'currentItem is required' })

    const missingMessagesRes = await POST(
      buildRequest(JSON.stringify({ currentItem: { prompt: 'Hola' } }), {
        ip: `10.0.4.${requestId()}`,
      }),
    )
    expect(missingMessagesRes.status).toBe(400)
    expect(missingMessagesRes.headers.get('Set-Cookie')).toContain('linguaflow_demo_sid=')
    await expect(missingMessagesRes.json()).resolves.toEqual({
      error: 'messages must be a non-empty array',
    })
  })

  it('maps tutor requests to the agent and remaps structured output', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          assistant_message: 'Think about the verb ending first.',
          structured: {
            hint_level: 2,
            suggested_phrase: 'Try the nosotros form.',
            learner_ready: false,
            retrieval_hit: true,
            retrieved_sources: [
              { id: 'note_1', title: 'Subject agreement contrast' },
            ],
          },
          model: 'openai/gpt-4o-mini',
          elapsed_ms: 654,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    )

    const req = buildRequest(
      JSON.stringify({
        model: 'openai/gpt-4o-mini',
        sessionContext: {
          language: 'Spanish',
          drillType: 'translation',
          itemIndex: 1,
          itemsTotal: 10,
        },
        currentItem: {
          id: 'es01',
          category: 'sentence',
          topic: 'daily',
          instruction: 'Translate to Spanish.',
          prompt: 'We speak English.',
          type: 'translation',
          expectedAnswer: 'Nosotros hablamos inglés.',
          userAnswer: 'Nosotros habla inglés.',
          feedback: 'incorrect',
        },
        recentItems: [
          {
            prompt: 'Hello.',
            userAnswer: 'Hola.',
            correct: true,
            timedOut: false,
          },
        ],
        messages: [{ role: 'user', content: 'Can I get a hint?' }],
        constraints: {
          maxCoachTurns: 10,
          maxHintLevel: 3,
          currentHintLevel: 1,
        },
      }),
      { ip: `10.0.5.${requestId()}` },
    )

    const res = await POST(req)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('http://localhost:8000/tutor')
    const payload = JSON.parse(String(init?.body))
    expect(payload.request_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(payload).toMatchObject({
      model: 'openai/gpt-4o-mini',
      session_context: {
        language: 'Spanish',
        drill_type: 'translation',
        item_index: 1,
        items_total: 10,
      },
      current_item: {
        id: 'es01',
        category: 'sentence',
        topic: 'daily',
        instruction: 'Translate to Spanish.',
        prompt: 'We speak English.',
        type: 'translation',
        expected_answer: 'Nosotros hablamos inglés.',
        user_answer: 'Nosotros habla inglés.',
        feedback: 'incorrect',
      },
      recent_items: [
        {
          prompt: 'Hello.',
          user_answer: 'Hola.',
          correct: true,
          timed_out: false,
        },
      ],
      messages: [{ role: 'user', content: 'Can I get a hint?' }],
      constraints: {
        max_coach_turns: 10,
        max_hint_level: 3,
        current_hint_level: 1,
      },
    })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      assistantMessage: 'Think about the verb ending first.',
      structured: {
        hintLevel: 2,
        suggestedPhrase: 'Try the nosotros form.',
        learnerReady: false,
        retrievalHit: true,
        retrievedSources: [
          { id: 'note_1', title: 'Subject agreement contrast' },
        ],
      },
      model: 'openai/gpt-4o-mini',
      elapsedMs: 654,
      responseId: null,  // Python response had no response_id field
    })
  })

  it('returns a helpful 502 when the tutor agent is unavailable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('fetch failed'))

    const req = buildRequest(
      JSON.stringify({
        currentItem: {
          id: 'es01',
          category: 'sentence',
          topic: 'daily',
          instruction: 'Translate to Spanish.',
          prompt: 'Hello.',
          type: 'translation',
          expectedAnswer: 'Hola.',
          userAnswer: '',
          feedback: 'timeout',
        },
        messages: [{ role: 'user', content: 'What happened?' }],
      }),
      { ip: `10.0.6.${requestId()}` },
    )

    const res = await POST(req)

    expect(res.status).toBe(502)
    expect(res.headers.get('Set-Cookie')).toContain('linguaflow_demo_sid=')
    await expect(res.json()).resolves.toEqual({
      error: 'Python agent is not running or timed out — start it with: cd agent && uvicorn main:app --port 8000 --reload',
    })
  })
})
