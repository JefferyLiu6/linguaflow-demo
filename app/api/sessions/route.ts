import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { assertSessionRecord, drillSessionToRecord, sessionRecordToCreateInput } from '@/lib/userData'
import { withAuthenticatedUser } from '@/lib/auth'

export const GET = withAuthenticatedUser(async (_request, user) => {
  const sessions = await prisma.drillSession.findMany({
    where: { userId: user.userId },
    orderBy: { date: 'desc' },
  })

  return NextResponse.json(sessions.map(drillSessionToRecord))
})

export const POST = withAuthenticatedUser(async (request, user) => {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  let session
  try {
    session = assertSessionRecord(body)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Invalid session payload.' },
      { status: 400 },
    )
  }

  const data = sessionRecordToCreateInput(user.userId, session)
  await prisma.drillSession.upsert({
    where: {
      userId_clientSessionId: {
        userId: user.userId,
        clientSessionId: session.id,
      },
    },
    create: data,
    update: data,
  })

  return NextResponse.json({ ok: true })
})
