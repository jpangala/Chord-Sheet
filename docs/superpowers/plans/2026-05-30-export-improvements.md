# Export Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add a compact text/pipe `PrintView` component so the ChordSheet PDF export shows sections grouped by type, bars with uniform column-aligned widths, and consecutive duplicate sections collapsed with a ×N suffix.

**Architecture:** Pure data-processing functions live in a new `src/printUtils.js` (testable in isolation with Vitest). `src/App.jsx` imports them and adds a `PrintView` React component rendered alongside the editor but hidden on screen — it takes over on print via `@media print` CSS in `src/index.css`. The editor grid is unchanged.

**Tech Stack:** React 18, Vite 5, Vitest (added for unit tests)

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/printUtils.js` | **Create** | `SEC_COLORS`, `beatsPerBar`, `chordStr`, `sectionsEqual`, `detectDuplicateRuns`, `groupByConsecutiveType`, `renderBarRows` |
| `src/printUtils.test.js` | **Create** | Unit tests for all pure functions |
| `src/App.jsx` | **Modify** | Import from printUtils, add `PrintView` component, add `className="editor-screen"` to EditorScreen root, render `<PrintView>` in App root |
| `src/index.css` | **Modify** | `.print-view { display:none }` on screen; `.editor-screen { display:none }` + `.print-view { display:block }` on print |
| `vite.config.js` | **Modify** | Add `test: { environment: 'node' }` block |
| `package.json` | **Modify** | Add `"test"` and `"test:watch"` scripts |

---

## Task 1 — Set up Vitest

**Files:**
- Modify: `package.json`
- Modify: `vite.config.js`
- Create: `src/printUtils.test.js`

- [x] **Step 1: Install Vitest**

```bash
cd "/Users/jpangala/Project/Chord Sheet Project/chordsheet"
npm install -D vitest
```

Expected: vitest appears in `devDependencies` in `package.json`.

- [x] **Step 2: Add test scripts to `package.json`**

The current scripts block is:
```json
"scripts": {
  "dev": "vite",
  "build": "vite build",
  "preview": "vite preview"
}
```

Replace with:
```json
"scripts": {
  "dev": "vite",
  "build": "vite build",
  "preview": "vite preview",
  "test": "vitest run",
  "test:watch": "vitest"
}
```

- [x] **Step 3: Add Vitest config to `vite.config.js`**

Replace the entire file with:
```js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
  },
})
```

- [x] **Step 4: Create a smoke-test file**

Create `src/printUtils.test.js`:
```js
import { describe, it, expect } from 'vitest'

