'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { DrillItem, DrillResult, DrillType, DrillTopic, Language } from '@/lib/drills'
import { checkAnswer, buildItems, LANGUAGES, TOPICS } from '@/lib/drills'
import {
  ignoreClientAuthExpiredError,
  isClientAuthExpiredError,
  loadCustomList,
  loadLanguage,
  loadSessions,
  readLanguageSync,
  saveCustomList,
  saveLanguage,
  saveSession,
  clearCustomList,
} from '@/lib/stats'
import DrillCoachPanel from '@/components/DrillCoachPanel'
import { TAXONOMY_DISPLAY, type TaxonomyLabel } from '@/lib/englishTaxonomy'

const TOPIC_DISPLAY: Record<string, string> = {
  daily:    'Daily Life',
  tech:     'Technical / Engineering',
  finance:  'Financial Arbitrage',
  business: 'General Business',
}

const TIMER_MAX = 20

type FeedbackType = 'correct' | 'incorrect' | 'timeout' | null

interface Props {
  initialType?: DrillType
  initialCount?: number
}

// ── CSV / JSON parsing helpers ─────────────────────────────────────────────────

function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false
  for (const char of line) {
    if (char === '"') { inQuotes = !inQuotes }
    else if (char === ',' && !inQuotes) { result.push(current); current = '' }
    else { current += char }
  }
  result.push(current)
  return result
}

function parseCSV(text: string): DrillItem[] {
  const lines = text.trim().split('\n')
  const result: DrillItem[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    // Skip header line if first line contains 'prompt' or 'answer'
    if (i === 0 && /prompt|answer|term/i.test(line)) continue
    // Parse quoted CSV
    const cols = parseCSVLine(line)
    if (cols.length < 2) continue
    const prompt = cols[0].trim()
    const answer = cols[1].trim()
    if (!prompt || !answer) continue
    // Optional variants in 3rd column, pipe-separated
    const variants = cols[2] ? cols[2].split('|').map(v => v.trim()).filter(Boolean) : undefined
    result.push({
      id: `custom_${i}_${Date.now()}`,
      type: 'translation',
      instruction: 'Translate the term.',
      prompt,
      answer,
      variants: variants?.length ? variants : undefined,
      promptLang: 'en-US',
    })
  }
  return result
}

function parseJSON(text: string): DrillItem[] {
  const data = JSON.parse(text)
  if (!Array.isArray(data)) throw new Error('Expected array')
  return data.map((item: Record<string, unknown>, i: number) => {
    if (!item.prompt || !item.answer) throw new Error(`Item ${i} missing prompt or answer`)
    return {
      id: `custom_${i}_${Date.now()}`,
      type: ((item.type as string) === 'substitution' ? 'substitution' : (item.type as string) === 'transformation' ? 'transformation' : 'translation') as DrillItem['type'],
      instruction: String(item.instruction ?? 'Translate the term.'),
      prompt: String(item.prompt),
      answer: String(item.answer),
      variants: Array.isArray(item.variants) ? item.variants.map(String) : undefined,
      promptLang: String(item.promptLang ?? 'en-US'),
    }
  })
}

// ── Component ─────────────────────────────────────────────────────────────────

const DRILL_MODES: { type: DrillType; label: string; desc: string }[] = [
  { type: 'sentence', label: 'Sentence',  desc: 'Grammar & full sentences' },
  { type: 'vocab',    label: 'Vocab',     desc: 'Single word translations' },
  { type: 'phrase',   label: 'Phrase',    desc: 'Common expressions' },
  { type: 'mixed',    label: 'Mixed',     desc: 'All categories combined' },
]

const VALID_DRILL_TYPES: ReadonlySet<DrillType> = new Set(['sentence', 'vocab', 'phrase', 'mixed', 'custom'] as const)
const VALID_LANGUAGES: ReadonlySet<Language>   = new Set(['es', 'fr', 'de', 'zh', 'ja', 'ko', 'en'] as const)

