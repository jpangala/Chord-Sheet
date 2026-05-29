import { describe, it, expect } from 'vitest'
import { sectionsEqual } from './printUtils.js'

// ─── Helpers shared across test suites ───────────────────────
const makeSection = (type, label, bars, chords = {}) => ({
  id: `${type}-${label}`, type, label, bars, chords,
})

// ─── sectionsEqual ────────────────────────────────────────────
describe('sectionsEqual', () => {
  const ts = '4/4'

  it('returns true for two empty sections with the same bar count', () => {
    expect(sectionsEqual(makeSection('Verse','',4), makeSection('Verse','',4), ts)).toBe(true)
  })

  it('returns false when bar counts differ', () => {
    expect(sectionsEqual(makeSection('Verse','',4), makeSection('Verse','',8), ts)).toBe(false)
  })

  it('returns true when both have the same chord at the same position', () => {
    const chords = { '0-0': { root: 'C', qual: '', bass: '' } }
    expect(sectionsEqual(makeSection('V','',4,chords), makeSection('V','',4,chords), ts)).toBe(true)
  })

  it('returns false when chords differ at one position', () => {
    const a = { '0-0': { root: 'C', qual: '', bass: '' } }
    const b = { '0-0': { root: 'G', qual: '', bass: '' } }
    expect(sectionsEqual(makeSection('V','',4,a), makeSection('V','',4,b), ts)).toBe(false)
  })

  it('returns false when one has a chord and the other has none at the same position', () => {
    const a = { '0-0': { root: 'C', qual: '', bass: '' } }
    expect(sectionsEqual(makeSection('V','',4,a), makeSection('V','',4,{}), ts)).toBe(false)
  })

  it('distinguishes slash chords with different bass notes', () => {
    const withEb = { '0-0': { root: 'Adim7', qual: '', bass: 'Eb' } }
    const withFsharp = { '0-0': { root: 'Adim7', qual: '', bass: 'F#' } }
    expect(sectionsEqual(makeSection('V','',4,withEb), makeSection('V','',4,withEb), ts)).toBe(true)
    expect(sectionsEqual(makeSection('V','',4,withEb), makeSection('V','',4,withFsharp), ts)).toBe(false)
  })

  it('works with 3/4 time (3 beats per bar)', () => {
    const a = { '0-0': { root: 'G', qual: '', bass: '' }, '0-1': { root: 'Ebm', qual: '', bass: '' } }
    const b = { '0-0': { root: 'G', qual: '', bass: '' }, '0-1': { root: 'Ebm', qual: '', bass: '' } }
    expect(sectionsEqual(makeSection('V','',1,a), makeSection('V','',1,b), '3/4')).toBe(true)
  })
})
