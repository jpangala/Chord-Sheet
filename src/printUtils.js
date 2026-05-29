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
