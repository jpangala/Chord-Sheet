import { useState, useRef, useCallback, useEffect } from 'react';
import Meyda from 'meyda';
import { matchChordTemplatesRanked } from './audioChords.js';
import { ROOTS } from './chords.js';

// 16384 samples gives ~2.7Hz frequency resolution at 44.1kHz — needed to tell
// apart low-register semitones a plain 2048-sample window can't resolve (e.g.
// guitar's open E2/F2 are only ~5Hz apart, well inside a 2048-window's ~21Hz
// bin width). Trade-off: each reading now covers ~370ms of audio instead of
// ~46ms, so it reacts noticeably slower — acceptable here since this is a
// diagnostic tool, not the live-performance case.
const FFT_SIZE = 16384;
const UPDATE_MS = 100;      // ~10 readings/sec — fast enough to feel live, slow enough to read
const SILENCE_RMS = 0.01;   // below this input level, treat as "no real signal" rather than noise
const AVERAGE_FRAMES = 2;   // light extra smoothing on top of the now-wide analysis window

/**
 * Standalone diagnostic panel: listens to the mic and shows what the
 * chord-detection pipeline sees — the 12-bin chroma (pitch-class energy),
 * averaged over a short rolling window to cut single-frame noise jitter,
 * and the top-3 best-matching chords (not just the winner) so a confident
 * read can be told apart from a near-tie.
 */
