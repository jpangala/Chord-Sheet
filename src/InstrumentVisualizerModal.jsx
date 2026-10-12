import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { decodeAudioFile, resampleMono } from './audioChords.js';
import { INSTRUMENTS, instrumentRange, midiToHz, findNoteAt, findNextNote } from './instruments.js';
import { buildLine } from './noteLine.js';
import { loudnessEnvelope, isSilent } from './loudness.js';
import { BackingTracks } from './BackingTracks.jsx';
import { ROOTS } from './chords.js';
import { Fretboard } from './Fretboard.jsx';
import { Keyboard } from './Keyboard.jsx';
import { TabStrip } from './TabStrip.jsx';

const MAX_ANALYSIS_SECONDS = 300;
const TRANSCRIBE_SAMPLE_RATE = 22050; // mirrors transcription.js; importing it would pull tfjs into this chunk
// minAmp: model confidence floor; gateDb: how far below the file's loud level a note may start (loudness.js)
const SENSITIVITY = {
  more: { minAmp: 0.2, gateDb: -42 },
  balanced: { minAmp: 0.3, gateDb: -36 },
  fewer: { minAmp: 0.45, gateDb: -28 },
};
const SPEEDS = [0.5, 0.75, 1];
const CHORD_SHARE_WARNING = 0.25; // isolated source: above this it doesn't sound like a single line
const SOURCES = {
  isolated: { label: 'Only my instrument', hint: 'Recommended, most accurate. The file has just the bass, guitar, piano or keyboard line: your own recording, a stem, or a solo clip.' },
  mix: { label: 'Full song', hint: 'The file is a whole song with other instruments. The app guesses the part by following the top or bottom line, so it is less accurate.' },
};

const firstTuning = (inst) => (inst.tunings ? Object.keys(inst.tunings)[0] : null);

