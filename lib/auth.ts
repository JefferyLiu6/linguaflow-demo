// Demo mode — auth is disabled; all functions are no-ops

export async function getSession(): Promise<null> {
  return null
}

export async function setSessionCookie(
  _userId: string,
  _email: string,
  _name?: string,
): Promise<void> {
  void [_userId, _email, _name]
}

export async function clearSessionCookie(): Promise<void> {}

export async function signToken(_payload: {
  userId: string
  email: string
  name?: string
}): Promise<string> {
  void _payload
  return ''
}

export async function verifyToken(_token: string): Promise<null> {
  void _token
  return null
}
