import { afterEach, describe, expect, it, vi } from 'vitest'

import { POST } from './route'

function requestId() {
  return Math.random().toString(36).slice(2)
}

function buildRequest(body: BodyInit, init?: { ip?: string; cookie?: string }) {
  const headers = new Headers({ 'Content-Type': 'application/json' })
  if (init?.ip) headers.set('x-forwarded-for', init.ip)
  if (init?.cookie) headers.set('cookie', init.cookie)

  return new Request('http://localhost/api/tutor/stream', {
    method: 'POST',
    headers,
    body,
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('/api/tutor/stream', () => {
  it('persists the guest cookie on invalid JSON responses', async () => {
    const res = await POST(buildRequest('{"currentItem":', { ip: `10.0.7.${requestId()}` }))

    expect(res.status).toBe(400)
    expect(res.headers.get('Set-Cookie')).toContain('linguaflow_demo_sid=')
    await expect(res.text()).resolves.toBe('Invalid JSON')
  })

  it('persists the guest cookie on validation failures', async () => {
    const res = await POST(
      buildRequest(JSON.stringify({ messages: [{ role: 'user', content: 'help' }] }), {
        ip: `10.0.8.${requestId()}`,
      }),
    )

    expect(res.status).toBe(400)
    expect(res.headers.get('Set-Cookie')).toContain('linguaflow_demo_sid=')
    await expect(res.text()).resolves.toBe('currentItem is required')
  })

  it('maps tutor stream requests to the agent and preserves streamed metadata', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        'data: {"token":"Focus on the tone shift."}\n\n'
        + 'data: {"done":true,"route":"explain","hint_level":1,"retrieval_hit":true,"retrieved_sources":[{"id":"note_1","title":"Formal register"}]}\n\n',
        {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        },
      ),
    )

    const req = buildRequest(
      JSON.stringify({
        mode: 'tutor',
        model: 'openai/gpt-4o-mini',
        sessionContext: {
          language: 'English',
          drillType: 'translation',
          itemIndex: 2,
          itemsTotal: 10,
        },
        currentItem: {
          id: 'en16',
          category: 'sentence',
          topic: 'work',
          instruction: 'Express this casually-worded idea in formal English.',
          prompt: "He's really good at his job.",
          type: 'translation',
          expectedAnswer: 'He demonstrates exceptional professional competence.',
          userAnswer: "He's excellent at work.",
          feedback: 'incorrect',
        },
        messages: [{ role: 'user', content: 'Why is this too casual?' }],
        constraints: {
          maxCoachTurns: 10,
          maxHintLevel: 3,
          currentHintLevel: 0,
        },
      }),
      { ip: `10.0.9.${requestId()}` },
    )

    const res = await POST(req)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('http://localhost:8000/tutor/stream')
    const payload = JSON.parse(String(init?.body))
    expect(payload.request_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(payload).toMatchObject({
      mode: 'tutor',
      model: 'openai/gpt-4o-mini',
      session_context: {
        language: 'English',
        drill_type: 'translation',
        item_index: 2,
        items_total: 10,
      },
      current_item: {
        id: 'en16',
        category: 'sentence',
        topic: 'work',
        instruction: 'Express this casually-worded idea in formal English.',
        prompt: "He's really good at his job.",
        type: 'translation',
        expected_answer: 'He demonstrates exceptional professional competence.',
        user_answer: "He's excellent at work.",
        feedback: 'incorrect',
      },
      recent_items: [],
      messages: [{ role: 'user', content: 'Why is this too casual?' }],
      constraints: {
        max_coach_turns: 10,
        max_hint_level: 3,
        current_hint_level: 0,
      },
    })
    // end payload check

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/event-stream')
    await expect(res.text()).resolves.toContain('"retrieval_hit":true')
    expect(res.headers.get('Set-Cookie')).toContain('linguaflow_demo_sid=')
  })
})
