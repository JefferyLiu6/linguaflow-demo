import { Prisma } from '@prisma/client'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { assertDrillItemArray, assertSessionRecord, isLanguage, normalizeLanguage, sessionRecordToCreateInput } from '@/lib/userData'
import { withAuthenticatedUser } from '@/lib/auth'

type ImportStatus = 'imported' | 'skipped_existing' | 'skipped_empty' | 'failed'

interface ImportResult {
  sessions: ImportStatus
  language: ImportStatus
  customList: ImportStatus
}

export const POST = withAuthenticatedUser(async (request, user) => {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const result: ImportResult = {
    sessions: 'skipped_empty',
    language: 'skipped_empty',
    customList: 'skipped_empty',
  }

  const sessionInputs = Array.isArray(body.sessions) ? body.sessions : []
  if (sessionInputs.length > 0) {
    try {
      const existingCount = await prisma.drillSession.count({ where: { userId: user.userId } })
      if (existingCount > 0) {
        result.sessions = 'skipped_existing'
      } else {
        const sessions = sessionInputs.map(assertSessionRecord)
        if (sessions.length === 0) {
          result.sessions = 'skipped_empty'
        } else {
          await prisma.drillSession.createMany({
            data: sessions.map((session) => sessionRecordToCreateInput(user.userId, session)),
            skipDuplicates: true,
          })
          result.sessions = 'imported'
        }
      }
    } catch {
      result.sessions = 'failed'
    }
  }

  if (isLanguage(body.language)) {
    try {
      const existingSettings = await prisma.userSettings.findUnique({ where: { userId: user.userId } })
      if (existingSettings) {
        result.language = 'skipped_existing'
      } else {
        await prisma.userSettings.create({
          data: { userId: user.userId, language: normalizeLanguage(body.language) },
        })
        result.language = 'imported'
      }
    } catch {
      result.language = 'failed'
    }
  }

  if (Array.isArray(body.customList) && body.customList.length > 0) {
    try {
      const existingCustomList = await prisma.customList.findUnique({ where: { userId: user.userId } })
      if (existingCustomList) {
        result.customList = 'skipped_existing'
      } else {
        const items = assertDrillItemArray(body.customList)
        await prisma.customList.create({
          data: { userId: user.userId, items: items as unknown as Prisma.InputJsonValue },
        })
        result.customList = 'imported'
      }
    } catch {
      result.customList = 'failed'
    }
  }

  return NextResponse.json(result)
})
