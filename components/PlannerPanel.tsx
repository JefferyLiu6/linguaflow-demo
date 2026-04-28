'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import type { SessionRecord } from '@/lib/drills'
import { TAXONOMY_DISPLAY, type TaxonomyLabel } from '@/lib/englishTaxonomy'

interface WeakPoint   { label: string;  severity: number; evidence: string[] }
interface NextPlan    { language: string; drillType: string; topic: string; count: number }
interface StudyCard   { itemId: string; prompt: string; reason: string }
type    FallbackReason = 'low_confidence' | 'validator_rejected' | 'model_error' | 'model_invalid_json' | null
interface PlannerResponse {
  weakPoints: WeakPoint[]
  recommendedDrillTypes: string[]
  recommendedTopics: string[]
  nextSessionPlan: NextPlan
  studyCardsToReview: StudyCard[]
  selfConfidence: number
  confidence: number
  rationale: string
  source: 'model' | 'heuristic_fallback'
  fallbackReason: FallbackReason
  model: string
  elapsedMs: number
}

interface Props {
  sessions: SessionRecord[]   // already filtered to English by the dashboard
}

const CACHE_TTL_MS = 10 * 60 * 1000
const cacheStore = new Map<string, { ts: number; plan: PlannerResponse }>()

function cacheKeyFor(sessions: SessionRecord[]): string {
  return sessions.map(s => s.id).sort().join('|')
}

function labelDisplay(label: string): string {
  return TAXONOMY_DISPLAY[label as TaxonomyLabel] ?? label
}

function fallbackText(reason: FallbackReason): string {
  switch (reason) {
    case 'low_confidence':     return 'low confidence'
    case 'validator_rejected': return 'failed safety validation'
    case 'model_error':        return 'an upstream model error'
    case 'model_invalid_json': return 'invalid model output'
    default:                   return 'an unknown reason'
  }
}

