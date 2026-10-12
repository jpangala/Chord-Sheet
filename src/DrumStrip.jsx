// The whole pattern at a glance: one row per kit piece (cymbal on top, kick at the
// bottom), one column per hit. Columns are evenly spaced (not to scale in time),
// like TabStrip. Click a column to seek.
import { useEffect, useRef } from 'react';
import { DRUMS } from './drums.js';

const COL_W = 26;
const ROW_H = 18;
const PAD = 12;
const LABEL_W = 62;
const ROWS = Object.keys(DRUMS);

export function DrumStrip({ line, currentIdx, nextIdx, onSeek }) {
  const scrollRef = useRef(null);
  const width = PAD * 2 + LABEL_W + line.length * COL_W;
  const height = PAD * 2 + (ROWS.length - 1) * ROW_H;
  const colX = (i) => PAD + LABEL_W + i * COL_W + COL_W / 2;
  const rowY = (id) => PAD + ROWS.indexOf(id) * ROW_H;
  const focusIdx = currentIdx >= 0 ? currentIdx : nextIdx;

  // Keep the current (or upcoming) hit in view.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || focusIdx < 0) return;
    const cx = colX(focusIdx);
    if (cx < el.scrollLeft + LABEL_W + 40 || cx > el.scrollLeft + el.clientWidth - 40) el.scrollLeft = cx - el.clientWidth / 3;
  }, [focusIdx]);

  return (
    <div ref={scrollRef} style={{ overflowX: 'auto', flexShrink: 0, border: '1px solid var(--color-border)', borderRadius: 10 }}>
      <svg width={width} height={height} role="img" aria-label="Drum pattern">
        {ROWS.map((id) => (
          <g key={id}>
            <text x={PAD} y={rowY(id) + 4} fontSize={10} fill="var(--color-text-3)">{DRUMS[id].label}</text>
            <line x1={PAD + LABEL_W - 6} x2={width - PAD} y1={rowY(id)} y2={rowY(id)} stroke="var(--color-border-strong)" />
          </g>
        ))}
        {line.map((e, i) => {
          const isCur = i === currentIdx;
          const isNext = i === nextIdx && !isCur;
          const color = isCur ? 'var(--color-note)' : isNext ? 'var(--color-note-next)' : 'var(--color-text)';
          return (
            <g key={i} onClick={() => onSeek(e.start)} style={{ cursor: 'pointer' }}>
              <rect x={colX(i) - COL_W / 2} y={0} width={COL_W} height={height}
                fill={isCur ? 'var(--color-surface-2)' : 'transparent'} />
              {e.drums.map((id) => <circle key={id} cx={colX(i)} cy={rowY(id)} r={isCur ? 6 : 5} fill={color} />)}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
