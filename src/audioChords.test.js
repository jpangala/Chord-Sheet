import { describe, it, expect } from 'vitest'
import { matchChordTemplates } from './audioChords.js'
import { matchChordTemplatesRanked } from './audioChords.js'
import { smoothChordSequence } from './audioChords.js'
import { buildDraftSection } from './audioChords.js'

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

describe('matchChordTemplatesRanked', () => {
  const cMajorChroma = [1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0]

  it('returns the same top match as matchChordTemplates', () => {
    const ranked = matchChordTemplatesRanked(cMajorChroma)
    expect(ranked[0].root).toBe('C')
    expect(ranked[0].qual).toBe('')
    expect(ranked[0].confidence).toBeGreaterThan(0.9)
  })

  it('defaults to 3 results, sorted by descending confidence', () => {
    const ranked = matchChordTemplatesRanked(cMajorChroma)
    expect(ranked).toHaveLength(3)
    expect(ranked[0].confidence).toBeGreaterThanOrEqual(ranked[1].confidence)
    expect(ranked[1].confidence).toBeGreaterThanOrEqual(ranked[2].confidence)
  })

  it('respects a custom topN', () => {
    expect(matchChordTemplatesRanked(cMajorChroma, 1)).toHaveLength(1)
    expect(matchChordTemplatesRanked(cMajorChroma, 5)).toHaveLength(5)
  })

  it('returns 0 confidence for every candidate on a silent chroma vector', () => {
    const ranked = matchChordTemplatesRanked(Array(12).fill(0), 5)
    expect(ranked.every((r) => r.confidence === 0)).toBe(true)
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

describe('buildDraftSection', () => {
  const timeSig = '4/4'

  it('returns a default empty 4-bar section for no segments', () => {
    expect(buildDraftSection([], 120, timeSig)).toEqual({ bars: 4, chords: {}, confidence: {} })
  })

  it('places a chord at the beat where each segment starts, at 120 BPM / 4-4', () => {
    // 120 BPM -> 0.5s per beat -> 2s per bar
    const segments = [
      { root: 'C', qual: '', confidence: 0.9, startTime: 0.0, endTime: 2.0 }, // beat 0 -> bar 0 beat 0
      { root: 'G', qual: '', confidence: 0.8, startTime: 2.0, endTime: 4.0 }, // beat 4 -> bar 1 beat 0
    ]
    const result = buildDraftSection(segments, 120, timeSig)
    expect(result.chords['0-0']).toEqual({ root: 'C', qual: '', bass: '' })
    expect(result.chords['1-0']).toEqual({ root: 'G', qual: '', bass: '' })
    expect(result.confidence['0-0']).toBeCloseTo(0.9)
    expect(result.confidence['1-0']).toBeCloseTo(0.8)
    expect(result.bars).toBe(2)
  })

  it('rounds the bar count up to cover a partial final bar', () => {
    // 120 BPM, one segment lasting 3 beats (1.5s) inside a single 4/4 bar
    const segments = [
      { root: 'C', qual: '', confidence: 0.9, startTime: 0.0, endTime: 1.5 },
    ]
    const result = buildDraftSection(segments, 120, timeSig)
    expect(result.bars).toBe(1)
  })
})
