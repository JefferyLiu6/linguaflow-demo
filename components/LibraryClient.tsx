'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { LANGUAGES, TOPICS, getDB } from '@/lib/drills'
import type { Language, DrillItem, DrillTopic } from '@/lib/drills'

const LANGS: Language[] = ['es', 'fr', 'de', 'zh', 'ja', 'ko', 'en']

function countByCategory(db: DrillItem[]) {
  const counts: Record<string, number> = {}
  for (const item of db) {
    const cat = item.category ?? 'sentence'
    counts[cat] = (counts[cat] ?? 0) + 1
  }
  return counts
}

function countByTopic(db: DrillItem[]) {
  const counts: Partial<Record<DrillTopic, number>> = {}
  for (const item of db) {
    if (item.topic) counts[item.topic] = (counts[item.topic] ?? 0) + 1
  }
  return counts
}

const CAT_LABELS: Record<string, string> = {
  sentence: 'Sentence',
  vocab: 'Vocab',
  phrase: 'Phrase',
}

export default function LibraryClient() {
  const [customItems, setCustomItems] = useState<DrillItem[]>([])
  const [customLoaded, setCustomLoaded] = useState(false)
  const [expandedLang, setExpandedLang] = useState<Language | null>(null)
  const [expandedCustom, setExpandedCustom] = useState(false)
  const [topicFilter, setTopicFilter] = useState<DrillTopic | null>(null)

  useEffect(() => {
    fetch('/api/custom-list')
      .then(r => r.json())
      .then(data => {
        setCustomItems(Array.isArray(data) ? data : [])
        setCustomLoaded(true)
      })
      .catch(() => setCustomLoaded(true))
  }, [])

  return (
    <div style={{ flex: 1 }}>
      {/* Header */}
      <div style={{ borderBottom: '1px solid var(--border)' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '40px 32px 36px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
            <div>
              <div
                style={{
                  fontFamily: 'var(--font-jetbrains), monospace',
                  fontSize: '0.6875rem',
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: 'var(--text-3)',
                  marginBottom: 10,
                }}
              >
                Content Library · All Languages
              </div>
              <h1
                style={{
                  fontFamily: 'var(--font-fraunces), sans-serif',
                  fontWeight: 600,
                  fontSize: 'clamp(1.5rem, 3vw, 2rem)',
                  letterSpacing: '-0.03em',
                  color: 'var(--text-1)',
                  lineHeight: 1.1,
                }}
              >
                Word Lists
              </h1>
            </div>
            <Link
              href="/drill"
              style={{
                display: 'inline-block',
                background: 'var(--text-1)',
                color: 'var(--bg)',
                fontFamily: 'var(--font-manrope), sans-serif',
                fontWeight: 600,
                fontSize: '0.875rem',
                padding: '10px 20px',
                textDecoration: 'none',
                borderRadius: 4,
                letterSpacing: '-0.01em',
              }}
            >
              Start Training
            </Link>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '40px 32px 80px' }}>

        {/* Summary bar */}
        <div className="grid grid-cols-4 gap-3" style={{ marginBottom: 40 }}>
          {[...LANGS, null].map((lang) => {
            if (lang === null) {
              return (
                <div key="custom" className="bg-white border border-gray-200 rounded-md shadow-sm" style={{ padding: '18px 24px', borderTop: '3px solid var(--surface-3)' }}>
                  <div style={{ fontFamily: 'var(--font-manrope), sans-serif', fontWeight: 500, fontSize: '0.6875rem', color: 'var(--text-3)', marginBottom: 6 }}>
                    Custom
                  </div>
                  <div style={{ fontFamily: 'var(--font-fraunces), sans-serif', fontWeight: 600, fontSize: '1.75rem', lineHeight: 1, color: 'var(--text-1)', letterSpacing: '-0.025em' }}>
                    {customLoaded ? customItems.length : '—'}
                  </div>
                  <div style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: '0.5625rem', color: 'var(--text-3)', marginTop: 4, letterSpacing: '0.04em' }}>
                    {customLoaded ? 'items uploaded' : 'loading...'}
                  </div>
                </div>
              )
            }
            const db = getDB(lang)
            const { name, flag } = LANGUAGES[lang]
            return (
              <div key={lang} className="bg-white border border-gray-200 rounded-md shadow-sm" style={{ padding: '18px 24px', borderTop: '3px solid var(--surface-3)' }}>
                <div style={{ fontFamily: 'var(--font-manrope), sans-serif', fontWeight: 500, fontSize: '0.6875rem', color: 'var(--text-3)', marginBottom: 6 }}>
                  {flag} {name}
                </div>
                <div style={{ fontFamily: 'var(--font-fraunces), sans-serif', fontWeight: 600, fontSize: '1.75rem', lineHeight: 1, color: 'var(--text-1)', letterSpacing: '-0.025em' }}>
                  {db.length}
                </div>
                <div style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: '0.5625rem', color: 'var(--text-3)', marginTop: 4, letterSpacing: '0.04em' }}>
                  drills available
                </div>
              </div>
            )
          })}
        </div>

        {/* Built-in language lists */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
          {LANGS.map(lang => {
            const db = getDB(lang)
            const counts = countByCategory(db)
            const { name, native, flag } = LANGUAGES[lang]
            const open = expandedLang === lang

            return (
              <div key={lang} className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
                {/* Row header */}
                <button
                  onClick={() => setExpandedLang(open ? null : lang)}
                  style={{
                    width: '100%',
                    display: 'grid',
                    gridTemplateColumns: '1fr auto auto',
                    alignItems: 'center',
                    gap: 24,
                    padding: '20px 24px',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                      <span style={{ fontSize: '1.1rem' }}>{flag}</span>
                      <span style={{ fontFamily: 'var(--font-manrope), sans-serif', fontWeight: 600, fontSize: '0.9375rem', color: 'var(--text-1)' }}>
                        {name}
                      </span>
                      <span style={{ fontFamily: 'var(--font-manrope), sans-serif', fontSize: '0.8125rem', color: 'var(--text-3)' }}>
                        {native}
                      </span>
                    </div>
                    <div className="flex gap-4">
                      {Object.entries(counts).map(([cat, count]) => (
                        <span key={cat} className="text-xs uppercase tracking-wider text-gray-400"
                          style={{ fontFamily: 'var(--font-jetbrains), monospace' }}>
                          {CAT_LABELS[cat] ?? cat}{' '}
                          <span className="text-gray-600 font-medium normal-case tracking-normal">{count}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                  <div style={{ fontFamily: 'var(--font-fraunces), sans-serif', fontWeight: 600, fontSize: '1.5rem', color: 'var(--text-2)', letterSpacing: '-0.025em' }}>
                    {db.length}
                  </div>
                  <div style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: '0.75rem', color: 'var(--text-3)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
                    ▾
                  </div>
                </button>

                {/* Expanded table */}
                {open && (() => {
                  const topicCounts = countByTopic(db)
                  const visibleItems = topicFilter ? db.filter(d => d.topic === topicFilter) : db
                  return (
                    <div style={{ borderTop: '1px solid var(--border)', padding: '0 24px 24px' }}>
                      {/* Topic filter pills */}
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 16, marginBottom: 16 }}>
                        <button
                          onClick={() => setTopicFilter(null)}
                          style={{ background: topicFilter === null ? 'var(--text-1)' : 'var(--surface-2)', color: topicFilter === null ? 'var(--bg)' : 'var(--text-2)', fontFamily: 'var(--font-manrope), sans-serif', fontWeight: topicFilter === null ? 600 : 400, fontSize: '0.75rem', padding: '4px 10px', border: 'none', borderRadius: 3, cursor: 'pointer' }}
                        >
                          All ({db.length})
                        </button>
                        {(Object.keys(TOPICS) as DrillTopic[]).map(t => {
                          const cnt = topicCounts[t] ?? 0
                          if (!cnt) return null
                          return (
                            <button
                              key={t}
                              onClick={() => setTopicFilter(t)}
                              style={{ background: topicFilter === t ? 'var(--text-1)' : 'var(--surface-2)', color: topicFilter === t ? 'var(--bg)' : 'var(--text-2)', fontFamily: 'var(--font-manrope), sans-serif', fontWeight: topicFilter === t ? 600 : 400, fontSize: '0.75rem', padding: '4px 10px', border: 'none', borderRadius: 3, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                            >
                              <span style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: '0.6875rem' }}>{TOPICS[t].icon}</span>
                              {TOPICS[t].label} ({cnt})
                            </button>
                          )
                        })}
                      </div>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr>
                            {['Mode', 'Topic', 'Prompt', 'Answer'].map(h => (
                              <th
                                key={h}
                                style={{
                                  fontFamily: 'var(--font-manrope), sans-serif',
                                  fontWeight: 500,
                                  fontSize: '0.6875rem',
                                  color: 'var(--text-3)',
                                  padding: '0 16px 10px 0',
                                  borderBottom: '1px solid var(--border)',
                                  textAlign: 'left',
                                }}
                              >
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {visibleItems.map(item => (
                            <tr key={item.id}>
                              <td style={{ padding: '8px 16px 8px 0', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-jetbrains), monospace', fontSize: '0.5625rem', textTransform: 'uppercase', color: 'var(--text-3)', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>
                                {item.category ?? 'sentence'}
                              </td>
                              <td style={{ padding: '8px 16px 8px 0', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-jetbrains), monospace', fontSize: '0.5625rem', color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
                                {item.topic ? `${TOPICS[item.topic].icon} ${TOPICS[item.topic].label}` : '—'}
                              </td>
                              <td style={{ padding: '8px 16px 8px 0', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-jetbrains), monospace', fontSize: '0.8125rem', color: 'var(--text-2)' }}>
                                {item.prompt}
                              </td>
                              <td style={{ padding: '8px 0', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-jetbrains), monospace', fontSize: '0.8125rem', color: 'var(--text-2)' }}>
                                {item.answer}
                                {item.variants && item.variants.length > 0 && (
                                  <span style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: '0.625rem', color: 'var(--text-3)', marginLeft: 8 }}>
                                    +{item.variants.length} variant{item.variants.length > 1 ? 's' : ''}
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
                })()}
              </div>
            )
          })}
        </div>

        {/* Custom list */}
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
          <button
            onClick={() => customItems.length > 0 && setExpandedCustom(v => !v)}
            style={{
              width: '100%',
              display: 'grid',
              gridTemplateColumns: '1fr auto auto',
              alignItems: 'center',
              gap: 24,
              padding: '20px 24px',
              background: 'transparent',
              border: 'none',
              cursor: customItems.length > 0 ? 'pointer' : 'default',
              textAlign: 'left',
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                <span style={{ fontFamily: 'var(--font-manrope), sans-serif', fontWeight: 600, fontSize: '0.9375rem', color: 'var(--text-1)' }}>
                  Custom List
                </span>
                <span style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: '0.5625rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)', background: 'var(--surface-3)', padding: '2px 6px', borderRadius: 2 }}>
                  Uploaded
                </span>
              </div>
              <div style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: '0.5625rem', color: 'var(--text-3)', letterSpacing: '0.04em' }}>
                {!customLoaded ? 'Loading...' : customItems.length === 0 ? 'No custom list uploaded yet — upload one in the drill setup.' : `${customItems.length} item${customItems.length !== 1 ? 's' : ''} · Translation drill`}
              </div>
            </div>
            <div style={{ fontFamily: 'var(--font-fraunces), sans-serif', fontWeight: 600, fontSize: '1.5rem', color: customItems.length > 0 ? 'var(--text-2)' : 'var(--text-3)', letterSpacing: '-0.025em' }}>
              {customLoaded ? customItems.length : '—'}
            </div>
            {customItems.length > 0 && (
              <div style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: '0.75rem', color: 'var(--text-3)', transform: expandedCustom ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
                ▾
              </div>
            )}
          </button>

          {expandedCustom && customItems.length > 0 && (
            <div style={{ borderTop: '1px solid var(--border)', padding: '0 24px 24px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 20 }}>
                <thead>
                  <tr>
                    {['#', 'Prompt', 'Answer'].map(h => (
                      <th
                        key={h}
                        style={{
                          fontFamily: 'var(--font-manrope), sans-serif',
                          fontWeight: 500,
                          fontSize: '0.6875rem',
                          color: 'var(--text-3)',
                          padding: '0 16px 10px 0',
                          borderBottom: '1px solid var(--border)',
                          textAlign: 'left',
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {customItems.map((item, i) => (
                    <tr key={item.id}>
                      <td style={{ padding: '8px 16px 8px 0', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-jetbrains), monospace', fontSize: '0.625rem', color: 'var(--text-3)' }}>
                        {i + 1}
                      </td>
                      <td style={{ padding: '8px 16px 8px 0', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-jetbrains), monospace', fontSize: '0.8125rem', color: 'var(--text-2)' }}>
                        {item.prompt}
                      </td>
                      <td style={{ padding: '8px 0', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-jetbrains), monospace', fontSize: '0.8125rem', color: 'var(--text-2)' }}>
                        {item.answer}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
