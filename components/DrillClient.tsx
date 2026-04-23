'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import type { DrillItem, DrillResult, DrillType, DrillTopic, Language } from '@/lib/drills'
import { checkAnswer, buildItems, LANGUAGES, TOPICS } from '@/lib/drills'
import { saveSession, loadLanguage, saveLanguage, loadCustomList, saveCustomList, clearCustomList } from '@/lib/stats'
import DrillCoachPanel from '@/components/DrillCoachPanel'

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

export default function DrillClient({ initialType = 'sentence', initialCount = 10 }: Props) {
  const router = useRouter()

  // Config
  const [drillType, setDrillType] = useState<DrillType>(initialType)
  const [count,     setCount]     = useState(initialCount)
  const [language,  setLanguage]  = useState<Language>('es')
  const [topic,     setTopic]     = useState<DrillTopic | null>(null)

  // Custom list
  const [customItems,    setCustomItems]    = useState<DrillItem[]>([])
  const [useCustom,      setUseCustom]      = useState(false)
  const [customFileName, setCustomFileName] = useState('')
  const [parseError,     setParseError]     = useState('')

  // Custom list — source tabs & AI generation
  const [customTab,     setCustomTab]     = useState<'upload' | 'generate'>('generate')
  const [genMode,       setGenMode]       = useState<'guided' | 'raw'>('guided')
  const [genTopic,      setGenTopic]      = useState('daily')
  const [genDifficulty, setGenDifficulty] = useState('b1')
  const [genGrammar,    setGenGrammar]    = useState('mixed')
  const [genDrillType,  setGenDrillType]  = useState('translation')
  const [genPrompt,     setGenPrompt]     = useState('')
  const [aiModel,       setAiModel]       = useState('openai/gpt-4o-mini')
  const [isGenerating,  setIsGenerating]  = useState(false)
  const [genError,      setGenError]      = useState('')
  const [genPreview,    setGenPreview]    = useState<DrillItem[]>([])

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
          topic:      genTopic,
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

  // On mount, load language and custom list from API
  useEffect(() => {
    ;(async () => {
      const savedLang = await loadLanguage()
      setLanguage(savedLang)
      const savedCustom = await loadCustomList()
      if (savedCustom.length > 0) {
        setCustomItems(savedCustom)
        setUseCustom(true)
        setCustomFileName('(previously uploaded)')
      }
    })()
  }, [])

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

  const handleNext = useCallback(() => {
    const next = index + 1
    if (next >= items.length) {
      const res = resultsRef.current
      const correct = res.filter(r => r.correct).length
      const avgTime = res.length > 0 ? res.reduce((a, r) => a + r.timeUsed, 0) / res.length : 0
      saveSession({
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
        saveCustomList(parsedItems)
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
    return (
      <div className="bg-stone-50 mob-config-pad" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 32px' }}>
        <div style={{ maxWidth: 480, width: '100%' }}>

          {/* Header */}
          <div style={{ marginBottom: 40 }}>
            <h1
              style={{
                fontFamily: 'var(--font-fraunces), sans-serif',
                fontWeight: 600,
                fontSize: '1.75rem',
                letterSpacing: '-0.03em',
                color: 'var(--text-1)',
                lineHeight: 1.2,
                marginBottom: 8,
              }}
            >
              New Session
            </h1>
            <p
              style={{
                fontFamily: 'var(--font-manrope), sans-serif',
                fontSize: '0.875rem',
                color: 'var(--text-2)',
                lineHeight: 1.6,
              }}
            >
              Select a language, drill type, and item count. Timer starts on the first item.
            </p>
          </div>

          {/* Language selector */}
          <div style={{ marginBottom: 28 }}>
            <div
              style={{
                fontFamily: 'var(--font-jetbrains), monospace',
                fontWeight: 500,
                fontSize: '0.75rem',
                letterSpacing: '0.06em',
                color: 'var(--text-2)',
                marginBottom: 10,
              }}
            >
              Language
            </div>
            <div className="grid grid-cols-2 gap-2">
              {(Object.entries(LANGUAGES) as [Language, { name: string; native: string; flag: string }][]).map(([code, info]) => {
                const active = language === code
                return (
                  <button
                    key={code}
                    onClick={() => { setLanguage(code); saveLanguage(code) }}
                    aria-label={`Select ${info.name}`}
                    className={`flex items-center rounded-md transition-all duration-150 cursor-pointer text-left ${
                      active
                        ? 'bg-white border border-gray-200 ring-2 ring-inset ring-gray-900 shadow-sm'
                        : 'bg-white border border-gray-200 hover:border-gray-300 hover:shadow-sm'
                    }`}
                    style={{
                      color: active ? 'var(--text-1)' : 'var(--text-2)',
                      fontFamily: 'var(--font-manrope), sans-serif',
                      fontWeight: active ? 600 : 400,
                      fontSize: '0.875rem',
                      padding: '12px 16px',
                      gap: 10,
                    }}
                  >
                    <span style={{ fontSize: '1.125rem', lineHeight: 1 }}>{info.flag}</span>
                    <span>{info.native}</span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-3)', fontWeight: 400 }}>{info.name}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Drill mode (hidden when custom is active) */}
          {!useCustom && (
            <div style={{ marginBottom: 28 }}>
              <div
                style={{
                  fontFamily: 'var(--font-manrope), sans-serif',
                  fontWeight: 500,
                  fontSize: '0.75rem',
                  color: 'var(--text-2)',
                  marginBottom: 10,
                }}
              >
                Mode
              </div>
              <div className="grid grid-cols-2 gap-2">
                {DRILL_MODES.map(({ type: t, label, desc }) => (
                  <button
                    key={t}
                    onClick={() => setDrillType(t)}
                    aria-label={`Select ${label} mode`}
                    className={`rounded-md transition-all duration-150 cursor-pointer text-left ${
                      drillType === t
                        ? 'bg-white border border-gray-200 ring-2 ring-inset ring-gray-900 shadow-sm'
                        : 'bg-white border border-gray-200 hover:border-gray-300 hover:shadow-sm'
                    }`}
                    style={{
                      color: drillType === t ? 'var(--text-1)' : 'var(--text-2)',
                      fontFamily: 'var(--font-manrope), sans-serif',
                      fontWeight: drillType === t ? 600 : 400,
                      fontSize: '0.875rem',
                      padding: '13px 16px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                      {drillType === t && (
                        <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--text-1)', display: 'block', flexShrink: 0 }} />
                      )}
                      <span>{label}</span>
                    </div>
                    <div style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: '0.5625rem', color: 'var(--text-3)', letterSpacing: '0.04em', paddingLeft: drillType === t ? 13 : 0 }}>
                      {desc}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Topic filter (hidden when custom is active) */}
          {!useCustom && (
            <div style={{ marginBottom: 28 }}>
              <div
                style={{
                  fontFamily: 'var(--font-manrope), sans-serif',
                  fontWeight: 500,
                  fontSize: '0.75rem',
                  color: 'var(--text-2)',
                  marginBottom: 10,
                }}
              >
                Topic
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {([null, ...Object.keys(TOPICS)] as (DrillTopic | null)[]).map(t => {
                  const active = topic === t
                  const info = t ? TOPICS[t] : null
                  return (
                    <button
                      key={t ?? 'none'}
                      onClick={() => setTopic(t)}
                      className={`flex items-center transition-all duration-150 cursor-pointer rounded-full ${
                        active
                          ? 'border border-transparent'
                          : 'border border-gray-200 hover:border-gray-300 hover:shadow-sm'
                      }`}
                      style={{
                        background: active ? 'var(--text-1)' : 'white',
                        color: active ? 'var(--bg)' : 'var(--text-2)',
                        fontFamily: 'var(--font-manrope), sans-serif',
                        fontWeight: active ? 600 : 400,
                        fontSize: '0.8125rem',
                        padding: '6px 14px',
                        gap: 6,
                      }}
                    >
                      {info && (
                        <span style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: '0.75rem', opacity: 0.8 }}>
                          {info.icon}
                        </span>
                      )}
                      {info ? info.label : 'No theme'}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Study material toggle */}
          <div style={{ marginBottom: 28 }}>
            <div
              style={{
                fontFamily: 'var(--font-manrope), sans-serif',
                fontWeight: 500,
                fontSize: '0.75rem',
                color: 'var(--text-2)',
                marginBottom: 10,
              }}
            >
              Study material
            </div>
            <div className="grid grid-cols-2 gap-2" style={{ marginBottom: useCustom ? 12 : 0 }}>
              <button
                onClick={() => setUseCustom(false)}
                className={`flex items-center rounded-md transition-all duration-150 cursor-pointer text-left ${
                  !useCustom
                    ? 'bg-white border border-gray-200 ring-2 ring-inset ring-gray-900 shadow-sm'
                    : 'bg-white border border-gray-200 hover:border-gray-300 hover:shadow-sm'
                }`}
                style={{
                  color: !useCustom ? 'var(--text-1)' : 'var(--text-2)',
                  fontFamily: 'var(--font-manrope), sans-serif',
                  fontWeight: !useCustom ? 600 : 400,
                  fontSize: '0.875rem',
                  padding: '13px 16px',
                  gap: 10,
                }}
              >
                {!useCustom && <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--text-1)', display: 'block', flexShrink: 0 }} />}
                Built-in drills
              </button>
              <button
                onClick={() => setUseCustom(true)}
                className={`flex items-center rounded-md transition-all duration-150 cursor-pointer text-left ${
                  useCustom
                    ? 'bg-white border border-gray-200 ring-2 ring-inset ring-gray-900 shadow-sm'
                    : 'bg-white border border-gray-200 hover:border-gray-300 hover:shadow-sm'
                }`}
                style={{
                  color: useCustom ? 'var(--text-1)' : 'var(--text-2)',
                  fontFamily: 'var(--font-manrope), sans-serif',
                  fontWeight: useCustom ? 600 : 400,
                  fontSize: '0.875rem',
                  padding: '13px 16px',
                  gap: 10,
                }}
              >
                {useCustom && <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--text-1)', display: 'block', flexShrink: 0 }} />}
                Custom list
              </button>
            </div>

            {/* Custom list — tabbed source panel */}
            {useCustom && (
              <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-4 mt-3">

                {/* ── Tab bar ─────────────────────────────────────── */}
                <div className="flex gap-4 border-b border-gray-100 pb-3 mb-4">
                  {(['generate', 'upload'] as const).map(tab => (
                    <button
                      key={tab}
                      onClick={() => setCustomTab(tab)}
                      className={`text-sm font-medium pb-3 -mb-3 border-b-2 transition-colors focus:outline-none ${
                        customTab === tab
                          ? 'border-gray-900 text-gray-900'
                          : 'border-transparent text-gray-500 hover:text-gray-900'
                      }`}
                    >
                      {tab === 'upload' ? 'Upload File' : 'Generate (Local AI)'}
                    </button>
                  ))}
                </div>

                {/* ── Upload tab ──────────────────────────────────── */}
                {customTab === 'upload' && (
                  <>
                    {customItems.length === 0 ? (
                      <>
                        <label className="inline-flex items-center gap-2 border border-gray-200 rounded-md hover:bg-gray-50 hover:border-gray-300 transition-all duration-150 cursor-pointer focus-within:ring-2 focus-within:ring-gray-900"
                          style={{ color: 'var(--text-2)', fontFamily: 'var(--font-manrope), sans-serif', fontWeight: 500, fontSize: '0.8125rem', padding: '8px 16px' }}>
                          Choose file
                          <input type="file" accept=".csv,.json" className="sr-only" onChange={handleFileUpload} />
                        </label>
                        <div className="mt-2.5 font-mono text-[10px] tracking-wide leading-relaxed" style={{ color: 'var(--text-3)' }}>
                          CSV: prompt,answer (one per line) · JSON: [&#123;prompt, answer&#125;]
                        </div>
                      </>
                    ) : (
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div style={{ fontFamily: 'var(--font-manrope), sans-serif', fontWeight: 500, fontSize: '0.8125rem', color: 'var(--text-1)', marginBottom: 2 }}>
                            {customFileName}
                          </div>
                          <div className="font-mono text-[11px]" style={{ color: 'var(--text-3)' }}>
                            {customItems.length} item{customItems.length !== 1 ? 's' : ''}
                          </div>
                        </div>
                        <button
                          onClick={() => { setCustomItems([]); setCustomFileName(''); setParseError(''); clearCustomList() }}
                          className="border border-gray-200 rounded-md hover:bg-gray-50 hover:border-gray-300 transition-all duration-150 cursor-pointer focus:outline-none focus:ring-2 focus:ring-gray-900"
                          style={{ color: 'var(--text-3)', fontFamily: 'var(--font-manrope), sans-serif', fontSize: '0.75rem', padding: '6px 12px' }}
                        >
                          Remove
                        </button>
                      </div>
                    )}
                    {parseError && (
                      <div className="mt-2.5 text-xs" style={{ fontFamily: 'var(--font-manrope), sans-serif', color: 'var(--incorrect)' }}>
                        {parseError}
                      </div>
                    )}
                  </>
                )}

                {/* ── Generate tab ────────────────────────────────── */}
                {customTab === 'generate' && (
                  <>
                    {/* Model picker */}
                    <div className="mb-4">
                      <label className="block text-[10px] font-mono uppercase tracking-wider text-gray-400 mb-1">
                        AI Model
                      </label>
                      <select
                        value={aiModel}
                        onChange={e => setAiModel(e.target.value)}
                        className="border border-gray-200 rounded-md text-sm p-2 w-full font-sans bg-white focus:outline-none focus:ring-2 focus:ring-gray-900 text-gray-700"
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
                      </select>
                    </div>

                    {/* Guided / Raw toggle */}
                    <div className="inline-flex bg-gray-100 rounded-md p-1 mb-4">
                      {(['guided', 'raw'] as const).map(mode => (
                        <button
                          key={mode}
                          onClick={() => setGenMode(mode)}
                          className={`px-3 py-1 text-xs font-medium rounded transition-all focus:outline-none focus:ring-2 focus:ring-gray-900 ${
                            genMode === mode
                              ? 'bg-white shadow-sm text-gray-900'
                              : 'text-gray-500 hover:text-gray-700'
                          }`}
                        >
                          {mode === 'guided' ? 'Guided' : 'Raw Prompt'}
                        </button>
                      ))}
                    </div>

                    {/* ── Guided mode ───────────────────────────── */}
                    {genMode === 'guided' && (
                      <div className="grid grid-cols-2 gap-3">
                        {[
                          {
                            label: 'Topic / Theme',
                            value: genTopic,
                            set: setGenTopic,
                            options: [
                              { v: 'daily',    l: 'Daily Life' },
                              { v: 'tech',     l: 'Technical / Engineering' },
                              { v: 'finance',  l: 'Financial Arbitrage' },
                              { v: 'business', l: 'General Business' },
                            ],
                          },
                          {
                            label: 'Difficulty',
                            value: genDifficulty,
                            set: setGenDifficulty,
                            options: [
                              { v: 'a1', l: 'Beginner A1–A2' },
                              { v: 'b1', l: 'Intermediate B1–B2' },
                              { v: 'c1', l: 'Advanced C1' },
                              { v: 'c2', l: 'Native C2' },
                            ],
                          },
                          {
                            label: 'Grammatical Focus',
                            value: genGrammar,
                            set: setGenGrammar,
                            options: [
                              { v: 'mixed',       l: 'Mixed / All' },
                              { v: 'subjunctive', l: 'Subjunctive Mood' },
                              { v: 'conditional', l: 'Conditionals' },
                              { v: 'pastperf',    l: 'Past Perfect' },
                            ],
                          },
                          {
                            label: 'Drill Type',
                            value: genDrillType,
                            set: setGenDrillType,
                            options: [
                              { v: 'translation',     l: 'Translation' },
                              { v: 'substitution',    l: 'Substitution' },
                              { v: 'transformation',  l: 'Transformation' },
                            ],
                          },
                        ].map(({ label, value, set, options }) => (
                          <div key={label}>
                            <label className="block text-[10px] font-mono uppercase tracking-wider text-gray-400 mb-1">
                              {label}
                            </label>
                            <select
                              value={value}
                              onChange={e => set(e.target.value)}
                              className="border border-gray-200 rounded-md text-sm p-2 w-full font-sans bg-white focus:outline-none focus:ring-2 focus:ring-gray-900 text-gray-700"
                            >
                              {options.map(o => (
                                <option key={o.v} value={o.v}>{o.l}</option>
                              ))}
                            </select>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* ── Raw prompt mode ───────────────────────── */}
                    {genMode === 'raw' && (
                      <textarea
                        value={genPrompt}
                        onChange={e => setGenPrompt(e.target.value)}
                        placeholder="e.g., Generate 10 advanced French substitution drills focusing on explaining reinforcement learning, option pricing, and data analytics..."
                        className="w-full border border-gray-200 rounded-md bg-gray-50 p-3 h-32 font-mono text-sm tracking-tight resize-none focus:outline-none focus:ring-2 focus:ring-gray-900 focus:bg-white transition-all"
                        style={{ color: 'var(--text-1)' }}
                      />
                    )}

                    {/* Generate button — hidden once preview exists */}
                    {genPreview.length === 0 && (
                      <button
                        onClick={handleGenerateDrills}
                        disabled={isGenerating || (genMode === 'raw' && genPrompt.trim() === '')}
                        className="w-full border border-gray-300 bg-white hover:bg-gray-50 text-sm font-medium px-4 py-2 rounded-md transition-colors mt-4 focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        style={{ color: 'var(--text-1)' }}
                      >
                        {isGenerating ? (
                          <>
                            <svg className="w-3.5 h-3.5 animate-spin shrink-0 text-gray-500" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                            </svg>
                            <span className="font-mono uppercase text-xs tracking-wider">Generating…</span>
                          </>
                        ) : (
                          'Generate Drills'
                        )}
                      </button>
                    )}

                    {/* Error */}
                    {genError && (
                      <div className="mt-3 flex items-start gap-2 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                        <span className="text-red-500 mt-px shrink-0">⚠</span>
                        <span className="font-mono text-xs text-red-600 leading-relaxed">{genError}</span>
                      </div>
                    )}

                    {/* Preview ledger */}
                    {genPreview.length > 0 && (
                      <div className="mt-4">
                        {/* Header with inline Regenerate */}
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-mono text-[10px] uppercase tracking-wider text-gray-400">
                            Preview — {genPreview.length} drills generated
                          </span>
                          <button
                            onClick={() => { setGenPreview([]); handleGenerateDrills() }}
                            disabled={isGenerating}
                            className="text-xs font-medium border border-gray-200 bg-white hover:bg-gray-50 px-2 py-1 rounded focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:opacity-50 disabled:cursor-not-allowed"
                            style={{ color: 'var(--text-2)' }}
                          >
                            ↻ Regenerate
                          </button>
                        </div>
                        {/* Dense ledger */}
                        <div className="max-h-56 overflow-y-auto bg-gray-50 border-t border-b border-gray-200 text-sm">
                          {genPreview.map((d, i) => (
                            <div key={i} className="flex items-center gap-3 py-2 px-3 border-b border-gray-100 last:border-0 hover:bg-gray-100/50 transition-colors">
                              <span className="font-mono text-xs text-gray-400 w-4 shrink-0 text-right">{i + 1}</span>
                              <span className="text-gray-500 truncate w-1/2">{d.prompt}</span>
                              <span className="font-mono text-gray-300 shrink-0">-{'>'}</span>
                              <span className="text-gray-900 font-medium truncate w-1/2">{d.answer}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}

              </div>
            )}
          </div>

          {/* Count */}
          <div style={{ marginBottom: 36 }}>
            <div
              style={{
                fontFamily: 'var(--font-manrope), sans-serif',
                fontWeight: 500,
                fontSize: '0.75rem',
                color: 'var(--text-2)',
                marginBottom: 10,
              }}
            >
              Items per session{' '}
              <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>
                {useCustom ? `(1 – ${maxCount})` : '(4 – 20)'}
              </span>
            </div>
            <div className="flex border border-gray-200 rounded-md overflow-hidden bg-white shadow-sm">
              <button
                onClick={() => setCount(c => Math.max(useCustom ? 1 : 4, c - 1))}
                aria-label="Decrease item count"
                className="px-5 py-3 hover:bg-gray-50 text-gray-500 transition-colors cursor-pointer"
                style={{ border: 'none', fontSize: '1.125rem', fontFamily: 'var(--font-manrope)', lineHeight: 1 }}
              >
                −
              </button>
              <span
                className="flex-1 text-center border-l border-r border-gray-200 flex items-center justify-center"
                style={{
                  fontFamily: 'var(--font-jetbrains), monospace',
                  fontSize: '1.125rem',
                  color: 'var(--text-1)',
                  padding: '12px 0',
                }}
              >
                {Math.min(count, maxCount)}
              </span>
              <button
                onClick={() => setCount(c => Math.min(maxCount, c + 1))}
                aria-label="Increase item count"
                className="px-5 py-3 hover:bg-gray-50 text-gray-500 transition-colors cursor-pointer"
                style={{ border: 'none', fontSize: '1.125rem', fontFamily: 'var(--font-manrope)', lineHeight: 1 }}
              >
                +
              </button>
            </div>
          </div>

          {/* Begin */}
          <button
            onClick={startSession}
            disabled={useCustom && customItems.length === 0 && genPreview.length === 0}
            data-testid="begin-session"
            style={{
              width: '100%',
              background: useCustom && customItems.length === 0 && genPreview.length === 0 ? 'var(--surface-2)' : 'var(--text-1)',
              color: useCustom && customItems.length === 0 && genPreview.length === 0 ? 'var(--text-3)' : 'var(--bg)',
              fontFamily: 'var(--font-manrope), sans-serif',
              fontWeight: 600,
              fontSize: '0.9375rem',
              padding: '13px',
              border: 'none',
              cursor: useCustom && customItems.length === 0 && genPreview.length === 0 ? 'not-allowed' : 'pointer',
              borderRadius: 4,
              letterSpacing: '-0.01em',
            }}
          >
            Begin Session
          </button>

          <div
            style={{
              marginTop: 16,
              fontFamily: 'var(--font-jetbrains), monospace',
              fontSize: '0.625rem',
              letterSpacing: '0.06em',
              color: 'var(--text-3)',
              textAlign: 'center',
            }}
          >
            20s per item · errors shown immediately · no partial credit
          </div>

        </div>
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
            style={{
              background: submitted ? 'var(--surface-2)' : 'var(--text-1)',
              color: submitted ? 'var(--text-3)' : 'var(--bg)',
              fontFamily: 'var(--font-manrope), sans-serif',
              fontWeight: 600,
              fontSize: '0.875rem',
              padding: '10px 22px',
              border: 'none',
              cursor: submitted ? 'not-allowed' : 'pointer',
              borderRadius: 3,
            }}
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
