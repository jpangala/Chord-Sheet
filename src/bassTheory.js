// ─── Bass scales, arpeggios and licks → a playable line ──────
// Pure functions. Everything is written as steps relative to the key root
// ({ iv: semitones, beats } or { rest: true, beats }) so it transposes to any
// key. Variations (SCALE_PATTERNS, ARPEGGIO_PATTERNS, LICK_VARIATIONS) reorder
// or re-time the same notes. buildExercise turns steps into the same note shape Learn a line draws
// ({ midi, name, start, end, string, fret }), with start/end in beats (4/4).
import { midiToName, pitchClass } from './instruments.js';
import { fingerLine } from './noteLine.js';

export const DEGREES = ['R', 'b2', '2', 'b3', '3', '4', 'b5', '5', 'b6', '6', 'b7', '7'];

export const SCALES = [
  { id: 'major', label: 'Major', ivs: [0, 2, 4, 5, 7, 9, 11] },
  { id: 'minor', label: 'Natural minor', ivs: [0, 2, 3, 5, 7, 8, 10] },
  { id: 'majorPent', label: 'Major pentatonic', ivs: [0, 2, 4, 7, 9] },
  { id: 'minorPent', label: 'Minor pentatonic', ivs: [0, 3, 5, 7, 10] },
  { id: 'blues', label: 'Blues', ivs: [0, 3, 5, 6, 7, 10] },
  { id: 'dorian', label: 'Dorian', ivs: [0, 2, 3, 5, 7, 9, 10] },
  { id: 'mixolydian', label: 'Mixolydian', ivs: [0, 2, 4, 5, 7, 9, 10] },
  { id: 'phrygian', label: 'Phrygian', ivs: [0, 1, 3, 5, 7, 8, 10] },
  { id: 'lydian', label: 'Lydian', ivs: [0, 2, 4, 6, 7, 9, 11] },
  { id: 'harmonicMinor', label: 'Harmonic minor', ivs: [0, 2, 3, 5, 7, 8, 11] },
];

export const ARPEGGIOS = [
  { id: 'maj', label: 'Major', ivs: [0, 4, 7] },
  { id: 'min', label: 'Minor', ivs: [0, 3, 7] },
  { id: 'maj7', label: 'maj7', ivs: [0, 4, 7, 11] },
  { id: 'm7', label: 'm7', ivs: [0, 3, 7, 10] },
  { id: 'dom7', label: '7', ivs: [0, 4, 7, 10] },
  { id: 'm7b5', label: 'm7b5', ivs: [0, 3, 6, 10] },
  { id: 'dim7', label: 'dim7', ivs: [0, 3, 6, 9] },
];

const BOOGIE_BAR = [0, 4, 7, 9, 10, 9, 7, 4];
const TWELVE_BAR = [0, 0, 0, 0, 5, 5, 0, 0, 7, 5, 0, 7]; // I I I I IV IV I I V IV I V

// Steps: "interval/beats", "r/beats" for a rest, "|" between bars (ignored).
export const LICKS = [
  { id: 'rootFifthOctave', label: 'Root, fifth, octave', style: 'Groove, beginner',
    steps: '0/1 7/1 12/1 7/1 | 0/1 7/1 12/0.5 10/0.5 7/1' },
  { id: 'minorPentRiff', label: 'Minor pentatonic riff', style: 'Rock',
    steps: '0/0.75 0/0.25 3/0.5 5/0.5 7/1 5/0.5 3/0.5 | 0/0.5 -2/0.5 0/1 r/2' },
  { id: 'chromaticApproach', label: 'Chromatic approach (I IV V I)', style: 'Motown-style',
    steps: '0/1 4/1 7/1 6/1 | 5/1 9/1 12/1 6/1 | 7/1 11/1 14/1 1/1 | 0/2 r/2' },
  { id: 'funkOctaves', label: 'Funk octaves', style: 'Funk, 16ths',
    steps: '0/0.25 r/0.25 12/0.25 0/0.25 r/0.5 0/0.25 12/0.25 r/0.25 0/0.25 12/0.25 r/0.25 10/0.5 12/0.5'
      + ' | 0/0.25 r/0.25 12/0.25 0/0.25 r/0.5 0/0.25 12/0.25 r/0.5 7/0.25 8/0.25 9/0.5 10/0.5' },
  { id: 'walkingTwoFiveOne', label: 'Walking line (ii V I)', style: 'Jazz, walking',
    steps: '2/1 5/1 9/1 6/1 | 7/1 11/1 14/1 13/1 | 12/1 9/1 7/1 4/1 | 0/1 4/1 7/1 1/1' },
  { id: 'boogie12', label: '12-bar boogie', style: 'Blues',
    steps: TWELVE_BAR.map((c) => BOOGIE_BAR.map((iv) => `${iv + c}/0.5`).join(' ')).join(' | ') },
];

