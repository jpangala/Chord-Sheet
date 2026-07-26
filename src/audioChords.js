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
