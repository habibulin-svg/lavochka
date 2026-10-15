/* Людо и парчис — доски: геометрия (где клетки и куда ставить фишку) и рисунок SVG «печать по картону».
 * Координаты доски — в клетках; поворот (свой двор — снизу) делает вид. */
import { goalOf, P_SAFE, P_EXIT, type Kind } from './engine';

export type Pt = [number, number];

/** Цвета печати по местам: 0 красный, 1 зелёный, 2 жёлтый, 3 синий. */
export const INK = ['#cf2f2a', '#249348', '#f1bd1c', '#2266b7'];
const INK_LIGHT = ['#f3c4bd', '#bfe2c8', '#fbe7a6', '#c1d6ef'];
const LINE = '#2b2620';
const PAPER = '#f6f1e3';

// ---------------------------------------------------------------- людо: 15×15

/** Круг из 52 клеток (x, y — клетка), по часовой стрелке; индекс 1 — старт красного (левый нижний двор). */
const L_TRACK: Pt[] = (() => {
  const t: Pt[] = [];
  for (let y = 14; y >= 9; y--) t.push([6, y]);
  for (let x = 5; x >= 0; x--) t.push([x, 8]);
  t.push([0, 7]);
  for (let x = 0; x <= 5; x++) t.push([x, 6]);
  for (let y = 5; y >= 0; y--) t.push([6, y]);
  t.push([7, 0]);
  for (let y = 0; y <= 5; y++) t.push([8, y]);
  for (let x = 9; x <= 14; x++) t.push([x, 6]);
  t.push([14, 7]);
  for (let x = 14; x >= 9; x--) t.push([x, 8]);
  for (let y = 9; y <= 14; y++) t.push([8, y]);
  t.push([7, 14]);
  return t;
})();
/** Дорожка домой (5 клеток) по местам: красный — нижнее плечо, зелёный — левое, жёлтый — верхнее, синий — правое. */
const L_HOME: Pt[][] = [
  [13, 12, 11, 10, 9].map((y) => [7, y] as Pt),
  [1, 2, 3, 4, 5].map((x) => [x, 7] as Pt),
  [1, 2, 3, 4, 5].map((y) => [7, y] as Pt),
  [13, 12, 11, 10, 9].map((x) => [x, 7] as Pt),
];
/** Угол двора по местам: красный — левый нижний, зелёный — левый верхний, жёлтый — правый верхний, синий — правый нижний. */
const L_YARD: Pt[] = [
  [0, 9],
  [0, 0],
  [9, 0],
  [9, 9],
];
const L_GOAL: Pt[] = [
  [7.5, 8.6],
  [6.4, 7.5],
  [7.5, 6.4],
  [8.6, 7.5],
];

// ---------------------------------------------------------------- парчис

/** Ширина дорожки (поперёк плеча) и длина клетки (вдоль) — клетки-полоски, как на испанской доске. */
const W = 2.2;
const C0 = 8;
const C1 = 8 + 3 * W;
export const P_SIZE = C1 + 8;
/** Плечо: 0 — нижнее, 1 — правое, 2 — верхнее, 3 — левое. Дорожка 0–2 (по часовой от центра смотреть не нужно — см. rect). */
function pRect(arm: number, lane: number, row: number): { x: number; y: number; w: number; h: number } {
  switch (arm) {
    case 0:
      return { x: C0 + lane * W, y: C1 + row, w: W, h: 1 };
    case 1:
      return { x: C1 + row, y: C0 + lane * W, w: 1, h: W };
    case 2:
      return { x: C0 + lane * W, y: C0 - row - 1, w: W, h: 1 };
    default:
      return { x: C0 - row - 1, y: C0 + lane * W, w: 1, h: W };
  }
}
/** Клетка круга по номеру 1…68: [плечо, дорожка, ряд] (ряд 0 — у центра). */
function pCell(n: number): [number, number, number] {
  if (n === 68) return [0, 1, 7];
  if (n <= 8) return [0, 2, 8 - n];
  if (n <= 16) return [1, 2, n - 9];
  if (n === 17) return [1, 1, 7];
  if (n <= 25) return [1, 0, 25 - n];
  if (n <= 33) return [2, 2, n - 26];
  if (n === 34) return [2, 1, 7];
  if (n <= 42) return [2, 0, 42 - n];
  if (n <= 50) return [3, 0, n - 43];
  if (n === 51) return [3, 1, 7];
  if (n <= 59) return [3, 2, 59 - n];
  return [0, 0, n - 60];
}
/** Плечо коридора по местам: красный — верхнее, зелёный — левое, жёлтый — нижнее, синий — правое. */
const P_ARM = [2, 3, 0, 1];
/** Дом (угол) по местам: красный — левый верхний, зелёный — левый нижний, жёлтый — правый нижний, синий — правый верхний. */
const P_HOME: Pt[] = [
  [0, 0],
  [0, C1],
  [C1, C1],
  [C1, 0],
];

