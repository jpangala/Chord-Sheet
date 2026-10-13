// ─── Play-along engine for scales & licks ────────────────────
// Web Audio look-ahead scheduler: a timer queues notes/clicks slightly ahead
// on the AudioContext clock, so timing stays tight even when the UI is busy.
// Time is in beats. `beat` runs continuously from the start point (negative
// during the count-in); with loop on, pattern beat = beat mod totalBeats.
// Tempo changes re-anchor the beat clock, so they apply mid-play.
import { midiToHz } from './instruments.js';

const LOOKAHEAD = 0.12; // s scheduled ahead of the clock
const TICK_MS = 25;
const START_DELAY = 0.08;
const COUNT_IN_BEATS = 4;
const NOTE_GATE = 0.9; // share of the written length the note sounds

function bassNote(ctx, out, midi, t, dur) {
  const hz = midiToHz(midi);
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 2;
  filter.frequency.setValueAtTime(Math.min(hz * 10, 2400), t);
  filter.frequency.exponentialRampToValueAtTime(Math.max(hz * 2.5, 180), t + 0.25);
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.exponentialRampToValueAtTime(0.5, t + 0.008);
  amp.gain.exponentialRampToValueAtTime(0.3, t + 0.2);
  amp.gain.setValueAtTime(0.3, t + Math.max(dur - 0.04, 0.01));
  amp.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.04);
  filter.connect(amp).connect(out);
  for (const [type, mult, level] of [['sawtooth', 1, 0.6], ['sine', 1, 0.8]]) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = hz * mult;
    g.gain.value = level;
    osc.connect(g).connect(filter);
    osc.start(t);
    osc.stop(t + dur + 0.06);
  }
}

function click(ctx, out, t, accent) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = 'square';
  osc.frequency.value = accent ? 1600 : 1000;
  g.gain.setValueAtTime(accent ? 0.18 : 0.1, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + 0.04);
}

/**
 * opts (read live on every tick, so toggles apply mid-play):
 * { bpm, loop, bass: bool (synth plays the notes), click: bool }
 * @param {() => object} getOpts
 */
export function createPracticePlayer(getOpts) {
  let ctx = null;
  let run = null; // { line, totalBeats, out, anchorTime, anchorBeat, bpm, schedBeat, fromBeat, timer, onEnd }

  const beatAt = (t) => run.anchorBeat + ((t - run.anchorTime) * run.bpm) / 60;
  const timeAt = (b) => run.anchorTime + ((b - run.anchorBeat) * 60) / run.bpm;

  function tick() {
    const { loop, bass, click: clickOn, bpm } = getOpts();
    if (bpm !== run.bpm) { // re-anchor at the current position
      const now = ctx.currentTime;
      run.anchorBeat = beatAt(now);
      run.anchorTime = now;
      run.bpm = bpm;
    }
    const nowBeat = beatAt(ctx.currentTime);
    if (!loop && nowBeat >= run.totalBeats) { const { onEnd } = run; stop(); onEnd?.(); return; }

    const end = loop ? Infinity : run.totalBeats;
    const horizon = Math.min(beatAt(ctx.currentTime + LOOKAHEAD), end);
    const from = run.schedBeat;
    if (horizon <= from) return;

    for (let b = Math.ceil(from); b < horizon; b++) {
      if (b < 0 || clickOn) click(ctx, run.out, timeAt(b), ((b % 4) + 4) % 4 === 0);
    }
    if (bass) {
      const L = run.totalBeats;
      const lastLap = loop ? Math.floor(horizon / L) : 0;
      for (let lap = Math.max(0, Math.floor(from / L)); lap <= lastLap; lap++) {
        for (const n of run.line) {
          const b = n.start + lap * L;
          if (b < from || b >= horizon || b < run.fromBeat) continue;
          bassNote(ctx, run.out, n.midi, timeAt(b), ((n.end - n.start) * 60 * NOTE_GATE) / run.bpm);
        }
      }
    }
    run.schedBeat = horizon;
  }

  function start({ line, totalBeats, fromBeat = 0, countIn = true, onEnd }) {
    stop();
    ctx ??= new (window.AudioContext || window.webkitAudioContext)();
    ctx.resume();
    const lead = countIn ? COUNT_IN_BEATS : 0;
    const t0 = ctx.currentTime + START_DELAY;
    const out = ctx.createGain(); // per run, so Stop can silence notes already queued
    out.connect(ctx.destination);
    run = {
      out,
      line, totalBeats, fromBeat, onEnd, bpm: getOpts().bpm,
      anchorTime: t0, anchorBeat: fromBeat - lead, schedBeat: fromBeat - lead,
    };
    tick();
    run.timer = setInterval(tick, TICK_MS);
  }

  function stop() {
    if (!run) return;
    clearInterval(run.timer);
    const { out } = run;
    run = null;
    out.gain.setTargetAtTime(0, ctx.currentTime, 0.015);
    setTimeout(() => out.disconnect(), 200);
  }

  /** Current running beat (negative during count-in), or null when stopped. */
  const beatNow = () => (run && ctx ? beatAt(ctx.currentTime) : null);

  function dispose() {
    stop();
    ctx?.close();
    ctx = null;
  }

  return { start, stop, beatNow, dispose };
}
