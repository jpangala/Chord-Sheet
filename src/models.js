// ─── Song / section factories and localStorage persistence ───

let _idN = 0;
export function uid() { return `id${Date.now()}${++_idN}`; }

const SECTION_RANK = Object.fromEntries(
  ["Intro","Verse","Pre-Chorus","Chorus","Refrain","Post-Chorus",
   "Bridge","Breakdown","Instrumental","Solo","Interlude",
   "Build-Up","Drop","Outro","Coda","Tag"].map((t, i) => [t, i])
);

export function sortSections(sections) {
  // Array.prototype.sort is stable (ES2019+), so equal ranks keep insertion order.
  return [...sections].sort((a, b) =>
    (SECTION_RANK[a.type] ?? 999) - (SECTION_RANK[b.type] ?? 999)
  );
}

export function makeSection(type) {
  return { id: uid(), type, label: "", bars: 4, chords: {} };
}

export function makeSong() {
  return { title: "", artist: "", key: "C", bpm: 120, timeSig: "4/4" };
}

export function makeSongRecord(meta) {
  const now = Date.now();
  const m = meta || {};
  return {
    id: uid(),
    title: m.title || "",
    artist: m.artist || "",
    key: m.key || "C",
    bpm: m.bpm ?? 120,
    timeSig: m.timeSig || "4/4",
    sections: [makeSection("Intro")],
    createdAt: now,
    updatedAt: now,
  };
}

export function timeAgo(ts) {
  if (!ts) return "";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

// ─── Persistence (localStorage) ───────────────────────────────
// v2 shape: { songs: SongRecord[], currentSongId: string|null }
// v1 shape (legacy): { song, sections }  — migrated on first load.
const LS_V1 = "chordsheet_v1";
const LS_V2 = "chordsheet_v2";

export function loadData() {
  try {
    const raw = localStorage.getItem(LS_V2);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.songs)) return parsed;
    }
  } catch {}
  // Migrate from v1 single-song shape
  try {
    const rawV1 = localStorage.getItem(LS_V1);
    if (rawV1) {
      const old = JSON.parse(rawV1);
      if (old?.song?.title) {
        const now = Date.now();
        const migrated = {
          id: uid(),
          title: old.song.title,
          artist: old.song.artist || "",
          key: old.song.key || "C",
          bpm: old.song.bpm ?? 120,
          timeSig: old.song.timeSig || "4/4",
          sections: Array.isArray(old.sections) && old.sections.length
            ? old.sections
            : [makeSection("Intro")],
          createdAt: now,
          updatedAt: now,
        };
        return { songs: [migrated], currentSongId: null };
      }
    }
  } catch {}
  return { songs: [], currentSongId: null };
}

export function saveData(data) {
  try { localStorage.setItem(LS_V2, JSON.stringify(data)); } catch {}
}
