import type { AuthenticatedUser } from '@/lib/auth'
import { getAuthenticatedUser } from '@/lib/auth'
import { getOrCreateDemoSession } from '@/lib/demoSession'
import { getIp } from '@/lib/rateLimit'

export interface RequestActor {
  ip: string
  kind: 'user' | 'guest'
  actorKey: string
  user: AuthenticatedUser | null
  guestSessionId: string | null
  setGuestCookieHeader?: string
  responseHeaders?: Headers
}

interface ResolveRequestActorOptions {
  responseHeaders?: Headers
}

export async function resolveRequestActor(
  request: Request,
  options?: ResolveRequestActorOptions,
): Promise<RequestActor> {
  const ip = getIp(request)
  const responseHeaders = options?.responseHeaders
  const user = await getAuthenticatedUser({ responseHeaders })

  if (user) {
    return {
      ip,
      kind: 'user',
      actorKey: `user:${user.userId}`,
      user,
      guestSessionId: null,
      responseHeaders,
    }
  }

  const { sessionId, setCookieHeader } = getOrCreateDemoSession(request)
  return {
    ip,
    kind: 'guest',
    actorKey: `guest:${sessionId}`,
    user: null,
    guestSessionId: sessionId,
    setGuestCookieHeader: setCookieHeader,
    responseHeaders,
  }
}
