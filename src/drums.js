// ─── Drum hit detection (no pitch: spectral onsets + energy profile) ───
// For a recording of just the drums. analyzeDrums() does the heavy STFT once and
// keeps compact curves; detectDrumHits() turns those into kit hits and is cheap,
// so Sensitivity can re-run it instantly (same split as noteLine.js).
//
// 1. Timing: one onset curve (the biggest rise in any band's energy), peak-picked.
// 2. Label: how much energy each hit ADDS in four bands, judged by ratios between
//    bands (not by which band "had an onset", which real stems smear together):
//      low  32–107 Hz   kick fundamental
//      body 107–430 Hz  toms, snare body
//      crack 1.5–6 kHz  snare wires, stick attack
//      air  6–11 kHz    hi-hat, cymbals
//    hi-hat/cymbal: no body, just highs · kick: low-dominated · snare: body + noise ·
//    tom: body without noise. A hi-hat on top of another drum is spotted when the air
//    band is denser than the crack band.
import { gateQuietNotes } from './loudness.js';

export const DRUMS = {
  cymbal: { label: 'Cymbal' },
  hihat:  { label: 'Hi-hat' },
  tomHigh: { label: 'High tom' },
  snare:  { label: 'Snare' },
  tomLow: { label: 'Floor tom' },
  kick:   { label: 'Kick' },
};

// Frame sizes scale with the sample rate so a frame is always ~46 ms and the hop ~11.6 ms.
// Analyse at 44.1 kHz where you can: downsampling folds bright hats/cymbals into the low bands.
const frameSize = (sampleRate) => (sampleRate > 30000 ? 2048 : 1024);
const BANDS = [[32, 107], [107, 430], [1500, 6000], [6000, 11000]]; // Hz
const [LOW, BODY, CRACK, AIR] = [0, 1, 2, 3];
const CENTROID_RANGE = [65, 345]; // Hz; separates kick / floor tom / high tom

const ONSET_OFFSET = 0.032;  // s; flux peaks on the frame whose tail first catches the attack
const MIN_FLUX = 0.7;        // ln of the energy rise (0.7 = doubling) in the strongest band that a frame needs to be a hit
const EPS = 2e-5;            // keeps the ratio finite in digital silence (samples are peak-normalised)
const DEFAULT_FRAC = 0.3;    // a hit must reach this fraction of the median candidate hit
const MIN_GAP = 0.035;       // s between hits
const EVENT_LENGTH = 0.15;   // s a hit stays "current"
const ATTACK_FRAMES = 8;     // frames after the flux peak in which the hit's energy peaks
const PRE_FRAMES = 4;        // frames before the flux peak that count as "before the hit"
const SETTLE_FROM = 3;       // frames after the flux peak over which the body pitch is read
const SETTLE_TO = 6;

const HAS_BODY = 0.5;        // body density must be at least this x the crack density to count as a drum with body
const KICK_LOW_OVER_BODY = 1.5;
const KICK_CENTROID = 100;   // Hz
const FLOOR_TOM_CENTROID = 140;
const SNARE_NOISE = 0.15;    // crack density as a fraction of body density: noise = snare wires, none = tom
const HAT_OVER_CRACK = 0.8;  // on a snare: a snare's own highs fall off, so air nearly as dense as crack means a hat is on top
const HAT_MIN_OF_BODY = 0.01; // on a kick/tom: air must be at least this fraction of the body energy (they have almost none)
const SUSTAIN_LOOKAHEAD = 0.1; // s after the hit at which a hat has died away and a cymbal still rings
const SUSTAIN_MIN = 0.06;      // s of room needed before the next hit to judge ringing; less = assume hi-hat
const CYMBAL_SUSTAIN = 0.3;    // air energy left at the lookahead (vs its peak) that means a cymbal

// ── FFT ──

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const vr = re[b] * cr - im[b] * ci;
        const vi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - vr; im[b] = im[a] - vi;
        re[a] += vr; im[a] += vi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

