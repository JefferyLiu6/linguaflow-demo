import { Prisma } from '@prisma/client'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { assertDrillItemArray } from '@/lib/userData'
import { withAuthenticatedUser } from '@/lib/auth'

export const GET = withAuthenticatedUser(async (_request, user) => {
  const customList = await prisma.customList.findUnique({
    where: { userId: user.userId },
  })

  return NextResponse.json({ items: Array.isArray(customList?.items) ? customList.items : [] })
})

export const PUT = withAuthenticatedUser(async (request, user) => {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  let items
  try {
    items = assertDrillItemArray(body.items)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Invalid custom list payload.' },
      { status: 400 },
    )
  }

  await prisma.customList.upsert({
    where: { userId: user.userId },
    create: { userId: user.userId, items: items as unknown as Prisma.InputJsonValue },
    update: { items: items as unknown as Prisma.InputJsonValue },
  })

  return NextResponse.json({ ok: true })
})

export const DELETE = withAuthenticatedUser(async (_request, user) => {
  await prisma.customList.deleteMany({
    where: { userId: user.userId },
  })

  return NextResponse.json({ ok: true })
})
