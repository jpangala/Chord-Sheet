import { useState, useEffect, useRef } from "react";
import { chordStr } from "./printUtils.js";
import { ROOTS, QUALITIES, parseChord, getChordSuggestions } from "./chords.js";

// ─────────────────────────────────────────────────────────────
// Chord Picker Modal
// ─────────────────────────────────────────────────────────────
export function ChordPicker({ sectionId, barIdx, beatIdx, sections, onSet, onClose }) {
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
