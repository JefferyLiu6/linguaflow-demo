import type {
  DrillCategory,
  DrillItem,
  DrillResult,
  DrillTopic,
  DrillType,
  Language,
  SessionRecord,
} from '@/lib/drills'

const LANGUAGES = new Set<Language>(['es', 'fr', 'de', 'zh', 'ja', 'ko', 'en'])
const DRILL_TYPES = new Set<DrillType>([
  'sentence',
  'vocab',
  'phrase',
  'mixed',
  'custom',
  'translation',
  'substitution',
  'transformation',
])
const DRILL_ITEM_TYPES = new Set<DrillItem['type']>([
  'translation',
  'substitution',
  'transformation',
])
const DRILL_CATEGORIES = new Set<DrillCategory>(['sentence', 'vocab', 'phrase'])
const DRILL_TOPICS = new Set<DrillTopic>([
  'travel',
  'daily',
  'food',
  'sport',
  'tech',
  'work',
  'health',
  'money',
  'family',
  'nature',
  'education',
  'culture',
  'politics',
  'science',
  'shopping',
  'emergency',
])

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && LANGUAGES.has(value as Language)
}

export function normalizeLanguage(value: unknown, fallback: Language = 'es'): Language {
  return isLanguage(value) ? value : fallback
}

export function isDrillItem(value: unknown): value is DrillItem {
  return (
    isObject(value) &&
    typeof value.id === 'string' &&
    typeof value.instruction === 'string' &&
    typeof value.prompt === 'string' &&
    typeof value.answer === 'string' &&
    typeof value.promptLang === 'string' &&
    typeof value.type === 'string' &&
    DRILL_ITEM_TYPES.has(value.type as DrillItem['type']) &&
    (value.category === undefined ||
      (typeof value.category === 'string' &&
        DRILL_CATEGORIES.has(value.category as DrillCategory))) &&
    (value.topic === undefined ||
      (typeof value.topic === 'string' &&
        DRILL_TOPICS.has(value.topic as DrillTopic))) &&
    (value.variants === undefined || isStringArray(value.variants))
  )
}

export function isDrillResult(value: unknown): value is DrillResult {
  return (
    isObject(value) &&
    isDrillItem(value.item) &&
    typeof value.correct === 'boolean' &&
    typeof value.timedOut === 'boolean' &&
    (value.skipped === undefined || typeof value.skipped === 'boolean') &&
    typeof value.userAnswer === 'string' &&
    isFiniteNumber(value.timeUsed)
  )
}

export function sanitizeDrillResults(value: unknown): DrillResult[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter(isDrillResult)
}

export function isSessionRecord(value: unknown): value is SessionRecord {
  return (
    isObject(value) &&
    typeof value.id === 'string' &&
    isFiniteNumber(value.date) &&
    typeof value.drillType === 'string' &&
    DRILL_TYPES.has(value.drillType as DrillType) &&
    isFiniteNumber(value.correct) &&
    isFiniteNumber(value.total) &&
    isFiniteNumber(value.accuracy) &&
    isFiniteNumber(value.avgTime) &&
    Array.isArray(value.results) &&
    value.results.every(isDrillResult) &&
    (value.language === undefined || isLanguage(value.language))
  )
}

export function sanitizeSessionRecord(value: unknown): SessionRecord | null {
  if (
    !isObject(value) ||
    typeof value.id !== 'string' ||
    !isFiniteNumber(value.date) ||
    typeof value.drillType !== 'string' ||
    !DRILL_TYPES.has(value.drillType as DrillType) ||
    !isFiniteNumber(value.correct) ||
    !isFiniteNumber(value.total) ||
    !isFiniteNumber(value.accuracy) ||
    !isFiniteNumber(value.avgTime)
  ) {
    return null
  }

  return {
    id: value.id,
    date: value.date,
    drillType: value.drillType as DrillType,
    correct: value.correct,
    total: value.total,
    accuracy: value.accuracy,
    avgTime: value.avgTime,
    results: sanitizeDrillResults(value.results),
    language: isLanguage(value.language) ? value.language : undefined,
  }
}

export function sanitizeSessionRecords(value: unknown): SessionRecord[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map(sanitizeSessionRecord)
    .filter((record): record is SessionRecord => record !== null)
}

export function assertSessionRecord(value: unknown): SessionRecord {
  if (!isSessionRecord(value)) {
    throw new Error('Invalid session payload.')
  }
  return value
}

export function isDrillItemArray(value: unknown): value is DrillItem[] {
  return Array.isArray(value) && value.every(isDrillItem)
}

export function assertDrillItemArray(value: unknown): DrillItem[] {
  if (!isDrillItemArray(value)) {
    throw new Error('Invalid custom list payload.')
  }
  return value
}