export function parseSteps(text) {
  return text.split(/\s+/).filter((tok) => tok && tok !== '|').map((tok) => {
    const [n, b] = tok.split('/');
    const beats = Number(b);
    return n === 'r' ? { rest: true, beats } : { iv: Number(n), beats };
  });
}

export const formatSteps = (steps) => steps.map((s) => `${s.rest ? 'r' : s.iv}/${s.beats}`).join(' ');

/** Up an octave in eighths, back down, root held for a beat. */
export function scaleSteps(ivs) {
  const down = [...ivs].reverse();
  return [
    ...[...ivs, 12].map((iv) => ({ iv, beats: 0.5 })),
    ...down.map((iv, i) => ({ iv, beats: i === down.length - 1 ? 1 : 0.5 })),
  ];
}

/** Chord tones up through the octave and back, in quarters. */
export function arpeggioSteps(ivs) {
  return [...ivs, 12, ...[...ivs].reverse()].map((iv) => ({ iv, beats: 1 }));
}

const totalOf = (steps) => steps.reduce((t, s) => t + s.beats, 0);

/** Loop length: whole 4/4 bars. */
export const patternBeats = (steps) => Math.max(4, Math.ceil(totalOf(steps) / 4 - 1e-9) * 4);

// ── Variations: practice patterns over the same notes ──
// Patterns index the scale/chord tones: index n (= ivs.length) is the octave, 2n two octaves.

const span = (a, b) => Array.from({ length: Math.abs(b - a) + 1 }, (_, k) => (a <= b ? a + k : a - k));

function seq(ivs, idx, beats, lastBeats = beats) {
  const n = ivs.length;
  return idx.map((i, k) => ({ iv: ivs[i % n] + 12 * Math.floor(i / n), beats: k === idx.length - 1 ? lastBeats : beats }));
}

/** Up to the octave pairing each tone with the one `width` above ([i, i+w]) or filling the gap ([i … i+w]), then mirrored down. */
function skips(n, width, fill) {
  const up = span(0, n - width).flatMap((i) => (fill ? span(i, i + width) : [i, i + width]));
  const down = span(n, width).flatMap((i) => (fill ? span(i, i - width) : [i, i - width]));
  return [...up, ...down];
}

export const SCALE_PATTERNS = [
  { id: 'updown', label: 'Up & down', hint: 'Root to octave and back in eighths.', build: (ivs) => scaleSteps(ivs) },
  { id: 'downup', label: 'Down & up', hint: 'Start on the octave, down to the root and back up.',
    build: (ivs) => seq(ivs, [...span(ivs.length, 0), ...span(1, ivs.length - 1)], 0.5) },
  { id: 'thirds', label: 'In 3rds', hint: 'Each note, then the one two steps up (1-3, 2-4, 3-5…).',
    build: (ivs) => seq(ivs, skips(ivs.length, 2, false), 0.5) },
  { id: 'fourths', label: 'In 4ths', hint: 'Each note, then the one three steps up (1-4, 2-5…).',
    build: (ivs) => seq(ivs, skips(ivs.length, 3, false), 0.5) },
  { id: 'groups3', label: 'Groups of 3', hint: 'Triplets: 1-2-3, 2-3-4, 3-4-5… one group per beat.',
    build: (ivs) => seq(ivs, skips(ivs.length, 2, true), 1 / 3) },
  { id: 'groups4', label: 'Groups of 4', hint: '16ths: 1-2-3-4, 2-3-4-5… one group per beat.',
    build: (ivs) => seq(ivs, skips(ivs.length, 3, true), 0.25) },
];

export const ARPEGGIO_PATTERNS = [
  { id: 'updown', label: 'Up & down', hint: 'Chord tones to the octave and back in quarters.', build: (ivs) => arpeggioSteps(ivs) },
  { id: 'downup', label: 'Down & up', hint: 'Start on the octave, down to the root and back up.',
    build: (ivs) => seq(ivs, [...span(ivs.length, 0), ...span(1, ivs.length - 1)], 1) },
  { id: 'twoOctaves', label: 'Two octaves', hint: 'Across two octaves and back in eighths: covers more of the neck.',
    build: (ivs) => seq(ivs, [...span(0, 2 * ivs.length), ...span(2 * ivs.length - 1, 0)], 0.5, 1) },
  { id: 'broken', label: 'Skipping', hint: 'Skip a chord tone each time (1-5, 3-8…), up and back.',
    build: (ivs) => seq(ivs, skips(ivs.length, 2, false), 0.5) },
  { id: 'pedal', label: 'Root pedal', hint: 'Back to the root between chord tones: R-3, R-5, R-7, R-8.',
    build: (ivs) => seq(ivs, span(1, ivs.length).flatMap((i) => [0, i]), 0.5) },
];

