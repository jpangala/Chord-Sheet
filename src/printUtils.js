// ─── Shared constants and helpers (also imported by App.jsx) ──

export const SEC_COLORS = {
  "Intro":        ["#E6F1FB","#185FA5","#0C447C"],
  "Verse":        ["#EAF3DE","#3B6D11","#173404"],
  "Pre-Chorus":   ["#FAEEDA","#854F0B","#412402"],
  "Chorus":       ["#FAECE7","#993C1D","#4A1B0C"],
  "Refrain":      ["#FAECE7","#D85A30","#712B13"],
  "Post-Chorus":  ["#FBEAF0","#993556","#4B1528"],
  "Bridge":       ["#EEEDFE","#534AB7","#26215C"],
  "Breakdown":    ["#F1EFE8","#5F5E5A","#2C2C2A"],
  "Instrumental": ["#E1F5EE","#0F6E56","#04342C"],
  "Solo":         ["#FAEEDA","#BA7517","#412402"],
  "Interlude":    ["#EEEDFE","#7F77DD","#3C3489"],
  "Build-Up":     ["#FCEBEB","#A32D2D","#501313"],
  "Drop":         ["#FCEBEB","#E24B4A","#501313"],
  "Outro":        ["#F1EFE8","#888780","#444441"],
  "Coda":         ["#E1F5EE","#1D9E75","#085041"],
  "Tag":          ["#FBEAF0","#D4537E","#72243E"],
};

/** Number of beats in a bar for a given time signature string like "3/4". */
export function beatsPerBar(timeSig) {
  return parseInt(timeSig.split("/")[0]);
}

/**
 * Returns the display string for a chord object, or null for no chord.
 * @param {{ root: string, qual: string, bass?: string } | null} c
 */
export function chordStr(c) {
  if (!c) return null;
  return c.root + c.qual + (c.bass ? "/" + c.bass : "");
}

// ─── Transpose ────────────────────────────────────────────────

const SHARP_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const FLAT_NAMES  = ["C","Db","D","Eb","E","F","Gb","G","Ab","A","Bb","B"];
// Tonics whose key signatures conventionally use flats.
const FLAT_KEY_TONICS = new Set(["F","Bb","Eb","Ab","Db","Gb"]);

/** Chromatic index 0-11 for a note name, or -1 if unknown. */
function chromaticIndex(name) {
  if (!name) return -1;
  const i = SHARP_NAMES.indexOf(name);
  if (i >= 0) return i;
  const j = FLAT_NAMES.indexOf(name);
  return j >= 0 ? j : -1;
}

function spell(rawIdx, useFlats) {
  const idx = ((rawIdx % 12) + 12) % 12;
  return (useFlats ? FLAT_NAMES : SHARP_NAMES)[idx];
}

/**
 * Returns a new song with `key`, every chord root, and every chord bass shifted
 * by `semitones`. Enharmonic spelling for the new key is chosen by convention:
 * if the new tonic naturally spells as a flat (Bb, Eb, Ab, Db, Gb, F), flats
 * are used across all chords; otherwise sharps. Chord qualities are untouched.
 *
 * @param {Object} song    A song record with .key and .sections[].chords.
 * @param {number} semitones  Signed integer; positive = up, negative = down.
 */
export function transposeSong(song, semitones) {
  if (!semitones) return song;
  const oldKeyIdx = chromaticIndex(song.key);
  if (oldKeyIdx < 0) return song;

  const newKeyIdx = (((oldKeyIdx + semitones) % 12) + 12) % 12;
  const flatSpelling = FLAT_NAMES[newKeyIdx];
  const useFlats = FLAT_KEY_TONICS.has(flatSpelling);
  const newKey = spell(newKeyIdx, useFlats);

  const newSections = song.sections.map((sec) => {
    const newChords = {};
    for (const [k, chord] of Object.entries(sec.chords || {})) {
      if (!chord) continue;
      const rIdx = chromaticIndex(chord.root);
      if (rIdx < 0) { newChords[k] = chord; continue; }
      const newRoot = spell(rIdx + semitones, useFlats);
      let newBass = chord.bass || "";
      if (newBass) {
        const bIdx = chromaticIndex(newBass);
        if (bIdx >= 0) newBass = spell(bIdx + semitones, useFlats);
      }
      newChords[k] = { ...chord, root: newRoot, bass: newBass };
    }
    return { ...sec, chords: newChords };
  });

  return { ...song, key: newKey, sections: newSections };
}

