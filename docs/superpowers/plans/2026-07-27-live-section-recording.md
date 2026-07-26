# Live Section Recording with Metronome Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user record chords live into an existing section by playing along to a metronome — each bar's chord is captured and written directly into that bar's cell as the metronome crosses into the next bar, with no separate preview/commit step.

**Architecture:** A sample-accurate metronome (`src/metronome.js`, Web Audio lookahead-scheduler pattern) drives bar boundaries. Live mic chroma sampling is extracted from the existing Live Chord Test diagnostic panel into a shared module (`src/liveAudioCapture.js`) so both consumers share one implementation. A new `src/LiveSectionRecorder.jsx` ties them together with a peak-hold-per-bar capture loop and writes chords directly into the song via a new `setBeatChord` callback, wired into `SectionBlock`'s header in `src/App.jsx` (no modal — the actual bar grid is visible and updates live underneath).

**Tech Stack:** React 18, Web Audio API (`AudioContext`, `AnalyserNode`, `OscillatorNode`), Meyda (already a dependency), Vitest.

**Spec:** `docs/superpowers/specs/2026-07-27-live-section-recording-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|-----------------|
| `src/liveAudioCapture.js` | **Create** | `openMicStream()`, `startChromaSampling(...)` — mic constraints + per-tick RMS/chroma sampling, shared by both live-mic consumers |
| `src/LiveChordTest.jsx` | **Modify** | Use `liveAudioCapture.js` instead of inlined mic/Meyda setup (pure refactor, no behavior change) |
| `src/audioChords.js` | **Modify** | Add `computeLiveWindowSize`, `LIVE_WINDOW_MAX`, `LIVE_WINDOW_MIN` |
| `src/audioChords.test.js` | **Modify** | Tests for `computeLiveWindowSize` |
| `src/metronome.js` | **Create** | `createMetronome(...)` — lookahead-scheduled click track, fires `onBeat`/`onBar` |
| `src/LiveSectionRecorder.jsx` | **Create** | Recording session: mic + metronome + peak-hold-per-bar capture, compact inline UI |
| `src/App.jsx` | **Modify** | Extract `setBeatChord`; add "🎙 Record live" button + `LiveSectionRecorder` swap to `SectionBlock`'s header; thread `bpm`/`setBeatChord` down through `EditorScreen` |

**Note on scope vs. spec:** the design spec didn't list `src/liveAudioCapture.js` explicitly, but its own Testing section already establishes that this mic/chroma-sampling logic isn't unit-testable and needs to exist somewhere — extracting it avoids duplicating that logic (and its subtle correctness details, like the disabled mic-processing constraints) between `LiveChordTest.jsx` and the new `LiveSectionRecorder.jsx`. Same reasoning, same precedent as the earlier `ChordPicker.jsx` extraction in this project.

---

## Task 1 — Extract `src/liveAudioCapture.js`, refactor `LiveChordTest.jsx` to use it

**Files:**
- Create: `src/liveAudioCapture.js`
- Modify: `src/LiveChordTest.jsx`

Pure refactor — no behavior change. `LiveChordTest.jsx`'s mic-constraints and per-tick RMS/chroma sampling logic is generic; both this diagnostic panel and the new `LiveSectionRecorder` need it.

- [ ] **Step 1: Create `src/liveAudioCapture.js`**

```js
// ─── Shared live-mic chroma sampling ───────────────────────────
// Mic constraints and the raw per-tick "read the analyser, compute RMS and
// chroma" mechanics are identical wherever this app listens to a live mic
// (the diagnostic Live Chord Test panel and live section recording both
// need it) — this is the one place that logic lives, so a future fix only
// has to happen once.
import Meyda from 'meyda';

const UPDATE_MS = 100; // ~10 readings/sec

/**
 * Requests mic access with processing disabled that would otherwise smear
 * or suppress sustained musical tone (echo cancellation, noise suppression,
 * auto-gain control are all tuned for speech, not music).
 * @returns {Promise<MediaStream>}
 */
export async function openMicStream() {
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
}

/**
 * Starts sampling a mic stream at ~10Hz, calling onSample with the raw RMS
 * level and chroma vector for each reading. The caller owns what to do with
 * each sample (silence gating, averaging, peak-holding, etc.) and owns
 * cleanup via the returned stop().
 * @param {{
 *   audioCtx: AudioContext,
 *   stream: MediaStream,
 *   windowSize: number,
 *   onSample: (sample: { rms: number, chroma: number[] }) => void,
 * }} opts
 * @returns {{ stop: () => void }}
 */
