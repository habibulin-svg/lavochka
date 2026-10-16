/* Домино — раскладка ряда (без DOM). Кости ставятся по порядку выкладки, и уже лежащие никогда не сдвигаются.
 * Каждую новую кость пробуем положить прямо; упёрлась в край стола или в другую кость — поворачиваем «коленом».
 * Влево и вправо ряд идёт «змейкой»: колено — и обратно соседней полосой. Вверх и вниз от «дома» — по кругу:
 * у края поворачивает по часовой стрелке и идёт вдоль края. У колена дубль кладут вдоль, а не поперёк.
 * Единица — полкости (кость 2×1). */
import type { Chain, Tile } from './engine';

/** Границы стола для краёв костей, в единицах от центра. */
const XB = 10.3;
const YB = 5.6;

export type V2 = [number, number];

/** Положение кости ряда: центр (в единицах), направление, поперёк ли (дубль). */
export interface Slot {
  c: V2;
  dir: V2;
  cross: boolean;
  tile: Tile;
}

export const ARMS: { run: V2; turn: V2; snake: boolean }[] = [
  { run: [-1, 0], turn: [0, -1], snake: true },
  { run: [1, 0], turn: [0, 1], snake: true },
  { run: [0, -1], turn: [1, 0], snake: false },
  { run: [0, 1], turn: [-1, 0], snake: false },
];

interface Rect {
  x: number;
  y: number;
  hx: number;
  hy: number;
}

interface Head {
  pos: V2;
  dir: V2;
  /** Полуширина предыдущей кости поперёк хода. */
  hw: number;
  /** Змейка: только что сделали колено — дальше разворот. */
  knee: boolean;
  runDir: V2;
  /** Предыдущая кость — колено: дубль не кладём поперёк. */
  corner: boolean;
}

const add = (a: V2, b: V2, k = 1): V2 => [a[0] + b[0] * k, a[1] + b[1] * k];
const neg = (a: V2): V2 => [-a[0], -a[1]];
/** Поворот по часовой стрелке (экранные координаты, y вниз). */
const cw = (a: V2): V2 => [-a[1], a[0]];

function rectOf(c: V2, dir: V2, len: number, across: number): Rect {
  const horiz = dir[0] !== 0;
  return { x: c[0], y: c[1], hx: horiz ? len / 2 : across, hy: horiz ? across : len / 2 };
}
const inside = (r: Rect) => Math.abs(r.x) + r.hx <= XB + 1e-6 && Math.abs(r.y) + r.hy <= YB + 1e-6;
const hits = (r: Rect, q: Rect) => Math.abs(r.x - q.x) < r.hx + q.hx - 0.05 && Math.abs(r.y - q.y) < r.hy + q.hy - 0.05;

interface Cand {
  slot: Slot;
  rect: Rect;
  head: Head;
}

function straight(h: Head, t: Tile): Cand {
  const cross = t.a === t.b && !h.corner;
  const len = cross ? 1 : 2;
  const c = add(h.pos, h.dir, len / 2);
  return {
    slot: { c, dir: h.dir, cross, tile: t },
    rect: rectOf(c, h.dir, len, cross ? 1 : 0.5),
    head: { ...h, pos: add(h.pos, h.dir, len), hw: cross ? 1 : 0.5, corner: false, knee: false },
  };
}

function turn(h: Head, t: Tile, nd: V2, snake: boolean): Cand {
  // колено: кость встаёт боком к концу предыдущей и идёт в новую сторону
  const start = add(add(h.pos, h.dir, -0.5), nd, h.hw);
  const c = add(start, nd, 1);
  let head: Head = { ...h, pos: add(start, nd, 2), dir: nd, hw: 0.5, corner: true, knee: false };
  if (snake) {
    const back = nd[0] === -h.runDir[0] && nd[1] === -h.runDir[1];
    head = back ? { ...head, runDir: nd } : { ...head, knee: !h.knee };
  }
  return { slot: { c, dir: nd, cross: false, tile: t }, rect: rectOf(c, nd, 2, 0.5), head };
}

/** Раскладка ряда. */
export function layout(chain: Chain): { center: Slot | null; arms: Slot[][] } {
  const arms: Slot[][] = [[], [], [], []];
  const ct = chain.center;
  if (!ct) return { center: null, arms };
  const cd = ct.a === ct.b;
  const center: Slot = { c: [0, 0], dir: [1, 0], cross: cd, tile: ct };
  // полуразмеры центральной кости: по горизонтали и вертикали
  const hx = cd ? 0.5 : 1;
  const hy = cd ? 1 : 0.5;
  const taken: Rect[] = [{ x: 0, y: 0, hx, hy }];
  // от «дома» столбцы вверх и вниз — за своими руками, даже пока там пусто: змейка туда не заходит
  const reserved: { arm: number; r: Rect }[] = chain.spin
    ? [2, 3].filter((i) => !chain.arms[i].closed || chain.arms[i].tiles.length).map((i) => ({ arm: i, r: { x: 0, y: (i === 2 ? -1 : 1) * (hy + 2), hx: 1, hy: 2 } }))
    : [];
  const heads: Head[] = ARMS.map((cfg, i) => ({
    pos: [cfg.run[0] * hx, cfg.run[1] * hy],
    dir: cfg.run,
    hw: i < 2 ? hy : hx,
    knee: false,
    runDir: cfg.run,
    corner: false,
  }));
  // по порядку выкладки: тогда новая кость не сдвигает старые
  // (после перестройки от «дома» номера вдоль руки идут вразнобой — кость не ставим раньше предыдущих по руке)
  const order: { arm: number; t: Tile; k: number; i: number }[] = [];
  chain.arms.forEach((a, arm) => {
    let k = -1;
    a.tiles.forEach((t, i) => {
      k = Math.max(k, t.n ?? 1000 + i * 4 + arm);
      order.push({ arm, t, k, i });
    });
  });
  order.sort((x, y) => x.k - y.k || x.i - y.i || x.arm - y.arm);
  for (const { arm, t } of order) {
    const cfg = ARMS[arm];
    const candsFor = (h: Head, tile: Tile): Cand[] => {
      if (!cfg.snake) return [straight(h, tile), turn(h, tile, cw(h.dir), false), turn(h, tile, neg(cw(h.dir)), false)];
      if (h.knee) return [turn(h, tile, neg(h.runDir), true), straight(h, tile), turn(h, tile, h.runDir, true)];
      return [straight(h, tile), turn(h, tile, cfg.turn, true), turn(h, tile, neg(cfg.turn), true)];
    };
    const cands = candsFor(heads[arm], t);
    const free = (c: Cand, extra?: Rect) =>
      !taken.some((q) => hits(c.rect, q)) && !reserved.some((q) => q.arm !== arm && hits(c.rect, q.r)) && !(extra && hits(c.rect, extra));
    const ok = (c: Cand, extra?: Rect) => free(c, extra) && inside(c.rect);
    // заглядываем на кость вперёд: если после этой ряду будет некуда идти — поворачиваем сейчас
    const probe: Tile = { a: 7, b: 8, seat: 0 };
    const future = (c: Cand) => candsFor(c.head, probe).some((f) => ok(f, c.rect));
    const pick = cands.find((c) => ok(c) && future(c)) ?? cands.find((c) => ok(c)) ?? cands.find((c) => free(c)) ?? cands[0];
    arms[arm].push(pick.slot);
    taken.push(pick.rect);
    heads[arm] = pick.head;
  }
  return { center, arms };
}
