import { SEC_COLORS, beatsPerBar, chordStr, detectDuplicateRuns, groupByConsecutiveType, renderBarRows } from './printUtils.js';
import { useState, useEffect, useRef, useCallback } from "react";

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

function makeSection(type) {
  return { id: uid(), type, label: "", bars: 4, chords: {} };
}
function makeSong() {
  return { title: "", artist: "", key: "C", bpm: 120, timeSig: "4/4" };
}

// ─── Persistence (localStorage) ───────────────────────────────
const LS_KEY = "chordsheet_v1";
function loadData() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}
function saveData(data) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch {}
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
  const ref = useRef();

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

        {/* Root */}
        <div>
          <div style={{ fontSize: 10, fontWeight: 600, color: "var(--color-text-3)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.08em" }}>Root</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 4 }}>
            {ROOTS.map((r) => (
              <button key={r} onClick={() => setRoot(r)} style={btn(root === r)}>{r}</button>
            ))}
          </div>
        </div>

        {/* Quality */}
        <div>
          <div style={{ fontSize: 10, fontWeight: 600, color: "var(--color-text-3)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.08em" }}>Quality</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 4 }}>
            {QUALITIES.map((q) => (
              <button key={q.v} onClick={() => setQual(q.v)} style={btn(qual === q.v)}>{q.l}</button>
            ))}
          </div>
        </div>

        {/* Bass */}
        <div>
          <div style={{ fontSize: 10, fontWeight: 600, color: "var(--color-text-3)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.08em" }}>Bass note (slash chord)</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 4 }}>
            <button onClick={() => setBass("")} style={btn(bass === "")}>none</button>
            {ROOTS.map((r) => (
              <button key={r} onClick={() => setBass(r)} style={btn(bass === r)}>{r}</button>
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
          display: "flex", alignItems: "center", gap: 6,
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
function SetupScreen({ song, onDone }) {
  const [s, setS] = useState(song);
  const upd = (k, v) => setS((p) => ({ ...p, [k]: v }));
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
          }}>ChordSheet</h1>
          <p style={{ fontSize: 14, color: "var(--color-text-2)", margin: "6px 0 0" }}>
            Build and organize your song charts
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 500, color: "var(--color-text-2)", display: "block", marginBottom: 5 }}>Song title *</label>
            <input
              value={s.title}
              onChange={(e) => upd("title", e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && canSubmit) onDone(s); }}
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
              { label: "BPM", el: <input type="number" value={s.bpm} min={20} max={300} onChange={(e) => upd("bpm", Math.max(20, Math.min(300, +e.target.value || 120)))} style={field} /> },
              { label: "Time sig.", el: <select value={s.timeSig} onChange={(e) => upd("timeSig", e.target.value)} style={field}>{TIME_SIGS.map((t) => <option key={t}>{t}</option>)}</select> },
            ].map(({ label, el }) => (
              <div key={label}>
                <label style={{ fontSize: 12, fontWeight: 500, color: "var(--color-text-2)", display: "block", marginBottom: 5 }}>{label}</label>
                {el}
              </div>
            ))}
          </div>

          <button
            onClick={() => canSubmit && onDone(s)}
            disabled={!canSubmit}
            style={{
              marginTop: 6, padding: "11px", borderRadius: 10, border: "none",
              background: canSubmit ? "var(--color-accent)" : "var(--color-border)",
              color: canSubmit ? "var(--color-bg)" : "var(--color-text-3)",
              fontSize: 15, fontWeight: 600,
              cursor: canSubmit ? "pointer" : "not-allowed",
              transition: "background 0.2s",
            }}
          >Start editing →</button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Editor Screen
