export interface ClientAuthenticatedUser {
  userId: string
  email: string | null
}

declare global {
  interface Window {
    __LINGUAFLOW_AUTH__?: ClientAuthenticatedUser | null
  }
}

export function getClientAuthenticatedUser(): ClientAuthenticatedUser | null {
  if (typeof window === 'undefined') {
    return null
  }

  return window.__LINGUAFLOW_AUTH__ ?? null
}

export function setClientAuthenticatedUser(user: ClientAuthenticatedUser | null): void {
  if (typeof window === 'undefined') {
    return
  }

  window.__LINGUAFLOW_AUTH__ = user
}
