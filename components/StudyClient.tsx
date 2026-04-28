'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import type { Language, DrillTopic, DrillItem } from '@/lib/drills'
import { LANGUAGES, TOPICS, getDB, shuffle } from '@/lib/drills'
import { ignoreClientAuthExpiredError, loadLanguage, readLanguageSync } from '@/lib/stats'
import { getClientAuthenticatedUser } from '@/lib/clientAuth'

// BCP-47 codes for Web Speech API
const SPEECH_LANG: Record<Language, string> = {
  es: 'es-ES', fr: 'fr-FR', de: 'de-DE',
  zh: 'zh-CN', ja: 'ja-JP', ko: 'ko-KR', en: 'en-US',
}

const SPEED_PRESETS = [0.5, 0.75, 1, 1.25, 1.5] as const
type SpeechRate = typeof SPEED_PRESETS[number]

function speak(text: string, lang: string, rate: SpeechRate = 1) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
  window.speechSynthesis.cancel()
  const utt = new SpeechSynthesisUtterance(text)
  utt.lang = lang
  utt.rate = rate
  window.speechSynthesis.speak(utt)
}

const FONT_CJK = '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Microsoft YaHei", "Noto Sans JP", "Hiragino Kaku Gothic Pro", "Malgun Gothic", sans-serif'

const RANDOM_PRESETS = [10, 25, 50]

type Phase = 'select' | 'study'

type StudyAction = 'explain_card' | 'show_similar_examples' | 'what_contrast_is_this' | 'freeform_help'

interface StudyAssistResult {
  assistantMessage: string
  retrievalHit: boolean
  retrievedSources: { id: string; title: string }[]
  similarExamples: { text: string; sourceItemId: string }[] | null
  elapsedMs: number
  responseId: string | null
  model: string
}

type StudyFeedbackStatus = 'idle' | 'pending' | 'saved' | 'error'
type StudyFeedbackState = { status: StudyFeedbackStatus; err?: string }

async function submitStudyFeedback(payload: {
  responseId: string
  surface: 'study'
  mode: string
  helpful: boolean
  language: string
  itemId: string
  source: { id: string; title: string }
  userPrompt: string | null
  assistantMessage: string
  model: string
}): Promise<void> {
  const res = await fetch('/api/ai-feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`)
  }
}

