import { describe, it, expect } from 'vitest'
import { loudnessEnvelope, referenceLevel, isSilent, gateQuietNotes } from './loudness.js'

const SR = 1000
// `segments`: [seconds, amplitude] pairs rendered as a 50 Hz square-ish tone
const render = (segments) => {
  const out = []
  for (const [sec, amp] of segments) {
    for (let i = 0; i < sec * SR; i++) out.push(amp * Math.sin(2 * Math.PI * 50 * (out.length / SR)))
  }
  return Float32Array.from(out)
}

describe('loudnessEnvelope', () => {
  it('tracks loud and quiet sections', () => {
    const env = loudnessEnvelope(render([[1, 0.5], [1, 0.001]]), SR)
    const loud = env.levels[Math.floor(0.5 / env.hop)]
    const quiet = env.levels[Math.floor(1.5 / env.hop)]
    expect(loud).toBeGreaterThan(0.3)
    expect(quiet).toBeLessThan(0.002)
  })
  it('handles empty input', () => {
    expect(loudnessEnvelope(new Float32Array(0), SR).levels).toHaveLength(0)
  })
})

describe('isSilent', () => {
  it('is true for zeros and near-silence, false for a real signal', () => {
    expect(isSilent(loudnessEnvelope(new Float32Array(SR * 2), SR))).toBe(true)
    expect(isSilent(loudnessEnvelope(render([[2, 0.0004]]), SR))).toBe(true)
    expect(isSilent(loudnessEnvelope(render([[2, 0.2]]), SR))).toBe(false)
  })
})

describe('gateQuietNotes', () => {
  // 0-1 s loud bass note, 1-3 s hiss ~50 dB below it, 3-4 s a second loud note
  const env = loudnessEnvelope(render([[1, 0.5], [2, 0.0015], [1, 0.5]]), SR)
  const notes = [
    { midi: 40, start: 0, end: 1, amp: 0.8 },
    { midi: 52, start: 1.5, end: 2.5, amp: 0.8 }, // hallucinated in the hiss
    { midi: 43, start: 3, end: 4, amp: 0.8 },
  ]
  it('drops notes whose onset sits in the noise floor', () => {
    expect(gateQuietNotes(notes, env, -36).map((n) => n.midi)).toEqual([40, 43])
  })
  it('keeps a quiet-but-real note when the gate is looser than its level', () => {
    const soft = loudnessEnvelope(render([[1, 0.5], [1, 0.02]]), SR) // ~-28 dB
    const n = [{ midi: 45, start: 1, end: 2, amp: 0.8 }]
    expect(gateQuietNotes(n, soft, -36)).toHaveLength(1)
    expect(gateQuietNotes(n, soft, -20)).toHaveLength(0)
  })
  it('is a no-op without an envelope', () => {
    expect(gateQuietNotes(notes, null, -36)).toBe(notes)
  })
})

describe('referenceLevel', () => {
  it('ignores a single short spike', () => {
    const x = render([[5, 0.1]])
    x[2500] = 1
    const env = loudnessEnvelope(x, SR)
    expect(referenceLevel(env)).toBeLessThan(0.2)
  })
})
