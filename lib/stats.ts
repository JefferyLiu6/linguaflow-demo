import type { SessionRecord, DrillItem, Language } from './drills'
import { getClientAuthenticatedUser, setClientAuthenticatedUser } from './clientAuth'
import { sanitizeSessionRecords } from './sessionData'

const SESSIONS_KEY = 'linguaflow_demo_sessions'
const LANGUAGE_KEY = 'linguaflow_demo_language'
const CUSTOM_KEY = 'linguaflow_demo_custom_list'
const GUEST_DIRTY_STAMP_KEY = 'linguaflow_demo_dirty_stamp'
const IMPORT_DISMISSED_STAMP_KEY = 'linguaflow_import_prompt_dismissed_stamp'

export interface DemoImportPayload {
  sessions?: SessionRecord[]
  language?: Language
  customList?: DrillItem[]
}

export class ClientAuthExpiredError extends Error {
  readonly status: number

  constructor(status: number) {
    super('Your session is no longer valid. Please sign in again.')
    this.name = 'ClientAuthExpiredError'
    this.status = status
  }
}

let authExpiryRedirectStarted = false

function getStorage<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback
  try {
    return JSON.parse(localStorage.getItem(key) ?? JSON.stringify(fallback)) as T
  } catch {
    return fallback
  }
}

function setStorage<T>(key: string, value: T): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Ignore storage errors in demo mode.
  }
}

function isAuthenticatedClient(): boolean {
  return Boolean(getClientAuthenticatedUser()?.userId)
}

async function requestJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      setClientAuthenticatedUser(null)

      if (typeof window !== 'undefined') {
        const loginUrl = '/login?reason=session-expired'
        const alreadyOnExpiredLogin =
          window.location.pathname === '/login' &&
          window.location.search.includes('reason=session-expired')

        if (!alreadyOnExpiredLogin && !authExpiryRedirectStarted) {
          authExpiryRedirectStarted = true
          window.location.assign(loginUrl)
        }
      }

      throw new ClientAuthExpiredError(response.status)
    }

    throw new Error(`Request failed with status ${response.status}`)
  }

  return (await response.json()) as T
}

export function isClientAuthExpiredError(error: unknown): error is ClientAuthExpiredError {
  return error instanceof ClientAuthExpiredError
}

export function ignoreClientAuthExpiredError(error: unknown): void {
  if (isClientAuthExpiredError(error)) {
    return
  }

  throw error
}

function markGuestDataModified(): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem(GUEST_DIRTY_STAMP_KEY, String(Date.now()))
  } catch {
    // Ignore sessionStorage errors.
  }
}

function getRawGuestImportPayload(): DemoImportPayload | null {
  if (typeof window === 'undefined') {
    return null
  }

  const sessions = sanitizeSessionRecords(getStorage<unknown>(SESSIONS_KEY, []))
  const customList = getStorage<DrillItem[]>(CUSTOM_KEY, [])
  const hasLanguagePreference = localStorage.getItem(LANGUAGE_KEY) !== null
  const language = hasLanguagePreference ? getStorage<Language>(LANGUAGE_KEY, 'es') : undefined

  const payload: DemoImportPayload = {}
  if (sessions.length > 0) payload.sessions = sessions
  if (language) payload.language = language
  if (customList.length > 0) payload.customList = customList

  return Object.keys(payload).length > 0 ? payload : null
}

function getGuestDirtyStamp(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return sessionStorage.getItem(GUEST_DIRTY_STAMP_KEY)
  } catch {
    return null
  }
}

export async function loadSessions(): Promise<SessionRecord[]> {
  if (!isAuthenticatedClient()) {
    return sanitizeSessionRecords(getStorage<unknown>(SESSIONS_KEY, []))
  }

  try {
    return sanitizeSessionRecords(await requestJson<unknown>('/api/sessions', { method: 'GET' }))
  } catch (error) {
    if (isClientAuthExpiredError(error)) {
      throw error
    }
    return []
  }
}

export async function saveSession(session: SessionRecord): Promise<void> {
  if (!isAuthenticatedClient()) {
    const existing = sanitizeSessionRecords(getStorage<unknown>(SESSIONS_KEY, []))
    setStorage(SESSIONS_KEY, [session, ...existing])
    markGuestDataModified()
    return
  }

  await requestJson<{ ok: true }>('/api/sessions', {
    method: 'POST',
    body: JSON.stringify(session),
  })
}

