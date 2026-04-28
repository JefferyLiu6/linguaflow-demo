import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionRecord } from './drills'
import {
  clearGuestImportState,
  ClientAuthExpiredError,
  dismissGuestImportPrompt,
  getGuestImportPayload,
  loadSessions,
  saveSession,
} from './stats'

class MemoryStorage {
  private store = new Map<string, string>()

  getItem(key: string) {
    return this.store.get(key) ?? null
  }

  setItem(key: string, value: string) {
    this.store.set(key, value)
  }

  removeItem(key: string) {
    this.store.delete(key)
  }

  clear() {
    this.store.clear()
  }
}

const localStorageMock = new MemoryStorage()
const sessionStorageMock = new MemoryStorage()
let assignLocationMock: ReturnType<typeof vi.fn>

const sessionRecord: SessionRecord = {
  id: 'session-1',
  date: 1,
  drillType: 'phrase',
  correct: 4,
  total: 4,
  accuracy: 100,
  avgTime: 8.5,
  results: [],
  language: 'es',
}

beforeEach(() => {
  assignLocationMock = vi.fn()
  Object.defineProperty(globalThis, 'window', {
    value: globalThis,
    configurable: true,
  })
  Object.defineProperty(globalThis, 'localStorage', {
    value: localStorageMock,
    configurable: true,
  })
  Object.defineProperty(globalThis, 'sessionStorage', {
    value: sessionStorageMock,
    configurable: true,
  })
  Object.defineProperty(globalThis, 'location', {
    value: {
      pathname: '/dashboard',
      search: '',
      assign: assignLocationMock,
    },
    configurable: true,
  })
  window.__LINGUAFLOW_AUTH__ = null
  localStorageMock.clear()
  sessionStorageMock.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('stats auth-aware storage', () => {
  it('reads guest sessions from localStorage and marks guest data for import prompts', async () => {
    await saveSession(sessionRecord)

    await expect(loadSessions()).resolves.toEqual([sessionRecord])
    expect(getGuestImportPayload()).toEqual({
      sessions: [sessionRecord],
    })

    dismissGuestImportPrompt()
    expect(getGuestImportPayload()).toBeNull()

    clearGuestImportState()
    expect(getGuestImportPayload()).toBeNull()
  })

  it('sanitizes malformed nested guest results loaded from localStorage', async () => {
    localStorage.setItem(
      'linguaflow_demo_sessions',
      JSON.stringify([
        {
          id: 'bad-session',
          date: 3,
          drillType: 'phrase',
          correct: 1,
          total: 2,
          accuracy: 50,
          avgTime: 8.1,
          results: [{ correct: true }],
          language: 'es',
        },
        sessionRecord,
      ]),
    )

    await expect(loadSessions()).resolves.toEqual([
      {
        ...sessionRecord,
        id: 'bad-session',
        date: 3,
        correct: 1,
        total: 2,
        accuracy: 50,
        avgTime: 8.1,
        results: [],
      },
      sessionRecord,
    ])
  })

  it('posts authenticated session writes to the server route instead of localStorage', async () => {
    window.__LINGUAFLOW_AUTH__ = { userId: 'user-1', email: 'learner@example.com' }
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    await saveSession(sessionRecord)

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/sessions',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(sessionRecord),
      }),
    )
    expect(localStorageMock.getItem('linguaflow_demo_sessions')).toBeNull()
  })

  it('redirects authenticated clients to login instead of collapsing into empty state on 401', async () => {
    window.__LINGUAFLOW_AUTH__ = { userId: 'user-1', email: 'learner@example.com' }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    await expect(loadSessions()).rejects.toBeInstanceOf(ClientAuthExpiredError)
    expect(window.__LINGUAFLOW_AUTH__).toBeNull()
    expect(assignLocationMock).toHaveBeenCalledWith('/login?reason=session-expired')
  })
})
