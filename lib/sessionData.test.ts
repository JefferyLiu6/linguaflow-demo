import { describe, expect, it } from 'vitest'
import { isSessionRecord, sanitizeSessionRecords } from './sessionData'

describe('sessionData validation', () => {
  it('rejects session payloads with malformed nested drill results', () => {
    expect(
      isSessionRecord({
        id: 'session-1',
        date: 1,
        drillType: 'sentence',
        correct: 1,
        total: 1,
        accuracy: 100,
        avgTime: 5.2,
        results: [{ correct: true }],
        language: 'es',
      }),
    ).toBe(false)
  })

  it('drops malformed nested drill results while preserving valid stored sessions', () => {
    expect(
      sanitizeSessionRecords([
        {
          id: 'session-1',
          date: 1,
          drillType: 'sentence',
          correct: 1,
          total: 2,
          accuracy: 50,
          avgTime: 5.2,
          results: [
            null,
            {
              item: {
                id: 'item-1',
                type: 'translation',
                instruction: 'Translate to Spanish.',
                prompt: 'Hello.',
                answer: 'Hola.',
                promptLang: 'en-US',
              },
              correct: true,
              timedOut: false,
              userAnswer: 'Hola.',
              timeUsed: 5.2,
            },
          ],
          language: 'es',
        },
      ]),
    ).toEqual([
      {
        id: 'session-1',
        date: 1,
        drillType: 'sentence',
        correct: 1,
        total: 2,
        accuracy: 50,
        avgTime: 5.2,
        results: [
          {
            item: {
              id: 'item-1',
              type: 'translation',
              instruction: 'Translate to Spanish.',
              prompt: 'Hello.',
              answer: 'Hola.',
              promptLang: 'en-US',
            },
            correct: true,
            timedOut: false,
            userAnswer: 'Hola.',
            timeUsed: 5.2,
          },
        ],
        language: 'es',
      },
    ])
  })
})
