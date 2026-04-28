'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { computeStats, ignoreClientAuthExpiredError, loadSessions } from '@/lib/stats'
import type { DrillResult, SessionRecord, Language } from '@/lib/drills'
import { LANGUAGES } from '@/lib/drills'
import PlannerPanel from '@/components/PlannerPanel'

// ── Color tokens ──────────────────────────────────────────────────

const TYPE_COLOR: Record<string, string> = {
  sentence:       '#2A9960',
  vocab:          '#3B82F6',
  phrase:         '#7B5BBF',
  substitution:   '#9B7B3B',
  transformation: '#BF6B6B',
  translation:    '#2A9960',
  mixed:          '#8CA090',
  custom:         '#8CA090',
}

const TYPE_ORDER = ['sentence', 'vocab', 'phrase', 'substitution', 'transformation']

function gradeColor(pct: number): string {
  return pct >= 80 ? '#1F5C3A' : pct >= 60 ? '#9B7B3B' : '#BF6B6B'
}

function heatColor(count: number): string {
  if (count === 0)  return '#EFEBE0'
  if (count <= 5)   return '#CFE3D2'
  if (count <= 15)  return '#9FCDA7'
  if (count <= 30)  return '#5FA46E'
  return '#2D6A4F'
}

function fmtDuration(totalSec: number): string {
  const m = Math.floor(totalSec / 60)
  const s = Math.round(totalSec % 60)
  return `${m}m ${String(s).padStart(2, '0')}s`
}

function deriveLede(
  sessions: SessionRecord[],
  typeStats: Record<string, { correct: number; total: number }>,
  usedLangs: Language[],
): string {
  const n = sessions.length
  const lc = usedLangs.length
  const base = `${n} session${n !== 1 ? 's' : ''} across ${lc} language${lc !== 1 ? 's' : ''}.`
  const entries = Object.entries(typeStats).filter(([, v]) => v.total >= 3)
  if (entries.length < 2) return base
  entries.sort((a, b) => b[1].correct / b[1].total - a[1].correct / a[1].total)
  const top = entries[0][0]
  const bot = entries[entries.length - 1][0]
  if (top === bot) return base
  return `${base} ${top.charAt(0).toUpperCase() + top.slice(1)} drills lead the pack; ${bot}s need work.`
}

// ── Scatter plot SVG ──────────────────────────────────────────────

function ScatterPlot({ results }: { results: DrillResult[] }) {
  const W = 500, H = 240
  const PAD = { l: 36, r: 78, t: 18, b: 32 }
  const pw = W - PAD.l - PAD.r
  const ph = H - PAD.t - PAD.b

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      {/* Y gridlines + labels */}
      {[100, 75, 50, 25, 0].map(pct => {
        const y = PAD.t + (1 - pct / 100) * ph
        return (
          <g key={pct}>
            <line
              x1={PAD.l} y1={y} x2={PAD.l + pw} y2={y}
              stroke="#E2DDD8" strokeWidth={pct === 0 ? 1 : 0.5}
              strokeDasharray={pct === 0 ? undefined : '4 3'}
            />
            <text x={PAD.l - 5} y={y + 3} textAnchor="end"
              style={{ fontFamily: 'var(--font-jetbrains)', fontSize: 9, fill: '#8CA090' }}>
              {pct}%
            </text>
          </g>
        )
      })}

      {/* X axis labels */}
      {[0, 1, 2, 3, 4, 5].map(s => (
        <text key={s}
          x={PAD.l + (s / 5) * pw} y={H - PAD.b + 14}
          textAnchor="middle"
          style={{ fontFamily: 'var(--font-jetbrains)', fontSize: 9, fill: '#8CA090' }}>
          {s}s
        </text>
      ))}

      {/* Quadrant labels */}
      <text x={PAD.l + pw + 4} y={PAD.t + 14} textAnchor="start"
        style={{ fontFamily: 'var(--font-jetbrains)', fontSize: 9, fill: '#2A9960', letterSpacing: '0.05em' }}>
        CORRECT
      </text>
      <text x={PAD.l + pw + 4} y={PAD.t + ph - 6} textAnchor="start"
        style={{ fontFamily: 'var(--font-jetbrains)', fontSize: 9, fill: '#BF6B6B', letterSpacing: '0.05em' }}>
        INCORRECT
      </text>

      {/* Data points */}
      {results.map((r, i) => {
        const xFrac = Math.min(r.timeUsed / 5, 1)
        const jitter = ((i * 13 + 7) % 100) / 100
        const xJit   = (((i * 7 + 3) % 11) * 2.5 - 13.5)
        const yBase  = r.correct
          ? 0.03 + jitter * 0.22
          : 0.73 + jitter * 0.20
        const cx = Math.max(PAD.l + 4, Math.min(PAD.l + pw - 4, PAD.l + xFrac * pw + xJit))
        const cy = Math.max(PAD.t + 4, Math.min(PAD.t + ph - 4, PAD.t + yBase * ph))
        const col = r.correct ? '#2A9960' : '#BF6B6B'
        return (
          <circle key={i} cx={cx} cy={cy} r={3.5}
            fill={col} fillOpacity={0.55}
            stroke={col} strokeWidth={0.8} strokeOpacity={0.8}
          />
        )
      })}
    </svg>
  )
}

