'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  computeStats,
  ignoreClientAuthExpiredError,
  loadLanguage,
  loadSessions,
  saveLanguage,
} from '@/lib/stats'
import { LANGUAGES } from '@/lib/drills'
import type { Language } from '@/lib/drills'

// Static drill preview — shows what the product actually is
function DrillPreview() {
  return (
    <div
      style={{
        background: 'var(--surface-1)',
        border: '1px solid var(--border-mid)',
        borderRadius: 8,
        overflow: 'hidden',
        userSelect: 'none',
      }}
    >
      {/* Status bar */}
      <div style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
        <div style={{ height: 4, background: 'var(--surface-3)' }}>
          <div style={{ height: '100%', width: '62%', background: 'var(--text-3)' }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '10px 18px' }}>
          {[
            { label: 'Type', value: 'Translation' },
            { label: 'Item', value: '3 / 10' },
            { label: 'Accuracy', value: '87%' },
          ].map(({ label, value }) => (
            <div key={label}>
              <div style={{ fontFamily: 'var(--font-manrope), sans-serif', fontWeight: 600, fontSize: 9, letterSpacing: '0.10em', textTransform: 'uppercase', color: '#4B5563', marginBottom: 2 }}>{label}</div>
              <div style={{ fontFamily: 'var(--font-manrope), sans-serif', fontWeight: 600, fontSize: 12, color: 'var(--text-2)' }}>{value}</div>
            </div>
          ))}
          <div style={{ marginLeft: 'auto' }}>
            <div style={{ fontFamily: 'var(--font-manrope), sans-serif', fontWeight: 600, fontSize: 9, letterSpacing: '0.10em', textTransform: 'uppercase', color: '#4B5563', marginBottom: 2 }}>Time</div>
            <div style={{ fontFamily: 'var(--font-manrope), sans-serif', fontWeight: 600, fontSize: 12, color: 'var(--text-2)' }}>13s</div>
          </div>
        </div>
      </div>

      {/* Drill content */}
      <div style={{ padding: '22px 22px 16px' }}>
        {/* Type + instruction */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
          <span style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#4B5563', border: '1px solid #D1D5DB', padding: '2px 7px', borderRadius: 2 }}>
            translation
          </span>
          <span style={{ fontFamily: 'var(--font-manrope), sans-serif', fontSize: 11, color: '#6B7280' }}>
            Translate to Spanish.
          </span>
        </div>

        {/* Prompt */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginBottom: 18 }}>
          <div style={{ fontFamily: 'var(--font-manrope), sans-serif', fontWeight: 600, fontSize: 9, letterSpacing: '0.10em', textTransform: 'uppercase', color: '#4B5563', marginBottom: 10 }}>Prompt</div>
          <div style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: '1.125rem', color: 'var(--text-1)', lineHeight: 1.4 }}>
            Where is the hotel?
          </div>
        </div>

        {/* Response */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontFamily: 'var(--font-manrope), sans-serif', fontWeight: 600, fontSize: 9, letterSpacing: '0.10em', textTransform: 'uppercase', color: '#4B5563', marginBottom: 8 }}>Response</div>
          <div style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: '0.875rem', color: 'var(--text-1)', borderBottom: '1px solid var(--border-mid)', paddingBottom: 7, display: 'flex', alignItems: 'center' }}>
            ¿Dónde está el hotel?
            <span style={{ display: 'inline-block', width: 1.5, height: 13, background: 'var(--text-2)', marginLeft: 2, animation: 'blink 1s step-end infinite' }} />
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ background: 'var(--text-1)', color: 'var(--bg)', fontFamily: 'var(--font-manrope), sans-serif', fontWeight: 600, fontSize: 11, padding: '6px 14px', borderRadius: 3 }}>
            Submit
          </div>
          <div style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 10, color: '#374151', padding: '6px 12px', border: '1px solid #D1D5DB', borderRadius: 4, background: 'transparent' }}>
            Skip
          </div>
        </div>
      </div>

      {/* Progress track */}
      <div style={{ display: 'flex', gap: 2, padding: '0 8px 10px' }}>
        {Array.from({ length: 10 }).map((_, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              height: 6,
              borderRadius: 3,
              background: i < 2 ? 'var(--correct)' : i === 2 ? 'var(--text-1)' : 'var(--surface-3)',
            }}
          />
        ))}
      </div>
    </div>
  )
}

