import { extractChromaFrames, matchChordTemplates } from './audioChords.js';

self.onmessage = (e) => {
  const { channelData, sampleRate } = e.data;
  try {
    const chromaFrames = extractChromaFrames(channelData, sampleRate);
    const frames = chromaFrames.map(({ time, chroma }) => {
      const { root, qual, confidence } = matchChordTemplates(chroma);
      return { time, root, qual, confidence };
    });
    self.postMessage({ type: 'done', frames });
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message });
  }
};
