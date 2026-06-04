import { SEC_COLORS, beatsPerBar, chordStr, detectDuplicateRuns, groupByConsecutiveType, renderBarRows, transposeSong } from './printUtils.js';
import { cloudDeleteSong, cloudFetchSongs, cloudSaveSong, isCloudEnabled } from './cloud.js';
import { useState, useEffect, useRef, useCallback } from "react";

const CLOUD_ON = isCloudEnabled();

// ─── Constants ────────────────────────────────────────────────
const SECTION_TYPES = [
  "Intro","Verse","Pre-Chorus","Chorus","Refrain","Post-Chorus",
  "Bridge","Breakdown","Instrumental","Solo","Interlude",
  "Build-Up","Drop","Outro","Coda","Tag",
];
const TIME_SIGS = ["2/4","3/4","4/4","5/4","6/8","7/8","12/8"];
const ROOTS = ["C","C#","D","Eb","E","F","F#","G","Ab","A","Bb","B"];
const QUALITIES = [
  {v:"",   l:"maj"},  {v:"m",    l:"min"},   {v:"7",    l:"7"},
  {v:"maj7",l:"maj7"},{v:"m7",   l:"m7"},    {v:"6",    l:"6"},
  {v:"m6", l:"m6"},   {v:"9",    l:"9"},     {v:"maj9", l:"maj9"},
  {v:"m9", l:"m9"},   {v:"dim",  l:"dim"},   {v:"dim7", l:"dim7"},
  {v:"aug",l:"aug"},  {v:"sus2", l:"sus2"},  {v:"sus4", l:"sus4"},
  {v:"add9",l:"add9"},{v:"13",   l:"13"},    {v:"5",    l:"5 (power)"},
];
// ─── Helpers ──────────────────────────────────────────────────
let _idN = 0;
function uid() { return `id${Date.now()}${++_idN}`; }

// Canonical song-flow rank — preserves the user's insertion order within a type.
const SECTION_RANK = Object.fromEntries(
  ["Intro","Verse","Pre-Chorus","Chorus","Refrain","Post-Chorus",
   "Bridge","Breakdown","Instrumental","Solo","Interlude",
   "Build-Up","Drop","Outro","Coda","Tag"].map((t, i) => [t, i])
);
function sortSections(sections) {
  // Array.prototype.sort is stable (ES2019+), so equal ranks keep insertion order.
  return [...sections].sort((a, b) =>
    (SECTION_RANK[a.type] ?? 999) - (SECTION_RANK[b.type] ?? 999)
  );
}

