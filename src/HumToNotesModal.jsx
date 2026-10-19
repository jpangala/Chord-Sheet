// Hum or sing into the mic → notes on a bass or guitar fretboard. Live: the
// note you're holding, how sharp/flat it is, and every place it sits on the
// neck. Record: hum a phrase, get it as tab, play it back with the synth.
// Octaves: voices sit above a bass (and often a guitar), so notes are fitted
// into the lower neck by whole octaves unless an octave shift is chosen.
import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { INSTRUMENTS, midiToName, pitchClass, findNoteAt, findNextNote } from './instruments.js';
import { ROOTS } from './chords.js';
import { detectPitch, hzToMidi, nearestNote, fitPhrase, segmentNotes } from './pitch.js';
import { fingerLine } from './noteLine.js';
import { createPracticePlayer } from './practicePlayer.js';
import { Fretboard } from './Fretboard.jsx';
import { TabStrip } from './TabStrip.jsx';

const FRAME = 2048;        // samples per pitch reading (~45 ms): two periods of the lowest voice
const HOP_MS = 20;         // a reading every 20 ms
const SILENCE_RMS = 0.01;  // input level below which nothing is being sung
const SMOOTH = 3;          // live readout: median of the last few readings, so one bad frame doesn't flicker
const IN_TUNE_CENTS = 10;
const SHIFTS = [['auto', 'Auto'], [0, 'As sung'], [-12, '−1 octave'], [-24, '−2 octaves']];
const INSTRUMENT_IDS = ['bass', 'guitar'];

const median = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1];

/** Every string/fret that sounds `midi`, and the one nearest `nearFret` (or the lowest fret). */
function positionsOf(midi, tuning, frets, nearFret) {
  const all = tuning.map((open, string) => ({ string, fret: midi - open })).filter((p) => p.fret >= 0 && p.fret <= frets);
  const pick = all.reduce((best, p) => {
    if (!best) return p;
    const d = (q) => (nearFret === null ? q.fret : Math.abs(q.fret - nearFret));
    return d(p) < d(best) ? p : best;
  }, null);
  return { all, pick };
}