async function callStudyAssist(
  action: StudyAction,
  language: Language,
  card: DrillItem,
  question?: string,
): Promise<StudyAssistResult> {
  const res = await fetch('/api/study-assist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action,
      language: language === 'en' ? 'English' : language,
      question: question ?? null,
      currentItem: {
        id:          card.id,
        type:        card.type,
        category:    card.category ?? null,
        topic:       card.topic    ?? null,
        instruction: card.instruction,
        prompt:      card.prompt,
        answer:      card.answer,
        variants:    card.variants ?? [],
      },
    }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`)
  }
  return res.json()
}

// Render prompt text, wrapping [bracketed] cue words with a gold tint
function PromptWithCues({ text, large }: { text: string; large?: boolean }) {
  const parts = text.split(/(\[[^\]]+\])/)
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('[') && part.endsWith(']')) {
          return (
            <span
              key={i}
              style={{
                background: '#FFF3D9',
                color: '#B06528',
                padding: large ? '1px 6px' : '0 3px',
                borderRadius: 4,
                fontStyle: 'normal',
                fontSize: large ? '1.05em' : 'inherit',
              }}
            >
              {part.slice(1, -1)}
            </span>
          )
        }
        return <span key={i}>{part}</span>
      })}
    </>
  )
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function StudyClient() {
  const [language,     setLanguage]     = useState<Language>(readLanguageSync)
  const [topic,        setTopic]        = useState<DrillTopic | null>(null)
  const [selectedIds,  setSelectedIds]  = useState<Set<string>>(new Set())
  const [activeItemId, setActiveItemId] = useState<string | null>(null)
  const [phase,        setPhase]        = useState<Phase>('select')
  const [isShuffled,   setIsShuffled]   = useState(false)
  const [showHighlight, setShowHighlight] = useState(true)

  // Flashcard state
  const [deck,       setDeck]      = useState<DrillItem[]>([])
  const [index,      setIndex]     = useState(0)
  const [flipped,    setFlipped]   = useState(false)
  const [autoPlay,   setAutoPlay]  = useState(false)
  const [speechRate, setSpeechRate] = useState<SpeechRate>(1)

  // Study assist state
  const [assistLoading,      setAssistLoading]      = useState(false)
  const [assistResult,       setAssistResult]       = useState<StudyAssistResult | null>(null)
  const [assistError,        setAssistError]        = useState<string | null>(null)
  const [freeformInput,      setFreeformInput]      = useState('')
  const [lastFreeformQ,      setLastFreeformQ]      = useState<string | null>(null)
  const [lastAssistAction,   setLastAssistAction]   = useState<StudyAction | null>(null)
  const [studyFeedbackState, setStudyFeedbackState] = useState<StudyFeedbackState>({ status: 'idle' })

  useEffect(() => {
    loadLanguage().then(setLanguage).catch(ignoreClientAuthExpiredError)
  }, [])

  const allItems = useMemo(() => getDB(language), [language])

  const filteredItems = useMemo(() => {
    if (topic) return allItems.filter(d => d.topic === topic)
    return allItems
  }, [allItems, topic])

  // Group filtered items by topic, preserving encounter order
  const grouped = useMemo(() => {
    const seen = new Map<string, { topic: DrillTopic | null; label: string; icon: string; items: DrillItem[] }>()
    for (const item of filteredItems) {
      const key = item.topic ?? '__none__'
      if (!seen.has(key)) {
        const info = item.topic ? TOPICS[item.topic] : null
        seen.set(key, { topic: item.topic ?? null, label: info?.label ?? 'General', icon: info?.icon ?? '', items: [] })
      }
      seen.get(key)!.items.push(item)
    }
    return Array.from(seen.values())
  }, [filteredItems])

  // Per-topic counts across ALL items (for filter chip badges)
  const topicCounts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const item of allItems) {
      const key = item.topic ?? '__none__'
      c[key] = (c[key] ?? 0) + 1
    }
    return c
  }, [allItems])

  const topicsWithItems = useMemo(
    () => Object.keys(TOPICS).filter(t => (topicCounts[t] ?? 0) > 0) as DrillTopic[],
    [topicCounts]
  )

  const activeItem = activeItemId ? (allItems.find(d => d.id === activeItemId) ?? null) : null

  // ── Selection helpers ──────────────────────────────────────────────────────

  const toggleItem = (id: string) =>
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })

  const selectAll  = () => setSelectedIds(new Set(filteredItems.map(d => d.id)))
  const clearAll   = () => setSelectedIds(new Set())
  const pickRandom = (n: number) => setSelectedIds(new Set(shuffle([...filteredItems]).slice(0, n).map(d => d.id)))

  // ── Start study ────────────────────────────────────────────────────────────

  const startStudy = useCallback((overrideDeck?: DrillItem[]) => {
    const ordered = overrideDeck ?? allItems.filter(d => selectedIds.has(d.id))
    const finalDeck = isShuffled ? shuffle([...ordered]) : ordered
    setDeck(finalDeck)
    setIndex(0)
    setFlipped(false)
    setPhase('study')
  }, [allItems, selectedIds, isShuffled])

  // ── Flashcard navigation ───────────────────────────────────────────────────

  const navigate = useCallback((newIndex: number) => {
    setFlipped(false)
    setIndex(newIndex)
    setAssistResult(null)
    setAssistError(null)
    setFreeformInput('')
    setLastFreeformQ(null)
    setLastAssistAction(null)
    setStudyFeedbackState({ status: 'idle' })
  }, [])
  const goNext   = useCallback(() => navigate(Math.min(index + 1, deck.length - 1)), [navigate, index, deck.length])
  const goPrev   = useCallback(() => navigate(Math.max(index - 1, 0)),               [navigate, index])

  useEffect(() => {
    if (phase !== 'study') return
    const handler = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return
      if (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); setFlipped(f => !f) }
      if (e.key === 'ArrowRight') goNext()
      if (e.key === 'ArrowLeft')  goPrev()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [phase, goNext, goPrev])

  useEffect(() => {
    if (phase !== 'study' || !autoPlay || !flipped) return
    const card = deck[index]
    if (card) speak(card.answer, SPEECH_LANG[language], speechRate)
  }, [flipped, autoPlay, phase, deck, index, language, speechRate])

  const card = deck[index]

  // ─────────────────────────────────────────────────────────────────────────
  // SELECT PHASE
  // ─────────────────────────────────────────────────────────────────────────

  if (phase === 'select') {
    const allFilteredSelected = filteredItems.length > 0 && filteredItems.every(d => selectedIds.has(d.id))

    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>

        {/* ── Hero + filters ─────────────────────────────────────── */}
        <div style={{ borderBottom: '1px solid #E2DDD8', background: 'var(--bg)' }}>
          <div style={{ maxWidth: 1280, margin: '0 auto', padding: '56px 32px 32px' }}>

            {/* Eyebrow */}
            <div style={{ fontFamily: 'var(--font-manrope), sans-serif', fontWeight: 700, fontSize: 11, letterSpacing: '1.2px', textTransform: 'uppercase', color: '#8CA090', marginBottom: 12 }}>
              Flashcard Review · Select Cards
            </div>

            {/* Title row */}
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 32 }}>
              <h1 style={{ fontFamily: 'var(--font-fraunces), serif', fontSize: 'clamp(2.25rem, 4vw, 3rem)', lineHeight: 1.1, color: '#0B1E12', letterSpacing: '-0.02em', margin: 0 }}>
                <span style={{ fontWeight: 700 }}>{LANGUAGES[language].native} </span>
                <span style={{ fontWeight: 700, fontStyle: 'italic', color: '#1F5C3A' }}>essentials.</span>
              </h1>
              <div style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 11, color: '#8CA090', paddingBottom: 8 }}>
                {filteredItems.length} drills · {selectedIds.size} selected
              </div>
            </div>

            {/* Topic filter chips */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', rowGap: 10 }}>
              <button
                onClick={() => setTopic(null)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  padding: '8px 16px', borderRadius: 20,
                  background: topic === null ? '#0B1E12' : 'white',
                  border: topic === null ? 'none' : '1px solid #E2DDD8',
                  color: topic === null ? 'white' : '#4A5A50',
                  fontFamily: 'var(--font-manrope), sans-serif', fontSize: 13,
                  fontWeight: topic === null ? 700 : 500, cursor: 'pointer',
                }}
              >
                ALL
                <span style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 11, opacity: 0.65 }}>
                  {allItems.length}
                </span>
              </button>
              {topicsWithItems.map(t => {
                const info = TOPICS[t]
                const count = topicCounts[t] ?? 0
                const active = topic === t
                return (
                  <button
                    key={t}
                    onClick={() => setTopic(active ? null : t)}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                      padding: '6px 14px', borderRadius: 20,
                      background: active ? '#0B1E12' : 'white',
                      border: active ? 'none' : '1px solid #E2DDD8',
                      color: active ? 'white' : '#4A5A50',
                      fontFamily: 'var(--font-manrope), sans-serif', fontSize: 13,
                      fontWeight: active ? 700 : 500, cursor: 'pointer',
                    }}
                  >
                    <span style={{ fontSize: '0.8125rem' }}>{info.icon}</span>
                    {info.label}
                    <span style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 11, opacity: 0.65 }}>{count}</span>
                  </button>
                )
              })}
            </div>

          </div>
        </div>

        {/* ── Two-pane body ──────────────────────────────────────── */}
        <div style={{ flex: 1 }}>
          <div
            style={{
              maxWidth: 1280, margin: '0 auto',
              padding: '24px 32px 120px',
              display: 'grid',
              gridTemplateColumns: '1fr 380px',
              gap: 28,
              alignItems: 'start',
            }}
          >

            {/* ── Left: drill list ──────────────────────────────── */}
            <div>
              {/* Selection controls */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                <span style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#8CA090', marginRight: 4 }}>
                  Random
                </span>
                {RANDOM_PRESETS.map(n => (
                  <button
                    key={n}
                    onClick={() => pickRandom(n)}
                    disabled={filteredItems.length === 0}
                    style={{ padding: '5px 14px', borderRadius: 6, border: '1px solid #E2DDD8', background: 'white', fontFamily: 'var(--font-jetbrains), monospace', fontSize: 12, color: '#0B1E12', cursor: 'pointer', opacity: filteredItems.length === 0 ? 0.4 : 1 }}
                  >
                    {n}
                  </button>
                ))}
                <button
                  onClick={() => pickRandom(filteredItems.length)}
                  disabled={filteredItems.length === 0}
                  style={{ padding: '5px 14px', borderRadius: 6, border: '1px solid #E2DDD8', background: 'white', fontFamily: 'var(--font-jetbrains), monospace', fontSize: 12, color: '#0B1E12', cursor: 'pointer', opacity: filteredItems.length === 0 ? 0.4 : 1 }}
                >
                  All ({filteredItems.length})
                </button>
                <div style={{ flex: 1 }} />
                <button
                  onClick={allFilteredSelected ? clearAll : selectAll}
                  style={{ padding: '5px 14px', borderRadius: 6, border: '1px solid #E2DDD8', background: 'white', fontFamily: 'var(--font-manrope), sans-serif', fontSize: 13, fontWeight: 500, color: '#0B1E12', cursor: 'pointer' }}
                >
                  {allFilteredSelected ? 'Deselect all' : 'Select all'}
                </button>
              </div>

              {/* Counter */}
              <div style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 11, color: '#8CA090', marginBottom: 14 }}>
                {filteredItems.length} items · {selectedIds.size} selected
              </div>

              {/* Grouped list */}
              {grouped.length === 0 ? (
                <div style={{ padding: '40px 24px', textAlign: 'center', fontFamily: 'var(--font-jetbrains), monospace', fontSize: 12, color: '#8CA090', border: '1px solid #E2DDD8', borderRadius: 12, background: 'white' }}>
                  No items match the selected filters.
                </div>
              ) : (
                <div style={{ border: '1px solid #E2DDD8', borderRadius: 12, overflow: 'hidden', background: 'white' }}>
                  {grouped.map((group, gi) => (
                    <div key={group.topic ?? '__none__'}>
                      {/* Group header */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 20px', background: '#F7F6F3', borderTop: gi > 0 ? '1px solid #E2DDD8' : 'none', borderBottom: '1px solid #E2DDD8' }}>
                        <span style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 10, color: '#8CA090', width: 18, flexShrink: 0 }}>
                          {String(gi + 1).padStart(2, '0')}
                        </span>
                        <span style={{ fontFamily: 'var(--font-manrope), sans-serif', fontWeight: 700, fontSize: 11, letterSpacing: '1px', textTransform: 'uppercase', color: '#4A5A50' }}>
                          {group.icon} {group.label}
                        </span>
                        <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-jetbrains), monospace', fontSize: 10, color: '#8CA090' }}>
                          {group.items.length}
                        </span>
                      </div>

                      {/* Item rows */}
                      {group.items.map((item, ii) => {
                        const checked = selectedIds.has(item.id)
                        const isActive = activeItemId === item.id
                        return (
                          <div
                            key={item.id}
                            onClick={() => setActiveItemId(item.id)}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 14,
                              padding: '12px 20px',
                              borderBottom: ii < group.items.length - 1 ? '1px solid #F0EDE8' : 'none',
                              background: isActive ? '#FAF7F0' : 'white',
                              borderLeft: isActive ? '3px solid #1F5C3A' : '3px solid transparent',
                              cursor: 'pointer',
                              transition: 'background 0.1s',
                            }}
                          >
                            {/* Serial number */}
                            <span style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 10, color: '#8CA090', width: 36, flexShrink: 0 }}>
                              §{gi + 1}.{String(ii + 1).padStart(2, '0')}
                            </span>

                            {/* Prompt + answer */}
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{
                                fontFamily: isActive ? 'var(--font-fraunces), serif' : 'var(--font-manrope), sans-serif',
                                fontStyle: isActive ? 'italic' : 'normal',
                                fontSize: 14, color: '#0B1E12', lineHeight: 1.4,
                                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                marginBottom: 2,
                              }}>
                                {item.prompt}
                              </div>
                              <div style={{ fontFamily: 'var(--font-fraunces), serif', fontStyle: 'italic', fontWeight: 700, fontSize: 13, color: '#1F5C3A', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {item.answer}
                              </div>
                            </div>

                            {/* Checkbox */}
                            <div
                              onClick={e => { e.stopPropagation(); toggleItem(item.id) }}
                              style={{
                                width: 18, height: 18, borderRadius: 4, flexShrink: 0,
                                border: checked ? 'none' : '1.5px solid #D4CFC4',
                                background: checked ? '#1F5C3A' : 'transparent',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                cursor: 'pointer',
                              }}
                            >
                              {checked && (
                                <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                                  <path d="M2 5.5l2.5 2.5L9 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ── Right: detail panel (sticky) ─────────────────── */}
            <div style={{ position: 'sticky', top: 76 }}>
              {activeItem ? (
                <div style={{ background: 'white', border: '1px solid #E2DDD8', borderRadius: 14, padding: 28, boxShadow: '0 2px 12px rgba(0,0,0,0.05)' }}>

                  {/* Metadata header */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, paddingBottom: 18, marginBottom: 20, borderBottom: '1px solid #F0EDE8' }}>
                    {[
                      { label: 'ID', value: `#${activeItem.id.slice(-3).toUpperCase()}` },
                      { label: 'TOPIC', value: activeItem.topic ? (TOPICS[activeItem.topic]?.label ?? '—') : '—' },
                      { label: 'MODE', value: activeItem.type },
                      { label: 'ALTS', value: String(activeItem.variants?.length ?? 0) },
                    ].map(({ label, value }) => (
                      <div key={label}>
                        <div style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#8CA090', marginBottom: 4 }}>
                          {label}
                        </div>
                        <div style={{ fontFamily: 'var(--font-manrope), sans-serif', fontSize: 12, fontWeight: 500, color: '#0B1E12', textTransform: label === 'MODE' ? 'capitalize' : undefined }}>
                          {value}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Prompt */}
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontFamily: 'var(--font-manrope), sans-serif', fontWeight: 700, fontSize: 9, letterSpacing: '1px', textTransform: 'uppercase', color: '#8CA090', marginBottom: 10 }}>
                      Prompt
                    </div>
                    <div style={{ fontFamily: 'var(--font-fraunces), serif', fontStyle: 'italic', fontSize: 20, color: '#0B1E12', lineHeight: 1.4 }}>
                      <PromptWithCues text={activeItem.prompt} large />
                    </div>
                  </div>

                  {/* Arrow */}
                  <div style={{ fontSize: 28, color: '#8CA090', margin: '16px 0', lineHeight: 1 }}>→</div>

                  {/* Answer */}
                  <div style={{ marginBottom: activeItem.variants?.length ? 16 : 24 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                      <div style={{ fontFamily: 'var(--font-manrope), sans-serif', fontWeight: 700, fontSize: 9, letterSpacing: '1px', textTransform: 'uppercase', color: '#8CA090' }}>
                        Target
                      </div>
                      <button
                        onClick={() => setShowHighlight(h => !h)}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 5,
                          fontFamily: 'var(--font-jetbrains), monospace', fontSize: 9,
                          letterSpacing: '0.06em', textTransform: 'uppercase',
                          color: showHighlight ? '#2E7D52' : '#8CA090',
                          background: showHighlight ? 'rgba(184,224,194,0.3)' : 'transparent',
                          border: `1px solid ${showHighlight ? '#B8E0C2' : '#E2DDD8'}`,
                          borderRadius: 4, padding: '2px 7px', cursor: 'pointer',
                        }}
                      >
                        <span style={{ fontSize: 8 }}>■</span>
                        {showHighlight ? 'Highlight on' : 'No highlight'}
                      </button>
                    </div>
                    <div style={{ fontFamily: FONT_CJK, fontStyle: 'italic', fontWeight: 700, fontSize: 'clamp(1.75rem, 3vw, 2.5rem)', color: '#0B1E12', lineHeight: 1.15 }}>
                      <span style={{
                        background: showHighlight ? 'linear-gradient(180deg, transparent 58%, #B8E0C2 58%, #B8E0C2 92%, transparent 92%)' : 'none',
                        display: 'inline', fontFamily: 'var(--font-fraunces), serif',
                      }}>
                        {activeItem.answer}
                      </span>
                    </div>
                  </div>

                  {/* Alts */}
                  {activeItem.variants && activeItem.variants.length > 0 && (
                    <div style={{ marginBottom: 20 }}>
                      <span style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 10, color: '#8CA090', letterSpacing: '0.06em', textTransform: 'uppercase', marginRight: 8 }}>
                        Also
                      </span>
                      {activeItem.variants.map((v, i) => (
                        <span key={i} style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 11, color: '#4A5A50' }}>
                          {v}{i < activeItem.variants!.length - 1 ? ' · ' : ''}
                        </span>
                      ))}
                    </div>
                  )}

                  <div style={{ borderTop: '1px solid #F0EDE8', marginBottom: 16 }} />

                  {/* Action buttons */}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => toggleItem(activeItem.id)}
                      style={{
                        flex: 1, padding: '9px 0', borderRadius: 8, border: 'none',
                        background: selectedIds.has(activeItem.id) ? '#1F5C3A' : '#0B1E12',
                        color: 'white', fontFamily: 'var(--font-manrope), sans-serif',
                        fontSize: 13, fontWeight: 600, cursor: 'pointer',
                      }}
                    >
                      {selectedIds.has(activeItem.id) ? '✓ In session' : '+ Add to session'}
                    </button>
                    <button
                      onClick={() => startStudy([activeItem])}
                      style={{
                        flex: 1, padding: '9px 0', borderRadius: 8,
                        border: '1px solid #E2DDD8', background: 'white',
                        fontFamily: 'var(--font-manrope), sans-serif',
                        fontSize: 13, fontWeight: 500, color: '#4A5A50', cursor: 'pointer',
                      }}
                    >
                      Practice this one
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ background: 'white', border: '1px solid #E2DDD8', borderRadius: 14, padding: '48px 28px', boxShadow: '0 2px 12px rgba(0,0,0,0.05)', textAlign: 'center' }}>
                  <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#EAF3ED', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                    <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="#1F5C3A" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <div style={{ fontFamily: 'var(--font-fraunces), serif', fontWeight: 700, fontStyle: 'italic', fontSize: '1.25rem', color: '#0B1E12', marginBottom: 8 }}>
                    Select an item
                  </div>
                  <div style={{ fontFamily: 'var(--font-manrope), sans-serif', fontSize: 13, color: '#8CA090', lineHeight: 1.6 }}>
                    Click any drill to preview it here.
                  </div>
                </div>
              )}
            </div>

          </div>
        </div>

        {/* ── Sticky bottom bar ─────────────────────────────────── */}
        {selectedIds.size > 0 && (
          <div style={{
            position: 'fixed', bottom: 0, left: 0, right: 0,
            background: '#0B1E12',
            borderTop: '1px solid rgba(255,255,255,0.08)',
            padding: '14px 32px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            zIndex: 40,
            boxShadow: '0 -4px 24px rgba(0,0,0,0.2)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontFamily: 'var(--font-manrope), sans-serif', fontSize: 14, color: 'rgba(255,255,255,0.9)' }}>
                {selectedIds.size} drill{selectedIds.size !== 1 ? 's' : ''} selected
              </span>
              <span style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
                · estimated ~{selectedIds.size * 20}s session
              </span>
              <button
                onClick={() => setIsShuffled(s => !s)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 6,
                  border: `1px solid ${isShuffled ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.12)'}`,
                  background: isShuffled ? 'rgba(255,255,255,0.1)' : 'transparent',
                  color: isShuffled ? 'white' : 'rgba(255,255,255,0.4)',
                  fontFamily: 'var(--font-manrope), sans-serif', fontSize: 12,
                  fontWeight: isShuffled ? 600 : 400, cursor: 'pointer',
                }}
              >
                ⇄ {isShuffled ? 'Shuffled' : 'Shuffle'}
              </button>
            </div>
            <button
              onClick={() => startStudy()}
              style={{
                background: '#1F5C3A', color: 'white',
                fontFamily: 'var(--font-manrope), sans-serif', fontSize: 14, fontWeight: 600,
                padding: '10px 24px', borderRadius: 8, border: 'none',
                cursor: 'pointer', boxShadow: '0 2px 10px rgba(31,92,58,0.4)',
              }}
            >
              Use {selectedIds.size} in session →
            </button>
          </div>
        )}

      </div>
    )
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STUDY PHASE (flashcards)
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <>
      <style>{`
        .study-scene  { perspective: 1200px; }
        .study-inner  {
          position: relative; width: 100%; height: 100%;
          transform-style: preserve-3d;
          transition: transform 0.4s cubic-bezier(0.4, 0, 0.2, 1);
          cursor: pointer;
        }
        .study-inner.flipped { transform: rotateY(180deg); }
        .study-face {
          position: absolute; inset: 0;
          backface-visibility: hidden; -webkit-backface-visibility: hidden;
          display: flex; flex-direction: column;
          justify-content: center; align-items: center;
          padding: 40px; border-radius: 8px;
        }
        .study-back { transform: rotateY(180deg); }
      `}</style>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 'calc(100vh - 60px)' }}>

        {/* Study header */}
        <div style={{ borderBottom: '1px solid #E2DDD8', background: 'var(--bg)' }}>
          <div style={{ maxWidth: 800, margin: '0 auto', padding: '16px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <button
              onClick={() => setPhase('select')}
              style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'transparent', border: 'none', fontFamily: 'var(--font-manrope), sans-serif', fontSize: '0.875rem', color: '#4A5A50', cursor: 'pointer', padding: '4px 0' }}
            >
              ← Back to selection
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button
                onClick={() => setAutoPlay(a => !a)}
                title={autoPlay ? 'Auto-play on' : 'Auto-play off'}
                style={{ display: 'flex', alignItems: 'center', gap: 5, background: autoPlay ? '#0B1E12' : 'transparent', border: `1px solid ${autoPlay ? '#0B1E12' : '#E2DDD8'}`, borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontFamily: 'var(--font-manrope), sans-serif', fontSize: '0.75rem', color: autoPlay ? 'white' : '#4A5A50', fontWeight: autoPlay ? 600 : 400 }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill={autoPlay ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
                  <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
                </svg>
                Auto-play
              </button>

              <div style={{ display: 'flex', border: '1px solid #E2DDD8', borderRadius: 6, overflow: 'hidden' }}>
                {SPEED_PRESETS.map(rate => (
                  <button key={rate} onClick={() => setSpeechRate(rate)} style={{ padding: '4px 8px', border: 'none', borderRight: rate !== 1.5 ? '1px solid #E2DDD8' : 'none', background: speechRate === rate ? '#0B1E12' : 'transparent', color: speechRate === rate ? 'white' : '#8CA090', fontFamily: 'var(--font-jetbrains), monospace', fontSize: '0.5625rem', letterSpacing: '0.04em', cursor: 'pointer', fontWeight: speechRate === rate ? 700 : 400 }}>
                    {rate === 1 ? '1×' : `${rate}×`}
                  </button>
                ))}
              </div>

              <span style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: '0.75rem', color: '#8CA090', letterSpacing: '0.04em' }}>
                {deck.length > 0 ? `${index + 1} / ${deck.length}` : '—'}
              </span>
            </div>
          </div>
        </div>

        {/* Card area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 32px 32px', maxWidth: 800, width: '100%', margin: '0 auto' }}>
          {!card ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-jetbrains), monospace', fontSize: '0.75rem', color: '#8CA090' }}>
              No cards in deck.
            </div>
          ) : (
            <>
              <div className="study-scene" style={{ width: '100%', height: 280, marginBottom: 28 }} onClick={() => setFlipped(f => !f)}>
                <div key={index} className={`study-inner${flipped ? ' flipped' : ''}`}>

                  {/* Front — prompt */}
                  <div className="study-face" style={{ background: 'white', border: '1px solid #E2DDD8', boxShadow: '0 2px 16px rgba(0,0,0,0.07)', gap: 16, textAlign: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: '0.5625rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#4A5A50', border: '1px solid #E2DDD8', padding: '2px 7px', borderRadius: 4 }}>
                        {card.type}
                      </span>
                      <span style={{ fontFamily: 'var(--font-manrope), sans-serif', fontSize: '0.75rem', color: '#8CA090' }}>
                        {card.instruction}
                      </span>
                    </div>
                    <div style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 'clamp(1.25rem, 3vw, 1.75rem)', fontWeight: 400, color: '#0B1E12', lineHeight: 1.35, letterSpacing: '-0.01em' }}>
                      {card.prompt}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
                      <button onClick={e => { e.stopPropagation(); speak(card.prompt, 'en-US', speechRate) }} style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#F7F6F3', border: '1px solid #E2DDD8', borderRadius: 20, padding: '6px 14px', cursor: 'pointer', color: '#4A5A50', fontFamily: 'var(--font-manrope), sans-serif', fontSize: '0.8125rem', fontWeight: 500 }}>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
                        Listen
                      </button>
                      <span style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: '0.5625rem', letterSpacing: '0.08em', color: '#8CA090', textTransform: 'uppercase', opacity: 0.7 }}>
                        space to reveal
                      </span>
                    </div>
                  </div>

                  {/* Back — answer */}
                  <div className="study-face study-back" style={{ background: '#EAF3ED', border: '1px solid #C8DFD3', boxShadow: '0 2px 16px rgba(0,0,0,0.07)', gap: 16, textAlign: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: '0.5625rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#2E7D52' }}>Answer</span>
                      <button onClick={e => { e.stopPropagation(); speak(card.answer, SPEECH_LANG[language], speechRate) }} style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'rgba(31,92,58,0.1)', border: '1px solid rgba(31,92,58,0.25)', borderRadius: 20, padding: '4px 11px', cursor: 'pointer', color: '#1F5C3A', fontFamily: 'var(--font-manrope), sans-serif', fontSize: '0.75rem', fontWeight: 500 }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
                        Listen
                      </button>
                    </div>
                    <div style={{ fontFamily: FONT_CJK, fontSize: 'clamp(1.25rem, 3vw, 1.75rem)', fontWeight: 500, color: '#0B1E12', lineHeight: 1.45 }}>
                      {card.answer}
                    </div>
                    {card.variants && card.variants.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center', marginTop: 4 }}>
                        {card.variants.map((v, i) => (
                          <span key={i} style={{ fontFamily: FONT_CJK, fontSize: '0.8125rem', color: '#2E7D52', background: 'rgba(31,92,58,0.08)', padding: '2px 8px', borderRadius: 4 }}>{v}</span>
                        ))}
                      </div>
                    )}
                    <div style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: '0.6875rem', color: '#4A5A50', marginTop: 4, opacity: 0.6 }}>
                      {card.prompt}
                    </div>
                  </div>
                </div>
              </div>

              {/* Prev / Next */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', justifyContent: 'center' }}>
                <button onClick={goPrev} disabled={index === 0} style={{ padding: '9px 22px', border: '1px solid #E2DDD8', borderRadius: 8, background: 'white', color: index === 0 ? '#8CA090' : '#0B1E12', fontFamily: 'var(--font-manrope), sans-serif', fontWeight: 500, fontSize: '0.875rem', cursor: index === 0 ? 'not-allowed' : 'pointer', opacity: index === 0 ? 0.4 : 1 }}>
                  ← Prev
                </button>
                <div style={{ flex: 1, maxWidth: 300, display: 'flex', gap: 3, alignItems: 'center', overflow: 'hidden' }}>
                  {deck.slice(0, 60).map((_, i) => (
                    <div key={i} onClick={() => navigate(i)} style={{ flex: 1, height: 4, borderRadius: 2, minWidth: 3, cursor: 'pointer', background: i < index ? '#A8CCB8' : i === index ? '#1F5C3A' : '#E2DDD8', transition: 'background 0.15s' }} />
                  ))}
                  {deck.length > 60 && <span style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: '0.5rem', color: '#8CA090', flexShrink: 0, marginLeft: 4 }}>+{deck.length - 60}</span>}
                </div>
                <button onClick={goNext} disabled={index === deck.length - 1} className="btn-primary">Next →</button>
              </div>

              <div style={{ marginTop: 20, fontFamily: 'var(--font-jetbrains), monospace', fontSize: '0.5625rem', letterSpacing: '0.06em', color: '#8CA090', textAlign: 'center', opacity: 0.7 }}>
                space / ↑↓ flip · ← → navigate
              </div>

              {/* ── Study Helper (English only) ─────────────────── */}
              {language === 'en' && (
                <div style={{ width: '100%', marginTop: 32, borderTop: '1px solid #E2DDD8', paddingTop: 24 }}>
                  <div style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: '0.5625rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#8CA090', marginBottom: 12 }}>
                    Study helper
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {([
                      { action: 'explain_card'           as StudyAction, label: 'Explain this card' },
                      { action: 'show_similar_examples'  as StudyAction, label: 'Show similar examples' },
                      { action: 'what_contrast_is_this'  as StudyAction, label: 'What contrast is this?' },
                    ] as { action: StudyAction; label: string }[]).map(({ action, label }) => (
                      <button
                        key={action}
                        disabled={assistLoading}
                        onClick={async () => {
                          setAssistLoading(true)
                          setAssistResult(null)
                          setAssistError(null)
                          setStudyFeedbackState({ status: 'idle' })
                          setLastAssistAction(action)
                          setLastFreeformQ(null)
                          try {
                            const result = await callStudyAssist(action, language, card)
                            setAssistResult(result)
                          } catch (err) {
                            setAssistError(err instanceof Error ? err.message : String(err))
                          } finally {
                            setAssistLoading(false)
                          }
                        }}
                        style={{
                          padding: '7px 16px', borderRadius: 8,
                          border: '1px solid #E2DDD8', background: 'white',
                          fontFamily: 'var(--font-manrope), sans-serif', fontSize: '0.8125rem',
                          fontWeight: 500, color: '#0B1E12', cursor: assistLoading ? 'wait' : 'pointer',
                          opacity: assistLoading ? 0.5 : 1,
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {/* Freeform question input */}
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    <input
                      type="text"
                      value={freeformInput}
                      onChange={e => setFreeformInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && freeformInput.trim() && !assistLoading) {
                          e.preventDefault()
                          const q = freeformInput.trim()
                          setAssistLoading(true)
                          setAssistResult(null)
                          setAssistError(null)
                          setStudyFeedbackState({ status: 'idle' })
                          setLastAssistAction('freeform_help')
                          setLastFreeformQ(q)
                          callStudyAssist('freeform_help', language, card, q)
                            .then(setAssistResult)
                            .catch(err => setAssistError(err instanceof Error ? err.message : String(err)))
                            .finally(() => setAssistLoading(false))
                        }
                      }}
                      placeholder="Ask a question about this card…"
                      style={{
                        flex: 1, padding: '7px 12px', borderRadius: 8,
                        border: '1px solid #E2DDD8', background: 'white',
                        fontFamily: 'var(--font-manrope), sans-serif', fontSize: '0.8125rem',
                        color: '#0B1E12', outline: 'none',
                      }}
                    />
                    <button
                      disabled={assistLoading || !freeformInput.trim()}
                      onClick={async () => {
                        const q = freeformInput.trim()
                        if (!q) return
                        setAssistLoading(true)
                        setAssistResult(null)
                        setAssistError(null)
                        setStudyFeedbackState({ status: 'idle' })
                        setLastAssistAction('freeform_help')
                        setLastFreeformQ(q)
                        try {
                          const result = await callStudyAssist('freeform_help', language, card, q)
                          setAssistResult(result)
                        } catch (err) {
                          setAssistError(err instanceof Error ? err.message : String(err))
                        } finally {
                          setAssistLoading(false)
                        }
                      }}
                      style={{
                        padding: '7px 16px', borderRadius: 8,
                        border: 'none', background: '#0B1E12',
                        fontFamily: 'var(--font-manrope), sans-serif', fontSize: '0.8125rem',
                        fontWeight: 600, color: 'white',
                        cursor: assistLoading || !freeformInput.trim() ? 'not-allowed' : 'pointer',
                        opacity: assistLoading || !freeformInput.trim() ? 0.4 : 1,
                      }}
                    >
                      Ask
                    </button>
                  </div>

                  {assistLoading && (
                    <div style={{ marginTop: 16, fontFamily: 'var(--font-jetbrains), monospace', fontSize: '0.6875rem', color: '#8CA090' }}>
                      Thinking…
                    </div>
                  )}

                  {assistError && (
                    <div style={{ marginTop: 16, padding: '12px 16px', borderRadius: 8, background: '#FFF3F3', border: '1px solid #FCCFCF', fontFamily: 'var(--font-manrope), sans-serif', fontSize: '0.8125rem', color: '#C0392B' }}>
                      {assistError}
                    </div>
                  )}

                  {assistResult && (
                    <div style={{ marginTop: 16, background: 'white', border: '1px solid #E2DDD8', borderRadius: 10, padding: '16px 20px' }}>
                      <div style={{ fontFamily: 'var(--font-manrope), sans-serif', fontSize: '0.875rem', color: '#0B1E12', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                        {assistResult.assistantMessage}
                      </div>

                      {assistResult.similarExamples && assistResult.similarExamples.length > 0 && (
                        <div style={{ marginTop: 14 }}>
                          <div style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: '0.5625rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#8CA090', marginBottom: 8 }}>
                            Examples
                          </div>
                          <ul style={{ margin: 0, paddingLeft: 18 }}>
                            {assistResult.similarExamples.map((ex, i) => (
                              <li key={i} style={{ fontFamily: 'var(--font-fraunces), serif', fontStyle: 'italic', fontSize: '0.875rem', color: '#1F5C3A', marginBottom: 4, lineHeight: 1.5 }}>
                                {ex.text}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {assistResult.retrievedSources.length > 0 && (
                        <div style={{ marginTop: 14, fontFamily: 'var(--font-jetbrains), monospace', fontSize: '0.5625rem', color: '#8CA090', letterSpacing: '0.04em' }}>
                          Study reference: {assistResult.retrievedSources.map(s => s.title).join(', ')}
                        </div>
                      )}

                      {/* ── Feedback row (grounded + authenticated only) ── */}
                      {assistResult.retrievalHit
                        && assistResult.retrievedSources.length > 0
                        && assistResult.responseId
                        && getClientAuthenticatedUser() !== null
                        && (() => {
                          const fbStatus = studyFeedbackState.status
                          const source = assistResult.retrievedSources[0]
                          const sendFb = (helpful: boolean) => {
                            if (fbStatus !== 'idle') return
                            setStudyFeedbackState({ status: 'pending' })
                            submitStudyFeedback({
                              responseId:       assistResult.responseId!,
                              surface:          'study',
                              mode:             lastAssistAction ?? 'explain_card',
                              helpful,
                              language:         language === 'en' ? 'English' : language,
                              itemId:           card.id,
                              source:           { id: source.id, title: source.title },
                              userPrompt:       lastFreeformQ,
                              assistantMessage: assistResult.assistantMessage,
                              model:            assistResult.model,
                            })
                              .then(() => setStudyFeedbackState({ status: 'saved' }))
                              .catch((e: unknown) => {
                                const err = e instanceof Error ? e.message : 'Unknown error'
                                setStudyFeedbackState({ status: 'error', err })
                              })
                          }
                          return (
                            <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid #F0EDE8', display: 'flex', alignItems: 'center', gap: 8 }}>
                              {fbStatus === 'saved' ? (
                                <span style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: '0.5625rem', color: '#8CA090', letterSpacing: '0.06em' }}>Saved</span>
                              ) : fbStatus === 'error' ? (
                                <span style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: '0.5625rem', color: '#C0392B', letterSpacing: '0.06em' }} title={studyFeedbackState.err}>
                                  Error saving{studyFeedbackState.err ? ` — ${studyFeedbackState.err}` : ''}
                                </span>
                              ) : (
                                <>
                                  <span style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: '0.5rem', color: '#8CA090', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Helpful?</span>
                                  <button
                                    disabled={fbStatus === 'pending'}
                                    onClick={() => sendFb(true)}
                                    style={{ background: 'none', border: 'none', cursor: fbStatus === 'pending' ? 'wait' : 'pointer', fontSize: '0.875rem', opacity: fbStatus === 'pending' ? 0.4 : 1, padding: '0 2px' }}
                                    title="Yes, helpful"
                                  >
                                    👍
                                  </button>
                                  <button
                                    disabled={fbStatus === 'pending'}
                                    onClick={() => sendFb(false)}
                                    style={{ background: 'none', border: 'none', cursor: fbStatus === 'pending' ? 'wait' : 'pointer', fontSize: '0.875rem', opacity: fbStatus === 'pending' ? 0.4 : 1, padding: '0 2px' }}
                                    title="Not helpful"
                                  >
                                    👎
                                  </button>
                                </>
                              )}
                            </div>
                          )
                        })()
                      }
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}
