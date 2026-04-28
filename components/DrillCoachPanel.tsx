'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import type { DrillItem, DrillResult, Language } from '@/lib/drills'
import { LANGUAGES } from '@/lib/drills'
import { getCoachReferenceTitle } from '@/lib/tutorMetadata'
import { getClientAuthenticatedUser } from '@/lib/clientAuth'

// ── Types ─────────────────────────────────────────────────────────────────────

interface CoachMessage {
  role: 'user' | 'assistant'
  content: string
  coachReferenceTitle?: string | null
  // Phase 4: feedback metadata (grounded assistant messages only)
  responseId?: string | null
  route?: string | null
  retrievedSources?: { id: string; title: string }[]
  model?: string | null
  userPrompt?: string | null
}

type FeedbackStatus = 'idle' | 'pending' | 'saved' | 'error'
type FeedbackState = { status: FeedbackStatus; err?: string }

async function submitFeedback(payload: {
  responseId: string
  surface: 'tutor'
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

interface Props {
  language:       Language
  currentItem:    DrillItem
  expectedAnswer: string
  submittedVal:   string
  feedback:       'correct' | 'incorrect' | 'timeout'
  results:        DrillResult[]
  items:          DrillItem[]
  itemIndex:      number
  model?:         string
}

type Mode = 'feedback' | 'coach'

// ── SSE streaming helper ──────────────────────────────────────────────────────

async function streamSSE(
  payload: object,
  onToken: (t: string) => void,
  onDone:  (meta: Record<string, unknown>) => void,
  onError: (e: string) => void,
  signal:  AbortSignal,
) {
  const res = await fetch('/api/tutor/stream', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
    signal,
  })
  if (!res.ok || !res.body) {
    onError(`Request failed: ${res.status}`)
    return
  }

  const reader  = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })

    const lines = buf.split('\n')
    buf = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      try {
        const data = JSON.parse(line.slice(6)) as Record<string, unknown>
        if (typeof data.token === 'string') onToken(data.token)
        if (data.done)  onDone(data)
        if (data.error) onError(data.error as string)
      } catch { /* skip malformed line */ }
    }
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

const MSG_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Microsoft YaHei", "Noto Sans JP", "Hiragino Kaku Gothic Pro", "Malgun Gothic", sans-serif'

