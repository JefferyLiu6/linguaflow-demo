'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useEffect } from 'react'
import { loadSessions, resetDemoLocalState } from '@/lib/stats'

export function Nav() {
  const path = usePathname()
  const [streak, setStreak] = useState<number>(0)
  const [isResetting, setIsResetting] = useState(false)

  useEffect(() => {
    loadSessions().then(sessions => {
      const DAY_MS  = 86_400_000
      const todayMs = (() => { const d = new Date(); d.setHours(0,0,0,0); return d.getTime() })()
      const daySet  = new Set(sessions.map(s => { const d = new Date(s.date); d.setHours(0,0,0,0); return d.getTime() }))
      let count  = 0
      let cursor = daySet.has(todayMs) ? todayMs : todayMs - DAY_MS
      while (daySet.has(cursor)) { count++; cursor -= DAY_MS }
      setStreak(count)
    })
  }, [path])

  const handleDemoReset = async () => {
    if (isResetting) return
    const ok = window.confirm('Reset demo data and clear rate limits?')
    if (!ok) return

    setIsResetting(true)
    try {
      await fetch('/api/demo/reset', { method: 'POST' })
    } catch {
      // Continue local reset even if server reset fails.
    }

    resetDemoLocalState()
    setStreak(0)
    window.location.href = '/'
  }

  return (
    <nav
      style={{
        background: 'var(--bg)',
        borderBottom: '1px solid var(--border)',
        position: 'sticky',
        top: 0,
        zIndex: 50,
        flexShrink: 0,
      }}
    >
      <div
        className="mob-nav-pad"
        style={{
          maxWidth: 1200,
          margin: '0 auto',
          padding: '0 32px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          height: 60,
        }}
      >
        {/* Wordmark */}
        <Link href="/" className="flex items-center gap-4 no-underline">
          <Image
            src="/wordmark.png"
            alt="LinguaFlow"
            width={190}
            height={36}
            className="shrink-0 h-9 w-auto"
          />
        </Link>

        {/* Nav links */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {[
            { href: '/drill',     label: 'Train',   mobileHide: false },
            { href: '/library',   label: 'Library', mobileHide: true  },
            { href: '/study',     label: 'Study',   mobileHide: true  },
            { href: '/dashboard', label: 'Results', mobileHide: false },
          ].map(({ href, label, mobileHide }) => {
            const active = path === href || path.startsWith(href + '/')
            return (
              <Link
                key={href}
                href={href}
                className={mobileHide ? 'mob-hidden' : undefined}
                style={{
                  fontFamily: 'var(--font-manrope), sans-serif',
                  fontWeight: 500,
                  fontSize: '0.875rem',
                  color: active ? 'var(--text-1)' : 'var(--text-2)',
                  textDecoration: 'none',
                  padding: '6px 12px',
                  borderRadius: 4,
                  background: active ? 'var(--surface-2)' : 'transparent',
                }}
              >
                {label}
              </Link>
            )
          })}

          {/* Streak badge */}
          {streak > 0 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                marginLeft: 8,
                marginRight: 4,
              }}
            >
              <span style={{ fontSize: '0.75rem', lineHeight: 1 }}>🔥</span>
              <span
                style={{
                  fontFamily: 'var(--font-fraunces), sans-serif',
                  fontWeight: 600,
                  fontSize: '0.875rem',
                  color: '#d97706',
                  letterSpacing: '-0.02em',
                  lineHeight: 1,
                }}
              >
                {streak}
              </span>
              <span
                className="mob-hidden"
                style={{
                  fontFamily: 'var(--font-jetbrains), monospace',
                  fontSize: '0.5625rem',
                  color: '#d97706',
                  opacity: 0.7,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                }}
              >
                day{streak !== 1 ? 's' : ''}
              </span>
            </div>
          )}

          {/* Demo controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 12 }}>
            <span
              style={{
                fontFamily: 'var(--font-jetbrains), monospace',
                fontSize: '0.625rem',
                letterSpacing: '0.10em',
                textTransform: 'uppercase',
                color: '#fff',
                background: '#2DD4BF',
                padding: '3px 8px',
                borderRadius: 3,
              }}
            >
              Demo
            </span>
            <button
              onClick={handleDemoReset}
              disabled={isResetting}
              title="Reset demo state"
              className="mob-hidden"
              style={{
                fontFamily: 'var(--font-jetbrains), monospace',
                fontSize: '0.625rem',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'var(--text-2)',
                background: 'transparent',
                border: '1px solid var(--border)',
                padding: '3px 8px',
                borderRadius: 3,
                cursor: isResetting ? 'not-allowed' : 'pointer',
                opacity: isResetting ? 0.6 : 1,
              }}
            >
              {isResetting ? 'Resetting...' : 'Reset'}
            </button>
          </div>
        </div>
      </div>
    </nav>
  )
}
