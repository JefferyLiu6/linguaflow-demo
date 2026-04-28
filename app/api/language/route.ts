import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { normalizeLanguage } from '@/lib/userData'
import { withAuthenticatedUser } from '@/lib/auth'

export const GET = withAuthenticatedUser(async (_request, user) => {
  const settings = await prisma.userSettings.findUnique({
    where: { userId: user.userId },
  })

  return NextResponse.json({ language: normalizeLanguage(settings?.language) })
})

export const PUT = withAuthenticatedUser(async (request, user) => {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const language = normalizeLanguage(body.language)
  await prisma.userSettings.upsert({
    where: { userId: user.userId },
    create: { userId: user.userId, language },
    update: { language },
  })

  return NextResponse.json({ ok: true })
})
