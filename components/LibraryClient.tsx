'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { LANGUAGES, TOPICS, getDB } from '@/lib/drills'
import type { Language, DrillItem, DrillTopic } from '@/lib/drills'
import { ignoreClientAuthExpiredError, isClientAuthExpiredError, loadCustomList, loadLanguage, readLanguageSync } from '@/lib/stats'

const LANGS: Language[] = ['es', 'fr', 'de', 'zh', 'ja', 'ko', 'en']

const LANG_COLOR: Record<Language, string> = {
  es: '#E8850A',
  fr: '#3B82F6',
  de: '#6366F1',
  zh: '#DC2626',
  ja: '#F97316',
  ko: '#EC4899',
  en: '#06B6D4',
}

const CAT_COLOR = {
  sentence: '#2A9960',
  vocab:    '#3B82F6',
  phrase:   '#9B72CF',
} as const

function PromptWithCues({ text }: { text: string }) {
  const parts = text.split(/(\[[^\]]+\])/)
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith('[') && part.endsWith(']') ? (
          <span key={i} style={{ background: '#FFF3D9', borderRadius: 3, padding: '1px 3px' }}>
            {part.slice(1, -1)}
          </span>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  )
}

function countByCategory(db: DrillItem[]) {
  const counts: Record<string, number> = {}
  for (const item of db) {
    const cat = item.category ?? 'sentence'
    counts[cat] = (counts[cat] ?? 0) + 1
  }
  return counts
}

