// ─── Loudness envelope: is anything actually playing here? ───
// basic-pitch can invent notes from hiss, bleed or room noise in quiet parts of
// a stem. The envelope lets us drop notes whose onset is far below the
// file's own loudness, and reject files that are effectively silent.

const HOP = 0.01;         // s between envelope points
const WINDOW = 0.05;      // s of audio per RMS point
const SILENT_RMS = 0.001; // ≈ -60 dBFS: nothing audible in the whole file
const REFERENCE_PERCENTILE = 0.98;
const ONSET_SPAN = 0.1;      // s after the onset that must clear the floor

/**
 * RMS loudness over time.
 * @param {Float32Array} samples mono
 * @param {number} sampleRate
 * @returns {{ hop: number, levels: Float32Array }}
 */
export function loudnessEnvelope(samples, sampleRate) {
  const hopSamples = Math.max(1, Math.round(HOP * sampleRate));
  const half = Math.max(1, Math.round((WINDOW * sampleRate) / 2));
  const count = Math.ceil(samples.length / hopSamples);
  const prefix = new Float64Array(samples.length + 1); // running sum of squares
  for (let i = 0; i < samples.length; i++) prefix[i + 1] = prefix[i] + samples[i] * samples[i];
  const levels = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const centre = i * hopSamples;
    const a = Math.max(0, centre - half);
    const b = Math.min(samples.length, centre + half);
    levels[i] = b > a ? Math.sqrt((prefix[b] - prefix[a]) / (b - a)) : 0;
  }
  return { hop: hopSamples / sampleRate, levels };
}

/** The file's "loud" level: a high percentile, so one click or spike doesn't set it. */
export function referenceLevel(env) {
  if (!env.levels.length) return 0;
  const sorted = Float32Array.from(env.levels).sort();
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * REFERENCE_PERCENTILE))];
}

/** True when the whole file is at or below the noise floor. */
export function isSilent(env) {
  return referenceLevel(env) < SILENT_RMS;
}

/**
 * Drops notes whose onset is quieter than `gateDb` below the file's loud level.
 * Passing no envelope leaves the notes untouched.
 */
export function gateQuietNotes(notes, env, gateDb) {
  if (!env || !env.levels.length) return notes;
  const floor = referenceLevel(env) * 10 ** (gateDb / 20);
  const { hop, levels } = env;
  return notes.filter((n) => {
    // Start half a window in: earlier points still contain the audio before the onset.
    const from = Math.min(levels.length - 1, Math.max(0, Math.ceil((n.start + WINDOW / 2) / hop)));
    const to = Math.min(levels.length - 1, Math.max(from, Math.ceil((n.start + ONSET_SPAN) / hop)));
    let peak = 0;
    for (let i = from; i <= to; i++) if (levels[i] > peak) peak = levels[i];
    return peak >= floor;
  });
}
