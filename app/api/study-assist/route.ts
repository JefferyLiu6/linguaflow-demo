import { NextResponse } from 'next/server'
import { applyRequestActorResponseHeaders, enforceAiRateLimit } from '@/lib/aiRateLimit'

const AGENT_URL = process.env.AGENT_URL ?? 'http://localhost:8000'

export async function POST(req: Request) {
  const actor = await enforceAiRateLimit(req, 'study-assist')
  if (actor instanceof Response) {
    return actor
  }

  const respond = (response: Response) =>
    applyRequestActorResponseHeaders(response, actor)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return respond(NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }))
  }

  const action = body.action as string | undefined
  if (!action) {
    return respond(NextResponse.json({ error: 'action is required' }, { status: 400 }))
  }

  const currentItem = (body.currentItem ?? {}) as Record<string, unknown>

  // Generate a stable response ID for feedback linkage
  const requestId = crypto.randomUUID()

  // camelCase (frontend) → snake_case (Python agent)
  const payload = {
    model: body.model ?? 'openai/gpt-4o-mini',
    request_id: requestId,
    language: body.language ?? 'English',
    action,
    question: (body.question as string | undefined) ?? null,
    current_item: {
      id:          currentItem.id          ?? '',
      type:        currentItem.type        ?? 'translation',
      category:    currentItem.category    ?? null,
      topic:       currentItem.topic       ?? null,
      instruction: currentItem.instruction ?? '',
      prompt:      currentItem.prompt      ?? '',
      answer:      currentItem.answer      ?? '',
      variants:    currentItem.variants    ?? [],
      prompt_lang: currentItem.promptLang  ?? null,
    },
  }

  try {
    const agentRes = await fetch(`${AGENT_URL}/study-assist`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
      signal:  AbortSignal.timeout(30_000),
    })

    const data = await agentRes.json()

    if (!agentRes.ok) {
      return respond(
        NextResponse.json(
          { error: data.detail ?? 'Agent error' },
          { status: agentRes.status },
        ),
      )
    }

    // snake_case (Python) → camelCase (frontend)
    return respond(
      NextResponse.json({
        assistantMessage:  data.assistant_message,
        retrievalHit:      data.retrieval_hit,
        responseId:        data.response_id ?? null,
        retrievedSources:  Array.isArray(data.retrieved_sources)
          ? data.retrieved_sources.map((s: Record<string, unknown>) => ({
              id:    s.id    ?? '',
              title: s.title ?? '',
            }))
          : [],
        similarExamples: Array.isArray(data.similar_examples)
          ? data.similar_examples.map((ex: Record<string, unknown>) => ({
              text:         ex.text          ?? '',
              sourceItemId: ex.source_item_id ?? '',
            }))
          : null,
        model:     data.model,
        elapsedMs: data.elapsed_ms,
      }),
    )
  } catch (err) {
    const msg    = err instanceof Error ? err.message : String(err)
    const isDown = msg.includes('ECONNREFUSED') || msg.includes('fetch failed')
                || msg.includes('timeout')       || msg.includes('TimeoutError')
    return respond(
      NextResponse.json(
        {
          error: isDown
            ? 'Python agent is not running or timed out — start it with: cd agent && uvicorn main:app --port 8000 --reload'
            : `Study assist error: ${msg}`,
        },
        { status: 502 },
      ),
    )
  }
}
