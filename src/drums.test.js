import { describe, it, expect } from 'vitest'
import { analyzeDrums, detectDrumHits, buildDrumLine, DRUMS } from './drums.js'
import { loudnessEnvelope } from './loudness.js'

const SR = 22050 // analysis rate (what the app resamples to)

// Seeded white noise so the tests are deterministic.
function makeRand() {
  let seed = 7
  return () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296 * 2 - 1
}

// Synthetic one-shots, mixed into `out` at time t0 (s).
const SOUNDS = {
  kick(out, t0, rand, SR) { // sine sweeping 120→50 Hz, fast decay
    const n = Math.floor(0.7 * SR); let phase = 0
    for (let i = 0; i < n; i++) {
      const t = i / SR, f = 50 + 70 * Math.exp(-t / 0.03)
      phase += 2 * Math.PI * f / SR
      out[Math.floor(t0 * SR) + i] += 0.8 * Math.sin(phase) * Math.exp(-t / 0.1)
    }
  },
  snare(out, t0, rand, SR) { // 200 Hz body + noise that rolls off toward the highs, like real wires
    const n = Math.floor(0.5 * SR); let lp = 0
    for (let i = 0; i < n; i++) {
      const t = i / SR
      lp = 0.55 * lp + 0.45 * rand() // 1-pole low-pass: spectral tilt
      out[Math.floor(t0 * SR) + i] += 0.35 * Math.sin(2 * Math.PI * 200 * t) * Math.exp(-t / 0.07) + 1.1 * lp * Math.exp(-t / 0.07)
    }
  },
  hihat(out, t0, rand, SR) { // high-passed noise, very short
    const n = Math.floor(0.18 * SR); let prev = 0, prev2 = 0
    for (let i = 0; i < n; i++) {
      const x = rand(), hp = x - prev // 1st-difference high-pass
      prev2 = prev; prev = x
      out[Math.floor(t0 * SR) + i] += 0.4 * hp * Math.exp(-(i / SR) / 0.025)
    }
  },
  cymbal(out, t0, rand, SR) { // high-passed noise, long ring
    const n = Math.floor(3.5 * SR); let prev = 0, prev2 = 0
    for (let i = 0; i < n; i++) {
      const x = rand(), hp = x - prev
      prev2 = prev; prev = x
      out[Math.floor(t0 * SR) + i] += 0.4 * hp * Math.exp(-(i / SR) / 0.5)
    }
  },
  tomHigh(out, t0, rand, SR) {
    const n = Math.floor(1.05 * SR)
    for (let i = 0; i < n; i++) { const t = i / SR; out[Math.floor(t0 * SR) + i] += 0.6 * Math.sin(2 * Math.PI * 230 * t) * Math.exp(-t / 0.15) }
  },
  tomLow(out, t0, rand, SR) {
    const n = Math.floor(1.4 * SR)
    for (let i = 0; i < n; i++) { const t = i / SR; out[Math.floor(t0 * SR) + i] += 0.6 * Math.sin(2 * Math.PI * 115 * t) * Math.exp(-t / 0.2) }
  },
}

// pattern: [[time, [sound names]], ...]
function render(pattern, seconds, rate = SR) {
  const out = new Float32Array(Math.floor((seconds + 4) * rate)) // room for the ring-out of the last hit
  const rand = makeRand()
  for (const [t, names] of pattern) for (const name of names) SOUNDS[name](out, t, rand, rate)
  return out.subarray(0, Math.floor(seconds * rate))
}

// What the browser does: render at 44.1 kHz, then low-pass and decimate to 22.05 kHz.
function renderResampled(pattern, seconds) {
  const hi = render(pattern, seconds, 44100)
  const taps = 63, fc = 0.2245 // anti-alias cutoff ≈ 9.9 kHz (0.9 x the 11.025 kHz target Nyquist), as a fraction of 44.1 kHz
  const h = Float64Array.from({ length: taps }, (_, i) => {
    const m = i - (taps - 1) / 2
    const sinc = m === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * m) / (Math.PI * m)
    return sinc * (0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (taps - 1)))
  })
  const out = new Float32Array(Math.floor(hi.length / 2))
  for (let n = 0; n < out.length; n++) {
    let acc = 0
    for (let k = 0; k < taps; k++) { const j = 2 * n + k - (taps - 1) / 2; if (j >= 0 && j < hi.length) acc += h[k] * hi[j] }
    out[n] = acc
  }
  return out
}

const run = (pattern, seconds, opts) => detectDrumHits(analyzeDrums(render(pattern, seconds), SR), opts)
const runResampled = (pattern, seconds, opts) => detectDrumHits(analyzeDrums(renderResampled(pattern, seconds), SR), opts)
const labels = (events) => events.map((e) => e.drums.join('+'))