export function startChromaSampling({ audioCtx, stream, windowSize, onSample }) {
  const source = audioCtx.createMediaStreamSource(stream);
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = windowSize;
  source.connect(analyser);
  const timeData = new Float32Array(windowSize);

  Meyda.bufferSize = windowSize;
  Meyda.sampleRate = audioCtx.sampleRate;

  const intervalId = setInterval(() => {
    analyser.getFloatTimeDomainData(timeData);

    let sumSq = 0;
    for (let i = 0; i < timeData.length; i++) sumSq += timeData[i] * timeData[i];
    const rms = Math.sqrt(sumSq / timeData.length);

    const chroma = Meyda.extract('chroma', timeData);
    if (chroma) onSample({ rms, chroma });
  }, UPDATE_MS);

  return { stop: () => clearInterval(intervalId) };
}
```

- [ ] **Step 2: Update `src/LiveChordTest.jsx`'s imports**

Current imports (top of file):
```js
import { useState, useRef, useCallback, useEffect } from 'react';
import Meyda from 'meyda';
import { matchChordTemplatesRanked } from './audioChords.js';
import { ROOTS } from './chords.js';
```

Replace with:
```js
import { useState, useRef, useCallback, useEffect } from 'react';
import { openMicStream, startChromaSampling } from './liveAudioCapture.js';
import { matchChordTemplatesRanked } from './audioChords.js';
import { ROOTS } from './chords.js';
```

(The direct `meyda` import is no longer needed here — sampling now goes through `liveAudioCapture.js`.)

- [ ] **Step 3: Replace the ref declarations**

Current:
```js
  const audioCtxRef = useRef(null);
  const streamRef = useRef(null);
  const analyserRef = useRef(null);
  const timeDataRef = useRef(null);
  const intervalRef = useRef(null);
  const chromaHistoryRef = useRef([]);
  const peakConfidenceRef = useRef(-1); // best top-1 confidence seen in the current capture
```

Replace with:
```js
  const audioCtxRef = useRef(null);
  const streamRef = useRef(null);
  const samplerRef = useRef(null);
  const chromaHistoryRef = useRef([]);
  const peakConfidenceRef = useRef(-1); // best top-1 confidence seen in the current capture
```

- [ ] **Step 4: Replace `stop`**

Current:
```js
  const stop = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (audioCtxRef.current) {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
    chromaHistoryRef.current = [];
    peakConfidenceRef.current = -1;
    setListening(false);
    setLevel(0);
    setChroma(Array(12).fill(0));
    setMatches([]);
  }, []);