export default function HomeClient() {
  const [stats, setStats] = useState<{ sessions: number; accuracy: number; total: number; avgTime: number } | null>(null)
  const [language, setLanguage] = useState<Language>('es')

  useEffect(() => {
    loadSessions()
      .then((sessions) => {
        const s = computeStats(sessions)
        if (s) setStats({ sessions: s.sessions, accuracy: s.accuracy, total: s.total, avgTime: s.avgTime })
      })
      .catch(ignoreClientAuthExpiredError)

    loadLanguage()
      .then((value) => setLanguage(value))
      .catch(ignoreClientAuthExpiredError)
  }, [])

  const handleLanguageSelect = (lang: Language) => {
    setLanguage(lang)
    void saveLanguage(lang).catch(ignoreClientAuthExpiredError)
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>

      {/* ── Hero ─────────────────────────────────────────────────── */}
      <section className="bg-stone-50" style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="mob-hero-pad" style={{ maxWidth: 1200, margin: '0 auto', padding: '72px 32px 80px' }}>
          <div
            className="mob-hero-grid"
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 72,
              alignItems: 'center',
            }}
          >
            {/* Left: Copy */}
            <div>
              <div
                className="reveal reveal-1"
                style={{
                  fontFamily: 'var(--font-manrope), sans-serif',
                  fontSize: '0.75rem',
                  color: 'var(--text-3)',
                  marginBottom: 24,
                  letterSpacing: '0.02em',
                }}
              >
                Audio-Lingual · {LANGUAGES[language].name} · Unit I
              </div>

              <h1
                className="reveal reveal-2"
                style={{
                  fontFamily: 'var(--font-fraunces), serif',
                  fontWeight: 700,
                  fontSize: 'clamp(2.5rem, 4.5vw, 3.5rem)',
                  lineHeight: 1.12,
                  letterSpacing: '-0.01em',
                  color: '#0B1E12',
                  marginBottom: 20,
                }}
              >
                Language training{' '}
                <span style={{ fontStyle: 'italic', color: '#1F5C3A' }}>
                  with no accommodation.
                </span>
              </h1>

              <p
                className="reveal reveal-3"
                style={{
                  fontFamily: 'var(--font-manrope), sans-serif',
                  fontSize: '0.9375rem',
                  fontWeight: 400,
                  lineHeight: 1.72,
                  color: 'var(--text-2)',
                  maxWidth: 440,
                  marginBottom: 36,
                }}
              >
                Translation, substitution, and transformation drills
                based on the audio-lingual method. Twenty-second timers.
                Errors surfaced immediately. No partial credit.
              </p>

              <div className="reveal reveal-4" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <Link href="/drill" className="btn-primary">
                  Begin Training
                </Link>
                <Link
                  href="/dashboard"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    fontFamily: 'var(--font-manrope), sans-serif',
                    fontWeight: 500,
                    fontSize: '0.875rem',
                    color: 'var(--text-2)',
                    textDecoration: 'none',
                  }}
                >
                  View Results <span style={{ opacity: 0.5 }}>→</span>
                </Link>
              </div>
            </div>

            {/* Right: Drill preview */}
            <div className="reveal reveal-3 mob-hidden">
              <DrillPreview />
            </div>
          </div>
        </div>
      </section>

      {/* ── Language selector ─────────────────────────────────────── */}
      <section style={{ background: 'var(--bg)', borderBottom: '1px solid #E2DDD8' }}>
        <div className="mob-section-pad" style={{ maxWidth: 1200, margin: '0 auto', padding: '48px 32px' }}>
          <div style={{ fontFamily: 'var(--font-manrope), sans-serif', fontWeight: 700, fontSize: 11, letterSpacing: '1.2px', textTransform: 'uppercase', color: '#4A5A50', marginBottom: 20 }}>
            Target Language
          </div>
          <div className="grid grid-cols-4 gap-3 mob-lang-grid">
            {(Object.entries(LANGUAGES) as [Language, { name: string; native: string; flag: string }][]).map(([code, info]) => {
              const active = language === code
              return (
                <button
                  key={code}
                  onClick={() => handleLanguageSelect(code)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '14px 16px',
                    background: 'white', borderRadius: 12,
                    border: '1px solid #E2DDD8',
                    cursor: 'pointer', textAlign: 'left',
                    transition: 'border-color 0.15s',
                    fontFamily: 'var(--font-manrope), sans-serif',
                  }}
                >
                  <span style={{ fontSize: '1.25rem', lineHeight: 1, flexShrink: 0 }}>{info.flag}</span>
                  <span style={{ fontWeight: 600, fontSize: 14, color: '#0B1E12' }}>{info.native}</span>
                  <span style={{ fontSize: 13, color: '#4A5A50', fontWeight: 400 }}>{info.name}</span>
                  <span style={{ flex: 1 }} />
                  {active && <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#1F5C3A', flexShrink: 0, display: 'inline-block' }} />}
                </button>
              )
            })}
          </div>
        </div>
      </section>

      {/* ── Method ───────────────────────────────────────────────── */}
      <section className="bg-stone-50" style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="mob-section-pad" style={{ maxWidth: 1200, margin: '0 auto', padding: '56px 32px' }}>
          <div
            style={{
              fontFamily: 'var(--font-jetbrains), monospace',
              fontSize: '0.6875rem',
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: '#374151',
              marginBottom: 32,
            }}
          >
            Training Protocol
          </div>
          <div className="grid grid-cols-3 gap-4 mob-method-grid">
            {[
              {
                type: 'Translation',
                code: 'EN → TL',
                desc: 'Produce the target-language equivalent of an English sentence. No hints. No vocabulary reference. Twenty seconds.',
                count: '10 items',
              },
              {
                type: 'Substitution',
                code: 'Cue → Form',
                desc: 'Replace the cued element within a target-language sentence. Adjust morphological agreement as required by the substitution.',
                count: '7 items',
              },
              {
                type: 'Transformation',
                code: 'Structure',
                desc: 'Apply a grammatical operation: negate, form a yes/no question, or reverse negation. Both form and meaning evaluated.',
                count: '7 items',
              },
            ].map(({ type, code, desc, count }) => (
              <div
                key={type}
                className="bg-white border border-gray-200 rounded-lg shadow-sm p-7 hover:shadow-md transition-shadow"
              >
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
                  <span
                    style={{
                      fontFamily: 'var(--font-manrope), sans-serif',
                      fontWeight: 600,
                      fontSize: '0.9375rem',
                      color: 'var(--text-1)',
                    }}
                  >
                    {type}
                  </span>
                  <span
                    className="border border-gray-300 px-2 py-0.5 rounded-sm"
                    style={{
                      fontFamily: 'var(--font-jetbrains), monospace',
                      fontSize: '0.6875rem',
                      color: '#4B5563',
                      letterSpacing: '0.04em',
                    }}
                  >
                    {code}
                  </span>
                </div>
                <p
                  style={{
                    fontFamily: 'var(--font-manrope), sans-serif',
                    fontSize: '0.8125rem',
                    lineHeight: 1.65,
                    color: 'var(--text-2)',
                    marginBottom: 16,
                  }}
                >
                  {desc}
                </p>
                <div
                  style={{
                    fontFamily: 'var(--font-jetbrains), monospace',
                    fontSize: '0.625rem',
                    letterSpacing: '0.10em',
                    textTransform: 'uppercase',
                    color: '#4B5563',
                  }}
                >
                  {count} available
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Stats (if data exists) ────────────────────────────────── */}
      {stats && (
        <section className="bg-white" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="mob-section-pad" style={{ maxWidth: 1200, margin: '0 auto', padding: '48px 32px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
              <div
                style={{
                  fontFamily: 'var(--font-jetbrains), monospace',
                  fontSize: '0.6875rem',
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: '#374151',
                }}
              >
                Your Performance
              </div>
              <Link
                href="/dashboard"
                style={{
                  fontFamily: 'var(--font-manrope), sans-serif',
                  fontSize: '0.8125rem',
                  color: 'var(--text-2)',
                  textDecoration: 'none',
                }}
              >
                Full report →
              </Link>
            </div>
            <div className="mob-stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1, background: 'var(--border)' }}>
              {[
                { value: String(stats.sessions), label: 'Sessions' },
                { value: String(stats.total), label: 'Items attempted' },
                {
                  value: stats.accuracy + '%',
                  label: 'Overall accuracy',
                  color: stats.accuracy >= 80 ? 'var(--correct)' : stats.accuracy >= 60 ? 'var(--timeout)' : 'var(--incorrect)',
                },
                { value: stats.avgTime + 's', label: 'Avg. response time' },
              ].map(({ value, label, color }) => (
                <div key={label} style={{ background: 'var(--bg)', padding: '22px 28px' }}>
                  <div
                    style={{
                      fontFamily: 'var(--font-fraunces), sans-serif',
                      fontWeight: 600,
                      fontSize: '1.875rem',
                      lineHeight: 1,
                      color: color ?? 'var(--text-1)',
                      marginBottom: 3,
                      letterSpacing: '-0.025em',
                    }}
                  >
                    {value}
                  </div>
                  <div
                    style={{
                      fontFamily: 'var(--font-manrope), sans-serif',
                      fontSize: '0.8125rem',
                      fontWeight: 600,
                      color: '#374151',
                    }}
                  >
                    {label}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── Bottom CTA ───────────────────────────────────────────── */}
      <section className="bg-stone-50" style={{ marginTop: 'auto' }}>
        <div className="mob-section-pad" style={{ maxWidth: 1200, margin: '0 auto', padding: '52px 32px' }}>
          <div className="mob-cta-stack" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div
                style={{
                  fontFamily: 'var(--font-fraunces), sans-serif',
                  fontWeight: 600,
                  fontSize: '1.25rem',
                  color: 'var(--text-1)',
                  marginBottom: 6,
                  letterSpacing: '-0.03em',
                }}
              >
                Ready to train?
              </div>
              <div
                style={{
                  fontFamily: 'var(--font-manrope), sans-serif',
                  fontSize: '0.875rem',
                  color: 'var(--text-2)',
                }}
              >
                Begin a session now. Results tracked automatically.
              </div>
            </div>
            <Link href="/drill" className="btn-primary" style={{ flexShrink: 0 }}>
              Begin Training
            </Link>
          </div>
        </div>
      </section>

    </div>
  )
}
