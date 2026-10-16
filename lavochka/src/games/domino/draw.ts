/* Домино — общий рисунок: кости слоновой кости с латунным гвоздиком, рубашки, стол из крашеных досок. */
import type { V2 } from './layout';

export const NS = 'http://www.w3.org/2000/svg';
export const W = 1000;
export const H = 720;
/** Единица ряда: кость — 2×1 единицы. */
export const U = 40;
export const CX = W / 2;
export const CY = 330;
// ---------------------------------------------------------------- рисунок кости

const PIPS: Record<number, V2[]> = {
  0: [],
  1: [[0, 0]],
  2: [[-1, -1], [1, 1]],
  3: [[-1, -1], [0, 0], [1, 1]],
  4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
  6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
};

/** Кость: центр (x, y) в пикселях, s — единица, angle — поворот (0 — горизонтально, a слева). */
export function boneSvg(a: number, b: number, x: number, y: number, s: number, angle: number, cls = '', attrs = ''): string {
  const w = s * 2 - 2;
  const hh = s - 2;
  const half = (n: number, cx: number) =>
    PIPS[n].map(([px, py]) => `<circle cx="${cx + px * s * 0.26}" cy="${py * s * 0.26}" r="${s * 0.1}" class="dm-pip"/>`).join('');
  return `<g class="dm-bone ${cls}" transform="translate(${x},${y}) rotate(${angle})" ${attrs}>
    <rect x="${-w / 2}" y="${-hh / 2}" width="${w}" height="${hh}" rx="${s * 0.16}" class="dm-face"/>
    <rect x="${-w / 2 + 1.5}" y="${-hh / 2 + 1.5}" width="${w - 3}" height="${hh - 3}" rx="${s * 0.13}" class="dm-shine"/>
    <line x1="0" y1="${-hh / 2 + s * 0.12}" x2="0" y2="${hh / 2 - s * 0.12}" class="dm-mid"/>
    <circle r="${s * 0.09}" class="dm-pin"/>
    ${half(a, -s / 2)}${half(b, s / 2)}
  </g>`;
}

export function backSvg(x: number, y: number, s: number, angle: number): string {
  const w = s * 2 - 2;
  const hh = s - 2;
  return `<g class="dm-back" transform="translate(${x},${y}) rotate(${angle})"><rect x="${-w / 2}" y="${-hh / 2}" width="${w}" height="${hh}" rx="${s * 0.16}"/><circle r="${s * 0.09}" class="dm-pin"/></g>`;
}

/** Стол во дворе: крашеные доски, облупившаяся краска, пара гвоздей. */
export function planksSvg(): string {
  let s = `<rect width="${W}" height="${H}" rx="18" fill="#2f5a34"/>`;
  const n = 7;
  for (let i = 0; i < n; i++) {
    const y = (H / n) * i;
    const tone = ['#3a6a3e', '#356339', '#3d6f41', '#33603a'][i % 4];
    s += `<rect x="0" y="${y + 2}" width="${W}" height="${H / n - 4}" fill="${tone}"/>`;
    s += `<rect x="0" y="${y + H / n - 3}" width="${W}" height="3" fill="#1a2e1a" opacity=".55"/>`;
    // облупилась краска — проглядывает дерево
    for (let k = 0; k < 3; k++) {
      const px = ((i * 337 + k * 211) % (W - 120)) + 40;
      const py = y + 10 + ((i * 53 + k * 29) % Math.max(10, H / n - 30));
      s += `<ellipse cx="${px}" cy="${py}" rx="${18 + ((i + k) % 3) * 9}" ry="${4 + (k % 2) * 2}" fill="#8a6a42" opacity=".35"/>`;
    }
    for (const nx of [26, W - 26]) s += `<circle cx="${nx}" cy="${y + H / n / 2}" r="3" fill="#2a2a24"/><circle cx="${nx - 0.8}" cy="${y + H / n / 2 - 0.8}" r="1.2" fill="#8a8a7a"/>`;
  }
  s += `<rect width="${W}" height="${H}" rx="18" fill="none" stroke="#1a2e1a" stroke-width="6"/>`;
  return s;
}
