import { NextResponse } from 'next/server'
import { applySupabaseResponseHeaders, createServerSupabaseClient } from '@/lib/supabase/server'
import { getSupabaseConfig } from '@/lib/supabase/config'

export async function POST() {
  if (!getSupabaseConfig()) {
    return NextResponse.json({ ok: true })
  }

  const responseHeaders = new Headers()
  const supabase = await createServerSupabaseClient({ responseHeaders })
  const { error } = await supabase.auth.signOut()
  if (error) {
    return applySupabaseResponseHeaders(
      NextResponse.json({ error: error.message }, { status: 400 }),
      responseHeaders,
    )
  }

  return applySupabaseResponseHeaders(
    NextResponse.json({ ok: true }),
    responseHeaders,
  )
}
