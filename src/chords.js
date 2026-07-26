// ─── Chord theory constants and parsing ──────────────────────

export const SECTION_TYPES = [
  "Intro","Verse","Pre-Chorus","Chorus","Refrain","Post-Chorus",
  "Bridge","Breakdown","Instrumental","Solo","Interlude",
  "Build-Up","Drop","Outro","Coda","Tag",
];

export const TIME_SIGS = ["2/4","3/4","4/4","5/4","6/8","7/8","12/8"];

export const ROOTS = ["C","C#","D","Eb","E","F","F#","G","Ab","A","Bb","B"];

export const QUALITIES = [
  {v:"",   l:"maj"},  {v:"m",    l:"min"},   {v:"7",    l:"7"},
  {v:"maj7",l:"maj7"},{v:"m7",   l:"m7"},    {v:"6",    l:"6"},
  {v:"m6", l:"m6"},   {v:"9",    l:"9"},     {v:"maj9", l:"maj9"},
  {v:"m9", l:"m9"},   {v:"dim",  l:"dim"},   {v:"dim7", l:"dim7"},
  {v:"aug",l:"aug"},  {v:"sus2", l:"sus2"},  {v:"sus4", l:"sus4"},
  {v:"add9",l:"add9"},{v:"13",   l:"13"},    {v:"5",    l:"5 (power)"},
];

// Roots sorted longest-first so "C#" wins over "C" during prefix-matching.
export const ROOTS_BY_LEN = [...ROOTS].sort((a, b) => b.length - a.length);

// Quality VALUES (not labels) sorted longest-first so "maj7" wins over "maj".
export const QUAL_VALS_BY_LEN = QUALITIES.map((q) => q.v).filter((v) => v.length > 0).sort((a, b) => b.length - a.length);

export function parseChord(text) {
  if (!text) return null;
  let s = text.trim();
  if (!s) return null;
  // Auto-capitalize first letter so "cm7" → "Cm7"
  if (/^[a-g]/.test(s)) s = s[0].toUpperCase() + s.slice(1);
  let root = null;
  for (const r of ROOTS_BY_LEN) {
    if (s.startsWith(r)) { root = r; s = s.slice(r.length); break; }
  }
  if (!root) return null;
  let qual = "";
  for (const q of QUAL_VALS_BY_LEN) {
    if (s.startsWith(q)) { qual = q; s = s.slice(q.length); break; }
  }
  let bass = "";
  if (s.startsWith("/")) {
    s = s.slice(1);
    if (/^[a-g]/.test(s)) s = s[0].toUpperCase() + s.slice(1);
    for (const r of ROOTS_BY_LEN) {
      if (s.startsWith(r)) { bass = r; s = s.slice(r.length); break; }
    }
    if (!bass) return null;
  }
  if (s.length > 0) return null; // trailing garbage
  return { root, qual, bass };
}

// Full chord namespace (~2,500 strings), generated once.
export const ALL_CHORDS = (() => {
  const out = [];
  for (const r of ROOTS) {
    for (const q of QUALITIES) {
      out.push(r + q.v);
      for (const b of ROOTS) {
        if (b !== r) out.push(r + q.v + "/" + b);
      }
    }
  }
  return out;
})();

export function getChordSuggestions(text, limit = 8) {
  const t = (text || "").trim();
  if (!t) return [];
  // Case-insensitive prefix; preserve exact-case match in the list.
  const tl = t.toLowerCase();
  const out = [];
  for (const c of ALL_CHORDS) {
    if (c.toLowerCase().startsWith(tl) && c !== t) {
      out.push(c);
      if (out.length >= limit) break;
    }
  }
  return out;
}
