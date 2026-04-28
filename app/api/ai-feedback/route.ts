import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withAuthenticatedUser } from '@/lib/auth'

const VALID_SURFACES = new Set(['tutor', 'study'])

export const POST = withAuthenticatedUser(async (request, user) => {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'Request body must be an object.' }, { status: 400 })
  }

  const b = body as Record<string, unknown>

  const responseId       = b.responseId
  const surface          = b.surface
  const mode             = b.mode
  const helpful          = b.helpful
  const language         = b.language
  const itemId           = b.itemId
  const source           = b.source as Record<string, unknown> | undefined
  const assistantMessage = b.assistantMessage
  const model            = b.model

  if (typeof responseId !== 'string' || !responseId) {
    return NextResponse.json({ error: 'responseId is required.' }, { status: 400 })
  }
  if (typeof surface !== 'string' || !VALID_SURFACES.has(surface)) {
    return NextResponse.json({ error: 'surface must be "tutor" or "study".' }, { status: 400 })
  }
  if (typeof mode !== 'string' || !mode) {
    return NextResponse.json({ error: 'mode is required.' }, { status: 400 })
  }
  if (typeof helpful !== 'boolean') {
    return NextResponse.json({ error: 'helpful must be a boolean.' }, { status: 400 })
  }
  if (typeof language !== 'string' || !language) {
    return NextResponse.json({ error: 'language is required.' }, { status: 400 })
  }
  if (typeof itemId !== 'string' || !itemId) {
    return NextResponse.json({ error: 'itemId is required.' }, { status: 400 })
  }
  if (!source || typeof source.id !== 'string' || !source.id) {
    return NextResponse.json({ error: 'source.id is required.' }, { status: 400 })
  }
  if (typeof assistantMessage !== 'string' || !assistantMessage) {
    return NextResponse.json({ error: 'assistantMessage is required.' }, { status: 400 })
  }
  if (typeof model !== 'string' || !model) {
    return NextResponse.json({ error: 'model is required.' }, { status: 400 })
  }

  const userPrompt = typeof b.userPrompt === 'string' ? b.userPrompt : null

  const data = {
    userId:           user.userId,
    responseId,
    surface,
    mode,
    language,
    itemId,
    sourceId:         source.id,
    sourceTitle:      typeof source.title === 'string' ? source.title : '',
    helpful,
    userPrompt,
    assistantMessage,
    model,
  }

  try {
    await prisma.aiResponseFeedback.upsert({
      where: {
        userId_responseId: {
          userId: user.userId,
          responseId,
        },
      },
      create: data,
      update: data,
    })
  } catch (err) {
    console.error('[ai-feedback] upsert failed:', err)
    const hint =
      err instanceof Error && err.message.includes('does not exist')
        ? ' (migration not applied — run: npx prisma migrate deploy)'
        : ''
    return NextResponse.json(
      { error: `Database error — feedback could not be saved.${hint}` },
      { status: 500 },
    )
  }

  return NextResponse.json({ ok: true })
})
