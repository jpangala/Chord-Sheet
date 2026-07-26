import { useState, useRef, useCallback, useEffect } from 'react';
import {
  decodeAudioFile, detectTempo, smoothChordSequence, buildDraftSection,
} from './audioChords.js';
import { chordStr, beatsPerBar } from './printUtils.js';
import { SECTION_TYPES } from './chords.js';
import { uid } from './models.js';
import { ChordPicker } from './ChordPicker.jsx';

const MAX_ANALYSIS_SECONDS = 300; // cap chroma/chord analysis to the first 5 minutes
const MIN_CONFIDENCE_FOR_RESULT = 0.35; // below this average, treat as "no clear chords"

export function AudioImportModal({ song, onCreateSection, onClose }) {
  const [step, setStep] = useState('pick'); // 'pick' | 'decoding' | 'analyzing' | 'preview' | 'error'
  const [errorMessage, setErrorMessage] = useState('');
  const [truncated, setTruncated] = useState(false);
  const [detectedBpm, setDetectedBpm] = useState(null);
  const [updateBpm, setUpdateBpm] = useState(false);
  const [draft, setDraft] = useState(null); // { bars, chords, confidence }
  const [sectionType, setSectionType] = useState('Verse');
  const [sectionLabel, setSectionLabel] = useState('');
  const [pickerTarget, setPickerTarget] = useState(null); // { barIdx, beatIdx }
  const workerRef = useRef(null);
  const draftIdRef = useRef(uid());
  const requestIdRef = useRef(0);

  const runWorkerAnalysis = useCallback((channelData, sampleRate) => {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./audioChordsWorker.js', import.meta.url), { type: 'module' });
      workerRef.current = worker;
      worker.onmessage = (e) => {
        if (e.data.type === 'done') resolve(e.data.frames);
        else reject(new Error(e.data.message || 'Worker analysis failed'));
        worker.terminate();
        workerRef.current = null;
      };
      worker.onerror = (err) => {
        reject(new Error(err.message || 'Worker error'));
        worker.terminate();
        workerRef.current = null;
      };
      worker.postMessage({ channelData, sampleRate }, [channelData.buffer]);
    });
  }, []);

  const handleFile = useCallback(async (file) => {
    const requestId = ++requestIdRef.current;
    setStep('decoding');
    setErrorMessage('');

    let audioBuffer;
    try {
      audioBuffer = await decodeAudioFile(file);
    } catch {
      if (requestId !== requestIdRef.current) return;
      setErrorMessage("Couldn't read this audio file.");
      setStep('error');
      return;
    }
    if (requestId !== requestIdRef.current) return;

    setStep('analyzing');
    const cappedLength = Math.min(audioBuffer.length, MAX_ANALYSIS_SECONDS * audioBuffer.sampleRate);
    setTruncated(cappedLength < audioBuffer.length);
    // .slice() copies into a new, independent buffer so it's safe to transfer
    // to the worker without detaching the AudioBuffer that detectTempo also reads.
    const channelData = audioBuffer.getChannelData(0).slice(0, cappedLength);

    try {
      const [bpm, frames] = await Promise.all([
        detectTempo(audioBuffer),
        runWorkerAnalysis(channelData, audioBuffer.sampleRate),
      ]);
      if (requestId !== requestIdRef.current) return;

      const frameDuration = frames.length > 1 ? frames[1].time - frames[0].time : 0.1;
      const segments = smoothChordSequence(frames, frameDuration);
      const avgConfidence = segments.length
        ? segments.reduce((sum, s) => sum + s.confidence, 0) / segments.length
        : 0;

      if (avgConfidence < MIN_CONFIDENCE_FOR_RESULT) {
        setErrorMessage("Couldn't detect clear chords in this file.");
        setStep('error');
        return;
      }

      const bpmRounded = Math.round(bpm);
      const built = buildDraftSection(segments, bpmRounded, song.timeSig);
      setDetectedBpm(bpmRounded);
      setUpdateBpm(song.bpm === 120 || Math.abs(song.bpm - bpmRounded) > 5);
      setDraft(built);
      setStep('preview');
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setErrorMessage(err?.message ? `Analysis failed: ${err.message}` : 'Analysis failed. Try a different file.');
      setStep('error');
    }
  }, [song.timeSig, song.bpm, runWorkerAnalysis]);

  const handleCancel = useCallback(() => {
    requestIdRef.current++;
    workerRef.current?.terminate();
    workerRef.current = null;
    setStep('pick');
  }, []);

  useEffect(() => () => {
    requestIdRef.current++;
    workerRef.current?.terminate();
  }, []);

  const setDraftChord = useCallback((barIdx, beatIdx, chord) => {
    setDraft((prev) => {
      const chords = { ...prev.chords };
      const key = `${barIdx}-${beatIdx}`;
      if (chord === null) delete chords[key];
      else chords[key] = chord;
      return { ...prev, chords };
    });
    setPickerTarget(null);
  }, []);

  const handleCreate = useCallback(() => {
    onCreateSection(
      { type: sectionType, label: sectionLabel, bars: draft.bars, chords: draft.chords },
      detectedBpm,
      updateBpm,
    );
  }, [onCreateSection, sectionType, sectionLabel, draft, detectedBpm, updateBpm]);

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
        width: 560, maxHeight: '85vh', overflowY: 'auto',
        boxShadow: '0 16px 48px rgba(0,0,0,0.2)',
        display: 'flex', flexDirection: 'column', gap: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-text)' }}>Import from Audio</span>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--color-text-2)', padding: '0 4px', lineHeight: 1 }}
          >×</button>
        </div>

        {step === 'pick' && (
          <div style={{ textAlign: 'center', padding: '2rem 1rem', border: '2px dashed var(--color-border)', borderRadius: 12 }}>
            <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--color-text-2)' }}>
              Upload a recording of this song to detect chords automatically.
            </p>
            <input
              type="file"
              accept="audio/*"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            />
          </div>
        )}

        {(step === 'decoding' || step === 'analyzing') && (
          <div style={{ textAlign: 'center', padding: '2rem 1rem' }}>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-2)' }}>
              {step === 'decoding' ? 'Decoding audio…' : 'Analyzing chords and tempo…'}
            </p>
            <button
              onClick={handleCancel}
              style={{
                marginTop: 14, padding: '6px 14px', borderRadius: 8,
                border: '1px solid var(--color-border-strong)',
                background: 'transparent', color: 'var(--color-text-2)',
                fontSize: 12, cursor: 'pointer',
              }}
            >Cancel</button>
          </div>
        )}

        {step === 'error' && (
          <div style={{ textAlign: 'center', padding: '2rem 1rem' }}>
            <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--color-danger-text)' }}>{errorMessage}</p>
            <button
              onClick={() => setStep('pick')}
              style={{
                padding: '7px 14px', borderRadius: 8,
                border: '1px solid var(--color-border-strong)',
                background: 'var(--color-surface)', color: 'var(--color-text)',
                fontSize: 13, cursor: 'pointer',
              }}
            >Try another file</button>
          </div>
        )}

        {step === 'preview' && draft && (
          <>
            {truncated && (
              <p style={{ margin: 0, fontSize: 11, color: 'var(--color-text-3)' }}>
                Only the first 5 minutes of this file were analyzed.
              </p>
            )}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-start' }}>
              <label style={{ fontSize: 11, color: 'var(--color-text-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Type
                <select
                  value={sectionType}
                  onChange={(e) => setSectionType(e.target.value)}
                  style={{
                    display: 'block', marginTop: 4, padding: '5px 8px', borderRadius: 6,
                    border: '1px solid var(--color-border-strong)',
                    background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: 12,
                  }}
                >
                  {SECTION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
              <label style={{ fontSize: 11, color: 'var(--color-text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', flex: 1 }}>
                Label
                <input
                  value={sectionLabel}
                  onChange={(e) => setSectionLabel(e.target.value)}
                  placeholder="optional"
                  style={{
                    display: 'block', marginTop: 4, width: '100%', padding: '5px 8px', borderRadius: 6,
                    border: '1px solid var(--color-border-strong)',
                    background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: 12,
                    boxSizing: 'border-box',
                  }}
                />
              </label>
            </div>

            <PreviewGrid
              draft={draft}
              timeSig={song.timeSig}
              onBeatClick={(barIdx, beatIdx) => setPickerTarget({ barIdx, beatIdx })}
            />

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--color-text-2)' }}>
              <input type="checkbox" checked={updateBpm} onChange={(e) => setUpdateBpm(e.target.checked)} />
              Update song BPM to {detectedBpm} (currently {song.bpm})
            </label>

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => setStep('pick')}
                style={{
                  flex: 1, padding: '9px', borderRadius: 8,
                  border: '1px solid var(--color-border-strong)',
                  background: 'transparent', color: 'var(--color-text-2)',
                  fontSize: 13, cursor: 'pointer',
                }}
              >Start over</button>
              <button
                onClick={handleCreate}
                style={{
                  flex: 2, padding: '9px', borderRadius: 8, border: 'none',
                  background: 'var(--color-accent)', color: 'var(--color-bg)',
                  fontSize: 13, fontWeight: 600, cursor: 'pointer',
                }}
              >Create section</button>
            </div>
          </>
        )}
      </div>

      {pickerTarget && (
        <ChordPicker
          sectionId={draftIdRef.current}
          barIdx={pickerTarget.barIdx}
          beatIdx={pickerTarget.beatIdx}
          sections={[{ id: draftIdRef.current, chords: draft.chords }]}
          onSet={(chord) => setDraftChord(pickerTarget.barIdx, pickerTarget.beatIdx, chord)}
          onClose={() => setPickerTarget(null)}
        />
      )}
    </div>
  );
}

