# Audio Chord Detection — Design

**Date:** 2026-07-26
**Project:** ChordSheet
**Status:** Approved

---

## Context

ChordSheet currently has typed-text chord *parsing* (`parseChord` in `src/chords.js` turns text like `"cm7"` into `{root, qual, bass}`), used by the `ChordPicker`. There is no way to derive chords from an actual audio recording.

This feature adds **offline audio-file chord detection**: the user uploads an audio file (e.g. a rough recording of the song), the app analyzes it entirely client-side, and produces a reviewable, editable draft section with chords laid out on the bar/beat grid.

Two related features are explicitly **out of scope** for this design and will be brainstormed separately later:
- Filling a single beat cell from a short live mic recording
- Continuous live-record chord capture across a whole section while playing

---

## Chord Vocabulary

Detection targets only chord qualities that are reliably distinguishable via chroma/pitch-class analysis:

**major, minor, 7, maj7, m7, dim, aug, sus2, sus4** — 9 qualities × 12 roots = 108 templates.

This is a subset of the app's full 17-quality vocabulary (excludes 6, m6, 9, maj9, m9, dim7, add9, 13, 5). Anything the analysis can't confidently place lands as the closest basic-triad match with a correspondingly low confidence score, surfaced to the user in the preview rather than hidden.

---

## Architecture & Data Flow

All analysis runs client-side. New pure module `src/audioChords.js` (no React/DOM dependencies beyond the Web Audio API):

```
File → decodeAudioFile(file) → AudioBuffer
AudioBuffer → extractChromaFrames(buffer)   [Meyda, sliding window]      ─┐
AudioBuffer → detectTempo(buffer)           [web-audio-beat-detector]    ─┤ run in parallel
                                                                          ─┘
chromaFrames → matchChordTemplates(frame) → per-frame {root, qual, confidence}
frame sequence → smoothChordSequence(...) → chord segments
                   { root, qual, confidence, startTime, endTime }
                   (majority-vote smoothing + minimum-duration threshold
                    to remove frame-to-frame flicker)
segments + bpm + song.timeSig → buildDraftSection(...) → bar/beat-keyed
                   chords (same shape as an existing Section's `chords`
                   map), with confidence retained per cell for the preview
```

**Libraries:**
- [Meyda](https://github.com/meyda/meyda) — chroma (pitch-class) feature extraction
- [web-audio-beat-detector](https://github.com/chrisguttandin/web-audio-beat-detector) — tempo/BPM estimation

**Custom logic (the only DSP code we write):** `matchChordTemplates` — cosine similarity between a chroma frame and each of the 108 basic-vocabulary templates, picking the best match and its confidence.

---

## Components & UI

- New `src/AudioImportModal.jsx` — kept as its own file, consistent with the ongoing `models.js`/`chords.js` extraction out of `App.jsx`.
- **Entry point:** an "Import from Audio" button in `EditorScreen`'s toolbar, next to "Add Section."
- **Flow:**
  1. File picker (`accept="audio/*"`)
  2. Progress states: "Decoding audio…" → "Analyzing chords…" / "Detecting tempo…" (run together)
  3. Preview screen
- **Preview screen:**
  - Detected chords rendered in the same bar/beat grid style as the editor; each cell tinted by confidence (full opacity = high confidence, faded = low)
  - Clicking a cell opens the existing `ChordPicker` to override it — no new chord-editing UI
  - Header shows detected BPM vs. the song's current BPM, with a checkbox "Update song BPM to `{detected}`" — pre-checked when the current BPM is the default 120 or differs meaningfully from the detected value
- **Commit:** "Create Section" builds a new section (via a `makeSection`-style factory) prefilled with the reviewed chords, appends it to `song.sections` (existing `sortSections` handles ordering), updates `song.bpm` if the checkbox is checked, then goes through the app's normal save path (`saveData` / cloud save) — no new persistence logic required.

---

## Error Handling & Performance

- **Bad/corrupt file:** `decodeAudioData` rejects → inline error ("Couldn't read this audio file"), user can pick a different file; no partial state left behind.
- **No usable signal:** if every frame's best-match confidence stays below a floor threshold for the entire clip, show "Couldn't detect clear chords in this file" instead of a junk preview. User can cancel or proceed to an empty section to fill in manually.
- **Long files:** analysis is capped to the first 5 minutes to keep in-browser processing bounded; if the file is longer, the preview notes that only the first 5 minutes were analyzed.
- **Main-thread blocking:** chroma extraction + template matching over a multi-minute file is real CPU work, so it runs inside a **Web Worker** to keep the UI (progress indicator, cancel button) responsive. `decodeAudioData` stays on the main thread (requires the DOM's `AudioContext`); the decoded buffer's raw channel data is transferred to the worker for the CPU-heavy part.
- **Cancel:** user can cancel mid-analysis, which terminates the worker and returns the modal to the file-picker state.

---

## Testing

- `matchChordTemplates`, `smoothChordSequence`, and `buildDraftSection` are pure functions, unit-tested with Vitest using synthetic chroma vectors and synthetic segment arrays — same pattern as `printUtils.test.js`. Example cases:
  - A chroma vector peaked at C+E+G matches C major with high confidence
  - Two adjacent frames of the same chord with a single 1-frame blip smooth into one segment
  - A segment sequence at a known BPM/time signature lays out onto the expected bar/beat keys
- `decodeAudioFile`, `extractChromaFrames`, and `detectTempo` are thin wrappers around the libraries/Web Audio API — not meaningfully unit-testable; verified manually with real sample clips (a clean single-instrument recording, then a fuller mix) to sanity-check end-to-end output quality.
- Manual verification pass: import a real recording, confirm the preview grid renders, confirm low-confidence cells are visually distinct, confirm edited cells persist, confirm "Create Section" produces a correctly-ordered section and (when checked) updates the song's BPM.

---

## Files Changed / Added

| File | Change |
|------|--------|
| `src/audioChords.js` | **Create** — `decodeAudioFile`, `extractChromaFrames`, `detectTempo`, `matchChordTemplates`, `smoothChordSequence`, `buildDraftSection`, chord templates |
| `src/audioChords.test.js` | **Create** — unit tests for the pure functions above |
| `src/audioChordsWorker.js` | **Create** — Web Worker entry point running chroma extraction + template matching off the main thread |
| `src/AudioImportModal.jsx` | **Create** — upload, progress, preview/edit, commit UI |
| `src/App.jsx` | **Modify** — add "Import from Audio" toolbar button in `EditorScreen`, wire modal open/close and section-commit into existing state |
| `package.json` | **Modify** — add `meyda` and `web-audio-beat-detector` dependencies |

---

## Out of Scope (future work, separate brainstorm)

- Single-beat-cell detection from a short live mic recording
- Continuous live-record chord capture across a whole section while playing