// ─── Print processing functions ───────────────────────────────

/**
 * Returns true if two sections have the same bar count and identical chord
 * at every beat position.
 */
export function sectionsEqual(a, b, timeSig) {
  if (a.bars !== b.bars) return false;
  const nb = beatsPerBar(timeSig);
  for (let bar = 0; bar < a.bars; bar++) {
    for (let beat = 0; beat < nb; beat++) {
      const k = `${bar}-${beat}`;
      const ca = chordStr(a.chords[k] || null);
      const cb = chordStr(b.chords[k] || null);
      if (ca !== cb) return false;
    }
  }
  return true;
}

/**
 * Collapses consecutive identical sections into runs.
 * @param {Object[]} sections
 * @param {string} timeSig
 * @returns {{ representative: Object, count: number, labels: string[] }[]}
 */
export function detectDuplicateRuns(sections, timeSig) {
  if (!sections.length) return [];
  const runs = [];
  let current = {
    representative: sections[0],
    count: 1,
    labels: [sections[0].label || sections[0].type],
  };
  for (let i = 1; i < sections.length; i++) {
    const s = sections[i];
    if (sectionsEqual(s, current.representative, timeSig)) {
      current.count++;
      current.labels.push(s.label || s.type);
    } else {
      runs.push(current);
      current = {
        representative: s,
        count: 1,
        labels: [s.label || s.type],
      };
    }
  }
  runs.push(current);
  return runs;
}

/**
 * Groups consecutive runs that share the same section type.
 * @param {{ representative: Object, count: number, labels: string[] }[]} runs
 * @returns {{ type: string, accentColor: string, textColor: string, entries: Object[] }[]}
 */
export function groupByConsecutiveType(runs) {
  if (!runs.length) return [];

  const getColors = (type) => {
    const c = SEC_COLORS[type];
    return c
      ? { accentColor: c[1], textColor: c[2] }
      : { accentColor: '#888', textColor: '#333' };
  };

  const groups = [];
  let current = {
    type: runs[0].representative.type,
    ...getColors(runs[0].representative.type),
    entries: [runs[0]],
  };

  for (let i = 1; i < runs.length; i++) {
    const run = runs[i];
    if (run.representative.type === current.type) {
      current.entries.push(run);
    } else {
      groups.push(current);
      current = {
        type: run.representative.type,
        ...getColors(run.representative.type),
        entries: [run],
      };
    }
  }
  groups.push(current);
  return groups;
}

const PRINT_COLS = 4; // bars per row in the print view

/**
 * Renders a section's bars as an array of pipe-notation strings.
 * Each string is one row of up to PRINT_COLS bars.
 * Beat columns are padded to the max chord-string length at that position
 * across ALL bars in the section.
 *
 * Format: "| beat0 beat1 … | | beat0 beat1 … |"
 *
 * @param {{ bars: number, chords: Object }} section
 * @param {string} timeSig  e.g. "3/4"
 * @returns {string[]}
 */
export function renderBarRows(section, timeSig) {
  const nb = beatsPerBar(timeSig);

  // Compute the max label width for each beat position across all bars
  const colWidths = Array(nb).fill(1);
  for (let bar = 0; bar < section.bars; bar++) {
    for (let beat = 0; beat < nb; beat++) {
      const chord = section.chords[`${bar}-${beat}`];
      const label = chordStr(chord) || '.';
      if (label.length > colWidths[beat]) colWidths[beat] = label.length;
    }
  }

  const rows = [];
  for (let rowStart = 0; rowStart < section.bars; rowStart += PRINT_COLS) {
    const rowEnd = Math.min(rowStart + PRINT_COLS, section.bars);
    const barStrs = [];
    for (let bar = rowStart; bar < rowEnd; bar++) {
      const beats = Array.from({ length: nb }, (_, bi) => {
        const chord = section.chords[`${bar}-${bi}`];
        const label = chordStr(chord) || '.';
        return label.padEnd(colWidths[bi]);
      }).join(' ');
      barStrs.push(`| ${beats} |`);
    }
    rows.push(barStrs.join(' '));
  }
  return rows;
}
