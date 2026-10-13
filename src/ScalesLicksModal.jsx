// Scales & licks trainer for bass. Pick a scale, arpeggio or lick, a key and a
// tempo; the synth plays it with a click while the fretboard and tab follow
// along (mute the synth to play it yourself). "My licks" are tapped onto the
// fretboard and saved on this device, relative to the key so they transpose.
import { useState, useRef, useEffect, useMemo } from 'react';
import { INSTRUMENTS, midiToName, pitchClass, findNoteAt, findNextNote } from './instruments.js';
import { ROOTS } from './chords.js';
import {
  SCALES, ARPEGGIOS, LICKS, DEGREES, SCALE_PATTERNS, ARPEGGIO_PATTERNS, LICK_VARIATIONS, parseSteps, formatSteps,
  patternBeats, buildExercise, loadUserLicks, saveUserLicks,
} from './bassTheory.js';
import { createPracticePlayer } from './practicePlayer.js';
import { Fretboard } from './Fretboard.jsx';
import { TabStrip } from './TabStrip.jsx';

const BASS = INSTRUMENTS.bass;
const TABS = { scales: 'Scales', arpeggios: 'Arpeggios', licks: 'Licks', mine: 'My licks' };
const DURATIONS = [[0.25, '1/16'], [0.5, '1/8'], [1, '1/4'], [2, '1/2'], [4, 'Whole']];
const VARIATIONS = { scales: SCALE_PATTERNS, arpeggios: ARPEGGIO_PATTERNS, licks: LICK_VARIATIONS, mine: LICK_VARIATIONS };
const NO_POS = { current: -1, next: -1, count: null, yourTurn: false };

/** Tapped notes (absolute midi + position) → the same line shape buildExercise returns. */
function draftExercise(notes, rootPc) {
  const line = [];
  let t = 0;
  for (const n of notes) {
    if (!n.rest) line.push({ ...n, name: midiToName(n.midi), degree: DEGREES[pitchClass(n.midi - rootPc)], start: t, end: t + n.beats });
    t += n.beats;
  }
  return { line, totalBeats: patternBeats(notes), marks: [] };
}

