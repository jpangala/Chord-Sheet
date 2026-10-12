import { describe, it, expect } from 'vitest'
import {
  cleanNotes, suppressHarmonics, monophonize, chordShare, extractLine, fingerLine, buildLine,
} from './noteLine.js'
import { INSTRUMENTS } from './instruments.js'
import { loudnessEnvelope } from './loudness.js'

const STD = INSTRUMENTS.guitar.tunings.standard.strings
const BASS4 = INSTRUMENTS.bass.tunings.standard4.strings
const seq = (midis, d = 0.25) => midis.map((midi, i) => ({ midi, start: i * d, end: i * d + d * 0.9, amp: 0.8 }))
const fmt = (positions) => positions.map((p) => `${p.string}:${p.fret}`).join(' ')
const brief = (line) => line.map((n) => `${n.midi}@${n.start}-${n.end}`).join(' ')

describe('cleanNotes', () => {
  it('drops out-of-range, quiet and very short notes, sorted by start', () => {
    const out = cleanNotes([
      { midi: 52, start: 0.5, end: 1, amp: 0.8 },
      { midi: 30, start: 0, end: 1, amp: 0.8 },    // below range
      { midi: 55, start: 0, end: 1, amp: 0.1 },    // too quiet
      { midi: 57, start: 0, end: 0.03, amp: 0.8 }, // too short
      { midi: 48, start: 0.2, end: 1, amp: 0.8 },
    ], [40, 84])
    expect(out.map((n) => n.midi)).toEqual([48, 52])
  })
  it('respects a custom minAmp', () => {
    expect(cleanNotes([{ midi: 48, start: 0, end: 1, amp: 0.25 }], [40, 84], { minAmp: 0.2 })).toHaveLength(1)
  })
})

describe('isolated source: suppressHarmonics + monophonize', () => {
  const iso = (notes) => brief(monophonize(suppressHarmonics(notes)))
  it('removes octave/12th ghosts reported with the real note', () => {
    expect(iso([
      { midi: 57, start: 0, end: 0.5, amp: 0.8 }, { midi: 69, start: 0.01, end: 0.4, amp: 0.3 },
      { midi: 60, start: 0.5, end: 1, amp: 0.8 }, { midi: 79, start: 0.52, end: 0.8, amp: 0.35 },
    ])).toBe('57@0-0.5 60@0.5-1')
  })
  it('the newest note wins over an earlier note that is still ringing', () => {
    expect(iso([
      { midi: 45, start: 0, end: 2, amp: 0.7 }, { midi: 52, start: 0.5, end: 1, amp: 0.6 },
      { midi: 57, start: 1, end: 1.5, amp: 0.6 },
    ])).toBe('45@0-0.5 52@0.5-1 57@1-1.5')
  })
  it('keeps a real octave jump (different onset times)', () => {
    expect(iso([{ midi: 45, start: 0, end: 1, amp: 0.8 }, { midi: 57, start: 0.5, end: 1, amp: 0.6 }]))
      .toBe('45@0-0.5 57@0.5-1')
  })
  it('collapses near-simultaneous onsets to the loudest note', () => {
    expect(iso([{ midi: 45, start: 0, end: 1, amp: 0.5 }, { midi: 52, start: 0.01, end: 1, amp: 0.9 }]))
      .toBe('52@0.01-1')
  })
  it('monophonize returns [] for no notes', () => expect(monophonize([])).toEqual([]))
})

describe('chordShare', () => {
  it('is 1 for strummed triads and 0 for a single-note line', () => {
    const strums = [0, 1, 2].flatMap((t) => [48, 52, 55].map((midi, i) => ({ midi, start: t + i * 0.01, end: t + 1, amp: 0.7 })))
    expect(chordShare(strums)).toBe(1)
    expect(chordShare(seq([40, 43, 45]))).toBe(0)
    expect(chordShare([])).toBe(0)
  })
})

describe('extractLine (full-song source)', () => {
  // Bass A1→G1, chords above, melody A4 B4 C5 on top
  const mix = [
    { midi: 33, start: 0, end: 1, amp: 0.8 }, { midi: 57, start: 0, end: 1, amp: 0.5 },
    { midi: 61, start: 0, end: 1, amp: 0.5 }, { midi: 64, start: 0, end: 1, amp: 0.5 },
    { midi: 31, start: 1, end: 2, amp: 0.8 }, { midi: 55, start: 1, end: 2, amp: 0.5 },
    { midi: 59, start: 1, end: 2, amp: 0.5 }, { midi: 62, start: 1, end: 2, amp: 0.5 },
    { midi: 69, start: 0.2, end: 0.5, amp: 0.7 }, { midi: 71, start: 0.5, end: 0.8, amp: 0.7 },
    { midi: 72, start: 0.8, end: 1.6, amp: 0.7 },
  ]
  it('lowest follows the bass line', () => {
    expect(brief(extractLine(mix, 'lowest'))).toBe('33@0-1 31@1-2')
  })
  it('highest follows the top line', () => {
    expect(brief(extractLine(mix, 'highest'))).toBe('64@0-0.2 69@0.2-0.5 71@0.5-0.8 72@0.8-1.6 62@1.6-2')
  })
  it('keeps a re-struck note as two notes', () => {
    const line = extractLine([{ midi: 45, start: 0, end: 0.5, amp: 1 }, { midi: 45, start: 0.5, end: 1, amp: 1 }])
    expect(brief(line)).toBe('45@0-0.5 45@0.5-1')
  })
  it('drops a short glitch and rejoins the note it interrupted', () => {
    const line = extractLine([{ midi: 45, start: 0, end: 1, amp: 1 }, { midi: 80, start: 0.5, end: 0.53, amp: 1 }])
    expect(brief(line)).toBe('45@0-1')
  })
  it('returns [] for no notes', () => expect(extractLine([])).toEqual([]))
})