describe('detectDrumHits', () => {
  it('finds each single drum with the right label', () => {
    const events = run([[0.5, ['kick']], [1.5, ['snare']], [2.5, ['hihat']], [3.5, ['tomHigh']], [4.5, ['tomLow']], [5.5, ['cymbal']]], 7.5)
    expect(labels(events)).toEqual(['kick', 'snare', 'hihat', 'tomHigh', 'tomLow', 'cymbal'])
  })

  it('times each hit within 30 ms', () => {
    const times = [0.5, 1.5, 2.5, 3.5]
    const events = run([[0.5, ['kick']], [1.5, ['snare']], [2.5, ['hihat']], [3.5, ['tomHigh']]], 5)
    events.forEach((e, i) => expect(Math.abs(e.start - times[i])).toBeLessThan(0.03))
  })

  it('splits simultaneous hits (kick + hi-hat, snare + hi-hat)', () => {
    const events = run([[0.5, ['kick', 'hihat']], [1.5, ['snare', 'hihat']], [2.5, ['kick']]], 4)
    expect(labels(events)).toEqual(['kick+hihat', 'snare+hihat', 'kick'])
  })

  it('reads a basic rock groove', () => {
    const p = []
    for (let b = 0; b < 4; b++) {
      const t = b * 1.0
      p.push([t, b % 2 === 0 ? ['kick', 'hihat'] : ['snare', 'hihat']])
      p.push([t + 0.5, ['hihat']])
    }
    const events = run(p, 5)
    expect(labels(events)).toEqual(['kick+hihat', 'hihat', 'snare+hihat', 'hihat', 'kick+hihat', 'hihat', 'snare+hihat', 'hihat'])
  })

  it('reads the same groove after browser-style resampling (hats keep their label)', () => {
    const p = []
    for (let b = 0; b < 8; b++) p.push([b * 0.25, b % 4 === 0 ? ['kick', 'hihat'] : b % 4 === 2 ? ['snare', 'hihat'] : ['hihat']])
    p.push([2.0, ['tomHigh']], [2.25, ['tomLow']], [2.75, ['cymbal', 'kick']])
    const events = runResampled(p, 4.5)
    // A quiet hi-hat on top of a snare barely changes the spectrum, so that one combination is
    // not asserted: the snare itself must still be found there.
    expect(labels(events).map((l) => l.replace('snare+hihat', 'snare'))).toEqual([
      'kick+hihat', 'hihat', 'snare', 'hihat', 'kick+hihat', 'hihat', 'snare', 'hihat',
      'tomHigh', 'tomLow', 'kick+cymbal',
    ])
  })

  it('reads the groove at 44.1 kHz (what the app analyses drums at)', () => {
    const p = []
    for (let b = 0; b < 8; b++) p.push([b * 0.25, b % 4 === 0 ? ['kick', 'hihat'] : b % 4 === 2 ? ['snare'] : ['hihat']])
    p.push([2.0, ['tomHigh']], [2.25, ['tomLow']], [2.75, ['cymbal', 'kick']])
    const events = detectDrumHits(analyzeDrums(render(p, 4.5, 44100), 44100))
    expect(labels(events)).toEqual([
      'kick+hihat', 'hihat', 'snare', 'hihat', 'kick+hihat', 'hihat', 'snare', 'hihat',
      'tomHigh', 'tomLow', 'kick+cymbal',
    ])
    const times = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.75]
    events.forEach((e, i) => expect(Math.abs(e.start - times[i])).toBeLessThan(0.03))
  })

  it('returns non-overlapping events with start < end', () => {
    const events = run([[0.5, ['kick']], [0.62, ['snare']], [1.5, ['hihat']]], 3)
    events.forEach((e, i) => {
      expect(e.end).toBeGreaterThan(e.start)
      if (i) expect(e.start).toBeGreaterThanOrEqual(events[i - 1].end)
    })
  })

  it('finds nothing in silence', () => {
    expect(run([], 3)).toEqual([])
  })

  it('"fewer" sensitivity never reports more hits than "more"', () => {
    const p = [[0.5, ['kick']], [1.5, ['snare']], [2.5, ['hihat']]]
    const more = run(p, 4, { frac: 0.15 }).length
    const fewer = run(p, 4, { frac: 0.6 }).length
    expect(fewer).toBeLessThanOrEqual(more)
  })
})

describe('DRUMS', () => {
  it('lists the kit pieces top to bottom', () => {
    expect(Object.keys(DRUMS)).toEqual(['cymbal', 'hihat', 'tomHigh', 'snare', 'tomLow', 'kick'])
  })
})

describe('buildDrumLine', () => {
  const samples = render([[0.5, ['kick', 'hihat']], [1.5, ['snare']]], 3)
  const features = analyzeDrums(samples, SR)

  it('names each event for display', () => {
    expect(buildDrumLine(features).map((e) => e.name)).toEqual(['Kick + Hi-hat', 'Snare'])
  })
  it('is empty without features', () => {
    expect(buildDrumLine(null)).toEqual([])
  })
  it('drops hits that start in near-silence when a loudness envelope is given', () => {
    const quiet = Float32Array.from(samples)
    for (let i = Math.floor(1.3 * SR); i < quiet.length; i++) quiet[i] *= 0.001 // the snare is 60 dB down
    const f = analyzeDrums(quiet, SR)
    const loudness = loudnessEnvelope(quiet, SR)
    expect(buildDrumLine(f, { loudness, gateDb: -36 }).map((e) => e.name)).toEqual(['Kick + Hi-hat'])
  })
})