describe('setup', () => {
  it('vitest runs', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [x] **Step 5: Run the test suite**

```bash
npm test
```

Expected output:
```
✓ src/printUtils.test.js (1)
  ✓ setup > vitest runs
Test Files  1 passed (1)
Tests  1 passed (1)
```

- [x] **Step 6: Commit**

```bash
git add package.json vite.config.js src/printUtils.test.js
git commit -m "chore: add vitest for unit testing"
```

---

## Task 2 — Create `src/printUtils.js` and migrate shared helpers

**Files:**
- Create: `src/printUtils.js`
- Modify: `src/App.jsx`

`SEC_COLORS`, `beatsPerBar`, and `chordStr` currently live in `App.jsx`. They're also needed by the new pure functions. Move them to `printUtils.js` and import them back.

- [x] **Step 1: Create `src/printUtils.js`**

```js
// ─── Shared constants and helpers (also imported by App.jsx) ──

export const SEC_COLORS = {
  "Intro":        ["#E6F1FB","#185FA5","#0C447C"],
  "Verse":        ["#EAF3DE","#3B6D11","#173404"],
  "Pre-Chorus":   ["#FAEEDA","#854F0B","#412402"],
  "Chorus":       ["#FAECE7","#993C1D","#4A1B0C"],
  "Refrain":      ["#FAECE7","#D85A30","#712B13"],
  "Post-Chorus":  ["#FBEAF0","#993556","#4B1528"],
  "Bridge":       ["#EEEDFE","#534AB7","#26215C"],
  "Breakdown":    ["#F1EFE8","#5F5E5A","#2C2C2A"],
  "Instrumental": ["#E1F5EE","#0F6E56","#04342C"],
  "Solo":         ["#FAEEDA","#BA7517","#412402"],
  "Interlude":    ["#EEEDFE","#7F77DD","#3C3489"],
  "Build-Up":     ["#FCEBEB","#A32D2D","#501313"],
  "Drop":         ["#FCEBEB","#E24B4A","#501313"],
  "Outro":        ["#F1EFE8","#888780","#444441"],
  "Coda":         ["#E1F5EE","#1D9E75","#085041"],
  "Tag":          ["#FBEAF0","#D4537E","#72243E"],
};

/** Number of beats in a bar for a given time signature string like "3/4". */
export function beatsPerBar(timeSig) {
  return parseInt(timeSig.split("/")[0]);
}

/**
 * Returns the display string for a chord object, or null for no chord.
 * @param {{ root: string, qual: string, bass?: string } | null} c
 */
export function chordStr(c) {
  if (!c) return null;
  return c.root + c.qual + (c.bass ? "/" + c.bass : "");
}
```

- [x] **Step 2: Update `src/App.jsx` to import the three extracted items**

At the very top of `src/App.jsx`, add this import as the first line (before the React import is fine, but after is conventional):
```js
import { SEC_COLORS, beatsPerBar, chordStr } from './printUtils.js';
```

Then **delete** the following three items from `App.jsx` (they are now in printUtils.js):

Delete the `SEC_COLORS` constant block (lines 19–36 in the original file):
```js
const SEC_COLORS = {
  "Intro":        ["#E6F1FB","#185FA5","#0C447C"],
  // ... all 16 entries ...
  "Tag":          ["#FBEAF0","#D4537E","#72243E"],
};
```

Delete the `beatsPerBar` function (line 39):
```js
function beatsPerBar(timeSig) { return parseInt(timeSig.split("/")[0]); }
```

Delete the `chordStr` function (lines 50–53):
```js
function chordStr(c) {
  if (!c) return null;
  return c.root + c.qual + (c.bass ? "/" + c.bass : "");
}
```

- [x] **Step 3: Verify the dev server still works**

```bash
npm run dev
```

Open http://localhost:5173. Confirm:
- Editor loads with no console errors
- Section color blocks still display their correct colors
- Chord picker still works (shows root/quality buttons)

- [x] **Step 4: Commit**

```bash
git add src/printUtils.js src/App.jsx
git commit -m "refactor: extract SEC_COLORS, beatsPerBar, chordStr to printUtils.js"
```

---

## Task 3 — `sectionsEqual` — test then implement

**Files:**
- Modify: `src/printUtils.test.js`
- Modify: `src/printUtils.js`

`sectionsEqual(a, b, timeSig)` returns `true` when two sections have identical bar count and identical chord at every `barIdx-beatIdx` position.

- [x] **Step 1: Write failing tests**

Replace the entire contents of `src/printUtils.test.js` with:
```js
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
```

- [x] **Step 2: Run to confirm failure**

```bash
npm test
```

Expected: fails with `sectionsEqual is not a function` (or similar import error). The `setup > vitest runs` test should still pass.

- [x] **Step 3: Implement `sectionsEqual` in `src/printUtils.js`**

Append after the `chordStr` function:
```js
// ─── Print processing functions ───────────────────────────────

/**
 * Returns true if two sections have the same bar count and identical chord
 * at every beat position.
 */
export function sectionsEqual(a, b, timeSig) {
  if (a.bars !== b.bars) return false;
  const nb = beatsPerBar(timeSig);
  for (let bar = 0; bar < a.bars; bar++) {
    for (let beat = 0; beat < nb; beat++) {
      const k = `${bar}-${beat}`;
      const ca = chordStr(a.chords[k] || null);
      const cb = chordStr(b.chords[k] || null);
      if (ca !== cb) return false;
    }
  }
  return true;
}
```

- [x] **Step 4: Run to confirm all tests pass**

```bash
npm test
```

Expected:
```
✓ src/printUtils.test.js (7)
  ✓ setup > vitest runs
  ✓ sectionsEqual > returns true for two empty sections…
  … (all 7 pass)
Test Files  1 passed (1)
Tests  7 passed (7)
```

- [x] **Step 5: Commit**

```bash
git add src/printUtils.js src/printUtils.test.js
git commit -m "feat: add sectionsEqual with tests"
```

---

## Task 4 — `detectDuplicateRuns` — test then implement

**Files:**
- Modify: `src/printUtils.test.js`
- Modify: `src/printUtils.js`

`detectDuplicateRuns(sections, timeSig)` scans sections linearly, collapsing **consecutive** identical sections into runs.

Return type per run: `{ representative: Section, count: number, labels: string[] }`
- `representative` — first section in the run (used for chord rendering)
- `count` — how many consecutive identical sections
- `labels` — display label for each (`section.label || section.type`)

- [x] **Step 1: Write failing tests**

Append to `src/printUtils.test.js`:
```js
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
```

- [x] **Step 2: Run to confirm new tests fail**

```bash
npm test
```

Expected: the `detectDuplicateRuns` suite fails; `sectionsEqual` suite still passes.

- [x] **Step 3: Implement `detectDuplicateRuns` in `src/printUtils.js`**

Append after `sectionsEqual`:
```js
/**
 * Collapses consecutive identical sections into runs.
 * @param {Object[]} sections
 * @param {string} timeSig
 * @returns {{ representative: Object, count: number, labels: string[] }[]}
 */
export function detectDuplicateRuns(sections, timeSig) {
  if (!sections.length) return [];
  const runs = [];
  let current = {
    representative: sections[0],
    count: 1,
    labels: [sections[0].label || sections[0].type],
  };
  for (let i = 1; i < sections.length; i++) {
    const s = sections[i];
    if (sectionsEqual(s, current.representative, timeSig)) {
      current.count++;
      current.labels.push(s.label || s.type);
    } else {
      runs.push(current);
      current = {
        representative: s,
        count: 1,
        labels: [s.label || s.type],
      };
    }
  }
  runs.push(current);
  return runs;
}
```

- [x] **Step 4: Run to confirm all tests pass**

```bash
npm test
```

Expected: all tests pass (12 total).

- [x] **Step 5: Commit**

```bash
git add src/printUtils.js src/printUtils.test.js
git commit -m "feat: add detectDuplicateRuns with tests"
```

---

## Task 5 — `groupByConsecutiveType` — test then implement

**Files:**
- Modify: `src/printUtils.test.js`
- Modify: `src/printUtils.js`

`groupByConsecutiveType(runs)` groups consecutive runs sharing the same `type` into TypeGroups.

Return type per group: `{ type: string, accentColor: string, textColor: string, entries: Run[] }`
- `accentColor` and `textColor` come from `SEC_COLORS[type][1]` and `[2]`
- Falls back to `'#888'` / `'#333'` for unknown types

- [x] **Step 1: Write failing tests**

Append to `src/printUtils.test.js`:
```js
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
```

- [x] **Step 2: Run to confirm new tests fail**

```bash
npm test
```

Expected: `groupByConsecutiveType` suite fails; earlier suites still pass.

- [x] **Step 3: Implement `groupByConsecutiveType` in `src/printUtils.js`**

Append after `detectDuplicateRuns`:
```js
/**
 * Groups consecutive runs that share the same section type.
 * @param {{ representative: Object, count: number, labels: string[] }[]} runs
 * @returns {{ type: string, accentColor: string, textColor: string, entries: Object[] }[]}
 */
export function groupByConsecutiveType(runs) {
  if (!runs.length) return [];

  const getColors = (type) => {
    const c = SEC_COLORS[type];
    return c
      ? { accentColor: c[1], textColor: c[2] }
      : { accentColor: '#888', textColor: '#333' };
  };

  const groups = [];
  let current = {
    type: runs[0].representative.type,
    ...getColors(runs[0].representative.type),
    entries: [runs[0]],
  };

  for (let i = 1; i < runs.length; i++) {
    const run = runs[i];
    if (run.representative.type === current.type) {
      current.entries.push(run);
    } else {
      groups.push(current);
      current = {
        type: run.representative.type,
        ...getColors(run.representative.type),
        entries: [run],
      };
    }
  }
  groups.push(current);
  return groups;
}
```

- [x] **Step 4: Run to confirm all tests pass**

```bash
npm test
```

Expected: all 17 tests pass.

- [x] **Step 5: Commit**

```bash
git add src/printUtils.js src/printUtils.test.js
git commit -m "feat: add groupByConsecutiveType with tests"
```

---

## Task 6 — `renderBarRows` — test then implement

**Files:**
- Modify: `src/printUtils.test.js`
- Modify: `src/printUtils.js`

`renderBarRows(section, timeSig)` returns one string per row of up to 4 bars. Each bar is formatted as `| beat0 beat1 … |` with beat columns padded to the maximum chord-string length seen at that beat position across **all bars** in the section. Bars are joined with a single space, producing `| … | | … |` notation.

- [x] **Step 1: Write failing tests**

Append to `src/printUtils.test.js`:
```js
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
    // column widths: [1, 3, 1] → G padded to 1, Ebm padded to 3, . padded to 1
    expect(rows[0]).toBe('| G Ebm . |')
  })

  it('renders a bar with all empty beats as dots', () => {
    const section = { bars: 1, chords: {} }
    const rows = renderBarRows(section, '3/4')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toBe('| . . . |')
  })

  it('pads beat columns to max chord width across all bars', () => {
    // bar 0: C at beat 0 (width 1); bar 1: Csus2 at beat 0 (width 5)
    // colWidths[0] = 5, colWidths[1..3] = 1
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
```

- [x] **Step 2: Run to confirm new tests fail**

```bash
npm test
```

Expected: `renderBarRows` suite fails; all earlier tests still pass.

- [x] **Step 3: Implement `renderBarRows` in `src/printUtils.js`**

Append after `groupByConsecutiveType`:
```js
const PRINT_COLS = 4; // bars per row in the print view

/**
 * Renders a section's bars as an array of pipe-notation strings.
 * Each string is one row of up to PRINT_COLS bars.
 * Beat columns are padded to the max chord-string length at that position
 * across ALL bars in the section.
 *
 * Format: "| beat0 beat1 … | | beat0 beat1 … |"
 *
 * @param {{ bars: number, chords: Object }} section
 * @param {string} timeSig  e.g. "3/4"
 * @returns {string[]}
 */
export function renderBarRows(section, timeSig) {
  const nb = beatsPerBar(timeSig);

  // Compute the max label width for each beat position across all bars
  const colWidths = Array(nb).fill(1);
  for (let bar = 0; bar < section.bars; bar++) {
    for (let beat = 0; beat < nb; beat++) {
      const chord = section.chords[`${bar}-${beat}`];
      const label = chordStr(chord) || '.';
      if (label.length > colWidths[beat]) colWidths[beat] = label.length;
    }
  }

  const rows = [];
  for (let rowStart = 0; rowStart < section.bars; rowStart += PRINT_COLS) {
    const rowEnd = Math.min(rowStart + PRINT_COLS, section.bars);
    const barStrs = [];
    for (let bar = rowStart; bar < rowEnd; bar++) {
      const beats = Array.from({ length: nb }, (_, bi) => {
        const chord = section.chords[`${bar}-${bi}`];
        const label = chordStr(chord) || '.';
        return label.padEnd(colWidths[bi]);
      }).join(' ');
      barStrs.push(`| ${beats} |`);
    }
    rows.push(barStrs.join(' '));
  }
  return rows;
}
```

- [x] **Step 4: Run to confirm all tests pass**

```bash
npm test
```

Expected: all 23 tests pass.

- [x] **Step 5: Commit**

```bash
git add src/printUtils.js src/printUtils.test.js
git commit -m "feat: add renderBarRows with column alignment and tests"
```

---

## Task 7 — CSS: print/screen visibility

**Files:**
- Modify: `src/index.css`

- [x] **Step 1: Append visibility rules to `src/index.css`**

Add to the end of the file (after the existing `@media print` block):

```css
/* ─── Print / Screen toggle ──────────────────────────────────── */
@media screen {
  .print-view {
    display: none;
  }
}

@media print {
  .editor-screen {
    display: none !important;
  }
  .print-view {
    display: block !important;
  }
}
```

- [x] **Step 2: Verify dev server is unaffected**

```bash
npm run dev
```

Open http://localhost:5173. The editor should look completely unchanged. (`.print-view` doesn't exist in the DOM yet, so nothing visible changes.)

- [x] **Step 3: Commit**

```bash
git add src/index.css
git commit -m "feat: add print/screen CSS visibility for PrintView and editor"
```

---

## Task 8 — `PrintView` component and App wiring

**Files:**
- Modify: `src/App.jsx`

This is the only React component in the feature. It is hidden on screen (CSS Task 7) and shown when printing. All the heavy lifting is done by the pure functions from Tasks 3–6.

- [x] **Step 1: Update the import line in `src/App.jsx` to include all four new functions**

The import added in Task 2 was:
```js
import { SEC_COLORS, beatsPerBar, chordStr } from './printUtils.js';
```

Change it to:
```js
import { SEC_COLORS, beatsPerBar, chordStr, detectDuplicateRuns, groupByConsecutiveType, renderBarRows } from './printUtils.js';
```

- [x] **Step 2: Add `className="editor-screen"` to EditorScreen's root div**

In the `EditorScreen` function (starts around line 517), find the outermost `<div>` which currently reads:
```jsx
<div style={{ maxWidth: 960, margin: "0 auto", padding: "1.5rem 1rem 5rem" }}>
```

Change it to:
```jsx
<div className="editor-screen" style={{ maxWidth: 960, margin: "0 auto", padding: "1.5rem 1rem 5rem" }}>
```

- [x] **Step 3: Add the `PrintView` component to `src/App.jsx`**

Insert the following component directly before the `App` function (around line 649, after `EditorScreen` closes):

```jsx
// ─────────────────────────────────────────────────────────────
// Print View  (hidden on screen — visible only when printing)
// ─────────────────────────────────────────────────────────────
function PrintView({ song, sections }) {
  const timeSig = song.timeSig;
  const runs = detectDuplicateRuns(sections, timeSig);
  const typeGroups = groupByConsecutiveType(runs);

  return (
    <div className="print-view" style={{
      fontFamily: 'Georgia, "Times New Roman", serif',
      color: '#1A1A18',
      background: 'white',
    }}>
      {/* ── Song header ── */}
      <div style={{ marginBottom: '0.75rem' }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, lineHeight: 1.2 }}>
          {song.title}
        </h1>
        {song.artist && (
          <p style={{ fontSize: 13, color: '#555', margin: '2px 0 0' }}>
            {song.artist}
          </p>
        )}
        <p style={{ fontSize: 11, color: '#888', margin: '4px 0 0' }}>
          Key: {song.key} · BPM: {song.bpm} · Time: {song.timeSig}
        </p>
      </div>
      <hr style={{ border: 'none', borderTop: '1px solid #ddd', marginBottom: '0.75rem' }} />

      {/* ── Type groups ── */}
      {typeGroups.map((group, gi) => (
        <div key={gi} style={{ marginBottom: 16 }}>

          {/* Section type heading — appears once per consecutive group */}
          <div style={{
            fontWeight: 700,
            fontSize: 12,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: group.accentColor,
            marginBottom: 4,
          }}>
            {group.type}
          </div>

          {/* One entry per run (may be a collapsed duplicate group) */}
          {group.entries.map((run, ri) => {
            const rows = renderBarRows(run.representative, timeSig);
            const label = run.labels.join(' · ');

            // Show part label when: section has a custom label, OR there are
            // multiple entries under this type heading, OR the run collapsed >1 section
            const showLabel =
              run.representative.label !== '' ||
              group.entries.length > 1 ||
              run.count > 1;

            return (
              <div
                key={ri}
                style={{
                  borderLeft: `2px solid ${group.accentColor}`,
                  paddingLeft: 8,
                  marginBottom: ri < group.entries.length - 1 ? 7 : 0,
                }}
              >
                {showLabel && (
                  <div style={{
                    fontSize: 10,
                    fontWeight: 600,
                    color: group.accentColor,
                    marginBottom: 1,
                  }}>
                    {label}
                  </div>
                )}

                {rows.map((rowStr, rowi) => (
                  <div key={rowi} style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                    <span style={{
                      fontFamily: 'monospace',
                      fontSize: 10,
                      color: '#333',
                      whiteSpace: 'pre',
                    }}>
                      {rowStr}
                    </span>
                    {/* ×N suffix — only on the first row, only when count > 1 */}
                    {rowi === 0 && run.count > 1 && (
                      <span style={{
                        fontWeight: 700,
                        fontSize: 10,
                        color: group.accentColor,
                        fontFamily: 'Georgia, serif',
                      }}>
                        ×{run.count}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
```

- [x] **Step 4: Render `<PrintView>` in the root `App` component**

Find the `return` statement inside the `App` function (around line 736). The current JSX is:
```jsx
return (
  <>
    {view === "setup" ? (
      <SetupScreen song={song} onDone={handleSetupDone} />
    ) : (
      <EditorScreen ... />
    )}
    {picker && (
      <ChordPicker ... />
    )}
  </>
);
```

Replace with:
```jsx
return (
  <>
    {view === "setup" ? (
      <SetupScreen song={song} onDone={handleSetupDone} />
    ) : (
      <EditorScreen
        song={song}
        sections={sections}
        addSection={addSection}
        removeSection={removeSection}
        duplicateSection={duplicateSection}
        updateSection={updateSection}
        openPicker={openPicker}
        onBackToSetup={() => setView("setup")}
        onNewSong={handleNewSong}
      />
    )}
    {view === "editor" && (
      <PrintView song={song} sections={sections} />
    )}
    {picker && (
      <ChordPicker
        sectionId={picker.sectionId}
        barIdx={picker.barIdx}
        beatIdx={picker.beatIdx}
        sections={sections}
        onSet={handleSetChord}
        onClose={() => setPicker(null)}
      />
    )}
  </>
);
```

- [x] **Step 5: Verify `.print-view` is in the DOM but hidden**

```bash
npm run dev
```

Open http://localhost:5173, load a song. Open DevTools → Elements. Search for `.print-view`. Confirm it is present in the DOM with `display: none` applied via the screen media query.

- [x] **Step 6: Verify print preview**

Still in the browser with a song loaded, open print preview (Cmd+P on Mac / Ctrl+P on Windows). Confirm:
- The editor grid is hidden
- The PrintView content appears: title, artist, key/BPM/time metadata, then sections

- [x] **Step 7: Run all tests one final time**

```bash
npm test
```

Expected: all 23 tests pass, no failures.

- [x] **Step 8: Commit**

```bash
git add src/App.jsx
git commit -m "feat: add PrintView component with section grouping, duplicate collapse, and compact layout"
```

---

## Task 9 — End-to-end verification

- [x] **Step 1: Load the Allah Sumber Kuatku song (or recreate it)**

The song that exposed the original problem has:
- INTRO — Part 1, 2, 3 (Parts 1 and 2 are identical; Part 3 has 8 bars with empty row)
- INTRO — Intro copy (different time signature section, unique chords)
- VERSE — Bait 1
- OUTRO ×6 (six identical copies)
- OUTRO — Outro copy (unique: has Adim7/F# chords in bar 5)

If the song is saved in localStorage, load it from that browser. Otherwise create a representative song manually with the same structure.

- [x] **Step 2: Open print preview and verify all four features**

Open Cmd+P / Ctrl+P. Check:

| Feature | What to look for |
|---------|-----------------|
| Section title once | INTRO heading appears once; Part 1, Part 2, Part 3 indented under it |
| Uniform bar width | All bars in any one section have the same character width (monospace) |
| Duplicate collapse | The 6 identical OUTROs show as one entry with `×6` after the first bar row |
| Unique section in full | The last OUTRO (Adim7/F#) appears as a full separate entry, no ×N |
| Compact layout | Output is noticeably shorter than the original 2-page PDF |

- [x] **Step 3: Print to PDF**

Use browser's "Save as PDF" option. Confirm the result fits on 1 page (vs original 2 pages).

- [x] **Step 4: Verify production build is clean**

```bash
npm run build
```

Expected: no errors. `dist/` folder generated.

- [x] **Step 5: Final commit if any cleanup was needed**

```bash
git add -p   # stage only intentional changes
git commit -m "chore: post-verification cleanup"
```

---

## Self-Review Checklist

- ✅ **Spec coverage:** All four features covered — section title once (Task 8 PrintView grouping), uniform bar width (Task 6 renderBarRows), duplicate detection (Tasks 3–5), compact layout (Task 8 styles)
- ✅ **No TBD / TODO:** Every step has complete code
- ✅ **Type consistency:** `Run` shape (`representative`, `count`, `labels`) used consistently across Tasks 4, 5, 8. `TypeGroup` shape (`type`, `accentColor`, `textColor`, `entries`) consistent across Tasks 5 and 8. `renderBarRows` signature matches usage in PrintView.
- ✅ **Import chain:** `printUtils.js` exports are used in correct order. Task 2 import updated in Task 8 Step 1 to include all functions.
- ✅ **No new files beyond plan:** `src/printUtils.js`, `src/printUtils.test.js` — both called out in the file map.