describe('fingerLine', () => {
  it('stays at the 12th position for a high lick', () => {
    expect(fmt(fingerLine(seq([76, 74, 72, 69, 72, 74, 76]), STD, 20))).toBe('5:12 5:10 5:8 4:10 5:8 5:10 5:12')
  })
  it('plays a low riff in open position', () => {
    expect(fmt(fingerLine(seq([40, 40, 43, 45, 40, 43, 46, 45]), STD, 20))).toBe('0:0 0:0 0:3 1:0 0:0 0:3 1:1 1:0')
  })
  it('fingers a bass line', () => {
    expect(fmt(fingerLine(seq([28, 28, 31, 33, 35, 33, 31, 28]), BASS4, 20))).toBe('0:0 0:0 0:3 1:0 1:2 1:0 0:3 0:0')
  })
  it('every position sounds exactly the transcribed pitch', () => {
    const line = seq([45, 48, 50, 52, 55, 57, 60, 62, 64, 67, 69, 72])
    fingerLine(line, STD, 20).forEach((p, i) => expect(STD[p.string] + p.fret).toBe(line[i].midi))
  })
  it('returns [] for an empty line', () => expect(fingerLine([], STD, 20)).toEqual([]))
})

describe('buildLine', () => {
  const raw = seq([40, 43, 45])
  const opts = (over) => ({ instrument: INSTRUMENTS.guitar, tuning: STD, minAmp: 0.3, source: 'isolated', follow: 'highest', ...over })
  it('fretted: adds string, fret and name to each note (both sources)', () => {
    for (const source of ['isolated', 'mix']) {
      const { line } = buildLine(raw, opts({ source }))
      expect(line.map((n) => [n.name, n.string, n.fret])).toEqual([['E2', 0, 0], ['G2', 0, 3], ['A2', 1, 0]])
    }
  })
  it('keyboard: names only', () => {
    const { line } = buildLine(raw, opts({ instrument: INSTRUMENTS.keyboard, tuning: null }))
    expect(line.map((n) => n.name)).toEqual(['E2', 'G2', 'A2'])
    expect(line[0].string).toBeUndefined()
  })
  it('isolated: drops ghosts that the full-song heuristic would follow', () => {
    const ghosty = [{ midi: 57, start: 0, end: 0.5, amp: 0.8 }, { midi: 69, start: 0.01, end: 0.4, amp: 0.3 }]
    expect(buildLine(ghosty, opts({ source: 'isolated' })).line.map((n) => n.name)).toEqual(['A3'])
    expect(buildLine(ghosty, opts({ source: 'mix' })).line[0].name).toBe('A4')
  })
  it('drops notes that start in near-silence when a loudness envelope is given', () => {
    // 1 s loud, then 1 s of hiss ~50 dB down; the E2 in the hiss is invented
    const SR = 1000
    const x = Float32Array.from({ length: 2 * SR }, (_, i) => (i < SR ? 0.5 : 0.0015) * Math.sin(2 * Math.PI * 50 * i / SR))
    const loudness = loudnessEnvelope(x, SR)
    const notes = [{ midi: 45, start: 0, end: 0.9, amp: 0.8 }, { midi: 40, start: 1.3, end: 1.9, amp: 0.8 }]
    expect(buildLine(notes, opts({ loudness, gateDb: -36 })).line.map((n) => n.name)).toEqual(['A2'])
    expect(buildLine(notes, opts()).line.map((n) => n.name)).toEqual(['A2', 'E2'])
  })
  it('reports chordShare for the isolated source only', () => {
    const strums = [0, 1].flatMap((t) => [48, 52, 55].map((midi, i) => ({ midi, start: t + i * 0.01, end: t + 1, amp: 0.7 })))
    expect(buildLine(strums, opts()).chordShare).toBe(1)
    expect(buildLine(strums, opts({ source: 'mix' })).chordShare).toBeNull()
  })
})
