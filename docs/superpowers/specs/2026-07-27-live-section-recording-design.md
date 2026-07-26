# Live Section Recording with Metronome — Design

**Date:** 2026-07-27
**Project:** ChordSheet
**Status:** Approved

---

## Context

Audio-file chord detection shipped as a way to import a recording after the fact. During diagnostic testing of that pipeline (the "Live Chord Test" panel, an ad-hoc debugging tool built to verify the underlying chroma-detection logic against a live microphone), it became clear the same detection machinery could power something more useful in the actual editing workflow: **playing along to a metronome and having the chords land directly in the song's bar/beat grid as you play**, instead of recording a file first and importing it separately.

This was explicitly called out as deferred/future work in the original audio-chord-detection design spec ("Continuous live-record chord capture across a whole section while playing"). This spec covers that feature.

**Scope:** this feature targets an **existing section** the user has already created (its bar count defines the recording's length) — it is not a free-form capture-then-review flow like `AudioImportModal`. A metronome is a prerequisite for this to be usable at all (without a tempo reference, live chord changes won't land on bar boundaries), so it's built as part of this same feature rather than a separate one.

---

## Architecture

### Metronome (`src/metronome.js`)

A reliable metronome cannot be built on `setInterval` — normal JS timer jitter (a few tens of milliseconds under any main-thread load) is easily audible as drift over a multi-bar section, which defeats the entire purpose of a tempo reference. Instead this uses the standard Web Audio **lookahead scheduler** pattern:

- A short-interval JS timer (~25ms) runs continuously, but its only job is to ask "are there any beats coming up in the next ~100ms that haven't been scheduled yet?"
- Any such beat gets an audio click scheduled against `AudioContext.currentTime` — sample-accurate, immune to JS timer jitter, because the actual sound timing is handled by the audio hardware clock, not the JS event loop.
- Each click is a short synthesized blip (`OscillatorNode` → fast-decay `GainNode` envelope, a few milliseconds), not a sample file — no new asset, minimizes how much the click's own sound can bleed into and pollute a chord analysis window.

```js
export function createMetronome({ audioCtx, bpm, timeSig, onBeat, onBar }) {
  // returns { start(), stop() }
  // onBeat(beatIndexInBar, barIndex) — fired for UI pulse, at every beat
  // onBar(barIndex) — fired right as a new bar begins; this is the
  //   capture app's signal to lock in the previous bar's chord
}
```

### Dynamic analysis window

