# Instrument Visualizer (Learn-a-Line) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Help the user **learn a single-note line** (an intro, riff, solo or bass line) from an audio file so they can play it on bass or guitar. The user uploads audio and picks the instrument. The app works out **which notes are played** (exact pitch, octave and timing) and **where to play them**: frets on guitar or bass, keys on keyboard. Playback shows the current note and the next one on the instrument, plus a scrolling tab of the whole line. It has practice controls: slow-down and A–B loop. The only inputs are the audio file and the instrument.

**Architecture:**
1. **Transcribe** every note with Spotify's [basic-pitch](https://github.com/spotify/basic-pitch-ts), a small neural model that runs in the browser on TensorFlow.js inside a Web Worker.
2. **Extract one line** of one note at a time. How depends on the **Source** the user picks:
   - **"Only my instrument" (default, recommended).** The file contains just the bass, guitar, piano or keyboard line: the user's own recording, a stem, or a solo clip. Stricter rules apply: harmonic "ghost" notes are removed, the newest note always wins (earlier notes are only ringing), and a warning appears if the file sounds like chords or several instruments.
   - **"Full song".** A mix with other instruments. The app guesses the part by following the *lowest* note (bass) or *highest* note (guitar, keys), and the user can switch which.

   Both sources use the same transcription, so the user can switch Source in the learn view **instantly**.
3. **Finger the whole line** with a Viterbi/dynamic-programming search over all string and fret options. It plays like a player would: staying in one hand position and shifting only when it pays off.

Steps 2–3 are pure, Vitest-tested functions that are cheap to re-run, so the Sensitivity and Follow controls never re-run the model. The UI is a modal with SVG fretboard, keyboard and tab components synced to `<audio>`. The existing chroma chord detector (`AudioImportModal`) is untouched.

**Tech Stack:** React 18, Vite 5, Vitest, `@spotify/basic-pitch@1.0.1` (brings `@tensorflow/tfjs@3.x`), Web Audio API (`OfflineAudioContext` resampling), Web Workers, inline SVG.

**History:** This is revision 3. Revision 1 showed suggested chord shapes from chroma; the user rejected that because the visual must reflect what's actually played. Revision 2 was chord-first transcription. Revision 3 re-centers on the user's stated purpose, learning single-note lines, and moves chord mode to *Future work* (its prototyped algorithm is preserved there).

---

## Verified during planning (2026-10-13, scratch prototypes in Node)

**Transcription (basic-pitch 1.0.1).** It runs with the app's toolchain: named ESM imports work in Node/Vitest, and the model is 0.9 MB. On a seeded synthetic open-C strum it is deterministic and found C3, E3 and G3 at amplitude 0.65–0.86, plus C4 and E4 more weakly. It also emitted faint spurious and harmonic notes (amplitude 0.2–0.4) and split long notes, which is why the cleaning step exists. It missed the top two notes of a synthetic barre chord. Synthetic plucks are harsher than real instruments, so tune on real recordings (Task 9). CPU speed in Node was about 0.65 s per second of audio. WebGL in the browser should be much faster; measure it in Task 1.

**Line extraction:**

