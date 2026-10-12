import { describe, it, expect } from 'vitest'
import { INSTRUMENTS, midiToName, midiToHz, instrumentRange, findNoteAt, findNextNote } from './instruments.js'

describe('midiToName', () => {
  it('uses scientific octaves and the app\'s root spellings', () => {
    expect(midiToName(60)).toBe('C4')
    expect(midiToName(28)).toBe('E1')
    expect(midiToName(70)).toBe('Bb4')
  })
})

describe('midiToHz', () => {
  it('is 440 at A4', () => expect(midiToHz(69)).toBeCloseTo(440))
})

describe('instrumentRange', () => {
  it('fretted: lowest open string → highest string + frets', () => {
    expect(instrumentRange(INSTRUMENTS.guitar, INSTRUMENTS.guitar.tunings.standard.strings)).toEqual([40, 84])
    expect(instrumentRange(INSTRUMENTS.bass, INSTRUMENTS.bass.tunings.standard5.strings)).toEqual([23, 63])
  })
  it('keyboard: A0–C8', () => expect(instrumentRange(INSTRUMENTS.keyboard, null)).toEqual([21, 108]))
})

const line = [{ start: 0, end: 1 }, { start: 1, end: 2 }, { start: 3, end: 4 }]

describe('findNoteAt', () => {
  it('finds the sounding note (start inclusive, end exclusive)', () => {
    expect(findNoteAt(line, 0.5)).toBe(0)
    expect(findNoteAt(line, 1)).toBe(1)
    expect(findNoteAt(line, 3.9)).toBe(2)
  })
  it('returns -1 in rests and outside', () => {
    expect(findNoteAt(line, 2.5)).toBe(-1)
    expect(findNoteAt(line, 5)).toBe(-1)
    expect(findNoteAt([], 0)).toBe(-1)
  })
})

describe('findNextNote', () => {
  it('returns the first note starting after t', () => {
    expect(findNextNote(line, -1)).toBe(0)
    expect(findNextNote(line, 0.5)).toBe(1)
    expect(findNextNote(line, 2.5)).toBe(2)
  })
  it('returns -1 after the last start', () => expect(findNextNote(line, 3)).toBe(-1))
})
