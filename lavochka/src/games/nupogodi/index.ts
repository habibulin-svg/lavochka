/* «Ну, погоди!» (ИМ-02): экран и корпус. Сегменты — волк в двух поворотах, четыре положения рук с корзиной,
 * по пять яиц на каждом жёлобе, разбитое яйцо и убегающий цыплёнок с каждой стороны, заяц в окошке, три штрафных цыплёнка. */
import { lcdModule } from '../../arcade/lcd';
import type { LcdSpec } from '../../arcade/lcd-core';
import { NuPogodi, RAMPS, STEPS } from './logic';

const W = 400;
const H = 260;

const RAMP_LINE: Record<string, [number, number, number, number]> = {
  lu: [18, 78, 128, 112],
  ld: [18, 158, 128, 192],
  ru: [382, 78, 272, 112],
  rd: [382, 158, 272, 192],
};
const BASKET: Record<string, [number, number]> = { lu: [142, 120], ld: [142, 200], ru: [258, 120], rd: [258, 200] };

const mirror = (inner: string) => `<g transform="matrix(-1 0 0 1 ${W} 0)">${inner}</g>`;

/** Волк, смотрит влево (правый — зеркально). */
const WOLF = `
  <ellipse cx="188" cy="118" rx="17" ry="14"/>
  <polygon points="174,114 152,124 156,130 174,128"/>
  <circle cx="153" cy="126" r="3.5"/>
  <polygon points="180,106 182,86 192,103"/>
  <polygon points="194,104 202,88 205,108"/>
  <polygon points="180,132 220,132 226,192 172,192"/>
  <polygon points="178,192 172,234 188,234 194,192"/>
  <polygon points="206,192 212,234 228,234 222,192"/>
  <polygon points="170,234 190,234 190,240 166,240"/>
  <polygon points="210,234 230,234 234,240 210,240"/>
  <polygon points="222,178 252,166 250,180 226,188"/>`;

function arm(id: string): string {
  const [bx, by] = BASKET[id];
  const left = id[0] === 'l';
  const sx = left ? 186 : 214;
  const sy = 146;
  const dx = bx - sx;
  const dy = by - 6 - sy;
  const len = Math.hypot(dx, dy);
  const nx = (-dy / len) * 4;
  const ny = (dx / len) * 4;
  const basket = `<path d="M${bx - 15} ${by - 4} A15 11 0 0 0 ${bx + 15} ${by - 4} Z"/><rect x="${bx - 16}" y="${by - 7}" width="32" height="3"/>`;
  return `<polygon points="${sx + nx},${sy + ny} ${sx - nx},${sy - ny} ${bx - nx - (left ? -6 : 6)},${by - 6 - ny} ${bx + nx - (left ? -6 : 6)},${by - 6 + ny}"/>${basket}`;
}

function eggAt(id: string, i: number): string {
  const [x1, y1, x2, y2] = RAMP_LINE[id];
  const t = (i + 0.6) / (STEPS + 0.4);
  const x = x1 + (x2 - x1) * t;
  const y = y1 + (y2 - y1) * t - 8;
  return `<ellipse cx="${x}" cy="${y}" rx="5.5" ry="7.5" transform="rotate(${i * 72} ${x} ${y})"/>`;
}

const chick = (x: number, y: number, s = 1) =>
  `<ellipse cx="${x}" cy="${y}" rx="${7 * s}" ry="${6 * s}"/><circle cx="${x + 6 * s}" cy="${y - 6 * s}" r="${4 * s}"/><polygon points="${x + 9 * s},${y - 7 * s} ${x + 14 * s},${y - 6 * s} ${x + 9 * s},${y - 4 * s}"/><rect x="${x - 3 * s}" y="${y + 5 * s}" width="${1.6 * s}" height="${5 * s}"/><rect x="${x + 2 * s}" y="${y + 5 * s}" width="${1.6 * s}" height="${5 * s}"/>`;

const broke = (x: number, y: number) =>
  `<ellipse cx="${x}" cy="${y}" rx="10" ry="3"/><polygon points="${x - 9},${y - 2} ${x - 6},${y - 9} ${x - 3},${y - 3} ${x},${y - 10} ${x + 3},${y - 3} ${x + 6},${y - 9} ${x + 9},${y - 2}"/>`;

