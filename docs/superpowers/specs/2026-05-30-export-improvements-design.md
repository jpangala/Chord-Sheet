# Export Improvements Design

**Date:** 2026-05-30  
**Project:** ChordSheet  
**Status:** Approved

---

## Context

The chord sheet app currently exports via `window.print()`, which prints the visual editor grid. The existing exported PDFs use a compact text/pipe notation format and are hard to read when sections repeat — a song with 6 identical OUTRO sections prints 6 full copies. Users also want cleaner grouping so the section type (INTRO, VERSE) doesn't repeat as a heading for every sub-part.

Four features are needed to make the export more compact and readable:

1. Section type shown once per consecutive group
2. Uniform bar width (column-aligned in monospace)
3. Duplicate section detection with ×N suffix
4. Overall compact layout

---

## Architecture Decision

Add a dedicated **`PrintView` component** that renders only when printing. The editor hides on print; `PrintView` takes over. This decouples the print format from the editor layout entirely.

```
@media screen  → .print-view { display: none }
@media print   → .editor-screen { display: none }
                 .print-view { display: block }
```

`PrintView` renders the text/pipe format that matches the existing PDF aesthetic. The editor grid is unchanged.

---

## Feature 1 — Section Title Shown Once

Sections are grouped into **consecutive type runs**: contiguous sections where `section.type` is the same. Within each run, the type name appears **once** as a heading.

```
INTRO                       ← one heading for the whole consecutive INTRO run
│ Part 1                    ← sub-entry, indented under colored left border
│ | G Ebm . | | C . . | …
│ Part 3
│ | G Ebm . | | C . . | …
VERSE                       ← new type → new heading
│ Bait 1
│ | G . . | | Bm . . | …
```

- Type heading: bold, uppercase, in the section's accent color from `SEC_COLORS`
- Sub-entries: 2px colored left border (accent color), 8px left padding
- If the same type reappears after a different type (Verse → Chorus → Verse), it gets a new heading the second time — **song order is always preserved**
- A section's display label: `section.label` if set, otherwise `section.type`

---

## Feature 2 — Uniform Bar Width

Within each section (or collapsed duplicate group), compute the max chord string length for each beat position across all bars in the section. Pad all bars to those widths so every bar occupies the same character width.

```
Before: | G Ebm . | | Csus2 . . |   ← uneven
After:  | G     Ebm . | | Csus2 .   . |  ← padded per beat column
```

Algorithm:
1. For each beat position `bi` (0 to numBeats-1), find `maxWidth[bi] = max(chord.length)` across all bars
2. Render each beat as `chord.padEnd(maxWidth[bi])`
3. Bars are joined: `| beat0 beat1 … |`

Incomplete last rows (e.g. 6 bars → row of 2) simply end at the last real bar — no ghost padding text.

---

## Feature 3 — Duplicate Detection with ×N

A pure function `sectionsEqual(a, b, timeSig)` compares:
- `a.bars === b.bars`
- Every chord value at every `barIdx-beatIdx` key

**Processing:** Scan sections linearly. Accumulate consecutive identical sections into a "run." When a run has length > 1, show only the first occurrence, with bold colored `×N` immediately after the closing `|` of the first bar row.

```
OUTRO
│ | Adim7/Eb . . | | Csus2 . . | | Csus2 . . | | Dadd9 . . |  ×6
│ | . . . | | . . . | | . . . | | . . . |
OUTRO — Outro copy                ← unique: shown in full, no ×N
│ | Adim7/Eb . . | | Csus2 . . | …
│ | Adim7/F# Adim7/F# Adim7/F# | …
```

- `×N` is bold, colored in the section's accent color
- Combined label for a collapsed run: each section's display label joined by ` · `
- Non-consecutive identical sections are shown separately (preserves song order)
- Duplicate detection happens **before** type grouping in the processing pipeline

---

## Feature 4 — Compact Layout

- **No bordered boxes or background fills** — type headings and colored left borders only
- **Spacing:** 6–8px between sub-entries within a type group; 14–16px between type groups
- **Font sizes:** title ~18px, artist ~13px, metadata ~11px, type heading ~12px, part label ~10px, bar rows ~10px monospace
- **Font families:** Georgia serif for headings; `monospace` for bar rows
- **Separator:** thin `<hr>` after the song metadata block only

---

## Processing Pipeline

```
sections[]
  → step 1: detect consecutive duplicate runs
            output: runs[] where each run = { sections: Section[], count: number }
  → step 2: group consecutive runs by type
            output: typeGroups[] where each group = { type, accentColor, entries: Run[] }
  → step 3: render each type group to JSX
```

**Key pure functions:**
- `sectionsEqual(a, b, timeSig)` → boolean
- `detectDuplicateRuns(sections, timeSig)` → Run[]
- `groupByConsecutiveType(runs)` → TypeGroup[]
- `renderBarRows(section, timeSig)` → string[] (one per row of 4 bars)

---

## Files Changed

| File | Change |
|------|--------|
| `src/App.jsx` | Add `PrintView` component + 4 pure functions; add `className="editor-screen"` to `EditorScreen`'s root `<div>` |
| `src/index.css` | Add `@media screen` and `@media print` rules for `.print-view` and `.editor-screen` |

No new files. All logic stays in `src/App.jsx`.

---

## Verification

1. Run `npm run dev`, open app, create a song with:
   - 3 identical Intro parts
   - 1 Verse
   - 6 identical Outros + 1 unique Outro
2. Click "Print / PDF" → browser print preview
3. Verify:
   - INTRO heading appears once; Part 1, Part 2, Part 3 grouped beneath it
   - Duplicate Intros show ×2 (or ×3 if applicable), unique one shown separately
   - All bars in a section are the same character width
   - The 6 identical OUTROs collapse to `×6` with the unique one shown in full
   - Output fits on fewer pages than before
4. Print to PDF and compare page count vs original