const VALID_LANGUAGES = new Set<string>(['es', 'fr', 'de', 'zh', 'ja', 'ko', 'en'])

export function readLanguageSync(): Language {
  if (typeof window === 'undefined') return 'es'
  try {
    const raw = localStorage.getItem(LANGUAGE_KEY)
    if (!raw) return 'es'
    const val = JSON.parse(raw) as string
    return VALID_LANGUAGES.has(val) ? (val as Language) : 'es'
  } catch {
    return 'es'
  }
}

export async function loadLanguage(): Promise<Language> {
  if (!isAuthenticatedClient()) {
    return getStorage<Language>(LANGUAGE_KEY, 'es')
  }

  try {
    const data = await requestJson<{ language: Language }>('/api/language', { method: 'GET' })
    return data.language ?? 'es'
  } catch (error) {
    if (isClientAuthExpiredError(error)) {
      throw error
    }
    return 'es'
  }
}

export async function saveLanguage(lang: Language): Promise<void> {
  if (!isAuthenticatedClient()) {
    setStorage(LANGUAGE_KEY, lang)
    markGuestDataModified()
    return
  }

  await requestJson<{ ok: true }>('/api/language', {
    method: 'PUT',
    body: JSON.stringify({ language: lang }),
  })
}

export async function loadCustomList(): Promise<DrillItem[]> {
  if (!isAuthenticatedClient()) {
    return getStorage<DrillItem[]>(CUSTOM_KEY, [])
  }

  try {
    const data = await requestJson<{ items: DrillItem[] }>('/api/custom-list', { method: 'GET' })
    return Array.isArray(data.items) ? data.items : []
  } catch (error) {
    if (isClientAuthExpiredError(error)) {
      throw error
    }
    return []
  }
}

export async function saveCustomList(items: DrillItem[]): Promise<void> {
  if (!isAuthenticatedClient()) {
    setStorage(CUSTOM_KEY, items)
    markGuestDataModified()
    return
  }

  await requestJson<{ ok: true }>('/api/custom-list', {
    method: 'PUT',
    body: JSON.stringify({ items }),
  })
}

export async function clearCustomList(): Promise<void> {
  if (!isAuthenticatedClient()) {
    setStorage(CUSTOM_KEY, [])
    markGuestDataModified()
    return
  }

  await requestJson<{ ok: true }>('/api/custom-list', { method: 'DELETE' })
}

export function getGuestImportPayload(): DemoImportPayload | null {
  const dirtyStamp = getGuestDirtyStamp()
  if (!dirtyStamp || typeof window === 'undefined') {
    return null
  }

  try {
    const dismissedStamp = sessionStorage.getItem(IMPORT_DISMISSED_STAMP_KEY)
    if (dismissedStamp === dirtyStamp) {
      return null
    }
  } catch {
    return null
  }

  return getRawGuestImportPayload()
}

export function dismissGuestImportPrompt(): void {
  if (typeof window === 'undefined') return
  try {
    const dirtyStamp = sessionStorage.getItem(GUEST_DIRTY_STAMP_KEY)
    if (dirtyStamp) {
      sessionStorage.setItem(IMPORT_DISMISSED_STAMP_KEY, dirtyStamp)
    }
  } catch {
    // Ignore sessionStorage errors.
  }
}

export function clearGuestImportState(): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.removeItem(GUEST_DIRTY_STAMP_KEY)
    sessionStorage.removeItem(IMPORT_DISMISSED_STAMP_KEY)
  } catch {
    // Ignore sessionStorage errors.
  }
}

export function resetDemoLocalState(): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(SESSIONS_KEY)
    localStorage.removeItem(LANGUAGE_KEY)
    localStorage.removeItem(CUSTOM_KEY)
    clearGuestImportState()
  } catch {
    // Ignore storage errors in demo mode reset.
  }
}

export function computeStats(sessions: SessionRecord[]) {
  if (sessions.length === 0) return null
  const total = sessions.reduce((a, s) => a + s.total, 0)
  const correct = sessions.reduce((a, s) => a + s.correct, 0)
  const avgTime = sessions.reduce((a, s) => a + s.avgTime, 0) / sessions.length
  return {
    sessions: sessions.length,
    total,
    correct,
    accuracy: total > 0 ? Math.round((correct / total) * 100) : 0,
    avgTime: Math.round(avgTime * 10) / 10,
  }
}
