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
