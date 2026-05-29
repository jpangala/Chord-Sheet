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
