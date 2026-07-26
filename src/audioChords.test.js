import { describe, it, expect } from 'vitest'
import { matchChordTemplates } from './audioChords.js'
import { smoothChordSequence } from './audioChords.js'

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

describe('smoothChordSequence', () => {
  const frameDuration = 0.1 // seconds between frames

  it('returns [] for empty input', () => {
    expect(smoothChordSequence([], frameDuration)).toEqual([])
  })

  it('merges consecutive identical frames into one segment', () => {
    const frames = [
      { time: 0.0, root: 'C', qual: '', confidence: 0.9 },
      { time: 0.1, root: 'C', qual: '', confidence: 0.8 },
      { time: 0.2, root: 'C', qual: '', confidence: 0.85 },
    ]
    const result = smoothChordSequence(frames, frameDuration)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ root: 'C', qual: '', startTime: 0.0, endTime: 0.3 })
    expect(result[0].confidence).toBeCloseTo(0.85, 2)
  })

  it('splits into separate segments on a sustained chord change', () => {
    const frames = [
      { time: 0.0, root: 'C', qual: '', confidence: 0.9 },
      { time: 0.1, root: 'C', qual: '', confidence: 0.9 },
      { time: 0.2, root: 'C', qual: '', confidence: 0.9 },
      { time: 0.3, root: 'G', qual: '', confidence: 0.9 },
      { time: 0.4, root: 'G', qual: '', confidence: 0.9 },
      { time: 0.5, root: 'G', qual: '', confidence: 0.9 },
    ]
    const result = smoothChordSequence(frames, frameDuration)
    expect(result).toHaveLength(2)
    expect(result[0].root).toBe('C')
    expect(result[1].root).toBe('G')
  })

  it('absorbs a single-frame blip into the surrounding longer segment', () => {
    const frames = [
      { time: 0.0, root: 'C', qual: '', confidence: 0.9 },
      { time: 0.1, root: 'C', qual: '', confidence: 0.9 },
      { time: 0.2, root: 'C', qual: '', confidence: 0.9 },
      { time: 0.3, root: 'G', qual: '', confidence: 0.4 }, // 0.1s blip, below the 0.3s threshold
      { time: 0.4, root: 'C', qual: '', confidence: 0.9 },
      { time: 0.5, root: 'C', qual: '', confidence: 0.9 },
    ]
    const result = smoothChordSequence(frames, frameDuration, 0.3)
    expect(result).toHaveLength(1)
    expect(result[0].root).toBe('C')
  })
})
