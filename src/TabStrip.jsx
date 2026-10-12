// The whole line at a glance. Fretted: tab (fret numbers on string rows, high
// string on top) with note names below. Keyboard: note names only. Columns are
// evenly spaced (no reliable bar grid from audio). Click a column to seek.
import { useEffect, useRef } from 'react';

const COL_W = 30;
const ROW_H = 16;
const PAD = 12;

export function TabStrip({ line, tuning, noteNames, currentIdx, nextIdx, onSeek }) {
  const scrollRef = useRef(null);
  const rows = tuning ? tuning.length : 0;
  const y = (s) => PAD + (rows - 1 - s) * ROW_H; // high string on top
  const namesY = PAD + Math.max(rows - 1, 0) * ROW_H + (rows ? 20 : 4);
  const width = PAD * 2 + 20 + line.length * COL_W;
  const height = namesY + 10;
  const colX = (i) => PAD + 20 + i * COL_W + COL_W / 2;
  const focusIdx = currentIdx >= 0 ? currentIdx : nextIdx;

  // Keep the current (or upcoming) note in view.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || focusIdx < 0) return;
    const cx = colX(focusIdx);
    if (cx < el.scrollLeft + 40 || cx > el.scrollLeft + el.clientWidth - 40) el.scrollLeft = cx - el.clientWidth / 3;
  }, [focusIdx]);

  return (
    <div ref={scrollRef} style={{ overflowX: 'auto', border: '1px solid var(--color-border)', borderRadius: 10 }}>
      <svg width={width} height={height} role="img" aria-label="Tab">
        {Array.from({ length: rows }, (_, s) => (
          <g key={s}>
            <text x={PAD} y={y(s) + 4} fontSize={10} fill="var(--color-text-3)">{noteNames[s]}</text>
            <line x1={PAD + 16} x2={width - PAD} y1={y(s)} y2={y(s)} stroke="var(--color-border-strong)" />
          </g>
        ))}
        {line.map((n, i) => {
          const isCur = i === currentIdx;
          const isNext = i === nextIdx && !isCur;
          const color = isCur ? 'var(--color-note)' : isNext ? 'var(--color-note-next)' : 'var(--color-text)';
          return (
            <g key={i} onClick={() => onSeek(n.start)} style={{ cursor: 'pointer' }}>
              <rect x={colX(i) - COL_W / 2} y={0} width={COL_W} height={height}
                fill={isCur ? 'var(--color-surface-2)' : 'transparent'} />
              {rows > 0 && (
                <>
                  <rect x={colX(i) - 8} y={y(n.string) - 7} width={16} height={14} fill="var(--color-surface)" />
                  <text x={colX(i)} y={y(n.string) + 4} fontSize={11} fontWeight={isCur ? 700 : 500} textAnchor="middle" fill={color}>{n.fret}</text>
                </>
              )}
              <text x={colX(i)} y={namesY} fontSize={9} textAnchor="middle" fill={isCur || isNext ? color : 'var(--color-text-3)'}>{n.name}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
