import { describe, it, expect } from 'vitest'
import { INSTRUMENTS } from './instruments.js'
import {
  SCALES, ARPEGGIOS, LICKS, SCALE_PATTERNS, ARPEGGIO_PATTERNS, LICK_VARIATIONS, parseSteps, formatSteps, scaleSteps, arpeggioSteps, patternBeats, placeRoot, buildExercise,
} from './bassTheory.js'

const FOUR = INSTRUMENTS.bass.tunings.standard4.strings
const RANGE = [28, 63]
const E = 4, A = 9, C = 0, G = 7

describe('parseSteps', () => {
  it('reads interval/beats and rests, ignoring bar lines', () => {
    expect(parseSteps('0/1 r/0.5 -2/0.25 | 12/2')).toEqual([
      { iv: 0, beats: 1 }, { rest: true, beats: 0.5 }, { iv: -2, beats: 0.25 }, { iv: 12, beats: 2 },
    ])
  })
  it('round-trips through formatSteps', () => {
    const s = '0/1 r/0.5 -2/0.25 12/2'
    expect(formatSteps(parseSteps(s))).toBe(s)
  })
})

describe('scaleSteps / arpeggioSteps', () => {
  it('major scale runs up an octave in eighths and back down to the root', () => {
    const steps = scaleSteps(SCALES.find((s) => s.id === 'major').ivs)
    expect(steps.map((s) => s.iv)).toEqual([0, 2, 4, 5, 7, 9, 11, 12, 11, 9, 7, 5, 4, 2, 0])
    expect(steps.reduce((t, s) => t + s.beats, 0)).toBe(8)
  })
  it('arpeggio goes up through the octave and back', () => {
    expect(arpeggioSteps([0, 3, 7, 10]).map((s) => s.iv)).toEqual([0, 3, 7, 10, 12, 10, 7, 3, 0])
  })
})

const pattern = (list, id) => list.find((p) => p.id === id)
const MAJOR = SCALES.find((s) => s.id === 'major').ivs
const ivsOf = (steps) => steps.map((s) => s.iv)
const beatsOf = (steps) => steps.map((s) => s.beats)
const total = (steps) => steps.reduce((t, s) => t + s.beats, 0)

describe('scale patterns', () => {
  it('down & up starts on the octave and turns at the root', () => {
    expect(ivsOf(pattern(SCALE_PATTERNS, 'downup').build(MAJOR))).toEqual([12, 11, 9, 7, 5, 4, 2, 0, 2, 4, 5, 7, 9, 11])
  })
  it('in 3rds pairs each degree with the one two above, then mirrors down', () => {
    const iv = ivsOf(pattern(SCALE_PATTERNS, 'thirds').build(MAJOR))
    expect(iv.slice(0, 6)).toEqual([0, 4, 2, 5, 4, 7])
    expect(iv.slice(-4)).toEqual([5, 2, 4, 0])
    expect(Math.max(...iv)).toBe(12)
  })
  it('groups of 3 are triplets, one group per beat', () => {
    const steps = pattern(SCALE_PATTERNS, 'groups3').build(MAJOR)
    expect(ivsOf(steps).slice(0, 6)).toEqual([0, 2, 4, 2, 4, 5])
    expect(steps.length % 3).toBe(0)
    expect(total(steps)).toBeCloseTo(steps.length / 3)
  })
  it('groups of 4 are 16ths ending back on the root', () => {
    const steps = pattern(SCALE_PATTERNS, 'groups4').build(MAJOR)
    expect(ivsOf(steps).slice(0, 8)).toEqual([0, 2, 4, 5, 2, 4, 5, 7])
    expect(steps[steps.length - 1].iv).toBe(0)
    expect(new Set(beatsOf(steps))).toEqual(new Set([0.25]))
  })
})

describe('arpeggio patterns', () => {
  const M7 = [0, 3, 7, 10]
  it('two octaves climbs to the second octave and back', () => {
    const iv = ivsOf(pattern(ARPEGGIO_PATTERNS, 'twoOctaves').build(M7))
    expect(iv.slice(0, 9)).toEqual([0, 3, 7, 10, 12, 15, 19, 22, 24])
    expect(iv[iv.length - 1]).toBe(0)
  })
  it('broken skips a chord tone', () => {
    expect(ivsOf(pattern(ARPEGGIO_PATTERNS, 'broken').build([0, 4, 7]))).toEqual([0, 7, 4, 12, 12, 4, 7, 0])
  })
  it('root pedal returns to the root between chord tones', () => {
    expect(ivsOf(pattern(ARPEGGIO_PATTERNS, 'pedal').build(M7))).toEqual([0, 3, 0, 7, 0, 10, 0, 12])
  })
})