export default function PlannerPanel({ sessions }: Props) {
  const [plan, setPlan] = useState<PlannerResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const fetchSeq = useRef(0)

  const cacheKey = useMemo(() => cacheKeyFor(sessions), [sessions])

  const fetchPlan = useMemo(() => async (bypass: boolean) => {
    if (!bypass) {
      const cached = cacheStore.get(cacheKey)
      if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
        setPlan(cached.plan)
        setLoading(false)
        setError(null)
        return
      }
    }

    const seq = ++fetchSeq.current
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/plan-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(bypass ? { 'X-Bypass-Cache': '1' } : {}),
        },
        body: JSON.stringify({ language: 'en', sessions }),
      })
      const data = await res.json()
      if (seq !== fetchSeq.current) return
      if (!res.ok) {
        setError(data.error ?? 'Planner request failed.')
        setPlan(null)
        return
      }
      const planData = data as PlannerResponse
      cacheStore.set(cacheKey, { ts: Date.now(), plan: planData })
      setPlan(planData)
    } catch (err) {
      if (seq !== fetchSeq.current) return
      setError(err instanceof Error ? err.message : 'Network error.')
      setPlan(null)
    } finally {
      if (seq === fetchSeq.current) setLoading(false)
    }
  }, [cacheKey, sessions])

  useEffect(() => {
    void fetchPlan(false)
  }, [fetchPlan])

  // ── Styling tokens (Grove design system) ─────────────────────────────────
  const card: React.CSSProperties = {
    background: 'white',
    border: '1px solid #E2DDD8',
    borderRadius: 14,
    boxShadow: '0 1px 4px rgba(0,0,0,.06)',
    padding: 24,
    marginBottom: 32,
  }
  const eyebrow: React.CSSProperties = {
    fontFamily: 'var(--font-manrope), sans-serif',
    fontWeight: 700, fontSize: 11,
    letterSpacing: '1.2px', textTransform: 'uppercase', color: '#8CA090',
  }
  const headlineSerif: React.CSSProperties = {
    fontFamily: 'var(--font-fraunces), serif',
    fontWeight: 700,
    fontSize: 'clamp(1.5rem, 2.5vw, 1.875rem)',
    lineHeight: 1.15,
    color: '#0B1E12',
    margin: 0,
  }
  const refreshBtn: React.CSSProperties = {
    fontFamily: 'var(--font-jetbrains), monospace',
    fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase',
    color: '#4A5A50', background: 'transparent', border: 'none',
    cursor: 'pointer', padding: 0,
  }
  const pillOutline: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center',
    fontFamily: 'var(--font-manrope), sans-serif',
    fontSize: 12, fontWeight: 500, color: '#4A5A50',
    background: 'white', border: '1px solid #E2DDD8',
    padding: '4px 12px', borderRadius: 20,
  }

  // ── Loading skeleton ─────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={card} aria-busy="true">
        <div style={{ ...eyebrow, marginBottom: 12 }}>Adaptive Plan</div>
        <div style={{ height: 28, background: '#F0EDE8', borderRadius: 6, marginBottom: 16, width: '70%' }} />
        <div style={{ height: 14, background: '#F0EDE8', borderRadius: 6, marginBottom: 8, width: '90%' }} />
        <div style={{ height: 14, background: '#F0EDE8', borderRadius: 6, marginBottom: 24, width: '60%' }} />
        <div style={{ height: 36, background: '#F0EDE8', borderRadius: 8, width: 180 }} />
      </div>
    )
  }

  // ── Error state ──────────────────────────────────────────────────────────
  if (error || !plan) {
    return (
      <div style={card}>
        <div style={{ ...eyebrow, marginBottom: 12 }}>Adaptive Plan</div>
        <p style={{ fontFamily: 'var(--font-manrope), sans-serif', fontSize: 13, color: '#BF6B6B', marginBottom: 12 }}>
          {error ?? 'Planner is unavailable right now.'}
        </p>
        <button onClick={() => void fetchPlan(true)} style={refreshBtn}>↻ Retry</button>
      </div>
    )
  }

  const isFallback = plan.source === 'heuristic_fallback'
  const topWeak = plan.weakPoints[0]?.label
  const drillType = plan.nextSessionPlan.drillType
  const topic = plan.nextSessionPlan.topic
  const count = plan.nextSessionPlan.count
  const drillHref =
    `/drill?language=en&type=${encodeURIComponent(drillType)}&topic=${encodeURIComponent(topic)}` +
    `&count=${count}&source=planner`

  const secondaryDrillTypes = plan.recommendedDrillTypes.slice(1, 3)
  const secondaryTopics = plan.recommendedTopics.slice(1, 3)

  return (
    <div style={card}>

      {/* Eyebrow row + refresh */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={eyebrow}>Adaptive Plan</span>
          {isFallback && (
            <span
              style={{
                fontFamily: 'var(--font-jetbrains), monospace',
                fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase',
                color: 'white', background: '#BF6B6B',
                padding: '2px 8px', borderRadius: 4,
              }}
            >
              Fallback plan
            </span>
          )}
        </div>
        <button onClick={() => void fetchPlan(true)} style={refreshBtn}>↻ Refresh</button>
      </div>

      {/* Headline */}
      <h2 style={{ ...headlineSerif, marginBottom: 12 }}>
        Recommended <em style={{ fontStyle: 'italic', color: '#1F5C3A' }}>next session.</em>
      </h2>

      {/* Plan summary line */}
      <p style={{
        fontFamily: 'var(--font-manrope), sans-serif',
        fontSize: 15, color: '#0B1E12', lineHeight: 1.55, marginBottom: 4,
      }}>
        {count}{' '}
        <em style={{ fontStyle: 'italic' }}>{drillType}</em>
        {' drills on '}
        <em style={{ fontStyle: 'italic' }}>{topic}</em>
        {topWeak && (
          <>
            {' — focuses on '}
            <span style={{
              background: 'linear-gradient(180deg, transparent 58%, #B8E0C2 58%, #B8E0C2 92%, transparent 92%)',
              padding: '0 2px',
              fontWeight: 600,
            }}>
              {labelDisplay(topWeak)}
            </span>
            .
          </>
        )}
      </p>

      {/* Rationale */}
      {plan.rationale && (
        <p style={{
          fontFamily: 'var(--font-manrope), sans-serif',
          fontSize: 13, color: '#4A5A50', lineHeight: 1.55, marginBottom: 16,
        }}>
          {plan.rationale}
        </p>
      )}

      {/* Fallback note */}
      {isFallback && (
        <p style={{
          fontFamily: 'var(--font-manrope), sans-serif',
          fontSize: 12, color: '#8CA090', marginBottom: 16, fontStyle: 'italic',
        }}>
          Shown because the AI plan had {fallbackText(plan.fallbackReason)}.
        </p>
      )}

      {/* Secondary chips */}
      {(secondaryDrillTypes.length > 0 || secondaryTopics.length > 0) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          {secondaryDrillTypes.map(dt => (
            <span key={`dt-${dt}`} style={pillOutline}>
              <span style={{ marginRight: 6, fontFamily: 'var(--font-jetbrains), monospace', fontSize: 9, color: '#8CA090' }}>type</span>
              {dt}
            </span>
          ))}
          {secondaryTopics.map(t => (
            <span key={`tp-${t}`} style={pillOutline}>
              <span style={{ marginRight: 6, fontFamily: 'var(--font-jetbrains), monospace', fontSize: 9, color: '#8CA090' }}>topic</span>
              {t}
            </span>
          ))}
        </div>
      )}

      {/* Study cards (collapsible) */}
      {plan.studyCardsToReview.length > 0 && (
        <details style={{ marginBottom: 20 }}>
          <summary style={{
            cursor: 'pointer',
            fontFamily: 'var(--font-manrope), sans-serif',
            fontSize: 12, fontWeight: 600, color: '#4A5A50',
            letterSpacing: '0.04em', textTransform: 'uppercase',
            marginBottom: 8, listStyle: 'none',
          }}>
            Cards to review · {plan.studyCardsToReview.length}
          </summary>
          <div style={{
            marginTop: 10,
            border: '1px solid #E2DDD8', borderRadius: 8,
            background: '#FAF7F0',
            maxHeight: 220, overflowY: 'auto',
          }}>
            {plan.studyCardsToReview.map((c, i) => (
              <div key={c.itemId} style={{
                display: 'grid', gridTemplateColumns: '64px 1fr',
                padding: '10px 14px',
                borderBottom: i < plan.studyCardsToReview.length - 1 ? '1px solid #EAE6E0' : 'none',
                gap: 10,
                alignItems: 'baseline',
              }}>
                <span style={{
                  fontFamily: 'var(--font-jetbrains), monospace',
                  fontSize: 10, color: '#8CA090', letterSpacing: '0.04em',
                }}>{c.itemId}</span>
                <div>
                  <div style={{
                    fontFamily: 'var(--font-manrope), sans-serif',
                    fontSize: 13, color: '#0B1E12', marginBottom: 2,
                  }}>{c.prompt || '(no prompt)'}</div>
                  <div style={{
                    fontFamily: 'var(--font-jetbrains), monospace',
                    fontSize: 10, color: '#8CA090', letterSpacing: '0.04em',
                  }}>{c.reason}</div>
                </div>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* CTA */}
      <Link
        href={drillHref}
        data-testid="planner-begin-session"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          background: '#1F5C3A', color: 'white',
          fontFamily: 'var(--font-manrope), sans-serif',
          fontSize: 14, fontWeight: 600,
          padding: '11px 22px', borderRadius: 10,
          textDecoration: 'none',
          boxShadow: '0 2px 12px rgba(31,92,58,0.25)',
          letterSpacing: '0.01em',
        }}
      >
        Begin session →
      </Link>

      {/* Footer meta */}
      <div style={{
        marginTop: 14, display: 'flex', gap: 14,
        fontFamily: 'var(--font-jetbrains), monospace',
        fontSize: 10, color: '#8CA090', letterSpacing: '0.04em',
      }}>
        <span>conf {plan.confidence.toFixed(2)}</span>
        <span>·</span>
        <span>{plan.model}</span>
        <span>·</span>
        <span>{plan.elapsedMs} ms</span>
      </div>
    </div>
  )
}