/**
 * STFT → onset curve (biggest band-energy rise), mean magnitude per band, and a low-frequency centroid.
 * @param {Float32Array} rawSamples mono
 * @param {number} sampleRate
 * @param {(p:number)=>void} [onProgress] 0..1
 * @returns {{hop:number, lead:number, flux:Float32Array, energy:Float32Array[], centroid:Float32Array, frames:number}}
 */
export function analyzeDrums(rawSamples, sampleRate, onProgress = () => {}) {
  const FFT_SIZE = frameSize(sampleRate);
  const HOP = FFT_SIZE / 4;
  const LEAD_IN = 2 * FFT_SIZE; // silence prepended: the flux peak sits ~3 frames before the hit, and a hit at t=0 needs a frame to jump from
  const samples = new Float32Array(LEAD_IN + rawSamples.length);
  samples.set(rawSamples, LEAD_IN);
  const half = FFT_SIZE / 2;
  const binHz = sampleRate / FFT_SIZE;
  const bins = BANDS.map(([lo, hi]) => [Math.max(1, Math.round(lo / binHz)), Math.min(half - 1, Math.round(hi / binHz))]);
  const [cLo, cHi] = CENTROID_RANGE.map((f) => Math.round(f / binHz));
  const frames = samples.length >= FFT_SIZE ? Math.floor((samples.length - FFT_SIZE) / HOP) + 1 : 0;
  const energy = BANDS.map(() => new Float32Array(frames));
  const flux = new Float32Array(frames);
  const centroid = new Float32Array(frames);
  const window = Float64Array.from({ length: FFT_SIZE }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)));
  let peak = 0;
  for (let i = 0; i < samples.length; i++) { const a = Math.abs(samples[i]); if (a > peak) peak = a; }
  const gain = peak > 0 ? 1 / peak : 0;
  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);
  const mag = new Float64Array(half);

  for (let f = 0; f < frames; f++) {
    const off = f * HOP;
    for (let i = 0; i < FFT_SIZE; i++) { re[i] = samples[off + i] * gain * window[i]; im[i] = 0; }
    fft(re, im);
    for (let k = 0; k < half; k++) mag[k] = Math.hypot(re[k], im[k]) / FFT_SIZE;
    let strongest = 0;
    bins.forEach(([lo, hi], b) => {
      let sum = 0;
      for (let k = lo; k <= hi; k++) sum += mag[k];
      const e = sum / (hi - lo + 1);
      energy[b][f] = e;
      if (f > 0) {
        const before = Math.max(energy[b][f - 1], f > 1 ? energy[b][f - 2] : 0);
        strongest = Math.max(strongest, Math.log((e + EPS) / (before + EPS)));
      }
    });
    flux[f] = strongest;
    let num = 0;
    let den = 0;
    for (let k = cLo; k <= cHi; k++) { num += k * binHz * mag[k]; den += mag[k]; }
    centroid[f] = den > 0 ? num / den : 0;
    if (f % 2000 === 0) onProgress(f / frames);
  }
  onProgress(1);
  return { hop: HOP / sampleRate, lead: LEAD_IN / sampleRate, flux, energy, centroid, frames };
}

// ── Hit detection ──

