import { transcribeNotes } from './transcription.js';

self.onmessage = async (e) => {
  const { samples, modelUrl, minFreq, maxFreq } = e.data;
  try {
    const notes = await transcribeNotes(samples, modelUrl, {
      minFreq, maxFreq,
      onProgress: (p) => self.postMessage({ type: 'progress', value: p }),
    });
    self.postMessage({ type: 'done', notes });
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message });
  }
};