const center = (r: { x: number; y: number; w: number; h: number }): Pt => [r.x + r.w / 2, r.y + r.h / 2];

// ---------------------------------------------------------------- общее

export interface BoardGeo {
  size: number;
  /** Квадрант двора места: 0 — левый нижний, 1 — левый верхний, 2 — правый верхний, 3 — правый нижний (по часовой). */
  quad: number[];
  /** Куда смотреть своим двором (квадрант внизу у игрока). */
  myQuad: number;
  /** Фишка piece места seat на шаге p: точка доски. n — сколько фишек на этой же клетке, k — её номер среди них. */
  spot(seat: number, p: number, piece: number, k: number, n: number): Pt;
  /** Диаметр фишки, клеток. */
  piece: number;
  svg(): string;
}

export function geoFor(kind: Kind): BoardGeo {
  return kind === 'ludo' ? LUDO : PARCHIS;
}

const LUDO: BoardGeo = {
  size: 15,
  quad: [0, 1, 2, 3],
  myQuad: 0,
  piece: 0.92,
  spot(seat, p, piece, k, n) {
    if (p < 0) {
      const [ox, oy] = L_YARD[seat];
      return [ox + (piece % 2 ? 4 : 2), oy + (piece < 2 ? 2 : 4)];
    }
    if (p >= goalOf('ludo')) {
      const [gx, gy] = L_GOAL[seat];
      return [gx + ((piece % 2) - 0.5) * 0.45, gy + ((piece >> 1) - 0.5) * 0.45];
    }
    const c = p <= 50 ? L_TRACK[(L_START_[seat] + p) % 52] : L_HOME[seat][p - 51];
    const off = n > 1 ? ((k - (n - 1) / 2) * 0.22) : 0;
    return [c[0] + 0.5 + off, c[1] + 0.5 - off * 0.6];
  },
  svg: ludoSvg,
};
const L_START_ = [1, 14, 27, 40];

const PARCHIS: BoardGeo = {
  size: P_SIZE,
  // красный — левый верхний (1), зелёный — левый нижний (0), жёлтый — правый нижний (3), синий — правый верхний (2)
  quad: [1, 0, 3, 2],
  myQuad: 3,
  piece: 0.9,
  spot(seat, p, piece, k, n) {
    if (p < 0) {
      const [ox, oy] = P_HOME[seat];
      return [ox + 4 + (piece % 2 ? 1.25 : -1.25), oy + 4 + (piece < 2 ? -1.25 : 1.25)];
    }
    const goal = goalOf('parchis');
    if (p >= goal) {
      const arm = P_ARM[seat];
      const c: Pt = [(C0 + C1) / 2, (C0 + C1) / 2];
      const d = 1.6;
      const dir: Pt = [[0, d], [d, 0], [0, -d], [-d, 0]][arm] as Pt;
      return [c[0] + dir[0] + ((piece % 2) - 0.5) * (dir[1] ? 0.9 : 0.9), c[1] + dir[1] + ((piece >> 1) - 0.5) * 0.9];
    }
    let r;
    let arm;
    if (p <= 63) {
      const num = ((P_EXIT[seat] - 1 + p) % 68) + 1;
      const [a, lane, row] = pCell(num);
      arm = a;
      r = pRect(a, lane, row);
    } else {
      arm = P_ARM[seat];
      r = pRect(arm, 1, 70 - p);
    }
    const [cx, cy] = center(r);
    const off = n > 1 ? (k - (n - 1) / 2) * 1.0 : 0;
    // две фишки на клетке — рядом поперёк плеча
    return arm % 2 === 0 ? [cx + off, cy] : [cx, cy + off];
  },
  svg: parchisSvg,
};

