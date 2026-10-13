// ─── Transcribed notes → one playable line ───────────────────
// Pure functions. Input notes: { midi, start, end, amp } (seconds), from
// transcription.js. Pipeline: cleanNotes → (isolated: suppressHarmonics →
// monophonize | full song: extractLine) → fingerLine.
import { midiToName, instrumentRange } from './instruments.js';
import { gateQuietNotes } from './loudness.js';

const MIN_DURATION = 0.06;
const HARMONIC_INTERVALS = [12, 19, 24]; // octave, octave+5th, two octaves
const ONSET_WINDOW = 0.06;   // "started together"
const DOUBLE_STOP_WINDOW = 0.03;
const LINE_STEP = 0.01;      // extraction sweep resolution (s)
const SHIFT_PENALTY = 3;     // moving the hand > 3 frets between two fretted notes
const POS_COST = 0.1;        // per fret: prefer lower positions
const STRING_COST = 0.15;    // per string crossed (a plucking-hand move: cheaper than a higher position)
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
 * The state also carries where the fretting hand is (the last fretted fret):
 * open strings don't move it, so open E → fret 12 → open E pays for the hand
 * living at the 12th instead of looking like two cheap open-string moves.
 * Notes must be within the instrument's range (cleanNotes guarantees it).
 * @returns {{string:number, fret:number}[]} one per note
 */
export function fingerLine(line, tuning, frets) {
  if (!line.length) return [];
  const cands = line.map((n) => tuning
    .map((open, string) => ({ string, fret: n.midi - open }))
    .filter((p) => p.fret >= 0 && p.fret <= frets));
  const posCost = (p) => p.fret * POS_COST;
  const handAfter = (p, hand) => (p.fret === 0 ? hand : p.fret);
  const move = (a, hand, b, gap) => {
    const strings = Math.abs(a.string - b.string) * STRING_COST;
    if (b.fret === 0 || hand === null) return strings;
    const d = Math.abs(b.fret - hand);
    return (d + (d > 3 ? SHIFT_PENALTY : 0)) * (gap > LONG_REST ? LONG_REST_SCALE : 1) + strings;
  };

  // One layer per note: `${candidate}|${hand}` → { k, hand, cost, back: previous layer key }
  const keep = (layer, k, hand, cost, back) => {
    const key = `${k}|${hand}`;
    const cur = layer.get(key);
    if (!cur || cost < cur.cost) layer.set(key, { k, hand, cost, back });
  };
  let layer = new Map();
  cands[0].forEach((p, k) => keep(layer, k, handAfter(p, null), posCost(p), null));
  const layers = [layer];
  for (let i = 1; i < line.length; i++) {
    const gap = line[i].start - line[i - 1].end;
    const next = new Map();
    for (const [prevKey, s] of layer) {
      const a = cands[i - 1][s.k];
      cands[i].forEach((b, k) => keep(next, k, handAfter(b, s.hand), s.cost + move(a, s.hand, b, gap) + posCost(b), prevKey));
    }
    layers.push(next);
    layer = next;
  }

  const out = new Array(line.length);
  let key = [...layer].reduce((best, e) => (e[1].cost < best[1].cost ? e : best))[0];
  for (let i = line.length - 1; i >= 0; i--) {
    const s = layers[i].get(key);
    out[i] = cands[i][s.k];
    key = s.back;
  }
  return out;
}

/**
 * Raw transcription → the line the view draws. Cheap; re-run on Source/Sensitivity/Follow change.
 * `loudness` + `gateDb` (optional) drop notes that start in near-silence, see loudness.js.
 * @param {{instrument, tuning, minAmp: number, source: 'isolated'|'mix', follow: 'lowest'|'highest', loudness?: object, gateDb?: number}} opts
 * @returns {{ line: object[], chordShare: number|null }} chordShare only for the isolated source
 */
export function buildLine(rawNotes, { instrument, tuning, minAmp, source, follow, loudness = null, gateDb = -36 }) {
  const cleaned = gateQuietNotes(cleanNotes(rawNotes, instrumentRange(instrument, tuning), { minAmp }), loudness, gateDb);
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