// ── Heatmap grid ──────────────────────────────────────────────────

function HeatmapGrid({ heatDays, weeks }: { heatDays: Array<{ key: string; count: number }>; weeks: number }) {
  const CELL = 13, GAP = 3

  // Month labels: first occurrence of each month in the grid
  const monthLabels: Array<{ week: number; label: string }> = []
  for (let w = 0; w < weeks; w++) {
    const d = new Date(heatDays[w * 7]?.key ?? '')
    if (!isNaN(d.getTime())) {
      const label = d.toLocaleDateString('en-US', { month: 'short' })
      if (!monthLabels.length || monthLabels[monthLabels.length - 1].label !== label) {
        monthLabels.push({ week: w, label })
      }
    }
  }

  return (
    <div>
      {/* Month labels */}
      <div style={{ display: 'flex', marginBottom: 4, paddingLeft: 28 }}>
        {Array.from({ length: weeks }, (_, w) => {
          const ml = monthLabels.find(m => m.week === w)
          return (
            <div key={w} style={{ width: CELL, marginRight: GAP, flexShrink: 0, fontFamily: 'var(--font-jetbrains), monospace', fontSize: 8, color: '#8CA090', overflow: 'visible' }}>
              {ml ? ml.label : ''}
            </div>
          )
        })}
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
        {/* Weekday labels */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: GAP, width: 22, flexShrink: 0 }}>
          {['', 'Mon', '', 'Wed', '', 'Fri', ''].map((label, i) => (
            <div key={i} style={{ height: CELL, display: 'flex', alignItems: 'center', fontFamily: 'var(--font-jetbrains), monospace', fontSize: 8, color: '#8CA090' }}>
              {label}
            </div>
          ))}
        </div>

        {/* Grid columns */}
        <div style={{ display: 'flex', gap: GAP }}>
          {Array.from({ length: weeks }, (_, w) => (
            <div key={w} style={{ display: 'flex', flexDirection: 'column', gap: GAP }}>
              {Array.from({ length: 7 }, (_, dow) => {
                const cell = heatDays[w * 7 + dow]
                return (
                  <div
                    key={dow}
                    title={cell ? `${cell.key}: ${cell.count} items` : ''}
                    style={{ width: CELL, height: CELL, borderRadius: 2, flexShrink: 0, background: cell ? heatColor(cell.count) : '#EFEBE0' }}
                  />
                )
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 14, justifyContent: 'flex-end' }}>
        <span style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 9, color: '#8CA090' }}>Less</span>
        {[0, 5, 15, 30, 50].map(v => (
          <div key={v} style={{ width: CELL, height: CELL, borderRadius: 2, background: heatColor(v) }} />
        ))}
        <span style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 9, color: '#8CA090' }}>More</span>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────

const WEEKS = 17

export default function DashboardClient() {
  const [sessions, setSessions] = useState<SessionRecord[]>([])
  const [loaded,   setLoaded]   = useState(false)
  const [filterLang, setFilterLang] = useState<Language | 'all'>('all')

  useEffect(() => {
    loadSessions()
      .then(data => { setSessions(data); setLoaded(true) })
      .catch(ignoreClientAuthExpiredError)
  }, [])

  if (!loaded) return null

  // ── Empty state ──────────────────────────────────────────────────
  if (sessions.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '80px 32px', background: 'var(--bg)' }}>
        <div style={{ maxWidth: 400 }}>
          <div style={{ width: 48, height: 48, borderRadius: 12, background: '#EAF3ED', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 24 }}>
            <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="#1F5C3A" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <h2 style={{ fontFamily: 'var(--font-fraunces), serif', fontWeight: 700, fontSize: '1.75rem', color: '#0B1E12', marginBottom: 10, lineHeight: 1.15 }}>
            No data yet.
          </h2>
          <p style={{ fontFamily: 'var(--font-manrope), sans-serif', fontSize: 14, color: '#4A5A50', marginBottom: 32, lineHeight: 1.6 }}>
            Complete at least one session to view performance data.
          </p>
          <Link href="/drill" className="btn-primary">Start Training</Link>
        </div>
      </div>
    )
  }

  // ── Data derivations ─────────────────────────────────────────────
  const usedLangs      = Array.from(new Set(sessions.map(s => s.language).filter(Boolean))) as Language[]
  const filtered       = filterLang === 'all' ? sessions : sessions.filter(s => s.language === filterLang)
  const englishSessions = sessions.filter(s => s.language === 'en')
  const stats      = computeStats(filtered)
  const byDate     = [...filtered].sort((a, b) => b.date - a.date)
  const allResults = byDate.flatMap(s => s.results)

  // Rolling accuracy
  const roll50  = allResults.slice(0, 50)
  const prev50  = allResults.slice(50, 100)
  const rollAcc = roll50.length > 0 ? Math.round(roll50.filter(r => r.correct).length / roll50.length * 100) : 0
  const prevAcc = prev50.length > 0 ? Math.round(prev50.filter(r => r.correct).length / prev50.length * 100) : 0
  const accDelta = prev50.length > 0 ? rollAcc - prevAcc : 0

  // Avg response
  const last5    = byDate.slice(0, 5)
  const prev5    = byDate.slice(5, 10)
  const last5Avg = last5.length > 0 ? Math.round(last5.reduce((a, s) => a + s.avgTime, 0) / last5.length * 10) / 10 : (stats?.avgTime ?? 0)
  const prev5Avg = prev5.length > 0 ? Math.round(prev5.reduce((a, s) => a + s.avgTime, 0) / prev5.length * 10) / 10 : 0
  const timeDelta = prev5.length > 0 ? Math.round((last5Avg - prev5Avg) * 10) / 10 : 0

  // Retention
  const itemLog: Record<string, boolean[]> = {}
  byDate.forEach(s => s.results.forEach(r => {
    if (!itemLog[r.item.id]) itemLog[r.item.id] = []
    itemLog[r.item.id].push(r.correct)
  }))
  const reHits  = Object.values(itemLog).filter(a => a.length >= 2).flatMap(a => a.slice(1))
  const retRate = reHits.length > 0 ? Math.round(reHits.filter(Boolean).length / reHits.length * 100) : null

  // Streak
  const todayMs = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() })()
  const daySet  = new Set(filtered.map(s => { const d = new Date(s.date); d.setHours(0, 0, 0, 0); return d.getTime() }))
  let streakCount = 0
  let cursor = daySet.has(todayMs) ? todayMs : todayMs - 86_400_000
  while (daySet.has(cursor)) { streakCount++; cursor -= 86_400_000 }
  const trainedToday = daySet.has(todayMs)

  // Heatmap
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const dayBuckets: Record<string, number> = {}
  filtered.forEach(s => {
    const d = new Date(s.date); d.setHours(0, 0, 0, 0)
    const k = d.toISOString().slice(0, 10)
    dayBuckets[k] = (dayBuckets[k] ?? 0) + s.total
  })
  const heatDays = Array.from({ length: WEEKS * 7 }, (_, i) => {
    const d = new Date(today); d.setDate(today.getDate() - (WEEKS * 7 - 1 - i))
    const k = d.toISOString().slice(0, 10)
    return { key: k, count: dayBuckets[k] ?? 0 }
  })

  // Accuracy by type (grouped by category first, then type)
  const typeStats: Record<string, { correct: number; total: number }> = {}
  filtered.forEach(s => s.results.forEach(r => {
    const key = r.item.category ?? r.item.type
    if (!typeStats[key]) typeStats[key] = { correct: 0, total: 0 }
    typeStats[key].total++
    if (r.correct) typeStats[key].correct++
  }))

  // Error ledger
  const errorLedger = byDate.flatMap(s =>
    s.results
      .filter(r => !r.correct && !r.skipped)
      .map(r => ({ ...r, sessionDate: s.date }))
  ).slice(0, 12)

  const lede = deriveLede(filtered, typeStats, usedLangs)

  // Shared styles
  const eyebrow: React.CSSProperties = {
    fontFamily: 'var(--font-manrope), sans-serif',
    fontWeight: 700, fontSize: 11,
    letterSpacing: '1.2px', textTransform: 'uppercase', color: '#8CA090',
  }
  const cardSection: React.CSSProperties = {
    fontFamily: 'var(--font-manrope), sans-serif',
    fontWeight: 700, fontSize: 11,
    letterSpacing: '1.2px', textTransform: 'uppercase', color: '#4A5A50',
  }

  return (
    <div style={{ flex: 1, background: 'var(--bg)' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '56px 32px 80px' }}>

        {/* ── 1. Editorial hero ──────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 32, marginBottom: 36 }}>
          <div style={{ flex: 1 }}>
            <div style={{ ...eyebrow, marginBottom: 12 }}>
              Performance Report · {filterLang === 'all' ? 'All Languages' : `EN → ${LANGUAGES[filterLang].name}`}
            </div>
            <h1 style={{
              fontFamily: 'var(--font-fraunces), serif',
              fontWeight: 700,
              fontSize: 'clamp(2.5rem, 4.5vw, 3.5rem)',
              lineHeight: 1.05, letterSpacing: '-0.01em',
              color: '#0B1E12', margin: '0 0 14px',
            }}>
              Training <em style={{ fontStyle: 'italic', color: '#1F5C3A' }}>results.</em>
            </h1>
            <p style={{ fontFamily: 'var(--font-manrope), sans-serif', fontSize: 14, color: '#4A5A50', lineHeight: 1.65, margin: '0 0 16px', maxWidth: 540 }}>
              {lede}
            </p>
            {/* Language filter pills */}
            {usedLangs.length > 1 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button onClick={() => setFilterLang('all')} style={{
                  fontFamily: 'var(--font-manrope), sans-serif', fontSize: 13, fontWeight: filterLang === 'all' ? 600 : 400,
                  padding: '5px 14px', borderRadius: 20, cursor: 'pointer',
                  border: `1.5px solid ${filterLang === 'all' ? '#0B1E12' : '#E2DDD8'}`,
                  background: filterLang === 'all' ? '#0B1E12' : 'white',
                  color: filterLang === 'all' ? 'white' : '#4A5A50',
                }}>All</button>
                {usedLangs.map(lang => (
                  <button key={lang} onClick={() => setFilterLang(lang)} style={{
                    fontFamily: 'var(--font-manrope), sans-serif', fontSize: 13,
                    fontWeight: filterLang === lang ? 600 : 400,
                    padding: '5px 14px', borderRadius: 20, cursor: 'pointer',
                    border: `1.5px solid ${filterLang === lang ? '#0B1E12' : '#E2DDD8'}`,
                    background: filterLang === lang ? '#0B1E12' : 'white',
                    color: filterLang === lang ? 'white' : '#4A5A50',
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                  }}>
                    <span>{LANGUAGES[lang].flag}</span><span>{LANGUAGES[lang].name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div style={{ flexShrink: 0, paddingTop: 10 }}>
            <Link href="/drill" className="btn-primary">+ New session</Link>
          </div>
        </div>

        {!stats && (
          <div style={{ fontFamily: 'var(--font-manrope), sans-serif', fontSize: 14, color: '#8CA090', marginBottom: 40 }}>
            No sessions for {LANGUAGES[filterLang as Language]?.name ?? 'this language'} yet.
          </div>
        )}

        {/* Gated planner empty state — has English sessions but fewer than 2 */}
        {englishSessions.length > 0 && englishSessions.length < 2 && (
          <div style={{
            background: 'white', border: '1px dashed #CEC9C2', borderRadius: 14,
            padding: '20px 24px', marginBottom: 32,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
          }}>
            <div>
              <div style={{ ...eyebrow, marginBottom: 6 }}>Adaptive Plan</div>
              <div style={{ fontFamily: 'var(--font-manrope), sans-serif', fontSize: 14, color: '#4A5A50' }}>
                Adaptive recommendations unlock after 2 English sessions.
              </div>
            </div>
            <Link href="/drill?language=en" className="btn-primary">+ New session</Link>
          </div>
        )}

        {stats && (
          <>
            {/* ── 2. Stat masthead ──────────────────────────────────── */}
            <div style={{
              background: 'white', border: '1px solid #E2DDD8', borderRadius: 14,
              boxShadow: '0 1px 4px rgba(0,0,0,.06)',
              display: 'flex', overflow: 'hidden', marginBottom: 32,
            }}>
              {([
                {
                  label: 'Rolling Accuracy', sub: 'last 50 items',
                  value: rollAcc, unit: '%',
                  trend: prev50.length > 0 ? accDelta : null,
                },
                {
                  label: 'Avg Response', sub: 'last 5 sessions',
                  value: last5Avg, unit: 's',
                  trend: prev5.length > 0 ? -timeDelta : null,
                },
                {
                  label: 'Total Items', sub: `across ${stats.sessions} sessions`,
                  value: stats.total, unit: null, trend: null,
                },
                {
                  label: 'Retention Rate', sub: 're-encountered items',
                  value: retRate !== null ? retRate : '—',
                  unit: retRate !== null ? '%' : null, trend: null,
                },
                {
                  label: 'Day Streak',
                  sub: trainedToday ? 'trained today ✓' : 'train today to extend',
                  value: streakCount, unit: 'd', trend: null,
                  streak: true,
                },
              ] as const).map(({ label, sub, value, unit, trend, ...rest }, i) => {
                const isStreak = 'streak' in rest
                const highlight = isStreak && trainedToday
                return (
                  <div key={label} style={{
                    flex: 1, padding: '24px 28px 20px',
                    borderRight: i < 4 ? '1px solid #E2DDD8' : 'none',
                  }}>
                    <div style={{ ...eyebrow, marginBottom: 4 }}>{label.toUpperCase()}</div>
                    <div style={{ fontFamily: 'var(--font-manrope), sans-serif', fontSize: 11, color: highlight ? '#E8850A' : '#8CA090', marginBottom: 16 }}>
                      {sub}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 2 }}>
                      <span style={{
                        fontFamily: 'var(--font-fraunces), serif', fontWeight: 700,
                        fontSize: 44, lineHeight: 1, letterSpacing: '-0.01em',
                        color: highlight ? '#E8850A' : '#0B1E12',
                      }}>
                        {value}
                      </span>
                      {unit && (
                        <span style={{ fontFamily: 'var(--font-fraunces), serif', fontWeight: 400, fontStyle: 'italic', fontSize: 22, color: '#8CA090', marginLeft: 1 }}>
                          {unit}
                        </span>
                      )}
                      {trend !== null && trend !== undefined && (
                        <span style={{ fontFamily: 'var(--font-manrope), sans-serif', fontSize: 12, fontWeight: 600, color: (trend as number) >= 0 ? '#2A9960' : '#BF6B6B', marginLeft: 8 }}>
                          {(trend as number) >= 0 ? '+' : ''}{(trend as number).toFixed(1)}
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* ── 2.5 Adaptive planner (English only, 2+ sessions) ──── */}
            {englishSessions.length >= 2 && (
              <PlannerPanel sessions={englishSessions} />
            )}

            {/* ── 3. Charts row ─────────────────────────────────────── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 24, marginBottom: 24 }}>

              {/* 3a · Scatter plot */}
              <div style={{ background: 'white', border: '1px solid #E2DDD8', borderRadius: 14, boxShadow: '0 1px 4px rgba(0,0,0,.06)', padding: 24 }}>
                <div style={{ borderBottom: '1px solid #F0EDE8', paddingBottom: 14, marginBottom: 20 }}>
                  <div style={cardSection}>Speed vs. Accuracy</div>
                  <div style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 10, color: '#8CA090', marginTop: 4 }}>
                    Response time (s) × correctness — {Math.min(allResults.length, 67)} items plotted
                  </div>
                </div>
                <ScatterPlot results={allResults.slice(0, 67)} />
              </div>

              {/* 3b · Heatmap */}
              <div style={{ background: 'white', border: '1px solid #E2DDD8', borderRadius: 14, boxShadow: '0 1px 4px rgba(0,0,0,.06)', padding: 24 }}>
                <div style={{ borderBottom: '1px solid #F0EDE8', paddingBottom: 14, marginBottom: 20 }}>
                  <div style={cardSection}>Training Intensity</div>
                  <div style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 10, color: '#8CA090', marginTop: 4 }}>
                    {WEEKS}-week activity · items drilled per day
                  </div>
                </div>
                <HeatmapGrid heatDays={heatDays} weeks={WEEKS} />
              </div>
            </div>

            {/* ── 4. Errata ledger ──────────────────────────────────── */}
            {errorLedger.length > 0 && (
              <div style={{ background: 'white', border: '1px solid #E2DDD8', borderRadius: 14, boxShadow: '0 1px 4px rgba(0,0,0,.06)', overflow: 'hidden', marginBottom: 24 }}>
                <div style={{ padding: '20px 28px 14px', borderBottom: '1px solid #E2DDD8' }}>
                  <div style={cardSection}>Errata · Error Ledger</div>
                  <div style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 10, color: '#8CA090', marginTop: 4 }}>
                    Recent deviations · {errorLedger.length} entries · sorted by session date
                  </div>
                </div>

                {/* Column headers */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '50px 72px 108px 1fr 1fr 56px',
                  gap: '0 18px',
                  padding: '9px 28px',
                  background: '#FAFAF8',
                  borderBottom: '1px solid #E2DDD8',
                }}>
                  {['REF', 'SESSION', 'TYPE', 'CUE', 'EXPECTED · ACTUAL', 'TIME'].map(h => (
                    <div key={h} style={{ ...eyebrow }}>{h}</div>
                  ))}
                </div>

                {/* Error rows */}
                {errorLedger.map((r, i) => {
                  const d = new Date(r.sessionDate)
                  const typeKey = r.item.category ?? r.item.type
                  const typeColor = TYPE_COLOR[typeKey] ?? '#4A5A50'
                  return (
                    <div key={i} style={{
                      display: 'grid',
                      gridTemplateColumns: '50px 72px 108px 1fr 1fr 56px',
                      gap: '0 18px',
                      padding: '14px 28px',
                      borderTop: '1px solid #F0EDE8',
                      alignItems: 'start',
                    }}>
                      {/* §ref */}
                      <div style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 10, color: '#8CA090', paddingTop: 3 }}>
                        §{String(i + 1).padStart(2, '0')}
                      </div>
                      {/* Date/time */}
                      <div style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 10, color: '#8CA090', lineHeight: 1.7 }}>
                        {d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}<br />
                        {d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                      </div>
                      {/* Type tag */}
                      <div style={{ paddingTop: 2 }}>
                        <span style={{
                          fontFamily: 'var(--font-jetbrains), monospace',
                          fontSize: 9, fontWeight: 600, letterSpacing: '0.05em',
                          textTransform: 'uppercase', color: typeColor,
                          background: '#FAF7F0', border: '1px solid #E2DDD8',
                          padding: '3px 7px', borderRadius: 3, whiteSpace: 'nowrap',
                        }}>
                          {typeKey}
                        </span>
                      </div>
                      {/* Cue */}
                      <div style={{ fontFamily: 'var(--font-manrope), sans-serif', fontSize: 13, color: '#0B1E12', lineHeight: 1.5, paddingTop: 2 }}>
                        {r.item.prompt}
                      </div>
                      {/* Expected / Actual */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                        <span style={{
                          fontFamily: 'var(--font-fraunces), serif',
                          fontStyle: 'italic', fontWeight: 700,
                          fontSize: 14, color: '#0B1E12',
                        }}>
                          {r.item.answer}
                        </span>
                        {r.userAnswer && (
                          <span style={{
                            fontFamily: 'var(--font-jetbrains), monospace',
                            fontSize: 11, color: '#BF6B6B',
                            textDecoration: 'line-through',
                            textDecorationColor: 'rgba(191,107,107,0.55)',
                          }}>
                            {r.userAnswer}
                          </span>
                        )}
                      </div>
                      {/* Time */}
                      <div style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 11, color: '#8CA090', textAlign: 'right', paddingTop: 2 }}>
                        {r.timeUsed}s
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* ── 5. Footer pair ────────────────────────────────────── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.3fr', gap: 24 }}>

              {/* 5a · Accuracy by type */}
              <div style={{ background: 'white', border: '1px solid #E2DDD8', borderRadius: 14, boxShadow: '0 1px 4px rgba(0,0,0,.06)', padding: 24 }}>
                <div style={{ borderBottom: '1px solid #F0EDE8', paddingBottom: 14, marginBottom: 20 }}>
                  <div style={cardSection}>Accuracy by Type</div>
                  <div style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 10, color: '#8CA090', marginTop: 4 }}>All sessions combined</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                  {TYPE_ORDER.filter(t => typeStats[t]).map(type => {
                    const { correct, total } = typeStats[type]
                    const pct = Math.round(correct / total * 100)
                    const color = TYPE_COLOR[type]
                    return (
                      <div key={type}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                          <span style={{ fontFamily: 'var(--font-manrope), sans-serif', fontSize: 14, fontWeight: 500, color: '#0B1E12', textTransform: 'capitalize' }}>
                            {type}
                          </span>
                          <span style={{ fontFamily: 'var(--font-fraunces), serif', fontWeight: 700, fontStyle: 'italic', fontSize: 18, color }}>
                            {pct}<span style={{ fontSize: 12, fontWeight: 400 }}>%</span>
                          </span>
                        </div>
                        <div style={{ height: 6, background: '#F0EDE8', borderRadius: 3, overflow: 'hidden', marginBottom: 5 }}>
                          <div style={{ height: '100%', width: pct + '%', background: color, borderRadius: 3, transition: 'width 0.5s ease' }} />
                        </div>
                        <div style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 10, color: '#8CA090' }}>
                          {correct}/{total} correct
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* 5b · Session history */}
              <div style={{ background: 'white', border: '1px solid #E2DDD8', borderRadius: 14, boxShadow: '0 1px 4px rgba(0,0,0,.06)', padding: 24 }}>
                <div style={{ borderBottom: '1px solid #F0EDE8', paddingBottom: 14, marginBottom: 20 }}>
                  <div style={cardSection}>Session History</div>
                  <div style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 10, color: '#8CA090', marginTop: 4 }}>
                    Most recent {Math.min(byDate.length, 7)} sessions
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {byDate.slice(0, 7).map((s, i) => {
                    const d = new Date(s.date)
                    const totalSec = Math.round((s.avgTime ?? 0) * s.total)
                    const pctColor = gradeColor(s.accuracy)
                    return (
                      <div key={s.id} style={{
                        display: 'grid',
                        gridTemplateColumns: '70px 22px 1fr 48px 50px 58px',
                        gap: '0 12px',
                        alignItems: 'center',
                        padding: '12px 0',
                        borderBottom: i < Math.min(byDate.length, 7) - 1 ? '1px solid #F0EDE8' : 'none',
                      }}>
                        {/* Date/time */}
                        <div style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 9, color: '#8CA090', lineHeight: 1.7 }}>
                          {d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}<br />
                          {d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                        </div>
                        {/* Flag */}
                        <div style={{ fontSize: 14, textAlign: 'center' }}>
                          {s.language ? (LANGUAGES[s.language]?.flag ?? '') : ''}
                        </div>
                        {/* Mode */}
                        <div style={{ fontFamily: 'var(--font-manrope), sans-serif', fontSize: 13, color: '#0B1E12', textTransform: 'capitalize', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {s.drillType}
                        </div>
                        {/* Duration */}
                        <div style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 10, color: '#8CA090', textAlign: 'right' }}>
                          {fmtDuration(totalSec)}
                        </div>
                        {/* Percent */}
                        <div style={{ fontFamily: 'var(--font-fraunces), serif', fontWeight: 700, fontStyle: 'italic', fontSize: 16, color: pctColor, textAlign: 'right' }}>
                          {s.accuracy}%
                        </div>
                        {/* Items */}
                        <div style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 11, color: '#8CA090', textAlign: 'right' }}>
                          {s.correct}/{s.total}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

            </div>
          </>
        )}

      </div>
    </div>
  )
}
