// Presentational SVG piano (A0–C8). Fixed key colors so it reads as a piano
// in dark mode too; current = solid accent, next = secondary accent.
import { midiToName } from './instruments.js';

const WW = 14, WH = 72, BW = 9, BH = 44;
const isBlack = (m) => [1, 3, 6, 8, 10].includes(m % 12);

export function Keyboard({ low = 21, high = 108, current, next }) {
  const whites = [];
  for (let m = low; m <= high; m++) if (!isBlack(m)) whites.push(m);
  const whiteX = new Map(whites.map((m, i) => [m, i * WW]));
  const width = whites.length * WW;
  const fill = (m, base) => (m === current?.midi ? 'var(--color-note)' : m === next?.midi ? 'var(--color-note-next)' : base);
  const blacks = [];
  for (let m = low; m <= high; m++) if (isBlack(m) && whiteX.has(m - 1)) blacks.push(m);
  const centerX = (m) => (isBlack(m) ? whiteX.get(m - 1) + WW : whiteX.get(m) + WW / 2);

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${width} ${WH + 16}`} width="100%" style={{ minWidth: 728 }} role="img" aria-label="Keyboard">
        {whites.map((m) => (
          <g key={m}>
            <rect x={whiteX.get(m)} y={0} width={WW} height={WH} rx={2} fill={fill(m, '#FFFFFF')} stroke="#9A9793" strokeWidth={0.75} />
            {m % 12 === 0 && <text x={whiteX.get(m) + WW / 2} y={WH + 12} fontSize={8} textAnchor="middle" fill="var(--color-text-3)">{midiToName(m)}</text>}
          </g>
        ))}
        {blacks.map((m) => (
          <rect key={m} x={whiteX.get(m - 1) + WW - BW / 2} y={0} width={BW} height={BH} rx={1.5} fill={fill(m, '#1A1A18')} />
        ))}
        {current && current.midi >= low && current.midi <= high && (
          <text x={centerX(current.midi)} y={(isBlack(current.midi) ? BH : WH) - 6} fontSize={7} fontWeight={700} textAnchor="middle" fill="#fff">
            {current.name}
          </text>
        )}
      </svg>
    </div>
  );
}
