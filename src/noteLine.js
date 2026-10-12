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