function PreviewGrid({ draft, timeSig, onBeatClick }) {
  const nb = beatsPerBar(timeSig);
  const COLS = 4;
  const rows = [];
  for (let i = 0; i < draft.bars; i += COLS) {
    rows.push(Array.from({ length: Math.min(COLS, draft.bars - i) }, (_, j) => i + j));
  }

  return (
    <div>
      {rows.map((rowBars, ri) => (
        <div
          key={ri}
          style={{
            display: 'grid', gridTemplateColumns: `repeat(${rowBars.length}, 1fr)`,
            gap: 8, marginBottom: ri < rows.length - 1 ? 8 : 0,
          }}
        >
          {rowBars.map((barIdx) => (
            <div
              key={barIdx}
              style={{
                border: '1px solid var(--color-border-strong)', borderRadius: 6,
                overflow: 'hidden', background: 'var(--color-surface)',
              }}
            >
              <div style={{
                fontSize: 9, color: 'var(--color-text-3)', padding: '2px 5px',
                borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface-2)',
              }}>
                {barIdx + 1}
              </div>
              <div style={{ display: 'flex' }}>
                {Array.from({ length: nb }).map((_, beatIdx) => {
                  const key = `${barIdx}-${beatIdx}`;
                  const chord = draft.chords[key] || null;
                  const confidence = draft.confidence[key];
                  const label = chordStr(chord);
                  return (
                    <div
                      key={beatIdx}
                      onClick={() => onBeatClick(barIdx, beatIdx)}
                      style={{
                        flex: 1, minHeight: 44,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: 'pointer',
                        borderLeft: beatIdx === 0 ? 'none' : '1px dashed var(--color-border)',
                        opacity: confidence !== undefined ? 0.4 + confidence * 0.6 : 1,
                      }}
                    >
                      {label ? (
                        <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-serif)', color: 'var(--color-text)' }}>
                          {label}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--color-border-strong)', fontSize: 16, opacity: 0.6 }}>·</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
