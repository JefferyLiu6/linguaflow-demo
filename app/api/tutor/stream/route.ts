import { applyRequestActorResponseHeaders, enforceAiRateLimit } from '@/lib/aiRateLimit'

const AGENT_URL = process.env.AGENT_URL ?? 'http://localhost:8000'

export async function POST(req: Request) {
  const actor = await enforceAiRateLimit(req, 'tutor')
  if (actor instanceof Response) {
    return actor
  }

  const respond = (response: Response) =>
    applyRequestActorResponseHeaders(response, actor)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return respond(new Response('Invalid JSON', { status: 400 }))
  }

  const currentItem    = body.currentItem    as Record<string, unknown> | undefined
  const sessionContext = (body.sessionContext as Record<string, unknown>) ?? {}
  const constraints    = (body.constraints   as Record<string, unknown>) ?? {}
  const messages       = (body.messages      as { role: string; content: string }[]) ?? []

  if (!currentItem) {
    return respond(new Response('currentItem is required', { status: 400 }))
  }

  // Generate a stable response ID that Python will echo in the SSE done event
  const requestId = crypto.randomUUID()

  const payload = {
    mode:  body.mode ?? 'tutor',
    model: body.model ?? 'openai/gpt-4o-mini',
    request_id: requestId,
    session_context: {
      language:    sessionContext.language   ?? 'Spanish',
      drill_type:  sessionContext.drillType  ?? 'translation',
      item_index:  sessionContext.itemIndex  ?? 0,
      items_total: sessionContext.itemsTotal ?? 1,
    },
    current_item: {
      id:              currentItem.id              ?? '',
      category:        currentItem.category        ?? null,
      topic:           currentItem.topic           ?? null,
      instruction:     currentItem.instruction     ?? '',
      prompt:          currentItem.prompt          ?? '',
      type:            currentItem.type            ?? 'translation',
      expected_answer: currentItem.expectedAnswer  ?? '',
      user_answer:     currentItem.userAnswer      ?? '',
      feedback:        currentItem.feedback        ?? 'incorrect',
    },
    recent_items: ((body.recentItems as Record<string, unknown>[]) ?? []).map(r => ({
      prompt:      r.prompt      ?? '',
      user_answer: r.userAnswer  ?? '',
      correct:     r.correct     ?? false,
      timed_out:   r.timedOut    ?? false,
    })),
    messages: messages.map(m => ({ role: m.role, content: m.content })),
    constraints: {
      max_coach_turns:    constraints.maxCoachTurns    ?? 10,
      max_hint_level:     constraints.maxHintLevel     ?? 3,
      current_hint_level: constraints.currentHintLevel ?? 0,
    },
  }

  try {
    const agentRes = await fetch(`${AGENT_URL}/tutor/stream`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
      signal:  AbortSignal.timeout(60_000),
    })

    if (!agentRes.ok || !agentRes.body) {
      return respond(new Response(`Agent error: ${agentRes.status}`, { status: agentRes.status }))
    }

    return respond(
      new Response(agentRes.body, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      }),
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return respond(
      new Response(
        `data: ${JSON.stringify({ error: `Agent unavailable: ${msg}` })}\n\n`,
        { status: 502, headers: { 'Content-Type': 'text/event-stream' } },
      ),
    )
  }
}
