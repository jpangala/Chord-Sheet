// Presentational SVG fretboard. `current` is solid; `next` is an outline ring
// so the player sees where to go. Tab convention: high string on top.
const FRET_W = 36;
const ROW_H = 24;
const NUT_X = 48;
const PAD_Y = 16;
const INLAYS = [3, 5, 7, 9, 15, 17, 19, 21];

export function Fretboard({ tuning, frets, noteNames, current, next }) {
  const n = tuning.length;
  const boardH = (n - 1) * ROW_H;
  const width = NUT_X + frets * FRET_W + 8;
  const height = PAD_Y * 2 + boardH + 14;
  const y = (s) => PAD_Y + (n - 1 - s) * ROW_H;
  const x = (f) => (f === 0 ? NUT_X - 14 : NUT_X + (f - 0.5) * FRET_W);
  const midY = PAD_Y + boardH / 2;
  const samePos = current && next && current.string === next.string && current.fret === next.fret;

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label="Fretboard">
        {INLAYS.filter((f) => f <= frets).map((f) => <circle key={f} cx={x(f)} cy={midY} r={4} fill="var(--color-border-strong)" />)}
        {frets >= 12 && [-1, 1].map((k) => <circle key={`12${k}`} cx={x(12)} cy={midY + k * ROW_H} r={4} fill="var(--color-border-strong)" />)}
        {Array.from({ length: frets + 1 }, (_, f) => (
          <line key={f} x1={NUT_X + f * FRET_W} x2={NUT_X + f * FRET_W} y1={PAD_Y} y2={PAD_Y + boardH}
            stroke="var(--color-text-3)" strokeWidth={f === 0 ? 4 : 1} />
        ))}
        {tuning.map((_, s) => (
          <g key={s}>
            <line x1={NUT_X} x2={NUT_X + frets * FRET_W} y1={y(s)} y2={y(s)} stroke="var(--color-text-2)" strokeWidth={1 + (n - 1 - s) * 0.35} />
            <text x={4} y={y(s) + 4} fontSize={11} fill="var(--color-text-3)">{noteNames[s]}</text>
          </g>
        ))}
        {[3, 5, 7, 9, 12, 15, 17, 19].filter((f) => f <= frets).map((f) => (
          <text key={f} x={x(f)} y={height - 4} fontSize={10} textAnchor="middle" fill="var(--color-text-3)">{f}</text>
        ))}
        {next && !samePos && (
          <circle cx={x(next.fret)} cy={y(next.string)} r={9} fill="none" stroke="var(--color-note-next)" strokeWidth={2.5} />
        )}
        {current && (
          <g>
            <circle cx={x(current.fret)} cy={y(current.string)} r={10} fill="var(--color-note)" />
            <text x={x(current.fret)} y={y(current.string) + 3.5} fontSize={9} fontWeight={700} textAnchor="middle" fill="#fff">
              {current.name.replace(/-?\d+$/, '')}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}
