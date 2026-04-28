'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useEffect } from 'react'
import { ignoreClientAuthExpiredError, loadSessions, resetDemoLocalState } from '@/lib/stats'
import type { ClientAuthenticatedUser } from '@/lib/clientAuth'

interface NavProps {
  initialUser: ClientAuthenticatedUser | null
}

export function Nav({ initialUser }: NavProps) {
  const path = usePathname()
  const [streak, setStreak] = useState<number>(0)
  const [isResetting, setIsResetting] = useState(false)
  const [isLoggingOut, setIsLoggingOut] = useState(false)

  useEffect(() => {
    loadSessions()
      .then((sessions) => {
        const DAY_MS = 86_400_000
        const todayMs = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() })()
        const daySet = new Set(sessions.map((s) => { const d = new Date(s.date); d.setHours(0, 0, 0, 0); return d.getTime() }))
        let count = 0
        let cursor = daySet.has(todayMs) ? todayMs : todayMs - DAY_MS
        while (daySet.has(cursor)) { count++; cursor -= DAY_MS }
        setStreak(count)
      })
      .catch(ignoreClientAuthExpiredError)
  }, [path])

  const handleLogout = async () => {
    if (isLoggingOut) return
    setIsLoggingOut(true)
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } finally {
      window.location.href = '/'
    }
  }

  const handleDemoReset = async () => {
    if (isResetting) return
    const ok = window.confirm('Reset local demo data? This does not clear server-side AI limits.')
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
          height: 60,
        }}
      >
        {/* Left: Wordmark */}
        <div style={{ flex: 1 }}>
          <Link href="/" style={{ display: 'inline-flex', alignItems: 'center', gap: 9, textDecoration: 'none' }}>
            <svg width="28" height="28" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style={{ flexShrink: 0 }}>
              <rect width="36" height="36" rx="8" fill="#1F5C3A"/>
              <path d="M 9 10 L 14.5 10 L 14.5 23.5 L 26.5 23.5 L 26.5 27.5 L 9 27.5 Z" fill="white"/>
              <rect x="7" y="7.5" width="9" height="2.5" rx="1" fill="white"/>
              <rect x="23.5" y="27.5" width="4.5" height="1.5" rx="0.75" fill="white"/>
            </svg>
            <span style={{ fontFamily: 'var(--font-fraunces), serif', fontSize: 17, fontWeight: 700, color: '#0B1E12', letterSpacing: '-0.02em', lineHeight: 1, whiteSpace: 'nowrap' }}>
              Lingua<em style={{ fontStyle: 'italic', color: '#1F5C3A' }}>Flow.</em>
            </span>
          </Link>
        </div>

        {/* Center: Nav links */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
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
                  fontWeight: active ? 600 : 400,
                  fontSize: 14,
                  color: active ? '#0B1E12' : '#4A5A50',
                  textDecoration: 'none',
                  padding: '6px 16px',
                  borderBottom: active ? '2px solid #1F5C3A' : '2px solid transparent',
                }}
              >
                {label}
              </Link>
            )
          })}
        </div>

        {/* Right: Streak + user info */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
          {/* Streak pill */}
          {streak > 0 && (
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '3px 10px',
                borderRadius: 20,
                background: '#FEF3E2',
                border: '1px solid #FDDFA6',
              }}
            >
              <span style={{ fontSize: 12, lineHeight: 1 }}>🔥</span>
              <span style={{ fontFamily: 'var(--font-manrope), sans-serif', fontSize: 12, fontWeight: 800, color: '#E8850A', lineHeight: 1 }}>
                {streak}
              </span>
              <span className="mob-hidden" style={{ fontFamily: 'var(--font-manrope), sans-serif', fontSize: 10, fontWeight: 700, color: '#B8720A', lineHeight: 1 }}>
                DAY
              </span>
            </div>
          )}

          {initialUser ? (
            <>
              <span
                className="mob-hidden"
                style={{
                  fontFamily: 'var(--font-manrope), sans-serif',
                  fontSize: '0.8125rem',
                  color: 'var(--text-2)',
                }}
              >
                {initialUser.email ?? 'Signed in'}
              </span>
              <button
                onClick={handleLogout}
                disabled={isLoggingOut}
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
                  cursor: isLoggingOut ? 'not-allowed' : 'pointer',
                  opacity: isLoggingOut ? 0.6 : 1,
                }}
              >
                {isLoggingOut ? 'Signing out...' : 'Logout'}
              </button>
            </>
          ) : (
            <>
              <span
                style={{
                  fontFamily: 'var(--font-jetbrains), monospace',
                  fontSize: '0.625rem',
                  letterSpacing: '0.10em',
                  textTransform: 'uppercase',
                  color: '#fff',
                  background: '#1F5C3A',
                  padding: '3px 8px',
                  borderRadius: 3,
                }}
              >
                Demo
              </span>
              <Link
                href="/login"
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
                  textDecoration: 'none',
                }}
              >
                Sign In
              </Link>
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
            </>
          )}
        </div>
      </div>
    </nav>
  )
}