export default function DrillClient({ initialType = 'sentence', initialCount = 10 }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()

  // ── One-shot URL-param overrides (planner deep-links) ──────────────────────
  // Computed inline once at mount so initial state is correct from frame 1.
  interface UrlOverrides {
    language?: Language
    drillType?: DrillType
    topic?: DrillTopic | null
    count?: number
    source?: string
  }
  const urlOverridesRef = useRef<UrlOverrides | undefined>(undefined)
  if (urlOverridesRef.current === undefined) {
    const o: UrlOverrides = {}
    const langParam = searchParams?.get('language')
    if (langParam && VALID_LANGUAGES.has(langParam as Language)) o.language = langParam as Language
    const typeParam = searchParams?.get('type')
    if (typeParam && VALID_DRILL_TYPES.has(typeParam as DrillType)) o.drillType = typeParam as DrillType
    const topicParam = searchParams?.get('topic')
    if (topicParam && topicParam in TOPICS) o.topic = topicParam as DrillTopic
    const countParam = searchParams?.get('count')
    if (countParam) {
      const n = Number.parseInt(countParam, 10)
      if (Number.isFinite(n) && n >= 1 && n <= 30) o.count = n
    }
    const sourceParam = searchParams?.get('source')
    if (sourceParam) o.source = sourceParam
    urlOverridesRef.current = o
  }
  const urlOverrides: UrlOverrides = urlOverridesRef.current ?? {}

  // Config
  const [drillType, setDrillType] = useState<DrillType>(urlOverrides.drillType ?? initialType)
  const [count,     setCount]     = useState(urlOverrides.count ?? initialCount)
  const [language,      setLanguage]      = useState<Language>(urlOverrides.language ?? readLanguageSync())
  const [languageReady, setLanguageReady] = useState(!!urlOverrides.language)
  const [topic,     setTopic]     = useState<DrillTopic | null>(urlOverrides.topic ?? null)

  // Custom list
  const [customItems,    setCustomItems]    = useState<DrillItem[]>([])
  const [useCustom,      setUseCustom]      = useState(false)
  const [customFileName, setCustomFileName] = useState('')
  const [parseError,     setParseError]     = useState('')

  // Language picker visibility
  const [showLangPicker, setShowLangPicker] = useState(false)

  // Custom list — drawer visibility
  const [showCustomPanel, setShowCustomPanel] = useState(false)

  // Custom list — source tabs & AI generation
  const [customTab,     setCustomTab]     = useState<'upload' | 'generate'>('generate')
  const [showAdvanced,  setShowAdvanced]  = useState(false)
  const [topicsExpanded,    setTopicsExpanded]    = useState(false)
  const [recentTopics,      setRecentTopics]      = useState<DrillTopic[] | null>(null)
  const [genMode,       setGenMode]       = useState<'guided' | 'raw' | 'recommended'>('guided')
  const [genTopic,      setGenTopic]      = useState<DrillTopic | null>(null)
  const [genDifficulty, setGenDifficulty] = useState('b1')
  const [genGrammar,    setGenGrammar]    = useState('mixed')
  const [genDrillType,  setGenDrillType]  = useState('translation')
  const [genPrompt,     setGenPrompt]     = useState('')
  const [aiModel,       setAiModel]       = useState('openai/gpt-4o-mini')
  const [isGenerating,  setIsGenerating]  = useState(false)
  const [genError,      setGenError]      = useState('')
  const [genPreview,    setGenPreview]    = useState<DrillItem[]>([])
  const [planLoading,   setPlanLoading]   = useState(false)
  const [planSummary,   setPlanSummary]   = useState<{ topic: string; weakLabels: string[]; confidence: number } | null>(null)
  const [planError,     setPlanError]     = useState('')

  const handleGenerateDrills = async () => {
    setIsGenerating(true)
    setGenError('')
    setGenPreview([])
    try {
      const res = await fetch('/api/generate-drills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode:       genMode,
          rawPrompt:  genPrompt,
          topic:      genTopic ?? '',
          difficulty: genDifficulty,
          grammar:    genGrammar,
          drillType:  genDrillType,
          language:   LANGUAGES[language].name,
          count,
          model:      aiModel,
        }),
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        setGenError(data.error ?? 'Generation failed.')
        return
      }
      setGenPreview(data.drills)
      void saveCustomList(data.drills).catch(ignoreClientAuthExpiredError)
    } catch {
      setGenError('Network error — is the AI agent running?')
    } finally {
      setIsGenerating(false)
    }
  }

  const handleGenerateFromPlan = async () => {
    if (language !== 'en') return
    setPlanLoading(true)
    setPlanError('')
    setPlanSummary(null)
    setGenPreview([])
    setGenError('')

    let planTopic: DrillTopic = 'daily'
    let weakLabels: string[] = []
    let planConfidence = 0

    try {
      const planRes = await fetch('/api/plan-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: 'en' }),
      })
      const planData = await planRes.json() as Record<string, unknown>
      if (!planRes.ok || planData.error) {
        setPlanError((planData.error as string) ?? 'Could not fetch recommendation.')
        return
      }

      const nsp = (planData.nextSessionPlan ?? {}) as Record<string, unknown>
      const rawTopic = typeof nsp.topic === 'string' ? nsp.topic : 'daily'
      planTopic = (rawTopic in TOPICS) ? rawTopic as DrillTopic : 'daily'
      weakLabels = ((planData.weakPoints ?? []) as Array<{ label: string }>)
        .slice(0, 3)
        .map(w => TAXONOMY_DISPLAY[w.label as TaxonomyLabel] ?? w.label)
      planConfidence = typeof planData.confidence === 'number' ? planData.confidence : 0

      setPlanSummary({ topic: planTopic, weakLabels, confidence: planConfidence })
      setGenTopic(planTopic)
    } catch {
      setPlanError('Network error — could not fetch recommendation.')
      return
    } finally {
      setPlanLoading(false)
    }

    setIsGenerating(true)
    setGenError('')
    try {
      const genRes = await fetch('/api/generate-drills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode:       'guided',
          rawPrompt:  '',
          topic:      planTopic,
          difficulty: genDifficulty,
          grammar:    genGrammar,
          drillType:  genDrillType,
          language:   LANGUAGES[language].name,
          count,
          model:      aiModel,
        }),
      })
      const genData = await genRes.json()
      if (!genRes.ok || genData.error) {
        setGenError(genData.error ?? 'Generation failed.')
        return
      }
      setGenPreview(genData.drills)
      void saveCustomList(genData.drills).catch(ignoreClientAuthExpiredError)
    } catch {
      setGenError('Network error — is the AI agent running?')
    } finally {
      setIsGenerating(false)
    }
  }

  // Session
  const [items,     setItems]     = useState<DrillItem[]>([])
  const [index,     setIndex]     = useState(0)
  const [results,   setResults]   = useState<DrillResult[]>([])
  const [started,   setStarted]   = useState(false)

  // Drill state
  const [inputVal,  setInputVal]  = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [feedback,  setFeedback]  = useState<FeedbackType>(null)
  const [expected,  setExpected]  = useState('')
  const [submittedVal, setSubmittedVal] = useState('')
  const [timeLeft,  setTimeLeft]  = useState(TIMER_MAX)
  const [speaking,  setSpeaking]  = useState(false)

  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null)
  const startRef     = useRef(Date.now())
  const itemStartRef = useRef(Date.now())
  const inputRef     = useRef<HTMLInputElement>(null)
  const resultsRef   = useRef<DrillResult[]>([])
  resultsRef.current = results

  const currentItem = items[index]

  const accuracy = results.length === 0 ? null
    : Math.round(results.filter(r => r.correct).length / results.length * 100)

  // On mount, load language and custom list from API.
  // Skip the language sync if a URL ?language=... param took precedence.
  useEffect(() => {
    ;(async () => {
      try {
        if (!urlOverridesRef.current?.language) {
          const savedLang = await loadLanguage()
          setLanguage(savedLang)
        }
        setLanguageReady(true)
        const savedCustom = await loadCustomList()
        if (savedCustom.length > 0 && !urlOverridesRef.current?.drillType) {
          // Don't switch into custom mode when the planner deep-link asked for a specific built-in type.
          setCustomItems(savedCustom)
          setUseCustom(true)
          setCustomFileName('(previously uploaded)')
        } else if (savedCustom.length > 0) {
          // Still load the deck so it's available if the user opens the drawer, but don't auto-select it.
          setCustomItems(savedCustom)
        }
      } catch (error) {
        ignoreClientAuthExpiredError(error)
      }
    })()
  }, [])

  // Compute the last 4 unique topics from session history, chronologically
  useEffect(() => {
    if (!showCustomPanel || recentTopics !== null) return
    ;(async () => {
      try {
        const sessions = await loadSessions()
        const seen = new Set<DrillTopic>()
        const last4: DrillTopic[] = []
        // Walk sessions newest-first, pick first occurrence of each topic
        for (const s of [...sessions].sort((a, b) => b.date - a.date)) {
          for (const r of s.results) {
            const t = r.item.topic
            if (t && !seen.has(t)) { seen.add(t); last4.push(t) }
            if (last4.length === 4) break
          }
          if (last4.length === 4) break
        }
        setRecentTopics(last4)
      } catch {
        setRecentTopics([])
      }
    })()
  }, [showCustomPanel, recentTopics])

  const clearTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)
  }, [])

  const startTimer = useCallback(() => {
    clearTimer()
    setTimeLeft(TIMER_MAX)
    itemStartRef.current = Date.now()
    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) { clearInterval(timerRef.current!); return 0 }
        return prev - 1
      })
    }, 1000)
  }, [clearTimer])

  useEffect(() => {
    if (!started || !items[index]) return
    setSubmitted(false)
    setFeedback(null)
    setInputVal('')
    startTimer()
    setTimeout(() => inputRef.current?.focus(), 30)
    return clearTimer
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, started])

  useEffect(() => {
    if (timeLeft === 0 && !submitted && started && currentItem) {
      handleTimeout()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLeft])

  const recordAndShow = useCallback((result: DrillResult, fb: FeedbackType, exp: string, sub: string) => {
    setResults(prev => [...prev, result])
    setExpected(exp)
    setSubmittedVal(sub)
    setFeedback(fb)
    setSubmitted(true)
  }, [])

  const handleTimeout = useCallback(() => {
    if (submitted || !currentItem) return
    clearTimer()
    recordAndShow(
      { item: currentItem, correct: false, timedOut: true, userAnswer: '', timeUsed: TIMER_MAX },
      'timeout', currentItem.answer, ''
    )
  }, [submitted, currentItem, clearTimer, recordAndShow])

  const handleSubmit = useCallback(() => {
    if (submitted || !inputVal.trim() || !currentItem) return
    clearTimer()
    const val = inputVal.trim()
    const correct = checkAnswer(val, currentItem)
    const timeUsed = Math.round((Date.now() - itemStartRef.current) / 1000)
    recordAndShow(
      { item: currentItem, correct, timedOut: false, userAnswer: val, timeUsed },
      correct ? 'correct' : 'incorrect', currentItem.answer, val
    )
  }, [submitted, inputVal, currentItem, clearTimer, recordAndShow])

  const handleSkip = useCallback(() => {
    if (submitted || !currentItem) return
    clearTimer()
    const val = inputVal.trim()
    const timeUsed = Math.round((Date.now() - itemStartRef.current) / 1000)
    recordAndShow(
      { item: currentItem, correct: false, timedOut: false, skipped: true, userAnswer: val, timeUsed },
      'incorrect', currentItem.answer, val || '[skipped]'
    )
  }, [submitted, inputVal, currentItem, clearTimer, recordAndShow])

  const handleNext = useCallback(async () => {
    const next = index + 1
    if (next >= items.length) {
      const res = resultsRef.current
      const correct = res.filter(r => r.correct).length
      const avgTime = res.length > 0 ? res.reduce((a, r) => a + r.timeUsed, 0) / res.length : 0
      try {
        await saveSession({
          id: Date.now().toString(),
          date: Date.now(),
          drillType: useCustom ? 'custom' : drillType,
          correct,
          total: res.length,
          accuracy: res.length > 0 ? Math.round(correct / res.length * 100) : 0,
          avgTime: Math.round(avgTime * 10) / 10,
          results: res,
          language,
        })
      } catch (error) {
        if (isClientAuthExpiredError(error)) {
          return
        }

        throw error
      }

      router.push('/dashboard')
      return
    }
    setIndex(next)
  }, [index, items.length, drillType, useCustom, language, router])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't intercept Enter/Escape when the coach panel input (or any other input) is focused
      if (e.target instanceof HTMLInputElement && e.target !== inputRef.current) return
      if (e.key === 'Enter')  { if (submitted) { void handleNext() } else handleSubmit() }
      if (e.key === 'Escape') handleSkip()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [submitted, handleSubmit, handleSkip, handleNext])

  const speak = useCallback((text: string, lang: string) => {
    const synth = window.speechSynthesis
    if (!synth) return
    synth.cancel()

    const doSpeak = () => {
      const u = new SpeechSynthesisUtterance(text)
      u.lang = lang
      u.rate = 0.88
      const voices = synth.getVoices()
      const prefix = lang.split('-')[0].toLowerCase()
      const voice =
        voices.find(v => v.lang.toLowerCase() === lang.toLowerCase()) ??
        voices.find(v => v.lang.toLowerCase().startsWith(prefix))
      if (voice) u.voice = voice
      u.onstart = () => setSpeaking(true)
      u.onend   = () => setSpeaking(false)
      u.onerror = () => setSpeaking(false)
      // Chrome bug: synthesis silently stops unless resumed first
      if (synth.paused) synth.resume()
      synth.speak(u)
    }

    const voices = synth.getVoices()
    if (voices.length > 0) {
      doSpeak()
    } else {
      // Voices not yet loaded — wait for the event then speak
      synth.addEventListener('voiceschanged', doSpeak, { once: true })
    }
  }, [])

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setParseError('')
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      try {
        let parsedItems: DrillItem[]
        if (file.name.endsWith('.json')) {
          parsedItems = parseJSON(text)
        } else {
          parsedItems = parseCSV(text)
        }
        if (parsedItems.length === 0) throw new Error('No valid items found')
        setCustomItems(parsedItems)
        setCustomFileName(file.name)
        void saveCustomList(parsedItems).catch(ignoreClientAuthExpiredError)
      } catch (err) {
        setParseError(err instanceof Error ? err.message : 'Failed to parse file')
      }
    }
    reader.readAsText(file)
  }

  const maxCount = useCustom ? Math.max(1, customItems.length) : 20

  const startSession = () => {
    // Auto-accept any pending AI preview before starting
    const effectiveItems = useCustom && genPreview.length > 0 ? genPreview : customItems
    if (useCustom && genPreview.length > 0) {
      setCustomItems(genPreview)
      setCustomFileName(`AI · ${genPreview.length} drills`)
      void saveCustomList(genPreview).catch(ignoreClientAuthExpiredError)
      setGenPreview([])
    }
    const sessionItems = buildItems(
      useCustom ? 'custom' : drillType,
      count,
      language,
      useCustom ? effectiveItems : undefined,
      useCustom ? undefined : (topic ?? undefined),
    )
    setItems(sessionItems)
    setIndex(0)
    setResults([])
    setStarted(true)
    startRef.current = Date.now()
  }

  // ── Config screen ─────────────────────────────────────────────
  if (!started) {
    const StepLabel = ({ n, label }: { n: number; label: string }) => (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <span style={{
          width: 22, height: 22, borderRadius: '50%',
          border: '1.5px solid #CEC9C2',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'var(--font-manrope), sans-serif',
          fontSize: 11, fontWeight: 600, color: '#4A5A50', flexShrink: 0,
        }}>{n}</span>
        <span style={{
          fontFamily: 'var(--font-manrope), sans-serif',
          fontSize: 11, fontWeight: 700,
          letterSpacing: '1.2px', textTransform: 'uppercase', color: '#4A5A50',
        }}>{label}</span>
      </div>
    )

    return (
      <div className="mob-config-pad" style={{ flex: 1, background: 'var(--bg)', padding: '48px 32px', minHeight: 'calc(100vh - 60px)' }}>
        <div style={{ maxWidth: 1280, width: '100%', margin: '0 auto', display: 'grid', gridTemplateColumns: '1fr 360px', gap: 48, alignItems: 'start' }}>

          {/* ── LEFT COLUMN ─── */}
          <div>

            {/* Hero */}
            <div style={{ marginBottom: 52 }}>
              <div style={{ fontFamily: 'var(--font-manrope), sans-serif', fontWeight: 700, fontSize: 11, letterSpacing: '1.2px', textTransform: 'uppercase', color: '#8CA090', marginBottom: 12 }}>
                Training · New Session
              </div>
              <h1 style={{ fontFamily: 'var(--font-fraunces), serif', fontWeight: 700, fontSize: 'clamp(2rem, 4vw, 2.75rem)', color: '#0B1E12', lineHeight: 1.1, marginBottom: 12 }}>
                Begin <em style={{ fontStyle: 'italic', color: '#1F5C3A' }}>training.</em>
              </h1>
              <p style={{ fontFamily: 'var(--font-manrope), sans-serif', fontSize: 14, color: '#4A5A50', lineHeight: 1.65, marginBottom: 20 }}>
                Pick a mode and item count. Timer starts on the first item — errors are shown immediately, no partial credit.
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: '1rem' }}>{LANGUAGES[language].flag}</span>
                <span style={{ fontFamily: 'var(--font-manrope), sans-serif', fontSize: 13, fontWeight: 600, color: '#0B1E12' }}>{LANGUAGES[language].native}</span>
                <span style={{ fontFamily: 'var(--font-manrope), sans-serif', fontSize: 13, color: '#4A5A50' }}>{LANGUAGES[language].name}</span>
                <button onClick={() => setShowLangPicker(v => !v)} style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#4A5A50', background: 'transparent', border: 'none', cursor: 'pointer', marginLeft: 4, padding: 0, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                  Change {showLangPicker ? '↑' : '↓'}
                </button>
              </div>
              {showLangPicker && (
                <div style={{ marginTop: 10, background: 'white', border: '1px solid #E2DDD8', borderRadius: 12, padding: '12px 14px', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {(Object.entries(LANGUAGES) as [Language, { name: string; native: string; flag: string }][]).map(([code, info]) => {
                    const active = language === code
                    return (
                      <button key={code} onClick={() => { setLanguage(code); void saveLanguage(code).catch(ignoreClientAuthExpiredError); setShowLangPicker(false) }} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 20, background: active ? '#0B1E12' : 'white', border: active ? '1px solid #0B1E12' : '1px solid #E2DDD8', color: active ? 'white' : '#4A5A50', fontFamily: 'var(--font-manrope), sans-serif', fontSize: 13, fontWeight: active ? 600 : 400, cursor: 'pointer' }}>
                        <span style={{ fontSize: '0.875rem', lineHeight: 1 }}>{info.flag}</span>
                        {info.native}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {/* §1 — Study material */}
            <div style={{ marginBottom: 40 }}>
              <StepLabel n={1} label="Study material" />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <button onClick={() => setUseCustom(false)} style={{ background: 'white', textAlign: 'left', cursor: 'pointer', border: !useCustom ? '1.5px solid #1F5C3A' : '1px solid #E2DDD8', borderRadius: 12, padding: '16px 18px', display: 'flex', alignItems: 'flex-start', gap: 12, boxShadow: !useCustom ? '0 0 0 3px rgba(31,92,58,0.08)' : 'none', transition: 'border-color 0.15s' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: 'var(--font-fraunces), serif', fontStyle: !useCustom ? 'italic' : 'normal', fontWeight: 700, fontSize: 15, color: '#0B1E12', marginBottom: 4 }}>Built-in drills</div>
                    <div style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 10, color: '#8CA090', letterSpacing: '0.06em' }}>§ standard</div>
                  </div>
                  {!useCustom && <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#1F5C3A', display: 'inline-block', flexShrink: 0, marginTop: 4 }} />}
                </button>
                <button
                  onClick={() => { setUseCustom(true); setShowCustomPanel(true) }}
                  style={{
                    background: 'white', textAlign: 'left', cursor: 'pointer',
                    border: useCustom ? '1.5px solid #1F5C3A' : '1px solid #E2DDD8',
                    borderRadius: 12, padding: '16px 18px',
                    display: 'flex', flexDirection: 'column', gap: 0,
                    boxShadow: useCustom ? '0 0 0 3px rgba(31,92,58,0.08)' : 'none',
                    transition: 'border-color 0.15s', width: '100%',
                  }}
                >
                  {/* Card header row */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', width: '100%' }}>
                    <div>
                      <div style={{ fontFamily: 'var(--font-fraunces), serif', fontStyle: useCustom ? 'italic' : 'normal', fontWeight: 700, fontSize: 15, color: '#0B1E12', marginBottom: 4 }}>
                        Custom list
                      </div>
                      {customItems.length > 0 ? (
                        <div style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 10, color: '#4A5A50', letterSpacing: '0.06em' }}>
                          {customFileName || `${customItems.length} items`}
                        </div>
                      ) : (
                        <div style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 10, color: '#8CA090', letterSpacing: '0.06em' }}>+ new</div>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                      {useCustom && customItems.length > 0 && (
                        <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#1F5C3A', display: 'inline-block' }} />
                      )}
                      {customItems.length > 0 && (
                        <span
                          onClick={e => { e.stopPropagation(); setShowCustomPanel(true) }}
                          style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 10, color: '#1F5C3A', letterSpacing: '0.06em', textTransform: 'uppercase' }}
                        >
                          Edit ›
                        </span>
                      )}
                    </div>
                  </div>
                  {/* Inline drill preview — up to 3 items */}
                  {customItems.length > 0 && (
                    <div style={{ marginTop: 10, width: '100%', borderTop: '1px solid #F0EDE8', paddingTop: 8 }}>
                      {customItems.slice(0, 3).map((item, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: i < 2 && i < customItems.length - 1 ? 4 : 0 }}>
                          <span style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 9, color: '#CEC9C2', flexShrink: 0, width: 10 }}>{i + 1}</span>
                          <span style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 11, color: '#4A5A50', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                            {item.prompt}
                          </span>
                          <span style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 9, color: '#CEC9C2', flexShrink: 0 }}>→</span>
                          <span style={{ fontFamily: 'var(--font-manrope), sans-serif', fontSize: 11, fontWeight: 600, color: '#1F5C3A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                            {item.answer}
                          </span>
                        </div>
                      ))}
                      {customItems.length > 3 && (
                        <div style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 9, color: '#8CA090', marginTop: 5 }}>
                          +{customItems.length - 3} more
                        </div>
                      )}
                    </div>
                  )}
                </button>
              </div>
            </div>

            {/* §2 — Topic */}
            {!useCustom && (
              <div style={{ marginBottom: 40 }}>
                <StepLabel n={2} label="Topic" />
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {([null, ...Object.keys(TOPICS)] as (DrillTopic | null)[]).map(t => {
                    const active = topic === t
                    const info = t ? TOPICS[t] : null
                    return (
                      <button key={t ?? 'none'} onClick={() => setTopic(t)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: active ? '#0B1E12' : 'white', color: active ? 'white' : '#4A5A50', fontFamily: 'var(--font-manrope), sans-serif', fontWeight: active ? 600 : 400, fontSize: 13, padding: '7px 15px', borderRadius: 20, border: active ? '1px solid #0B1E12' : '1px solid #E2DDD8', cursor: 'pointer', transition: 'all 0.15s' }}>
                        {info && <span style={{ fontSize: '0.75rem', opacity: 0.8 }}>{info.icon}</span>}
                        {info ? info.label : 'No theme'}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* §3 — Mode */}
            {!useCustom && (
              <div style={{ marginBottom: 40 }}>
                <StepLabel n={3} label="Mode" />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  {DRILL_MODES.map(({ type: t, label, desc }) => {
                    const active = drillType === t
                    return (
                      <button key={t} onClick={() => setDrillType(t)} aria-label={`Select ${label} mode`} style={{ background: 'white', border: active ? '1.5px solid #1F5C3A' : '1px solid #E2DDD8', borderRadius: 12, cursor: 'pointer', textAlign: 'left', padding: '16px 18px', transition: 'border-color 0.15s', boxShadow: active ? '0 0 0 3px rgba(31,92,58,0.08)' : 'none' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                          <span style={{ fontFamily: 'var(--font-fraunces), serif', fontStyle: active ? 'italic' : 'normal', fontWeight: 700, fontSize: 15, color: '#0B1E12' }}>{label}</span>
                          {active && <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#1F5C3A', display: 'inline-block', flexShrink: 0 }} />}
                        </div>
                        <div style={{ fontFamily: 'var(--font-manrope), sans-serif', fontSize: 12, color: '#8CA090', lineHeight: 1.5 }}>{desc}</div>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

          {/* ── Custom list drawer ──────────────────────────────── */}
          {showCustomPanel && (
            <div
              style={{
                position: 'fixed', inset: 0, zIndex: 200,
                display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
              }}
            >
              {/* Backdrop */}
              <div
                onClick={() => setShowCustomPanel(false)}
                style={{ position: 'absolute', inset: 0, background: 'rgba(11,30,18,0.35)', backdropFilter: 'blur(2px)' }}
              />

              {/* Sheet */}
              <div
                style={{
                  position: 'relative', zIndex: 1,
                  background: 'white',
                  borderRadius: '20px 20px 0 0',
                  maxHeight: '90vh',
                  display: 'flex', flexDirection: 'column',
                  boxShadow: '0 -8px 40px rgba(0,0,0,0.14)',
                }}
              >
                {/* Header */}
                <div style={{ padding: '32px 32px 0', flexShrink: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6 }}>
                    <h2 style={{ fontFamily: 'var(--font-fraunces), serif', fontWeight: 700, fontSize: 'clamp(1.75rem, 3vw, 2.25rem)', color: '#0B1E12', lineHeight: 1.1 }}>
                      Custom list
                    </h2>
                    <button
                      onClick={() => setShowCustomPanel(false)}
                      style={{
                        width: 36, height: 36, borderRadius: '50%',
                        border: '1px solid #E2DDD8', background: '#F7F6F3',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: 'pointer', fontSize: 18, color: '#4A5A50',
                        fontFamily: 'var(--font-manrope), sans-serif', lineHeight: 1,
                        flexShrink: 0, marginTop: 4,
                      }}
                    >
                      ×
                    </button>
                  </div>
                  <p style={{ fontFamily: 'var(--font-manrope), sans-serif', fontSize: 14, color: '#4A5A50', marginBottom: 24, lineHeight: 1.5 }}>
                    Generate drills with a model, or upload your own deck.
                  </p>

                  {/* Tab bar */}
                  <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #E2DDD8' }}>
                    {(['generate', 'upload'] as const).map(tab => {
                      const active = customTab === tab
                      return (
                        <button
                          key={tab}
                          onClick={() => setCustomTab(tab)}
                          style={{
                            fontFamily: 'var(--font-manrope), sans-serif',
                            fontSize: 14, fontWeight: active ? 600 : 400,
                            color: active ? '#0B1E12' : '#4A5A50',
                            background: 'none', border: 'none',
                            padding: '0 0 12px',
                            marginRight: 28,
                            borderBottom: active ? '2px solid #0B1E12' : '2px solid transparent',
                            marginBottom: -1,
                            cursor: 'pointer',
                          }}
                        >
                          {tab === 'upload' ? 'Upload File' : 'Generate (Local AI)'}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Scrollable content */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px' }}>

                  {/* ── Upload tab ─────────────────────────────── */}
                  {customTab === 'upload' && (
                    <>
                      {customItems.length === 0 ? (
                        <label
                          style={{
                            display: 'flex', flexDirection: 'column',
                            alignItems: 'center', justifyContent: 'center',
                            gap: 12, padding: '40px 24px',
                            border: '1.5px dashed #CEC9C2', borderRadius: 12,
                            background: '#F7F6F3', cursor: 'pointer',
                            textAlign: 'center',
                          }}
                        >
                          <span style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#8CA090', background: '#EAE6E0', padding: '3px 10px', borderRadius: 4 }}>
                            CSV · JSON
                          </span>
                          <span style={{ fontFamily: 'var(--font-manrope), sans-serif', fontSize: 14, fontWeight: 500, color: '#0B1E12' }}>
                            Drop a file here, or pick one.
                          </span>
                          <span style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 10, color: '#8CA090', lineHeight: 1.7, textAlign: 'center' }}>
                            CSV: prompt,answer (one per line) · JSON: [&#123;prompt, answer&#125;]
                          </span>
                          <span style={{
                            fontFamily: 'var(--font-manrope), sans-serif', fontSize: 13, fontWeight: 500,
                            color: '#4A5A50', background: 'white',
                            border: '1px solid #E2DDD8', borderRadius: 6,
                            padding: '8px 20px', cursor: 'pointer',
                          }}>
                            Choose file
                          </span>
                          <input type="file" accept=".csv,.json" style={{ display: 'none' }} onChange={handleFileUpload} />
                        </label>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '16px 20px', border: '1px solid #E2DDD8', borderRadius: 10, background: '#F7F6F3' }}>
                          <div>
                            <div style={{ fontFamily: 'var(--font-manrope), sans-serif', fontWeight: 600, fontSize: 14, color: '#0B1E12', marginBottom: 2 }}>
                              {customFileName}
                            </div>
                            <div style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 11, color: '#8CA090' }}>
                              {customItems.length} item{customItems.length !== 1 ? 's' : ''}
                            </div>
                          </div>
                          <button
                            onClick={() => {
                              setCustomItems([])
                              setCustomFileName('')
                              setParseError('')
                              void clearCustomList().catch(ignoreClientAuthExpiredError)
                            }}
                            style={{
                              fontFamily: 'var(--font-manrope), sans-serif', fontSize: 13,
                              color: '#B22222', background: 'transparent',
                              border: '1px solid rgba(178,34,34,0.3)', borderRadius: 6,
                              padding: '6px 14px', cursor: 'pointer',
                            }}
                          >
                            Remove
                          </button>
                        </div>
                      )}
                      {parseError && (
                        <div style={{ marginTop: 12, fontFamily: 'var(--font-manrope), sans-serif', fontSize: 13, color: '#B22222' }}>
                          {parseError}
                        </div>
                      )}
                    </>
                  )}

                  {/* ── Generate tab ────────────────────────────── */}
                  {customTab === 'generate' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

                      {/* Advanced toggle — model picker hidden by default */}
                      <div>
                        <button
                          onClick={() => setShowAdvanced(v => !v)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 6,
                            background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                          }}
                        >
                          <span style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#8CA090' }}>
                            {showAdvanced ? '▲' : '▼'} Advanced
                          </span>
                          {!showAdvanced && (
                            <span style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 10, color: '#4A5A50' }}>
                              {aiModel.split('/').pop()}
                            </span>
                          )}
                        </button>
                        {showAdvanced && (
                          <div style={{ marginTop: 10 }}>
                            <div style={{ fontFamily: 'var(--font-manrope), sans-serif', fontWeight: 700, fontSize: 11, letterSpacing: '1.2px', textTransform: 'uppercase', color: '#4A5A50', marginBottom: 8 }}>
                              AI Model
                            </div>
                            <select
                              value={aiModel}
                              onChange={e => setAiModel(e.target.value)}
                              style={{
                                width: '100%', padding: '10px 14px',
                                border: '1px solid #E2DDD8', borderRadius: 8,
                                background: 'white', fontFamily: 'var(--font-manrope), sans-serif',
                                fontSize: 14, color: '#0B1E12', cursor: 'pointer',
                                appearance: 'none',
                                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238CA090' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
                                backgroundRepeat: 'no-repeat',
                                backgroundPosition: 'right 14px center',
                                paddingRight: 36,
                              }}
                            >
                              <optgroup label="OpenAI">
                                <option value="openai/gpt-4o-mini">GPT-4o mini</option>
                                <option value="openai/gpt-4o">GPT-4o</option>
                                <option value="openai/o4-mini">o4-mini</option>
                              </optgroup>
                              <optgroup label="Anthropic">
                                <option value="anthropic/claude-3-5-haiku-20241022">Claude 3.5 Haiku</option>
                                <option value="anthropic/claude-3-5-sonnet-20241022">Claude 3.5 Sonnet</option>
                                <option value="anthropic/claude-opus-4-5">Claude Opus 4.5</option>
                              </optgroup>
                              <optgroup label="Google">
                                <option value="google/gemini-2.0-flash">Gemini 2.0 Flash</option>
                                <option value="google/gemini-1.5-pro">Gemini 1.5 Pro</option>
                              </optgroup>
                              <optgroup label="Groq (fast free tier)">
                                <option value="groq/llama-3.1-70b-versatile">Llama 3.1 70B</option>
                                <option value="groq/mixtral-8x7b-32768">Mixtral 8x7B</option>
                              </optgroup>
                              <optgroup label="Ollama (local)">
                                <option value="ollama/llama3.1">llama3.1</option>
                                <option value="ollama/llama3.2">llama3.2</option>
                                <option value="ollama/mistral">mistral</option>
                                <option value="ollama/qwen2.5">qwen2.5</option>
                              </optgroup>
                              <optgroup label="Ollama Cloud (OLLAMA_API_KEY)">
                                <option value="ollama-cloud/llama3.3">llama3.3</option>
                                <option value="ollama-cloud/llama3.1:70b">llama3.1:70b</option>
                                <option value="ollama-cloud/mistral-large">mistral-large</option>
                                <option value="ollama-cloud/gemma3:27b">gemma3:27b</option>
                                <option value="ollama-cloud/qwen2.5:72b">qwen2.5:72b</option>
                                <option value="ollama-cloud/deepseek-r1:32b">deepseek-r1:32b</option>
                                <option value="ollama-cloud/phi4">phi4</option>
                              </optgroup>
                            </select>
                          </div>
                        )}
                      </div>

                      {/* Guided / Raw toggle */}
                      <div>
                        <div style={{ fontFamily: 'var(--font-manrope), sans-serif', fontWeight: 700, fontSize: 11, letterSpacing: '1.2px', textTransform: 'uppercase', color: '#4A5A50', marginBottom: 8 }}>
                          Prompt Mode
                        </div>
                        <div style={{ display: 'inline-flex', border: '1px solid #E2DDD8', borderRadius: 8, overflow: 'hidden', background: '#F7F6F3' }}>
                          {(['guided', 'raw', 'recommended'] as const).map((mode, i, arr) => (
                            <button
                              key={mode}
                              onClick={() => { setGenMode(mode); setPlanError(''); setPlanSummary(null) }}
                              style={{
                                padding: '8px 18px',
                                border: 'none',
                                borderRight: i < arr.length - 1 ? '1px solid #E2DDD8' : 'none',
                                background: genMode === mode ? 'white' : 'transparent',
                                color: genMode === mode ? '#0B1E12' : '#8CA090',
                                fontFamily: 'var(--font-manrope), sans-serif',
                                fontSize: 13, fontWeight: genMode === mode ? 600 : 400,
                                cursor: 'pointer',
                                boxShadow: genMode === mode ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
                              }}
                            >
                              {mode === 'guided' ? 'Guided' : mode === 'raw' ? 'Raw Prompt' : 'From Plan'}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Guided fields */}
                      {genMode === 'guided' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

                          {/* Difficulty — chips */}
                          <div>
                            <div style={{ fontFamily: 'var(--font-manrope), sans-serif', fontWeight: 700, fontSize: 11, letterSpacing: '1.2px', textTransform: 'uppercase', color: '#4A5A50', marginBottom: 8 }}>
                              Difficulty
                            </div>
                            <div style={{ display: 'flex', gap: 6 }}>
                              {([
                                { v: 'a1', l: 'A1–A2', sub: 'Beginner' },
                                { v: 'b1', l: 'B1–B2', sub: 'Intermediate' },
                                { v: 'c1', l: 'C1',    sub: 'Advanced' },
                                { v: 'c2', l: 'C2',    sub: 'Native' },
                              ] as const).map(({ v, l, sub }) => {
                                const active = genDifficulty === v
                                return (
                                  <button key={v} onClick={() => setGenDifficulty(v)} style={{ flex: 1, padding: '7px 4px', border: active ? '1.5px solid #1F5C3A' : '1px solid #E2DDD8', borderRadius: 8, background: active ? '#F0F7F2' : 'white', cursor: 'pointer', textAlign: 'center', boxShadow: active ? '0 0 0 2px rgba(31,92,58,0.1)' : 'none', transition: 'all 0.12s' }}>
                                    <div style={{ fontFamily: 'var(--font-fraunces), serif', fontWeight: 700, fontSize: 13, color: active ? '#1F5C3A' : '#0B1E12', lineHeight: 1.2 }}>{l}</div>
                                    <div style={{ fontFamily: 'var(--font-manrope), sans-serif', fontSize: 9, color: active ? '#4A8C62' : '#8CA090', marginTop: 2 }}>{sub}</div>
                                  </button>
                                )
                              })}
                            </div>
                          </div>

                          {/* Topic — chips: Mixed first, then last 4 recent, expand to all */}
                          <div>
                            <div style={{ fontFamily: 'var(--font-manrope), sans-serif', fontWeight: 700, fontSize: 11, letterSpacing: '1.2px', textTransform: 'uppercase', color: '#4A5A50', marginBottom: 8 }}>
                              Topic / Theme
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                              {(() => {
                                const allTopics = Object.keys(TOPICS) as DrillTopic[]
                                // Collapsed: Mixed + last 4 recent, always include selected
                                const recent = (recentTopics ?? []).slice(0, 4)
                                const collapsed: (DrillTopic | null)[] = [null, ...recent]
                                if (genTopic !== null && !collapsed.includes(genTopic)) collapsed.push(genTopic)
                                const visible: (DrillTopic | null)[] = topicsExpanded
                                  ? [null, ...allTopics]
                                  : collapsed

                                return (<>
                                  {visible.map(v => {
                                    const isMixed = v === null
                                    const label = isMixed ? 'Mixed' : TOPICS[v!].label
                                    const icon  = isMixed ? '✦' : TOPICS[v!].icon
                                    const active = genTopic === v
                                    return (
                                      <button
                                        key={v ?? '__mixed__'}
                                        onClick={() => setGenTopic(v)}
                                        style={{
                                          display: 'inline-flex', alignItems: 'center', gap: 5,
                                          padding: '6px 10px',
                                          border: active ? '1.5px solid #1F5C3A' : '1px solid #E2DDD8',
                                          borderRadius: 20, background: active ? '#F0F7F2' : 'white',
                                          cursor: 'pointer',
                                          boxShadow: active ? '0 0 0 2px rgba(31,92,58,0.1)' : 'none',
                                          transition: 'all 0.12s',
                                        }}
                                      >
                                        <span style={{ fontSize: 12, lineHeight: 1 }}>{icon}</span>
                                        <span style={{ fontFamily: 'var(--font-manrope), sans-serif', fontSize: 12, fontWeight: active ? 600 : 400, color: active ? '#1F5C3A' : '#4A5A50' }}>{label}</span>
                                      </button>
                                    )
                                  })}
                                  {/* Expand / collapse pill */}
                                  <button
                                    onClick={() => setTopicsExpanded(v => !v)}
                                    style={{
                                      display: 'inline-flex', alignItems: 'center', gap: 4,
                                      padding: '6px 11px',
                                      border: '1.5px solid #CEC9C2',
                                      borderRadius: 20, background: topicsExpanded ? '#F0EDE8' : 'white',
                                      cursor: 'pointer',
                                      fontFamily: 'var(--font-manrope), sans-serif',
                                      fontSize: 12, fontWeight: 500, color: '#4A5A50',
                                      transition: 'all 0.12s',
                                    }}
                                  >
                                    {topicsExpanded ? '↑ Fewer' : `All ${allTopics.length} ↓`}
                                  </button>
                                </>)
                              })()}
                            </div>
                          </div>

                          {/* Drill Type — inline toggle + Grammatical Focus dropdown */}
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                            <div>
                              <div style={{ fontFamily: 'var(--font-manrope), sans-serif', fontWeight: 700, fontSize: 11, letterSpacing: '1.2px', textTransform: 'uppercase', color: '#4A5A50', marginBottom: 8 }}>
                                Drill Type
                              </div>
                              <div style={{ display: 'flex', border: '1px solid #E2DDD8', borderRadius: 8, overflow: 'hidden', background: '#F7F6F3' }}>
                                {([
                                  { v: 'translation',    l: 'Trans.' },
                                  { v: 'substitution',   l: 'Subst.' },
                                  { v: 'transformation', l: 'Transform.' },
                                ] as const).map((opt, i, arr) => {
                                  const active = genDrillType === opt.v
                                  return (
                                    <button key={opt.v} onClick={() => setGenDrillType(opt.v)} style={{ flex: 1, padding: '8px 2px', border: 'none', borderRight: i < arr.length - 1 ? '1px solid #E2DDD8' : 'none', background: active ? 'white' : 'transparent', color: active ? '#0B1E12' : '#8CA090', fontFamily: 'var(--font-manrope), sans-serif', fontSize: 11, fontWeight: active ? 600 : 400, cursor: 'pointer', boxShadow: active ? '0 1px 4px rgba(0,0,0,0.08)' : 'none', transition: 'all 0.1s' }}>
                                      {opt.l}
                                    </button>
                                  )
                                })}
                              </div>
                            </div>
                            <div>
                              <div style={{ fontFamily: 'var(--font-manrope), sans-serif', fontWeight: 700, fontSize: 11, letterSpacing: '1.2px', textTransform: 'uppercase', color: '#4A5A50', marginBottom: 8 }}>
                                Grammar Focus
                              </div>
                              <select
                                value={genGrammar}
                                onChange={e => setGenGrammar(e.target.value)}
                                style={{ width: '100%', padding: '9px 12px', border: '1px solid #E2DDD8', borderRadius: 8, background: 'white', fontFamily: 'var(--font-manrope), sans-serif', fontSize: 12, color: '#0B1E12', cursor: 'pointer', appearance: 'none', backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238CA090' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center', paddingRight: 28 }}
                              >
                                <option value="mixed">Mixed / All</option>
                                <option value="subjunctive">Subjunctive</option>
                                <option value="conditional">Conditionals</option>
                                <option value="pastperf">Past Perfect</option>
                              </select>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Raw prompt textarea */}
                      {genMode === 'raw' && (
                        <textarea
                          value={genPrompt}
                          onChange={e => setGenPrompt(e.target.value)}
                          placeholder="e.g., Generate 10 advanced French substitution drills focusing on explaining reinforcement learning, option pricing, and data analytics..."
                          style={{
                            width: '100%', padding: '12px 14px',
                            border: '1px solid #E2DDD8', borderRadius: 8,
                            background: '#F7F6F3', fontFamily: 'var(--font-jetbrains), monospace',
                            fontSize: 13, color: '#0B1E12', lineHeight: 1.6,
                            height: 120, resize: 'none',
                          }}
                        />
                      )}

                      {/* From Plan content */}
                      {genMode === 'recommended' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                          {language !== 'en' ? (
                            <div style={{ background: '#F7F6F3', border: '1px solid #E2DDD8', borderRadius: 8, padding: '14px 16px' }}>
                              <div style={{ fontFamily: 'var(--font-manrope), sans-serif', fontSize: 13, color: '#4A5A50', lineHeight: 1.6 }}>
                                The planner is available for <strong>English</strong> only. Switch your language to English to use this mode.
                              </div>
                            </div>
                          ) : (
                            <>
                              <div style={{ background: '#F7F6F3', border: '1px solid #E2DDD8', borderRadius: 8, padding: '14px 16px' }}>
                                <div style={{ fontFamily: 'var(--font-manrope), sans-serif', fontSize: 13, color: '#4A5A50', lineHeight: 1.6 }}>
                                  Analyzes your last 5 English sessions and generates drills targeting your weak areas automatically.
                                </div>
                              </div>
                              {planSummary && !planLoading && (
                                <div style={{ background: 'rgba(31,92,58,0.05)', border: '1px solid rgba(31,92,58,0.2)', borderRadius: 8, padding: '12px 16px' }}>
                                  <div style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#1F5C3A', marginBottom: 6 }}>
                                    Generating based on
                                  </div>
                                  <div style={{ fontFamily: 'var(--font-manrope), sans-serif', fontSize: 13, color: '#0B1E12', fontWeight: 500 }}>
                                    {TOPIC_DISPLAY[planSummary.topic] ?? planSummary.topic}
                                    {planSummary.weakLabels.length > 0 && (
                                      <span style={{ color: '#4A5A50', fontWeight: 400 }}>{' · '}{planSummary.weakLabels.join(' · ')}</span>
                                    )}
                                  </div>
                                  {planSummary.confidence > 0 && (
                                    <div style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 10, color: '#8CA090', marginTop: 4 }}>
                                      confidence {Math.round(planSummary.confidence * 100)}%
                                    </div>
                                  )}
                                </div>
                              )}
                              {planError && (
                                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, background: 'rgba(178,34,34,0.06)', border: '1px solid rgba(178,34,34,0.2)', borderRadius: 8, padding: '10px 14px' }}>
                                  <span style={{ color: '#B22222', flexShrink: 0 }}>⚠</span>
                                  <span style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 12, color: '#B22222', lineHeight: 1.6 }}>{planError}</span>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      )}

                      {/* Compound Generate CTA — [−] Generate N drills [+] */}
                      {genPreview.length === 0 && (() => {
                        const busy = isGenerating || planLoading
                        const isFromPlan = genMode === 'recommended' && language === 'en'
                        const rawDisabled = genMode === 'raw' && !genPrompt.trim()
                        const disabled = busy || !languageReady || rawDisabled || (genMode === 'recommended' && language !== 'en')
                        const bgActive = '#1F5C3A'
                        const bgDisabled = '#A8BFB0'
                        const bg = disabled ? bgDisabled : bgActive
                        const spinnerSvg = (
                          <svg style={{ width: 14, height: 14, animation: 'spin 1s linear infinite', flexShrink: 0 }} fill="none" viewBox="0 0 24 24">
                            <circle style={{ opacity: 0.25 }} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path style={{ opacity: 0.75 }} fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                        )
                        const sepStyle: React.CSSProperties = { width: 1, background: 'rgba(255,255,255,0.2)', flexShrink: 0, alignSelf: 'stretch' }
                        return (
                          <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', boxShadow: disabled ? 'none' : '0 2px 10px rgba(31,92,58,0.28)', transition: 'box-shadow 0.15s' }}>
                            {/* − */}
                            <button
                              onClick={() => setCount(c => Math.max(1, c - 1))}
                              disabled={busy}
                              style={{ width: 44, background: bg, border: 'none', color: 'white', fontSize: 18, lineHeight: 1, cursor: busy ? 'not-allowed' : 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.15s' }}
                            >−</button>
                            <div style={sepStyle} />
                            {/* Main action */}
                            <button
                              onClick={isFromPlan ? handleGenerateFromPlan : handleGenerateDrills}
                              disabled={disabled}
                              style={{ flex: 1, padding: '13px 0', background: bg, border: 'none', color: 'white', fontFamily: 'var(--font-manrope), sans-serif', fontSize: 14, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, transition: 'background 0.15s' }}
                            >
                              {busy ? (
                                <>{spinnerSvg}<span style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase' }}>{planLoading ? 'Fetching plan…' : 'Generating…'}</span></>
                              ) : (
                                isFromPlan ? `Generate ${count} from Plan` : `Generate ${count} drills`
                              )}
                            </button>
                            <div style={sepStyle} />
                            {/* + */}
                            <button
                              onClick={() => setCount(c => Math.min(30, c + 1))}
                              disabled={busy}
                              style={{ width: 44, background: bg, border: 'none', color: 'white', fontSize: 18, lineHeight: 1, cursor: busy ? 'not-allowed' : 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.15s' }}
                            >+</button>
                          </div>
                        )
                      })()}

                      {/* Error */}
                      {genError && (
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, background: 'rgba(178,34,34,0.06)', border: '1px solid rgba(178,34,34,0.2)', borderRadius: 8, padding: '10px 14px' }}>
                          <span style={{ color: '#B22222', flexShrink: 0 }}>⚠</span>
                          <span style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 12, color: '#B22222', lineHeight: 1.6 }}>{genError}</span>
                        </div>
                      )}

                      {/* Preview ledger */}
                      {genPreview.length > 0 && (
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                            <span style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#8CA090' }}>
                              Preview — {genPreview.length} drills generated
                            </span>
                            <button
                              onClick={() => { setGenPreview([]); if (genMode === 'recommended') { void handleGenerateFromPlan() } else { void handleGenerateDrills() } }}
                              disabled={planLoading || isGenerating || !languageReady}
                              style={{ fontFamily: 'var(--font-manrope), sans-serif', fontSize: 12, fontWeight: 500, color: '#4A5A50', background: 'white', border: '1px solid #E2DDD8', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', opacity: (planLoading || isGenerating || !languageReady) ? 0.5 : 1 }}
                            >
                              ↻ Regenerate
                            </button>
                          </div>
                          <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid #E2DDD8', borderRadius: 8, background: '#F7F6F3' }}>
                            {genPreview.map((d, i) => (
                              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderBottom: i < genPreview.length - 1 ? '1px solid #EAE6E0' : 'none' }}>
                                <span style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 10, color: '#8CA090', width: 16, textAlign: 'right', flexShrink: 0 }}>{i + 1}</span>
                                <span style={{ fontFamily: 'var(--font-manrope), sans-serif', fontSize: 13, color: '#4A5A50', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.prompt}</span>
                                <span style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 10, color: '#CEC9C2', flexShrink: 0 }}>→</span>
                                <span style={{ fontFamily: 'var(--font-manrope), sans-serif', fontSize: 13, fontWeight: 600, color: '#0B1E12', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.answer}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                    </div>
                  )}
                </div>

                {/* Bottom bar */}
                <div style={{ padding: '16px 32px 28px', borderTop: '1px solid #E2DDD8', display: 'flex', gap: 12, flexShrink: 0 }}>
                  <button
                    onClick={() => { setUseCustom(false); setShowCustomPanel(false) }}
                    style={{
                      flex: 1, padding: '13px 0', borderRadius: 8,
                      border: '1px solid #E2DDD8', background: 'white',
                      fontFamily: 'var(--font-manrope), sans-serif',
                      fontSize: 14, fontWeight: 500, color: '#4A5A50', cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => setShowCustomPanel(false)}
                    style={{
                      flex: 1, padding: '13px 0', borderRadius: 8,
                      border: 'none', background: '#0B1E12',
                      fontFamily: 'var(--font-manrope), sans-serif',
                      fontSize: 14, fontWeight: 600, color: 'white', cursor: 'pointer',
                      boxShadow: '0 2px 8px rgba(11,30,18,0.25)',
                    }}
                  >
                    Use this source
                  </button>
                </div>
              </div>
            </div>
          )}

            {/* §4 — Items per session */}
            <div style={{ marginBottom: 40 }}>
              <StepLabel n={useCustom ? 2 : 4} label="Items per session" />
              <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 16 }}>
                <button onClick={() => setCount(c => Math.max(useCustom ? 1 : 4, c - 1))} aria-label="Decrease item count" style={{ width: 40, height: 40, borderRadius: '50%', border: '1px solid #E2DDD8', background: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, color: '#4A5A50', cursor: 'pointer', fontFamily: 'var(--font-manrope)', lineHeight: 1 }}>−</button>
                <span style={{ fontFamily: 'var(--font-fraunces), serif', fontWeight: 700, fontSize: 28, color: '#0B1E12', minWidth: 40, textAlign: 'center' }}>{Math.min(count, maxCount)}</span>
                <button onClick={() => setCount(c => Math.min(maxCount, c + 1))} aria-label="Increase item count" style={{ width: 40, height: 40, borderRadius: '50%', border: '1px solid #E2DDD8', background: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, color: '#4A5A50', cursor: 'pointer', fontFamily: 'var(--font-manrope)', lineHeight: 1 }}>+</button>
                <span style={{ fontFamily: 'var(--font-manrope), sans-serif', fontSize: 13, color: '#8CA090' }}>{useCustom ? `1 – ${maxCount}` : '4 – 20'} items</span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {[5, 10, 15, 20].filter(n => n <= maxCount).map(n => (
                  <button key={n} onClick={() => setCount(n)} style={{ padding: '5px 14px', borderRadius: 20, border: Math.min(count, maxCount) === n ? '1px solid #0B1E12' : '1px solid #E2DDD8', background: Math.min(count, maxCount) === n ? '#0B1E12' : 'white', color: Math.min(count, maxCount) === n ? 'white' : '#4A5A50', fontFamily: 'var(--font-manrope), sans-serif', fontSize: 13, fontWeight: Math.min(count, maxCount) === n ? 600 : 400, cursor: 'pointer', transition: 'all 0.15s' }}>{n}</button>
                ))}
              </div>
            </div>

          </div>{/* end left column */}

          {/* ── RIGHT PANEL (sticky) ─── */}
          <div style={{ position: 'sticky', top: 80, alignSelf: 'start' }}>
            <div style={{ background: 'white', border: '1px solid #E2DDD8', borderRadius: 16, padding: '28px 28px 24px', overflow: 'hidden' }}>

              {/* Eyebrow */}
              <div style={{ fontFamily: 'var(--font-manrope), sans-serif', fontWeight: 700, fontSize: 10, letterSpacing: '1.4px', textTransform: 'uppercase', color: '#8CA090', marginBottom: 18 }}>
                About to begin
              </div>

              {/* Editorial summary */}
              <div style={{ fontFamily: 'var(--font-fraunces), serif', fontWeight: 700, fontSize: 22, lineHeight: 1.3, color: '#0B1E12', marginBottom: 24 }}>
                <span style={{ background: 'linear-gradient(180deg, transparent 58%, #B8E0C2 58%, #B8E0C2 92%, transparent 92%)', padding: '0 2px' }}>{Math.min(count, maxCount)}</span>
                {' '}
                <em style={{ fontStyle: 'italic', color: '#0B1E12' }}>{useCustom ? 'custom' : drillType}</em>
                {' drills in '}
                <em style={{ fontStyle: 'italic', color: '#1F5C3A' }}>{LANGUAGES[language].native}.</em>
              </div>

              {/* Receipt ledger */}
              <div style={{ borderTop: '1px solid #E2DDD8', borderBottom: '1px solid #E2DDD8', marginBottom: 20 }}>
                {[
                  { ref: '§1', label: 'Source', value: useCustom ? `Custom · ${customItems.length || genPreview.length} items` : 'Built-in' },
                  ...(useCustom ? [] : [
                    { ref: '§2', label: 'Topic', value: topic ? (TOPICS[topic]?.label ?? topic) : 'No theme' },
                    { ref: '§3', label: 'Mode', value: DRILL_MODES.find(m => m.type === drillType)?.label ?? drillType },
                  ]),
                  { ref: useCustom ? '§2' : '§4', label: 'Items', value: String(Math.min(count, maxCount)) },
                ].map(({ ref, label, value }, i, arr) => (
                  <div key={ref} style={{ display: 'grid', gridTemplateColumns: '28px 1fr auto', alignItems: 'center', gap: 8, padding: '10px 0', borderBottom: i < arr.length - 1 ? '1px solid #F0EDE8' : 'none' }}>
                    <span style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 10, color: '#8CA090', letterSpacing: '0.04em' }}>{ref}</span>
                    <span style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: 10, color: '#4A5A50', letterSpacing: '0.04em', textTransform: 'uppercase' }}>{label}</span>
                    <span style={{ fontFamily: 'var(--font-manrope), sans-serif', fontSize: 13, color: '#0B1E12', fontWeight: 500, textAlign: 'right' }}>{value}</span>
                  </div>
                ))}
              </div>

              {/* Duration estimate */}
              <div style={{ marginBottom: 20, textAlign: 'center' }}>
                {(() => {
                  const secs = Math.min(count, maxCount) * TIMER_MAX
                  const m = Math.floor(secs / 60)
                  const s = secs % 60
                  const dur = m > 0 ? `~${m}m${s > 0 ? ` ${s}s` : ''}` : `~${s}s`
                  return (
                    <>
                      <span style={{ fontFamily: 'var(--font-fraunces), serif', fontStyle: 'italic', fontSize: 18, color: '#4A5A50', fontWeight: 400 }}>{dur}</span>
                      <span style={{ fontFamily: 'var(--font-manrope), sans-serif', fontSize: 12, color: '#8CA090', marginLeft: 6 }}>estimated</span>
                    </>
                  )
                })()}
              </div>

              {/* Begin button */}
              <button
                onClick={startSession}
                disabled={useCustom && customItems.length === 0 && genPreview.length === 0}
                data-testid="begin-session"
                style={{ width: '100%', padding: '14px 0', borderRadius: 10, border: 'none', background: '#1F5C3A', fontFamily: 'var(--font-manrope), sans-serif', fontSize: 15, fontWeight: 600, color: 'white', cursor: (useCustom && customItems.length === 0 && genPreview.length === 0) ? 'not-allowed' : 'pointer', opacity: (useCustom && customItems.length === 0 && genPreview.length === 0) ? 0.5 : 1, boxShadow: '0 2px 12px rgba(31,92,58,0.25)', letterSpacing: '0.01em' }}
              >
                Begin session →
              </button>

              {/* Footnote */}
              <div style={{ marginTop: 12, fontFamily: 'var(--font-manrope), sans-serif', fontSize: 11, color: '#8CA090', textAlign: 'center', lineHeight: 1.5 }}>
                20s per item · errors shown immediately
              </div>

            </div>
          </div>

        </div>{/* end grid */}
      </div>
    )
  }

  if (!currentItem) return null

  const timerPct = (timeLeft / TIMER_MAX) * 100
  const timerColor = timeLeft <= 5 ? 'var(--incorrect)' : timeLeft <= 10 ? 'var(--timeout)' : 'var(--text-3)'

  // ── Drill screen ──────────────────────────────────────────────
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 'calc(100vh - 60px)' }}>

      {/* Status bar */}
      <div style={{ background: 'var(--surface-1)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        {/* Timer strip */}
        <div style={{ height: 6, background: 'var(--surface-3)' }}>
          <div
            className="timer-drain"
            style={{ height: '100%', width: timerPct + '%', background: timerColor }}
          />
        </div>
        {/* Info bar */}
        <div
          className="mob-status-pad"
          style={{
            maxWidth: 1200,
            margin: '0 auto',
            padding: '0 32px',
            display: 'flex',
            alignItems: 'center',
            gap: 32,
            height: 46,
          }}
        >
          <BarCell label="Type"     value={currentItem.type.charAt(0).toUpperCase() + currentItem.type.slice(1)} />
          <BarCell label="Item"     value={`${index + 1} / ${items.length}`} />
          <BarCell
            label="Accuracy"
            value={accuracy === null ? '—' : accuracy + '%'}
            valueColor={accuracy === null ? undefined : accuracy >= 70 ? 'var(--correct)' : 'var(--incorrect)'}
          />
          <div style={{ marginLeft: 'auto' }}>
            <BarCell
              label="Time"
              value={timeLeft + 's'}
              valueColor={timeLeft <= 5 ? 'var(--incorrect)' : timeLeft <= 10 ? 'var(--timeout)' : undefined}
            />
          </div>
        </div>
      </div>

      {/* Main drill area */}
      <div
        className="mob-drill-pad"
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          maxWidth: 800,
          margin: '0 auto',
          width: '100%',
          padding: '48px 32px 32px',
        }}
      >

        {/* Type badge + instruction */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 36 }}>
          <span
            style={{
              fontFamily: 'var(--font-jetbrains), monospace',
              fontSize: '0.625rem',
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: '#4B5563',
              border: '1px solid #D1D5DB',
              padding: '3px 8px',
              borderRadius: 2,
            }}
          >
            {currentItem.type}
          </span>
          <span
            style={{
              fontFamily: 'var(--font-manrope), sans-serif',
              fontSize: '0.8125rem',
              color: 'var(--text-2)',
            }}
          >
            {currentItem.instruction}
          </span>
        </div>

        {/* Prompt */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 32, marginBottom: 36 }}>
          <div
            style={{
              fontFamily: 'var(--font-manrope), sans-serif',
              fontWeight: 600,
              fontSize: '0.6875rem',
              letterSpacing: '0.10em',
              textTransform: 'uppercase',
              color: '#4B5563',
              marginBottom: 16,
            }}
          >
            Prompt
          </div>
          <div
            data-testid="drill-prompt"
            style={{
              fontFamily: 'var(--font-jetbrains), monospace',
              fontSize: 'clamp(1.375rem, 3vw, 2rem)',
              fontWeight: 400,
              color: 'var(--text-1)',
              lineHeight: 1.4,
              letterSpacing: '-0.01em',
            }}
          >
            {currentItem.prompt}
          </div>
          <button
            onClick={() => speak(currentItem.prompt, currentItem.promptLang)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              marginTop: 14,
              background: 'transparent',
              border: '1px solid var(--border)',
              color: speaking ? 'var(--text-2)' : 'var(--text-3)',
              fontFamily: 'var(--font-manrope), sans-serif',
              fontWeight: 500,
              fontSize: '0.6875rem',
              padding: '5px 12px',
              borderRadius: 3,
              cursor: 'pointer',
            }}
          >
            <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
              <path d="M2 2.5L6 5L2 7.5V2.5Z" fill="currentColor"/>
              <path d="M7.5 3.5C8.1 4.1 8.1 5.9 7.5 6.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
            </svg>
            {speaking ? 'Playing…' : 'Play'}
          </button>
        </div>

        {/* Response input */}
        <div style={{ marginBottom: 20 }}>
          <div
            style={{
              fontFamily: 'var(--font-manrope), sans-serif',
              fontWeight: 600,
              fontSize: '0.6875rem',
              letterSpacing: '0.10em',
              textTransform: 'uppercase',
              color: '#4B5563',
              marginBottom: 12,
            }}
          >
            Response
          </div>
          <input
            ref={inputRef}
            type="text"
            aria-label="Response"
            value={inputVal}
            onChange={e => setInputVal(e.target.value)}
            disabled={submitted}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="Type your answer…"
            className={`w-full border-b-2 px-3 py-2 transition-colors ${
              submitted
                ? 'bg-transparent border-gray-200 cursor-not-allowed'
                : 'bg-slate-50 border-gray-300 focus:border-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900/10 cursor-text'
            } ${!submitted ? 'cursor-blink' : ''}`}
            style={{
              color: submitted ? 'var(--text-3)' : 'var(--text-1)',
              fontFamily: 'var(--font-jetbrains), monospace',
              fontSize: 'clamp(1rem, 2vw, 1.375rem)',
              borderRadius: '4px 4px 0 0',
            }}
          />
        </div>

        {/* Submit row */}
        <div className="mob-btn-row" style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
          <button
            onClick={handleSubmit}
            disabled={submitted}
            className="btn-primary"
          >
            Submit
          </button>
          <button
            onClick={handleSkip}
            disabled={submitted}
            className={`border border-gray-300 bg-transparent rounded-md px-4 py-2 transition-colors ${
              submitted ? 'text-[var(--text-3)] cursor-not-allowed' : 'text-gray-700 hover:bg-gray-100 cursor-pointer'
            }`}
            style={{
              fontFamily: 'var(--font-manrope), sans-serif',
              fontSize: '0.8125rem',
            }}
          >
            Skip
          </button>
          <span
            className="mob-hidden"
            style={{
              marginLeft: 'auto',
              fontFamily: 'var(--font-jetbrains), monospace',
              fontSize: '0.5625rem',
              letterSpacing: '0.06em',
              color: 'var(--text-3)',
            }}
          >
            ↵ submit · esc skip
          </span>
        </div>

        {/* Feedback */}
        {feedback && (
          <div
            data-testid="drill-feedback"
            className="slide-up"
            style={{
              borderLeft: `2px solid ${feedback === 'correct' ? 'var(--correct)' : feedback === 'timeout' ? 'var(--timeout)' : 'var(--incorrect)'}`,
              background: feedback === 'correct' ? 'var(--correct-dim)' : feedback === 'timeout' ? 'var(--timeout-dim)' : 'var(--incorrect-dim)',
              padding: '16px 20px',
              marginBottom: 24,
              borderRadius: '0 4px 4px 0',
            }}
          >
            <div
              style={{
                fontFamily: 'var(--font-manrope), sans-serif',
                fontWeight: 600,
                fontSize: '0.8125rem',
                color: feedback === 'correct' ? 'var(--correct)' : feedback === 'timeout' ? 'var(--timeout)' : 'var(--incorrect)',
                marginBottom: 10,
                letterSpacing: '0.01em',
              }}
            >
              {feedback === 'correct' ? 'Correct.' : feedback === 'timeout' ? 'Time expired.' : 'Incorrect.'}
            </div>
            <FbRow label="Answer" value={expected} />
            {feedback !== 'correct' && <FbRow label="Submitted" value={submittedVal || '[skipped]'} wrong />}
            <button
              onClick={() => { void handleNext() }}
              autoFocus
              style={{
                marginTop: 14,
                background: 'var(--surface-2)',
                color: 'var(--text-2)',
                fontFamily: 'var(--font-manrope), sans-serif',
                fontWeight: 500,
                fontSize: '0.8125rem',
                padding: '8px 18px',
                border: '1px solid var(--border)',
                cursor: 'pointer',
                borderRadius: 3,
              }}
            >
              {index + 1 >= items.length ? 'View results →' : 'Next →'}
            </button>
          </div>
        )}

        {/* Drill Coach — appears after feedback; key resets chat on every new item */}
        {feedback && (
          <DrillCoachPanel
            key={index}
            language={language}
            currentItem={currentItem}
            expectedAnswer={expected}
            submittedVal={submittedVal}
            feedback={feedback}
            results={results}
            items={items}
            itemIndex={index}
            model={aiModel}
          />
        )}

        {/* Progress track */}
        <div style={{ display: 'flex', gap: 2, marginTop: 'auto', paddingTop: 32, flexWrap: 'wrap' }}>
          {items.map((_, i) => {
            let bg = 'var(--surface-3)'
            if (i < index) {
              const r = results[i]
              if (r) bg = r.correct ? 'var(--correct)' : r.timedOut ? 'var(--timeout)' : 'var(--incorrect)'
            } else if (i === index) bg = 'var(--text-1)'
            return <div key={i} style={{ flex: 1, height: 6, background: bg, borderRadius: 3, minWidth: 16 }} />
          })}
        </div>

      </div>
    </div>
  )
}

function BarCell({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div>
      <div style={{ fontFamily: 'var(--font-manrope), sans-serif', fontWeight: 600, fontSize: '0.5625rem', letterSpacing: '0.10em', textTransform: 'uppercase', color: '#4B5563', marginBottom: 2 }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-manrope), sans-serif', fontWeight: 600, fontSize: '0.875rem', color: valueColor ?? 'var(--text-2)' }}>{value}</div>
    </div>
  )
}

function FbRow({ label, value, wrong }: { label: string; value: string; wrong?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 14, marginTop: 4, alignItems: 'baseline' }}>
      <span style={{ fontFamily: 'var(--font-manrope), sans-serif', fontWeight: 500, fontSize: '0.625rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)', width: 72, flexShrink: 0 }}>{label}</span>
      <span style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: '0.875rem', color: wrong ? 'var(--incorrect)' : 'var(--text-2)', textDecoration: wrong ? 'line-through' : undefined }}>{value}</span>
    </div>
  )
}