export function InstrumentVisualizerModal({ onClose }) {
  const [instrumentId, setInstrumentId] = useState('bass');
  const [tuningId, setTuningId] = useState(firstTuning(INSTRUMENTS.bass));
  const [step, setStep] = useState('setup'); // 'setup' | 'transcribing' | 'view' | 'error'
  const [progress, setProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');
  const [rawNotes, setRawNotes] = useState([]);
  const [loudness, setLoudness] = useState(null);
  const [tracks, setTracks] = useState([]); // play-along audio, never analyzed
  const [sensitivity, setSensitivity] = useState('balanced');
  const [source, setSource] = useState('isolated');
  const [follow, setFollow] = useState(INSTRUMENTS.bass.defaultFollow);
  const [speed, setSpeed] = useState(1);
  const [loop, setLoop] = useState({ a: null, b: null });
  const [pos, setPos] = useState({ current: -1, next: -1 });
  const [audioUrl, setAudioUrl] = useState(null);
  const audioRef = useRef(null);
  const workerRef = useRef(null);
  const requestIdRef = useRef(0);
  const audioUrlRef = useRef(null);
  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;
  const loopRef = useRef(loop);
  loopRef.current = loop;

  const instrument = INSTRUMENTS[instrumentId];
  const tuning = instrument.tunings?.[tuningId]?.strings ?? null;
  const noteNames = tuning ? tuning.map((m) => ROOTS[m % 12]) : [];

  const { line, chordShare } = useMemo(
    () => buildLine(rawNotes, { instrument, tuning, ...SENSITIVITY[sensitivity], source, follow, loudness }),
    [rawNotes, instrument, tuning, sensitivity, source, follow, loudness],
  );

  const fail = (message) => { setErrorMessage(message); setStep('error'); };

  const runWorker = useCallback((payload) => new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./transcribeWorker.js', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    const done = () => { worker.terminate(); workerRef.current = null; };
    worker.onmessage = (e) => {
      if (e.data.type === 'progress') { setProgress(e.data.value); return; }
      if (e.data.type === 'done') resolve(e.data.notes);
      else reject(new Error(e.data.message || 'Transcription failed'));
      done();
    };
    worker.onerror = (err) => { reject(new Error(err.message || 'Worker error')); done(); };
    worker.postMessage(payload, [payload.samples.buffer]);
  }), []);

  const handleFile = useCallback(async (file) => {
    const requestId = ++requestIdRef.current;
    const stale = () => requestId !== requestIdRef.current;
    setStep('transcribing');
    setProgress(0);
    setErrorMessage('');

    let decoded;
    try {
      decoded = await decodeAudioFile(file);
    } catch {
      if (!stale()) fail("Couldn't read this audio file.");
      return;
    }
    if (stale()) return;

    try {
      const samples = await resampleMono(decoded, TRANSCRIBE_SAMPLE_RATE, MAX_ANALYSIS_SECONDS);
      if (stale()) return;
      // Check loudness before the model runs (the worker takes ownership of the samples).
      const envelope = loudnessEnvelope(samples, TRANSCRIBE_SAMPLE_RATE);
      if (isSilent(envelope)) return fail('This file looks silent, so there is nothing to learn from it.');
      const [low, high] = instrumentRange(instrument, tuning);
      const notes = await runWorker({
        samples,
        modelUrl: new URL(`${import.meta.env.BASE_URL}models/basic-pitch/model.json`, window.location.href).href,
        minFreq: midiToHz(low - 1),
        maxFreq: midiToHz(high + 1),
      });
      if (stale()) return;
      if (!notes.length) return fail(`Couldn't hear any notes in the ${instrument.label.toLowerCase()}'s range.`);

      setRawNotes(notes);
      setLoudness(envelope);
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = URL.createObjectURL(file);
      setAudioUrl(audioUrlRef.current);
      setLoop({ a: null, b: null });
      setPos({ current: -1, next: -1 });
      setStep('view');
    } catch (err) {
      if (!stale()) fail(err?.message ? `Transcription failed: ${err.message}` : 'Transcription failed. Try a different file.');
    }
  }, [instrument, tuning, runWorker]);

  const handleCancel = useCallback(() => {
    requestIdRef.current++;
    workerRef.current?.terminate();
    workerRef.current = null;
    setStep('setup');
  }, []);

  useEffect(() => () => {
    requestIdRef.current++;
    workerRef.current?.terminate();
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    tracksRef.current.forEach((t) => URL.revokeObjectURL(t.url));
  }, []);

  useEffect(() => { if (audioRef.current) audioRef.current.playbackRate = speed; }, [speed, audioUrl]);

  // Playback sync + A–B loop. Re-render only when current/next note changes.
  useEffect(() => {
    if (step !== 'view') return undefined;
    let raf;
    const tick = () => {
      const audio = audioRef.current;
      if (audio) {
        const { a, b } = loopRef.current;
        if (a !== null && b !== null && b > a && audio.currentTime >= b) audio.currentTime = a;
        const t = audio.currentTime;
        const current = findNoteAt(line, t);
        const next = findNextNote(line, t);
        setPos((p) => (p.current === current && p.next === next ? p : { current, next }));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [step, line]);

  const removeTrack = (id) => {
    const t = tracks.find((x) => x.id === id);
    if (t) URL.revokeObjectURL(t.url);
    setTracks((ts) => ts.filter((x) => x.id !== id));
  };

  const seekTo = (t) => { if (audioRef.current) audioRef.current.currentTime = t + 0.001; };
  const now = () => audioRef.current?.currentTime ?? 0;
  const current = pos.current >= 0 ? line[pos.current] : null;
  const next = pos.next >= 0 ? line[pos.next] : null;

  const pill = (selected) => ({
    padding: '6px 12px', borderRadius: 8, fontSize: 12, cursor: 'pointer', flexShrink: 0,
    border: `1px solid ${selected ? 'var(--color-accent)' : 'var(--color-border-strong)'}`,
    background: selected ? 'var(--color-accent)' : 'transparent',
    color: selected ? 'var(--color-surface)' : 'var(--color-text-2)',
  });
  const caption = { fontSize: 11, color: 'var(--color-text-3)', textTransform: 'uppercase', letterSpacing: '0.08em' };
  const row = { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' };
  const fmtTime = (t) => (t === null ? '–' : `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`);

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.4)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: 'var(--color-surface)', border: '1px solid var(--color-border-strong)', borderRadius: 16,
        padding: '1.5rem', width: 'min(880px, 95vw)', maxHeight: '90vh', overflowY: 'auto',
        boxShadow: '0 16px 48px rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column', gap: 14,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-text)' }}>Learn a line</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--color-text-2)', padding: '0 4px', lineHeight: 1 }}>×</button>
        </div>

        {step === 'setup' && (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={caption}>Instrument</span>
              <div style={row}>
                {Object.values(INSTRUMENTS).map((inst) => (
                  <button key={inst.id} style={pill(inst.id === instrumentId)} onClick={() => {
                    setInstrumentId(inst.id); setTuningId(firstTuning(inst)); setFollow(inst.defaultFollow);
                  }}>{inst.label}</button>
                ))}
              </div>
            </div>
            {instrument.tunings && (
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={caption}>Tuning</span>
                <select value={tuningId} onChange={(e) => setTuningId(e.target.value)} style={{ padding: 6, borderRadius: 8, maxWidth: 260 }}>
                  {Object.entries(instrument.tunings).map(([id, t]) => <option key={id} value={id}>{t.label}</option>)}
                </select>
              </label>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={caption}>What's in the file?</span>
              {Object.entries(SOURCES).map(([id, s]) => (
                <label key={id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer', fontSize: 13, color: 'var(--color-text)' }}>
                  <input type="radio" name="source" checked={source === id} onChange={() => setSource(id)} style={{ marginTop: 3 }} />
                  <span><strong>{s.label}</strong><br /><span style={{ fontSize: 12, color: 'var(--color-text-3)' }}>{s.hint}</span></span>
                </label>
              ))}
            </div>
            <div style={{ textAlign: 'center', padding: '1.5rem 1rem', border: '2px dashed var(--color-border)', borderRadius: 12 }}>
              <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--color-text-2)' }}>
                {source === 'isolated'
                  ? `Upload a recording of just the ${instrument.label.toLowerCase()} line you want to learn (an intro, riff or solo).`
                  : 'Upload the song with the part you want to learn (an intro, riff or solo).'}
              </p>
              <input type="file" accept="audio/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
            </div>
          </>
        )}

        {step === 'transcribing' && (
          <div style={{ textAlign: 'center', padding: '2rem 1rem' }}>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-2)' }}>Listening for notes… {Math.round(progress * 100)}%</p>
            <button onClick={handleCancel} style={{ ...pill(false), marginTop: 14 }}>Cancel</button>
          </div>
        )}

        {step === 'error' && (
          <div style={{ textAlign: 'center', padding: '1.5rem 1rem' }}>
            <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--color-danger-text)' }}>{errorMessage}</p>
            <button onClick={() => setStep('setup')} style={pill(false)}>Try again</button>
          </div>
        )}

        {step === 'view' && (
          <>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, minHeight: 40 }}>
              <span style={{ fontSize: 30, fontWeight: 700, color: 'var(--color-note)' }}>{current?.name ?? '—'}</span>
              {next && <span style={{ fontSize: 14, color: 'var(--color-note-next)' }}>next: {next.name}</span>}
              {current?.string !== undefined && (
                <span style={{ fontSize: 13, color: 'var(--color-text-3)' }}>{noteNames[current.string]} string, fret {current.fret}</span>
              )}
            </div>

            {instrument.kind === 'fretted'
              ? <Fretboard tuning={tuning} frets={instrument.frets} noteNames={noteNames} current={current} next={next} />
              : <Keyboard current={current} next={next} />}

            <TabStrip line={line} tuning={tuning} noteNames={noteNames} currentIdx={pos.current} nextIdx={pos.next} onSeek={seekTo} />

            {line.length === 0 && (
              <p style={{ margin: 0, fontSize: 12, color: 'var(--color-text-2)', background: 'var(--color-surface-2)', borderRadius: 8, padding: '8px 10px' }}>
                No notes found at this sensitivity. Quiet or noisy parts are ignored; try "More notes" if the line is soft.
              </p>
            )}

            <audio ref={audioRef} src={audioUrl} controls style={{ width: '100%' }} />

            <BackingTracks masterRef={audioRef} tracks={tracks} setTracks={setTracks} onRemove={removeTrack} ui={{ pill, caption, row }} />

            <div style={row}>
              <span style={caption}>Speed</span>
              {SPEEDS.map((s) => <button key={s} style={pill(speed === s)} onClick={() => setSpeed(s)}>{s * 100}%</button>)}
              <span style={{ ...caption, marginLeft: 12 }}>Loop</span>
              <button style={pill(loop.a !== null)} onClick={() => setLoop((l) => ({ ...l, a: now() }))}>A {fmtTime(loop.a)}</button>
              <button style={pill(loop.b !== null)} onClick={() => setLoop((l) => ({ ...l, b: now() }))}>B {fmtTime(loop.b)}</button>
              {(loop.a !== null || loop.b !== null) && <button style={pill(false)} onClick={() => setLoop({ a: null, b: null })}>Clear</button>}
            </div>

            {source === 'isolated' && chordShare > CHORD_SHARE_WARNING && (
              <p style={{ margin: 0, fontSize: 12, color: 'var(--color-danger-text)', background: 'var(--color-danger-bg)', border: '1px solid var(--color-danger-border)', borderRadius: 8, padding: '8px 10px' }}>
                This file has a lot of notes played together (chords or other instruments), so the line may be inaccurate.
                If it's a full song, switch Source to "Full song".
              </p>
            )}

            <div style={row}>
              <span style={caption}>Source</span>
              {Object.entries(SOURCES).map(([id, s]) => (
                <button key={id} style={pill(source === id)} onClick={() => setSource(id)}>{s.label}</button>
              ))}
              {source === 'mix' && (
                <>
                  <span style={{ ...caption, marginLeft: 12 }}>Follow</span>
                  <button style={pill(follow === 'highest')} onClick={() => setFollow('highest')}>Top line</button>
                  <button style={pill(follow === 'lowest')} onClick={() => setFollow('lowest')}>Bottom line</button>
                </>
              )}
            </div>

            <div style={row}>
              <span style={caption}>Sensitivity</span>
              {[['more', 'More notes'], ['balanced', 'Balanced'], ['fewer', 'Fewer notes']].map(([k, l]) => (
                <button key={k} style={pill(sensitivity === k)} onClick={() => setSensitivity(k)}>{l}</button>
              ))}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, color: 'var(--color-text-3)' }}>
                Notes are what the audio contains; string choice is the most playable way to get those exact notes.
              </span>
              <button onClick={() => setStep('setup')} style={pill(false)}>Analyze another file</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