export default function LibraryClient() {
  const [customItems, setCustomItems] = useState<DrillItem[]>([])
  const [customLoaded, setCustomLoaded] = useState(false)
  const [activeLang, setActiveLang] = useState<Language>(readLanguageSync)
  const [searchQuery, setSearchQuery] = useState('')
  const chapterRefs = useRef<Record<string, HTMLElement | null>>({})

  useEffect(() => {
    loadCustomList()
      .then((items) => { setCustomItems(items); setCustomLoaded(true) })
      .catch((error) => {
        if (isClientAuthExpiredError(error)) ignoreClientAuthExpiredError(error)
        setCustomLoaded(true)
      })
    loadLanguage().then(setActiveLang).catch(ignoreClientAuthExpiredError)
  }, [])

  const db = getDB(activeLang)
  const { name, flag } = LANGUAGES[activeLang]

  const topicGroups: Array<{ topic: DrillTopic; items: DrillItem[] }> = []
  const topicMap = new Map<DrillTopic, DrillItem[]>()
  for (const item of db) {
    if (!item.topic) continue
    if (!topicMap.has(item.topic)) topicMap.set(item.topic, [])
    topicMap.get(item.topic)!.push(item)
  }
  for (const [topic, items] of topicMap) topicGroups.push({ topic, items })

  const filteredGroups = searchQuery.trim()
    ? topicGroups
        .map(g => ({
          ...g,
          items: g.items.filter(
            item =>
              item.prompt.toLowerCase().includes(searchQuery.toLowerCase()) ||
              item.answer.toLowerCase().includes(searchQuery.toLowerCase())
          ),
        }))
        .filter(g => g.items.length > 0)
    : topicGroups

  // Page-level eyebrows (hero sections): lighter ink
  const eyebrowLabel: React.CSSProperties = {
    fontFamily: 'var(--font-manrope), sans-serif',
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '1.2px',
    textTransform: 'uppercase',
    color: '#8CA090',
  }

  // Card section headers: matches Dashboard sectionTitle
  const cardLabel: React.CSSProperties = {
    fontFamily: 'var(--font-manrope), sans-serif',
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '1.2px',
    textTransform: 'uppercase',
    color: '#4A5A50',
  }

  const colLabel: React.CSSProperties = {
    fontFamily: 'var(--font-manrope), sans-serif',
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '1.1px',
    textTransform: 'uppercase',
    color: '#8CA090',
  }

  return (
    <div style={{ flex: 1, background: 'var(--bg)' }}>

      {/* ── Hero ─────────────────────────────────────────────────── */}
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '56px 32px 40px' }}>
        <div style={{ ...eyebrowLabel, marginBottom: 12 }}>Content Library · All Languages</div>
        <h1 style={{
          fontFamily: 'var(--font-fraunces), serif',
          fontSize: 'clamp(2.5rem, 4.5vw, 3.5rem)',
          lineHeight: 1.05,
          color: '#0B1E12',
          fontWeight: 700,
          margin: 0,
        }}>
          Word <em style={{ fontStyle: 'italic', color: '#1F5C3A' }}>lists.</em>
        </h1>
      </div>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 32px 80px' }}>

        {/* ── Language card grid ──────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 32 }}>
          {LANGS.map(lang => {
            const langDb = getDB(lang)
            const { name: langName, flag: langFlag, native: langNative } = LANGUAGES[lang]
            const color = LANG_COLOR[lang]
            const counts = countByCategory(langDb)
            const isActive = activeLang === lang
            return (
              <button
                key={lang}
                onClick={() => setActiveLang(lang)}
                style={{
                  background: 'white',
                  border: isActive ? `2px solid ${color}` : '1px solid #E2DDD8',
                  borderRadius: 14,
                  padding: '20px 20px 0',
                  textAlign: 'left',
                  cursor: 'pointer',
                  boxShadow: isActive ? `0 4px 20px ${color}28` : '0 1px 4px rgba(0,0,0,.06)',
                  transition: 'all 0.15s',
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden',
                }}
              >
                <div style={{ fontSize: 22, marginBottom: 10 }}>{langFlag}</div>
                <div style={{ fontFamily: 'var(--font-fraunces), serif', fontWeight: 500, fontSize: 13, fontStyle: 'italic', color: '#8CA090', marginBottom: 2 }}>
                  {langNative}
                </div>
                <div style={{ fontFamily: 'var(--font-manrope), sans-serif', fontWeight: 700, fontSize: 14, color: '#0B1E12', marginBottom: 14 }}>
                  {langName}
                </div>
                <div style={{ fontFamily: 'var(--font-fraunces), serif', fontWeight: 700, fontSize: 38, color: '#0B1E12', lineHeight: 1, marginBottom: 2 }}>
                  {langDb.length}
                </div>
                <div style={{ ...eyebrowLabel, marginBottom: 14 }}>drills total</div>
                {/* S/V/P breakdown */}
                <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
                  {(['sentence', 'vocab', 'phrase'] as const).map(cat => (
                    <span key={cat} style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 11, color: CAT_COLOR[cat] }}>
                      {counts[cat] ?? 0}
                      <span style={{ opacity: 0.55, marginLeft: 1 }}>
                        {cat === 'sentence' ? 'S' : cat === 'vocab' ? 'V' : 'P'}
                      </span>
                    </span>
                  ))}
                </div>
                {/* Accent bar flush at bottom */}
                <div style={{ height: 3, background: color, margin: '0 -20px' }} />
              </button>
            )
          })}

          {/* Custom card */}
          <button
            onClick={() => {
              if (customItems.length > 0) {
                const el = chapterRefs.current['custom']
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }
            }}
            style={{
              background: 'white',
              border: customItems.length > 0 ? '1.5px solid #1F5C3A' : '1.5px dashed #C8C3BC',
              borderRadius: 14,
              padding: '20px 20px 16px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              cursor: customItems.length > 0 ? 'pointer' : 'default',
              textAlign: 'left',
              boxShadow: customItems.length > 0 ? '0 4px 20px rgba(31,92,58,0.12)' : 'none',
              transition: 'all 0.15s',
            }}
          >
            <div style={{ fontSize: 22, color: customItems.length > 0 ? '#1F5C3A' : '#C8C3BC', marginBottom: 10, lineHeight: 1 }}>✦</div>
            <div style={{ fontFamily: 'var(--font-manrope), sans-serif', fontWeight: 700, fontSize: 14, color: '#0B1E12', marginBottom: 4 }}>
              Generated
            </div>
            <div style={{ fontFamily: 'var(--font-manrope), sans-serif', fontSize: 12, color: '#8CA090', marginBottom: 14 }}>
              {customItems.length > 0 ? 'AI-generated custom list' : 'Upload or generate'}
            </div>
            <div style={{ fontFamily: 'var(--font-fraunces), serif', fontWeight: 700, fontSize: 38, color: customItems.length > 0 ? '#0B1E12' : '#C8C3BC', lineHeight: 1, marginBottom: 2 }}>
              {customLoaded && customItems.length > 0 ? customItems.length : '—'}
            </div>
            <div style={{ ...eyebrowLabel, color: customItems.length > 0 ? '#4A5A50' : '#C8C3BC' }}>items saved</div>
          </button>
        </div>

        {/* ── Drill Breakdown ─────────────────────────────────────── */}
        <div style={{
          background: 'white',
          border: '1px solid #E2DDD8',
          borderRadius: 14,
          overflow: 'hidden',
          boxShadow: '0 1px 4px rgba(0,0,0,.06)',
          marginBottom: 48,
        }}>
          <div style={{ padding: '14px 24px', borderBottom: '1px solid #F0EDE8', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ ...cardLabel }}>Drill Breakdown</span>
            <div style={{ display: 'flex', gap: 16 }}>
              {(['sentence', 'vocab', 'phrase'] as const).map(cat => (
                <span key={cat} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: 'var(--font-jetbrains), monospace', fontSize: 9, color: CAT_COLOR[cat], letterSpacing: '0.07em', textTransform: 'uppercase' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: CAT_COLOR[cat], flexShrink: 0 }} />
                  {cat}
                </span>
              ))}
            </div>
          </div>

          {LANGS.map((lang, i) => {
            const langDb = getDB(lang)
            const counts = countByCategory(langDb)
            const total = langDb.length
            const { name: langName, flag: langFlag } = LANGUAGES[lang]
            const isActive = activeLang === lang
            return (
              <div
                key={lang}
                onClick={() => setActiveLang(lang)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 16,
                  padding: '13px 24px',
                  borderBottom: i < LANGS.length - 1 ? '1px solid #F0EDE8' : 'none',
                  cursor: 'pointer',
                  opacity: isActive ? 1 : 0.4,
                  background: isActive ? '#FAFAF8' : 'transparent',
                  transition: 'opacity 0.15s, background 0.15s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: 130, flexShrink: 0 }}>
                  <span style={{ fontSize: 16 }}>{langFlag}</span>
                  <span style={{ fontFamily: 'var(--font-manrope), sans-serif', fontWeight: 600, fontSize: 13, color: '#0B1E12' }}>{langName}</span>
                </div>
                {/* Stacked bar */}
                <div style={{ flex: 1, display: 'flex', height: 6, gap: 2, borderRadius: 3, overflow: 'hidden' }}>
                  {(['sentence', 'vocab', 'phrase'] as const).map(cat => {
                    const cnt = counts[cat] ?? 0
                    if (!cnt) return null
                    return <div key={cat} style={{ flex: cnt, background: CAT_COLOR[cat] }} />
                  })}
                </div>
                {/* Counts */}
                <div style={{ display: 'flex', gap: 12, flexShrink: 0 }}>
                  {(['sentence', 'vocab', 'phrase'] as const).map(cat => (
                    <span key={cat} style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 11, color: CAT_COLOR[cat] }}>
                      {counts[cat] ?? 0}<span style={{ fontSize: 9, opacity: 0.65 }}>{cat === 'sentence' ? 'S' : cat === 'vocab' ? 'V' : 'P'}</span>
                    </span>
                  ))}
                </div>
                {/* Playfair total */}
                <div style={{ fontFamily: 'var(--font-fraunces), serif', fontWeight: 700, fontSize: 22, color: '#0B1E12', width: 44, textAlign: 'right', flexShrink: 0 }}>
                  {total}
                </div>
              </div>
            )
          })}
        </div>

        {/* ── Register book reading view ───────────────────────────── */}
        <div style={{
          background: 'white',
          border: '1px solid #E2DDD8',
          borderRadius: 14,
          boxShadow: '0 1px 4px rgba(0,0,0,.06)',
        }}>
          {/* Book hero + search */}
          <div style={{ padding: '32px 32px 24px', borderBottom: '1px solid #E2DDD8' }}>
            <div style={{ ...eyebrowLabel, marginBottom: 10 }}>
              BROWSE {flag} {name.toUpperCase()}
            </div>
            <h2 style={{
              fontFamily: 'var(--font-fraunces), serif',
              fontWeight: 700,
              fontSize: 'clamp(1.5rem, 3vw, 2rem)',
              color: '#0B1E12',
              lineHeight: 1.1,
              margin: '0 0 20px',
            }}>
              The {name} <em style={{ fontStyle: 'italic', color: '#1F5C3A' }}>register</em> book.
            </h2>
            <input
              type="text"
              placeholder="Search prompts and answers…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                maxWidth: 480,
                fontFamily: 'var(--font-jetbrains), monospace',
                fontSize: 13,
                color: '#0B1E12',
                background: '#F7F6F3',
                border: '1px solid #E2DDD8',
                borderRadius: 8,
                padding: '10px 14px',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Two-pane */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px' }}>

            {/* ── Main reading pane ── */}
            <div style={{ borderRight: '1px solid #E2DDD8', minWidth: 0 }}>
              {filteredGroups.length === 0 && (
                <div style={{ padding: '64px 28px', textAlign: 'center', fontFamily: 'var(--font-manrope), sans-serif', fontSize: 14, color: '#8CA090' }}>
                  No results for &ldquo;{searchQuery}&rdquo;
                </div>
              )}

              {/* ── Custom / Generated section ── */}
              {customLoaded && customItems.length > 0 && (
                <div ref={el => { chapterRefs.current['custom'] = el }}>
                  <div style={{
                    position: 'sticky', top: 60, zIndex: 10,
                    background: '#F2F0EC', borderBottom: '1px solid #E2DDD8',
                    padding: '9px 28px', display: 'flex', alignItems: 'center', gap: 8,
                  }}>
                    <span style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 10, color: '#8CA090' }}>✦</span>
                    <span style={{ fontFamily: 'var(--font-manrope), sans-serif', fontWeight: 700, fontSize: 11, letterSpacing: '0.09em', textTransform: 'uppercase', color: '#4A5A50' }}>
                      Generated · Custom
                    </span>
                    <span style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 10, color: '#8CA090', marginLeft: 2 }}>
                      {customItems.length}
                    </span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '56px 1fr 1fr', padding: '8px 28px', borderBottom: '1px solid #F0EDE8', background: '#FAFAF8' }}>
                    <span style={{ ...colLabel }}>TYPE</span>
                    <span style={{ ...colLabel }}>PROMPT</span>
                    <span style={{ ...colLabel }}>TARGET</span>
                  </div>
                  {customItems.map((item, ii) => (
                    <div key={item.id ?? ii} style={{
                      display: 'grid', gridTemplateColumns: '56px 1fr 1fr',
                      padding: '13px 28px', borderBottom: '1px solid #F0EDE8', alignItems: 'start',
                    }}>
                      <span style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 9, color: '#8CA090', paddingTop: 3, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                        {item.type ?? 'custom'}
                      </span>
                      <div style={{ paddingRight: 20 }}>
                        <div style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 13, color: '#4A5A50', lineHeight: 1.55 }}>
                          <PromptWithCues text={item.prompt} />
                        </div>
                        <div style={{ fontFamily: 'var(--font-manrope), sans-serif', fontSize: 10, color: '#8CA090', marginTop: 3 }}>
                          {item.instruction}
                        </div>
                      </div>
                      <div>
                        <span style={{
                          fontFamily: 'var(--font-fraunces), serif', fontStyle: 'italic',
                          fontWeight: 600, fontSize: 15, color: '#0B1E12', lineHeight: 1.6,
                          background: 'linear-gradient(180deg, transparent 58%, #B8E0C2 58%, #B8E0C2 92%, transparent 92%)',
                          display: 'inline',
                        }}>
                          {item.answer}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {filteredGroups.map((group, gi) => (
                <div
                  key={group.topic}
                  ref={el => { chapterRefs.current[group.topic] = el }}
                >
                  {/* Chapter sticky header */}
                  <div style={{
                    position: 'sticky',
                    top: 60,
                    zIndex: 10,
                    background: '#F2F0EC',
                    borderBottom: '1px solid #E2DDD8',
                    padding: '9px 28px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}>
                    <span style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 10, color: '#8CA090' }}>§{gi + 1}</span>
                    <span style={{ fontSize: 13 }}>{TOPICS[group.topic].icon}</span>
                    <span style={{ fontFamily: 'var(--font-manrope), sans-serif', fontWeight: 700, fontSize: 11, letterSpacing: '0.09em', textTransform: 'uppercase', color: '#4A5A50' }}>
                      {TOPICS[group.topic].label}
                    </span>
                    <span style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 10, color: '#8CA090', marginLeft: 2 }}>
                      {group.items.length}
                    </span>
                  </div>

                  {/* Column headers */}
                  <div style={{ display: 'grid', gridTemplateColumns: '56px 1fr 1fr', padding: '8px 28px', borderBottom: '1px solid #F0EDE8', background: '#FAFAF8' }}>
                    <span style={{ ...colLabel }}>REF</span>
                    <span style={{ ...colLabel }}>PROMPT</span>
                    <span style={{ ...colLabel }}>TARGET</span>
                  </div>

                  {/* Rows */}
                  {group.items.map((item, ii) => (
                    <div
                      key={item.id}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '56px 1fr 1fr',
                        padding: '13px 28px',
                        borderBottom: '1px solid #F0EDE8',
                        alignItems: 'start',
                      }}
                    >
                      {/* §ref */}
                      <span style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 10, color: '#8CA090', paddingTop: 3 }}>
                        §{gi + 1}.{String(ii + 1).padStart(2, '0')}
                      </span>

                      {/* Prompt */}
                      <div style={{ paddingRight: 20 }}>
                        <div style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 13, color: '#4A5A50', lineHeight: 1.55 }}>
                          <PromptWithCues text={item.prompt} />
                        </div>
                        <div style={{ fontFamily: 'var(--font-manrope), sans-serif', fontSize: 10, color: '#8CA090', marginTop: 3 }}>
                          {item.instruction}
                        </div>
                      </div>

                      {/* Target */}
                      <div>
                        <div>
                          <span style={{
                            fontFamily: 'var(--font-fraunces), serif',
                            fontStyle: 'italic',
                            fontWeight: 600,
                            fontSize: 15,
                            color: '#0B1E12',
                            lineHeight: 1.6,
                            background: 'linear-gradient(180deg, transparent 58%, #B8E0C2 58%, #B8E0C2 92%, transparent 92%)',
                            display: 'inline',
                          }}>
                            {item.answer}
                          </span>
                        </div>
                        {item.variants && item.variants.length > 0 && (
                          <div style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 10, color: '#8CA090', marginTop: 4 }}>
                            also: {item.variants.join(' · ')}
                          </div>
                        )}
                        <div style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 9, color: CAT_COLOR[item.category ?? 'sentence'], marginTop: 4, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                          {item.category ?? 'sentence'}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>

            {/* ── Sidebar ── */}
            <div style={{ alignSelf: 'start', position: 'sticky', top: 60, padding: '24px 20px' }}>
              <div style={{ ...cardLabel, marginBottom: 12 }}>CHAPTERS</div>
              <div style={{ border: '1px solid #E2DDD8', borderRadius: 10, overflow: 'hidden', background: 'white' }}>
                {customLoaded && customItems.length > 0 && (
                  <button
                    onClick={() => {
                      const el = chapterRefs.current['custom']
                      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
                    }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                      padding: '10px 14px', background: 'none', border: 'none',
                      borderBottom: filteredGroups.length > 0 ? '1px dashed #E2DDD8' : 'none',
                      cursor: 'pointer', textAlign: 'left',
                    }}
                  >
                    <span style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 9, color: '#8CA090', width: 22, flexShrink: 0 }}>✦</span>
                    <span style={{ fontFamily: 'var(--font-manrope), sans-serif', fontSize: 12, fontWeight: 500, color: '#4A5A50', flex: 1 }}>Generated</span>
                    <span style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 9, color: '#8CA090', flexShrink: 0 }}>{customItems.length}</span>
                  </button>
                )}
                {filteredGroups.map((group, gi) => (
                  <button
                    key={group.topic}
                    onClick={() => {
                      const el = chapterRefs.current[group.topic]
                      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      width: '100%',
                      padding: '10px 14px',
                      background: 'none',
                      border: 'none',
                      borderBottom: gi < filteredGroups.length - 1 ? '1px dashed #E2DDD8' : 'none',
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <span style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 9, color: '#8CA090', width: 22, flexShrink: 0 }}>§{gi + 1}</span>
                    <span style={{ fontSize: 12 }}>{TOPICS[group.topic].icon}</span>
                    <span style={{ fontFamily: 'var(--font-manrope), sans-serif', fontSize: 12, fontWeight: 500, color: '#4A5A50', flex: 1 }}>
                      {TOPICS[group.topic].label}
                    </span>
                    <span style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 9, color: '#8CA090', flexShrink: 0 }}>
                      {group.items.length}
                    </span>
                  </button>
                ))}
              </div>
              <Link
                href="/drill"
                className="btn-primary"
                style={{ display: 'block', textAlign: 'center', marginTop: 16, textDecoration: 'none' }}
              >
                Use full list →
              </Link>
            </div>

          </div>
        </div>

      </div>
    </div>
  )
}
