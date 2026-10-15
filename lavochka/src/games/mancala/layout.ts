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