// Swing: the off-beat eighth lands two-thirds through the beat; times in between stretch to match.
const swingTime = (t) => {
  const b = Math.floor(t + 1e-9);
  const f = t - b;
  return b + (f <= 0.5 ? (f * 4) / 3 : 2 / 3 + ((f - 0.5) * 2) / 3);
};

export const LICK_VARIATIONS = [
  { id: 'asWritten', label: 'As written', hint: 'The lick as written.', apply: (steps) => steps },
  { id: 'notesOnly', label: 'Notes only', hint: 'Every note a quarter, no rests: learn the shape before the rhythm.',
    apply: (steps) => steps.filter((s) => !s.rest).map((s) => ({ iv: s.iv, beats: 1 })) },
  { id: 'halfTime', label: 'Half-time', hint: 'Every note twice as long: same tempo, more room.',
    apply: (steps) => steps.map((s) => ({ ...s, beats: s.beats * 2 })) },
  { id: 'swing', label: 'Swing feel', hint: 'Straight eighths become long-short.',
    apply: (steps) => {
      let t = 0;
      return steps.map((s) => {
        const a = swingTime(t);
        t += s.beats;
        return { ...s, beats: swingTime(t) - a };
      });
    } },
  { id: 'callResponse', label: 'Call & response', hint: 'The lick plays, then the same space is left for you to play it back.',
    apply: (steps) => {
      const bars = patternBeats(steps);
      const pad = bars - totalOf(steps);
      return [...steps, ...(pad > 1e-9 ? [{ rest: true, beats: pad }] : []), { rest: true, beats: bars }];
    } },
];

/** Lowest root midi (or the next octave up when `high` and it fits) that keeps every note in [low, high]; null if none. */
export function placeRoot(rootPc, steps, [low, high], high8va = false) {
  const ivs = steps.filter((s) => !s.rest).map((s) => s.iv);
  const lo = Math.min(0, ...ivs);
  const hi = Math.max(0, ...ivs);
  const fits = [];
  for (let r = low - lo; r + hi <= high; r++) if (pitchClass(r) === rootPc) fits.push(r);
  if (!fits.length) return null;
  return high8va && fits.length > 1 ? fits[1] : fits[0];
}

/**
 * @param {{ rootPc: number, tuning: number[], frets: number, octaveUp?: boolean }} opts
 * @returns {{ line: object[], totalBeats: number, rootMidi: number|null, marks: {string, fret, label, root}[] }}
 */
export function buildExercise(steps, { rootPc, tuning, frets, octaveUp = false }) {
  const totalBeats = patternBeats(steps);
  const rootMidi = placeRoot(rootPc, steps, [Math.min(...tuning), Math.max(...tuning) + frets], octaveUp);
  if (rootMidi === null) return { line: [], totalBeats, rootMidi, marks: [] };

  const line = [];
  let t = 0;
  for (const s of steps) {
    if (!s.rest) {
      const midi = rootMidi + s.iv;
      line.push({ midi, name: midiToName(midi), degree: DEGREES[pitchClass(s.iv)], start: t, end: t + s.beats });
    }
    t += s.beats;
  }
  const positions = fingerLine(line, tuning, frets);
  const fingered = line.map((n, i) => ({ ...n, ...positions[i] }));

  const marks = new Map();
  for (const n of fingered) {
    const key = `${n.string}:${n.fret}`;
    if (!marks.has(key)) marks.set(key, { string: n.string, fret: n.fret, label: n.degree, root: n.degree === 'R' });
  }
  return { line: fingered, totalBeats, rootMidi, marks: [...marks.values()] };
}

// ── The user's own licks (this device only) ──

const USER_LICKS_KEY = 'chordsheet-bass-licks-v1';

/** @returns {{ id: string, name: string, steps: string }[]} */
export function loadUserLicks() {
  try {
    const list = JSON.parse(localStorage.getItem(USER_LICKS_KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveUserLicks(list) {
  try { localStorage.setItem(USER_LICKS_KEY, JSON.stringify(list)); } catch {}
}