const HARE = `<ellipse cx="76" cy="36" rx="10" ry="9"/><ellipse cx="70" cy="18" rx="3.5" ry="12"/><ellipse cx="82" cy="18" rx="3.5" ry="12" transform="rotate(12 82 18)"/><rect x="66" y="44" width="20" height="6" rx="3"/>`;

const segs: Record<string, string> = {
  wolf_l: WOLF,
  wolf_r: mirror(WOLF),
  hare: HARE,
};
for (const r of RAMPS) {
  segs[`arm_${r}`] = arm(r);
  for (let i = 0; i < STEPS; i++) segs[`egg_${r}_${i}`] = eggAt(r, i);
}
for (let i = 0; i < 4; i++) {
  segs[`chick_l${i}`] = chick(104 - i * 26, 236);
  segs[`chick_r${i}`] = mirror(chick(104 - i * 26, 236));
}
segs.broke_l = broke(124, 244);
segs.broke_r = mirror(broke(124, 244));
for (let i = 0; i < 3; i++) segs[`miss${i}`] = chick(308 + i * 28, 30, 0.9);

/** Плёнка под стеклом: курятники, жёлоба, земля, окошко зайца. */
const art = `
  <rect x="0" y="232" width="${W}" height="${H - 232}" fill="#7a9a4a"/>
  <rect x="48" y="6" width="56" height="48" fill="#9ac8e8" stroke="#6a5a3a" stroke-width="2"/>
  ${(['lu', 'ld', 'ru', 'rd'] as const)
    .map((r) => {
      const [x1, y1, x2, y2] = RAMP_LINE[r];
      const hx = x1 < 200 ? 4 : W - 34;
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#8a5a2a" stroke-width="4"/>
        <rect x="${hx}" y="${y1 - 26}" width="30" height="24" fill="#c08040"/>
        <ellipse cx="${hx + 15}" cy="${y1 - 14}" rx="9" ry="8" fill="#f4f0e0"/><polygon points="${hx + 12},${y1 - 22} ${hx + 15},${y1 - 28} ${hx + 18},${y1 - 22}" fill="#d03020"/>`;
    })
    .join('')}
  <rect x="140" y="230" width="120" height="6" fill="#6a5030"/>`;

const spec: LcdSpec = {
  id: 'nupogodi',
  title: 'Ну, погоди!',
  model: 'ИМ-02',
  body: { color: '#d8402a', dark: '#8a1e12', trim: '#f0b020', label: '#fff2d0' },
  w: W,
  h: H,
  art,
  segs,
  digits: { x: 156, y: 8, size: 30 },
  buttons: [
    { id: 'lu', label: '↖', side: 'left', row: 0, keys: ['q', 'ArrowUp'] },
    { id: 'ld', label: '↙', side: 'left', row: 1, keys: ['a', 'ArrowLeft'] },
    { id: 'ru', label: '↗', side: 'right', row: 0, keys: ['p', 'ArrowRight'] },
    { id: 'rd', label: '↘', side: 'right', row: 1, keys: ['l', 'ArrowDown'] },
  ],
  modes: [
    { id: 'A', label: 'ИГРА А' },
    { id: 'B', label: 'ИГРА Б' },
  ],
  create: (mode, seed) => new NuPogodi(mode === 'B' ? 'B' : 'A', seed),
};

export default lcdModule(
  spec,
  'Волк ловит яйца в корзину. Разбил три — игра окончена. Пока в окошке заяц, штраф половинный.',
  `<p>Четыре кнопки — куда подставить корзину:</p>
   <p><kbd>Q</kbd> ↖ левый верх, <kbd>A</kbd> ↙ левый низ, <kbd>P</kbd> ↗ правый верх, <kbd>L</kbd> ↘ правый низ (или стрелки).</p>
   <p><kbd>1</kbd> — игра А, <kbd>2</kbd> — игра Б (быстрее), «ВРЕМЯ» — часы.</p>`
);