export function ScalesLicksModal({ onClose }) {
  const [tab, setTab] = useState('scales');
  const [scaleId, setScaleId] = useState('major');
  const [arpId, setArpId] = useState('maj7');
  const [lickId, setLickId] = useState(LICKS[0].id);
  const [userLicks, setUserLicks] = useState(loadUserLicks);
  const [myLickId, setMyLickId] = useState(() => loadUserLicks()[0]?.id ?? null);
  const [variation, setVariation] = useState({ scales: 'updown', arpeggios: 'updown', licks: 'asWritten', mine: 'asWritten' });
  const [draft, setDraft] = useState(null); // { name, beats, notes: [{midi, string, fret, beats} | {rest, beats}] }
  const [rootPc, setRootPc] = useState(4); // E
  const [tuningId, setTuningId] = useState('standard4');
  const [octaveUp, setOctaveUp] = useState(false);
  const [bpm, setBpm] = useState(80);
  const [loop, setLoop] = useState(true);
  const [countIn, setCountIn] = useState(true);
  const [clickOn, setClickOn] = useState(true);
  const [bassOn, setBassOn] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(NO_POS);

  const optsRef = useRef(null);
  optsRef.current = { bpm, loop, bass: bassOn, click: clickOn };
  const playerRef = useRef(null);
  playerRef.current ??= createPracticePlayer(() => optsRef.current);
  const fromBeatRef = useRef(0);

  const tuning = BASS.tunings[tuningId].strings;
  const noteNames = tuning.map((m) => ROOTS[m % 12]);

  const variant = VARIATIONS[tab].find((v) => v.id === variation[tab]);
  const steps = useMemo(() => {
    if (tab === 'scales') return variant.build(SCALES.find((s) => s.id === scaleId).ivs);
    if (tab === 'arpeggios') return variant.build(ARPEGGIOS.find((a) => a.id === arpId).ivs);
    if (tab === 'licks') return variant.apply(parseSteps(LICKS.find((l) => l.id === lickId).steps));
    const mine = userLicks.find((l) => l.id === myLickId);
    return mine ? variant.apply(parseSteps(mine.steps)) : [];
  }, [tab, variant, scaleId, arpId, lickId, userLicks, myLickId]);

  const exercise = useMemo(
    () => (draft ? draftExercise(draft.notes, rootPc) : buildExercise(steps, { rootPc, tuning, frets: BASS.frets, octaveUp })),
    [draft, steps, rootPc, tuning, octaveUp],
  );
  const { line, totalBeats, marks } = exercise;
  const responseFrom = !draft && variant.id === 'callResponse' ? totalBeats / 2 : null; // second half is the player's turn

  const stop = () => { playerRef.current.stop(); setPlaying(false); setPos(NO_POS); };
  const play = (fromBeat = 0) => {
    if (!line.length) return;
    fromBeatRef.current = fromBeat;
    playerRef.current.start({ line, totalBeats, fromBeat, countIn, onEnd: () => { setPlaying(false); setPos(NO_POS); } });
    setPlaying(true);
  };

  // Anything that changes the notes stops playback.
  useEffect(() => { stop(); }, [exercise]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => playerRef.current.dispose(), []);

  // Follow the player. Re-render only when the note or count-in number changes.
  useEffect(() => {
    if (!playing) return undefined;
    let raf;
    const tick = () => {
      const b = playerRef.current.beatNow();
      if (b !== null) {
        const from = fromBeatRef.current;
        let next;
        if (b < from) next = { current: -1, next: findNextNote(line, from - 1e-6), count: Math.floor(b - from) + 5, yourTurn: false };
        else {
          const pb = loop ? b % totalBeats : b;
          const nextIdx = findNextNote(line, pb);
          const yourTurn = responseFrom !== null && pb >= responseFrom;
          next = { current: findNoteAt(line, pb), next: nextIdx < 0 && loop ? 0 : nextIdx, count: null, yourTurn };
        }
        setPos((p) => (p.current === next.current && p.next === next.next && p.count === next.count && p.yourTurn === next.yourTurn ? p : next));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, line, loop, totalBeats, responseFrom]);

  const startDraft = () => { setDraft({ name: '', beats: 0.5, notes: [] }); };
  const addToDraft = (note) => setDraft((d) => ({ ...d, notes: [...d.notes, { ...note, beats: d.beats }] }));
  const saveDraft = () => {
    const sounding = draft.notes.filter((n) => !n.rest);
    // Store intervals from the key's root just below the lowest note, so the lick transposes with the key.
    let root = Math.min(...sounding.map((n) => n.midi));
    while (pitchClass(root) !== rootPc) root--;
    const lick = {
      id: Date.now().toString(36),
      name: draft.name.trim() || `My lick ${userLicks.length + 1}`,
      steps: formatSteps(draft.notes.map((n) => (n.rest ? { rest: true, beats: n.beats } : { iv: n.midi - root, beats: n.beats }))),
    };
    const list = [...userLicks, lick];
    saveUserLicks(list);
    setUserLicks(list);
    setMyLickId(lick.id);
    setDraft(null);
  };
  const deleteLick = (id) => {
    const list = userLicks.filter((l) => l.id !== id);
    saveUserLicks(list);
    setUserLicks(list);
    setMyLickId(list[0]?.id ?? null);
  };

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
  const hint = { margin: 0, fontSize: 12, color: 'var(--color-text-2)' };
  const choices = (items, selected, onPick) => items.map((it) => (
    <button key={it.id} style={pill(it.id === selected)} onClick={() => onPick(it.id)} title={it.style}>{it.label}</button>
  ));

  return (
    <div
      // Top-anchored, not centered: the tab appears/grows while tapping in a lick, and a re-centering modal would move the fretboard under the mouse.
      style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '5vh', background: 'rgba(0,0,0,0.4)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: 'var(--color-surface)', border: '1px solid var(--color-border-strong)', borderRadius: 16,
        padding: '1.5rem', width: 'min(880px, 95vw)', maxHeight: '90vh', overflowY: 'auto',
        boxShadow: '0 16px 48px rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column', gap: 14,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-text)' }}>Scales & licks</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--color-text-2)', padding: '0 4px', lineHeight: 1 }}>×</button>
        </div>

        <div style={row}>
          {Object.entries(TABS).map(([id, label]) => (
            <button key={id} style={pill(tab === id)} disabled={!!draft} onClick={() => setTab(id)}>{label}</button>
          ))}
        </div>

        {tab === 'scales' && <div style={row}>{choices(SCALES, scaleId, setScaleId)}</div>}
        {tab === 'arpeggios' && <div style={row}>{choices(ARPEGGIOS, arpId, setArpId)}</div>}
        {tab === 'licks' && (
          <>
            <div style={row}>{choices(LICKS, lickId, setLickId)}</div>
            <p style={hint}>{LICKS.find((l) => l.id === lickId).style}. Every lick transposes to the key below.</p>
          </>
        )}
        {tab === 'mine' && !draft && (
          <>
            <div style={row}>
              {choices(userLicks.map((l) => ({ id: l.id, label: l.name })), myLickId, setMyLickId)}
              <button style={pill(false)} onClick={startDraft}>+ New lick</button>
              {myLickId && <button style={pill(false)} onClick={() => deleteLick(myLickId)}>Delete selected</button>}
            </div>
            {!userLicks.length && <p style={hint}>No licks yet. Tap "+ New lick" and click notes on the fretboard to write one.</p>}
          </>
        )}
        {draft && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 10, borderRadius: 10, background: 'var(--color-surface-2)' }}>
            <p style={hint}>Click the fretboard to add notes. Each new note gets the length selected here. Saved licks transpose with the key.</p>
            <div style={row}>
              <input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="Lick name"
                style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--color-border-strong)', background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: 13 }} />
              <span style={{ ...caption, marginLeft: 8 }}>Length</span>
              {DURATIONS.map(([b, l]) => <button key={b} style={pill(draft.beats === b)} onClick={() => setDraft((d) => ({ ...d, beats: b }))}>{l}</button>)}
            </div>
            <div style={row}>
              <button style={pill(false)} onClick={() => addToDraft({ rest: true })}>Add rest</button>
              <button style={pill(false)} disabled={!draft.notes.length} onClick={() => setDraft((d) => ({ ...d, notes: d.notes.slice(0, -1) }))}>Undo</button>
              <button style={pill(false)} disabled={!draft.notes.length} onClick={() => setDraft((d) => ({ ...d, notes: [] }))}>Clear</button>
              <span style={{ flex: 1 }} />
              <button style={pill(false)} onClick={() => setDraft(null)}>Cancel</button>
              <button style={pill(true)} disabled={!draft.notes.some((n) => !n.rest)} onClick={saveDraft}>Save lick</button>
            </div>
          </div>
        )}

        {!draft && (tab !== 'mine' || userLicks.length > 0) && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={row}>
              <span style={caption}>Variation</span>
              {VARIATIONS[tab].map((v) => (
                <button key={v.id} style={pill(v.id === variant.id)} title={v.hint}
                  onClick={() => setVariation((vs) => ({ ...vs, [tab]: v.id }))}>{v.label}</button>
              ))}
            </div>
            <p style={hint}>{variant.hint}</p>
          </div>
        )}

        <div style={row}>
          <span style={caption}>Key</span>
          {ROOTS.map((r, pc) => <button key={r} style={{ ...pill(rootPc === pc), minWidth: 36 }} onClick={() => setRootPc(pc)}>{r}</button>)}
        </div>
        <div style={row}>
          <span style={caption}>Octave</span>
          <button style={pill(!octaveUp)} disabled={!!draft} onClick={() => setOctaveUp(false)}>Low</button>
          <button style={pill(octaveUp)} disabled={!!draft} onClick={() => setOctaveUp(true)}>High</button>
          <span style={{ ...caption, marginLeft: 12 }}>Tuning</span>
          <select value={tuningId} onChange={(e) => { setTuningId(e.target.value); setDraft((d) => d && { ...d, notes: [] }); }}
            style={{ padding: 6, borderRadius: 8 }}>
            {Object.entries(BASS.tunings).map(([id, t]) => <option key={id} value={id}>{t.label}</option>)}
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, minHeight: 40 }}>
          {pos.count !== null
            ? <span style={{ fontSize: 30, fontWeight: 700, color: 'var(--color-text-3)' }}>{pos.count}…</span>
            : pos.yourTurn
            ? <span style={{ fontSize: 30, fontWeight: 700, color: 'var(--color-note-next)' }}>Your turn</span>
            : <span style={{ fontSize: 30, fontWeight: 700, color: 'var(--color-note)' }}>{current?.name ?? '—'}</span>}
          {current && <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-2)' }}>{current.degree}</span>}
          {next && <span style={{ fontSize: 14, color: 'var(--color-note-next)' }}>next: {next.name}</span>}
          {current && <span style={{ fontSize: 13, color: 'var(--color-text-3)' }}>{noteNames[current.string]} string, fret {current.fret}</span>}
        </div>

        {/* flexShrink 0: in a scrolling flex column these scroll boxes would otherwise be squashed and clip */}
        <div style={{ flexShrink: 0 }}>
          <Fretboard tuning={tuning} frets={BASS.frets} noteNames={noteNames} current={current} next={next} marks={marks}
            onPick={draft ? (string, fret) => addToDraft({ midi: tuning[string] + fret, string, fret }) : undefined} />
        </div>

        {line.length > 0
          ? <div style={{ flexShrink: 0 }}><TabStrip line={line} tuning={tuning} noteNames={noteNames} currentIdx={pos.current} nextIdx={pos.next} onSeek={(b) => play(b)} /></div>
          : !draft && tab !== 'mine' && <p style={hint}>This doesn't fit on the neck in this octave. Try the other octave or key.</p>}

        <div style={row}>
          <button onClick={() => (playing ? stop() : play())} disabled={!line.length}
            style={{ ...pill(true), padding: '8px 18px', fontSize: 13, fontWeight: 600, opacity: line.length ? 1 : 0.5 }}>
            {playing ? '■ Stop' : '▶ Play'}
          </button>
          <span style={{ ...caption, marginLeft: 8 }}>Tempo</span>
          <input type="range" min={40} max={200} step={1} value={bpm} onChange={(e) => setBpm(Number(e.target.value))} aria-label="Tempo" style={{ width: 160 }} />
          <span style={{ fontSize: 13, color: 'var(--color-text)', minWidth: 60 }}>{bpm} BPM</span>
        </div>
        <div style={row}>
          <button style={pill(loop)} onClick={() => setLoop((v) => !v)}>Loop</button>
          <button style={pill(countIn)} onClick={() => setCountIn((v) => !v)}>Count-in</button>
          <button style={pill(clickOn)} onClick={() => setClickOn((v) => !v)}>Click</button>
          <button style={pill(!bassOn)} onClick={() => setBassOn((v) => !v)}>{bassOn ? 'Mute bass (you play)' : 'Bass muted, you play'}</button>
        </div>

        <span style={{ fontSize: 11, color: 'var(--color-text-3)' }}>
          Degrees on the fretboard are counted from the key's root (R). Click any note in the tab to start from there.
          Licks are short original exercises in common styles.
        </span>
      </div>
    </div>
  );
}