// ---------------------------------------------------------------- рисунок

const star = (cx: number, cy: number, r: number, fill: string) => {
  let d = '';
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    d += `${i ? 'L' : 'M'}${(cx + Math.cos(a) * rr).toFixed(3)} ${(cy + Math.sin(a) * rr).toFixed(3)}`;
  }
  return `<path d="${d}Z" fill="${fill}" stroke="${LINE}" stroke-width="0.03"/>`;
};

function frame(size: number, inner: string): string {
  const pad = 0.5;
  return `<defs>
    <filter id="ld-paper" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="1.6" numOctaves="3" seed="7"/><feColorMatrix values="0 0 0 0 0.45  0 0 0 0 0.4  0 0 0 0 0.33  0 0 0 0.16 0"/><feComposite in2="SourceGraphic" operator="in"/></filter>
    <linearGradient id="ld-edge" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d9cfb4"/><stop offset="1" stop-color="#a99a78"/></linearGradient>
  </defs>
  <rect x="${-pad}" y="${-pad}" width="${size + pad * 2}" height="${size + pad * 2}" rx="0.35" fill="url(#ld-edge)"/>
  <rect x="-0.12" y="-0.12" width="${size + 0.24}" height="${size + 0.24}" rx="0.12" fill="${PAPER}" stroke="${LINE}" stroke-width="0.08"/>
  ${inner}
  <rect x="-0.12" y="-0.12" width="${size + 0.24}" height="${size + 0.24}" rx="0.12" fill="#fff" filter="url(#ld-paper)" pointer-events="none"/>`;
}

function ludoSvg(): string {
  let o = '';
  // дворы
  L_YARD.forEach(([x, y], seat) => {
    o += `<rect x="${x}" y="${y}" width="6" height="6" fill="${INK[seat]}" stroke="${LINE}" stroke-width="0.05"/>`;
    o += `<rect x="${x + 1}" y="${y + 1}" width="4" height="4" rx="0.25" fill="${PAPER}" stroke="${LINE}" stroke-width="0.04"/>`;
    for (const [dx, dy] of [
      [2, 2],
      [4, 2],
      [2, 4],
      [4, 4],
    ])
      o += `<circle cx="${x + dx}" cy="${y + dy}" r="0.62" fill="${INK_LIGHT[seat]}" stroke="${INK[seat]}" stroke-width="0.12"/>`;
  });
  // клетки круга
  const starts = [1, 14, 27, 40];
  L_TRACK.forEach(([x, y], i) => {
    const owner = starts.indexOf(i);
    o += `<rect x="${x}" y="${y}" width="1" height="1" fill="${owner >= 0 ? INK[owner] : PAPER}" stroke="${LINE}" stroke-width="0.04"/>`;
  });
  // дорожки домой
  L_HOME.forEach((cells, seat) => cells.forEach(([x, y]) => (o += `<rect x="${x}" y="${y}" width="1" height="1" fill="${INK[seat]}" stroke="${LINE}" stroke-width="0.04"/>`)));
  // звёзды и стрелки старта
  for (const i of [9, 22, 35, 48]) o += star(L_TRACK[i][0] + 0.5, L_TRACK[i][1] + 0.5, 0.38, '#fffdf4');
  starts.forEach((i, seat) => (o += star(L_TRACK[i][0] + 0.5, L_TRACK[i][1] + 0.5, 0.36, INK_LIGHT[seat])));
  // центр — четыре треугольника
  const tri = (pts: Pt[], c: string) => `<path d="M${pts.map((p) => p.join(' ')).join('L')}Z" fill="${c}" stroke="${LINE}" stroke-width="0.05"/>`;
  o += tri([[6, 9], [9, 9], [7.5, 7.5]], INK[0]);
  o += tri([[6, 6], [6, 9], [7.5, 7.5]], INK[1]);
  o += tri([[6, 6], [9, 6], [7.5, 7.5]], INK[2]);
  o += tri([[9, 6], [9, 9], [7.5, 7.5]], INK[3]);
  return frame(15, o);
}

