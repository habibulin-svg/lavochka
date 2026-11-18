/* Манкала — геометрия досок (доли ширины/высоты картинки), та же, что в tools/boards/mancala.py. */

export interface Hole {
  /** Центр и полуоси, доли доски. */
  x: number;
  y: number;
  rx: number;
  ry: number;
}

export interface BoardGeo {
  img: string;
  /** Ширина / высота картинки. */
  aspect: number;
  /** Лунки слева направо: нижний ряд, верхний ряд. */
  bottom: Hole[];
  top: Hole[];
  /** Дома/казаны: [свой, соперника]. */
  mine: Hole;
  theirs: Hole;
  /** Камень: доля ширины лунки. */
  stone: number;
  /** Сколько камней лежит в один слой. */
  cap: number;
  /** Камни в лунке — двумя ровными столбиками (тогыз), а не россыпью. */
  columns?: boolean;
  /** Четыре ряда (бао, катра), сверху вниз. */
  rows?: Hole[][];
}

const row = (n: number, x0: number, dx: number, y: number, rx: number, ry: number): Hole[] => Array.from({ length: n }, (_, i) => ({ x: x0 + i * dx, y, rx, ry }));

export const KALAH: BoardGeo = {
  img: 'kalah.webp',
  aspect: 1600 / 520,
  bottom: row(6, 0.1875, 0.125, 0.721, 0.0513, 0.158),
  top: row(6, 0.1875, 0.125, 0.279, 0.0513, 0.158),
  mine: { x: 0.925, y: 0.5, rx: 0.05, ry: 0.385 },
  theirs: { x: 0.075, y: 0.5, rx: 0.05, ry: 0.385 },
  stone: 0.5,
  cap: 8,
};

/** Тогыз: деревянный кейс 1800×1120 — отсеки 191 px шириной, казаны вдоль петли. */
const tx = (i: number) => (40 + (i + 0.5) * (1720 / 9)) / 1800;
export const TOGYZ: BoardGeo = {
  img: 'togyz.webp',
  aspect: 1800 / 1120,
  bottom: Array.from({ length: 9 }, (_, i) => ({ x: tx(i), y: 920 / 1120, rx: 0.0503, ry: 160 / 1120 })),
  top: Array.from({ length: 9 }, (_, i) => ({ x: tx(i), y: 200 / 1120, rx: 0.0503, ry: 160 / 1120 })),
  mine: { x: 0.5, y: 673 / 1120, rx: 860 / 1800, ry: 75 / 1120 },
  theirs: { x: 0.5, y: 447 / 1120, rx: 860 / 1800, ry: 75 / 1120 },
  stone: 0.36,
  cap: 7,
  columns: true,
};

/** Бао (4×8) и катра (4×6): ряды сверху вниз — внешний и внутренний соперника, свой внутренний и внешний. Домов нет. */
function four(img: string, cols: number): BoardGeo {
  const W = 160 + 180 * cols;
  const H = 860;
  const r = (y: number) => Array.from({ length: cols }, (_, i) => ({ x: (170 + 180 * i) / W, y: y / H, rx: 74 / W, ry: 78 / H }));
  const rows = [r(130), r(315), r(545), r(730)];
  const none = { x: 0, y: 0, rx: 0, ry: 0 };
  return { img, aspect: W / H, bottom: rows[3], top: rows[0], mine: none, theirs: none, stone: 0.42, cap: 7, rows };
}
export const BAO = four('bao.webp', 8);
export const KATRA = four('katra.webp', 6);