function makeSection(type) {
  return { id: uid(), type, label: "", bars: 4, chords: {} };
}
function makeSong() {
  return { title: "", artist: "", key: "C", bpm: 120, timeSig: "4/4" };
}
function makeSongRecord(meta) {
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

function timeAgo(ts) {
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
function loadData() {
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
function saveData(data) {
  try { localStorage.setItem(LS_V2, JSON.stringify(data)); } catch {}
}

// ─────────────────────────────────────────────────────────────
// Chord parsing & autocomplete namespace
// ─────────────────────────────────────────────────────────────
// Roots sorted longest-first so "C#" wins over "C" during prefix-matching.
const ROOTS_BY_LEN = [...ROOTS].sort((a, b) => b.length - a.length);
// Quality VALUES (not labels) sorted longest-first so "maj7" wins over "maj".
const QUAL_VALS_BY_LEN = QUALITIES.map((q) => q.v).filter((v) => v.length > 0).sort((a, b) => b.length - a.length);

function parseChord(text) {
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
const ALL_CHORDS = (() => {
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

function getChordSuggestions(text, limit = 8) {
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

// ─────────────────────────────────────────────────────────────
// Chord Picker Modal
// ─────────────────────────────────────────────────────────────
function ChordPicker({ sectionId, barIdx, beatIdx, sections, onSet, onClose }) {
  const sec = sections.find((s) => s.id === sectionId);
  const existing = sec?.chords[`${barIdx}-${beatIdx}`] || null;
  const [root, setRoot] = useState(existing?.root || "C");
  const [qual, setQual] = useState(existing?.qual ?? "");
  const [bass, setBass] = useState(existing?.bass || "");
  const [text, setText] = useState(chordStr(existing) || (existing ? "" : "C"));
  const [showSuggest, setShowSuggest] = useState(false);
  const [activeSuggest, setActiveSuggest] = useState(0);
  const ref = useRef();
  const inputRef = useRef();

  const suggestions = showSuggest ? getChordSuggestions(text) : [];

  const commitTyped = (raw) => {
    setText(raw);
    const parsed = parseChord(raw);
    if (parsed) {
      setRoot(parsed.root);
      setQual(parsed.qual);
      setBass(parsed.bass);
    }
    setActiveSuggest(0);
  };

  const pickFromButton = (next) => {
    const nr = next.root ?? root;
    const nq = next.qual ?? qual;
    const nb = next.bass ?? bass;
    if (next.root !== undefined) setRoot(nr);
    if (next.qual !== undefined) setQual(nq);
    if (next.bass !== undefined) setBass(nb);
    setText(chordStr({ root: nr, qual: nq, bass: nb }) || "");
    setShowSuggest(false);
  };

  const applySuggestion = (s) => {
    commitTyped(s);
    setShowSuggest(false);
    inputRef.current?.focus();
  };

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    const h = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  const preview = chordStr({ root, qual, bass }) || "—";

  const btn = (active) => ({
    padding: "6px 4px",
    borderRadius: 6,
    border: "1px solid",
    borderColor: active ? "#378ADD" : "var(--color-border)",
    background: active ? "#E6F1FB" : "transparent",
    color: active ? "#0C447C" : "var(--color-text)",
    fontSize: 12,
    fontWeight: active ? 600 : 400,
    cursor: "pointer",
    transition: "all 0.1s",
  });

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(0,0,0,0.4)",
      }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={ref}
        style={{
          background: "var(--color-surface)",
          border: "1px solid var(--color-border-strong)",
          borderRadius: 16, padding: "1.5rem",
          width: 340, maxHeight: "90vh", overflowY: "auto",
          boxShadow: "0 16px 48px rgba(0,0,0,0.2)",
          display: "flex", flexDirection: "column", gap: 16,
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 12, color: "var(--color-text-3)" }}>
            Bar {barIdx + 1} · Beat {beatIdx + 1}
          </span>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "var(--color-text-2)", padding: "0 4px", lineHeight: 1 }}
          >×</button>
        </div>

        {/* Preview */}
        <div style={{ textAlign: "center", padding: "0.75rem", background: "var(--color-surface-2)", borderRadius: 10 }}>
          <div style={{ fontSize: 36, fontWeight: 700, fontFamily: "var(--font-serif)", color: "var(--color-text)", lineHeight: 1 }}>
            {preview}
          </div>
        </div>

        {/* Typed input with autocomplete */}
        <div style={{ position: "relative" }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: "var(--color-text-3)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.08em" }}>Type</div>
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => { commitTyped(e.target.value); setShowSuggest(true); }}
            onFocus={() => setShowSuggest(true)}
            onBlur={() => setTimeout(() => setShowSuggest(false), 120)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" && suggestions.length) {
                e.preventDefault();
                setActiveSuggest((i) => Math.min(suggestions.length - 1, i + 1));
              } else if (e.key === "ArrowUp" && suggestions.length) {
                e.preventDefault();
                setActiveSuggest((i) => Math.max(0, i - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                if (showSuggest && suggestions[activeSuggest]) {
                  applySuggestion(suggestions[activeSuggest]);
                } else if (parseChord(text)) {
                  onSet(parseChord(text));
                }
              } else if (e.key === "Escape" && showSuggest) {
                e.preventDefault();
                setShowSuggest(false);
              }
            }}
            placeholder="e.g. Cmaj7, Am, Dm7/F"
            style={{
              width: "100%", padding: "8px 10px", borderRadius: 8,
              border: parseChord(text) || !text ? "1px solid var(--color-border-strong)" : "1px solid var(--color-danger-border)",
              background: "var(--color-surface)", color: "var(--color-text)",
              fontSize: 14, fontFamily: "var(--font-serif)", outline: "none",
            }}
          />
          {showSuggest && suggestions.length > 0 && (
            <div style={{
              position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
              background: "var(--color-surface)",
              border: "1px solid var(--color-border-strong)",
              borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
              zIndex: 10, maxHeight: 220, overflowY: "auto",
            }}>
              {suggestions.map((s, i) => (
                <div
                  key={s}
                  onMouseDown={(e) => { e.preventDefault(); applySuggestion(s); }}
                  onMouseEnter={() => setActiveSuggest(i)}
                  style={{
                    padding: "6px 10px", cursor: "pointer",
                    fontSize: 13, fontFamily: "var(--font-serif)",
                    background: i === activeSuggest ? "var(--color-surface-2)" : "transparent",
                    color: "var(--color-text)",
                  }}
                >{s}</div>
              ))}
            </div>
          )}
        </div>

        {/* Root */}
        <div>
          <div style={{ fontSize: 10, fontWeight: 600, color: "var(--color-text-3)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.08em" }}>Root</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 4 }}>
            {ROOTS.map((r) => (
              <button key={r} onClick={() => pickFromButton({ root: r })} style={btn(root === r)}>{r}</button>
            ))}
          </div>
        </div>

        {/* Quality */}
        <div>
          <div style={{ fontSize: 10, fontWeight: 600, color: "var(--color-text-3)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.08em" }}>Quality</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 4 }}>
            {QUALITIES.map((q) => (
              <button key={q.v} onClick={() => pickFromButton({ qual: q.v })} style={btn(qual === q.v)}>{q.l}</button>
            ))}
          </div>
        </div>

        {/* Bass */}
        <div>
          <div style={{ fontSize: 10, fontWeight: 600, color: "var(--color-text-3)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.08em" }}>Bass note (slash chord)</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 4 }}>
            <button onClick={() => pickFromButton({ bass: "" })} style={btn(bass === "")}>none</button>
            {ROOTS.map((r) => (
              <button key={r} onClick={() => pickFromButton({ bass: r })} style={btn(bass === r)}>{r}</button>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 8, paddingTop: 4 }}>
          <button
            onClick={() => onSet(null)}
            style={{
              flex: 1, padding: "9px", borderRadius: 8,
              border: "1px solid var(--color-border-strong)",
              background: "transparent", color: "var(--color-text-2)",
              fontSize: 13, cursor: "pointer",
            }}
          >Clear beat</button>
          <button
            onClick={() => onSet({ root, qual, bass })}
            style={{
              flex: 2, padding: "9px", borderRadius: 8, border: "none",
              background: "var(--color-accent)", color: "var(--color-bg)",
              fontSize: 13, fontWeight: 600, cursor: "pointer",
            }}
          >Set chord ↵</button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Beat Cell
// ─────────────────────────────────────────────────────────────
function BeatCell({ chord, isFirst, onClick }) {
  const [hov, setHov] = useState(false);
  const label = chordStr(chord);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        flex: 1, minHeight: 54,
        display: "flex", alignItems: "center", justifyContent: "center",
        cursor: "pointer", position: "relative",
        borderLeft: isFirst ? "none" : "1px dashed var(--color-border)",
        background: hov ? "var(--color-surface-2)" : "transparent",
        transition: "background 0.1s",
      }}
    >
      {label ? (
        <span style={{
          fontSize: label.length > 7 ? 10 : label.length > 5 ? 11 : label.length > 3 ? 13 : 16,
          fontWeight: 700,
          fontFamily: "var(--font-serif)",
          color: "var(--color-text)",
          lineHeight: 1, userSelect: "none",
          textAlign: "center", padding: "0 2px",
        }}>{label}</span>
      ) : (
        <span style={{ color: "var(--color-border-strong)", fontSize: 20, userSelect: "none", opacity: 0.6 }}>·</span>
      )}
      {hov && (
        <div style={{ position: "absolute", top: 3, right: 4, fontSize: 9, color: "var(--color-text-3)", opacity: 0.8, userSelect: "none" }}>+</div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Bar Block
// ─────────────────────────────────────────────────────────────
function BarBlock({ barIdx, numBeats, chords, sectionId, onBeatClick }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column",
      border: "1px solid var(--color-border-strong)",
      borderRadius: 6, overflow: "hidden",
      background: "var(--color-surface)", minWidth: 0,
    }}>
      <div style={{
        fontSize: 9, color: "var(--color-text-3)", padding: "2px 5px",
        borderBottom: "1px solid var(--color-border)",
        background: "var(--color-surface-2)",
        userSelect: "none", lineHeight: "14px",
      }}>{barIdx + 1}</div>
      <div style={{ display: "flex", flex: 1 }}>
        {Array.from({ length: numBeats }).map((_, bi) => (
          <BeatCell
            key={bi}
            chord={chords[`${barIdx}-${bi}`] || null}
            isFirst={bi === 0}
            onClick={() => onBeatClick(sectionId, barIdx, bi)}
          />
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Section Block
// ─────────────────────────────────────────────────────────────
function SectionBlock({ section, timeSig, onUpdate, onRemove, onDuplicate, onBeatClick }) {
  const nb = beatsPerBar(timeSig);
  const [bg, accent, textC] = SEC_COLORS[section.type] || ["#F1EFE8","#5F5E5A","#2C2C2A"];
  const COLS = 4;
  const rows = [];
  for (let i = 0; i < section.bars; i += COLS) {
    rows.push(Array.from({ length: Math.min(COLS, section.bars - i) }, (_, j) => i + j));
  }

  return (
    <div style={{
      borderRadius: 10, overflow: "hidden",
      border: `1.5px solid ${accent}50`,
      marginBottom: "1rem",
      background: "var(--color-surface)",
    }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "7px 12px",
        background: bg,
        borderBottom: `2px solid ${accent}`,
      }}>
        <span style={{
          fontSize: 10, fontWeight: 800, letterSpacing: "0.12em",
          textTransform: "uppercase", color: textC,
          userSelect: "none", whiteSpace: "nowrap",
        }}>{section.type}</span>

        <input
          value={section.label}
          onChange={(e) => onUpdate("label", e.target.value)}
          placeholder="custom label…"
          style={{
            fontSize: 11, background: "transparent", border: "none",
            borderBottom: `1px dashed ${accent}80`, color: textC,
            outline: "none", width: 100, padding: "1px 2px",
          }}
        />

        <div style={{ flex: 1 }} />

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 11, color: textC, opacity: 0.8, whiteSpace: "nowrap" }}>
            {section.bars} bar{section.bars !== 1 ? "s" : ""}
          </span>
          {[["−", () => onUpdate("bars", Math.max(1, section.bars - 1))],
            ["+", () => onUpdate("bars", section.bars + 1)]
          ].map(([lbl, fn]) => (
            <button key={lbl} onClick={fn} style={{
              width: 22, height: 22, borderRadius: 4,
              border: `1px solid ${accent}70`,
              background: "transparent", color: textC,
              fontSize: 15, cursor: "pointer", lineHeight: 1,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>{lbl}</button>
          ))}
        </div>

        <button onClick={onDuplicate} title="Duplicate section" style={{
          width: 22, height: 22, borderRadius: 4,
          border: `1px solid ${accent}70`,
          background: "transparent", color: textC,
          fontSize: 11, cursor: "pointer", opacity: 0.75,
        }}>⧉</button>

        <button onClick={onRemove} title="Remove section" style={{
          width: 22, height: 22, borderRadius: 4,
          border: `1px solid ${accent}70`,
          background: "transparent", color: textC,
          fontSize: 18, cursor: "pointer", opacity: 0.65, lineHeight: 1,
        }}>×</button>
      </div>

      {/* Bars grid */}
      <div style={{ padding: "10px 12px" }}>
        {rows.map((rowBars, ri) => (
          <div key={ri} style={{
            display: "grid",
            gridTemplateColumns: `repeat(${rowBars.length}, 1fr)`,
            gap: 8, marginBottom: ri < rows.length - 1 ? 8 : 0,
          }}>
            {rowBars.map((barIdx) => (
              <BarBlock
                key={barIdx}
                barIdx={barIdx}
                numBeats={nb}
                chords={section.chords}
                sectionId={section.id}
                onBeatClick={onBeatClick}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Add Section Menu
// ─────────────────────────────────────────────────────────────
function AddSectionMenu({ onAdd }) {
  const [open, setOpen] = useState(false);
  const ref = useRef();

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          padding: "7px 14px", borderRadius: 8,
          border: "1px solid var(--color-border-strong)",
          background: "var(--color-surface)", color: "var(--color-text)",
          fontSize: 13, fontWeight: 500, cursor: "pointer",
          display: "flex", alignItems: "center", gap: 6, minHeight: 34,
        }}
      >
        <span style={{ fontSize: 16, lineHeight: 1, fontWeight: 300 }}>+</span> Add section
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 200,
          background: "var(--color-surface)",
          border: "1px solid var(--color-border-strong)",
          borderRadius: 12, padding: 8, minWidth: 220,
          boxShadow: "0 8px 32px rgba(0,0,0,0.15)",
          display: "grid", gridTemplateColumns: "1fr 1fr", gap: 3,
        }}>
          {SECTION_TYPES.map((t) => {
            const [bg,, textC] = SEC_COLORS[t] || ["#F1EFE8","#5F5E5A","#2C2C2A"];
            return (
              <button key={t} onClick={() => { onAdd(t); setOpen(false); }} style={{
                padding: "6px 10px", borderRadius: 6, border: "none",
                background: bg, color: textC,
                fontSize: 12, fontWeight: 500, cursor: "pointer", textAlign: "left",
              }}>{t}</button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Setup Screen
// ─────────────────────────────────────────────────────────────
function SetupScreen({ song, isEditing, onDone, onCancel }) {
  const [s, setS] = useState(song);
  const upd = (k, v) => setS((p) => ({ ...p, [k]: v }));
  const submit = () => {
    const bpm = s.bpm === "" || s.bpm == null ? 120 : s.bpm;
    onDone({ ...s, bpm });
  };
  const canSubmit = s.title.trim().length > 0;

  const field = {
    width: "100%", padding: "9px 12px", borderRadius: 8,
    border: "1px solid var(--color-border-strong)",
    background: "var(--color-surface)", color: "var(--color-text)",
    fontSize: 14, outline: "none",
  };

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "var(--color-bg)", padding: "2rem",
    }}>
      <div style={{
        background: "var(--color-surface)", borderRadius: 18, padding: "2.5rem",
        width: "100%", maxWidth: 460,
        border: "1px solid var(--color-border)",
        boxShadow: "0 4px 24px rgba(0,0,0,0.06)",
      }}>
        <div style={{ textAlign: "center", marginBottom: "2rem" }}>
          <div style={{ fontSize: 44, lineHeight: 1, marginBottom: 10 }}>♪</div>
          <h1 style={{
            fontSize: 26, fontWeight: 700, margin: 0,
            fontFamily: "var(--font-serif)", color: "var(--color-text)",
          }}>{isEditing ? "Edit song" : "New song"}</h1>
          <p style={{ fontSize: 14, color: "var(--color-text-2)", margin: "6px 0 0" }}>
            {isEditing ? "Update song details" : "Build and organize your song charts"}
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 500, color: "var(--color-text-2)", display: "block", marginBottom: 5 }}>Song title *</label>
            <input
              value={s.title}
              onChange={(e) => upd("title", e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && canSubmit) submit(); }}
              placeholder="e.g. Bohemian Rhapsody"
              autoFocus
              style={field}
            />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 500, color: "var(--color-text-2)", display: "block", marginBottom: 5 }}>Artist / Band</label>
            <input
              value={s.artist}
              onChange={(e) => upd("artist", e.target.value)}
              placeholder="e.g. Queen"
              style={field}
            />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            {[
              { label: "Key", el: <select value={s.key} onChange={(e) => upd("key", e.target.value)} style={field}>{ROOTS.map((r) => <option key={r}>{r}</option>)}</select> },
              { label: "BPM", el: <input
                  type="text"
                  inputMode="numeric"
                  value={s.bpm}
                  onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, "");
                    upd("bpm", v === "" ? "" : parseInt(v, 10));
                  }}
                  onBlur={(e) => { if (e.target.value === "") upd("bpm", 120); }}
                  style={field}
                /> },
              { label: "Time sig.", el: <select value={s.timeSig} onChange={(e) => upd("timeSig", e.target.value)} style={field}>{TIME_SIGS.map((t) => <option key={t}>{t}</option>)}</select> },
            ].map(({ label, el }) => (
              <div key={label}>
                <label style={{ fontSize: 12, fontWeight: 500, color: "var(--color-text-2)", display: "block", marginBottom: 5 }}>{label}</label>
                {el}
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            {onCancel && (
              <button
                onClick={onCancel}
                style={{
                  flex: 1, padding: "11px", borderRadius: 10,
                  border: "1px solid var(--color-border-strong)",
                  background: "transparent", color: "var(--color-text-2)",
                  fontSize: 14, cursor: "pointer",
                }}
              >Cancel</button>
            )}
            <button
              onClick={() => canSubmit && submit()}
              disabled={!canSubmit}
              style={{
                flex: 2, padding: "11px", borderRadius: 10, border: "none",
                background: canSubmit ? "var(--color-accent)" : "var(--color-border)",
                color: canSubmit ? "var(--color-bg)" : "var(--color-text-3)",
                fontSize: 15, fontWeight: 600,
                cursor: canSubmit ? "pointer" : "not-allowed",
                transition: "background 0.2s",
              }}
            >{isEditing ? "Save →" : "Start editing →"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Library Screen
// ─────────────────────────────────────────────────────────────
const cardIconBtn = {
  width: 26, height: 26, borderRadius: 5,
  border: "1px solid var(--color-border)",
  background: "transparent", color: "var(--color-text-2)",
  fontSize: 14, cursor: "pointer", lineHeight: 1,
  display: "flex", alignItems: "center", justifyContent: "center",
};

function LibraryScreen({ songs, onOpen, onNew, onDuplicate, onDelete, onPullFromCloud, cloudStatus }) {
  const [q, setQ] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(null);

  const ql = q.trim().toLowerCase();
  const filtered = !ql
    ? songs
    : songs.filter(s =>
        (s.title || "").toLowerCase().includes(ql) ||
        (s.artist || "").toLowerCase().includes(ql));
  const sorted = [...filtered].sort(
    (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)
  );

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "2rem 1rem 5rem" }}>
      <div style={{
        display: "flex", alignItems: "flex-start", justifyContent: "space-between",
        flexWrap: "wrap", gap: 14, marginBottom: "1.5rem",
      }}>
        <div>
          <h1 style={{
            margin: 0, fontSize: 28, fontWeight: 700,
            fontFamily: "var(--font-serif)", color: "var(--color-text)",
          }}>♪ ChordSheet</h1>
          <p style={{ margin: "4px 0 0", fontSize: 14, color: "var(--color-text-2)" }}>
            {songs.length === 0
              ? "Your library is empty"
              : `${songs.length} song${songs.length === 1 ? "" : "s"}`}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {songs.length > 0 && (
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search title or artist…"
              style={{
                padding: "7px 12px", borderRadius: 8,
                border: "1px solid var(--color-border-strong)",
                background: "var(--color-surface)", color: "var(--color-text)",
                fontSize: 13, outline: "none", width: 220, minHeight: 34,
              }}
            />
          )}
          {onPullFromCloud && (
            <button
              onClick={onPullFromCloud}
              disabled={cloudStatus?.saving}
              title="Pull songs from the cloud (merges with local)"
              style={{
                padding: "7px 14px", borderRadius: 8,
                border: "1px solid var(--color-border-strong)",
                background: "var(--color-surface)", color: "var(--color-text)",
                fontSize: 13, fontWeight: 500, cursor: cloudStatus?.saving ? "wait" : "pointer",
                display: "inline-flex", alignItems: "center", gap: 6, minHeight: 34,
                opacity: cloudStatus?.saving ? 0.7 : 1,
              }}
            >☁ {cloudStatus?.saving ? "Syncing…" : "Pull from cloud"}</button>
          )}
          <button
            onClick={onNew}
            style={{
              padding: "7px 14px", borderRadius: 8, border: "none",
              background: "var(--color-accent)", color: "var(--color-bg)",
              fontSize: 13, fontWeight: 600, cursor: "pointer",
              display: "inline-flex", alignItems: "center", gap: 6, minHeight: 34,
            }}
          >
            <span style={{ fontSize: 16, lineHeight: 1, fontWeight: 300 }}>+</span> New song
          </button>
        </div>
      </div>
      {cloudStatus?.error && (
        <div style={{
          marginBottom: "1rem", padding: "8px 14px", borderRadius: 8,
          background: "var(--color-danger-bg)",
          border: "1px solid var(--color-danger-border)",
          fontSize: 12, color: "var(--color-danger-text)",
        }}>Cloud sync failed: {cloudStatus.error}</div>
      )}

      {songs.length === 0 ? (
        <div style={{
          textAlign: "center", padding: "4rem 2rem",
          color: "var(--color-text-3)",
          border: "2px dashed var(--color-border)",
          borderRadius: 14,
        }}>
          <div style={{ fontSize: 48, marginBottom: 14 }}>♩</div>
          <p style={{ margin: 0, fontSize: 16 }}>No songs yet.</p>
          <p style={{ margin: "6px 0 0", fontSize: 13, opacity: 0.7 }}>
            Click <strong>+ New song</strong> to start your first chart.
          </p>
        </div>
      ) : sorted.length === 0 ? (
        <p style={{ color: "var(--color-text-3)", textAlign: "center", padding: "2rem", fontSize: 13 }}>
          No songs match &quot;{q}&quot;.
        </p>
      ) : (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
          gap: 12,
        }}>
          {sorted.map((s) => (
            <div
              key={s.id}
              onClick={() => onOpen(s.id)}
              style={{
                background: "var(--color-surface)",
                border: "1px solid var(--color-border)",
                borderRadius: 10, padding: "14px 16px",
                display: "flex", flexDirection: "column", gap: 8,
                cursor: "pointer", transition: "border-color 0.15s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--color-border-strong)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--color-border)"; }}
            >
              <div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                  <div style={{
                    flex: 1,
                    fontSize: 17, fontWeight: 700, fontFamily: "var(--font-serif)",
                    color: "var(--color-text)", lineHeight: 1.2,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>{s.title || "Untitled"}</div>
                  {s.cloudSyncedAt && (
                    <span
                      title={`Synced ${timeAgo(s.cloudSyncedAt)}`}
                      style={{ fontSize: 11, color: "var(--color-text-3)", flexShrink: 0 }}
                    >☁</span>
                  )}
                </div>
                {s.artist && (
                  <div style={{
                    fontSize: 13, color: "var(--color-text-2)", marginTop: 2,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>{s.artist}</div>
                )}
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {[["Key", s.key], ["BPM", s.bpm], ["Time", s.timeSig]].map(([l, v]) => (
                  <span key={l} style={{
                    fontSize: 11, color: "var(--color-text-2)",
                    background: "var(--color-surface-2)", borderRadius: 5,
                    padding: "2px 7px", border: "1px solid var(--color-border)",
                  }}>
                    <span style={{ opacity: 0.65 }}>{l}: </span>
                    <span style={{ fontWeight: 600 }}>{v}</span>
                  </span>
                ))}
              </div>
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                marginTop: 4, gap: 8,
              }}>
                <span style={{ fontSize: 11, color: "var(--color-text-3)" }}>
                  Updated {timeAgo(s.updatedAt || s.createdAt)}
                </span>
                <div style={{ display: "flex", gap: 4 }} onClick={(e) => e.stopPropagation()}>
                  <button title="Duplicate" onClick={() => onDuplicate(s.id)} style={cardIconBtn}>⧉</button>
                  <button title="Delete" onClick={() => setConfirmDelete(s.id)} style={cardIconBtn}>×</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {confirmDelete && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 1000,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "rgba(0,0,0,0.4)",
          }}
          onMouseDown={(e) => { if (e.target === e.currentTarget) setConfirmDelete(null); }}
        >
          <div style={{
            background: "var(--color-surface)",
            border: "1px solid var(--color-border-strong)",
            borderRadius: 12, padding: "1.5rem", width: 360,
            boxShadow: "0 16px 48px rgba(0,0,0,0.2)",
          }}>
            <p style={{ margin: "0 0 1rem", fontSize: 14, color: "var(--color-text)" }}>
              Delete this song? This can&apos;t be undone.
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                onClick={() => setConfirmDelete(null)}
                style={{
                  padding: "7px 14px", borderRadius: 8,
                  border: "1px solid var(--color-border-strong)",
                  background: "transparent", color: "var(--color-text-2)",
                  fontSize: 13, cursor: "pointer",
                }}
              >Cancel</button>
              <button
                onClick={() => { onDelete(confirmDelete); setConfirmDelete(null); }}
                style={{
                  padding: "7px 14px", borderRadius: 8, border: "none",
                  background: "var(--color-danger-text)", color: "#fff",
                  fontSize: 13, fontWeight: 600, cursor: "pointer",
                }}
              >Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Editor Screen
// ─────────────────────────────────────────────────────────────
function EditorScreen({ song, sections, addSection, removeSection, duplicateSection, updateSection, openPicker, onTranspose, onBackToSetup, onBackToLibrary, onSaveToCloud, cloudStatus }) {
  const transposeBtn = {
    width: 22, height: 22, borderRadius: 4,
    border: "1px solid var(--color-border)",
    background: "var(--color-surface)", color: "var(--color-text-2)",
    fontSize: 13, cursor: "pointer", lineHeight: 1,
    display: "flex", alignItems: "center", justifyContent: "center",
  };
  return (
    <div className="editor-screen" style={{ maxWidth: 960, margin: "0 auto", padding: "1.5rem 1rem 5rem" }}>
      {/* ── Page header ── */}
      <div style={{
        display: "flex", alignItems: "flex-start", justifyContent: "space-between",
        marginBottom: "1.5rem", flexWrap: "wrap", gap: 14,
      }}>
        <div>
          <h1 style={{
            margin: 0, fontSize: 28, fontWeight: 700,
            fontFamily: "var(--font-serif)", color: "var(--color-text)", lineHeight: 1.15,
          }}>{song.title}</h1>
          {song.artist && (
            <p style={{ margin: "4px 0 0", fontSize: 14, color: "var(--color-text-2)" }}>{song.artist}</p>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{
              fontSize: 12, color: "var(--color-text-2)",
              background: "var(--color-surface-2)", borderRadius: 6,
              padding: "3px 4px 3px 9px", border: "1px solid var(--color-border)",
              display: "inline-flex", alignItems: "center", gap: 6,
            }}>
              <span style={{ opacity: 0.65 }}>Key:</span>
              <button
                className="no-print"
                title="Transpose down a semitone"
                onClick={() => onTranspose(-1)}
                style={transposeBtn}
              >−</button>
              <span style={{ fontWeight: 600, minWidth: 18, textAlign: "center" }}>{song.key}</span>
              <button
                className="no-print"
                title="Transpose up a semitone"
                onClick={() => onTranspose(+1)}
                style={transposeBtn}
              >+</button>
            </span>
            {[{ l: "BPM", v: song.bpm }, { l: "Time", v: song.timeSig }].map(({ l, v }) => (
              <span key={l} style={{
                fontSize: 12, color: "var(--color-text-2)",
                background: "var(--color-surface-2)", borderRadius: 6,
                padding: "3px 9px", border: "1px solid var(--color-border)",
              }}>
                <span style={{ opacity: 0.65 }}>{l}: </span>
                <span style={{ fontWeight: 600 }}>{v}</span>
              </span>
            ))}
            <button
              onClick={onBackToSetup}
              style={{ fontSize: 12, color: "var(--color-text-3)", background: "none", border: "none", cursor: "pointer", padding: "3px 6px", textDecoration: "underline", textUnderlineOffset: 2 }}
            >Edit metadata</button>
          </div>
        </div>

        <div className="no-print" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button
            onClick={onBackToLibrary}
            style={{
              padding: "7px 14px", borderRadius: 8,
              border: "1px solid var(--color-border-strong)",
              background: "var(--color-surface)", color: "var(--color-text)",
              fontSize: 13, fontWeight: 500, cursor: "pointer",
              display: "inline-flex", alignItems: "center", gap: 4, minHeight: 34,
            }}
          >← Library</button>
          <AddSectionMenu onAdd={addSection} />
          <button
            onClick={() => window.print()}
            style={{
              padding: "7px 14px", borderRadius: 8,
              border: "1px solid var(--color-border-strong)",
              background: "var(--color-surface)", color: "var(--color-text)",
              fontSize: 13, fontWeight: 500, cursor: "pointer",
              display: "inline-flex", alignItems: "center", minHeight: 34,
            }}
          >⬇ Print / PDF</button>
          {onSaveToCloud && (
            <button
              onClick={onSaveToCloud}
              disabled={cloudStatus?.saving}
              title={song.cloudSyncedAt ? `Last synced ${timeAgo(song.cloudSyncedAt)}` : "Save this song to the cloud"}
              style={{
                padding: "7px 14px", borderRadius: 8,
                border: "1px solid var(--color-border-strong)",
                background: song.cloudSyncedAt ? "var(--color-surface-2)" : "var(--color-surface)",
                color: "var(--color-text)",
                fontSize: 13, fontWeight: 500, cursor: cloudStatus?.saving ? "wait" : "pointer",
                display: "inline-flex", alignItems: "center", gap: 6, minHeight: 34,
                opacity: cloudStatus?.saving ? 0.7 : 1,
              }}
            >☁ {cloudStatus?.saving ? "Saving…" : song.cloudSyncedAt ? `Saved ${timeAgo(song.cloudSyncedAt)}` : "Save to cloud"}</button>
          )}
        </div>
      </div>
      {cloudStatus?.error && (
        <div className="no-print" style={{
          marginBottom: "1rem", padding: "8px 14px", borderRadius: 8,
          background: "var(--color-danger-bg)",
          border: "1px solid var(--color-danger-border)",
          fontSize: 12, color: "var(--color-danger-text)",
        }}>Cloud save failed: {cloudStatus.error}</div>
      )}

      {/* ── Section color legend ── */}
      {sections.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: "1.25rem" }}>
          {sections.map((s) => {
            const [bg,, textC] = SEC_COLORS[s.type] || ["#F1EFE8","#5F5E5A","#2C2C2A"];
            return (
              <span key={s.id} style={{
                fontSize: 10, fontWeight: 700, letterSpacing: "0.08em",
                textTransform: "uppercase", background: bg, color: textC,
                borderRadius: 4, padding: "3px 7px", border: `1px solid ${textC}30`,
              }}>{s.label || s.type}</span>
            );
          })}
        </div>
      )}

      {/* ── Sections ── */}
      {sections.length === 0 ? (
        <div style={{
          textAlign: "center", padding: "3rem 2rem",
          color: "var(--color-text-3)",
          border: "2px dashed var(--color-border)",
          borderRadius: 14,
        }}>
          <div style={{ fontSize: 36, marginBottom: 10 }}>♩</div>
          <p style={{ margin: 0, fontSize: 15 }}>No sections yet — click <strong>+ Add section</strong> to start building your chart.</p>
          <p style={{ margin: "6px 0 0", fontSize: 13, opacity: 0.7 }}>Click any beat cell to assign a chord.</p>
        </div>
      ) : (
        sections.map((sec) => (
          <SectionBlock
            key={sec.id}
            section={sec}
            timeSig={song.timeSig}
            onUpdate={(k, v) => updateSection(sec.id, k, v)}
            onRemove={() => removeSection(sec.id)}
            onDuplicate={() => duplicateSection(sec.id)}
            onBeatClick={openPicker}
          />
        ))
      )}

      {sections.length > 0 && (
        <p className="no-print" style={{ fontSize: 12, color: "var(--color-text-3)", textAlign: "center", marginTop: "1.5rem" }}>
          Click any beat cell to set or clear a chord · Changes are saved automatically to your browser
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Print View  (hidden on screen — visible only when printing)
// ─────────────────────────────────────────────────────────────
function PrintView({ song, sections }) {
  const timeSig = song.timeSig;
  const nb = beatsPerBar(timeSig);
  const runs = detectDuplicateRuns(sections, timeSig);
  const typeGroups = groupByConsecutiveType(runs);

  // Convert a section's chords dict into an array of beat-string arrays, one per bar.
  function getSectionBars(section) {
    const bars = [];
    for (let bi = 0; bi < section.bars; bi++) {
      const beatArr = [];
      for (let beat = 0; beat < nb; beat++) {
        const chord = section.chords[`${bi}-${beat}`];
        beatArr.push(chordStr(chord) || '.');
      }
      bars.push(beatArr);
    }
    return bars;
  }

  // Compute --bar-w: find the ch-width of the densest bar across all sections.
  // GAP_CH=1 matches the ch-unit gap budget; +2 covers the 1ch left+right padding.
  const GAP_CH = 1;
  let maxCh = 4;
  sections.forEach(sec => {
    for (let bi = 0; bi < sec.bars; bi++) {
      let tokenLen = 0;
      for (let beat = 0; beat < nb; beat++) {
        const chord = sec.chords[`${bi}-${beat}`];
        tokenLen += (chordStr(chord) || '.').length;
      }
      maxCh = Math.max(maxCh, tokenLen + (nb - 1) * GAP_CH);
    }
  });
  const barW = (maxCh + 2).toFixed(2) + 'ch';

  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const dateStr = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${String(now.getFullYear()).slice(-2)}, ${pad(now.getHours())}.${pad(now.getMinutes())}`;

  const metaBits = [];
  if (song.key)    metaBits.push('Key: ' + song.key);
  if (song.bpm)    metaBits.push('BPM: ' + song.bpm);
  if (song.timeSig) metaBits.push('Time: ' + song.timeSig);

  return (
    <div className="print-view">
      <div className="page" style={{ '--bar-w': barW }}>

        {/* Running header */}
        <div className="pv-runhead">
          <span className="pv-brand">ChordSheet</span>
          <span className="pv-date">{dateStr}</span>
        </div>

        {/* Title block */}
        <h1 className="pv-title">{song.title}</h1>
        {song.artist && <p className="pv-artist">{song.artist}</p>}
        {metaBits.length > 0 && (
          <p className="pv-meta">{metaBits.join('  ·  ')}</p>
        )}
        <hr className="pv-divider" />

        {/* Sections */}
        {typeGroups.map((group, gi) => (
          <section key={`${group.type}-${gi}`} className="pv-section">
            <h2 className="pv-section-name" style={{ color: group.accentColor }}>
              {group.type.toUpperCase()}
            </h2>

            {group.entries.map((run, ri) => {
              const bars = getSectionBars(run.representative);
              const label = (run.representative.label || '').trim();
              return (
                <div
                  key={run.representative.id || ri}
                  className="pv-line-block"
                  style={{ color: group.accentColor }}
                >
                  {label && <div className="pv-line-label">{label}</div>}
                  <div className="pv-bars">
                    {bars.map((beatArr, bi) => (
                      <div key={`b${bi}`} className="pv-bar">
                        {beatArr.map((v, vi) => (
                          <span key={`v${vi}`} className="pv-beat">{v}</span>
                        ))}
                      </div>
                    ))}
                    <span className="pv-endbar" />
                    {run.count > 1 && (
                      <span className="pv-repeat" style={{ color: group.accentColor }}>
                        &times;{run.count}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </section>
        ))}

      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Root App
// ─────────────────────────────────────────────────────────────
export default function App() {
  const [view, setView] = useState("library");
  const [songs, setSongs] = useState([]);
  const [currentSongId, setCurrentSongId] = useState(null);
  const [ready, setReady] = useState(false);
  const [picker, setPicker] = useState(null);

  // Load from localStorage on mount (with v1 → v2 migration)
  useEffect(() => {
    const data = loadData();
    const sortedSongs = (data.songs || []).map((s) => ({
      ...s,
      sections: sortSections(s.sections || []),
    }));
    setSongs(sortedSongs);
    setReady(true);
  }, []);

  // Auto-save whenever library changes
  useEffect(() => {
    if (!ready) return;
    saveData({ songs, currentSongId });
  }, [songs, currentSongId, ready]);

  const currentSong = songs.find((s) => s.id === currentSongId) || null;

  // Patch the current song; bumps updatedAt automatically.
  const patchCurrent = useCallback((updater) => {
    setSongs((prev) =>
      prev.map((s) =>
        s.id === currentSongId ? { ...updater(s), updatedAt: Date.now() } : s
      )
    );
  }, [currentSongId]);

  // ── Section operations (operate on current song) ──
  const addSection = useCallback((type) => {
    patchCurrent((s) => ({ ...s, sections: sortSections([...s.sections, makeSection(type)]) }));
  }, [patchCurrent]);

  const removeSection = useCallback((id) => {
    patchCurrent((s) => ({ ...s, sections: s.sections.filter((sec) => sec.id !== id) }));
  }, [patchCurrent]);

  const duplicateSection = useCallback((id) => {
    patchCurrent((s) => {
      const idx = s.sections.findIndex((sec) => sec.id === id);
      if (idx < 0) return s;
      const orig = s.sections[idx];
      const copy = { ...orig, id: uid(), label: (orig.label || orig.type) + " copy", chords: { ...orig.chords } };
      const next = [...s.sections];
      next.splice(idx + 1, 0, copy);
      return { ...s, sections: sortSections(next) };
    });
  }, [patchCurrent]);

  const updateSection = useCallback((id, key, val) => {
    patchCurrent((s) => ({
      ...s,
      sections: s.sections.map((sec) => (sec.id === id ? { ...sec, [key]: val } : sec)),
    }));
  }, [patchCurrent]);

  const transpose = useCallback((semitones) => {
    patchCurrent((s) => transposeSong(s, semitones));
  }, [patchCurrent]);

  const openPicker = useCallback((sectionId, barIdx, beatIdx) => {
    setPicker({ sectionId, barIdx, beatIdx });
  }, []);

  const handleSetChord = useCallback((chord) => {
    if (!picker) return;
    const { sectionId, barIdx, beatIdx } = picker;
    patchCurrent((s) => ({
      ...s,
      sections: s.sections.map((sec) => {
        if (sec.id !== sectionId) return sec;
        const k = `${barIdx}-${beatIdx}`;
        const chords = { ...sec.chords };
        if (chord === null) delete chords[k];
        else chords[k] = chord;
        return { ...sec, chords };
      }),
    }));
    setPicker(null);
  }, [picker, patchCurrent]);

  // ── Navigation / song-level ops ──
  const handleSetupDone = useCallback((meta) => {
    if (currentSongId) {
      // Editing metadata of an existing song
      patchCurrent((s) => ({ ...s, ...meta }));
    } else {
      // Creating a new song
      const rec = makeSongRecord(meta);
      setSongs((prev) => [...prev, rec]);
      setCurrentSongId(rec.id);
    }
    setView("editor");
  }, [currentSongId, patchCurrent]);

  const openNewSongSetup = useCallback(() => {
    setCurrentSongId(null);
    setView("setup");
  }, []);

  const openExistingSong = useCallback((id) => {
    setCurrentSongId(id);
    setView("editor");
  }, []);

  const backToLibrary = useCallback(() => {
    setCurrentSongId(null);
    setView("library");
  }, []);

  const deleteSong = useCallback((id) => {
    setSongs((prev) => prev.filter((s) => s.id !== id));
    if (currentSongId === id) {
      setCurrentSongId(null);
      setView("library");
    }
    if (CLOUD_ON) {
      // Fire-and-forget cloud delete. RLS ensures we can only delete our own.
      cloudDeleteSong(id).catch(() => {});
    }
  }, [currentSongId]);

  // ── Cloud sync ──
  const [cloudStatus, setCloudStatus] = useState({ saving: false, error: null });

  const saveCurrentToCloud = useCallback(async () => {
    if (!CLOUD_ON || !currentSong) return;
    setCloudStatus({ saving: true, error: null });
    const res = await cloudSaveSong(currentSong);
    if (res.ok) {
      const now = Date.now();
      setSongs((prev) =>
        prev.map((s) => (s.id === currentSong.id ? { ...s, cloudSyncedAt: now } : s))
      );
      setCloudStatus({ saving: false, error: null });
    } else {
      setCloudStatus({ saving: false, error: res.error });
    }
  }, [currentSong]);

  const pullFromCloud = useCallback(async () => {
    if (!CLOUD_ON) return;
    setCloudStatus({ saving: true, error: null });
    const res = await cloudFetchSongs();
    if (!res.ok) { setCloudStatus({ saving: false, error: res.error }); return; }
    const remote = res.songs;
    setSongs((prev) => {
      const byId = new Map(prev.map((s) => [s.id, s]));
      for (const r of remote) {
        const local = byId.get(r.id);
        const remoteSynced = { ...r, sections: sortSections(r.sections || []), cloudSyncedAt: Date.now() };
        if (!local || (r.updatedAt || 0) > (local.updatedAt || 0)) {
          byId.set(r.id, remoteSynced);
        } else {
          byId.set(r.id, { ...local, cloudSyncedAt: Date.now() });
        }
      }
      return Array.from(byId.values());
    });
    setCloudStatus({ saving: false, error: null });
  }, []);

  const duplicateSong = useCallback((id) => {
    setSongs((prev) => {
      const orig = prev.find((s) => s.id === id);
      if (!orig) return prev;
      const now = Date.now();
      const copy = {
        ...orig,
        id: uid(),
        title: (orig.title || "Untitled") + " (copy)",
        sections: orig.sections.map((sec) => ({ ...sec, id: uid(), chords: { ...sec.chords } })),
        createdAt: now,
        updatedAt: now,
      };
      return [...prev, copy];
    });
  }, []);

  if (!ready) {
    return <div style={{ padding: "2rem", color: "var(--color-text-2)" }}>Loading…</div>;
  }

  return (
    <>
      {view === "library" && (
        <LibraryScreen
          songs={songs}
          onOpen={openExistingSong}
          onNew={openNewSongSetup}
          onDuplicate={duplicateSong}
          onDelete={deleteSong}
          onPullFromCloud={CLOUD_ON ? pullFromCloud : null}
          cloudStatus={cloudStatus}
        />
      )}
      {view === "setup" && (
        <SetupScreen
          song={currentSong || makeSong()}
          isEditing={!!currentSongId}
          onDone={handleSetupDone}
          onCancel={currentSongId ? () => setView("editor") : backToLibrary}
        />
      )}
      {view === "editor" && currentSong && (
        <EditorScreen
          song={currentSong}
          sections={currentSong.sections}
          addSection={addSection}
          removeSection={removeSection}
          duplicateSection={duplicateSection}
          updateSection={updateSection}
          openPicker={openPicker}
          onTranspose={transpose}
          onBackToSetup={() => setView("setup")}
          onBackToLibrary={backToLibrary}
          onSaveToCloud={CLOUD_ON ? saveCurrentToCloud : null}
          cloudStatus={cloudStatus}
        />
      )}
      {view === "editor" && currentSong && (
        <PrintView song={currentSong} sections={currentSong.sections} />
      )}
      {picker && currentSong && (
        <ChordPicker
          sectionId={picker.sectionId}
          barIdx={picker.barIdx}
          beatIdx={picker.beatIdx}
          sections={currentSong.sections}
          onSet={handleSetChord}
          onClose={() => setPicker(null)}
        />
      )}
    </>
  );
}
