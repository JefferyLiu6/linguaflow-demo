import { Prisma } from '@prisma/client'
import type { SessionRecord } from '@/lib/drills'
import {
  assertDrillItemArray,
  assertSessionRecord,
  isDrillItemArray,
  isLanguage,
  normalizeLanguage,
  sanitizeDrillResults,
  sanitizeSessionRecord,
  sanitizeSessionRecords,
} from '@/lib/sessionData'

export {
  assertDrillItemArray,
  assertSessionRecord,
  isDrillItemArray,
  isLanguage,
  normalizeLanguage,
  sanitizeSessionRecord,
  sanitizeSessionRecords,
}

export function sessionRecordToCreateInput(userId: string, session: SessionRecord) {
  return {
    userId,
    clientSessionId: session.id,
    date: session.date,
    drillType: session.drillType,
    language: session.language ?? null,
    correct: session.correct,
    total: session.total,
    accuracy: session.accuracy,
    avgTime: session.avgTime,
    results: session.results as unknown as Prisma.InputJsonValue,
  }
}

export function drillSessionToRecord(session: {
  clientSessionId: string
  date: number
  drillType: string
  correct: number
  total: number
  accuracy: number
  avgTime: number
  results: Prisma.JsonValue
  language: string | null
}): SessionRecord {
  const normalized = sanitizeSessionRecord({
    id: session.clientSessionId,
    date: session.date,
    drillType: session.drillType,
    correct: session.correct,
    total: session.total,
    accuracy: session.accuracy,
    avgTime: session.avgTime,
    results: sanitizeDrillResults(session.results),
    language: session.language ?? undefined,
  })

  if (normalized) {
    return normalized
  }

  return {
    id: session.clientSessionId,
    date: session.date,
    drillType: 'mixed',
    correct: session.correct,
    total: session.total,
    accuracy: session.accuracy,
    avgTime: session.avgTime,
    results: [],
    language: isLanguage(session.language) ? session.language : undefined,
  }
}