export function LiveChordTest({ onClose }) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState('');
  const [chroma, setChroma] = useState(Array(12).fill(0));
  const [matches, setMatches] = useState([]); // top-3 { root, qual, confidence }, best first
  const [level, setLevel] = useState(0); // RMS of the raw time-domain buffer, 0..~1

  const audioCtxRef = useRef(null);
  const streamRef = useRef(null);
  const analyserRef = useRef(null);
  const timeDataRef = useRef(null);
  const intervalRef = useRef(null);
  const chromaHistoryRef = useRef([]);
  const peakConfidenceRef = useRef(-1); // best top-1 confidence seen in the current capture

  const stop = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (audioCtxRef.current) {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
    chromaHistoryRef.current = [];
    peakConfidenceRef.current = -1;
    setListening(false);
    setLevel(0);
    setChroma(Array(12).fill(0));
    setMatches([]);
  }, []);

  const start = useCallback(async () => {
    setError('');
    let stream;
    try {
      // Disable the browser's default speech-call processing — echo
      // cancellation, noise suppression, and auto-gain control are all
      // tuned for voice and tend to smear or suppress sustained musical
      // tone, which flattens the chroma vector this needs to read clean.
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch {
      setError("Couldn't access the microphone. Check your browser's mic permission for this page.");
      return;
    }
    streamRef.current = stream;

    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    audioCtxRef.current = audioCtx;
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    source.connect(analyser);
    analyserRef.current = analyser;
    timeDataRef.current = new Float32Array(FFT_SIZE);

    Meyda.bufferSize = FFT_SIZE;
    Meyda.sampleRate = audioCtx.sampleRate;

    intervalRef.current = setInterval(() => {
      const timeData = timeDataRef.current;
      analyser.getFloatTimeDomainData(timeData);

      let sumSq = 0;
      for (let i = 0; i < timeData.length; i++) sumSq += timeData[i] * timeData[i];
      const rms = Math.sqrt(sumSq / timeData.length);
      setLevel(rms);

      // Below the silence threshold there's no real tone to read — matching
      // against noise floor just produces the flat, mediocre-confidence
      // readings this panel exists to catch, so don't even try. This is also
      // the end of a capture (if one was in progress): freeze whatever peak
      // was found (leave `matches` alone — don't clear it) and reset the
      // rolling history + peak tracker so the next sound starts a clean,
      // independent capture instead of blending into this one's tail.
      if (rms < SILENCE_RMS) {
        chromaHistoryRef.current = [];
        peakConfidenceRef.current = -1;
        setChroma(Array(12).fill(0));
        return;
      }

      const c = Meyda.extract('chroma', timeData);
      if (!c) return;

      // Rolling average over the last few frames (~AVERAGE_FRAMES * UPDATE_MS
      // ms) — smooths out single-frame noise for real signal; on genuine
      // noise it just averages toward the same noise floor, it can't
      // manufacture a peak that isn't there.
      const history = chromaHistoryRef.current;
      history.push(c);
      if (history.length > AVERAGE_FRAMES) history.shift();
      const avg = Array.from({ length: 12 }, (_, i) =>
        history.reduce((sum, frame) => sum + frame[i], 0) / history.length
      );
      setChroma(avg);

      // Only adopt this reading if it's more confident than the best one
      // seen so far in this capture — a sustained note/chord should only
      // ever sharpen into a clearer answer while held, never regress to a
      // worse one just because one frame happened to be noisier.
      const ranked = matchChordTemplatesRanked(avg, 3);
      if (ranked[0].confidence > peakConfidenceRef.current) {
        peakConfidenceRef.current = ranked[0].confidence;
        setMatches(ranked);
      }
    }, UPDATE_MS);

    setListening(true);
  }, []);

  // Stop the mic and clean up on unmount, however the panel closes.
  useEffect(() => stop, [stop]);

  const maxChroma = Math.max(0.001, ...chroma);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.4)',
      }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border-strong)',
        borderRadius: 16, padding: '1.5rem',
        width: 480, maxHeight: '85vh', overflowY: 'auto',
        boxShadow: '0 16px 48px rgba(0,0,0,0.2)',
        display: 'flex', flexDirection: 'column', gap: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-text)' }}>Live Chord Test</span>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--color-text-2)', padding: '0 4px', lineHeight: 1 }}
          >×</button>
        </div>

        <p style={{ margin: 0, fontSize: 12, color: 'var(--color-text-3)' }}>
          Play or sing a note/chord and hold it. While it's sounding, the reading only ever
          upgrades to a more confident match, never regresses to a worse one — once you stop,
          that peak result locks in place. Play the next note/chord to clear it and start a
          fresh read. A big gap between #1 and #2 below means a confident match; a near-tie
          means genuinely ambiguous input.
        </p>

        {error && (
          <p style={{ margin: 0, fontSize: 12, color: 'var(--color-danger-text)' }}>{error}</p>
        )}

        <button
          onClick={listening ? stop : start}
          style={{
            padding: '9px', borderRadius: 8, border: 'none',
            background: listening ? 'var(--color-danger-text)' : 'var(--color-accent)',
            color: listening ? '#fff' : 'var(--color-bg)',
            fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}
        >{listening ? '■ Stop listening' : '🎤 Start listening'}</button>

        {listening && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, fontWeight: 600, color: 'var(--color-text-3)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              <span>Input level</span>
              <span>{level < SILENCE_RMS ? 'too quiet — no signal' : `RMS ${level.toFixed(3)}`}</span>
            </div>
            <div style={{ height: 8, borderRadius: 4, background: 'var(--color-surface-2)', overflow: 'hidden' }}>
              <div style={{
                height: '100%', width: `${Math.min(100, level * 300)}%`,
                background: level < SILENCE_RMS ? 'var(--color-danger-text)' : 'var(--color-accent)',
                transition: 'width 0.08s linear',
              }} />
            </div>
          </div>
        )}

        {/* Best-match readout */}
        <div style={{ textAlign: 'center', padding: '0.75rem', background: 'var(--color-surface-2)', borderRadius: 10 }}>
          <div style={{ fontSize: 40, fontWeight: 700, fontFamily: 'var(--font-serif)', color: 'var(--color-text)', lineHeight: 1 }}>
            {matches[0] ? `${matches[0].root}${matches[0].qual || ''}` : '—'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--color-text-3)', marginTop: 6 }}>
            {!listening
              ? 'not listening'
              : level >= SILENCE_RMS
                ? `capturing… best so far ${(matches[0]?.confidence * 100 || 0).toFixed(0)}%`
                : matches[0]
                  ? `locked ${(matches[0].confidence * 100).toFixed(0)}% — play the next note/chord to re-test`
                  : 'waiting for a note or chord…'}
          </div>
        </div>

        {/* Top-3 candidates — reveals a confident win vs. a near-tie */}
        {matches.length > 0 && (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            {matches.map((m, i) => (
              <div
                key={`${m.root}${m.qual}`}
                style={{
                  padding: '6px 10px', borderRadius: 8,
                  border: `1px solid ${i === 0 ? 'var(--color-accent)' : 'var(--color-border)'}`,
                  background: i === 0 ? 'var(--color-surface-2)' : 'transparent',
                  textAlign: 'center', minWidth: 64,
                }}
              >
                <div style={{
                  fontSize: 14, fontWeight: i === 0 ? 700 : 500,
                  fontFamily: 'var(--font-serif)',
                  color: i === 0 ? 'var(--color-accent)' : 'var(--color-text-2)',
                }}>
                  {m.root}{m.qual || ''}
                </div>
                <div style={{ fontSize: 10, color: 'var(--color-text-3)', marginTop: 2 }}>
                  {(m.confidence * 100).toFixed(0)}%
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Raw chroma bars — the actual diagnostic signal */}
        <div>
          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-3)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Raw pitch-class energy (chroma)
          </div>
          <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', height: 120 }}>
            {ROOTS.map((root, i) => {
              const v = chroma[i] || 0;
              const heightPct = Math.max(2, (v / maxChroma) * 100);
              const isTop = v === maxChroma && v > 0.001;
              return (
                <div key={root} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <div style={{
                    width: '100%', height: 96,
                    display: 'flex', alignItems: 'flex-end',
                    background: 'var(--color-surface-2)', borderRadius: 3, overflow: 'hidden',
                  }}>
                    <div style={{
                      width: '100%', height: `${heightPct}%`,
                      background: isTop ? 'var(--color-accent)' : 'var(--color-border-strong)',
                      transition: 'height 0.08s linear',
                    }} />
                  </div>
                  <span style={{ fontSize: 10, color: isTop ? 'var(--color-accent)' : 'var(--color-text-3)', fontWeight: isTop ? 700 : 400 }}>
                    {root}
                  </span>
                  <span style={{ fontSize: 9, color: 'var(--color-text-3)', fontFamily: 'monospace' }}>
                    {v.toFixed(2)}
                  </span>
                </div>
              );
            })}
          </div>
          <p style={{ margin: '8px 0 0', fontSize: 10, color: 'var(--color-text-3)' }}>
            Bars are scaled to the loudest bin in <em>this</em> reading, so they'll always show
            some shape — the raw numbers underneath are what actually matter. If they're all
            close together (e.g. 0.20–0.30, no bin standing out) that's noise, not a chord,
            regardless of what the bars look like.
          </p>
        </div>
      </div>
    </div>
  );
}