| Input | Follow | Output |
|---|---|---|
| Bass A1→G1 under chords, with a melody A4 B4 C5 on top | lowest | `A1 0–1s, G1 1–2s` (the bass line, clean) |
| Same | highest | `E4 0–0.2, A4, B4, C5, D4 1.6–2` (the melody, plus the chord's top note where the melody rests) |
| A2 struck twice | n/a | two notes (a re-struck note stays separate) |
| A2 held, with a 30 ms glitch above it | highest | one A2 0–1 s (glitch dropped, note rejoined) |
| 3,000 notes over 300 s | highest | 8 ms |

**"Only my instrument" source (isolated file):**

| Input | Isolated pipeline | Full-song heuristic on the same input |
|---|---|---|
| A3 then C4, each with a faint octave or 12th "ghost" above | `A3 0–0.5, C4 0.5–1` ✅ | highest: `A4, A3, G5, C4` ❌ (follows the ghosts) |
| Low A2 left ringing under E3 then A3 | `A2 0–0.5, E3 0.5–1, A3 1–1.5` ✅ | lowest: `A2 0–2` ❌ (the melody is lost) |
| Real octave jump A2 → A3 played 0.5 s apart | both kept ✅ (ghost removal only applies to near-simultaneous onsets) | n/a |
| Three strummed triads | chord-share 1.0 → warning shown | n/a |

**Whole-line fingering (standard tuning; `string:fret`, string 0 = low E):**

| Line | Result |
|---|---|
| Lick E5 D5 C5 A4 C5 D5 E5 | `5:12 5:10 5:8 4:10 5:8 5:10 5:12` (stays at the 12th position) |
| Riff E2 E2 G2 A2 E2 G2 Bb2 A2 | `0:0 0:0 0:3 1:0 0:0 0:3 1:1 1:0` |
| Bass (4-string) E1 E1 G1 A1 B1 A1 G1 E1 | `0:0 0:0 0:3 1:0 1:2 1:0 0:3 0:0` |
| 518-note line | about 1 ms |

**Honest limits (put these in the UI copy and the PR):** a pitch can exist on several strings. The fingering is the most playable way to get *those exact pitches*, but it can't know which string the recorded player actually used, because the audio sounds identical. In **Full song** mode, the "highest" line can catch **vocals** or keys, since they share the guitar's range. "Lowest" for bass works well in mixes. That is why **"Only my instrument" is the default and recommended source.**

---

## Implementation notes (recorded while executing, 2026-10-13)

**Worker spike (Task 1, Step 6): WebGL path taken, with two additions to the plan.**
- tfjs 3.21's `PlatformBrowser.setTimeoutCustom` calls `window.setTimeout`, and `window` doesn't exist in a worker. WebGL tensor readback (fence polling) therefore threw an unhandled rejection and **the model never finished** (progress stuck at 0%). `transcribeWorker.js` now sets `self.window = self` after the imports.
- Safety net: the worker probes WebGL with a tiny matmul and falls back to the CPU backend if it doesn't return within 3 s. The worker therefore imports `@tensorflow/tfjs` directly (same deduped 3.21.0 copy basic-pitch uses), so it is a normal **dependency**, not a devDependency as D1 said. The main bundle still has no tfjs.
- No `vite.config.js` change was needed for worker format.

**Measured (embedded Chromium pane, WebGL backend):** 10 s clip ≈ 1.5 s; 5-minute clip ≈ 27 s with progress updating; Cancel mid-run returns to setup. CPU backend (forced before the shim) was several times slower.

**Task 9 results.** Only synthetic audio was available (no real recordings), so thresholds were deliberately **not** tuned. Verified: Source / Follow / Sensitivity re-run instantly with no re-transcription; Follow shows only for Full song; the chord warning stays hidden for a single-note line; silent file → "Couldn't hear any notes…"; speed 50/75/100% keeps pitch; A–B loop wraps; clicking a tab column seeks; 375 px width has no page overflow (fretboard and tab scroll in their own containers); light and dark themes render. **Still to do with real recordings:** every accuracy item in the Task 9 checklist (octaves on real bass, ghost removal, vocals in a full mix, known-riff comparison) and the "Import from Audio" regression in the editor.
- Observation: a synthetic additive "bass" produced spurious B3 notes (the 6th harmonic of E1, +31 semitones) that `suppressHarmonics` doesn't cover; "Full song → Bottom line" gave a cleaner result than "Only my instrument" on that clip. Revisit `HARMONIC_INTERVALS` only if real recordings show the same.

---

## Design decisions

### D1. Transcription in a worker, model in `public/`
- Copy `node_modules/@spotify/basic-pitch/model/{model.json,group1-shard1of1.bin}` plus `LICENSE` (Apache-2.0) into `public/models/basic-pitch/`. The main thread passes an absolute model URL to the worker, because relative URLs resolve differently inside workers.
- `new BasicPitch(modelUrl)` loads the model with basic-pitch's own tf instance. **App code never imports `@tensorflow/tfjs`.** Only the Node test does (it needs `tf.io.fromMemory`), so `@tensorflow/tfjs@^3.21.0` is a devDependency, and `npm ls @tensorflow/tfjs` must show one deduped copy.
- tfjs uses WebGL in the worker when `OffscreenCanvas` exists, otherwise CPU. The modal shows progress % and a Cancel button. Analysis is capped at the first 300 s, the same as `AudioImportModal`.
- tfjs lives **only in the worker chunk**, so the main bundle is unaffected.

### D2. Input prep
basic-pitch needs **22050 Hz mono** `Float32Array`. `resampleMono` renders through `OfflineAudioContext(1, n, 22050)`. The instrument's range (lowest open string to highest string + frets, or A0–C8), with a semitone of margin, is passed as `minFreq`/`maxFreq` to basic-pitch's `outputToNotesPoly`. No band-pass filter: the model was trained on full-band audio.

### D3. Cleaning (`cleanNotes`)
Keep notes in range with `amp ≥ minAmp` and `duration ≥ 60 ms`. `minAmp` comes from the **Sensitivity** control: More = 0.2, Balanced = 0.3 (default), Fewer = 0.45. Raising it is also how the user filters out quieter accompaniment in a mix.

### D4a. Source: "Only my instrument" (`isolateLine`), default and recommended
The file is assumed to hold just one instrument playing one note at a time. That allows stricter rules:
1. **`suppressHarmonics`:** drop a note that is +12, +19 or +24 semitones (octave, octave + 5th, two octaves) above a note at least as loud whose onset is within 60 ms. These are the string's own overtones that basic-pitch sometimes reports as notes. A *real* octave jump starts at a different time, so it is kept.
2. **`monophonize`:** sort by onset. Onsets within 30 ms of each other collapse to the loudest one (a double-stop keeps only its strongest note). Each note's end is cut at the next note's start: on a single-line part, the newest note is the one being played and earlier ones are only ringing.
3. **`chordShare` check:** the share of onset groups (60 ms) with 3 or more notes, measured after harmonic removal. If it is above 0.25, show a non-blocking notice: *"This file has a lot of notes played together (chords or other instruments). If it's a full song, switch Source to Full song."*

### D4b. Source: "Full song" (`extractLine`)
Sweep time in 10 ms steps. At each step the winner among sounding notes is the **lowest** (bass) or **highest** (guitar and keyboard default) pitch; the user can switch with the **Follow** control. Consecutive steps with the same winning note form a run. Runs shorter than 60 ms are dropped, and a note split by a dropped glitch is rejoined. Each output note keeps its true start and end (clamped to the run). Uses an active-set sweep: 8 ms for 3,000 notes.

### D5. Fingering (`fingerLine`, Viterbi)
Candidates per note are every `{string, fret}` with `0 ≤ fret ≤ frets` that sounds that pitch; every in-range pitch has at least one. Costs:
- Position cost: `0.1·fret`, a mild preference for lower frets.
- Transition: `Δfret` (0.5 when either note is an open string), **+3** for a hand shift (both fretted and more than 3 frets apart), and `+0.3·Δstring`.
- Transitions across a rest longer than 1 s are scaled ×0.3, because there's time to move the hand.

It picks the globally cheapest path, so a line stays in one hand position instead of greedily jumping.

### D6. Learning UI
- **Fretboard / Keyboard:** the **current** note is solid; the **next** note is an outline ring (paler key on the keyboard), so you know where to go. During rests only the next note shows.
- **Tab strip:** the whole line as tab (fret numbers on string rows, high string on top), with the note name under each column. The current column is highlighted and auto-scrolled into view, and clicking a column seeks there. The keyboard gets a single row of note names.
- **Transport:** `<audio controls>`, **Speed** 50% / 75% / 100% (`playbackRate`; browsers keep the pitch by default), and an **A–B loop** (Set A / Set B / Clear, checked in the rAF loop).
- **Source:** chosen on the setup screen, with "Only my instrument" pre-selected and marked *recommended, most accurate*. It can also be switched in the learn view, which is instant because there's no re-transcription. **Follow** (top or bottom line) only appears for Full song.
- **Sync:** a `requestAnimationFrame` loop binary-searches the line and calls `setState` only when the current or next index changes.

### D7. Entry point
A Library header button, "🎸 Learn a line", next to "🎤 Live chord test". The view is read-only and writes nothing to songs.

### Defaults (edit before implementing if you disagree)
- Guitar: Standard, Drop D, Eb standard, 20 frets. Bass: 4-string, 5-string, Drop D, 20 frets. Keyboard: 88 keys.
- Source default: "Only my instrument". Follow defaults (Full song only): bass = lowest; guitar and keyboard = highest.
- Tab is drawn high string on top, right-handed. Columns are evenly spaced, not to scale in time: there's no reliable bar grid from audio alone.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `package.json` | Modify | `@spotify/basic-pitch@1.0.1`; devDependency `@tensorflow/tfjs@^3.21.0` |
| `public/models/basic-pitch/*` | **Create** | Model files and LICENSE copied from the package |
| `src/audioChords.js` | Modify | Add `resampleMono` beside `decodeAudioFile` |
| `src/transcription.js` | **Create** | `transcribeNotes(samples, model, opts)` → `{midi,start,end,amp}[]` |
| `src/transcription.test.js` | **Create** | Integration test with the real model on a seeded synthetic strum |
| `src/transcribeWorker.js` | **Create** | Worker wrapper with progress messages |
| `src/instruments.js` (+ test) | **Create** | `INSTRUMENTS`, `midiToName`, `midiToHz`, `pitchClass`, `instrumentRange`, `findNoteAt`, `findNextNote` |
| `src/noteLine.js` (+ test) | **Create** | `cleanNotes`, `suppressHarmonics`, `monophonize`, `chordShare` (isolated source), `extractLine` (full-song source), `fingerLine`, `buildLine` |
| `src/Fretboard.jsx`, `src/Keyboard.jsx`, `src/TabStrip.jsx` | **Create** | Presentational SVG |
| `src/InstrumentVisualizerModal.jsx` | **Create** | Setup → transcribing → learn view |
| `src/index.css` | Modify | `--color-note`, `--color-note-next` (light and dark) |
| `src/App.jsx` | Modify | Library button, state, render the modal |

---

## Task 0: Clean working tree

At planning time the tree had **uncommitted** work (`LiveChordTest.jsx`, `matchChordTemplatesRanked`, the tempo fallback). Task 8 edits next to the Live-chord-test button, which only exists in that diff.

- [ ] `git status`. If those changes are still uncommitted, ask the user whether to commit them first. Don't build on a dirty tree without asking.
- [ ] `npm test` passes.

---

## Task 1: Dependencies, model, worker spike (de-risk first)

- [ ] **Step 1: Install**
```bash
npm install @spotify/basic-pitch@1.0.1
```
```bash
npm install -D @tensorflow/tfjs@^3.21.0
```
```bash
npm ls @tensorflow/tfjs
```
The expected result is a single deduped version. If there are two, pin the devDependency to the version basic-pitch resolved.

- [ ] **Step 2: Copy the model**
```bash
mkdir -p public/models/basic-pitch && cp node_modules/@spotify/basic-pitch/model/* public/models/basic-pitch/ && cp node_modules/@spotify/basic-pitch/LICENSE public/models/basic-pitch/
```

- [ ] **Step 3: Add `resampleMono`** to `src/audioChords.js`, below `decodeAudioFile`:
```js
/**
 * Downmixes to mono and resamples (e.g. to the 22050 Hz basic-pitch requires)
 * in one OfflineAudioContext render.
 * @param {AudioBuffer} audioBuffer
 * @param {number} sampleRate
 * @param {number} [maxSeconds]
 * @returns {Promise<Float32Array>}
 */
export async function resampleMono(audioBuffer, sampleRate, maxSeconds = Infinity) {
  const seconds = Math.min(audioBuffer.duration, maxSeconds);
  const ctx = new OfflineAudioContext(1, Math.ceil(seconds * sampleRate), sampleRate);
  const src = ctx.createBufferSource();
  src.buffer = audioBuffer;
  src.connect(ctx.destination);
  src.start();
  const rendered = await ctx.startRendering();
  return rendered.getChannelData(0).slice();
}
```

- [ ] **Step 4: `src/transcription.js`**
```js
// ─── Polyphonic note transcription (Spotify basic-pitch) ─────
// Imported only by transcribeWorker.js (and its test) so tfjs stays out of
// the main bundle.
import { BasicPitch, outputToNotesPoly, addPitchBendsToNoteEvents, noteFramesToTime } from '@spotify/basic-pitch';

export const TRANSCRIBE_SAMPLE_RATE = 22050; // required by the model

// basic-pitch defaults as used by basicpitch.io; tune in Task 9 on real recordings.
const ONSET_THRESH = 0.5;
const FRAME_THRESH = 0.3;
const MIN_NOTE_FRAMES = 5; // ≈58 ms at the model's 86 frames/s

/**
 * @param {Float32Array} samples mono, 22050 Hz
 * @param {string | Promise<object>} model model.json URL, or a loaded tf.GraphModel promise (tests)
 * @param {{minFreq?: number, maxFreq?: number, onProgress?: (p: number) => void}} [opts]
 * @returns {Promise<{midi:number, start:number, end:number, amp:number}[]>}
 */
export async function transcribeNotes(samples, model, { minFreq = null, maxFreq = null, onProgress = () => {} } = {}) {
  const frames = [];
  const onsets = [];
  const contours = [];
  await new BasicPitch(model).evaluateModel(
    samples,
    (f, o, c) => { frames.push(...f); onsets.push(...o); contours.push(...c); },
    onProgress,
  );
  const events = outputToNotesPoly(frames, onsets, ONSET_THRESH, FRAME_THRESH, MIN_NOTE_FRAMES, true, maxFreq, minFreq);
  return noteFramesToTime(addPitchBendsToNoteEvents(contours, events)).map((n) => ({
    midi: n.pitchMidi,
    start: n.startTimeSeconds,
    end: n.startTimeSeconds + n.durationSeconds,
    amp: n.amplitude,
  }));
}
```

- [ ] **Step 5: `src/transcribeWorker.js`**
```js
import { transcribeNotes } from './transcription.js';

self.onmessage = async (e) => {
  const { samples, modelUrl, minFreq, maxFreq } = e.data;
  try {
    const notes = await transcribeNotes(samples, modelUrl, {
      minFreq, maxFreq,
      onProgress: (p) => self.postMessage({ type: 'progress', value: p }),
    });
    self.postMessage({ type: 'done', notes });
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message });
  }
};
```

- [ ] **Step 6: Browser spike.** Start the dev server with preview_start. From a temporary button or the console: decode a short file, `resampleMono(buf, 22050, 30)`, and post to `new Worker(new URL('/src/transcribeWorker.js', location.href), { type: 'module' })` with `modelUrl: new URL('/models/basic-pitch/model.json', location.href).href`. Confirm that `done` arrives with plausible notes, and **record the wall time and backend**.
  - If tfjs fails in the worker (WebGL or OffscreenCanvas), check `tf.getBackend()` and consider `import '@tensorflow/tfjs-backend-cpu'`. As a last resort, run `transcribeNotes` on the main thread; it yields between model windows. **Record in this plan which path was taken.**
  - If the build errors on worker format (IIFE and code-splitting), add `worker: { format: 'es' }` to `vite.config.js`.
- [ ] **Step 7:** `npm run build` succeeds, and tfjs is in the worker chunk only. Check the file sizes in `dist/assets`.
- [ ] **Step 8: Commit**: `feat: add basic-pitch note transcription worker`

---

## Task 2: Transcription integration test

The seed and synthesis were verified during planning: deterministic, with C3, E3 and G3 at amplitude ≥ 0.65.

- [ ] **Step 1: `src/transcription.test.js`**
```js
import { describe, it, expect } from 'vitest'
import * as tf from '@tensorflow/tfjs'
import fs from 'node:fs'
import path from 'node:path'
import { transcribeNotes, TRANSCRIBE_SAMPLE_RATE as SR } from './transcription.js'

function loadModel() {
  const dir = path.resolve(__dirname, '../public/models/basic-pitch')
  const json = JSON.parse(fs.readFileSync(path.join(dir, 'model.json'), 'utf8'))
  const bin = fs.readFileSync(path.join(dir, json.weightsManifest[0].paths[0]))
  return tf.loadGraphModel(tf.io.fromMemory({
    modelTopology: json.modelTopology,
    weightSpecs: json.weightsManifest[0].weights,
    weightData: bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength),
    format: json.format, generatedBy: json.generatedBy, convertedBy: json.convertedBy,
  }))
}

// Karplus-Strong plucked strings with seeded noise, so the test is deterministic.
function strum(midis, seconds = 2) {
  let seed = 1
  const rand = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296
  const out = new Float32Array(SR * seconds)
  midis.forEach((midi, k) => {
    const f = 440 * 2 ** ((midi - 69) / 12)
    const N = Math.round(SR / f)
    const buf = Float32Array.from({ length: N }, () => rand() * 2 - 1)
    const s0 = Math.floor((0.1 + k * 0.015) * SR)
    for (let i = 0; s0 + i < out.length && i < 1.8 * SR; i++) {
      const j = i % N
      const v = buf[j]
      buf[j] = 0.996 * 0.5 * (buf[j] + buf[(j + 1) % N])
      out[s0 + i] += v * 0.15
    }
  })
  return out
}

describe('transcribeNotes (real model)', () => {
  it('finds C3 E3 G3 of an open-C strum with the right octaves', async () => {
    const notes = await transcribeNotes(strum([48, 52, 55, 60, 64]), loadModel())
    const strong = new Set(notes.filter((n) => n.amp >= 0.5).map((n) => n.midi))
    expect(strong.has(48)).toBe(true)
    expect(strong.has(52)).toBe(true)
    expect(strong.has(55)).toBe(true)
    for (const n of notes) expect(n.end).toBeGreaterThan(n.start)
  }, 60000)
})
```
- [ ] **Step 2:** `npm test` passes. The test takes about 3 s and prints a harmless "install tfjs-node" banner. **Commit**: `test: basic-pitch transcription integration test`

---

## Task 3: `instruments.js` (TDD)

- [ ] **Step 1: `src/instruments.test.js`**
```js
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
```
- [ ] **Step 2: `src/instruments.js`**
```js
// ─── Instrument definitions + small music helpers ────────────
// Fretted tunings are MIDI numbers of the open strings, index 0 = LOWEST
// string. Fretboard/TabStrip flip it for display (high string on top).
import { ROOTS } from './chords.js';

export const INSTRUMENTS = {
  guitar: {
    id: 'guitar', label: 'Guitar', kind: 'fretted', frets: 20, defaultFollow: 'highest',
    tunings: {
      standard:     { label: 'Standard (E A D G B E)', strings: [40, 45, 50, 55, 59, 64] },
      dropD:        { label: 'Drop D (D A D G B E)',   strings: [38, 45, 50, 55, 59, 64] },
      halfStepDown: { label: 'Eb standard',            strings: [39, 44, 49, 54, 58, 63] },
    },
  },
  bass: {
    id: 'bass', label: 'Bass', kind: 'fretted', frets: 20, defaultFollow: 'lowest',
    tunings: {
      standard4: { label: '4-string (E A D G)',   strings: [28, 33, 38, 43] },
      standard5: { label: '5-string (B E A D G)', strings: [23, 28, 33, 38, 43] },
      dropD:     { label: 'Drop D (D A D G)',     strings: [26, 33, 38, 43] },
    },
  },
  keyboard: { id: 'keyboard', label: 'Keyboard', kind: 'keys', low: 21, high: 108, defaultFollow: 'highest', tunings: null },
};

export const pitchClass = (midi) => ((midi % 12) + 12) % 12;

export function midiToName(midi) {
  return `${ROOTS[pitchClass(midi)]}${Math.floor(midi / 12) - 1}`;
}

export function midiToHz(midi) {
  return 440 * 2 ** ((midi - 69) / 12);
}

/** [lowestMidi, highestMidi] the instrument can sound. */
export function instrumentRange(instrument, tuning) {
  if (instrument.kind === 'keys') return [instrument.low, instrument.high];
  return [Math.min(...tuning), Math.max(...tuning) + instrument.frets];
}

/** Index of the note sounding at t (start inclusive, end exclusive), else -1. Notes sorted, non-overlapping. */
export function findNoteAt(notes, t) {
  let lo = 0;
  let hi = notes.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (t < notes[mid].start) hi = mid - 1;
    else if (t >= notes[mid].end) lo = mid + 1;
    else return mid;
  }
  return -1;
}

/** Index of the first note starting strictly after t, else -1. */
export function findNextNote(notes, t) {
  let lo = 0;
  let hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (notes[mid].start > t) hi = mid;
    else lo = mid + 1;
  }
  return lo < notes.length ? lo : -1;
}
```
- [ ] **Step 3:** `npm test` passes. **Commit**: `feat: instrument definitions and line lookup helpers`

---

## Task 4: `noteLine.js`: cleaning, line extraction, fingering (TDD)

Every expectation below came out of the planning prototype with exactly these constants. If a test fails, diff the code against this plan **before** touching any weights.

- [ ] **Step 1: `src/noteLine.test.js`**
```js
import { describe, it, expect } from 'vitest'
import {
  cleanNotes, suppressHarmonics, monophonize, chordShare, extractLine, fingerLine, buildLine,
} from './noteLine.js'
import { INSTRUMENTS } from './instruments.js'

const STD = INSTRUMENTS.guitar.tunings.standard.strings
const BASS4 = INSTRUMENTS.bass.tunings.standard4.strings
const seq = (midis, d = 0.25) => midis.map((midi, i) => ({ midi, start: i * d, end: i * d + d * 0.9, amp: 0.8 }))
const fmt = (positions) => positions.map((p) => `${p.string}:${p.fret}`).join(' ')
const brief = (line) => line.map((n) => `${n.midi}@${n.start}-${n.end}`).join(' ')

describe('cleanNotes', () => {
  it('drops out-of-range, quiet and very short notes, sorted by start', () => {
    const out = cleanNotes([
      { midi: 52, start: 0.5, end: 1, amp: 0.8 },
      { midi: 30, start: 0, end: 1, amp: 0.8 },    // below range
      { midi: 55, start: 0, end: 1, amp: 0.1 },    // too quiet
      { midi: 57, start: 0, end: 0.03, amp: 0.8 }, // too short
      { midi: 48, start: 0.2, end: 1, amp: 0.8 },
    ], [40, 84])
    expect(out.map((n) => n.midi)).toEqual([48, 52])
  })
  it('respects a custom minAmp', () => {
    expect(cleanNotes([{ midi: 48, start: 0, end: 1, amp: 0.25 }], [40, 84], { minAmp: 0.2 })).toHaveLength(1)
  })
})

describe('isolated source: suppressHarmonics + monophonize', () => {
  const iso = (notes) => brief(monophonize(suppressHarmonics(notes)))
  it('removes octave/12th ghosts reported with the real note', () => {
    expect(iso([
      { midi: 57, start: 0, end: 0.5, amp: 0.8 }, { midi: 69, start: 0.01, end: 0.4, amp: 0.3 },
      { midi: 60, start: 0.5, end: 1, amp: 0.8 }, { midi: 79, start: 0.52, end: 0.8, amp: 0.35 },
    ])).toBe('57@0-0.5 60@0.5-1')
  })
  it('the newest note wins over an earlier note that is still ringing', () => {
    expect(iso([
      { midi: 45, start: 0, end: 2, amp: 0.7 }, { midi: 52, start: 0.5, end: 1, amp: 0.6 },
      { midi: 57, start: 1, end: 1.5, amp: 0.6 },
    ])).toBe('45@0-0.5 52@0.5-1 57@1-1.5')
  })
  it('keeps a real octave jump (different onset times)', () => {
    expect(iso([{ midi: 45, start: 0, end: 1, amp: 0.8 }, { midi: 57, start: 0.5, end: 1, amp: 0.6 }]))
      .toBe('45@0-0.5 57@0.5-1')
  })
  it('collapses near-simultaneous onsets to the loudest note', () => {
    expect(iso([{ midi: 45, start: 0, end: 1, amp: 0.5 }, { midi: 52, start: 0.01, end: 1, amp: 0.9 }]))
      .toBe('52@0.01-1')
  })
  it('monophonize returns [] for no notes', () => expect(monophonize([])).toEqual([]))
})

describe('chordShare', () => {
  it('is 1 for strummed triads and 0 for a single-note line', () => {
    const strums = [0, 1, 2].flatMap((t) => [48, 52, 55].map((midi, i) => ({ midi, start: t + i * 0.01, end: t + 1, amp: 0.7 })))
    expect(chordShare(strums)).toBe(1)
    expect(chordShare(seq([40, 43, 45]))).toBe(0)
    expect(chordShare([])).toBe(0)
  })
})

describe('extractLine (full-song source)', () => {
  // Bass A1→G1, chords above, melody A4 B4 C5 on top
  const mix = [
    { midi: 33, start: 0, end: 1, amp: 0.8 }, { midi: 57, start: 0, end: 1, amp: 0.5 },
    { midi: 61, start: 0, end: 1, amp: 0.5 }, { midi: 64, start: 0, end: 1, amp: 0.5 },
    { midi: 31, start: 1, end: 2, amp: 0.8 }, { midi: 55, start: 1, end: 2, amp: 0.5 },
    { midi: 59, start: 1, end: 2, amp: 0.5 }, { midi: 62, start: 1, end: 2, amp: 0.5 },
    { midi: 69, start: 0.2, end: 0.5, amp: 0.7 }, { midi: 71, start: 0.5, end: 0.8, amp: 0.7 },
    { midi: 72, start: 0.8, end: 1.6, amp: 0.7 },
  ]
  it('lowest follows the bass line', () => {
    expect(brief(extractLine(mix, 'lowest'))).toBe('33@0-1 31@1-2')
  })
  it('highest follows the top line', () => {
    expect(brief(extractLine(mix, 'highest'))).toBe('64@0-0.2 69@0.2-0.5 71@0.5-0.8 72@0.8-1.6 62@1.6-2')
  })
  it('keeps a re-struck note as two notes', () => {
    const line = extractLine([{ midi: 45, start: 0, end: 0.5, amp: 1 }, { midi: 45, start: 0.5, end: 1, amp: 1 }])
    expect(brief(line)).toBe('45@0-0.5 45@0.5-1')
  })
  it('drops a short glitch and rejoins the note it interrupted', () => {
    const line = extractLine([{ midi: 45, start: 0, end: 1, amp: 1 }, { midi: 80, start: 0.5, end: 0.53, amp: 1 }])
    expect(brief(line)).toBe('45@0-1')
  })
  it('returns [] for no notes', () => expect(extractLine([])).toEqual([]))
})

describe('fingerLine', () => {
  it('stays at the 12th position for a high lick', () => {
    expect(fmt(fingerLine(seq([76, 74, 72, 69, 72, 74, 76]), STD, 20))).toBe('5:12 5:10 5:8 4:10 5:8 5:10 5:12')
  })
  it('plays a low riff in open position', () => {
    expect(fmt(fingerLine(seq([40, 40, 43, 45, 40, 43, 46, 45]), STD, 20))).toBe('0:0 0:0 0:3 1:0 0:0 0:3 1:1 1:0')
  })
  it('fingers a bass line', () => {
    expect(fmt(fingerLine(seq([28, 28, 31, 33, 35, 33, 31, 28]), BASS4, 20))).toBe('0:0 0:0 0:3 1:0 1:2 1:0 0:3 0:0')
  })
  it('every position sounds exactly the transcribed pitch', () => {
    const line = seq([45, 48, 50, 52, 55, 57, 60, 62, 64, 67, 69, 72])
    fingerLine(line, STD, 20).forEach((p, i) => expect(STD[p.string] + p.fret).toBe(line[i].midi))
  })
  it('returns [] for an empty line', () => expect(fingerLine([], STD, 20)).toEqual([]))
})

describe('buildLine', () => {
  const raw = seq([40, 43, 45])
  const opts = (over) => ({ instrument: INSTRUMENTS.guitar, tuning: STD, minAmp: 0.3, source: 'isolated', follow: 'highest', ...over })
  it('fretted: adds string, fret and name to each note (both sources)', () => {
    for (const source of ['isolated', 'mix']) {
      const { line } = buildLine(raw, opts({ source }))
      expect(line.map((n) => [n.name, n.string, n.fret])).toEqual([['E2', 0, 0], ['G2', 0, 3], ['A2', 1, 0]])
    }
  })
  it('keyboard: names only', () => {
    const { line } = buildLine(raw, opts({ instrument: INSTRUMENTS.keyboard, tuning: null }))
    expect(line.map((n) => n.name)).toEqual(['E2', 'G2', 'A2'])
    expect(line[0].string).toBeUndefined()
  })
  it('isolated: drops ghosts that the full-song heuristic would follow', () => {
    const ghosty = [{ midi: 57, start: 0, end: 0.5, amp: 0.8 }, { midi: 69, start: 0.01, end: 0.4, amp: 0.3 }]
    expect(buildLine(ghosty, opts({ source: 'isolated' })).line.map((n) => n.name)).toEqual(['A3'])
    expect(buildLine(ghosty, opts({ source: 'mix' })).line[0].name).toBe('A4')
  })
  it('reports chordShare for the isolated source only', () => {
    const strums = [0, 1].flatMap((t) => [48, 52, 55].map((midi, i) => ({ midi, start: t + i * 0.01, end: t + 1, amp: 0.7 })))
    expect(buildLine(strums, opts()).chordShare).toBe(1)
    expect(buildLine(strums, opts({ source: 'mix' })).chordShare).toBeNull()
  })
})
```

- [ ] **Step 2:** `npm test` should fail (the module is missing).

- [ ] **Step 3: `src/noteLine.js`**
```js
// ─── Transcribed notes → one playable line ───────────────────
// Pure functions. Input notes: { midi, start, end, amp } (seconds), from
// transcription.js. Pipeline: cleanNotes → (isolated: suppressHarmonics →
// monophonize | full song: extractLine) → fingerLine.
import { midiToName, instrumentRange } from './instruments.js';

const MIN_DURATION = 0.06;
const HARMONIC_INTERVALS = [12, 19, 24]; // octave, octave+5th, two octaves
const ONSET_WINDOW = 0.06;   // "started together"
const DOUBLE_STOP_WINDOW = 0.03;
const LINE_STEP = 0.01;      // extraction sweep resolution (s)
const SHIFT_PENALTY = 3;     // moving the hand > 3 frets between two fretted notes
const LONG_REST = 1;         // s; after this the hand has time to move
const LONG_REST_SCALE = 0.3;

export function cleanNotes(notes, [low, high], { minAmp = 0.3, minDuration = MIN_DURATION } = {}) {
  return notes
    .filter((n) => n.midi >= low && n.midi <= high && n.amp >= minAmp && n.end - n.start >= minDuration)
    .sort((a, b) => a.start - b.start || a.midi - b.midi);
}

// ── Isolated source: the file holds only the user's instrument ──

/** Drops overtones basic-pitch reported as notes: weaker, starting with a note 1–2 octaves (or an octave+5th) below. */
export function suppressHarmonics(notes, window = ONSET_WINDOW) {
  return notes.filter((n) => !notes.some((m) => m !== n && m.amp >= n.amp
    && HARMONIC_INTERVALS.includes(n.midi - m.midi) && Math.abs(n.start - m.start) <= window));
}

/** One note at a time: near-simultaneous onsets keep the loudest; each note ends when the next begins (earlier notes only ring). */
export function monophonize(notes, window = DOUBLE_STOP_WINDOW) {
  const sorted = [...notes].sort((a, b) => a.start - b.start || b.amp - a.amp);
  const picked = [];
  for (const n of sorted) {
    const last = picked[picked.length - 1];
    if (last && n.start - last.start <= window) {
      if (n.amp > last.amp) picked[picked.length - 1] = n;
      continue;
    }
    picked.push(n);
  }
  return picked.map((n, i) => ({ ...n, end: i + 1 < picked.length ? Math.min(n.end, picked[i + 1].start) : n.end }));
}

/** Share of onset groups with ≥3 notes; high = chords or several instruments, not a single line. */
export function chordShare(notes, window = ONSET_WINDOW) {
  const groups = [];
  for (const n of [...notes].sort((a, b) => a.start - b.start)) {
    const g = groups[groups.length - 1];
    if (g && n.start - g.start <= window) g.count++;
    else groups.push({ start: n.start, count: 1 });
  }
  return groups.length ? groups.filter((g) => g.count >= 3).length / groups.length : 0;
}

// ── Full-song source: guess the part from a mix ──

/**
 * One note at a time: at each time step the lowest/highest sounding note wins.
 * @param {'lowest'|'highest'} follow
 */
export function extractLine(notes, follow = 'highest', { step = LINE_STEP, minDuration = MIN_DURATION } = {}) {
  if (!notes.length) return [];
  const sorted = [...notes].sort((a, b) => a.start - b.start);
  const t0 = sorted[0].start;
  const end = Math.max(...sorted.map((n) => n.end));
  const runs = [];
  let active = [];
  let next = 0;
  for (let i = 0, t = t0; t < end; i++, t = t0 + i * step) {
    while (next < sorted.length && sorted[next].start <= t) active.push(sorted[next++]);
    active = active.filter((n) => n.end > t);
    let win = null;
    for (const n of active) if (!win || (follow === 'lowest' ? n.midi < win.midi : n.midi > win.midi)) win = n;
    if (!win) continue;
    const last = runs[runs.length - 1];
    if (last && last.note === win && last.lastStep === i - 1) { last.end = t + step; last.lastStep = i; }
    else runs.push({ note: win, start: t, end: t + step, lastStep: i });
  }
  const kept = [];
  for (const r of runs.filter((x) => x.end - x.start >= minDuration - 1e-9)) {
    const last = kept[kept.length - 1];
    if (last && last.note === r.note) last.end = r.end; // a dropped glitch split this note; rejoin it
    else kept.push(r);
  }
  const round = (t) => Math.round(t * 1000) / 1000;
  return kept.map((r) => ({
    midi: r.note.midi,
    amp: r.note.amp,
    start: round(Math.max(r.start, r.note.start)),
    end: round(Math.min(r.end, r.note.end)),
  }));
}

/**
 * Viterbi over every string/fret that sounds each note, so the whole line is
 * played the way a player would: stay in position, shift only when it pays.
 * Notes must be within the instrument's range (cleanNotes guarantees it).
 * @returns {{string:number, fret:number}[]} one per note
 */
export function fingerLine(line, tuning, frets) {
  if (!line.length) return [];
  const cands = line.map((n) => tuning
    .map((open, string) => ({ string, fret: n.midi - open }))
    .filter((p) => p.fret >= 0 && p.fret <= frets));
  const posCost = (p) => p.fret * 0.1;
  const trans = (a, b, gap) => {
    const dFret = a.fret === 0 || b.fret === 0 ? 0.5 : Math.abs(a.fret - b.fret);
    const shift = a.fret && b.fret && Math.abs(a.fret - b.fret) > 3 ? SHIFT_PENALTY : 0;
    return (dFret + shift) * (gap > LONG_REST ? LONG_REST_SCALE : 1) + Math.abs(a.string - b.string) * 0.3;
  };

  let prev = cands[0].map((p) => ({ cost: posCost(p), back: -1 }));
  const steps = [prev];
  for (let i = 1; i < line.length; i++) {
    const gap = line[i].start - line[i - 1].end;
    prev = cands[i].map((b) => {
      let best = { cost: Infinity, back: -1 };
      cands[i - 1].forEach((a, k) => {
        const c = steps[i - 1][k].cost + trans(a, b, gap);
        if (c < best.cost) best = { cost: c, back: k };
      });
      return { cost: best.cost + posCost(b), back: best.back };
    });
    steps.push(prev);
  }

  const out = new Array(line.length);
  let k = prev.reduce((bi, s, i, arr) => (s.cost < arr[bi].cost ? i : bi), 0);
  for (let i = line.length - 1; i >= 0; i--) {
    out[i] = cands[i][k];
    k = steps[i][k].back;
  }
  return out;
}

/**
 * Raw transcription → the line the view draws. Cheap; re-run on Source/Sensitivity/Follow change.
 * @param {{instrument, tuning, minAmp: number, source: 'isolated'|'mix', follow: 'lowest'|'highest'}} opts
 * @returns {{ line: object[], chordShare: number|null }} chordShare only for the isolated source
 */
export function buildLine(rawNotes, { instrument, tuning, minAmp, source, follow }) {
  const cleaned = cleanNotes(rawNotes, instrumentRange(instrument, tuning), { minAmp });
  let line;
  let share = null;
  if (source === 'isolated') {
    const real = suppressHarmonics(cleaned);
    share = chordShare(real);
    line = monophonize(real);
  } else {
    line = extractLine(cleaned, follow);
  }
  const named = line.map((n) => ({ ...n, name: midiToName(n.midi) }));
  if (instrument.kind !== 'fretted') return { line: named, chordShare: share };
  const positions = fingerLine(named, tuning, instrument.frets);
  return { line: named.map((n, i) => ({ ...n, ...positions[i] })), chordShare: share };
}
```

- [ ] **Step 4:** `npm test` passes. **Commit**: `feat: extract and finger a single-note line from transcription`

---

## Task 5: SVG components

- [ ] **Step 1: Colors.** Add these to `src/index.css` in **both** the light `:root` and the dark `@media (prefers-color-scheme: dark)` `:root`:
```css
  /* light */                 /* dark */
  --color-note: #E4572E;      /* #FF7A50 */
  --color-note-next: #2F6FDB; /* #6EA2FF */
```

- [ ] **Step 2: `src/Fretboard.jsx`**
```jsx
// Presentational SVG fretboard. `current` is solid; `next` is an outline ring
// so the player sees where to go. Tab convention: high string on top.
const FRET_W = 36;
const ROW_H = 24;
const NUT_X = 48;
const PAD_Y = 16;
const INLAYS = [3, 5, 7, 9, 15, 17, 19, 21];

export function Fretboard({ tuning, frets, noteNames, current, next }) {
  const n = tuning.length;
  const boardH = (n - 1) * ROW_H;
  const width = NUT_X + frets * FRET_W + 8;
  const height = PAD_Y * 2 + boardH + 14;
  const y = (s) => PAD_Y + (n - 1 - s) * ROW_H;
  const x = (f) => (f === 0 ? NUT_X - 14 : NUT_X + (f - 0.5) * FRET_W);
  const midY = PAD_Y + boardH / 2;
  const samePos = current && next && current.string === next.string && current.fret === next.fret;

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label="Fretboard">
        {INLAYS.filter((f) => f <= frets).map((f) => <circle key={f} cx={x(f)} cy={midY} r={4} fill="var(--color-border-strong)" />)}
        {frets >= 12 && [-1, 1].map((k) => <circle key={`12${k}`} cx={x(12)} cy={midY + k * ROW_H} r={4} fill="var(--color-border-strong)" />)}
        {Array.from({ length: frets + 1 }, (_, f) => (
          <line key={f} x1={NUT_X + f * FRET_W} x2={NUT_X + f * FRET_W} y1={PAD_Y} y2={PAD_Y + boardH}
            stroke="var(--color-text-3)" strokeWidth={f === 0 ? 4 : 1} />
        ))}
        {tuning.map((_, s) => (
          <g key={s}>
            <line x1={NUT_X} x2={NUT_X + frets * FRET_W} y1={y(s)} y2={y(s)} stroke="var(--color-text-2)" strokeWidth={1 + (n - 1 - s) * 0.35} />
            <text x={4} y={y(s) + 4} fontSize={11} fill="var(--color-text-3)">{noteNames[s]}</text>
          </g>
        ))}
        {[3, 5, 7, 9, 12, 15, 17, 19].filter((f) => f <= frets).map((f) => (
          <text key={f} x={x(f)} y={height - 4} fontSize={10} textAnchor="middle" fill="var(--color-text-3)">{f}</text>
        ))}
        {next && !samePos && (
          <circle cx={x(next.fret)} cy={y(next.string)} r={9} fill="none" stroke="var(--color-note-next)" strokeWidth={2.5} />
        )}
        {current && (
          <g>
            <circle cx={x(current.fret)} cy={y(current.string)} r={10} fill="var(--color-note)" />
            <text x={x(current.fret)} y={y(current.string) + 3.5} fontSize={9} fontWeight={700} textAnchor="middle" fill="#fff">
              {current.name.replace(/-?\d+$/, '')}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}
```

- [ ] **Step 3: `src/Keyboard.jsx`**
```jsx
// Presentational SVG piano (A0–C8). Fixed key colors so it reads as a piano
// in dark mode too; current = solid accent, next = secondary accent.
import { midiToName } from './instruments.js';

const WW = 14, WH = 72, BW = 9, BH = 44;
const isBlack = (m) => [1, 3, 6, 8, 10].includes(m % 12);

export function Keyboard({ low = 21, high = 108, current, next }) {
  const whites = [];
  for (let m = low; m <= high; m++) if (!isBlack(m)) whites.push(m);
  const whiteX = new Map(whites.map((m, i) => [m, i * WW]));
  const width = whites.length * WW;
  const fill = (m, base) => (m === current?.midi ? 'var(--color-note)' : m === next?.midi ? 'var(--color-note-next)' : base);
  const blacks = [];
  for (let m = low; m <= high; m++) if (isBlack(m) && whiteX.has(m - 1)) blacks.push(m);
  const centerX = (m) => (isBlack(m) ? whiteX.get(m - 1) + WW : whiteX.get(m) + WW / 2);

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${width} ${WH + 16}`} width="100%" style={{ minWidth: 728 }} role="img" aria-label="Keyboard">
        {whites.map((m) => (
          <g key={m}>
            <rect x={whiteX.get(m)} y={0} width={WW} height={WH} rx={2} fill={fill(m, '#FFFFFF')} stroke="#9A9793" strokeWidth={0.75} />
            {m % 12 === 0 && <text x={whiteX.get(m) + WW / 2} y={WH + 12} fontSize={8} textAnchor="middle" fill="var(--color-text-3)">{midiToName(m)}</text>}
          </g>
        ))}
        {blacks.map((m) => (
          <rect key={m} x={whiteX.get(m - 1) + WW - BW / 2} y={0} width={BW} height={BH} rx={1.5} fill={fill(m, '#1A1A18')} />
        ))}
        {current && current.midi >= low && current.midi <= high && (
          <text x={centerX(current.midi)} y={(isBlack(current.midi) ? BH : WH) - 6} fontSize={7} fontWeight={700} textAnchor="middle" fill="#fff">
            {current.name}
          </text>
        )}
      </svg>
    </div>
  );
}
```

- [ ] **Step 4: `src/TabStrip.jsx`**
```jsx
// The whole line at a glance. Fretted: tab (fret numbers on string rows, high
// string on top) with note names below. Keyboard: note names only. Columns are
// evenly spaced (no reliable bar grid from audio). Click a column to seek.
import { useEffect, useRef } from 'react';