describe('lick variations', () => {
  const lick = parseSteps('0/0.5 7/0.5 r/1 12/2')
  const vary = (id) => pattern(LICK_VARIATIONS, id).apply(lick)
  it('notes only: every note a quarter, no rests', () => {
    expect(vary('notesOnly')).toEqual([{ iv: 0, beats: 1 }, { iv: 7, beats: 1 }, { iv: 12, beats: 1 }])
  })
  it('half-time doubles every length', () => expect(beatsOf(vary('halfTime'))).toEqual([1, 1, 2, 4]))
  it('swing makes straight eighth pairs long-short and keeps the bar length', () => {
    const b = beatsOf(vary('swing'))
    expect(b[0]).toBeCloseTo(2 / 3)
    expect(b[1]).toBeCloseTo(1 / 3)
    expect(total(vary('swing'))).toBeCloseTo(4)
  })
  it('call & response pads the lick to whole bars, then leaves the same space', () => {
    const steps = pattern(LICK_VARIATIONS, 'callResponse').apply(parseSteps('0/1 7/1 12/1'))
    expect(steps.slice(-2)).toEqual([{ rest: true, beats: 1 }, { rest: true, beats: 4 }])
    expect(patternBeats(steps)).toBe(8)
  })
})

describe('patternBeats', () => {
  it('rounds up to whole 4/4 bars', () => {
    expect(patternBeats(parseSteps('0/1 0/1 0/1'))).toBe(4)
    expect(patternBeats(parseSteps('0/2 0/2 0/0.5'))).toBe(8)
  })
})

describe('placeRoot', () => {
  it('picks the lowest root that keeps the whole pattern on the neck', () => {
    expect(placeRoot(E, parseSteps('0/1 12/1'), RANGE)).toBe(28)
    expect(placeRoot(C, parseSteps('0/1 12/1'), RANGE)).toBe(36)
    expect(placeRoot(G, parseSteps('-2/1 0/1'), RANGE)).toBe(31)
    expect(placeRoot(E, parseSteps('-2/1 0/1'), RANGE)).toBe(40) // E1 − 2 is below the low E string
  })
  it('high octave moves up 12 when it fits, otherwise stays low', () => {
    expect(placeRoot(E, parseSteps('0/1 12/1'), RANGE, true)).toBe(40)
    expect(placeRoot(E, parseSteps('0/1 24/1'), RANGE, true)).toBe(28)
  })
  it('null when the pattern cannot fit', () => {
    expect(placeRoot(E, parseSteps('0/1 40/1'), RANGE)).toBeNull()
  })
})

describe('buildExercise', () => {
  const opts = { rootPc: E, tuning: FOUR, frets: 20 }

  it('lays notes out in beats, leaves gaps for rests and names each note and degree', () => {
    const { line, totalBeats, rootMidi } = buildExercise(parseSteps('0/1 r/1 3/0.5 7/0.5'), opts)
    expect(rootMidi).toBe(28)
    expect(totalBeats).toBe(4)
    expect(line.map((n) => [n.start, n.end, n.name, n.degree])).toEqual([
      [0, 1, 'E1', 'R'], [2, 2.5, 'G1', 'b3'], [2.5, 3, 'B1', '5'],
    ])
  })

  it('fingers every note on a real string/fret that sounds it', () => {
    const { line } = buildExercise(scaleSteps(SCALES.find((s) => s.id === 'minorPent').ivs), opts)
    expect(line[0]).toMatchObject({ string: 0, fret: 0 })
    for (const n of line) expect(FOUR[n.string] + n.fret).toBe(n.midi)
  })

  it('transposes: the same steps in A sound a fourth higher', () => {
    const steps = parseSteps('0/1 7/1 12/1')
    const inE = buildExercise(steps, opts).line.map((n) => n.midi)
    const inA = buildExercise(steps, { ...opts, rootPc: A }).line.map((n) => n.midi)
    expect(inA).toEqual(inE.map((m) => m + 5))
  })

  it('marks each used position once and flags roots', () => {
    const { marks } = buildExercise(parseSteps('0/1 7/1 0/1 12/1'), opts)
    expect(marks.length).toBe(3)
    expect(marks.filter((m) => m.root).length).toBe(2)
    expect(marks.find((m) => !m.root).label).toBe('5')
  })

  it('returns an empty line when the pattern cannot fit', () => {
    expect(buildExercise(parseSteps('0/1 40/1'), opts).line).toEqual([])
  })
})

describe('built-in content', () => {
  const all = [
    ...SCALES.flatMap((s) => SCALE_PATTERNS.map((p) => ({ id: `${s.id}/${p.id}`, steps: p.build(s.ivs) }))),
    ...ARPEGGIOS.flatMap((a) => ARPEGGIO_PATTERNS.map((p) => ({ id: `${a.id}/${p.id}`, steps: p.build(a.ivs) }))),
    ...LICKS.map((l) => ({ id: l.id, steps: parseSteps(l.steps) })),
  ]

  it('licks are written in whole bars', () => {
    for (const l of LICKS) expect(parseSteps(l.steps).reduce((t, s) => t + s.beats, 0) % 4, l.id).toBe(0)
  })

  it('everything fits a 4-string bass in every key', () => {
    for (const { id, steps } of all) {
      for (let pc = 0; pc < 12; pc++) expect(placeRoot(pc, steps, RANGE), `${id} in ${pc}`).not.toBeNull()
    }
  })
})