function parchisSvg(): string {
  let o = '';
  const S = P_SIZE;
  // дома — большие цветные углы с кругом
  P_HOME.forEach(([x, y], seat) => {
    o += `<rect x="${x}" y="${y}" width="8" height="8" fill="${INK[seat]}" stroke="${LINE}" stroke-width="0.06"/>`;
    o += `<circle cx="${x + 4}" cy="${y + 4}" r="3.1" fill="${INK_LIGHT[seat]}" stroke="${LINE}" stroke-width="0.06"/>`;
  });
  // клетки круга с номерами
  for (let n = 1; n <= 68; n++) {
    const [arm, lane, row] = pCell(n);
    const r = pRect(arm, lane, row);
    const exit = P_EXIT.indexOf(n);
    o += `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="${exit >= 0 ? INK[exit] : PAPER}" stroke="${LINE}" stroke-width="0.04"/>`;
    if (P_SAFE.includes(n)) {
      const [cx, cy] = center(r);
      o += `<circle cx="${cx}" cy="${cy}" r="0.36" fill="none" stroke="${exit >= 0 ? '#fff' : LINE}" stroke-width="0.07"/>`;
    }
    // номер — у дальнего от центра края клетки, вдоль плеча
    const [cx, cy] = center(r);
    const along = arm % 2 === 0;
    const tx = along ? r.x + (lane === 0 ? 0.32 : r.w - 0.32) : cx;
    const ty = along ? cy : r.y + (lane === 0 ? 0.32 : r.h - 0.32);
    const rot = [0, -90, 180, 90][arm];
    o += `<text x="${tx.toFixed(2)}" y="${ty.toFixed(2)}" transform="rotate(${rot} ${tx.toFixed(2)} ${ty.toFixed(2)})" font-size="0.42" font-weight="700" font-family="'PT Sans', Arial, sans-serif" text-anchor="middle" dominant-baseline="central" fill="${exit >= 0 ? '#fff' : LINE}">${n}</text>`;
  }
  // коридоры
  for (let seat = 0; seat < 4; seat++) {
    const arm = P_ARM[seat];
    for (let row = 0; row < 7; row++) {
      const r = pRect(arm, 1, row);
      o += `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="${INK_LIGHT[seat]}" stroke="${LINE}" stroke-width="0.04"/>`;
    }
  }
  // центр
  const c = (C0 + C1) / 2;
  const tri = (pts: Pt[], col: string) => `<path d="M${pts.map((p) => p.join(' ')).join('L')}Z" fill="${col}" stroke="${LINE}" stroke-width="0.06"/>`;
  o += tri([[C0, C1], [C1, C1], [c, c]], INK[2]);
  o += tri([[C1, C0], [C1, C1], [c, c]], INK[3]);
  o += tri([[C0, C0], [C1, C0], [c, c]], INK[0]);
  o += tri([[C0, C0], [C0, C1], [c, c]], INK[1]);
  o += `<circle cx="${c}" cy="${c}" r="1.0" fill="${PAPER}" stroke="${LINE}" stroke-width="0.06"/>`;
  return frame(S, o);
}
