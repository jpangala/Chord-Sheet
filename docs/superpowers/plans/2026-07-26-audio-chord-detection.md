# Audio Chord Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user upload an audio file, analyze it entirely client-side (chroma-based chord detection + tempo detection), and review/edit the detected chord sequence before it's inserted as a new, bar/beat-aligned section.

**Architecture:** Pure DSP/matching logic lives in `src/audioChords.js` (Vitest-testable). Chroma extraction + chord template matching — the CPU-heavy part — runs off the main thread in `src/audioChordsWorker.js`. A new `src/AudioImportModal.jsx` component drives the upload → analyze → preview → commit flow and reuses the existing chord-editing UI (extracted to its own file, `src/ChordPicker.jsx`, to avoid a circular import between `App.jsx` and the new modal). `App.jsx` gains one toolbar button and one new song-mutation callback, following the same `patchCurrent` pattern already used by `addSection`/`updateSection`.

**Tech Stack:** React 18, Vite 5, Vitest, [Meyda](https://github.com/meyda/meyda) (chroma extraction), [web-audio-beat-detector](https://github.com/chrisguttandin/web-audio-beat-detector) (tempo), Web Audio API, Web Workers.

**Spec:** `docs/superpowers/specs/2026-07-26-audio-chord-detection-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|-----------------|
| `package.json` | Modify | Add `meyda`, `web-audio-beat-detector` dependencies |
| `src/ChordPicker.jsx` | **Create** | Extracted from `App.jsx` — chord-editing popover, reused by both the editor and the audio-import preview |
| `src/App.jsx` | Modify | Remove inline `ChordPicker`, import it instead; add "Import from Audio" toolbar button, `audioImportOpen` state, `addSectionFromAudio` callback, render `<AudioImportModal>` |
| `src/audioChords.js` | **Create** | Pure DSP/matching functions: `CHORD_TEMPLATES`, `matchChordTemplates`, `smoothChordSequence`, `buildDraftSection`, plus the browser-API wrappers `decodeAudioFile`, `detectTempo`, `extractChromaFrames` |
| `src/audioChords.test.js` | **Create** | Unit tests for the three pure functions |
| `src/audioChordsWorker.js` | **Create** | Web Worker: runs `extractChromaFrames` + `matchChordTemplates` off the main thread |
| `src/AudioImportModal.jsx` | **Create** | Upload UI, progress states, orchestration, error states, preview grid, section type/label, commit |

**Note on scope vs. spec:** the design spec's file list didn't call out `src/ChordPicker.jsx` explicitly — it said the preview should reuse "the existing `ChordPicker`." Since `AudioImportModal.jsx` needs to import that component and `App.jsx` needs to import `AudioImportModal.jsx`, leaving `ChordPicker` defined inside `App.jsx` would create a circular import. Extracting it to its own file (a pure refactor, no behavior change) resolves that cleanly and is called out here per the "split an unwieldy file" guidance.

---

## Task 1 — Install dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the two new dependencies**

```bash
cd "/Users/jpangala/Project/Chord Sheet Project/chordsheet"
npm install meyda web-audio-beat-detector
```

Expected: both packages appear in `dependencies` in `package.json`.

- [ ] **Step 2: Verify the app still builds**

```bash
npm run build
```

Expected: no errors, `dist/` folder generated.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add meyda and web-audio-beat-detector for audio chord detection"
```

---

## Task 2 — Extract `ChordPicker` into its own file

**Files:**
- Create: `src/ChordPicker.jsx`
- Modify: `src/App.jsx:1-5` (imports), `src/App.jsx:12-235` (remove inline definition)

Pure refactor — no behavior change. This is what lets `AudioImportModal.jsx` reuse the picker without a circular import.

- [ ] **Step 1: Create `src/ChordPicker.jsx` with the extracted component**

```jsx
import { useState, useEffect, useRef } from "react";
import { chordStr } from "./printUtils.js";
import { ROOTS, QUALITIES, parseChord, getChordSuggestions } from "./chords.js";

// ─────────────────────────────────────────────────────────────
// Chord Picker Modal
// ─────────────────────────────────────────────────────────────
export function ChordPicker({ sectionId, barIdx, beatIdx, sections, onSet, onClose }) {
  const sec = sections.find((s) => s.id === sectionId);
  const existing = sec?.chords[`${barIdx}-${beatIdx}`] || null;
  const [root, setRoot] = useState(existing?.root || "C");
  const [qual, setQual] = useState(existing?.qual ?? "");
  const [bass, setBass] = useState(existing?.bass || "");
  const [text, setText] = useState(chordStr(existing) || (existing ? "" : "C"));
  const [showSuggest, setShowSuggest] = useState(false);
  const [activeSuggest, setActiveSuggest] = useState(0);
  const ref = useRef();
  const inputRef = useRef();

  const suggestions = showSuggest ? getChordSuggestions(text) : [];

  const commitTyped = (raw) => {
    setText(raw);
    const parsed = parseChord(raw);
    if (parsed) {
      setRoot(parsed.root);
      setQual(parsed.qual);
      setBass(parsed.bass);
    }
    setActiveSuggest(0);
  };

  const pickFromButton = (next) => {
    const nr = next.root ?? root;
    const nq = next.qual ?? qual;
    const nb = next.bass ?? bass;
    if (next.root !== undefined) setRoot(nr);
    if (next.qual !== undefined) setQual(nq);
    if (next.bass !== undefined) setBass(nb);
    setText(chordStr({ root: nr, qual: nq, bass: nb }) || "");
    setShowSuggest(false);
  };

  const applySuggestion = (s) => {
    commitTyped(s);
    setShowSuggest(false);
    inputRef.current?.focus();
  };

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    const h = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  const preview = chordStr({ root, qual, bass }) || "—";

  const btn = (active) => ({
    padding: "6px 4px",
    borderRadius: 6,
    border: "1px solid",
    borderColor: active ? "#378ADD" : "var(--color-border)",
    background: active ? "#E6F1FB" : "transparent",
    color: active ? "#0C447C" : "var(--color-text)",
    fontSize: 12,
    fontWeight: active ? 600 : 400,
    cursor: "pointer",
    transition: "all 0.1s",
  });

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(0,0,0,0.4)",
      }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={ref}
        style={{
          background: "var(--color-surface)",
          border: "1px solid var(--color-border-strong)",
          borderRadius: 16, padding: "1.5rem",
          width: 340, maxHeight: "90vh", overflowY: "auto",
          boxShadow: "0 16px 48px rgba(0,0,0,0.2)",
          display: "flex", flexDirection: "column", gap: 16,
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 12, color: "var(--color-text-3)" }}>
            Bar {barIdx + 1} · Beat {beatIdx + 1}
          </span>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "var(--color-text-2)", padding: "0 4px", lineHeight: 1 }}
          >×</button>
        </div>

        {/* Preview */}
        <div style={{ textAlign: "center", padding: "0.75rem", background: "var(--color-surface-2)", borderRadius: 10 }}>
          <div style={{ fontSize: 36, fontWeight: 700, fontFamily: "var(--font-serif)", color: "var(--color-text)", lineHeight: 1 }}>
            {preview}
          </div>
        </div>

        {/* Typed input with autocomplete */}
        <div style={{ position: "relative" }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: "var(--color-text-3)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.08em" }}>Type</div>
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => { commitTyped(e.target.value); setShowSuggest(true); }}
            onFocus={() => setShowSuggest(true)}
            onBlur={() => setTimeout(() => setShowSuggest(false), 120)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" && suggestions.length) {
                e.preventDefault();
                setActiveSuggest((i) => Math.min(suggestions.length - 1, i + 1));
              } else if (e.key === "ArrowUp" && suggestions.length) {
                e.preventDefault();
                setActiveSuggest((i) => Math.max(0, i - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                if (showSuggest && suggestions[activeSuggest]) {
                  applySuggestion(suggestions[activeSuggest]);
                } else if (parseChord(text)) {
                  onSet(parseChord(text));
                }
              } else if (e.key === "Escape" && showSuggest) {
                e.preventDefault();
                setShowSuggest(false);
              }
            }}
            placeholder="e.g. Cmaj7, Am, Dm7/F"
            style={{
              width: "100%", padding: "8px 10px", borderRadius: 8,
              border: parseChord(text) || !text ? "1px solid var(--color-border-strong)" : "1px solid var(--color-danger-border)",
              background: "var(--color-surface)", color: "var(--color-text)",
              fontSize: 14, fontFamily: "var(--font-serif)", outline: "none",
            }}
          />
          {showSuggest && suggestions.length > 0 && (
            <div style={{
              position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
              background: "var(--color-surface)",
              border: "1px solid var(--color-border-strong)",
              borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
              zIndex: 10, maxHeight: 220, overflowY: "auto",
            }}>
              {suggestions.map((s, i) => (
                <div
                  key={s}
                  onMouseDown={(e) => { e.preventDefault(); applySuggestion(s); }}
                  onMouseEnter={() => setActiveSuggest(i)}
                  style={{
                    padding: "6px 10px", cursor: "pointer",
                    fontSize: 13, fontFamily: "var(--font-serif)",
                    background: i === activeSuggest ? "var(--color-surface-2)" : "transparent",
                    color: "var(--color-text)",
                  }}
                >{s}</div>
              ))}
            </div>
          )}
        </div>

        {/* Root */}
        <div>
          <div style={{ fontSize: 10, fontWeight: 600, color: "var(--color-text-3)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.08em" }}>Root</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 4 }}>
            {ROOTS.map((r) => (
              <button key={r} onClick={() => pickFromButton({ root: r })} style={btn(root === r)}>{r}</button>
            ))}
          </div>
        </div>

        {/* Quality */}
        <div>
          <div style={{ fontSize: 10, fontWeight: 600, color: "var(--color-text-3)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.08em" }}>Quality</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 4 }}>
            {QUALITIES.map((q) => (
              <button key={q.v} onClick={() => pickFromButton({ qual: q.v })} style={btn(qual === q.v)}>{q.l}</button>
            ))}
          </div>
        </div>

        {/* Bass */}
        <div>
          <div style={{ fontSize: 10, fontWeight: 600, color: "var(--color-text-3)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.08em" }}>Bass note (slash chord)</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 4 }}>
            <button onClick={() => pickFromButton({ bass: "" })} style={btn(bass === "")}>none</button>
            {ROOTS.map((r) => (
              <button key={r} onClick={() => pickFromButton({ bass: r })} style={btn(bass === r)}>{r}</button>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 8, paddingTop: 4 }}>
          <button
            onClick={() => onSet(null)}
            style={{
              flex: 1, padding: "9px", borderRadius: 8,
              border: "1px solid var(--color-border-strong)",
              background: "transparent", color: "var(--color-text-2)",
              fontSize: 13, cursor: "pointer",
            }}
          >Clear beat</button>
          <button
            onClick={() => onSet({ root, qual, bass })}
            style={{
              flex: 2, padding: "9px", borderRadius: 8, border: "none",
              background: "var(--color-accent)", color: "var(--color-bg)",
              fontSize: 13, fontWeight: 600, cursor: "pointer",
            }}
          >Set chord ↵</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update `src/App.jsx` — add the import**

At the top of `src/App.jsx`, the current imports are:
```js
import { SEC_COLORS, beatsPerBar, chordStr, detectDuplicateRuns, groupByConsecutiveType, renderBarRows, transposeSong } from './printUtils.js';
import { cloudDeleteSong, cloudFetchSongs, cloudSaveSong, isCloudEnabled } from './cloud.js';
import { useState, useEffect, useRef, useCallback } from "react";
import { uid, sortSections, makeSection, makeSong, makeSongRecord, timeAgo, loadData, saveData } from './models.js';
import { SECTION_TYPES, TIME_SIGS, ROOTS, QUALITIES, ROOTS_BY_LEN, QUAL_VALS_BY_LEN, parseChord, ALL_CHORDS, getChordSuggestions } from './chords.js';
```

Add one line after them:
```js
import { ChordPicker } from './ChordPicker.jsx';
```

- [ ] **Step 3: Remove the inline `ChordPicker` definition from `src/App.jsx`**

Delete the entire block from the comment header through the function's closing brace:
```jsx
// ─────────────────────────────────────────────────────────────
// Chord Picker Modal
// ─────────────────────────────────────────────────────────────
function ChordPicker({ sectionId, barIdx, beatIdx, sections, onSet, onClose }) {
  ... (full body, as moved into src/ChordPicker.jsx above) ...
}
```
Leave the `BeatCell` section right after it untouched.

- [ ] **Step 4: Verify the editor still works**

```bash
npm run dev
```

Open http://localhost:5173, open a song, click a beat cell. Confirm the chord picker still opens, the root/quality/bass buttons and typed-input autocomplete all still work, and setting/clearing a chord still updates the grid.

- [ ] **Step 5: Run the full test suite**

```bash
npm test
```

Expected: all existing tests still pass (this was a pure move, no logic changed).

- [ ] **Step 6: Commit**

```bash
git add src/ChordPicker.jsx src/App.jsx
git commit -m "refactor: extract ChordPicker into its own file"
```

---

## Task 3 — `src/audioChords.js`: chord templates + `matchChordTemplates`

**Files:**
- Create: `src/audioChords.js`
- Create: `src/audioChords.test.js`

`matchChordTemplates(chroma)` takes a 12-element chroma (pitch-class energy) vector and returns the best-matching chord from a fixed set of 108 templates (12 roots × 9 basic qualities), via cosine similarity.

- [ ] **Step 1: Write the failing tests**

Create `src/audioChords.test.js`:
```js
import { describe, it, expect } from 'vitest'
import { matchChordTemplates } from './audioChords.js'

describe('matchChordTemplates', () => {
  it('matches a C major chroma vector (C, E, G) to C major with high confidence', () => {
    // Chroma index order follows ROOTS: C,C#,D,Eb,E,F,F#,G,Ab,A,Bb,B
    const chroma = [1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0]
    const result = matchChordTemplates(chroma)
    expect(result.root).toBe('C')
    expect(result.qual).toBe('')
    expect(result.confidence).toBeGreaterThan(0.9)
  })

  it('matches an A minor chroma vector (A, C, E) to A minor', () => {
    const chroma = [1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0]
    const result = matchChordTemplates(chroma)
    expect(result.root).toBe('A')
    expect(result.qual).toBe('m')
  })

  it('returns 0 confidence for a silent (all-zero) chroma vector', () => {
    const chroma = Array(12).fill(0)
    const result = matchChordTemplates(chroma)
    expect(result.confidence).toBe(0)
  })
})
```

- [ ] **Step 2: Run to confirm it fails**

```bash
npm test
```

Expected: fails with `matchChordTemplates is not a function` (or similar import error).

- [ ] **Step 3: Implement `src/audioChords.js`**

```js
// ─── Audio-based chord detection: pure DSP/matching logic ─────
// Browser-API wrappers (decodeAudioFile, detectTempo, extractChromaFrames)
// live in this same file but are not unit-tested — see Tasks 6-7.

import { ROOTS } from './chords.js';
import { beatsPerBar } from './printUtils.js';

// Only qualities reliably distinguishable from a 12-bin chroma vector.
// Values match the `v` field of QUALITIES in chords.js exactly, so
// detected chords are valid input to chordStr/ChordPicker unchanged.
const QUALITY_INTERVALS = {
  '':     [0, 4, 7],       // major
  'm':    [0, 3, 7],       // minor
  '7':    [0, 4, 7, 10],   // dominant 7
  'maj7': [0, 4, 7, 11],
  'm7':   [0, 3, 7, 10],
  'dim':  [0, 3, 6],
  'aug':  [0, 4, 8],
  'sus2': [0, 2, 7],
  'sus4': [0, 5, 7],
};

function buildTemplate(rootSemitone, intervals) {
  const t = Array(12).fill(0);
  for (const iv of intervals) t[(rootSemitone + iv) % 12] = 1;
  return t;
}

// 12 roots × 9 qualities = 108 templates. ROOTS is chromatic starting at C
// (C,C#,D,Eb,E,F,F#,G,Ab,A,Bb,B), so array index === semitone offset from C —
// reused directly instead of hand-maintaining a second root/semitone table.
export const CHORD_TEMPLATES = (() => {
  const out = [];
  ROOTS.forEach((root, semitone) => {
    for (const [qual, intervals] of Object.entries(QUALITY_INTERVALS)) {
      out.push({ root, qual, template: buildTemplate(semitone, intervals) });
    }
  });
  return out;
})();

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Matches a 12-element chroma vector against the fixed chord-template set.
 * @param {number[]} chroma
 * @returns {{ root: string, qual: string, confidence: number }}
 */
export function matchChordTemplates(chroma) {
  let best = CHORD_TEMPLATES[0];
  let bestScore = -Infinity;
  for (const entry of CHORD_TEMPLATES) {
    const score = cosineSimilarity(chroma, entry.template);
    if (score > bestScore) { bestScore = score; best = entry; }
  }
  return { root: best.root, qual: best.qual, confidence: Math.max(0, bestScore) };
}
```

- [ ] **Step 4: Run to confirm all tests pass**

```bash
npm test
```

Expected: 3 new tests pass, all prior tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/audioChords.js src/audioChords.test.js
git commit -m "feat: add chord template matching for audio detection"
```

---

## Task 4 — `smoothChordSequence`

**Files:**
- Modify: `src/audioChords.js`
- Modify: `src/audioChords.test.js`

Raw frame-by-frame chord matches are noisy (one match per ~20ms window). `smoothChordSequence` groups consecutive identical matches into segments, then merges any segment shorter than a minimum duration into its longer neighbor — removing single-frame "blips" without needing an ML model.

- [ ] **Step 1: Write the failing tests**

Append to `src/audioChords.test.js`:
```js
import { smoothChordSequence } from './audioChords.js'

describe('smoothChordSequence', () => {
  const frameDuration = 0.1 // seconds between frames

  it('returns [] for empty input', () => {
    expect(smoothChordSequence([], frameDuration)).toEqual([])
  })

  it('merges consecutive identical frames into one segment', () => {
    const frames = [
      { time: 0.0, root: 'C', qual: '', confidence: 0.9 },
      { time: 0.1, root: 'C', qual: '', confidence: 0.8 },
      { time: 0.2, root: 'C', qual: '', confidence: 0.85 },
    ]
    const result = smoothChordSequence(frames, frameDuration)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ root: 'C', qual: '', startTime: 0.0, endTime: 0.3 })
    expect(result[0].confidence).toBeCloseTo(0.85, 2)
  })

  it('splits into separate segments on a sustained chord change', () => {
    const frames = [
      { time: 0.0, root: 'C', qual: '', confidence: 0.9 },
      { time: 0.1, root: 'C', qual: '', confidence: 0.9 },
      { time: 0.2, root: 'C', qual: '', confidence: 0.9 },
      { time: 0.3, root: 'G', qual: '', confidence: 0.9 },
      { time: 0.4, root: 'G', qual: '', confidence: 0.9 },
      { time: 0.5, root: 'G', qual: '', confidence: 0.9 },
    ]
    const result = smoothChordSequence(frames, frameDuration)
    expect(result).toHaveLength(2)
    expect(result[0].root).toBe('C')
    expect(result[1].root).toBe('G')
  })

  it('absorbs a single-frame blip into the surrounding longer segment', () => {
    const frames = [
      { time: 0.0, root: 'C', qual: '', confidence: 0.9 },
      { time: 0.1, root: 'C', qual: '', confidence: 0.9 },
      { time: 0.2, root: 'C', qual: '', confidence: 0.9 },
      { time: 0.3, root: 'G', qual: '', confidence: 0.4 }, // 0.1s blip, below the 0.3s threshold
      { time: 0.4, root: 'C', qual: '', confidence: 0.9 },
      { time: 0.5, root: 'C', qual: '', confidence: 0.9 },
    ]
    const result = smoothChordSequence(frames, frameDuration, 0.3)
    expect(result).toHaveLength(1)
    expect(result[0].root).toBe('C')
  })
})
```

- [ ] **Step 2: Run to confirm the new tests fail**

```bash
npm test
```

Expected: `smoothChordSequence` suite fails with an import error; `matchChordTemplates` suite still passes.

- [ ] **Step 3: Implement `smoothChordSequence` in `src/audioChords.js`**

Append after `matchChordTemplates`:
```js
/**
 * Groups consecutive identical-chord frames into segments, then merges any
 * segment shorter than `minSegmentSeconds` into its longer neighbor.
 * @param {{time:number, root:string, qual:string, confidence:number}[]} frames
 * @param {number} frameDuration seconds represented by one frame
 * @param {number} [minSegmentSeconds]
 * @returns {{root:string, qual:string, confidence:number, startTime:number, endTime:number}[]}
 */
export function smoothChordSequence(frames, frameDuration, minSegmentSeconds = 0.3) {
  if (!frames.length) return [];

  // Pass 1: group consecutive identical (root, qual) frames into raw segments.
  const raw = [];
  let cur = {
    root: frames[0].root, qual: frames[0].qual,
    startTime: frames[0].time, endTime: frames[0].time + frameDuration,
    confidences: [frames[0].confidence],
  };
  for (let i = 1; i < frames.length; i++) {
    const f = frames[i];
    if (f.root === cur.root && f.qual === cur.qual) {
      cur.endTime = f.time + frameDuration;
      cur.confidences.push(f.confidence);
    } else {
      raw.push(cur);
      cur = {
        root: f.root, qual: f.qual,
        startTime: f.time, endTime: f.time + frameDuration,
        confidences: [f.confidence],
      };
    }
  }
  raw.push(cur);

  // Pass 2: merge segments shorter than minSegmentSeconds into the longer neighbor.
  const segments = raw;
  let changed = true;
  while (changed && segments.length > 1) {
    changed = false;
    for (let i = 0; i < segments.length; i++) {
      const dur = segments[i].endTime - segments[i].startTime;
      if (dur < minSegmentSeconds) {
        const prev = segments[i - 1];
        const next = segments[i + 1];
        const prevDur = prev ? prev.endTime - prev.startTime : -1;
        const nextDur = next ? next.endTime - next.startTime : -1;
        if (prev && prevDur >= nextDur) {
          prev.endTime = segments[i].endTime;
          prev.confidences.push(...segments[i].confidences);
          segments.splice(i, 1);
        } else if (next) {
          next.startTime = segments[i].startTime;
          next.confidences.unshift(...segments[i].confidences);
          segments.splice(i, 1);
        } else {
          continue;
        }
        changed = true;
        break;
      }
    }
  }

  return segments.map((s) => ({
    root: s.root,
    qual: s.qual,
    confidence: s.confidences.reduce((a, b) => a + b, 0) / s.confidences.length,
    startTime: s.startTime,
    endTime: s.endTime,
  }));
}
```

- [ ] **Step 4: Run to confirm all tests pass**

```bash
npm test
```

Expected: all tests pass (7 total in `audioChords.test.js`).

- [ ] **Step 5: Commit**

```bash
git add src/audioChords.js src/audioChords.test.js
git commit -m "feat: add smoothChordSequence to collapse noisy frame-level chord matches"
```

---

## Task 5 — `buildDraftSection`

**Files:**
- Modify: `src/audioChords.js`
- Modify: `src/audioChords.test.js`

`buildDraftSection(segments, bpm, timeSig)` converts time-based chord segments into a bar/beat-keyed `chords` map (same shape as an existing `Section.chords`), placing each detected chord at the beat where its segment starts — matching how a chord chart is normally written (mark the chord once, leave the following beats blank until the next change).

- [ ] **Step 1: Write the failing tests**

Append to `src/audioChords.test.js`:
```js
import { buildDraftSection } from './audioChords.js'

describe('buildDraftSection', () => {
  const timeSig = '4/4'

  it('returns a default empty 4-bar section for no segments', () => {
    expect(buildDraftSection([], 120, timeSig)).toEqual({ bars: 4, chords: {}, confidence: {} })
  })

  it('places a chord at the beat where each segment starts, at 120 BPM / 4-4', () => {
    // 120 BPM -> 0.5s per beat -> 2s per bar
    const segments = [
      { root: 'C', qual: '', confidence: 0.9, startTime: 0.0, endTime: 2.0 }, // beat 0 -> bar 0 beat 0
      { root: 'G', qual: '', confidence: 0.8, startTime: 2.0, endTime: 4.0 }, // beat 4 -> bar 1 beat 0
    ]
    const result = buildDraftSection(segments, 120, timeSig)
    expect(result.chords['0-0']).toEqual({ root: 'C', qual: '', bass: '' })
    expect(result.chords['1-0']).toEqual({ root: 'G', qual: '', bass: '' })
    expect(result.confidence['0-0']).toBeCloseTo(0.9)
    expect(result.confidence['1-0']).toBeCloseTo(0.8)
    expect(result.bars).toBe(2)
  })

  it('rounds the bar count up to cover a partial final bar', () => {
    // 120 BPM, one segment lasting 3 beats (1.5s) inside a single 4/4 bar
    const segments = [
      { root: 'C', qual: '', confidence: 0.9, startTime: 0.0, endTime: 1.5 },
    ]
    const result = buildDraftSection(segments, 120, timeSig)
    expect(result.bars).toBe(1)
  })
})
```

- [ ] **Step 2: Run to confirm the new tests fail**

```bash
npm test
```

Expected: `buildDraftSection` suite fails with an import error; earlier suites still pass.

- [ ] **Step 3: Implement `buildDraftSection` in `src/audioChords.js`**

Append after `smoothChordSequence`:
```js
/**
 * Lays out time-based chord segments onto a bar/beat grid.
 * @param {{root:string, qual:string, confidence:number, startTime:number, endTime:number}[]} segments
 * @param {number} bpm
 * @param {string} timeSig e.g. "4/4"
 * @returns {{ bars: number, chords: Object, confidence: Object }}
 */
export function buildDraftSection(segments, bpm, timeSig) {
  const nb = beatsPerBar(timeSig);
  const secondsPerBeat = 60 / bpm;

  if (!segments.length) {
    return { bars: 4, chords: {}, confidence: {} };
  }

  const chords = {};
  const confidence = {};
  let maxBeat = 0;

  for (const seg of segments) {
    const startBeat = Math.round(seg.startTime / secondsPerBeat);
    const bar = Math.floor(startBeat / nb);
    const beatInBar = startBeat % nb;
    const key = `${bar}-${beatInBar}`;
    chords[key] = { root: seg.root, qual: seg.qual, bass: '' };
    confidence[key] = seg.confidence;

    const endBeat = Math.max(startBeat + 1, Math.round(seg.endTime / secondsPerBeat));
    if (endBeat > maxBeat) maxBeat = endBeat;
  }

  const bars = Math.max(1, Math.ceil(maxBeat / nb));
  return { bars, chords, confidence };
}
```

- [ ] **Step 4: Run to confirm all tests pass**

```bash
npm test
```

Expected: all tests pass (10 total in `audioChords.test.js`).

- [ ] **Step 5: Commit**

```bash
git add src/audioChords.js src/audioChords.test.js
git commit -m "feat: add buildDraftSection to lay out detected chords on the bar/beat grid"
```

---

## Task 6 — `decodeAudioFile` and `detectTempo`

**Files:**
- Modify: `src/audioChords.js`

These are thin wrappers around the Web Audio API and the `web-audio-beat-detector` library — not meaningfully unit-testable (per the spec), so this task implements them and verifies via a production build rather than Vitest. Full functional verification happens in Task 12 with a real audio file.

- [ ] **Step 1: Implement `decodeAudioFile` and `detectTempo` in `src/audioChords.js`**

Add this import at the top of `src/audioChords.js`, alongside the existing ones:
```js
import { analyze } from 'web-audio-beat-detector';
```

Append after `buildDraftSection`:
```js
/**
 * Decodes an uploaded audio File into an AudioBuffer.
 * @param {File} file
 * @returns {Promise<AudioBuffer>}
 */
export async function decodeAudioFile(file) {
  const arrayBuffer = await file.arrayBuffer();
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  try {
    return await ctx.decodeAudioData(arrayBuffer);
  } finally {
    ctx.close();
  }
}

/**
 * Estimates tempo (BPM) from a decoded AudioBuffer.
 * @param {AudioBuffer} audioBuffer
 * @returns {Promise<number>}
 */
export async function detectTempo(audioBuffer) {
  return analyze(audioBuffer);
}
```

- [ ] **Step 2: Verify the app builds**

```bash
npm run build
```

Expected: no errors — this confirms the import of `web-audio-beat-detector` resolves and the syntax is valid. (Functional behavior is verified with a real file in Task 12.)

- [ ] **Step 3: Commit**

```bash
git add src/audioChords.js
git commit -m "feat: add decodeAudioFile and detectTempo wrappers"
```

---

## Task 7 — `extractChromaFrames`

**Files:**
- Modify: `src/audioChords.js`

Slides a window across raw channel samples and extracts a chroma vector per window using Meyda's offline `extract` API. Like Task 6, this isn't unit-tested — verified with a real file in Task 12.

- [ ] **Step 1: Implement `extractChromaFrames` in `src/audioChords.js`**

Add this import at the top of `src/audioChords.js`:
```js
import Meyda from 'meyda';
```

Append after `detectTempo`:
```js
const WINDOW_SIZE = 2048; // samples per analysis window
const HOP_SIZE = 1024;    // 50% overlap between windows

/**
 * Slides a window across raw PCM samples, extracting a 12-bin chroma vector
 * per window.
 * @param {Float32Array} channelData
 * @param {number} sampleRate
 * @returns {{time:number, chroma:number[]}[]}
 */
export function extractChromaFrames(channelData, sampleRate) {
  Meyda.bufferSize = WINDOW_SIZE;
  Meyda.sampleRate = sampleRate;
  const frames = [];
  for (let start = 0; start + WINDOW_SIZE <= channelData.length; start += HOP_SIZE) {
    const window = channelData.subarray(start, start + WINDOW_SIZE);
    const chroma = Meyda.extract('chroma', window);
    frames.push({ time: start / sampleRate, chroma });
  }
  return frames;
}
```

- [ ] **Step 2: Verify the app builds**

```bash
npm run build
```

Expected: no errors — confirms the `meyda` import resolves and the syntax is valid.

- [ ] **Step 3: Commit**

```bash
git add src/audioChords.js
git commit -m "feat: add extractChromaFrames using Meyda"
```

---

## Task 8 — Web Worker: `src/audioChordsWorker.js`

**Files:**
- Create: `src/audioChordsWorker.js`

Runs the CPU-heavy part (`extractChromaFrames` + `matchChordTemplates` per frame) off the main thread, so the modal's progress UI and cancel button stay responsive during analysis.

- [ ] **Step 1: Create `src/audioChordsWorker.js`**

```js
import { extractChromaFrames, matchChordTemplates } from './audioChords.js';

self.onmessage = (e) => {
  const { channelData, sampleRate } = e.data;
  try {
    const chromaFrames = extractChromaFrames(channelData, sampleRate);
    const frames = chromaFrames.map(({ time, chroma }) => {
      const { root, qual, confidence } = matchChordTemplates(chroma);
      return { time, root, qual, confidence };
    });
    self.postMessage({ type: 'done', frames });
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message });
  }
};
```

- [ ] **Step 2: Verify the app builds**

```bash
npm run build
```

Expected: no errors. Vite bundles module workers referenced via `new URL(..., import.meta.url)` automatically — this will be wired up in Task 9, where the build will also confirm the worker entry point itself is valid.

- [ ] **Step 3: Commit**

```bash
git add src/audioChordsWorker.js
git commit -m "feat: add Web Worker for off-main-thread chord detection"
```

---

## Task 9 — `AudioImportModal`: upload, progress, orchestration, errors

**Files:**
- Create: `src/AudioImportModal.jsx`

This task builds the modal shell and the analysis pipeline (decode → parallel tempo+chroma/match → smooth → build) with all error/cancel states. The preview grid and commit UI are added in Task 10.

- [ ] **Step 1: Create `src/AudioImportModal.jsx`**

```jsx
import { useState, useRef, useCallback } from 'react';
import {
  decodeAudioFile, detectTempo, smoothChordSequence, buildDraftSection,
} from './audioChords.js';
import { SECTION_TYPES } from './chords.js';
import { uid } from './models.js';

const MAX_ANALYSIS_SECONDS = 300; // cap chroma/chord analysis to the first 5 minutes
const MIN_CONFIDENCE_FOR_RESULT = 0.35; // below this average, treat as "no clear chords"

export function AudioImportModal({ song, onCreateSection, onClose }) {
  const [step, setStep] = useState('pick'); // 'pick' | 'decoding' | 'analyzing' | 'preview' | 'error'
  const [errorMessage, setErrorMessage] = useState('');
  const [truncated, setTruncated] = useState(false);
  const [detectedBpm, setDetectedBpm] = useState(null);
  const [updateBpm, setUpdateBpm] = useState(false);
  const [draft, setDraft] = useState(null); // { bars, chords, confidence }
  const [sectionType, setSectionType] = useState('Verse');
  const [sectionLabel, setSectionLabel] = useState('');
  const [pickerTarget, setPickerTarget] = useState(null); // { barIdx, beatIdx }
  const workerRef = useRef(null);
  const draftIdRef = useRef(uid());

  const runWorkerAnalysis = useCallback((channelData, sampleRate) => {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./audioChordsWorker.js', import.meta.url), { type: 'module' });
      workerRef.current = worker;
      worker.onmessage = (e) => {
        if (e.data.type === 'done') resolve(e.data.frames);
        else reject(new Error(e.data.message || 'Worker analysis failed'));
        worker.terminate();
        workerRef.current = null;
      };
      worker.onerror = (err) => {
        reject(new Error(err.message || 'Worker error'));
        worker.terminate();
        workerRef.current = null;
      };
      worker.postMessage({ channelData, sampleRate }, [channelData.buffer]);
    });
  }, []);

  const handleFile = useCallback(async (file) => {
    setStep('decoding');
    setErrorMessage('');

    let audioBuffer;
    try {
      audioBuffer = await decodeAudioFile(file);
    } catch {
      setErrorMessage("Couldn't read this audio file.");
      setStep('error');
      return;
    }

    setStep('analyzing');
    const cappedLength = Math.min(audioBuffer.length, MAX_ANALYSIS_SECONDS * audioBuffer.sampleRate);
    setTruncated(cappedLength < audioBuffer.length);
    // .slice() copies into a new, independent buffer so it's safe to transfer
    // to the worker without detaching the AudioBuffer that detectTempo also reads.
    const channelData = audioBuffer.getChannelData(0).slice(0, cappedLength);

    try {
      const [bpm, frames] = await Promise.all([
        detectTempo(audioBuffer),
        runWorkerAnalysis(channelData, audioBuffer.sampleRate),
      ]);

      const frameDuration = frames.length > 1 ? frames[1].time - frames[0].time : 0.1;
      const segments = smoothChordSequence(frames, frameDuration);
      const avgConfidence = segments.length
        ? segments.reduce((sum, s) => sum + s.confidence, 0) / segments.length
        : 0;

      if (avgConfidence < MIN_CONFIDENCE_FOR_RESULT) {
        setErrorMessage("Couldn't detect clear chords in this file.");
        setStep('error');
        return;
      }

      const bpmRounded = Math.round(bpm);
      const built = buildDraftSection(segments, bpmRounded, song.timeSig);
      setDetectedBpm(bpmRounded);
      setUpdateBpm(song.bpm === 120 || Math.abs(song.bpm - bpmRounded) > 5);
      setDraft(built);
      setStep('preview');
    } catch {
      setErrorMessage('Analysis failed. Try a different file.');
      setStep('error');
    }
  }, [song.timeSig, song.bpm, runWorkerAnalysis]);

  const handleCancel = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
    setStep('pick');
  }, []);

  const setDraftChord = useCallback((barIdx, beatIdx, chord) => {
    setDraft((prev) => {
      const chords = { ...prev.chords };
      const key = `${barIdx}-${beatIdx}`;
      if (chord === null) delete chords[key];
      else chords[key] = chord;
      return { ...prev, chords };
    });
    setPickerTarget(null);
  }, []);

  const handleCreate = useCallback(() => {
    onCreateSection(
      { type: sectionType, label: sectionLabel, bars: draft.bars, chords: draft.chords },
      detectedBpm,
      updateBpm,
    );
  }, [onCreateSection, sectionType, sectionLabel, draft, detectedBpm, updateBpm]);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.4)',
      }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border-strong)',
        borderRadius: 16, padding: '1.5rem',
        width: 560, maxHeight: '85vh', overflowY: 'auto',
        boxShadow: '0 16px 48px rgba(0,0,0,0.2)',
        display: 'flex', flexDirection: 'column', gap: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-text)' }}>Import from Audio</span>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--color-text-2)', padding: '0 4px', lineHeight: 1 }}
          >×</button>
        </div>

        {step === 'pick' && (
          <div style={{ textAlign: 'center', padding: '2rem 1rem', border: '2px dashed var(--color-border)', borderRadius: 12 }}>
            <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--color-text-2)' }}>
              Upload a recording of this song to detect chords automatically.
            </p>
            <input
              type="file"
              accept="audio/*"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            />
          </div>
        )}

        {(step === 'decoding' || step === 'analyzing') && (
          <div style={{ textAlign: 'center', padding: '2rem 1rem' }}>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-2)' }}>
              {step === 'decoding' ? 'Decoding audio…' : 'Analyzing chords and tempo…'}
            </p>
            <button
              onClick={handleCancel}
              style={{
                marginTop: 14, padding: '6px 14px', borderRadius: 8,
                border: '1px solid var(--color-border-strong)',
                background: 'transparent', color: 'var(--color-text-2)',
                fontSize: 12, cursor: 'pointer',
              }}
            >Cancel</button>
          </div>
        )}

        {step === 'error' && (
          <div style={{ textAlign: 'center', padding: '2rem 1rem' }}>
            <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--color-danger-text)' }}>{errorMessage}</p>
            <button
              onClick={() => setStep('pick')}
              style={{
                padding: '7px 14px', borderRadius: 8,
                border: '1px solid var(--color-border-strong)',
                background: 'var(--color-surface)', color: 'var(--color-text)',
                fontSize: 13, cursor: 'pointer',
              }}
            >Try another file</button>
          </div>
        )}

        {step === 'preview' && draft && (
          <div style={{ color: 'var(--color-text-3)', fontSize: 12 }}>
            Preview UI is added in Task 10.
          </div>
        )}
      </div>
    </div>
  );
}
```

Note: the `preview` step intentionally renders a placeholder here — Task 10 replaces it with the real grid, controls, and commit button. This keeps the task focused on the analysis pipeline and error/cancel handling, which can be exercised independently.

- [ ] **Step 2: Verify the app builds**

```bash
npm run build
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/AudioImportModal.jsx
git commit -m "feat: add AudioImportModal upload/analysis pipeline with error handling"
```

---

## Task 10 — Preview grid, section controls, `ChordPicker` integration, commit

**Files:**
- Modify: `src/AudioImportModal.jsx`

- [ ] **Step 1: Replace the `preview` placeholder and add the `PreviewGrid` sub-component**

In `src/AudioImportModal.jsx`, update the imports at the top to add `chordStr` and `beatsPerBar` from `printUtils.js` and `ChordPicker` from its new file:

```js
import { useState, useRef, useCallback } from 'react';
import {
  decodeAudioFile, detectTempo, smoothChordSequence, buildDraftSection,
} from './audioChords.js';
import { chordStr, beatsPerBar } from './printUtils.js';
import { SECTION_TYPES } from './chords.js';
import { uid } from './models.js';
import { ChordPicker } from './ChordPicker.jsx';
```

Replace the placeholder block:
```jsx
        {step === 'preview' && draft && (
          <div style={{ color: 'var(--color-text-3)', fontSize: 12 }}>
            Preview UI is added in Task 10.
          </div>
        )}
```
with:
```jsx
        {step === 'preview' && draft && (
          <>
            {truncated && (
              <p style={{ margin: 0, fontSize: 11, color: 'var(--color-text-3)' }}>
                Only the first 5 minutes of this file were analyzed.
              </p>
            )}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-start' }}>
              <label style={{ fontSize: 11, color: 'var(--color-text-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Type
                <select
                  value={sectionType}
                  onChange={(e) => setSectionType(e.target.value)}
                  style={{
                    display: 'block', marginTop: 4, padding: '5px 8px', borderRadius: 6,
                    border: '1px solid var(--color-border-strong)',
                    background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: 12,
                  }}
                >
                  {SECTION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
              <label style={{ fontSize: 11, color: 'var(--color-text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', flex: 1 }}>
                Label
                <input
                  value={sectionLabel}
                  onChange={(e) => setSectionLabel(e.target.value)}
                  placeholder="optional"
                  style={{
                    display: 'block', marginTop: 4, width: '100%', padding: '5px 8px', borderRadius: 6,
                    border: '1px solid var(--color-border-strong)',
                    background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: 12,
                    boxSizing: 'border-box',
                  }}
                />
              </label>
            </div>

            <PreviewGrid
              draft={draft}
              timeSig={song.timeSig}
              onBeatClick={(barIdx, beatIdx) => setPickerTarget({ barIdx, beatIdx })}
            />

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--color-text-2)' }}>
              <input type="checkbox" checked={updateBpm} onChange={(e) => setUpdateBpm(e.target.checked)} />
              Update song BPM to {detectedBpm} (currently {song.bpm})
            </label>

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => setStep('pick')}
                style={{
                  flex: 1, padding: '9px', borderRadius: 8,
                  border: '1px solid var(--color-border-strong)',
                  background: 'transparent', color: 'var(--color-text-2)',
                  fontSize: 13, cursor: 'pointer',
                }}
              >Start over</button>
              <button
                onClick={handleCreate}
                style={{
                  flex: 2, padding: '9px', borderRadius: 8, border: 'none',
                  background: 'var(--color-accent)', color: 'var(--color-bg)',
                  fontSize: 13, fontWeight: 600, cursor: 'pointer',
                }}
              >Create section</button>
            </div>
          </>
        )}
```

Then, immediately after the closing `</div>` of the outer overlay `div` (i.e. right before the final `</div>` that closes the component's return), add the picker overlay:
```jsx
      {pickerTarget && (
        <ChordPicker
          sectionId={draftIdRef.current}
          barIdx={pickerTarget.barIdx}
          beatIdx={pickerTarget.beatIdx}
          sections={[{ id: draftIdRef.current, chords: draft.chords }]}
          onSet={(chord) => setDraftChord(pickerTarget.barIdx, pickerTarget.beatIdx, chord)}
          onClose={() => setPickerTarget(null)}
        />
      )}
```

So the full return statement's outer structure becomes:
```jsx
  return (
    <div /* overlay */ onMouseDown={...}>
      <div /* card */>
        {/* ...header + step content as above... */}
      </div>

      {pickerTarget && (
        <ChordPicker ... />
      )}
    </div>
  );
```

- [ ] **Step 2: Add the `PreviewGrid` sub-component**

At the bottom of `src/AudioImportModal.jsx`, after the `AudioImportModal` function's closing brace, add:
```jsx
function PreviewGrid({ draft, timeSig, onBeatClick }) {
  const nb = beatsPerBar(timeSig);
  const COLS = 4;
  const rows = [];
  for (let i = 0; i < draft.bars; i += COLS) {
    rows.push(Array.from({ length: Math.min(COLS, draft.bars - i) }, (_, j) => i + j));
  }

  return (
    <div>
      {rows.map((rowBars, ri) => (
        <div
          key={ri}
          style={{
            display: 'grid', gridTemplateColumns: `repeat(${rowBars.length}, 1fr)`,
            gap: 8, marginBottom: ri < rows.length - 1 ? 8 : 0,
          }}
        >
          {rowBars.map((barIdx) => (
            <div
              key={barIdx}
              style={{
                border: '1px solid var(--color-border-strong)', borderRadius: 6,
                overflow: 'hidden', background: 'var(--color-surface)',
              }}
            >
              <div style={{
                fontSize: 9, color: 'var(--color-text-3)', padding: '2px 5px',
                borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface-2)',
              }}>
                {barIdx + 1}
              </div>
              <div style={{ display: 'flex' }}>
                {Array.from({ length: nb }).map((_, beatIdx) => {
                  const key = `${barIdx}-${beatIdx}`;
                  const chord = draft.chords[key] || null;
                  const confidence = draft.confidence[key];
                  const label = chordStr(chord);
                  return (
                    <div
                      key={beatIdx}
                      onClick={() => onBeatClick(barIdx, beatIdx)}
                      style={{
                        flex: 1, minHeight: 44,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: 'pointer',
                        borderLeft: beatIdx === 0 ? 'none' : '1px dashed var(--color-border)',
                        opacity: confidence !== undefined ? 0.4 + confidence * 0.6 : 1,
                      }}
                    >
                      {label ? (
                        <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-serif)', color: 'var(--color-text)' }}>
                          {label}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--color-border-strong)', fontSize: 16, opacity: 0.6 }}>·</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Verify the app builds**

```bash
npm run build
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/AudioImportModal.jsx
git commit -m "feat: add preview grid, section controls, and ChordPicker override to AudioImportModal"
```

---

## Task 11 — Wire into `App.jsx` / `EditorScreen`

**Files:**
- Modify: `src/App.jsx`

- [ ] **Step 1: Add the import**

Add to the top of `src/App.jsx`, alongside the `ChordPicker` import added in Task 2:
```js
import { AudioImportModal } from './AudioImportModal.jsx';
```

- [ ] **Step 2: Add an `onOpenAudioImport` prop to `EditorScreen` and a toolbar button**

`EditorScreen`'s signature currently reads (around line 805):
```js
function EditorScreen({ song, sections, addSection, removeSection, duplicateSection, updateSection, openPicker, onTranspose, onBackToSetup, onBackToLibrary, onSaveToCloud, cloudStatus }) {
```
Change it to:
```js
function EditorScreen({ song, sections, addSection, removeSection, duplicateSection, updateSection, openPicker, onTranspose, onBackToSetup, onBackToLibrary, onSaveToCloud, cloudStatus, onOpenAudioImport }) {
```

In the toolbar `div` (the one containing `<AddSectionMenu ... />` and the "⬇ Print / PDF" button, around line 878), add a new button right after `<AddSectionMenu onAdd={addSection} />`:
```jsx
          <AddSectionMenu onAdd={addSection} />
          <button
            onClick={onOpenAudioImport}
            style={{
              padding: "7px 14px", borderRadius: 8,
              border: "1px solid var(--color-border-strong)",
              background: "var(--color-surface)", color: "var(--color-text)",
              fontSize: 13, fontWeight: 500, cursor: "pointer",
              display: "inline-flex", alignItems: "center", minHeight: 34,
            }}
          >🎧 Import from Audio</button>
```

- [ ] **Step 3: Add `audioImportOpen` state and `addSectionFromAudio` callback in the `App` component**

Near the existing section-operation callbacks (`addSection`, `removeSection`, `duplicateSection`, `updateSection` — around line 1115), add:
```js
  const [audioImportOpen, setAudioImportOpen] = useState(false);

  const addSectionFromAudio = useCallback((sectionDraft, detectedBpm, shouldUpdateBpm) => {
    patchCurrent((s) => {
      const newSection = {
        id: uid(),
        type: sectionDraft.type,
        label: sectionDraft.label,
        bars: sectionDraft.bars,
        chords: sectionDraft.chords,
      };
      const next = { ...s, sections: sortSections([...s.sections, newSection]) };
      if (shouldUpdateBpm && detectedBpm) next.bpm = detectedBpm;
      return next;
    });
    setAudioImportOpen(false);
  }, [patchCurrent]);
```

- [ ] **Step 4: Pass the new prop into `EditorScreen` and render the modal**

`EditorScreen`'s render call (around line 1290) currently reads:
```jsx
      {view === "editor" && currentSong && (
        <EditorScreen
          song={currentSong}
          sections={currentSong.sections}
          addSection={addSection}
          removeSection={removeSection}
          duplicateSection={duplicateSection}
          updateSection={updateSection}
          openPicker={openPicker}
          onTranspose={transpose}
          onBackToSetup={() => setView("setup")}
          onBackToLibrary={backToLibrary}
          onSaveToCloud={CLOUD_ON ? saveCurrentToCloud : null}
          cloudStatus={cloudStatus}
        />
      )}
```
Add `onOpenAudioImport={() => setAudioImportOpen(true)}`:
```jsx
      {view === "editor" && currentSong && (
        <EditorScreen
          song={currentSong}
          sections={currentSong.sections}
          addSection={addSection}
          removeSection={removeSection}
          duplicateSection={duplicateSection}
          updateSection={updateSection}
          openPicker={openPicker}
          onTranspose={transpose}
          onBackToSetup={() => setView("setup")}
          onBackToLibrary={backToLibrary}
          onSaveToCloud={CLOUD_ON ? saveCurrentToCloud : null}
          cloudStatus={cloudStatus}
          onOpenAudioImport={() => setAudioImportOpen(true)}
        />
      )}
```

Right after the existing `{picker && currentSong && (<ChordPicker ... />)}` block, add:
```jsx
      {audioImportOpen && currentSong && (
        <AudioImportModal
          song={currentSong}
          onCreateSection={addSectionFromAudio}
          onClose={() => setAudioImportOpen(false)}
        />
      )}
```

- [ ] **Step 5: Verify the app builds**

```bash
npm run build
```

Expected: no errors.

- [ ] **Step 6: Verify manually**

```bash
npm run dev
```

Open http://localhost:5173, open a song, confirm the "🎧 Import from Audio" button appears in the toolbar and clicking it opens the modal with a file picker. (Full analysis flow is verified end-to-end in Task 12.)

- [ ] **Step 7: Commit**

```bash
git add src/App.jsx
git commit -m "feat: wire AudioImportModal into the editor toolbar"
```

---

## Task 12 — End-to-end verification

- [ ] **Step 1: Run the full test suite**

```bash
npm test
```

Expected: all tests pass, including the new `audioChords.test.js` suite.

- [ ] **Step 2: Run a production build**

```bash
npm run build
```

Expected: no errors, `dist/` generated (confirms the Web Worker bundles correctly for production, not just dev).

- [ ] **Step 3: Manual flow — happy path**

```bash
npm run dev
```

Open http://localhost:5173, open or create a song. Find a short (~30-60s) audio clip with a clear, simple chord progression (a single clean guitar or piano recording works best — this detector is not tuned for full-band mixes). Click **🎧 Import from Audio**, upload the file, and confirm:
- The modal shows "Decoding audio…" then "Analyzing chords and tempo…"
- It lands on the preview screen with a bar/beat grid showing detected chords
- Cells with lower confidence look visibly more faded than high-confidence cells
- Clicking a cell opens the chord picker and lets you override it; the override is reflected in the grid immediately
- The BPM checkbox shows the detected tempo and the song's current BPM
- Clicking **Create section** closes the modal and adds a new section to the song, in the correct sorted position, with the chords from the preview
- If the checkbox was checked, the song's BPM badge in the header now shows the detected tempo

- [ ] **Step 4: Manual flow — error and cancel paths**

- Upload a non-audio file (e.g. a `.txt` renamed to look selectable, or any file the browser's file picker allows through): confirm "Couldn't read this audio file." appears with a "Try another file" button.
- Start uploading a longer audio file and click **Cancel** while it says "Analyzing chords and tempo…": confirm the modal returns to the file-picker state and no section is created.
- Upload a file of near-silence or pure noise if you have one: confirm "Couldn't detect clear chords in this file." appears instead of a junk preview. (Skip this check if no such file is available — it's covered by the `MIN_CONFIDENCE_FOR_RESULT` threshold in Task 9's implementation either way.)

- [ ] **Step 5: Final commit if any cleanup was needed**

```bash
git add -p
git commit -m "chore: post-verification cleanup for audio chord detection"
```

---

## Self-Review Checklist

- ✅ **Spec coverage:** chord vocabulary (Task 3), architecture/data flow (Tasks 3-11), components/UI incl. confidence tinting, `ChordPicker` reuse, BPM checkbox, type/label (Tasks 9-10), error handling + 5-minute cap + Web Worker + cancel (Tasks 8-9), testing — pure functions unit-tested (Tasks 3-5), wrappers manually verified (Tasks 6-7, 12).
- ✅ **No TBD/TODO:** every step has complete code; the one intentional placeholder (Task 9's preview-step stub) is explicitly resolved by name in Task 10, not left open.
- ✅ **Type consistency:** `draft` shape `{bars, chords, confidence}` is identical across `buildDraftSection` (Task 5), `AudioImportModal` state (Task 9), and `PreviewGrid` (Task 10). `onCreateSection(sectionDraft, detectedBpm, shouldUpdateBpm)` signature matches between `AudioImportModal.handleCreate` (Task 10) and `App.jsx`'s `addSectionFromAudio` (Task 11). Chord quality strings (`'', 'm', '7', 'maj7', 'm7', 'dim', 'aug', 'sus2', 'sus4'`) match `QUALITIES` values in `chords.js` exactly.
- ✅ **Import chain:** `ROOTS` and `beatsPerBar` are reused from existing modules (`chords.js`, `printUtils.js`) rather than duplicated. `ChordPicker` extraction (Task 2) precedes its use in `AudioImportModal` (Task 10) and `App.jsx` (Task 11), avoiding the circular import that would result from importing it directly from `App.jsx`.
- ✅ **No new files beyond the file map:** `src/ChordPicker.jsx`, `src/audioChords.js`, `src/audioChords.test.js`, `src/audioChordsWorker.js`, `src/AudioImportModal.jsx` — all listed in the File Map, with the `ChordPicker.jsx` addition explicitly justified there.
