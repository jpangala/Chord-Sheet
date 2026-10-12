import { analyzeDrums } from './drums.js';

// STFT over a long file is the slow part; keep it off the main thread.
self.onmessage = (e) => {
  const { samples, sampleRate } = e.data;
  try {
    const { hop, lead, energy, flux, centroid, frames } = analyzeDrums(
      samples, sampleRate, (p) => self.postMessage({ type: 'progress', value: p }),
    );
    const features = { hop, lead, energy, flux, centroid, frames };
    self.postMessage({ type: 'done', features }, [...energy, flux, centroid].map((a) => a.buffer));
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message });
  }
};