// ─────────────────────────────────────────────────────────────
function EditorScreen({ song, sections, addSection, removeSection, duplicateSection, updateSection, openPicker, onBackToSetup, onNewSong }) {
  const [confirmClear, setConfirmClear] = useState(false);

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
            {[{ l: "Key", v: song.key }, { l: "BPM", v: song.bpm }, { l: "Time", v: song.timeSig }].map(({ l, v }) => (
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
          <AddSectionMenu onAdd={addSection} />
          <button
            onClick={() => window.print()}
            style={{
              padding: "7px 14px", borderRadius: 8,
              border: "1px solid var(--color-border-strong)",
              background: "var(--color-surface)", color: "var(--color-text)",
              fontSize: 13, fontWeight: 500, cursor: "pointer",
            }}
          >⬇ Print / PDF</button>
          <button
            onClick={() => setConfirmClear(true)}
            style={{
              padding: "7px 12px", borderRadius: 8,
              border: "1px solid var(--color-border)",
              background: "transparent", color: "var(--color-text-3)",
              fontSize: 12, cursor: "pointer",
            }}
          >New song</button>
        </div>
      </div>

      {/* ── Confirm clear ── */}
      {confirmClear && (
        <div className="no-print" style={{
          marginBottom: "1rem", padding: "12px 16px", borderRadius: 10,
          background: "var(--color-danger-bg)",
          border: "1px solid var(--color-danger-border)",
          display: "flex", alignItems: "center", gap: 12,
        }}>
          <span style={{ fontSize: 13, color: "var(--color-danger-text)", flex: 1 }}>
            Start a new song? Your current chart will be cleared.
          </span>
          <button
            onClick={() => { onNewSong(); setConfirmClear(false); }}
            style={{ padding: "5px 12px", borderRadius: 6, border: "none", background: "var(--color-danger-text)", color: "#fff", fontSize: 12, cursor: "pointer" }}
          >Yes, clear</button>
          <button
            onClick={() => setConfirmClear(false)}
            style={{ padding: "5px 12px", borderRadius: 6, border: "1px solid var(--color-border-strong)", background: "transparent", color: "var(--color-text-2)", fontSize: 12, cursor: "pointer" }}
          >Cancel</button>
        </div>
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
  const runs = detectDuplicateRuns(sections, timeSig);
  const typeGroups = groupByConsecutiveType(runs);

  return (
    <div className="print-view" style={{
      fontFamily: 'Georgia, "Times New Roman", serif',
      color: '#1A1A18',
      background: 'white',
    }}>
      {/* ── Song header ── */}
      <div style={{ marginBottom: '0.75rem' }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, lineHeight: 1.2 }}>
          {song.title}
        </h1>
        {song.artist && (
          <p style={{ fontSize: 13, color: '#555', margin: '2px 0 0' }}>
            {song.artist}
          </p>
        )}
        <p style={{ fontSize: 11, color: '#888', margin: '4px 0 0' }}>
          Key: {song.key} · BPM: {song.bpm} · Time: {song.timeSig}
        </p>
      </div>
      <hr style={{ border: 'none', borderTop: '1px solid #ddd', marginBottom: '0.75rem' }} />

      {/* ── Type groups ── */}
      {typeGroups.map((group, gi) => (
        <div key={`${group.type}-${gi}`} style={{ marginBottom: 16 }}>

          {/* Section type heading — appears once per consecutive group */}
          <div style={{
            fontWeight: 700,
            fontSize: 12,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: group.accentColor,
            marginBottom: 4,
          }}>
            {group.type}
          </div>

          {/* One entry per run (may be a collapsed duplicate group) */}
          {group.entries.map((run, ri) => {
            const rows = renderBarRows(run.representative, timeSig);
            const label = run.labels.join(' · ');

            // Show part label when: section has a custom label, OR there are
            // multiple entries under this type heading, OR the run collapsed >1 section
            const showLabel =
              run.representative.label !== '' ||
              group.entries.length > 1 ||
              run.count > 1;

            return (
              <div
                key={run.representative.id || ri}
                style={{
                  borderLeft: `2px solid ${group.accentColor}`,
                  paddingLeft: 8,
                  marginBottom: ri < group.entries.length - 1 ? 7 : 0,
                }}
              >
                {showLabel && (
                  <div style={{
                    fontSize: 10,
                    fontWeight: 600,
                    color: group.accentColor,
                    marginBottom: 1,
                  }}>
                    {label}
                  </div>
                )}

                {rows.map((rowStr, rowi) => (
                  <div key={`row-${rowi}`} style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                    <span style={{
                      fontFamily: 'monospace',
                      fontSize: 10,
                      color: '#333',
                      whiteSpace: 'pre',
                    }}>
                      {rowStr}
                    </span>
                    {/* ×N suffix — only on the first row, only when count > 1 */}
                    {rowi === 0 && run.count > 1 && (
                      <span style={{
                        fontWeight: 700,
                        fontSize: 10,
                        color: group.accentColor,
                        fontFamily: 'Georgia, serif',
                      }}>
                        ×{run.count}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Root App
// ─────────────────────────────────────────────────────────────
export default function App() {
  const [view, setView] = useState("setup");
  const [song, setSong] = useState(makeSong);
  const [sections, setSections] = useState([]);
  const [ready, setReady] = useState(false);
  const [picker, setPicker] = useState(null);

  // Load from localStorage on mount
  useEffect(() => {
    const data = loadData();
    if (data?.song?.title) {
      setSong(data.song);
      setSections(data.sections || []);
      setView("editor");
    }
    setReady(true);
  }, []);

  // Auto-save whenever song or sections change
  useEffect(() => {
    if (!ready) return;
    saveData({ song, sections });
  }, [song, sections, ready]);

  const handleSetupDone = useCallback((s) => {
    setSong(s);
    setSections((prev) => (prev.length ? prev : [makeSection("Intro")]));
    setView("editor");
  }, []);

  const addSection = useCallback((type) => {
    setSections((prev) => [...prev, makeSection(type)]);
  }, []);

  const removeSection = useCallback((id) => {
    setSections((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const duplicateSection = useCallback((id) => {
    setSections((prev) => {
      const idx = prev.findIndex((s) => s.id === id);
      if (idx < 0) return prev;
      const orig = prev[idx];
      const copy = { ...orig, id: uid(), label: (orig.label || orig.type) + " copy", chords: { ...orig.chords } };
      const next = [...prev];
      next.splice(idx + 1, 0, copy);
      return next;
    });
  }, []);

  const updateSection = useCallback((id, key, val) => {
    setSections((prev) => prev.map((s) => (s.id === id ? { ...s, [key]: val } : s)));
  }, []);

  const openPicker = useCallback((sectionId, barIdx, beatIdx) => {
    setPicker({ sectionId, barIdx, beatIdx });
  }, []);

  const handleSetChord = useCallback((chord) => {
    if (!picker) return;
    const { sectionId, barIdx, beatIdx } = picker;
    setSections((prev) =>
      prev.map((s) => {
        if (s.id !== sectionId) return s;
        const k = `${barIdx}-${beatIdx}`;
        const chords = { ...s.chords };
        if (chord === null) delete chords[k];
        else chords[k] = chord;
        return { ...s, chords };
      })
    );
    setPicker(null);
  }, [picker]);

  const handleNewSong = useCallback(() => {
    setSong(makeSong());
    setSections([]);
    setView("setup");
  }, []);

  if (!ready) {
    return <div style={{ padding: "2rem", color: "var(--color-text-2)" }}>Loading…</div>;
  }

  return (
    <>
      {view === "setup" ? (
        <SetupScreen song={song} onDone={handleSetupDone} />
      ) : (
        <EditorScreen
          song={song}
          sections={sections}
          addSection={addSection}
          removeSection={removeSection}
          duplicateSection={duplicateSection}
          updateSection={updateSection}
          openPicker={openPicker}
          onBackToSetup={() => setView("setup")}
          onNewSong={handleNewSong}
        />
      )}
      {view === "editor" && (
        <PrintView song={song} sections={sections} />
      )}
      {picker && (
        <ChordPicker
          sectionId={picker.sectionId}
          barIdx={picker.barIdx}
          beatIdx={picker.beatIdx}
          sections={sections}
          onSet={handleSetChord}
          onClose={() => setPicker(null)}
        />
      )}
    </>
  );
}
