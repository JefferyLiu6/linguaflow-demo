'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { clearGuestImportState, dismissGuestImportPrompt, getGuestImportPayload, resetDemoLocalState } from '@/lib/stats'

type AuthMode = 'login' | 'register'
type ImportStatus = 'imported' | 'skipped_existing' | 'skipped_empty' | 'failed'

interface ImportResult {
  sessions: ImportStatus
  language: ImportStatus
  customList: ImportStatus
}

export default function LoginPage() {
  const router = useRouter()
  const [mode, setMode] = useState<AuthMode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [importBusy, setImportBusy] = useState(false)
  const [error, setError] = useState('')
  const [importPromptOpen, setImportPromptOpen] = useState(false)
  const [sessionExpired, setSessionExpired] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    setSessionExpired(new URLSearchParams(window.location.search).get('reason') === 'session-expired')
  }, [])

  const finishAuthFlow = () => {
    window.location.href = '/dashboard'
  }

  const handleAuthSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) return

    setBusy(true)
    setError('')

    try {
      const response = await fetch(mode === 'login' ? '/api/auth/login' : '/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = (await response.json()) as { error?: string }
      if (!response.ok) {
        setError(data.error ?? 'Authentication failed.')
        return
      }

      if (getGuestImportPayload()) {
        setImportPromptOpen(true)
        return
      }

      finishAuthFlow()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Authentication failed.')
    } finally {
      setBusy(false)
    }
  }

  const handleImport = async () => {
    const payload = getGuestImportPayload()
    if (!payload || importBusy) {
      finishAuthFlow()
      return
    }

    setImportBusy(true)
    setError('')

    try {
      const response = await fetch('/api/import-demo-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const result = (await response.json()) as ImportResult & { error?: string }
      if (!response.ok) {
        setError(result.error ?? 'Import failed.')
        return
      }

      const hasFailure = Object.values(result).some((status) => status === 'failed')
      if (!hasFailure) {
        resetDemoLocalState()
        clearGuestImportState()
      }

      finishAuthFlow()
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : 'Import failed.')
    } finally {
      setImportBusy(false)
    }
  }

  const handleSkipImport = () => {
    dismissGuestImportPrompt()
    setImportPromptOpen(false)
    finishAuthFlow()
  }

  const importPayload = getGuestImportPayload()

  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 24px' }}>
        <div style={{ width: '100%', maxWidth: 420 }}>
          <Link href="/" style={{ display: 'inline-block', marginBottom: 32, textDecoration: 'none' }}>
            <Image
              src="/wordmark.svg"
              alt="LinguaFlow"
              width={228}
              height={42}
              priority
              style={{ width: 228, height: 42 }}
            />
          </Link>

        <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
          {(['login', 'register'] as const).map((value) => (
            <button
              key={value}
              onClick={() => { setMode(value); setError('') }}
              style={{
                flex: 1,
                border: '1px solid var(--border)',
                borderRadius: 4,
                padding: '10px 14px',
                fontFamily: 'var(--font-manrope), sans-serif',
                fontSize: '0.875rem',
                fontWeight: value === mode ? 600 : 500,
                background: value === mode ? 'var(--text-1)' : 'transparent',
                color: value === mode ? 'var(--bg)' : 'var(--text-2)',
                cursor: 'pointer',
              }}
            >
              {value === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          ))}
        </div>

        <h1
          style={{
            fontFamily: 'var(--font-fraunces), sans-serif',
            fontWeight: 600,
            fontSize: '1.75rem',
            letterSpacing: '-0.03em',
            color: 'var(--text-1)',
            marginBottom: 12,
            lineHeight: 1.2,
          }}
        >
          {importPromptOpen ? 'Import guest data?' : mode === 'login' ? 'Sign in.' : 'Create an account.'}
        </h1>

        <p
          style={{
            fontFamily: 'var(--font-manrope), sans-serif',
            fontSize: '0.9375rem',
            color: 'var(--text-2)',
            lineHeight: 1.6,
            marginBottom: 28,
          }}
        >
          {importPromptOpen
            ? 'Your current guest browser data can be moved into this account.'
            : 'Guests can still train without signing in. Accounts keep results, language preference, and one custom list across visits.'}
        </p>

        {error && (
          <div
            style={{
              marginBottom: 20,
              border: '1px solid #fecaca',
              background: '#fef2f2',
              color: '#991b1b',
              borderRadius: 4,
              padding: '10px 12px',
              fontFamily: 'var(--font-manrope), sans-serif',
              fontSize: '0.8125rem',
            }}
          >
            {error}
          </div>
        )}

        {!error && sessionExpired && (
          <div
            style={{
              marginBottom: 20,
              border: '1px solid #fde68a',
              background: '#fffbeb',
              color: '#92400e',
              borderRadius: 4,
              padding: '10px 12px',
              fontFamily: 'var(--font-manrope), sans-serif',
              fontSize: '0.8125rem',
            }}
          >
            Your session expired. Sign in again to continue with saved progress.
          </div>
        )}

        {importPromptOpen ? (
          <div style={{ border: '1px solid var(--border)', borderRadius: 6, padding: 20, background: 'var(--surface-1)' }}>
            <div
              style={{
                fontFamily: 'var(--font-jetbrains), monospace',
                fontSize: '0.625rem',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'var(--text-3)',
                marginBottom: 14,
              }}
            >
              Guest Data Detected
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text-2)', fontFamily: 'var(--font-manrope), sans-serif', fontSize: '0.875rem', lineHeight: 1.6 }}>
              {importPayload?.sessions && <li>{importPayload.sessions.length} saved session{importPayload.sessions.length !== 1 ? 's' : ''}</li>}
              {importPayload?.language && <li>Selected language preference</li>}
              {importPayload?.customList && <li>{importPayload.customList.length} custom list item{importPayload.customList.length !== 1 ? 's' : ''}</li>}
            </ul>
            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
              <button
                onClick={() => void handleImport()}
                disabled={importBusy}
                style={{
                  flex: 1,
                  background: 'var(--text-1)',
                  color: 'var(--bg)',
                  border: 'none',
                  borderRadius: 4,
                  padding: '11px 16px',
                  fontFamily: 'var(--font-manrope), sans-serif',
                  fontWeight: 600,
                  cursor: importBusy ? 'not-allowed' : 'pointer',
                  opacity: importBusy ? 0.7 : 1,
                }}
              >
                {importBusy ? 'Importing...' : 'Import'}
              </button>
              <button
                onClick={handleSkipImport}
                disabled={importBusy}
                style={{
                  flex: 1,
                  background: 'transparent',
                  color: 'var(--text-2)',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  padding: '11px 16px',
                  fontFamily: 'var(--font-manrope), sans-serif',
                  fontWeight: 600,
                  cursor: importBusy ? 'not-allowed' : 'pointer',
                }}
              >
                Skip
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleAuthSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontFamily: 'var(--font-manrope), sans-serif', fontSize: '0.8125rem', color: 'var(--text-2)' }}>Email</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                required
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  padding: '11px 12px',
                  fontFamily: 'var(--font-manrope), sans-serif',
                  fontSize: '0.9375rem',
                }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontFamily: 'var(--font-manrope), sans-serif', fontSize: '0.8125rem', color: 'var(--text-2)' }}>Password</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                required
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  padding: '11px 12px',
                  fontFamily: 'var(--font-manrope), sans-serif',
                  fontSize: '0.9375rem',
                }}
              />
            </label>

            <button
              type="submit"
              disabled={busy}
              style={{
                marginTop: 8,
                background: 'var(--text-1)',
                color: 'var(--bg)',
                border: 'none',
                borderRadius: 4,
                padding: '12px 16px',
                fontFamily: 'var(--font-manrope), sans-serif',
                fontWeight: 600,
                cursor: busy ? 'not-allowed' : 'pointer',
                opacity: busy ? 0.7 : 1,
              }}
            >
              {busy ? 'Working...' : mode === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          </form>
        )}

        <div style={{ marginTop: 28, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Link
            href="/drill"
            style={{
              fontFamily: 'var(--font-manrope), sans-serif',
              fontSize: '0.875rem',
              color: 'var(--text-2)',
              textDecoration: 'none',
            }}
          >
            Continue in demo
          </Link>
          <button
            onClick={() => router.push('/')}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-3)',
              fontFamily: 'var(--font-jetbrains), monospace',
              fontSize: '0.625rem',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              cursor: 'pointer',
            }}
          >
            Back
          </button>
        </div>
      </div>
    </div>
  )
}
