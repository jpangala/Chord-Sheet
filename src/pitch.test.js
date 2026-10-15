import { describe, it, expect } from 'vitest'
import { detectPitch, nearestNote, fitPhrase, segmentNotes, comfortRange } from './pitch.js'
import { INSTRUMENTS } from './instruments.js'

const SR = 44100
const N = 2048 // what the app analyses per reading

function tone(hz, harmonics = [1], { sr = SR, n = N, noise = 0 } = {}) {
  let seed = 3
  const rand = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296 * 2 - 1
  return Float32Array.from({ length: n }, (_, i) =>
    harmonics.reduce((s, a, k) => s + a * Math.sin(2 * Math.PI * hz * (k + 1) * i / sr), 0) * 0.3 + noise * rand())
}
const cents = (a, b) => 1200 * Math.log2(a / b)

describe('detectPitch', () => {
  it('finds a pure tone across the singing range to within a few cents', () => {
    for (const hz of [82.4, 110, 196, 261.6, 440, 880]) {
      expect(Math.abs(cents(detectPitch(tone(hz), SR).hz, hz)), `${hz} Hz`).toBeLessThan(5)
    }
  })
  it('finds the fundamental of a voice-like tone whose 2nd harmonic is louder (no octave error)', () => {
    const hum = tone(146.8, [0.5, 1, 0.6, 0.3]) // D3
    expect(Math.abs(cents(detectPitch(hum, SR).hz, 146.8))).toBeLessThan(5)
  })
  it('works at 48 kHz (many mics) and with some background noise', () => {
    expect(Math.abs(cents(detectPitch(tone(220, [1, 0.5], { sr: 48000, noise: 0.03 }), 48000).hz, 220))).toBeLessThan(10)
  })
  it('reports nothing for silence or plain noise', () => {
    expect(detectPitch(new Float32Array(N), SR)).toBeNull()
    expect(detectPitch(tone(220, [0], { noise: 0.3 }), SR)).toBeNull()
  })
})

describe('nearestNote', () => {
  it('rounds to the nearest semitone and says how far off it is', () => {
    expect(nearestNote(440)).toEqual({ midi: 69, cents: 0 })
    const sharp = nearestNote(445)
    expect(sharp.midi).toBe(69)
    expect(sharp.cents).toBeCloseTo(19.6, 0)
    expect(nearestNote(110 * 2 ** (-30 / 1200)).cents).toBeCloseTo(-30, 0)
  })
})

describe('fitPhrase', () => {
  const bass = INSTRUMENTS.bass.tunings.standard4.strings // E1 A1 D2 G2, 20 frets: 28..63
  const guitar = INSTRUMENTS.guitar.tunings.standard.strings // 40..84
  const opts = (tuning, shift = 'auto') => ({ tuning, frets: 20, shift })

  it('comfort range is the first two octaves up from the lowest string', () => {
    expect(comfortRange(bass)).toEqual([28, 52])
    expect(comfortRange(guitar)).toEqual([40, 64])
  })
  it('auto: one octave shift for the whole phrase, into the lower neck, keeping the melody shape', () => {
    expect(fitPhrase([57, 59, 60, 62, 64], opts(bass))).toEqual([45, 47, 48, 50, 52]) // hummed A3 melody → A2 on bass
    expect(fitPhrase([69, 71, 72], opts(guitar))).toEqual([57, 59, 60]) // a high voice on guitar
    expect(fitPhrase([45, 47], opts(guitar))).toEqual([45, 47]) // already comfortable: as sung
  })
  it('auto: a note still off the neck is folded in by octaves on its own', () => {
    expect(fitPhrase([40, 70], opts(bass))).toEqual([40, 58])
  })
  it('fixed shifts move every note; off the neck is null', () => {
    expect(fitPhrase([57, 70], opts(bass, 0))).toEqual([57, null])
    expect(fitPhrase([57, 70], opts(bass, -12))).toEqual([45, 58])
    expect(fitPhrase([57, 40], opts(bass, -24))).toEqual([33, null])
  })
})

describe('segmentNotes', () => {
  const HOP = 0.02
  // frames from [[seconds, midi|null], ...] runs
  const frames = (runs) => {
    const out = []
    let t = 0
    for (const [dur, midi] of runs) for (let k = 0; k < Math.round(dur / HOP); k++, t += HOP) out.push({ t, midi: typeof midi === 'function' ? midi(k) : midi })
    return out
  }
  const brief = (notes) => notes.map((n) => [n.midi, +n.start.toFixed(2), +n.end.toFixed(2)])

  it('turns steady runs into notes with start and end times', () => {
    expect(brief(segmentNotes(frames([[0.3, 57.1], [0.2, null], [0.4, 59.0]]), { hop: HOP })))
      .toEqual([[57, 0, 0.3], [59, 0.5, 0.9]])
  })
  it('keeps one note through vibrato and a brief dropout', () => {
    const wobble = (k) => 57 + 0.4 * Math.sin(k / 2)
    expect(brief(segmentNotes(frames([[0.4, wobble], [0.04, null], [0.4, wobble]]), { hop: HOP })))
      .toEqual([[57, 0, 0.84]])
  })
  it('drops blips and the slide between two notes', () => {
    const notes = segmentNotes(frames([[0.3, 57], [0.04, 58.5], [0.3, 60], [0.04, 66], [0.3, 60]]), { hop: HOP })
    expect(notes.map((n) => n.midi)).toEqual([57, 60])
  })
  it('a repeated note after a real gap is two notes', () => {
    expect(segmentNotes(frames([[0.3, 57], [0.2, null], [0.3, 57]]), { hop: HOP }).length).toBe(2)
  })
})
