// ─── Pitch of a single voice (humming / singing) → notes ─────
// Pure functions. detectPitch is YIN (de Cheveigné & Kawahara 2002): the
// cumulative-mean-normalised difference function, first dip under a threshold,
// parabolic interpolation. It is robust to a voice's strong 2nd harmonic,
// which fools plain autocorrelation into an octave error.

const YIN_THRESHOLD = 0.15; // dip depth that counts as periodic (lower = stricter)
const MIN_HZ = 60;          // below a low bass voice
const MAX_HZ = 1100;        // above a high soprano

/**
 * @param {Float32Array} buf mono samples (≥ 2 periods of MIN_HZ; 2048 at 44.1/48 kHz)
 * @returns {{ hz: number, clarity: number } | null} null for silence, noise or no clear pitch
 */
export function detectPitch(buf, sampleRate, { minHz = MIN_HZ, maxHz = MAX_HZ, threshold = YIN_THRESHOLD } = {}) {
  const tauMin = Math.max(2, Math.floor(sampleRate / maxHz));
  const tauMax = Math.min(Math.floor(buf.length / 2) - 1, Math.ceil(sampleRate / minHz));
  const width = buf.length - tauMax - 1; // every lag up to tauMax + 1 (read by the interpolation) sees the same span
  const d = new Float64Array(tauMax + 2);
  for (let tau = 1; tau <= tauMax + 1; tau++) {
    let sum = 0;
    for (let i = 0; i < width; i++) {
      const x = buf[i] - buf[i + tau];
      sum += x * x;
    }
    d[tau] = sum;
  }
  // Cumulative mean normalised difference: 1 at tau 0, dips toward 0 at the period.
  const cmnd = new Float64Array(tauMax + 2).fill(1);
  let running = 0;
  for (let tau = 1; tau <= tauMax + 1; tau++) {
    running += d[tau];
    cmnd[tau] = running > 0 ? (d[tau] * tau) / running : 1;
  }
  let tau = -1;
  for (let t = tauMin; t <= tauMax; t++) {
    if (cmnd[t] < threshold) {
      while (t + 1 <= tauMax && cmnd[t + 1] < cmnd[t]) t++; // to the bottom of this dip
      tau = t;
      break;
    }
  }
  if (tau < 0) return null;
  const [a, b, c] = [cmnd[tau - 1], cmnd[tau], cmnd[tau + 1]];
  const denom = a - 2 * b + c;
  const shift = denom > 0 ? (0.5 * (a - c)) / denom : 0;
  return { hz: sampleRate / (tau + shift), clarity: 1 - b };
}

export const hzToMidi = (hz) => 69 + 12 * Math.log2(hz / 440);

/** Nearest equal-tempered note and how far off the pitch is, in cents (−50..50). */
export function nearestNote(hz) {
  const m = hzToMidi(hz);
  const midi = Math.round(m);
  return { midi, cents: Math.round((m - midi) * 1000) / 10 || 0 };
}

/** Where a hummed line feels natural to play: the first two octaves up from the lowest string. */
export const comfortRange = (tuning) => [Math.min(...tuning), Math.min(...tuning) + 24];

/**
 * Sung notes → notes on the instrument.
 * shift 'auto': one octave shift for the whole phrase (keeps the melody's shape), chosen to put the most
 * notes in the comfort range (smallest shift on a tie); a note still off the neck is folded in by octaves.
 * shift = a number of semitones (0, -12, -24): applied to every note; off the neck → null.
 * @returns {(number|null)[]}
 */
export function fitPhrase(midis, { tuning, frets, shift = 'auto' }) {
  const [low, high] = [Math.min(...tuning), Math.max(...tuning) + frets];
  const onNeck = (m) => m >= low && m <= high;
  if (shift !== 'auto') return midis.map((m) => (onNeck(m + shift) ? m + shift : null));
  const [cLo, cHi] = comfortRange(tuning);
  let best = 0;
  let bestScore = -1;
  for (const k of [0, -1, 1, -2, 2, -3, 3, -4, 4]) { // smallest shift first, so ties keep it
    const score = midis.filter((m) => m + 12 * k >= cLo && m + 12 * k <= cHi).length;
    if (score > bestScore) { bestScore = score; best = 12 * k; }
  }
  return midis.map((m) => {
    let x = m + best;
    while (x > high && x - 12 >= low) x -= 12;
    while (x < low && x + 12 <= high) x += 12;
    return onNeck(x) ? x : null;
  });
}

const HOLD = 0.6;     // semitones a frame may wander from the note's average and still be that note (vibrato)
const MIN_NOTE = 0.08; // s; shorter = a blip or the slide between two notes
const MAX_GAP = 0.08;  // s of no pitch inside one note (a breath of noise, a consonant)

/**
 * Pitch frames → notes. Frames: { t (s), midi (float) | null } at a steady hop.
 * @returns {{ midi: number, start: number, end: number }[]} midi rounded from the note's average
 */
export function segmentNotes(frames, { hop }) {
  const notes = [];
  let cur = null;
  const close = () => {
    if (cur && cur.last - cur.start + hop >= MIN_NOTE - 1e-9) notes.push({ midi: Math.round(cur.sum / cur.count), start: cur.start, end: cur.last + hop });
    cur = null;
  };
  for (const f of frames) {
    if (f.midi === null) {
      if (cur && f.t - cur.last > MAX_GAP) close();
      continue;
    }
    if (cur && Math.abs(f.midi - cur.sum / cur.count) <= HOLD && f.t - cur.last <= MAX_GAP + hop) {
      cur.sum += f.midi;
      cur.count++;
      cur.last = f.t;
    } else {
      close();
      cur = { start: f.t, last: f.t, sum: f.midi, count: 1 };
    }
  }
  close();
  // A dropped blip can split one note in two: rejoin same-pitch neighbours across a short gap.
  const merged = [];
  for (const n of notes) {
    const prev = merged[merged.length - 1];
    if (prev && prev.midi === n.midi && n.start - prev.end <= MAX_GAP + 1e-9) prev.end = n.end;
    else merged.push({ ...n });
  }
  return merged;
}
