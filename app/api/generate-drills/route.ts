import { NextResponse } from 'next/server'
import { applyRequestActorResponseHeaders, enforceAiRateLimit } from '@/lib/aiRateLimit'

const AGENT_URL = process.env.AGENT_URL ?? 'http://localhost:8000'

export async function POST(req: Request) {
  const actor = await enforceAiRateLimit(req, 'generate')
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

  // Remap camelCase from the frontend to the snake_case the Python agent expects
  const payload = {
    mode:       body.mode,
    language:   body.language   ?? 'Spanish',
    count:      body.count      ?? 10,
    model:      body.model      ?? 'openai/gpt-4o-mini',
    raw_prompt: body.rawPrompt  ?? '',
    guided: {
      topic:      body.topic      ?? 'daily',
      difficulty: body.difficulty ?? 'b1',
      grammar:    body.grammar    ?? 'mixed',
      drill_type: body.drillType  ?? 'translation',
    },
  }

  try {
    const agentRes = await fetch(`${AGENT_URL}/generate`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
      // Ollama can be slow — give the agent up to 120s
      signal:  AbortSignal.timeout(120_000),
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

    // Remap snake_case back to camelCase for the frontend
    const drills = (data.drills as {
      id: string; type: string; instruction: string;
      prompt: string; answer: string; prompt_lang: string
    }[]).map(d => ({
      id:          d.id,
      type:        d.type,
      instruction: d.instruction,
      prompt:      d.prompt,
      answer:      d.answer,
      promptLang:  d.prompt_lang,
    }))

    return respond(
      NextResponse.json({ drills, model: data.model, elapsedMs: data.elapsed_ms }),
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const isDown = msg.includes('ECONNREFUSED') || msg.includes('fetch failed') || msg.includes('timeout')
    return respond(
      NextResponse.json(
        {
          error: isDown
            ? 'Python agent is not running — start it with: cd agent && uvicorn main:app --port 8000 --reload'
            : msg,
        },
        { status: 502 },
      ),
    )
  }
}