export function HumToNotesModal({ onClose }) {
  const [instrumentId, setInstrumentId] = useState('bass');
  const [tuningId, setTuningId] = useState(Object.keys(INSTRUMENTS.bass.tunings)[0]);
  const [shift, setShift] = useState('auto');
  const [listening, setListening] = useState(false);
  const [error, setError] = useState('');
  const [level, setLevel] = useState(0);
  const [liveMidi, setLiveMidi] = useState(null); // sung pitch as a float midi number, smoothed
  const [recording, setRecording] = useState(false);
  const [sung, setSung] = useState([]); // last recording, as sung: { midi, start, end }
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(false);
  const [pos, setPos] = useState({ current: -1, next: -1 });

  const micRef = useRef(null); // { ctx, stream, analyser, buf, timer }
  const historyRef = useRef([]);
  const framesRef = useRef(null); // recording: [{ t, midi|null }]
  const recStartRef = useRef(0);
  const playingRef = useRef(false);
  playingRef.current = playing;
  const lastFretRef = useRef(null);
  const loopRef = useRef(loop);
  loopRef.current = loop;
  const playerRef = useRef(null);
  playerRef.current ??= createPracticePlayer(() => ({ bpm: 60, loop: loopRef.current, bass: true, click: false })); // 60 bpm: beats = seconds

  const instrument = INSTRUMENTS[instrumentId];
  const tuning = instrument.tunings[tuningId].strings;
  const noteNames = tuning.map((m) => ROOTS[m % 12]);
  const fitOpts = { tuning, frets: instrument.frets, shift };

  const stopMic = useCallback(() => {
    const mic = micRef.current;
    if (!mic) return;
    clearInterval(mic.timer);
    mic.stream.getTracks().forEach((t) => t.stop());
    mic.ctx.close();
    micRef.current = null;
    historyRef.current = [];
    setListening(false);
    setLevel(0);
    setLiveMidi(null);
  }, []);

  const startMic = async () => {
    setError('');
    let stream;
    try {
      // Speech processing (echo cancellation, noise suppression, auto gain) smears sustained pitch.
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch {
      setError("Couldn't access the microphone. Check your browser's mic permission for this page.");
      return;
    }
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = FRAME;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Float32Array(FRAME);
    const timer = setInterval(() => {
      if (playingRef.current) return; // don't transcribe our own playback
      analyser.getFloatTimeDomainData(buf);
      let sumSq = 0;
      for (let i = 0; i < buf.length; i++) sumSq += buf[i] * buf[i];
      const rms = Math.sqrt(sumSq / buf.length);
      const pitch = rms >= SILENCE_RMS ? detectPitch(buf, ctx.sampleRate) : null;
      const midi = pitch ? hzToMidi(pitch.hz) : null;
      if (framesRef.current) framesRef.current.push({ t: ctx.currentTime - recStartRef.current, midi });
      const history = historyRef.current;
      if (midi === null) history.length = 0;
      else { history.push(midi); if (history.length > SMOOTH) history.shift(); }
      setLevel(rms);
      setLiveMidi(history.length ? median(history) : null);
    }, HOP_MS);
    micRef.current = { ctx, stream, analyser, buf, timer };
    setListening(true);
  };

  const startRecording = () => {
    if (!micRef.current) return;
    playerRef.current.stop();
    setPlaying(false);
    framesRef.current = [];
    recStartRef.current = micRef.current.ctx.currentTime;
    setRecording(true);
  };
  const stopRecording = () => {
    const notes = segmentNotes(framesRef.current ?? [], { hop: HOP_MS / 1000 });
    framesRef.current = null;
    setRecording(false);
    const t0 = notes[0]?.start ?? 0;
    setSung(notes.map((n) => ({ ...n, start: n.start - t0, end: n.end - t0 })));
  };

  useEffect(() => () => { stopMic(); playerRef.current.dispose(); }, [stopMic]);

  // Live note: sung → fitted to the instrument → nearest position to the last one shown.
  const liveNote = useMemo(() => {
    if (liveMidi === null) return null;
    const { midi: sungMidi, cents } = nearestNote(440 * 2 ** ((liveMidi - 69) / 12));
    const played = fitPhrase([sungMidi], fitOpts)[0];
    if (played === null) return { sungMidi, cents, played: null };
    const { all, pick } = positionsOf(played, tuning, instrument.frets, lastFretRef.current);
    return { sungMidi, cents, played, all, pick };
  }, [liveMidi, tuning, instrument.frets, shift]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (liveNote?.pick) lastFretRef.current = liveNote.pick.fret; }, [liveNote]);

  // Recorded phrase → tab: one octave shift for the whole phrase, fingered like a player would.
  const { line, offNeck } = useMemo(() => {
    const fitted = fitPhrase(sung.map((n) => n.midi), fitOpts);
    const kept = sung.map((n, i) => ({ ...n, sungMidi: n.midi, midi: fitted[i] })).filter((n) => n.midi !== null)
      .map((n) => ({ ...n, name: midiToName(n.midi) }));
    const positions = fingerLine(kept, tuning, instrument.frets);
    return { line: kept.map((n, i) => ({ ...n, ...positions[i] })), offNeck: sung.length - kept.length };
  }, [sung, tuning, instrument.frets, shift]); // eslint-disable-line react-hooks/exhaustive-deps
  const totalBeats = line.length ? line[line.length - 1].end + 0.3 : 0;

  const stopPlayback = () => { playerRef.current.stop(); setPlaying(false); setPos({ current: -1, next: -1 }); };
  const play = (from = 0) => {
    if (!line.length) return;
    playerRef.current.start({ line, totalBeats, fromBeat: from, countIn: false, onEnd: () => { setPlaying(false); setPos({ current: -1, next: -1 }); } });
    setPlaying(true);
  };
  useEffect(() => { stopPlayback(); }, [line]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!playing) return undefined;
    let raf;
    const tick = () => {
      const b = playerRef.current.beatNow();
      if (b !== null) {
        const t = loopRef.current ? b % totalBeats : b;
        const current = findNoteAt(line, t);
        const next = findNextNote(line, t);
        setPos((p) => (p.current === current && p.next === next ? p : { current, next }));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, line, totalBeats]);

  // What the fretboard shows: playback position while playing, else the live note.
  const playCur = pos.current >= 0 ? line[pos.current] : null;
  const playNext = pos.next >= 0 ? line[pos.next] : null;
  const boardCurrent = playing
    ? playCur
    : liveNote?.pick && { ...liveNote.pick, name: midiToName(liveNote.played) };
  const boardMarks = !playing && liveNote?.all
    ? liveNote.all.filter((p) => p !== liveNote.pick).map((p) => ({ ...p, label: ROOTS[pitchClass(liveNote.played)], root: false }))
    : [];

  const pill = (selected) => ({
    padding: '6px 12px', borderRadius: 8, fontSize: 12, cursor: 'pointer', flexShrink: 0,
    border: `1px solid ${selected ? 'var(--color-accent)' : 'var(--color-border-strong)'}`,
    background: selected ? 'var(--color-accent)' : 'transparent',
    color: selected ? 'var(--color-surface)' : 'var(--color-text-2)',
  });
  const caption = { fontSize: 11, color: 'var(--color-text-3)', textTransform: 'uppercase', letterSpacing: '0.08em' };
  const row = { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' };
  const hint = { margin: 0, fontSize: 12, color: 'var(--color-text-2)' };
  const inTune = liveNote && Math.abs(liveNote.cents) <= IN_TUNE_CENTS;

  return (
    <div
      // Top-anchored so the layout doesn't jump when the tab appears.
      style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '5vh', background: 'rgba(0,0,0,0.4)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: 'var(--color-surface)', border: '1px solid var(--color-border-strong)', borderRadius: 16,
        padding: '1.5rem', width: 'min(880px, 95vw)', maxHeight: '90vh', overflowY: 'auto',
        boxShadow: '0 16px 48px rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column', gap: 14,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-text)' }}>Hum to notes</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--color-text-2)', padding: '0 4px', lineHeight: 1 }}>×</button>
        </div>

        <div style={row}>
          <span style={caption}>Instrument</span>
          {INSTRUMENT_IDS.map((id) => (
            <button key={id} style={pill(instrumentId === id)} onClick={() => { setInstrumentId(id); setTuningId(Object.keys(INSTRUMENTS[id].tunings)[0]); lastFretRef.current = null; }}>
              {INSTRUMENTS[id].label}
            </button>
          ))}
          <select value={tuningId} onChange={(e) => { setTuningId(e.target.value); lastFretRef.current = null; }} style={{ padding: 6, borderRadius: 8, marginLeft: 6 }}>
            {Object.entries(instrument.tunings).map(([id, t]) => <option key={id} value={id}>{t.label}</option>)}
          </select>
        </div>
        <div style={row}>
          <span style={caption}>Octave</span>
          {SHIFTS.map(([v, label]) => <button key={label} style={pill(shift === v)} onClick={() => setShift(v)}>{label}</button>)}
          <span style={{ fontSize: 11, color: 'var(--color-text-3)' }}>
            {shift === 'auto' ? 'Fits what you sing onto the lower neck by whole octaves.' : ''}
          </span>
        </div>

        <div style={row}>
          <button onClick={listening ? () => { if (recording) stopRecording(); stopMic(); } : startMic} style={{ ...pill(!listening), padding: '8px 16px', fontSize: 13, fontWeight: 600 }}>
            {listening ? 'Stop mic' : '🎙 Start mic'}
          </button>
          {listening && (
            <>
              <button onClick={recording ? stopRecording : startRecording}
                style={{ ...pill(recording), padding: '8px 16px', fontSize: 13, fontWeight: 600, ...(recording ? { background: 'var(--color-danger-text)', borderColor: 'var(--color-danger-text)' } : {}) }}>
                {recording ? '■ Stop recording' : '● Record a phrase'}
              </button>
              <div aria-label="Input level" style={{ width: 90, height: 6, borderRadius: 3, background: 'var(--color-surface-2)', overflow: 'hidden' }}>
                <div style={{ width: `${Math.min(100, level * 400)}%`, height: '100%', background: level >= SILENCE_RMS ? 'var(--color-note-next)' : 'var(--color-border-strong)' }} />
              </div>
            </>
          )}
        </div>
        {error && <p style={{ ...hint, color: 'var(--color-danger-text)' }}>{error}</p>}

        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, minHeight: 44, flexWrap: 'wrap' }}>
          {playing ? (
            <>
              <span style={{ fontSize: 30, fontWeight: 700, color: 'var(--color-note)' }}>{playCur?.name ?? '—'}</span>
              {playCur && <span style={{ fontSize: 13, color: 'var(--color-text-3)' }}>{noteNames[playCur.string]} string, fret {playCur.fret}</span>}
            </>
          ) : liveNote ? (
            <>
              <span style={{ fontSize: 30, fontWeight: 700, color: liveNote.played === null ? 'var(--color-text-3)' : 'var(--color-note)' }}>
                {liveNote.played === null ? 'Off the neck' : midiToName(liveNote.played)}
              </span>
              {liveNote.played !== liveNote.sungMidi && <span style={{ fontSize: 13, color: 'var(--color-text-2)' }}>sung {midiToName(liveNote.sungMidi)}</span>}
              {liveNote.pick && <span style={{ fontSize: 13, color: 'var(--color-text-3)' }}>{noteNames[liveNote.pick.string]} string, fret {liveNote.pick.fret}</span>}
              <span title="How far from the note's centre you are" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, color: inTune ? 'var(--color-note-next)' : 'var(--color-text-2)' }}>
                <svg width={120} height={14} aria-label="Tuning meter">
                  <rect x={0} y={6} width={120} height={2} fill="var(--color-border-strong)" />
                  <rect x={59} y={0} width={2} height={14} fill="var(--color-text-3)" />
                  <circle cx={60 + (liveNote.cents / 50) * 56} cy={7} r={5} fill={inTune ? 'var(--color-note-next)' : 'var(--color-note)'} />
                </svg>
                {inTune ? 'in tune' : `${liveNote.cents > 0 ? '+' : ''}${Math.round(liveNote.cents)} cents`}
              </span>
            </>
          ) : (
            <span style={{ fontSize: 14, color: 'var(--color-text-3)' }}>
              {listening ? 'Hum or sing a note…' : 'Start the mic, then hum or sing a note.'}
            </span>
          )}
        </div>

        <div style={{ flexShrink: 0 }}>
          <Fretboard tuning={tuning} frets={instrument.frets} noteNames={noteNames} current={boardCurrent || null} next={playing ? playNext : null} marks={boardMarks} />
        </div>
        {!playing && liveNote?.all?.length > 1 && <p style={hint}>The same note also sits at the other marked spots.</p>}

        {line.length > 0 && (
          <>
            <span style={caption}>Your phrase</span>
            <div style={{ flexShrink: 0 }}>
              <TabStrip line={line} tuning={tuning} noteNames={noteNames} currentIdx={pos.current} nextIdx={pos.next} onSeek={(t) => play(t)} />
            </div>
            <div style={row}>
              <button onClick={() => (playing ? stopPlayback() : play())} style={{ ...pill(true), padding: '8px 16px', fontSize: 13, fontWeight: 600 }}>
                {playing ? '■ Stop' : '▶ Play back'}
              </button>
              <button style={pill(loop)} onClick={() => setLoop((v) => !v)}>Loop</button>
              <button style={pill(false)} onClick={() => setSung([])}>Clear</button>
              <span style={{ fontSize: 12, color: 'var(--color-text-3)' }}>
                {line.length} note{line.length === 1 ? '' : 's'}{offNeck ? `, ${offNeck} off the neck (try another octave)` : ''}
              </span>
            </div>
          </>
        )}
        {!recording && sung.length === 0 && listening && (
          <p style={hint}>Tip: press "Record a phrase", hum a riff with a short gap or a clear change between notes, then stop. It becomes tab.</p>
        )}

        <span style={{ fontSize: 11, color: 'var(--color-text-3)' }}>
          Works best with one clear note at a time, humming "doo" or "dah", in a quiet room. The mic is ignored while your phrase plays back.
        </span>
      </div>
    </div>
  );
}
