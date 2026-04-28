import { describe, expect, it } from 'vitest'

import { getCoachReferenceTitle } from './tutorMetadata'

describe('getCoachReferenceTitle', () => {
  it('reads snake_case stream metadata', () => {
    expect(
      getCoachReferenceTitle({
        retrieval_hit: true,
        retrieved_sources: [{ id: 'note_1', title: 'Formal register' }],
      }),
    ).toBe('Formal register')
  })

  it('reads camelCase metadata', () => {
    expect(
      getCoachReferenceTitle({
        retrievalHit: true,
        retrievedSources: [{ id: 'note_2', title: 'Active vs passive voice' }],
      }),
    ).toBe('Active vs passive voice')
  })

  it('returns null when retrieval did not hit', () => {
    expect(
      getCoachReferenceTitle({
        retrieval_hit: false,
        retrieved_sources: [{ id: 'note_1', title: 'Formal register' }],
      }),
    ).toBeNull()
  })

  it('returns null for missing titles', () => {
    expect(
      getCoachReferenceTitle({
        retrieval_hit: true,
        retrieved_sources: [{ id: 'note_1', title: '' }],
      }),
    ).toBeNull()
  })
})