const COL_W = 30;
const ROW_H = 16;
const PAD = 12;

export function TabStrip({ line, tuning, noteNames, currentIdx, nextIdx, onSeek }) {
  const scrollRef = useRef(null);
  const rows = tuning ? tuning.length : 0;
  const y = (s) => PAD + (rows - 1 - s) * ROW_H; // high string on top
  const namesY = PAD + Math.max(rows - 1, 0) * ROW_H + (rows ? 20 : 4);
  const width = PAD * 2 + 20 + line.length * COL_W;
  const height = namesY + 10;
  const colX = (i) => PAD + 20 + i * COL_W + COL_W / 2;
  const focusIdx = currentIdx >= 0 ? currentIdx : nextIdx;

  // Keep the current (or upcoming) note in view.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || focusIdx < 0) return;
    const cx = colX(focusIdx);
    if (cx < el.scrollLeft + 40 || cx > el.scrollLeft + el.clientWidth - 40) el.scrollLeft = cx - el.clientWidth / 3;
  }, [focusIdx]);

  return (
    <div ref={scrollRef} style={{ overflowX: 'auto', border: '1px solid var(--color-border)', borderRadius: 10 }}>
      <svg width={width} height={height} role="img" aria-label="Tab">
        {Array.from({ length: rows }, (_, s) => (
          <g key={s}>
            <text x={PAD} y={y(s) + 4} fontSize={10} fill="var(--color-text-3)">{noteNames[s]}</text>
            <line x1={PAD + 16} x2={width - PAD} y1={y(s)} y2={y(s)} stroke="var(--color-border-strong)" />
          </g>
        ))}
        {line.map((n, i) => {
          const isCur = i === currentIdx;
          const isNext = i === nextIdx && !isCur;
          const color = isCur ? 'var(--color-note)' : isNext ? 'var(--color-note-next)' : 'var(--color-text)';
          return (
            <g key={i} onClick={() => onSeek(n.start)} style={{ cursor: 'pointer' }}>
              <rect x={colX(i) - COL_W / 2} y={0} width={COL_W} height={height}
                fill={isCur ? 'var(--color-surface-2)' : 'transparent'} />
              {rows > 0 && (
                <>
                  <rect x={colX(i) - 8} y={y(n.string) - 7} width={16} height={14} fill="var(--color-surface)" />
                  <text x={colX(i)} y={y(n.string) + 4} fontSize={11} fontWeight={isCur ? 700 : 500} textAnchor="middle" fill={color}>{n.fret}</text>
                </>
              )}
              <text x={colX(i)} y={namesY} fontSize={9} textAnchor="middle" fill={isCur || isNext ? color : 'var(--color-text-3)'}>{n.name}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
```
- [ ] **Step 5:** `npm run build` succeeds. **Commit**: `feat: fretboard, keyboard and tab components`

---

## Task 6: `InstrumentVisualizerModal.jsx`

Steps: `'setup'` → `'transcribing'` (with progress %) → `'view'`, or `'error'`. It follows `AudioImportModal` conventions: inline styles with theme vars, `requestIdRef` to ignore stale results, and terminating the worker on cancel or unmount.

- [ ] **Step 1: Create**
```jsx
import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { decodeAudioFile, resampleMono } from './audioChords.js';
import { INSTRUMENTS, instrumentRange, midiToHz, findNoteAt, findNextNote } from './instruments.js';
import { buildLine } from './noteLine.js';
import { ROOTS } from './chords.js';
import { Fretboard } from './Fretboard.jsx';
import { Keyboard } from './Keyboard.jsx';
import { TabStrip } from './TabStrip.jsx';

const MAX_ANALYSIS_SECONDS = 300;
const TRANSCRIBE_SAMPLE_RATE = 22050; // mirrors transcription.js; importing it would pull tfjs into this chunk
const SENSITIVITY = { more: 0.2, balanced: 0.3, fewer: 0.45 }; // → cleanNotes minAmp
const SPEEDS = [0.5, 0.75, 1];
const CHORD_SHARE_WARNING = 0.25; // isolated source: above this it doesn't sound like a single line
const SOURCES = {
  isolated: { label: 'Only my instrument', hint: 'Recommended, most accurate. The file has just the bass, guitar, piano or keyboard line: your own recording, a stem, or a solo clip.' },
  mix: { label: 'Full song', hint: 'The file is a whole song with other instruments. The app guesses the part by following the top or bottom line, so it is less accurate.' },
};

const firstTuning = (inst) => (inst.tunings ? Object.keys(inst.tunings)[0] : null);

export function InstrumentVisualizerModal({ onClose }) {
  const [instrumentId, setInstrumentId] = useState('bass');
  const [tuningId, setTuningId] = useState(firstTuning(INSTRUMENTS.bass));
  const [step, setStep] = useState('setup'); // 'setup' | 'transcribing' | 'view' | 'error'
  const [progress, setProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');
  const [rawNotes, setRawNotes] = useState([]);
  const [sensitivity, setSensitivity] = useState('balanced');
  const [source, setSource] = useState('isolated');
  const [follow, setFollow] = useState(INSTRUMENTS.bass.defaultFollow);
  const [speed, setSpeed] = useState(1);
  const [loop, setLoop] = useState({ a: null, b: null });
  const [pos, setPos] = useState({ current: -1, next: -1 });
  const [audioUrl, setAudioUrl] = useState(null);
  const audioRef = useRef(null);
  const workerRef = useRef(null);
  const requestIdRef = useRef(0);
  const audioUrlRef = useRef(null);
  const loopRef = useRef(loop);
  loopRef.current = loop;

  const instrument = INSTRUMENTS[instrumentId];
  const tuning = instrument.tunings?.[tuningId]?.strings ?? null;
  const noteNames = tuning ? tuning.map((m) => ROOTS[m % 12]) : [];

  const { line, chordShare } = useMemo(
    () => buildLine(rawNotes, { instrument, tuning, minAmp: SENSITIVITY[sensitivity], source, follow }),
    [rawNotes, instrument, tuning, sensitivity, source, follow],
  );

  const fail = (message) => { setErrorMessage(message); setStep('error'); };

  const runWorker = useCallback((payload) => new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./transcribeWorker.js', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    const done = () => { worker.terminate(); workerRef.current = null; };
    worker.onmessage = (e) => {
      if (e.data.type === 'progress') { setProgress(e.data.value); return; }
      if (e.data.type === 'done') resolve(e.data.notes);
      else reject(new Error(e.data.message || 'Transcription failed'));
      done();
    };
    worker.onerror = (err) => { reject(new Error(err.message || 'Worker error')); done(); };
    worker.postMessage(payload, [payload.samples.buffer]);
  }), []);

  const handleFile = useCallback(async (file) => {
    const requestId = ++requestIdRef.current;
    const stale = () => requestId !== requestIdRef.current;
    setStep('transcribing');
    setProgress(0);
    setErrorMessage('');

    let decoded;
    try {
      decoded = await decodeAudioFile(file);
    } catch {
      if (!stale()) fail("Couldn't read this audio file.");
      return;
    }
    if (stale()) return;

    try {
      const samples = await resampleMono(decoded, TRANSCRIBE_SAMPLE_RATE, MAX_ANALYSIS_SECONDS);
      if (stale()) return;
      const [low, high] = instrumentRange(instrument, tuning);
      const notes = await runWorker({
        samples,
        modelUrl: new URL(`${import.meta.env.BASE_URL}models/basic-pitch/model.json`, window.location.href).href,
        minFreq: midiToHz(low - 1),
        maxFreq: midiToHz(high + 1),
      });
      if (stale()) return;
      if (!notes.length) return fail(`Couldn't hear any notes in the ${instrument.label.toLowerCase()}'s range.`);

      setRawNotes(notes);
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = URL.createObjectURL(file);
      setAudioUrl(audioUrlRef.current);
      setLoop({ a: null, b: null });
      setPos({ current: -1, next: -1 });
      setStep('view');
    } catch (err) {
      if (!stale()) fail(err?.message ? `Transcription failed: ${err.message}` : 'Transcription failed. Try a different file.');
    }
  }, [instrument, tuning, runWorker]);

  const handleCancel = useCallback(() => {
    requestIdRef.current++;
    workerRef.current?.terminate();
    workerRef.current = null;
    setStep('setup');
  }, []);

  useEffect(() => () => {
    requestIdRef.current++;
    workerRef.current?.terminate();
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
  }, []);

  useEffect(() => { if (audioRef.current) audioRef.current.playbackRate = speed; }, [speed, audioUrl]);

  // Playback sync + A–B loop. Re-render only when current/next note changes.
  useEffect(() => {
    if (step !== 'view') return undefined;
    let raf;
    const tick = () => {
      const audio = audioRef.current;
      if (audio) {
        const { a, b } = loopRef.current;
        if (a !== null && b !== null && b > a && audio.currentTime >= b) audio.currentTime = a;
        const t = audio.currentTime;
        const current = findNoteAt(line, t);
        const next = findNextNote(line, t);
        setPos((p) => (p.current === current && p.next === next ? p : { current, next }));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [step, line]);

  const seekTo = (t) => { if (audioRef.current) audioRef.current.currentTime = t + 0.001; };
  const now = () => audioRef.current?.currentTime ?? 0;
  const current = pos.current >= 0 ? line[pos.current] : null;
  const next = pos.next >= 0 ? line[pos.next] : null;

  const pill = (selected) => ({
    padding: '6px 12px', borderRadius: 8, fontSize: 12, cursor: 'pointer', flexShrink: 0,
    border: `1px solid ${selected ? 'var(--color-accent)' : 'var(--color-border-strong)'}`,
    background: selected ? 'var(--color-accent)' : 'transparent',
    color: selected ? 'var(--color-surface)' : 'var(--color-text-2)',
  });
  const caption = { fontSize: 11, color: 'var(--color-text-3)', textTransform: 'uppercase', letterSpacing: '0.08em' };
  const row = { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' };
  const fmtTime = (t) => (t === null ? '–' : `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`);

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.4)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: 'var(--color-surface)', border: '1px solid var(--color-border-strong)', borderRadius: 16,
        padding: '1.5rem', width: 'min(880px, 95vw)', maxHeight: '90vh', overflowY: 'auto',
        boxShadow: '0 16px 48px rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column', gap: 14,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-text)' }}>Learn a line</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--color-text-2)', padding: '0 4px', lineHeight: 1 }}>×</button>
        </div>

        {step === 'setup' && (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={caption}>Instrument</span>
              <div style={row}>
                {Object.values(INSTRUMENTS).map((inst) => (
                  <button key={inst.id} style={pill(inst.id === instrumentId)} onClick={() => {
                    setInstrumentId(inst.id); setTuningId(firstTuning(inst)); setFollow(inst.defaultFollow);
                  }}>{inst.label}</button>
                ))}
              </div>
            </div>
            {instrument.tunings && (
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={caption}>Tuning</span>
                <select value={tuningId} onChange={(e) => setTuningId(e.target.value)} style={{ padding: 6, borderRadius: 8, maxWidth: 260 }}>
                  {Object.entries(instrument.tunings).map(([id, t]) => <option key={id} value={id}>{t.label}</option>)}
                </select>
              </label>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={caption}>What's in the file?</span>
              {Object.entries(SOURCES).map(([id, s]) => (
                <label key={id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer', fontSize: 13, color: 'var(--color-text)' }}>
                  <input type="radio" name="source" checked={source === id} onChange={() => setSource(id)} style={{ marginTop: 3 }} />
                  <span><strong>{s.label}</strong><br /><span style={{ fontSize: 12, color: 'var(--color-text-3)' }}>{s.hint}</span></span>
                </label>
              ))}
            </div>
            <div style={{ textAlign: 'center', padding: '1.5rem 1rem', border: '2px dashed var(--color-border)', borderRadius: 12 }}>
              <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--color-text-2)' }}>
                {source === 'isolated'
                  ? `Upload a recording of just the ${instrument.label.toLowerCase()} line you want to learn (an intro, riff or solo).`
                  : 'Upload the song with the part you want to learn (an intro, riff or solo).'}
              </p>
              <input type="file" accept="audio/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
            </div>
          </>
        )}

        {step === 'transcribing' && (
          <div style={{ textAlign: 'center', padding: '2rem 1rem' }}>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-2)' }}>Listening for notes… {Math.round(progress * 100)}%</p>
            <button onClick={handleCancel} style={{ ...pill(false), marginTop: 14 }}>Cancel</button>
          </div>
        )}

        {step === 'error' && (
          <div style={{ textAlign: 'center', padding: '1.5rem 1rem' }}>
            <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--color-danger-text)' }}>{errorMessage}</p>
            <button onClick={() => setStep('setup')} style={pill(false)}>Try again</button>
          </div>
        )}

        {step === 'view' && (
          <>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, minHeight: 40 }}>
              <span style={{ fontSize: 30, fontWeight: 700, color: 'var(--color-note)' }}>{current?.name ?? '—'}</span>
              {next && <span style={{ fontSize: 14, color: 'var(--color-note-next)' }}>next: {next.name}</span>}
              {current?.string !== undefined && (
                <span style={{ fontSize: 13, color: 'var(--color-text-3)' }}>{noteNames[current.string]} string, fret {current.fret}</span>
              )}
            </div>

            {instrument.kind === 'fretted'
              ? <Fretboard tuning={tuning} frets={instrument.frets} noteNames={noteNames} current={current} next={next} />
              : <Keyboard current={current} next={next} />}

            <TabStrip line={line} tuning={tuning} noteNames={noteNames} currentIdx={pos.current} nextIdx={pos.next} onSeek={seekTo} />

            <audio ref={audioRef} src={audioUrl} controls style={{ width: '100%' }} />

            <div style={row}>
              <span style={caption}>Speed</span>
              {SPEEDS.map((s) => <button key={s} style={pill(speed === s)} onClick={() => setSpeed(s)}>{s * 100}%</button>)}
              <span style={{ ...caption, marginLeft: 12 }}>Loop</span>
              <button style={pill(loop.a !== null)} onClick={() => setLoop((l) => ({ ...l, a: now() }))}>A {fmtTime(loop.a)}</button>
              <button style={pill(loop.b !== null)} onClick={() => setLoop((l) => ({ ...l, b: now() }))}>B {fmtTime(loop.b)}</button>
              {(loop.a !== null || loop.b !== null) && <button style={pill(false)} onClick={() => setLoop({ a: null, b: null })}>Clear</button>}
            </div>

            {source === 'isolated' && chordShare > CHORD_SHARE_WARNING && (
              <p style={{ margin: 0, fontSize: 12, color: 'var(--color-danger-text)', background: 'var(--color-danger-bg)', border: '1px solid var(--color-danger-border)', borderRadius: 8, padding: '8px 10px' }}>
                This file has a lot of notes played together (chords or other instruments), so the line may be inaccurate.
                If it's a full song, switch Source to "Full song".
              </p>
            )}

            <div style={row}>
              <span style={caption}>Source</span>
              {Object.entries(SOURCES).map(([id, s]) => (
                <button key={id} style={pill(source === id)} onClick={() => setSource(id)}>{s.label}</button>
              ))}
              {source === 'mix' && (
                <>
                  <span style={{ ...caption, marginLeft: 12 }}>Follow</span>
                  <button style={pill(follow === 'highest')} onClick={() => setFollow('highest')}>Top line</button>
                  <button style={pill(follow === 'lowest')} onClick={() => setFollow('lowest')}>Bottom line</button>
                </>
              )}
            </div>

            <div style={row}>
              <span style={caption}>Sensitivity</span>
              {[['more', 'More notes'], ['balanced', 'Balanced'], ['fewer', 'Fewer notes']].map(([k, l]) => (
                <button key={k} style={pill(sensitivity === k)} onClick={() => setSensitivity(k)}>{l}</button>
              ))}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, color: 'var(--color-text-3)' }}>
                Notes are what the audio contains; string choice is the most playable way to get those exact notes.
              </span>
              <button onClick={() => setStep('setup')} style={pill(false)}>Analyze another file</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```
Notes:
- Instrument and tuning are locked once a file is analyzed, because the transcription's frequency range depended on them. **Source**, **Follow** and **Sensitivity** re-run only `buildLine`, which is instant (both sources share one transcription).
- Bass is the default instrument because it's the user's main use case alongside guitar.

- [ ] **Step 2:** `npm run build` succeeds, with tfjs only in the worker chunk. **Commit**: `feat: learn-a-line modal with tab, speed and A–B loop`

---

## Task 7: (intentionally empty)

Earlier revisions put chord-shape suggestions here. **Do not reintroduce suggested or ideal shapes.** Every highlight must come from a transcribed note. Chord mode is in *Future work*.

---

## Task 8: Wire into `App.jsx`

- [ ] Add `import { InstrumentVisualizerModal } from './InstrumentVisualizerModal.jsx';` beside the `LiveChordTest` import.
- [ ] Add an `onOpenInstrumentViz` prop to `LibraryScreen`. Add a button right after "🎤 Live chord test", using the **same style object**, with `title="Upload a song, pick bass/guitar/keys, and see which notes to play and where"` and label `🎸 Learn a line`.
- [ ] In `App()`, add `const [instrumentVizOpen, setInstrumentVizOpen] = useState(false);`. Pass `onOpenInstrumentViz={() => setInstrumentVizOpen(true)}`, and render `{instrumentVizOpen && <InstrumentVisualizerModal onClose={() => setInstrumentVizOpen(false)} />}` after the LiveChordTest block.
- [ ] `npm test` and `npm run build` pass. **Commit**: `feat: open learn-a-line from the library`

---

## Task 9: Verify with real recordings, then tune

Use the preview tooling (`.claude/launch.json` → `npm run dev`). Use **real** recordings: the user's own clips, or short CC0 clips of a solo bass line, a guitar riff and a guitar solo. Ideally use one isolated recording and one full-band song of each.

- [ ] **Bass line, "Only my instrument":** the note names match what's played, octaves are correct (E1, not E2), no octave-ghost notes appear, and the tab is playable and stays in position.
- [ ] **Guitar or piano line, "Only my instrument":** a ringing earlier note never hides the new note, and the chords warning does **not** show for a single-note line.
- [ ] **Chords warning:** upload a strummed-chord clip or a full song with Source set to "Only my instrument". The warning appears, and switching Source to "Full song" works instantly.
- [ ] **Same clip, both sources:** on an isolated recording, compare the two sources. Isolated should be equal or better. If it isn't, tune `HARMONIC_INTERVALS`, `DOUBLE_STOP_WINDOW` or `CHORD_SHARE_WARNING` and update the tests.
- [ ] **Bass line, full song:** "Bottom line" still tracks the bass. Note how often the kick drum or low keys sneak in.
- [ ] **Guitar intro or riff:** the tab matches a known transcription of the same riff. Write down any wrong string choices; they're acceptable only when the pitch is identical.
- [ ] **Guitar solo in a full mix:** check whether "Top line" grabs vocals or keys instead. Try "Fewer notes". Record findings for the PR and limitations.
- [ ] **Practice tools:** 50% and 75% speed keep pitch, and highlights stay in sync. The A–B loop repeats cleanly. Clicking a tab column seeks there. The tab auto-scrolls with playback.
- [ ] **Source, Sensitivity and Follow** update instantly without re-transcribing. Follow is only visible for Full song.
- [ ] **Robustness:** a silent file gives the friendly error. Cancel mid-transcription returns to setup. Closing mid-transcription leaves no console errors. A 5-minute song finishes with visible progress. Record the wall time and backend.
- [ ] **Theming and width:** light and dark mode (`resize_window` with `colorScheme`). At 375 px wide, the fretboard, keyboard and tab scroll, and the modal doesn't overflow.
- [ ] **Regression:** "Import from Audio" in the editor still works (it uses a separate worker).
- [ ] If tuning changed any constant (thresholds, `minAmp` presets, fingering weights), update the tests and this plan to match. Then take a screenshot as proof and commit.

---

## Known limitations (put these in the PR description)

1. **Accuracy depends on transcription.** basic-pitch can miss quiet notes and add faint harmonics. The "Only my instrument" source removes harmonic ghosts and is the most accurate.
2. **Full song source:** "Top line" can follow **vocals** or keys, because they share the guitar's pitch range. "Bottom line" for bass is much more reliable.
3. **"Only my instrument" assumes one note at a time.** For double-stops, only the loudest note is kept. A real note exactly 12, 19 or 24 semitones above another note *struck at the same instant* (within 60 ms) and quieter is treated as an overtone and dropped.
4. **String choice:** the pitches are what's in the audio, but the same pitch can be played on several strings. The line is fingered the most playable way, which may differ from the original player's choice.
5. Bends, slides and vibrato show as their detected pitches; basic-pitch's pitch-bend output is not used yet. The tab is evenly spaced, with no rhythm or bar lines.
6. CPU fallback is slow: about 3 minutes for a 5-minute song.

## Future work (out of scope)

- **Stem separation** (e.g. Demucs or Open-Unmix as ONNX in the browser, or a server) to isolate the bass, guitar or vocals before transcription. This is the biggest accuracy win for full mixes, but it's heavy (tens of MB of model, slow on CPU).
- **Chord mode** (strummed parts). It was prototyped in planning and verified to produce `x32010` (open C), `8 10 10 9 8 8` (barre C), `x35553` (A-shape C), and `577655` → `577xxx` (hand continuity). The algorithm:
  1. Group notes whose onsets fall within 60 ms of each other.
  2. Per group, search each note's options exhaustively: one note per string, or drop the note.
  3. Score = `30·Σamp²(dropped) + 3·(re-fretted or released ringing notes) + 2·span + 1.5·|center − previousCenter| + 0.5·frettedCount`, with a maximum span of 4 frets.
  4. Cap each group at the 8 strongest notes (about 2 ms per group).
- Bend and slide markings from `pitchBends`. Rhythm-aware tab using detected tempo and bars (`detectTempo` already exists). Export to MIDI (`generateFileData`) or text tab.
- Live mic "play along" check: listen to the user playing and mark notes right or wrong, reusing the `LiveChordTest` infrastructure.
- Left-handed view, capo, custom tunings.