The wide 16384-sample analysis window added earlier (to resolve low-register semitones like guitar's open E2/F2) takes ~370ms per reading at typical sample rates. At fast tempos, a single bar can be shorter than that. Rather than a fixed window size, live recording computes the largest usable window for the current tempo:

```
barDurationMs = (60000 / bpm) * beatsPerBar(timeSig)
targetWindow  = largest power-of-2 sample count that fits within
                60% of barDurationMs, capped at 16384, floored at 2048
```

- At slow/moderate tempos: full 16384-sample precision (same low-note resolution as the diagnostic tool).
- At fast tempos: the window shrinks gracefully.
- If even the 2048-sample floor doesn't fit within 60% of the bar duration, recording refuses to start with a clear message — this tempo is too fast for reliable capture rather than silently producing bad data.

### Per-bar capture

Reuses the peak-hold matching already validated in Live Chord Test: continuously extract chroma and match candidates throughout a bar, only ever adopting a reading that's *more* confident than the best one seen so far in that bar (never regresses to a worse match mid-bar). When `onBar` fires for the *next* bar, the previous bar's peak result is final:

- If a confident peak was found (real signal was present, i.e. RMS crossed the silence gate at least once during the bar): write that chord to the bar's cell.
- If the bar was silent throughout (a rest, or the user just didn't play): write nothing, leave the cell as it was.

---

## UI / UX

**No modal.** Unlike `AudioImportModal` and Live Chord Test, this doesn't cover the screen — the entire point is watching the actual bar grid fill in as you play, so covering it with an overlay would defeat the feature.

- A **"🎙 Record live"** button is added to `SectionBlock`'s header, alongside the existing Duplicate/Remove buttons.
- Clicking it transforms that same header area in place into a compact recording control: count-in countdown → "Bar 3 of 8" progress readout → a Stop button. The bar grid underneath is untouched visually and re-renders normally as real chords land in it (no new cell styling needed — it's the same `Section.chords` data flowing through the same rendering path already used everywhere else).
- **Flow:** click Record → request mic → **1 bar of click-only count-in** (metronome runs, no capture yet — gives the user a moment to get their hands in position and lock onto the tempo) → recording begins, click continues on every beat → each bar boundary locks in and writes that bar's chord → **auto-stops** when the section's bar count is reached, or **Stop** at any time.
- **Recording overwrites cells as it passes through** each bar — this is a retake model (like re-recording over a section), not a merge with whatever was there before.
- **Correcting a wrong bar** uses the app's existing click-a-cell → `ChordPicker` flow, completely unchanged. No separate review/preview/confirm step is needed for this feature, because it writes directly into real section data rather than a draft that needs committing.

---

## Data flow

Currently, setting a chord flows: `App`'s `picker` state → `ChordPicker`'s `onSet` callback → `handleSetChord` in `App.jsx`, which looks up `picker.sectionId/barIdx/beatIdx` and patches `song.sections`.

Live recording needs to write chords directly, without opening that picker UI. The chord-writing logic inside `handleSetChord` will be extracted into a plain callback:

```js
setBeatChord(sectionId, barIdx, beatIdx, chord) // same patchCurrent logic handleSetChord already has
```

`handleSetChord` becomes a thin wrapper that calls `setBeatChord(picker.sectionId, picker.barIdx, picker.beatIdx, chord)` — no behavior change for the existing manual-editing path. This same `setBeatChord` callback threads down through `EditorScreen` → `SectionBlock`, where the new recording logic calls it directly once per locked-in bar.

---

## Error handling & known limitations

- **Mic permission denied:** inline error shown in the section header; metronome never starts.
- **Tempo too fast for a usable window:** checked via the dynamic window-size calculation *before* recording starts; if the tempo can't support even the 2048-sample floor, show why and refuse to start.
- **Silence during a bar:** no chord written for that bar (see Per-bar capture above) — never overwrites with a low-confidence guess.
- **Leaving mid-recording** (closing the song, switching sections, unmounting): cleanup stops the metronome, closes the `AudioContext`, and releases the mic tracks — same cleanup pattern already used in Live Chord Test.
- **Known, not fully fixed limitation — metronome/mic bleed:** the click plays through the device's speakers, so without headphones the mic will pick some of it up. Mitigations: the click is a short synthesized blip specifically to minimize overlap with the analysis window, and peak-hold matching already tolerates brief broadband noise reasonably well (a click doesn't look like a specific chord to the matcher). The recording panel's copy will recommend headphones. This is a physical constraint of playing audio and listening on the same device, not something software can fully eliminate.

---

## Testing

- The dynamic window-size calculation (`computeWindowSize(bpm, timeSig, sampleRate)` or similar) is a pure function — unit-tested with Vitest the same way the rest of `audioChords.js` is, covering: normal tempos get the full 16384 window, fast tempos shrink it, extremely fast tempos hit the floor and signal "too fast."
- The metronome's actual audio scheduling and the recording session's orchestration (mic capture, bar-boundary chord-locking, count-in, auto-stop) are Web-Audio/mic-dependent and not meaningfully unit-testable — verified manually in-browser, the same treatment already given to `decodeAudioFile`, `detectTempo`, `extractChromaFrames`, and `AudioImportModal`'s orchestration logic.

---

## Files Changed / Added

| File | Change |
|------|--------|
| `src/metronome.js` | **Create** — lookahead-scheduled click track (`createMetronome`) |
| `src/metronome.test.js` | **Create** — unit tests for the dynamic window-size calculation |
| `src/audioChords.js` | **Modify** — add the dynamic window-size helper (or a sibling pure function alongside the existing chroma/matching functions) |
| `src/App.jsx` | **Modify** — extract `setBeatChord`, thread it through `EditorScreen` → `SectionBlock`; `handleSetChord` becomes a thin wrapper |
| `SectionBlock` (in `src/App.jsx`) | **Modify** — add "🎙 Record live" button and inline recording-control UI in the section header; recording session logic (mic capture, metronome wiring, peak-hold per-bar matching, count-in, auto-stop) |

No new modal component. Reuses `matchChordTemplatesRanked` and the mic-capture constraints (disabled echo cancellation/noise suppression/AGC) already built and validated for Live Chord Test — no duplication of that logic, just a new consumer of it.

---

## Out of Scope

- Fixing the metronome/mic-bleed limitation beyond the mitigations listed above (e.g. algorithmically subtracting the known click waveform from the captured signal) — a real technique, but significant added complexity for a secondary concern.
- Per-beat (rather than per-bar) chord-change granularity — ruled out in this design specifically because of the window-size-vs-beat-duration conflict; revisit only if a fundamentally different detection approach (not FFT-window-based) is adopted later.
