import { NextResponse } from 'next/server'
import { applyRequestActorResponseHeaders, enforceAiRateLimit } from '@/lib/aiRateLimit'
import { getAuthenticatedUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { drillSessionToRecord } from '@/lib/userData'
import { sanitizeSessionRecords } from '@/lib/sessionData'
import type { SessionRecord, DrillResult, Language } from '@/lib/drills'

const AGENT_URL = process.env.AGENT_URL ?? 'http://localhost:8000'

// Mirror of agent/planner/config.py: MAX_SESSIONS=5, MAX_RESULTS=75
const MAX_SESSIONS = 5
const MAX_RESULTS = 75

interface PlanSessionRequestBody {
  language?: Language
  model?: string
  sessions?: unknown                // guest mode supplies them (validated below); authenticated mode ignores them
}

function isLanguage(value: unknown): value is Language {
  return value === 'en' || value === 'es' || value === 'fr' || value === 'de' ||
    value === 'zh' || value === 'ja' || value === 'ko'
}

function toAgentSession(s: SessionRecord) {
  return {
    id:         s.id,
    date:       s.date,
    drill_type: s.drillType,
    accuracy:   s.accuracy,
    avg_time:   s.avgTime,
    results:    s.results.map(toAgentResult),
  }
}

function toAgentResult(r: DrillResult) {
  return {
    item_id:         r.item.id,
    category:        r.item.category ?? null,
    topic:           r.item.topic ?? null,
    type:            r.item.type,
    instruction:     r.item.instruction,
    prompt:          r.item.prompt,
    expected_answer: r.item.answer,
    user_answer:     r.userAnswer,
    correct:         r.correct,
    timed_out:       r.timedOut,
    skipped:         Boolean(r.skipped),
    time_used:       r.timeUsed,
  }
}

function trimToWindow(sessions: SessionRecord[]): SessionRecord[] {
  const sorted = [...sessions].sort((a, b) => b.date - a.date).slice(0, MAX_SESSIONS)
  let used = 0
  const trimmed: SessionRecord[] = []
  for (const s of sorted) {
    if (used >= MAX_RESULTS) break
    const remaining = MAX_RESULTS - used
    const results = s.results.slice(0, remaining)
    used += results.length
    trimmed.push({ ...s, results })
  }
  return trimmed
}

export async function POST(req: Request) {
  const actor = await enforceAiRateLimit(req, 'planner')
  if (actor instanceof Response) {
    return actor
  }

  const respond = (response: Response) =>
    applyRequestActorResponseHeaders(response, actor)

  let body: PlanSessionRequestBody
  try {
    body = await req.json()
  } catch {
    return respond(NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }))
  }

  const language = body.language ?? 'en'
  if (!isLanguage(language)) {
    return respond(NextResponse.json({ error: 'Invalid language' }, { status: 400 }))
  }
  if (language !== 'en') {
    return respond(NextResponse.json({ error: 'Planner v1 supports English only.' }, { status: 400 }))
  }

  // Source the history: authenticated → Prisma; guest → request body
  let englishSessions: SessionRecord[] = []

  const user = await getAuthenticatedUser()
  if (user) {
    const rows = await prisma.drillSession.findMany({
      where: { userId: user.userId, language: 'en' },
      orderBy: { date: 'desc' },
      take: MAX_SESSIONS,
    })
    englishSessions = rows.map(drillSessionToRecord)
  } else {
    if (body.sessions !== undefined && !Array.isArray(body.sessions)) {
      return respond(NextResponse.json({ error: 'sessions must be an array' }, { status: 400 }))
    }
    // sanitizeSessionRecords drops anything malformed and returns only well-formed records.
    const sanitized = sanitizeSessionRecords(body.sessions ?? [])
    englishSessions = sanitized.filter(s => s.language === 'en')
  }

  englishSessions = trimToWindow(englishSessions)

  if (englishSessions.length < 2) {
    return respond(
      NextResponse.json(
        { error: 'At least 2 English sessions are required to plan.' },
        { status: 400 },
      ),
    )
  }

  const bypassCache = req.headers.get('x-bypass-cache') === '1'

  const payload = {
    model:    body.model ?? '',
    language: 'en',
    sessions: englishSessions.map(toAgentSession),
    bypass_cache: bypassCache,
  }

  try {
    const agentRes = await fetch(`${AGENT_URL}/plan-session`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
      signal:  AbortSignal.timeout(60_000),
    })

    const data = await agentRes.json() as Record<string, unknown>

    if (!agentRes.ok) {
      return respond(
        NextResponse.json(
          { error: data.detail ?? data.error ?? 'Planner agent error' },
          { status: agentRes.status },
        ),
      )
    }

    // The agent already returns the full PlanResponse in snake_case-friendly JSON.
    // Re-key snake_case → camelCase at the boundary so the frontend gets idiomatic JSON.
    return respond(NextResponse.json(snakeToCamelPlan(data)))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const isDown =
      msg.includes('ECONNREFUSED') ||
      msg.includes('fetch failed') ||
      msg.toLowerCase().includes('timeout')
    return respond(
      NextResponse.json(
        {
          error: isDown
            ? 'Python agent is not running — start it with: cd agent && uvicorn main:app --port 8000 --reload'
            : `Planner error: ${msg}`,
        },
        { status: 502 },
      ),
    )
  }
}

// snake_case → camelCase mapping for the PlanResponse shape.
function snakeToCamelPlan(d: Record<string, unknown>): Record<string, unknown> {
  const nsp = (d.next_session_plan ?? {}) as Record<string, unknown>
  return {
    weakPoints: ((d.weak_points ?? []) as Record<string, unknown>[]).map(wp => ({
      label:    wp.label,
      severity: wp.severity,
      evidence: wp.evidence,
    })),
    recommendedDrillTypes: d.recommended_drill_types ?? [],
    recommendedTopics:     d.recommended_topics ?? [],
    nextSessionPlan: {
      language:  nsp.language,
      drillType: nsp.drill_type,
      topic:     nsp.topic,
      count:     nsp.count,
    },
    studyCardsToReview: ((d.study_cards_to_review ?? []) as Record<string, unknown>[]).map(c => ({
      itemId: c.item_id,
      prompt: c.prompt,
      reason: c.reason,
    })),
    selfConfidence: d.self_confidence ?? 0,
    confidence:     d.confidence ?? 0,
    rationale:      d.rationale ?? '',
    source:         d.source ?? 'model',
    fallbackReason: d.fallback_reason ?? null,
    model:          d.model ?? '',
    elapsedMs:      d.elapsed_ms ?? 0,
  }
}