const median = (values) => {
  const s = Float64Array.from(values).sort();
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

function pickPeaks(flux, threshold, gapFrames) {
  const peaks = [];
  for (let i = 2; i < flux.length - 2; i++) {
    const v = flux[i];
    if (v < threshold || v <= flux[i - 1] || v <= flux[i - 2] || v < flux[i + 1] || v < flux[i + 2]) continue;
    const last = peaks[peaks.length - 1];
    if (last && i - last.i < gapFrames) { if (v > last.v) { last.i = i; last.v = v; } } else peaks.push({ i, v });
  }
  return peaks;
}

/** Label one hit from the energy it adds per band. */
function classify(added, centroidHz, airSustain) {
  const [low, body, crack, air] = added;
  const drums = [];
  const bodyDensity = Math.max(low, body);
  let highs = air > 0 || crack > 0; // no body: hi-hat or cymbal on its own
  if (bodyDensity > HAS_BODY * crack) {
    if (low >= KICK_LOW_OVER_BODY * body && centroidHz <= KICK_CENTROID) drums.push('kick');
    else if (crack > SNARE_NOISE * body) drums.push('snare');
    else drums.push(centroidHz < FLOOR_TOM_CENTROID ? 'tomLow' : 'tomHigh');
    // A snare's own wires reach the air band, so a hat on top must tilt the highs up;
    // kicks and toms have almost no air of their own.
    highs = drums[0] === 'snare' ? air > HAT_OVER_CRACK * crack : air > HAT_MIN_OF_BODY * bodyDensity;
  }
  if (highs) drums.push(airSustain > CYMBAL_SUSTAIN ? 'cymbal' : 'hihat');
  return drums;
}

/**
 * Raw analysis → kit hits, one event per moment (several drums can sound together).
 * @param {object} features from analyzeDrums
 * @param {{frac?: number}} [opts] frac: how strong a hit must be vs a typical hit (higher = fewer hits)
 * @returns {{start:number, end:number, drums:string[], amp:number}[]}
 */
export function detectDrumHits(features, { frac = DEFAULT_FRAC } = {}) {
  const { hop, lead = 0, flux, energy, centroid, frames } = features;
  const gapFrames = Math.max(1, Math.round(MIN_GAP / hop));
  const candidates = pickPeaks(flux, MIN_FLUX, gapFrames);
  if (!candidates.length) return [];
  const threshold = Math.max(MIN_FLUX, frac * median(candidates.map((p) => p.v)));
  const peaks = candidates.filter((p) => p.v >= threshold);

  const events = peaks.map(({ i, v }, n) => {
    const from = Math.max(0, i - PRE_FRAMES);
    const to = Math.min(frames - 1, i + ATTACK_FRAMES);
    const added = energy.map((curve) => {
      let before = Infinity;
      for (let f = from; f < i; f++) before = Math.min(before, curve[f]);
      let top = 0;
      for (let f = i; f <= to; f++) top = Math.max(top, curve[f]);
      return Math.max(0, top - (Number.isFinite(before) ? before : 0));
    });
    let cSum = 0;
    let cCount = 0;
    for (let f = i + SETTLE_FROM; f <= i + SETTLE_TO && f < frames; f++) { cSum += centroid[f]; cCount++; }
    const peakAir = Math.max(...energy[AIR].slice(i, to + 1));
    // Ringing is judged at a short lookahead that stops before the next hit, which would otherwise look like a tail.
    const room = n + 1 < peaks.length ? (peaks[n + 1].i - i) * hop - 0.02 : Infinity;
    const look = Math.min(SUSTAIN_LOOKAHEAD, room);
    const later = energy[AIR][Math.min(frames - 1, i + Math.round(look / hop))];
    const airSustain = look >= SUSTAIN_MIN && peakAir > 0 ? later / peakAir : 0;
    const drums = classify(added, cCount ? cSum / cCount : centroid[i], airSustain);
    return { start: i * hop + ONSET_OFFSET - lead, drums, amp: Math.min(1, v / 8) };
  }).filter((e) => e.drums.length);

  return events.map((e, i) => ({
    ...e,
    start: Math.max(0, Math.round(e.start * 1000) / 1000),
    end: Math.round(Math.min(e.start + EVENT_LENGTH, i + 1 < events.length ? events[i + 1].start : Infinity) * 1000) / 1000,
  }));
}

/**
 * Features → the events the view draws (each gets a display name), with hits that
 * start in near-silence removed. Cheap; re-run when Sensitivity changes.
 */
export function buildDrumLine(features, { frac = DEFAULT_FRAC, loudness = null, gateDb = -36 } = {}) {
  if (!features) return [];
  const events = gateQuietNotes(detectDrumHits(features, { frac }), loudness, gateDb);
  return events.map((e) => ({ ...e, name: e.drums.map((d) => DRUMS[d].label).join(' + ') }));
}
