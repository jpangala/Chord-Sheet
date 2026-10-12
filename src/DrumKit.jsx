// Presentational SVG drum kit, seen from above. `current` / `next` are events
// ({ drums: ['kick', 'hihat', ...] }): current pieces are solid, next pieces get
// an outline ring so the player sees what to hit next.
const PIECES = {
  cymbal:  { cx: 335, cy: 52,  rx: 50, ry: 50, label: 'Cymbal' },
  hihat:   { cx: 62,  cy: 82,  rx: 42, ry: 42, label: 'Hi-hat' },
  tomHigh: { cx: 195, cy: 78,  rx: 36, ry: 36, label: 'High tom' },
  snare:   { cx: 118, cy: 158, rx: 42, ry: 42, label: 'Snare' },
  tomLow:  { cx: 338, cy: 162, rx: 46, ry: 46, label: 'Floor tom' },
  kick:    { cx: 220, cy: 212, rx: 52, ry: 36, label: 'Kick' },
};
const ORDER = ['kick', 'tomLow', 'snare', 'tomHigh', 'hihat', 'cymbal']; // paint back-to-front

export function DrumKit({ current, next }) {
  const isCurrent = (id) => current?.drums.includes(id);
  const isNext = (id) => next?.drums.includes(id) && !isCurrent(id);

  return (
    <div style={{ overflowX: 'auto', flexShrink: 0 }}>
      <svg viewBox="0 0 400 260" width="100%" style={{ display: 'block', margin: '0 auto', minWidth: 320, maxWidth: 420 }} role="img" aria-label="Drum kit">
        {ORDER.map((id) => {
          const p = PIECES[id];
          const on = isCurrent(id);
          return (
            <g key={id}>
              <ellipse cx={p.cx} cy={p.cy} rx={p.rx} ry={p.ry}
                fill={on ? 'var(--color-note)' : 'var(--color-surface-2)'}
                stroke={isNext(id) ? 'var(--color-note-next)' : 'var(--color-border-strong)'}
                strokeWidth={isNext(id) ? 4 : 1.5} />
              <ellipse cx={p.cx} cy={p.cy} rx={p.rx * 0.55} ry={p.ry * 0.55} fill="none"
                stroke={on ? 'rgba(255,255,255,0.5)' : 'var(--color-border)'} strokeWidth={1} />
              <text x={p.cx} y={p.cy + 4} fontSize={11} fontWeight={on ? 700 : 500} textAnchor="middle"
                fill={on ? '#fff' : 'var(--color-text-2)'}>{p.label}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
