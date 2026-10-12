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
