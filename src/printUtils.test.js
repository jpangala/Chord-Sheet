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

import { detectDuplicateRuns } from './printUtils.js'

describe('detectDuplicateRuns', () => {
  const ts = '4/4'

  it('returns [] for empty input', () => {
    expect(detectDuplicateRuns([], ts)).toEqual([])
  })

  it('returns one run of count 1 for a single unique section', () => {
    const s = makeSection('Verse', 'Bait 1', 4)
    const result = detectDuplicateRuns([s], ts)
    expect(result).toHaveLength(1)
    expect(result[0].count).toBe(1)
    expect(result[0].labels).toEqual(['Bait 1'])
    expect(result[0].representative).toBe(s)
  })

  it('collapses two consecutive identical sections', () => {
    const chords = { '0-0': { root: 'C', qual: '', bass: '' } }
    const s1 = makeSection('Verse', 'Part 1', 4, chords)
    const s2 = makeSection('Verse', 'Part 2', 4, chords)
    const result = detectDuplicateRuns([s1, s2], ts)
    expect(result).toHaveLength(1)
    expect(result[0].count).toBe(2)
    expect(result[0].labels).toEqual(['Part 1', 'Part 2'])
    expect(result[0].representative).toBe(s1)
  })

  it('does NOT collapse non-consecutive identical sections', () => {
    const chords = { '0-0': { root: 'C', qual: '', bass: '' } }
    const s1 = makeSection('Verse', 'Part 1', 4, chords)
    const s2 = makeSection('Chorus', 'Chorus', 4, {})
    const s3 = makeSection('Verse', 'Part 3', 4, chords)
    const result = detectDuplicateRuns([s1, s2, s3], ts)
    expect(result).toHaveLength(3)
    expect(result[0].count).toBe(1)
    expect(result[1].count).toBe(1)
    expect(result[2].count).toBe(1)
  })

  it('collapses a run of 6, leaving a unique 7th as its own run', () => {
    const sameChords = { '0-0': { root: 'Adim7', qual: '', bass: 'Eb' } }
    const diffChords = { '0-0': { root: 'Adim7', qual: '', bass: 'F#' } }
    const sections = [
      ...Array.from({ length: 6 }, (_, i) =>
        makeSection('Outro', `Outro ${i + 1}`, 4, sameChords)
      ),
      makeSection('Outro', 'Outro copy', 4, diffChords),
    ]
    const result = detectDuplicateRuns(sections, ts)
    expect(result).toHaveLength(2)
    expect(result[0].count).toBe(6)
    expect(result[1].count).toBe(1)
    expect(result[1].labels).toEqual(['Outro copy'])
  })

  it('falls back to type as label when section.label is empty', () => {
    const s = makeSection('Outro', '', 4)
    const result = detectDuplicateRuns([s], ts)
    expect(result[0].labels).toEqual(['Outro'])
  })
})

import { groupByConsecutiveType } from './printUtils.js'

describe('groupByConsecutiveType', () => {
  const makeRun = (type, label = '') => ({
    representative: { type, label, bars: 4, chords: {} },
    count: 1,
    labels: [label || type],
  })

  it('returns [] for empty input', () => {
    expect(groupByConsecutiveType([])).toEqual([])
  })

  it('returns one group with correct colors for a single run', () => {
    const result = groupByConsecutiveType([makeRun('Intro', 'Part 1')])
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('Intro')
    expect(result[0].accentColor).toBe('#185FA5')
    expect(result[0].textColor).toBe('#0C447C')
    expect(result[0].entries).toHaveLength(1)
  })

  it('merges consecutive runs of the same type into one group', () => {
    const runs = [makeRun('Intro', 'Part 1'), makeRun('Intro', 'Part 2')]
    const result = groupByConsecutiveType(runs)
    expect(result).toHaveLength(1)
    expect(result[0].entries).toHaveLength(2)
  })

  it('creates separate groups for non-consecutive same types', () => {
    const runs = [makeRun('Verse'), makeRun('Chorus'), makeRun('Verse')]
    const result = groupByConsecutiveType(runs)
    expect(result).toHaveLength(3)
    expect(result[0].type).toBe('Verse')
    expect(result[1].type).toBe('Chorus')
    expect(result[2].type).toBe('Verse')
  })

  it('uses fallback colors for unknown section types', () => {
    const result = groupByConsecutiveType([makeRun('Unknown')])
    expect(result[0].accentColor).toBe('#888')
    expect(result[0].textColor).toBe('#333')
  })
})

import { renderBarRows } from './printUtils.js'

describe('renderBarRows', () => {
  it('renders a single 4/4 bar with one chord and three empty beats', () => {
    const section = { bars: 1, chords: { '0-0': { root: 'C', qual: '', bass: '' } } }
    const rows = renderBarRows(section, '4/4')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toBe('| C . . . |')
  })

  it('renders a single 3/4 bar with two chords', () => {
    const section = {
      bars: 1,
      chords: {
        '0-0': { root: 'G', qual: '', bass: '' },
        '0-1': { root: 'Ebm', qual: '', bass: '' },
      },
    }
    const rows = renderBarRows(section, '3/4')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toBe('| G Ebm . |')
  })

  it('renders a bar with all empty beats as dots', () => {
    const section = { bars: 1, chords: {} }
    const rows = renderBarRows(section, '3/4')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toBe('| . . . |')
  })

  it('pads beat columns to max chord width across all bars', () => {
    const section = {
      bars: 2,
      chords: {
        '0-0': { root: 'C', qual: '', bass: '' },
        '1-0': { root: 'Csus2', qual: '', bass: '' },
      },
    }
    const rows = renderBarRows(section, '4/4')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toBe('| C     . . . | | Csus2 . . . |')
  })

  it('splits into two rows when there are 5 bars', () => {
    const section = { bars: 5, chords: {} }
    const rows = renderBarRows(section, '4/4')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toBe('| . . . . | | . . . . | | . . . . | | . . . . |')
    expect(rows[1]).toBe('| . . . . |')
  })

  it('renders a slash chord correctly', () => {
    const section = { bars: 1, chords: { '0-0': { root: 'Adim7', qual: '', bass: 'Eb' } } }
    const rows = renderBarRows(section, '3/4')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toBe('| Adim7/Eb . . |')
  })
})
