import * as tf from '@tensorflow/tfjs'; // same deduped copy basic-pitch uses
import { transcribeNotes } from './transcription.js';

// tfjs 3.x's WebGL fence polling calls window.setTimeout, which doesn't exist
// in a worker; without this every readback throws and the model never finishes.
self.window = self;

const WEBGL_PROBE_MS = 3000;

// WebGL readback can stall (no GPU, blocked GL context); a stalled model never
// reports progress, so probe once and fall back to the slower CPU backend.
async function ensureWorkingBackend() {
  await tf.ready();
  if (tf.getBackend() !== 'webgl') return tf.getBackend();
  try {
    const probe = tf.tidy(() => tf.ones([8, 8]).matMul(tf.ones([8, 8]))).data();
    let timer;
    await Promise.race([
      probe,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('webgl stalled')), WEBGL_PROBE_MS); }),
    ]);
    clearTimeout(timer);
  } catch {
    await tf.setBackend('cpu');
  }
  return tf.getBackend();
}

self.onmessage = async (e) => {
  const { samples, modelUrl, minFreq, maxFreq } = e.data;
  try {
    const backend = await ensureWorkingBackend();
    const notes = await transcribeNotes(samples, modelUrl, {
      minFreq, maxFreq,
      onProgress: (p) => self.postMessage({ type: 'progress', value: p }),
    });
    self.postMessage({ type: 'done', notes, backend });
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message });
  }
};
