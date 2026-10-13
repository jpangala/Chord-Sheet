import { SEC_COLORS, beatsPerBar, chordStr, detectDuplicateRuns, groupByConsecutiveType, renderBarRows, transposeSong } from './printUtils.js';
import { cloudDeleteSong, cloudFetchSongs, cloudSaveSong, isCloudEnabled } from './cloud.js';
import { useState, useEffect, useRef, useCallback } from "react";
import { uid, sortSections, makeSection, makeSong, makeSongRecord, timeAgo, loadData, saveData } from './models.js';
import { SECTION_TYPES, TIME_SIGS, ROOTS, QUALITIES, ROOTS_BY_LEN, QUAL_VALS_BY_LEN, parseChord, ALL_CHORDS, getChordSuggestions } from './chords.js';
import { ChordPicker } from './ChordPicker.jsx';
import { AudioImportModal } from './AudioImportModal.jsx';
import { LiveChordTest } from './LiveChordTest.jsx';
import { InstrumentVisualizerModal } from './InstrumentVisualizerModal.jsx';
import { ScalesLicksModal } from './ScalesLicksModal.jsx';

const CLOUD_ON = isCloudEnabled();

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

function LibraryScreen({ songs, onOpen, onNew, onDuplicate, onDelete, onPullFromCloud, cloudStatus, onOpenLiveChordTest, onOpenInstrumentViz, onOpenScalesLicks }) {
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
            onClick={onOpenLiveChordTest}
            title="Diagnostic: shows raw pitch-class energy and the best-matching chord live from your mic"
            style={{
              padding: "7px 14px", borderRadius: 8,
              border: "1px solid var(--color-border-strong)",
              background: "var(--color-surface)", color: "var(--color-text)",
              fontSize: 13, fontWeight: 500, cursor: "pointer",
              display: "inline-flex", alignItems: "center", gap: 6, minHeight: 34,
            }}
          >🎤 Live chord test</button>
          <button
            onClick={onOpenInstrumentViz}
            title="Upload a song, pick bass/guitar/keys, and see which notes to play and where"
            style={{
              padding: "7px 14px", borderRadius: 8,
              border: "1px solid var(--color-border-strong)",
              background: "var(--color-surface)", color: "var(--color-text)",
              fontSize: 13, fontWeight: 500, cursor: "pointer",
              display: "inline-flex", alignItems: "center", gap: 6, minHeight: 34,
            }}
          >🎸 Learn a line</button>
          <button
            onClick={onOpenScalesLicks}
            title="Practice bass scales, arpeggios and licks in any key with a play-along synth and click"
            style={{
              padding: "7px 14px", borderRadius: 8,
              border: "1px solid var(--color-border-strong)",
              background: "var(--color-surface)", color: "var(--color-text)",
              fontSize: 13, fontWeight: 500, cursor: "pointer",
              display: "inline-flex", alignItems: "center", gap: 6, minHeight: 34,
            }}
          >🎼 Scales & licks</button>
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
function EditorScreen({ song, sections, addSection, removeSection, duplicateSection, updateSection, openPicker, onTranspose, onBackToSetup, onBackToLibrary, onSaveToCloud, cloudStatus, onOpenAudioImport }) {
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
            onClick={onOpenAudioImport}
            style={{
              padding: "7px 14px", borderRadius: 8,
              border: "1px solid var(--color-border-strong)",
              background: "var(--color-surface)", color: "var(--color-text)",
              fontSize: 13, fontWeight: 500, cursor: "pointer",
              display: "inline-flex", alignItems: "center", minHeight: 34,
            }}
          >🎧 Import from Audio</button>
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

  const [audioImportOpen, setAudioImportOpen] = useState(false);
  const [liveChordTestOpen, setLiveChordTestOpen] = useState(false);
  const [instrumentVizOpen, setInstrumentVizOpen] = useState(false);
  const [scalesLicksOpen, setScalesLicksOpen] = useState(false);

  const addSectionFromAudio = useCallback((sectionDraft, detectedBpm, shouldUpdateBpm) => {
    patchCurrent((s) => {
      const newSection = {
        id: uid(),
        type: sectionDraft.type,
        label: sectionDraft.label,
        bars: sectionDraft.bars,
        chords: sectionDraft.chords,
      };
      const next = { ...s, sections: sortSections([...s.sections, newSection]) };
      if (shouldUpdateBpm && detectedBpm) next.bpm = detectedBpm;
      return next;
    });
    setAudioImportOpen(false);
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
          onOpenLiveChordTest={() => setLiveChordTestOpen(true)}
          onOpenInstrumentViz={() => setInstrumentVizOpen(true)}
          onOpenScalesLicks={() => setScalesLicksOpen(true)}
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
          onOpenAudioImport={() => setAudioImportOpen(true)}
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
      {audioImportOpen && currentSong && (
        <AudioImportModal
          song={currentSong}
          onCreateSection={addSectionFromAudio}
          onClose={() => setAudioImportOpen(false)}
        />
      )}
      {liveChordTestOpen && (
        <LiveChordTest onClose={() => setLiveChordTestOpen(false)} />
      )}
      {instrumentVizOpen && <InstrumentVisualizerModal onClose={() => setInstrumentVizOpen(false)} />}
      {scalesLicksOpen && <ScalesLicksModal onClose={() => setScalesLicksOpen(false)} />}
    </>
  );
}
