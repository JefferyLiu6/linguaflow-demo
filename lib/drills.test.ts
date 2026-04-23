import { describe, expect, it } from 'vitest'

import { buildItems, checkAnswer, getDB, normalizeAnswer, type DrillItem } from './drills'

describe('normalizeAnswer', () => {
  it('normalizes case, spacing, and terminal punctuation', () => {
    expect(normalizeAnswer('  Hello,   WORLD!?  ')).toBe('hello, world')
  })

  it('strips inverted punctuation without removing internal accents', () => {
    expect(normalizeAnswer(' ¿Dónde   está el hotel? ')).toBe('dónde está el hotel')
  })
})

describe('checkAnswer', () => {
  const item: DrillItem = {
    id: 'test-1',
    type: 'translation',
    instruction: 'Translate to Spanish.',
    prompt: 'Where is the hotel?',
    answer: '¿Dónde está el hotel?',
    variants: ['Donde esta el hotel'],
    promptLang: 'en-US',
  }

  it('accepts normalized matches against the primary answer', () => {
    expect(checkAnswer('dónde está el hotel', item)).toBe(true)
  })

  it('accepts configured variants', () => {
    expect(checkAnswer('  donde esta el hotel  ', item)).toBe(true)
  })

  it('rejects incorrect answers', () => {
    expect(checkAnswer('¿Dónde está la estación?', item)).toBe(false)
  })
})

describe('buildItems', () => {
  it('returns only vocab items for vocab mode', () => {
    const items = buildItems('vocab', 5, 'es')

    expect(items).toHaveLength(5)
    expect(items.every(item => item.category === 'vocab')).toBe(true)
  })

  it('applies type and topic filters together', () => {
    const items = buildItems('translation', 50, 'es', undefined, 'travel')
    const expectedMax = getDB('es').filter(
      item => item.type === 'translation' && item.topic === 'travel',
    ).length

    expect(items.length).toBe(expectedMax)
    expect(items.every(item => item.type === 'translation' && item.topic === 'travel')).toBe(true)
  })

  it('returns custom items up to the requested count', () => {
    const customItems: DrillItem[] = [
      {
        id: 'custom-1',
        type: 'translation',
        instruction: 'Translate the term.',
        prompt: 'hello',
        answer: 'hola',
        promptLang: 'en-US',
      },
      {
        id: 'custom-2',
        type: 'translation',
        instruction: 'Translate the term.',
        prompt: 'goodbye',
        answer: 'adiós',
        promptLang: 'en-US',
      },
    ]

    const items = buildItems('custom', 5, 'es', customItems)

    expect(items).toHaveLength(2)
    expect(new Set(items.map(item => item.id))).toEqual(new Set(['custom-1', 'custom-2']))
  })
})
