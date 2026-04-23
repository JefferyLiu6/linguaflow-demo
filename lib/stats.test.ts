import { describe, expect, it } from 'vitest'

import { type SessionRecord } from './drills'
import { computeStats } from './stats'

describe('computeStats', () => {
  it('returns null for an empty session list', () => {
    expect(computeStats([])).toBeNull()
  })

  it('aggregates totals and rounds average time to one decimal place', () => {
    const sessions: SessionRecord[] = [
      {
        id: 's1',
        date: 1,
        drillType: 'sentence',
        correct: 8,
        total: 10,
        accuracy: 80,
        avgTime: 12.34,
        results: [],
        language: 'es',
      },
      {
        id: 's2',
        date: 2,
        drillType: 'vocab',
        correct: 3,
        total: 5,
        accuracy: 60,
        avgTime: 7.76,
        results: [],
        language: 'fr',
      },
    ]

    expect(computeStats(sessions)).toEqual({
      sessions: 2,
      total: 15,
      correct: 11,
      accuracy: 73,
      avgTime: 10.1,
    })
  })

  it('reports zero accuracy when sessions contain zero attempted items', () => {
    const sessions: SessionRecord[] = [
      {
        id: 's-empty',
        date: 1,
        drillType: 'custom',
        correct: 0,
        total: 0,
        accuracy: 0,
        avgTime: 0,
        results: [],
        language: 'en',
      },
    ]

    expect(computeStats(sessions)).toEqual({
      sessions: 1,
      total: 0,
      correct: 0,
      accuracy: 0,
      avgTime: 0,
    })
  })
})
