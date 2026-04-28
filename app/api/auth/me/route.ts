import { NextResponse } from 'next/server'
import { getAuthState } from '@/lib/auth'
import { applySupabaseResponseHeaders } from '@/lib/supabase/server'

export async function GET() {
  const responseHeaders = new Headers()
  const { user } = await getAuthState({ responseHeaders })
  return applySupabaseResponseHeaders(NextResponse.json(user), responseHeaders)
}
