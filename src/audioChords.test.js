import { describe, it, expect } from 'vitest'
import { matchChordTemplates } from './audioChords.js'

describe('matchChordTemplates', () => {
  it('matches a C major chroma vector (C, E, G) to C major with high confidence', () => {
    // Chroma index order follows ROOTS: C,C#,D,Eb,E,F,F#,G,Ab,A,Bb,B
    const chroma = [1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0]
    const result = matchChordTemplates(chroma)
    expect(result.root).toBe('C')
    expect(result.qual).toBe('')
    expect(result.confidence).toBeGreaterThan(0.9)
  })

  it('matches an A minor chroma vector (A, C, E) to A minor', () => {
    const chroma = [1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0]
    const result = matchChordTemplates(chroma)
    expect(result.root).toBe('A')
    expect(result.qual).toBe('m')
  })

  it('returns 0 confidence for a silent (all-zero) chroma vector', () => {
    const chroma = Array(12).fill(0)
    const result = matchChordTemplates(chroma)
    expect(result.confidence).toBe(0)
  })
})
