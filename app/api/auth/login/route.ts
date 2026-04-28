import { NextResponse } from 'next/server'
import { applySupabaseResponseHeaders, createServerSupabaseClient } from '@/lib/supabase/server'
import { getSupabaseConfig } from '@/lib/supabase/config'

export async function POST(request: Request) {
  if (!getSupabaseConfig()) {
    return NextResponse.json({ error: 'Supabase auth is not configured.' }, { status: 503 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const email = typeof body.email === 'string' ? body.email.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password are required.' }, { status: 400 })
  }

  const responseHeaders = new Headers()
  const supabase = await createServerSupabaseClient({ responseHeaders })
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {
    return applySupabaseResponseHeaders(
      NextResponse.json({ error: error.message }, { status: 400 }),
      responseHeaders,
    )
  }

  return applySupabaseResponseHeaders(
    NextResponse.json({
      userId: data.user?.id ?? null,
      email: data.user?.email ?? null,
    }),
    responseHeaders,
  )
}
