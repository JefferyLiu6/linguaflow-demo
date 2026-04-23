export const DEMO_SESSION_COOKIE = 'linguaflow_demo_sid'
export const DEMO_SESSION_MAX_AGE_S = 24 * 60 * 60

function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.get('cookie') ?? ''
  if (!raw) return null

  for (const entry of raw.split(';')) {
    const [k, ...rest] = entry.trim().split('=')
    if (k === name) {
      const value = rest.join('=').trim()
      return value ? decodeURIComponent(value) : null
    }
  }
  return null
}

function newSessionId(): string {
  return crypto.randomUUID()
}

export function createDemoSession(): {
  sessionId: string
  setCookieHeader: string
} {
  const sessionId = newSessionId()
  const setCookieHeader = `${DEMO_SESSION_COOKIE}=${encodeURIComponent(sessionId)}; Path=/; Max-Age=${DEMO_SESSION_MAX_AGE_S}; SameSite=Lax; HttpOnly`
  return { sessionId, setCookieHeader }
}

export function getOrCreateDemoSession(req: Request): {
  sessionId: string
  setCookieHeader?: string
} {
  const existing = readCookie(req, DEMO_SESSION_COOKIE)
  if (existing) return { sessionId: existing }

  return createDemoSession()
}