export default function DrillCoachPanel({
  language,
  currentItem,
  expectedAnswer,
  submittedVal,
  feedback,
  results,
  items,
  itemIndex,
  model = 'openai/gpt-4o-mini',
}: Props) {
  const [mode, setMode] = useState<Mode>('feedback')

  // feedback tab state
  const [feedbackText,      setFeedbackText]      = useState('')
  const [feedbackStreaming,  setFeedbackStreaming]  = useState(false)
  const [feedbackError,     setFeedbackError]     = useState('')

  // coach tab state
  const [messages,       setMessages]       = useState<CoachMessage[]>([])
  const [inputVal,       setInputVal]       = useState('')
  const [coachLoading,   setCoachLoading]   = useState(false)
  const [coachError,     setCoachError]     = useState('')
  const [hintLevel,      setHintLevel]      = useState(0)
  const [streamingMsg,   setStreamingMsg]   = useState('')   // in-flight coach reply
  const [feedbackStates, setFeedbackStates] = useState<Record<number, FeedbackState>>({})
  const isAuthenticated = typeof window !== 'undefined' && getClientAuthenticatedUser() !== null

  const bottomRef  = useRef<HTMLDivElement>(null)
  const inputRef   = useRef<HTMLInputElement>(null)
  const abortRef   = useRef<AbortController | null>(null)

  // scroll to bottom whenever content changes
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, feedbackText, streamingMsg, feedbackStreaming])

  // ── Auto-trigger feedback on new item ─────────────────────────────────────
  useEffect(() => {
    setFeedbackText('')
    setFeedbackError('')
    setMessages([])
    setHintLevel(0)
    setStreamingMsg('')
    setFeedbackStates({})
    setMode('feedback')

    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    setFeedbackStreaming(true)
    let accumulated = ''

    const payload = {
      mode:  'feedback',
      model,
      sessionContext: {
        language:   LANGUAGES[language]?.name ?? language,
        drillType:  currentItem.type,
        itemIndex,
        itemsTotal: items.length,
      },
      currentItem: {
        id:             currentItem.id,
        category:       currentItem.category,
        topic:          currentItem.topic,
        instruction:    currentItem.instruction,
        prompt:         currentItem.prompt,
        type:           currentItem.type,
        expectedAnswer,
        userAnswer:     submittedVal,
        feedback,
      },
      recentItems: results.slice(-5).map(r => ({
        prompt:     r.item.prompt,
        userAnswer: r.userAnswer,
        correct:    r.correct,
        timedOut:   r.timedOut,
      })),
    }

    streamSSE(
      payload,
      (token) => {
        accumulated += token
        setFeedbackText(accumulated)
      },
      () => setFeedbackStreaming(false),
      (err) => {
        setFeedbackError(err)
        setFeedbackStreaming(false)
      },
      ctrl.signal,
    ).catch((err: unknown) => {
      if (err instanceof Error && err.name === 'AbortError') return
      setFeedbackError('Network error — is the Python agent running?')
      setFeedbackStreaming(false)
    })

    return () => ctrl.abort()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemIndex, feedback])

  // ── Send coach message ─────────────────────────────────────────────────────
  const sendCoachMessage = useCallback(async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || coachLoading) return

    const userMsg: CoachMessage = { role: 'user', content: trimmed }
    const nextMsgs = [...messages, userMsg]
    setMessages(nextMsgs)
    setInputVal('')
    setCoachLoading(true)
    setCoachError('')
    setStreamingMsg('')

    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    let accumulated = ''

    const payload = {
      mode:  'tutor',
      model,
      sessionContext: {
        language:   LANGUAGES[language]?.name ?? language,
        drillType:  items[0]?.type ?? 'translation',
        itemIndex,
        itemsTotal: items.length,
      },
      currentItem: {
        id:             currentItem.id,
        category:       currentItem.category,
        topic:          currentItem.topic,
        instruction:    currentItem.instruction,
        prompt:         currentItem.prompt,
        type:           currentItem.type,
        expectedAnswer,
        userAnswer:     submittedVal,
        feedback,
      },
      recentItems: results.slice(-5).map(r => ({
        prompt:     r.item.prompt,
        userAnswer: r.userAnswer,
        correct:    r.correct,
        timedOut:   r.timedOut,
      })),
      messages: nextMsgs,
      constraints: {
        maxCoachTurns:    10,
        maxHintLevel:     3,
        currentHintLevel: hintLevel,
      },
    }

    try {
      await streamSSE(
        payload,
        (token) => {
          accumulated += token
          setStreamingMsg(accumulated)
        },
        (meta) => {
          const isGrounded = meta.retrieval_hit === true
            && Array.isArray(meta.retrieved_sources)
            && (meta.retrieved_sources as { id: string; title: string }[]).length > 0
          setMessages(prev => [
            ...prev,
            {
              role: 'assistant',
              content: accumulated,
              coachReferenceTitle: getCoachReferenceTitle(meta),
              responseId:       isGrounded ? (meta.response_id as string | null ?? null) : null,
              route:            isGrounded ? (meta.route as string | null ?? null) : null,
              retrievedSources: isGrounded
                ? (meta.retrieved_sources as { id: string; title: string }[])
                : undefined,
              model:       model,
              userPrompt:  trimmed,
            },
          ])
          setStreamingMsg('')
          setCoachLoading(false)
          if (typeof meta.hint_level === 'number') setHintLevel(meta.hint_level)
          setTimeout(() => inputRef.current?.focus(), 50)
        },
        (err) => {
          setCoachError(err)
          setMessages(messages) // roll back
          setStreamingMsg('')
          setCoachLoading(false)
        },
        ctrl.signal,
      )
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return
      setCoachError('Network error — is the Python agent running?')
      setMessages(messages)
      setStreamingMsg('')
      setCoachLoading(false)
    }
  }, [
    messages, coachLoading, currentItem, expectedAnswer, submittedVal,
    feedback, results, items, itemIndex, language, model, hintLevel,
  ])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void sendCoachMessage(inputVal)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const feedbackColor = feedback === 'correct' ? 'var(--correct)' : feedback === 'timeout' ? 'var(--timeout)' : 'var(--incorrect)'

  return (
    <div
      style={{
        marginTop: 20,
        border: '1px solid var(--border)',
        borderRadius: 6,
        background: 'var(--surface-1)',
        overflow: 'hidden',
      }}
    >
      {/* ── Header / tab bar ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          borderBottom: '1px solid var(--border)',
          padding: '0 12px',
          gap: 2,
        }}
      >
        {(['feedback', 'coach'] as Mode[]).map(m => (
          <button
            key={m}
            onClick={() => setMode(m)}
            style={{
              fontFamily:    'var(--font-manrope), sans-serif',
              fontWeight:    mode === m ? 600 : 400,
              fontSize:      '0.75rem',
              color:         mode === m ? 'var(--text-1)' : 'var(--text-3)',
              background:    'none',
              border:        'none',
              borderBottom:  mode === m ? '2px solid var(--text-1)' : '2px solid transparent',
              padding:       '9px 10px 7px',
              cursor:        'pointer',
              letterSpacing: '-0.01em',
              transition:    'color 0.1s',
            }}
          >
            {m === 'feedback' ? 'Feedback' : 'Ask Coach'}
          </button>
        ))}
        <span
          style={{
            fontFamily: 'var(--font-jetbrains), monospace',
            fontSize:   '0.5625rem',
            color:      'var(--text-3)',
            marginLeft: 'auto',
          }}
        >
          {model}
        </span>
      </div>

      {/* ── Feedback tab ── */}
      {mode === 'feedback' && (
        <div style={{ padding: '14px 16px' }}>
          {feedbackError ? (
            <div
              style={{
                padding:    '7px 11px',
                background: 'var(--incorrect-dim)',
                border:     '1px solid var(--incorrect)',
                borderRadius: 4,
                fontFamily: 'var(--font-jetbrains), monospace',
                fontSize:   '0.6875rem',
                color:      'var(--incorrect)',
              }}
            >
              {feedbackError}
            </div>
          ) : feedbackText ? (
            <div>
              {/* feedback result badge */}
              <div
                style={{
                  fontFamily:    'var(--font-jetbrains), monospace',
                  fontSize:      '0.5625rem',
                  letterSpacing: '0.10em',
                  textTransform: 'uppercase',
                  color:         feedbackColor,
                  marginBottom:  10,
                  fontWeight:    600,
                }}
              >
                {feedback}
              </div>
              <div
                style={{
                  fontFamily:  MSG_FONT,
                  fontSize:    '0.875rem',
                  lineHeight:  1.6,
                  color:       'var(--text-1)',
                  whiteSpace:  'pre-wrap',
                  wordBreak:   'break-word',
                }}
              >
                {feedbackText}
                {feedbackStreaming && (
                  <span
                    style={{
                      display:    'inline-block',
                      width:      2,
                      height:     '1em',
                      background: 'var(--text-2)',
                      marginLeft: 2,
                      verticalAlign: 'text-bottom',
                      animation:  'blink 0.8s step-end infinite',
                    }}
                  />
                )}
              </div>
              {!feedbackStreaming && (
                <button
                  onClick={() => setMode('coach')}
                  style={{
                    marginTop:  14,
                    background: 'none',
                    border:     'none',
                    padding:    0,
                    fontFamily: 'var(--font-manrope), sans-serif',
                    fontSize:   '0.8125rem',
                    color:      'var(--text-2)',
                    cursor:     'pointer',
                  }}
                >
                  Have a question? Ask the coach →
                </button>
              )}
            </div>
          ) : (
            /* skeleton while waiting for first token */
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <svg
                className="animate-spin"
                width="10" height="10" viewBox="0 0 24 24" fill="none"
                style={{ color: 'var(--text-3)', flexShrink: 0 }}
              >
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span style={{ fontFamily: 'var(--font-manrope), sans-serif', fontSize: '0.75rem', color: 'var(--text-3)' }}>
                Analyzing…
              </span>
            </div>
          )}
        </div>
      )}

      {/* ── Coach tab ── */}
      {mode === 'coach' && (
        <>
          {/* message list */}
          {(messages.length > 0 || coachLoading) && (
            <div
              className="mob-coach-msg"
              style={{
                maxHeight:      260,
                overflowY:      'auto',
                padding:        '12px 14px',
                display:        'flex',
                flexDirection:  'column',
                gap:            8,
              }}
            >
              {messages.map((msg, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                  <div
                    style={{
                      maxWidth:   '84%',
                      padding:    '7px 12px',
                      borderRadius: msg.role === 'user' ? '12px 12px 3px 12px' : '12px 12px 12px 3px',
                      background: msg.role === 'user' ? 'var(--text-1)' : 'white',
                      border:     msg.role === 'assistant' ? '1px solid var(--border)' : 'none',
                      color:      msg.role === 'user' ? 'var(--bg)' : 'var(--text-1)',
                      fontFamily: MSG_FONT,
                      fontSize:   '0.8125rem',
                      lineHeight: 1.55,
                      whiteSpace: 'pre-wrap',
                      wordBreak:  'break-word',
                    }}
                  >
                    {msg.content}
                    {msg.role === 'assistant' && msg.coachReferenceTitle && (
                      <div
                        style={{
                          marginTop: 8,
                          paddingTop: 7,
                          borderTop: '1px solid var(--border)',
                          fontFamily: 'var(--font-manrope), sans-serif',
                          fontSize: '0.6875rem',
                          color: 'var(--text-3)',
                        }}
                      >
                        Coach reference: {msg.coachReferenceTitle}
                      </div>
                    )}
                    {msg.role === 'assistant'
                      && isAuthenticated
                      && msg.responseId
                      && msg.retrievedSources && msg.retrievedSources.length > 0
                      && (() => {
                        const fbState = feedbackStates[i] ?? { status: 'idle' as FeedbackStatus }
                        const fb = fbState.status
                        const source = msg.retrievedSources![0]
                        const sendFeedback = (helpful: boolean) => {
                          if (fb !== 'idle') return
                          setFeedbackStates(prev => ({ ...prev, [i]: { status: 'pending' } }))
                          submitFeedback({
                            responseId:       msg.responseId!,
                            surface:          'tutor',
                            mode:             msg.route ?? 'explain',
                            helpful,
                            language:         LANGUAGES[language]?.name ?? language,
                            itemId:           currentItem.id,
                            source:           { id: source.id, title: source.title },
                            userPrompt:       msg.userPrompt ?? null,
                            assistantMessage: msg.content,
                            model:            msg.model ?? model,
                          })
                            .then(() => setFeedbackStates(prev => ({ ...prev, [i]: { status: 'saved' } })))
                            .catch((e: unknown) => {
                              const err = e instanceof Error ? e.message : 'Unknown error'
                              setFeedbackStates(prev => ({ ...prev, [i]: { status: 'error', err } }))
                            })
                        }
                        return (
                          <div style={{ marginTop: 8, paddingTop: 7, borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
                            {fb === 'saved' ? (
                              <span style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: '0.5625rem', color: 'var(--text-3)', letterSpacing: '0.06em' }}>
                                Saved
                              </span>
                            ) : fb === 'error' ? (
                              <span style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: '0.5625rem', color: 'var(--incorrect)', letterSpacing: '0.06em' }} title={fbState.err}>
                                Error saving{fbState.err ? ` — ${fbState.err}` : ''}
                              </span>
                            ) : (
                              <>
                                <span style={{ fontFamily: 'var(--font-jetbrains), monospace', fontSize: '0.5rem', color: 'var(--text-3)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                                  Helpful?
                                </span>
                                <button
                                  disabled={fb === 'pending'}
                                  onClick={() => sendFeedback(true)}
                                  style={{ background: 'none', border: 'none', cursor: fb === 'pending' ? 'wait' : 'pointer', fontSize: '0.875rem', opacity: fb === 'pending' ? 0.4 : 1, padding: '0 2px' }}
                                  title="Yes, helpful"
                                >
                                  👍
                                </button>
                                <button
                                  disabled={fb === 'pending'}
                                  onClick={() => sendFeedback(false)}
                                  style={{ background: 'none', border: 'none', cursor: fb === 'pending' ? 'wait' : 'pointer', fontSize: '0.875rem', opacity: fb === 'pending' ? 0.4 : 1, padding: '0 2px' }}
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
                </div>
              ))}

              {/* streaming reply bubble */}
              {coachLoading && (
                <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                  <div
                    style={{
                      maxWidth:   '84%',
                      padding:    '7px 12px',
                      borderRadius: '12px 12px 12px 3px',
                      background: 'white',
                      border:     '1px solid var(--border)',
                      color:      'var(--text-1)',
                      fontFamily: MSG_FONT,
                      fontSize:   '0.8125rem',
                      lineHeight: 1.55,
                      whiteSpace: 'pre-wrap',
                      wordBreak:  'break-word',
                      minWidth:   40,
                      minHeight:  28,
                      display:    'flex',
                      alignItems: streamingMsg ? 'flex-start' : 'center',
                    }}
                  >
                    {streamingMsg || (
                      <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                        <svg className="animate-spin" width="10" height="10" viewBox="0 0 24 24" fill="none" style={{ color: 'var(--text-3)' }}>
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        <span style={{ fontFamily: 'var(--font-manrope), sans-serif', fontSize: '0.75rem', color: 'var(--text-3)' }}>Thinking…</span>
                      </div>
                    )}
                    {streamingMsg && (
                      <span
                        style={{
                          display:    'inline-block',
                          width:      2,
                          height:     '1em',
                          background: 'var(--text-2)',
                          marginLeft: 2,
                          verticalAlign: 'text-bottom',
                          animation:  'blink 0.8s step-end infinite',
                        }}
                      />
                    )}
                  </div>
                </div>
              )}

              <div ref={bottomRef} />
            </div>
          )}

          {/* error */}
          {coachError && (
            <div
              style={{
                margin:     '0 14px 10px',
                padding:    '7px 11px',
                background: 'var(--incorrect-dim)',
                border:     '1px solid var(--incorrect)',
                borderRadius: 4,
                fontFamily: 'var(--font-jetbrains), monospace',
                fontSize:   '0.6875rem',
                color:      'var(--incorrect)',
              }}
            >
              {coachError}
            </div>
          )}

          {/* input row */}
          <div style={{ padding: '9px 10px', display: 'flex', gap: 7, alignItems: 'center' }}>
            <input
              ref={inputRef}
              type="text"
              value={inputVal}
              onChange={e => setInputVal(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={coachLoading}
              placeholder={messages.length > 0 ? 'Follow-up question…' : 'Ask for a hint, explanation, or guidance…'}
              autoComplete="off"
              spellCheck={false}
              style={{
                flex:       1,
                background: 'white',
                border:     '1px solid var(--border-mid)',
                borderRadius: 4,
                padding:    '7px 10px',
                fontFamily: 'var(--font-manrope), sans-serif',
                fontSize:   '0.8125rem',
                color:      coachLoading ? 'var(--text-3)' : 'var(--text-1)',
                outline:    'none',
              }}
            />
            <button
              onClick={() => void sendCoachMessage(inputVal)}
              disabled={coachLoading || !inputVal.trim()}
              style={{
                background: coachLoading || !inputVal.trim() ? 'var(--surface-2)' : 'var(--text-1)',
                color:      coachLoading || !inputVal.trim() ? 'var(--text-3)' : 'var(--bg)',
                border:     'none',
                borderRadius: 4,
                padding:    '7px 14px',
                fontFamily: 'var(--font-manrope), sans-serif',
                fontWeight: 600,
                fontSize:   '0.8125rem',
                cursor:     coachLoading || !inputVal.trim() ? 'not-allowed' : 'pointer',
                flexShrink: 0,
              }}
            >
              {coachLoading ? '…' : 'Ask'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