```

Replace with:
```js
  const stop = useCallback(() => {
    samplerRef.current?.stop();
    samplerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (audioCtxRef.current) {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
    chromaHistoryRef.current = [];
    peakConfidenceRef.current = -1;
    setListening(false);
    setLevel(0);
    setChroma(Array(12).fill(0));
    setMatches([]);
  }, []);
```

- [ ] **Step 5: Replace `start`**

Current:
```js
  const start = useCallback(async () => {
    setError('');
    let stream;
    try {
      // Disable the browser's default speech-call processing — echo
      // cancellation, noise suppression, and auto-gain control are all
      // tuned for voice and tend to smear or suppress sustained musical
      // tone, which flattens the chroma vector this needs to read clean.
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch {
      setError("Couldn't access the microphone. Check your browser's mic permission for this page.");
      return;
    }
    streamRef.current = stream;

    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    audioCtxRef.current = audioCtx;
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    source.connect(analyser);
    analyserRef.current = analyser;
    timeDataRef.current = new Float32Array(FFT_SIZE);

    Meyda.bufferSize = FFT_SIZE;
    Meyda.sampleRate = audioCtx.sampleRate;

    intervalRef.current = setInterval(() => {
      const timeData = timeDataRef.current;
      analyser.getFloatTimeDomainData(timeData);

      let sumSq = 0;
      for (let i = 0; i < timeData.length; i++) sumSq += timeData[i] * timeData[i];
      const rms = Math.sqrt(sumSq / timeData.length);
      setLevel(rms);

      // Below the silence threshold there's no real tone to read — matching
      // against noise floor just produces the flat, mediocre-confidence
      // readings this panel exists to catch, so don't even try. This is also
      // the end of a capture (if one was in progress): freeze whatever peak
      // was found (leave `matches` alone — don't clear it) and reset the
      // rolling history + peak tracker so the next sound starts a clean,
      // independent capture instead of blending into this one's tail.
      if (rms < SILENCE_RMS) {
        chromaHistoryRef.current = [];
        peakConfidenceRef.current = -1;
        setChroma(Array(12).fill(0));
        return;
      }

      const c = Meyda.extract('chroma', timeData);
      if (!c) return;

      // Rolling average over the last few frames (~AVERAGE_FRAMES * UPDATE_MS
      // ms) — smooths out single-frame noise for real signal; on genuine
      // noise it just averages toward the same noise floor, it can't
      // manufacture a peak that isn't there.
      const history = chromaHistoryRef.current;
      history.push(c);
      if (history.length > AVERAGE_FRAMES) history.shift();
      const avg = Array.from({ length: 12 }, (_, i) =>
        history.reduce((sum, frame) => sum + frame[i], 0) / history.length
      );
      setChroma(avg);

      // Only adopt this reading if it's more confident than the best one
      // seen so far in this capture — a sustained note/chord should only
      // ever sharpen into a clearer answer while held, never regress to a
      // worse one just because one frame happened to be noisier.
      const ranked = matchChordTemplatesRanked(avg, 3);
      if (ranked[0].confidence > peakConfidenceRef.current) {
        peakConfidenceRef.current = ranked[0].confidence;
        setMatches(ranked);
      }
    }, UPDATE_MS);

    setListening(true);
  }, []);
```

Replace with:
```js
  const start = useCallback(async () => {
    setError('');
    let stream;
    try {
      stream = await openMicStream();
    } catch {
      setError("Couldn't access the microphone. Check your browser's mic permission for this page.");
      return;
    }
    streamRef.current = stream;

    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    audioCtxRef.current = audioCtx;

    samplerRef.current = startChromaSampling({
      audioCtx,
      stream,
      windowSize: FFT_SIZE,
      onSample: ({ rms, chroma: c }) => {
        setLevel(rms);

        // Below the silence threshold there's no real tone to read — matching
        // against noise floor just produces the flat, mediocre-confidence
        // readings this panel exists to catch, so don't even try. This is also
        // the end of a capture (if one was in progress): freeze whatever peak
        // was found (leave `matches` alone — don't clear it) and reset the
        // rolling history + peak tracker so the next sound starts a clean,
        // independent capture instead of blending into this one's tail.
        if (rms < SILENCE_RMS) {
          chromaHistoryRef.current = [];
          peakConfidenceRef.current = -1;
          setChroma(Array(12).fill(0));
          return;
        }

        // Rolling average over the last few frames (~AVERAGE_FRAMES * UPDATE_MS
        // ms) — smooths out single-frame noise for real signal; on genuine
        // noise it just averages toward the same noise floor, it can't
        // manufacture a peak that isn't there.
        const history = chromaHistoryRef.current;
        history.push(c);
        if (history.length > AVERAGE_FRAMES) history.shift();
        const avg = Array.from({ length: 12 }, (_, i) =>
          history.reduce((sum, frame) => sum + frame[i], 0) / history.length
        );
        setChroma(avg);

        // Only adopt this reading if it's more confident than the best one
        // seen so far in this capture — a sustained note/chord should only
        // ever sharpen into a clearer answer while held, never regress to a
        // worse one just because one frame happened to be noisier.
        const ranked = matchChordTemplatesRanked(avg, 3);
        if (ranked[0].confidence > peakConfidenceRef.current) {
          peakConfidenceRef.current = ranked[0].confidence;
          setMatches(ranked);
        }
      },
    });

    setListening(true);
  }, []);
```

- [ ] **Step 6: Verify the app builds**

```bash
npm run build
```

Expected: no errors.

- [ ] **Step 7: Run the full test suite**

```bash
npm test
```

Expected: all existing tests still pass (this was a pure refactor — no logic changed, same 38 tests).

- [ ] **Step 8: Verify manually**

```bash
npm run dev
```

Open the app, click "🎤 Live chord test" from the library screen, confirm the panel still opens and its UI renders correctly (Start listening button, chroma bars, etc.) — same as before this refactor. If a browser/mic isn't available to actually test capture, that's fine; this step is confirming nothing broke structurally.

- [ ] **Step 9: Commit**

```bash
git add src/liveAudioCapture.js src/LiveChordTest.jsx
git commit -m "refactor: extract shared live-mic chroma sampling into liveAudioCapture.js"
```

---

## Task 2 — `computeLiveWindowSize` in `audioChords.js`

**Files:**
- Modify: `src/audioChords.js`
- Modify: `src/audioChords.test.js`

The 16384-sample analysis window that resolves close low-register semitones (e.g. guitar's open E2/F2, ~5Hz apart) takes ~370ms per reading. At fast tempos a single bar can be shorter than that. This computes the largest usable window for a given tempo instead of a fixed size.

- [ ] **Step 1: Write the failing tests**

Append to `src/audioChords.test.js`:
```js
import { computeLiveWindowSize, LIVE_WINDOW_MAX, LIVE_WINDOW_MIN } from './audioChords.js'

describe('computeLiveWindowSize', () => {
  it('returns the full max window at a normal tempo in 4/4', () => {
    expect(computeLiveWindowSize(120, '4/4', 44100)).toBe(LIVE_WINDOW_MAX)
  })

  it('shrinks the window at a very fast tempo', () => {
    const result = computeLiveWindowSize(600, '4/4', 44100)
    expect(result).toBe(8192)
    expect(result).toBeLessThan(LIVE_WINDOW_MAX)
  })

  it('falls back to LIVE_WINDOW_MIN at a tempo just fast enough to need it, without returning null', () => {
    expect(computeLiveWindowSize(3000, '4/4', 44100)).toBe(LIVE_WINDOW_MIN)
  })

  it('returns null when even the minimum window does not fit', () => {
    expect(computeLiveWindowSize(3200, '4/4', 44100)).toBeNull()
  })
})
```

- [ ] **Step 2: Run to confirm the new tests fail**

```bash
npm test
```

Expected: `computeLiveWindowSize` suite fails with an import error; earlier suites still pass.

- [ ] **Step 3: Implement `computeLiveWindowSize` in `src/audioChords.js`**

Append at the end of `src/audioChords.js` (after `extractChromaFrames`):
```js
// ─── Live capture: dynamic analysis window sizing ─────────────
// The wide 16384-sample window that resolves close low-register semitones
// (e.g. guitar's open E2/F2) takes ~370ms per reading at typical sample
// rates. At fast tempos a single bar can be shorter than that. Rather than
// a fixed size, live bar-by-bar capture computes the largest window that
// still fits comfortably inside one bar.
export const LIVE_WINDOW_MAX = 16384;
export const LIVE_WINDOW_MIN = 2048; // matches the file-import WINDOW_SIZE floor

/**
 * Largest power-of-2 analysis window (samples) that fits within 60% of one
 * bar's duration at the given tempo, capped at LIVE_WINDOW_MAX and floored
 * at LIVE_WINDOW_MIN. Returns null if even the floor doesn't fit — the
 * tempo is too fast for reliable live capture.
 * @param {number} bpm
 * @param {string} timeSig e.g. "4/4"
 * @param {number} sampleRate
 * @returns {number|null}
 */
export function computeLiveWindowSize(bpm, timeSig, sampleRate) {
  const nb = beatsPerBar(timeSig);
  const barDurationMs = (60000 / bpm) * nb;
  const budgetMs = barDurationMs * 0.6;
  const maxSamplesForBudget = Math.floor((budgetMs / 1000) * sampleRate);

  let windowSize = LIVE_WINDOW_MAX;
  while (windowSize > LIVE_WINDOW_MIN && windowSize > maxSamplesForBudget) {
    windowSize /= 2;
  }

  if (windowSize > maxSamplesForBudget) return null; // even the floor doesn't fit
  return windowSize;
}
```

- [ ] **Step 4: Run to confirm all tests pass**

```bash
npm test
```

Expected: all tests pass (42 total: 38 prior + 4 new).

- [ ] **Step 5: Commit**

```bash
git add src/audioChords.js src/audioChords.test.js
git commit -m "feat: add computeLiveWindowSize for tempo-aware live analysis windows"
```

---

## Task 3 — `src/metronome.js`

**Files:**
- Create: `src/metronome.js`

A sample-accurate click track using the standard Web Audio "lookahead scheduler" pattern — a short-interval JS timer only decides which clicks need scheduling soon; the clicks themselves are scheduled against `AudioContext.currentTime`, immune to JS timer jitter. Not unit-tested — this is real-time Web Audio scheduling, same treatment as `decodeAudioFile`/`detectTempo`/`extractChromaFrames`. Verified manually in Task 7.

- [ ] **Step 1: Create `src/metronome.js`**

```js
// ─── Metronome: sample-accurate click track ────────────────────
// setInterval alone drifts audibly over a multi-bar recording (ordinary JS
// timer jitter is easily tens of milliseconds under real-world load). This
// uses the standard Web Audio "lookahead scheduler" pattern instead: a
// short-interval timer only decides which clicks need scheduling soon; the
// clicks themselves are scheduled against AudioContext.currentTime, which
// is sample-accurate and immune to JS timer jitter.
import { beatsPerBar } from './printUtils.js';

const LOOKAHEAD_MS = 25;      // how often the scheduler timer checks for upcoming clicks
const SCHEDULE_AHEAD_S = 0.1; // how far ahead of "now" to schedule clicks

/**
 * @param {{
 *   audioCtx: AudioContext,
 *   bpm: number,
 *   timeSig: string,
 *   onBeat?: (beatIndexInBar: number, barIndex: number) => void,
 *   onBar?: (barIndex: number) => void,
 * }} opts
 * @returns {{ start: () => void, stop: () => void }}
 */
export function createMetronome({ audioCtx, bpm, timeSig, onBeat, onBar }) {
  const nb = beatsPerBar(timeSig);
  const secondsPerBeat = 60 / bpm;

  let nextBeatTime = 0;
  let beatNumber = 0;
  let barNumber = 0;
  let timerId = null;

  function scheduleClick(time, isDownbeat) {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.frequency.value = isDownbeat ? 1000 : 800;
    gain.gain.setValueAtTime(0.3, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(time);
    osc.stop(time + 0.05);
  }

  function scheduler() {
    while (nextBeatTime < audioCtx.currentTime + SCHEDULE_AHEAD_S) {
      scheduleClick(nextBeatTime, beatNumber === 0);

      const firedBeat = beatNumber;
      const firedBar = barNumber;
      const firedTime = nextBeatTime;
      const delayMs = Math.max(0, (firedTime - audioCtx.currentTime) * 1000);
      setTimeout(() => {
        onBeat?.(firedBeat, firedBar);
        if (firedBeat === 0) onBar?.(firedBar);
      }, delayMs);

      nextBeatTime += secondsPerBeat;
      beatNumber++;
      if (beatNumber >= nb) {
        beatNumber = 0;
        barNumber++;
      }
    }
  }

  return {
    start() {
      beatNumber = 0;
      barNumber = 0;
      nextBeatTime = audioCtx.currentTime + 0.1;
      scheduler();
      timerId = setInterval(scheduler, LOOKAHEAD_MS);
    },
    stop() {
      if (timerId) clearInterval(timerId);
      timerId = null;
    },
  };
}
```

**Key contract for the next task:** `onBar(barIndex)` fires exactly when bar `barIndex` *starts* (equivalently: bar `barIndex - 1` has just ended, for `barIndex >= 1`). `onBar(0)` fires once, right at the very start, before anything has been played.

- [ ] **Step 2: Verify the app builds**

```bash
npm run build
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/metronome.js
git commit -m "feat: add sample-accurate metronome via lookahead scheduler"
```

---

## Task 4 — Extract `setBeatChord` in `src/App.jsx`

**Files:**
- Modify: `src/App.jsx`

Pure refactor — no behavior change. Pulls the chord-writing logic out of the `ChordPicker`-driven `handleSetChord` into a plain, directly-callable function, so `LiveSectionRecorder` (Task 5/6) can write chords without going through the picker UI.

- [ ] **Step 1: Replace `handleSetChord`**

Find in `src/App.jsx` (inside the `App` component, after `openPicker`):
```js
  const handleSetChord = useCallback((chord) => {
    if (!picker) return;
    const { sectionId, barIdx, beatIdx } = picker;
    patchCurrent((s) => ({
      ...s,
      sections: s.sections.map((sec) => {
        if (sec.id !== sectionId) return sec;
        const k = `${barIdx}-${beatIdx}`;
        const chords = { ...sec.chords };
        if (chord === null) delete chords[k];
        else chords[k] = chord;
        return { ...sec, chords };
      }),
    }));
    setPicker(null);
  }, [picker, patchCurrent]);
```

Replace with:
```js
  const setBeatChord = useCallback((sectionId, barIdx, beatIdx, chord) => {
    patchCurrent((s) => ({
      ...s,
      sections: s.sections.map((sec) => {
        if (sec.id !== sectionId) return sec;
        const k = `${barIdx}-${beatIdx}`;
        const chords = { ...sec.chords };
        if (chord === null) delete chords[k];
        else chords[k] = chord;
        return { ...sec, chords };
      }),
    }));
  }, [patchCurrent]);

  const handleSetChord = useCallback((chord) => {
    if (!picker) return;
    setBeatChord(picker.sectionId, picker.barIdx, picker.beatIdx, chord);
    setPicker(null);
  }, [picker, setBeatChord]);
```

- [ ] **Step 2: Verify the app builds**

```bash
npm run build
```

Expected: no errors.

- [ ] **Step 3: Run the full test suite**

```bash
npm test
```

Expected: all 42 tests still pass (this task touches no tested logic).

- [ ] **Step 4: Verify manually**

```bash
npm run dev
```

Open a song, click a beat cell, confirm `ChordPicker` still opens and setting/clearing a chord still works exactly as before — confirms `handleSetChord` → `setBeatChord` delegation didn't change behavior.

- [ ] **Step 5: Commit**

```bash
git add src/App.jsx
git commit -m "refactor: extract setBeatChord from handleSetChord"
```

---

## Task 5 — `src/LiveSectionRecorder.jsx`

**Files:**
- Create: `src/LiveSectionRecorder.jsx`

The recording session itself: requests the mic, runs a 1-bar count-in, then on each bar boundary locks in whatever chord had the highest confidence during the bar that just ended and writes it via `onSetChord`. Not unit-tested (mic/Web-Audio-dependent orchestration, same treatment as `AudioImportModal`) — verified manually in Task 7.

- [ ] **Step 1: Create `src/LiveSectionRecorder.jsx`**

```jsx
import { useState, useRef, useCallback, useEffect } from 'react';
import { openMicStream, startChromaSampling } from './liveAudioCapture.js';
import { createMetronome } from './metronome.js';
import { matchChordTemplatesRanked, computeLiveWindowSize } from './audioChords.js';

const SILENCE_RMS = 0.01;

/**
 * Inline recording control meant to replace a SectionBlock's header actions
 * while active (see Task 6). Runs a metronome, listens to the mic, and
 * writes one chord per bar directly into the section as each bar completes
 * — no separate preview/commit step, since corrections use the normal
 * click-a-cell ChordPicker flow already available on the grid underneath.
 *
 * Bar-numbering contract with the metronome: metronome bar 0 is a 1-bar,
 * click-only count-in with no capture; metronome bar (k+1) is section bar
 * k. onBar(m) fires when metronome bar m starts, i.e. bar (m-1) just ended
 * — so at onBar(m) for m>=2, section bar (m-2) just finished and should be
 * locked in.
 *
 * @param {{
 *   section: { bars: number },
 *   bpm: number,
 *   timeSig: string,
 *   onSetChord: (barIdx: number, chord: {root:string,qual:string,bass:string}) => void,
 *   onDone: () => void,
 * }} props
 */
export function LiveSectionRecorder({ section, bpm, timeSig, onSetChord, onDone }) {
  const [phase, setPhase] = useState('starting'); // 'starting' | 'countIn' | 'recording' | 'error'
  const [currentBar, setCurrentBar] = useState(0);
  const [error, setError] = useState('');

  const sectionBars = section.bars; // primitive — stays stable across chord-only re-renders

  // Refs so the setup effect below doesn't need onSetChord/onDone in its
  // dependency array — those are recreated by the parent on every render
  // (including every render triggered by a chord we just wrote), and
  // including them would tear down and restart the mic/metronome every bar.
  const onSetChordRef = useRef(onSetChord);
  onSetChordRef.current = onSetChord;
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const audioCtxRef = useRef(null);
  const streamRef = useRef(null);
  const samplerRef = useRef(null);
  const metronomeRef = useRef(null);
  const peakRef = useRef(null); // { root, qual, confidence } | null — best match in the current bar

  const stopAll = useCallback(() => {
    metronomeRef.current?.stop();
    metronomeRef.current = null;
    samplerRef.current?.stop();
    samplerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (audioCtxRef.current) {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      let stream;
      try {
        stream = await openMicStream();
      } catch {
        if (!cancelled) {
          setError("Couldn't access the microphone. Check your browser's mic permission for this page.");
          setPhase('error');
        }
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;

      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      audioCtxRef.current = audioCtx;

      const windowSize = computeLiveWindowSize(bpm, timeSig, audioCtx.sampleRate);
      if (windowSize === null) {
        setError(`${bpm} BPM is too fast for reliable live capture. Try a slower tempo.`);
        setPhase('error');
        stopAll();
        return;
      }

      samplerRef.current = startChromaSampling({
        audioCtx,
        stream,
        windowSize,
        onSample: ({ rms, chroma }) => {
          if (rms < SILENCE_RMS) return; // no real signal this tick — leave the current peak as-is
          const top = matchChordTemplatesRanked(chroma, 1)[0];
          if (!peakRef.current || top.confidence > peakRef.current.confidence) {
            peakRef.current = top;
          }
        },
      });

      metronomeRef.current = createMetronome({
        audioCtx,
        bpm,
        timeSig,
        onBar: (metronomeBar) => {
          if (cancelled) return;

          if (metronomeBar === 0) {
            setPhase('countIn');
            peakRef.current = null; // ignore anything played during count-in
            return;
          }

          setPhase('recording');
          const finishedSectionBar = metronomeBar - 2;
          if (finishedSectionBar >= 0 && peakRef.current) {
            onSetChordRef.current(finishedSectionBar, {
              root: peakRef.current.root,
              qual: peakRef.current.qual,
              bass: '',
            });
          }
          peakRef.current = null; // always start the next bar's capture fresh

          const nextSectionBar = metronomeBar - 1;
          if (nextSectionBar >= sectionBars) {
            stopAll();
            onDoneRef.current();
            return;
          }
          setCurrentBar(nextSectionBar);
        },
      });

      metronomeRef.current.start();
    })();

    return () => {
      cancelled = true;
      stopAll();
    };
  }, [bpm, timeSig, sectionBars, stopAll]);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      {phase === 'error' ? (
        <span style={{ fontSize: 11, color: 'var(--color-danger-text)' }}>{error}</span>
      ) : phase === 'countIn' ? (
        <span style={{ fontSize: 11, color: 'var(--color-text-2)' }}>
          Count-in… get ready (headphones recommended)
        </span>
      ) : phase === 'recording' ? (
        <span style={{ fontSize: 11, color: 'var(--color-text-2)' }}>
          🔴 Bar {Math.min(currentBar + 1, sectionBars)} of {sectionBars}
        </span>
      ) : (
        <span style={{ fontSize: 11, color: 'var(--color-text-2)' }}>Starting…</span>
      )}
      <button
        onClick={() => { stopAll(); onDoneRef.current(); }}
        style={{
          padding: '4px 10px', borderRadius: 6,
          border: '1px solid var(--color-border-strong)',
          background: 'transparent', color: 'var(--color-text-2)',
          fontSize: 11, cursor: 'pointer',
        }}
      >{phase === 'error' ? 'Dismiss' : '■ Stop'}</button>
    </div>
  );
}
```

- [ ] **Step 2: Verify the app builds**

```bash
npm run build
```

Expected: no errors. (This component isn't imported anywhere yet — that's Task 6 — so this only confirms the file itself is syntactically valid and its imports resolve.)

- [ ] **Step 3: Commit**

```bash
git add src/LiveSectionRecorder.jsx
git commit -m "feat: add LiveSectionRecorder — metronome-synced per-bar chord capture"
```

---

## Task 6 — Wire into `SectionBlock` / `EditorScreen`

**Files:**
- Modify: `src/App.jsx`

- [ ] **Step 1: Add the import**

Add to the top of `src/App.jsx`, alongside the other component imports:
```js
import { LiveSectionRecorder } from './LiveSectionRecorder.jsx';
```

- [ ] **Step 2: Update `SectionBlock`'s signature and add recording state**

Find:
```js
function SectionBlock({ section, timeSig, onUpdate, onRemove, onDuplicate, onBeatClick }) {
  const nb = beatsPerBar(timeSig);
  const [bg, accent, textC] = SEC_COLORS[section.type] || ["#F1EFE8","#5F5E5A","#2C2C2A"];
```

Replace with:
```js
function SectionBlock({ section, timeSig, bpm, onUpdate, onRemove, onDuplicate, onBeatClick, onSetChord }) {
  const [recording, setRecording] = useState(false);
  const nb = beatsPerBar(timeSig);
  const [bg, accent, textC] = SEC_COLORS[section.type] || ["#F1EFE8","#5F5E5A","#2C2C2A"];
```

- [ ] **Step 3: Swap the header's right-hand controls when recording**

Find this block (the bars count/±, Duplicate, and Remove buttons, right after the `<div style={{ flex: 1 }} />` spacer):
```jsx
        <div style={{ flex: 1 }} />

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 11, color: textC, opacity: 0.8, whiteSpace: "nowrap" }}>
            {section.bars} bar{section.bars !== 1 ? "s" : ""}
          </span>
          {[["−", () => onUpdate("bars", Math.max(1, section.bars - 1))],
            ["+", () => onUpdate("bars", section.bars + 1)]
          ].map(([lbl, fn]) => (
            <button key={lbl} onClick={fn} style={{
              width: 22, height: 22, borderRadius: 4,
              border: `1px solid ${accent}70`,
              background: "transparent", color: textC,
              fontSize: 15, cursor: "pointer", lineHeight: 1,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>{lbl}</button>
          ))}
        </div>

        <button onClick={onDuplicate} title="Duplicate section" style={{
          width: 22, height: 22, borderRadius: 4,
          border: `1px solid ${accent}70`,
          background: "transparent", color: textC,
          fontSize: 11, cursor: "pointer", opacity: 0.75,
        }}>⧉</button>

        <button onClick={onRemove} title="Remove section" style={{
          width: 22, height: 22, borderRadius: 4,
          border: `1px solid ${accent}70`,
          background: "transparent", color: textC,
          fontSize: 18, cursor: "pointer", opacity: 0.65, lineHeight: 1,
        }}>×</button>
      </div>
```

Replace with:
```jsx
        <div style={{ flex: 1 }} />

        {recording ? (
          <LiveSectionRecorder
            section={section}
            bpm={bpm}
            timeSig={timeSig}
            onSetChord={onSetChord}
            onDone={() => setRecording(false)}
          />
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 11, color: textC, opacity: 0.8, whiteSpace: "nowrap" }}>
                {section.bars} bar{section.bars !== 1 ? "s" : ""}
              </span>
              {[["−", () => onUpdate("bars", Math.max(1, section.bars - 1))],
                ["+", () => onUpdate("bars", section.bars + 1)]
              ].map(([lbl, fn]) => (
                <button key={lbl} onClick={fn} style={{
                  width: 22, height: 22, borderRadius: 4,
                  border: `1px solid ${accent}70`,
                  background: "transparent", color: textC,
                  fontSize: 15, cursor: "pointer", lineHeight: 1,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>{lbl}</button>
              ))}
            </div>

            <button onClick={() => setRecording(true)} title="Record live from mic" style={{
              width: 22, height: 22, borderRadius: 4,
              border: `1px solid ${accent}70`,
              background: "transparent", color: textC,
              fontSize: 11, cursor: "pointer", opacity: 0.75,
            }}>🎙</button>

            <button onClick={onDuplicate} title="Duplicate section" style={{
              width: 22, height: 22, borderRadius: 4,
              border: `1px solid ${accent}70`,
              background: "transparent", color: textC,
              fontSize: 11, cursor: "pointer", opacity: 0.75,
            }}>⧉</button>

            <button onClick={onRemove} title="Remove section" style={{
              width: 22, height: 22, borderRadius: 4,
              border: `1px solid ${accent}70`,
              background: "transparent", color: textC,
              fontSize: 18, cursor: "pointer", opacity: 0.65, lineHeight: 1,
            }}>×</button>
          </>
        )}
      </div>
```

- [ ] **Step 4: Update `EditorScreen`'s signature to accept `setBeatChord`**

Find:
```js
function EditorScreen({ song, sections, addSection, removeSection, duplicateSection, updateSection, openPicker, onTranspose, onBackToSetup, onBackToLibrary, onSaveToCloud, cloudStatus, onOpenAudioImport }) {
```

Replace with:
```js
function EditorScreen({ song, sections, addSection, removeSection, duplicateSection, updateSection, openPicker, onTranspose, onBackToSetup, onBackToLibrary, onSaveToCloud, cloudStatus, onOpenAudioImport, setBeatChord }) {
```

- [ ] **Step 5: Pass `bpm` and `onSetChord` into `SectionBlock`**

Find:
```jsx
        sections.map((sec) => (
          <SectionBlock
            key={sec.id}
            section={sec}
            timeSig={song.timeSig}
            onUpdate={(k, v) => updateSection(sec.id, k, v)}
            onRemove={() => removeSection(sec.id)}
            onDuplicate={() => duplicateSection(sec.id)}
            onBeatClick={openPicker}
          />
        ))
```

Replace with:
```jsx
        sections.map((sec) => (
          <SectionBlock
            key={sec.id}
            section={sec}
            timeSig={song.timeSig}
            bpm={song.bpm}
            onUpdate={(k, v) => updateSection(sec.id, k, v)}
            onRemove={() => removeSection(sec.id)}
            onDuplicate={() => duplicateSection(sec.id)}
            onBeatClick={openPicker}
            onSetChord={(barIdx, chord) => setBeatChord(sec.id, barIdx, 0, chord)}
          />
        ))
```

- [ ] **Step 6: Pass `setBeatChord` from `App` into `EditorScreen`**

Find:
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

Replace with:
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
          setBeatChord={setBeatChord}
        />
      )}
```

- [ ] **Step 7: Verify the app builds**

```bash
npm run build
```

Expected: no errors.

- [ ] **Step 8: Verify manually**

```bash
npm run dev
```

Open a song with at least one section. Confirm:
- A "🎙" button now appears in each section's header, next to Duplicate/Remove.
- Clicking it swaps the bars/Duplicate/Remove controls for the recording status line and a Stop button (the bar grid underneath stays visible and unchanged).
- Clicking Stop (or, if mic permission is denied/unavailable in your environment, waiting for the error state) returns the header to its normal controls.

- [ ] **Step 9: Commit**

```bash
git add src/App.jsx
git commit -m "feat: wire live section recording into SectionBlock"
```

---

## Task 7 — End-to-end verification

- [ ] **Step 1: Run the full test suite**

```bash
npm test
```

Expected: all tests pass, including the 4 new `computeLiveWindowSize` tests (42 total).

- [ ] **Step 2: Run a production build**

```bash
npm run build
```

Expected: no errors, `dist/` generated.

- [ ] **Step 3: Manual flow — mic permission denied path**

```bash
npm run dev
```

Open a song, click 🎙 on a section. If your browser/environment blocks or denies mic access, confirm the header shows the "Couldn't access the microphone…" error with a "Dismiss" button, and clicking Dismiss returns the header to normal (no section data was touched). This is a fully exercisable path even without real mic access.

- [ ] **Step 4: Manual flow — happy path (requires a real microphone)**

With mic access granted:
- Click 🎙 on a section with a few bars. Confirm you see "Count-in… get ready" while the metronome clicks for one bar.
- Confirm it transitions to "🔴 Bar 1 of N" and the metronome keeps clicking on every beat.
- Play (or hum/sing) a distinct, clear chord for each bar. Confirm that as each bar completes, that bar's cell in the grid below updates with a chord — you should see this happen live, bar by bar, without needing to stop recording first.
- Confirm it auto-stops (header returns to normal controls) right after the last bar's chord is written — no extra count value, no attempt to record a bar beyond the section's length.
- Click a filled-in cell afterward and confirm the normal `ChordPicker` opens and lets you correct it if something was misdetected.
- Start another recording and click **Stop** partway through — confirm it stops immediately, whatever bars were already written stay written, and no further bars are touched.

- [ ] **Step 5: Manual flow — tempo-too-fast path**

Create or edit a song with an extremely high BPM (e.g. 999) and a short time signature, then try recording. Confirm you get the "BPM is too fast for reliable live capture" message immediately (no metronome click, no mic prompt side effects lingering) rather than a broken/garbled recording attempt.

- [ ] **Step 6: Final commit if any cleanup was needed**

```bash
git add -p
git commit -m "chore: post-verification cleanup for live section recording"
```

---

## Self-Review Checklist

- ✅ **Spec coverage:** metronome (Task 3), dynamic window sizing (Task 2), per-bar peak-hold capture reusing existing detection (Task 5), inline non-modal UI in `SectionBlock`'s header (Task 6), `setBeatChord` data-flow extraction (Task 4), count-in (Task 5's bar-numbering contract), auto-overwrite/auto-stop (Task 5), error handling for mic permission/tempo-too-fast/unmount cleanup (Task 5, verified Task 7), shared mic-capture module to avoid duplicating already-validated logic (Task 1).
- ✅ **No TBD/TODO:** every step has complete code.
- ✅ **Type consistency:** `onSetChord(barIdx, chord)` signature is identical between `SectionBlock`'s prop (Task 6), what it passes to `LiveSectionRecorder` (Task 5/6), and what `EditorScreen` binds it to (`setBeatChord(sec.id, barIdx, 0, chord)`, Task 6) — all agree beat is always `0` for live-recorded bars, matching the design's "one chord per bar" decision. `computeLiveWindowSize`'s return contract (`number | null`) is used consistently in Task 5 (`windowSize === null` check). The metronome's `onBar` bar-numbering contract (documented in Task 3, consumed in Task 5) is traced through a full worked example in Task 5's code comments to avoid an off-by-one error between the count-in bar and the first real section bar.
- ✅ **Import chain:** `beatsPerBar` reused from `printUtils.js` (not duplicated) in both `audioChords.js` and `metronome.js`. `liveAudioCapture.js` (Task 1) precedes its use in both the `LiveChordTest.jsx` refactor (Task 1) and `LiveSectionRecorder.jsx` (Task 5), avoiding logic duplication between the two live-mic consumers.
- ✅ **Stale-closure correctness:** `LiveSectionRecorder`'s setup effect deliberately excludes `onSetChord`/`onDone`/the whole `section` object from its dependency array (using latest-value refs instead) — including them would restart the entire mic/metronome session on every single bar written, since those callbacks are recreated by the parent on every re-render. This is called out explicitly in Task 5's code comments so a future editor doesn't "fix" it by adding them back.
- ✅ **No new files beyond the file map:** `src/liveAudioCapture.js`, `src/metronome.js`, `src/LiveSectionRecorder.jsx` — all listed in the File Map, with `liveAudioCapture.js`'s addition beyond the spec's literal file list explicitly justified there (same precedent as the earlier `ChordPicker.jsx` extraction).
