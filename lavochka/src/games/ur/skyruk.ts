/* Царская игра Ура по правилам Д. Скирюка (с его дополнениями) — движок. Доска 3×8: ряды A (верх), B (середина), C (низ),
 * столбцы 1–8 (здесь 0–7). У стороны 0 своя дорожка — ряд C, у стороны 1 — ряд A.
 * Путь фишки (p): 1–4 — своя дорожка X4→X1 (ввод: бросок v — на клетку p = v), 5–11 — B1…B7, 12–16 — петля по малому блоку
 * (X7, X8, B8, Y8, Y7 — вход слева или справа по выбору), 17 — B7, 18–23 — B6…B1, 24 — фишка вышла (точным броском).
 * Бросок — три пирамидки: сколько отмеченных вершин вверх, ни одной — 4 очка.
 * Особые клетки: «звёзды» A1, C1, B4, A7, C7 — ещё бросок; «четыре глаза» A2, A4, C2, C4 — до четырёх своих фишек столбиком;
 * B7 — столбик до четырёх фишек того, кто занял её первым, чужие её не бьют и не встают; «четыре пятёрки» B3, B6 — безопасные,
 * до четырёх любых фишек, ходит верхняя; B1 — финиш: меченую там не бьют. Пустые и меченые фишки друг друга не бьют. */
import type { Options, Rng } from '../../core/types';

export const PIECES = 7;
export const EXIT = 24;
/** Клетка доски: столбец 0–7, ряд 0 (A), 1 (B), 2 (C). */
export const cellId = (col: number, row: number) => row * 8 + col;
export const cellCol = (c: number) => c % 8;
export const cellRow = (c: number) => Math.floor(c / 8);
export const STARS = [cellId(0, 0), cellId(0, 2), cellId(3, 1), cellId(6, 0), cellId(6, 2)];
export const EYES = [cellId(1, 0), cellId(3, 0), cellId(1, 2), cellId(3, 2)];
export const SAFE = [cellId(2, 1), cellId(5, 1)];
export const DEPOT = cellId(6, 1);
export const FINISH = cellId(0, 1);
export const B8 = cellId(7, 1);
export const CELL_NAME = (c: number) => 'ABC'[cellRow(c)] + (cellCol(c) + 1);

export interface Cfg {
  /** Переворот: на B8 и дальше (по Скирюку) или уже на клетке превращения A8/C8. */
  flip: 'b8' | 'wave';
  /** Ход назад — только чтобы срубить фишку соперника. */
  back: boolean;
  /** Срубивший ходом назад на «звезде»: остаётся без броска или возвращается обратно. */
  backStar: 'stay' | 'return';
  /** Подъём своей фишки в столбике на клетке безопасности (и переворот столбика). */
  raise: boolean;
  /** Меченые фишки столбиком на финише B1 (с подъёмом; выход — верхней, единицей). */
  finishStack: boolean;
}

export function skyrukCfg(o: Options): Cfg {
  return {
    flip: o.flip === 'wave' ? 'wave' : 'b8',
    back: o.back !== false,
    backStar: o.backStar === 'return' ? 'return' : 'stay',
    raise: o.raise === true,
    finishStack: o.finishStack === true,
  };
}

export interface Piece {
  side: number;
  /** 0 — не вошла, 1–23 — на доске, 24 — вышла. */
  p: number;
  marked: boolean;
  /** Ряд петли по малому блоку (0 — A, 2 — C), пока фишка в ней или после. */
  loop: number | null;
}

export interface SState {
  mode: 'skyruk';
  cfg: Cfg;
  seats: number[];
  cur: number;
  /** start — разыгрывают первый ход: кто первым выбросит единицу, тот и ходит ею. */
  phase: 'start' | 'roll' | 'move' | 'over';
  dice: number[];
  value: number;
  pieces: Piece[];
  /** Столбики по клеткам: номера фишек снизу вверх. */
  cells: number[][];
  winner: number | null;
  /** Предыдущий ход соперника был подъёмом в столбике (тогда можно перевернуть столбик единицей). */
  lastRaise: number | null;
  last: { side: number; from: number; to: number } | null;
  moves: number;
}

export type SAction =
  | { type: 'roll' }
  | { type: 'move'; id: number; back?: boolean; loop?: number }
  | { type: 'raise'; cell: number; k: number };

export type SEvent =
  | { type: 'roll'; seat: number; dice: number[]; value: number; none: boolean; start?: boolean }
  | { type: 'smove'; seat: number; side: number; id: number; from: number; to: number; fromCell: number; toCell: number; back: boolean; hit: number | null; again: boolean; flipped: boolean; ret: boolean }
  | { type: 'raise'; seat: number; side: number; cell: number; k: number }
  | { type: 'end'; winner: number };

/** Клетка доски для стороны side, места пути p и петли loop. */
export function cellOf(side: number, p: number, loop: number | null): number {
  const own = side === 0 ? 2 : 0;
  const L = loop ?? own;
  if (p >= 1 && p <= 4) return cellId(4 - p, own);
  if (p <= 11) return cellId(p - 5, 1);
  if (p === 12) return cellId(6, L);
  if (p === 13) return cellId(7, L);
  if (p === 14) return B8;
  if (p === 15) return cellId(7, 2 - L);
  if (p === 16) return cellId(6, 2 - L);
  if (p === 17) return DEPOT;
  if (p <= 23) return cellId(23 - p, 1);
  return -1;
}

const flipAt = (cfg: Cfg) => (cfg.flip === 'wave' ? 13 : 14);

export function newSkyruk(cfg: Cfg, seats = [0, 1]): SState {
  const pieces: Piece[] = [];
  for (let s = 0; s < 2; s++) for (let k = 0; k < PIECES; k++) pieces.push({ side: s, p: 0, marked: false, loop: null });
  return { mode: 'skyruk', cfg, seats, cur: 0, phase: 'start', dice: [], value: 0, pieces, cells: Array.from({ length: 24 }, () => []), winner: null, lastRaise: null, last: null, moves: 0 };
}

const top = (s: SState, c: number) => (s.cells[c].length ? s.cells[c][s.cells[c].length - 1] : -1);

/** Можно ли фишке id встать на клетку c; 'hit' — срубить того, кто там. */
function landing(s: SState, id: number, c: number, marked: boolean, back: boolean): 'ok' | 'hit' | null {
  const x = s.pieces[id];
  const st = s.cells[c].filter((j) => j !== id);
  if (c === FINISH && marked) {
    if (st.some((j) => !s.pieces[j].marked)) return null;
    if (!st.length) return back ? null : 'ok';
    return s.cfg.finishStack && st.length < 4 && !back ? 'ok' : null;
  }
  if (c === FINISH && st.some((j) => s.pieces[j].marked)) return null;
  if (SAFE.includes(c)) return st.length < 4 && !back ? 'ok' : null;
  if (EYES.includes(c)) return st.length < 4 && !back ? 'ok' : null;
  if (c === DEPOT) {
    if (!st.length) return back ? null : 'ok';
    const owner = s.pieces[st[0]].side;
    return owner === x.side && st.length < 4 && !back ? 'ok' : null;
  }
  if (!st.length) return back ? null : 'ok';
  const o = s.pieces[st[st.length - 1]];
  if (o.side === x.side) return null;
  if (o.marked !== marked) return null;
  return 'hit';
}

export interface SMove {
  a: SAction;
  from: number;
  to: number;
  toCell: number;
  hit: boolean;
  star: boolean;
}

/** Все допустимые ходы текущего игрока при выпавшем значении. */
export function slegal(s: SState): SMove[] {
  if (s.phase !== 'move') return [];
  const out: SMove[] = [];
  const v = s.value;
  const side = s.cur;
  const own = side === 0 ? 2 : 0;
  let entered = false;
  for (let id = 0; id < s.pieces.length; id++) {
    const x = s.pieces[id];
    if (x.side !== side || x.p >= EXIT) continue;
    if (x.p === 0) {
      if (entered) continue;
      entered = true;
      const c = cellOf(side, v, null);
      if (landing(s, id, c, false, false)) out.push({ a: { type: 'move', id }, from: 0, to: v, toCell: c, hit: false, star: STARS.includes(c) });
      continue;
    }
    const c0 = cellOf(side, x.p, x.loop);
    if (top(s, c0) !== id) continue;
    // вперёд
    const to = x.p + v;
    if (to === EXIT) out.push({ a: { type: 'move', id }, from: x.p, to, toCell: -1, hit: false, star: false });
    else if (to < EXIT) {
      const loops = x.p <= 11 && to >= 12 ? [own, 2 - own] : [x.loop];
      for (const L of loops) {
        const c = cellOf(side, to, L);
        const marked = x.marked || to >= flipAt(s.cfg);
        const r = landing(s, id, c, marked, false);
        if (r) out.push({ a: { type: 'move', id, ...(loops.length > 1 ? { loop: L! } : {}) }, from: x.p, to, toCell: c, hit: r === 'hit', star: STARS.includes(c) });
      }
    }
    // назад — только рубить
    if (s.cfg.back) {
      const tb = x.p - v;
      const min = x.marked ? flipAt(s.cfg) : 1;
      if (tb >= min) {
        const c = cellOf(side, tb, tb >= 12 ? x.loop : null);
        if (landing(s, id, c, x.marked, true) === 'hit') out.push({ a: { type: 'move', id, back: true }, from: x.p, to: tb, toCell: c, hit: true, star: false });
      }
    }
  }
  // подъём в столбике на клетке безопасности (и на финише при столбиках)
  if (s.cfg.raise || s.cfg.finishStack) {
    const cells = [...(s.cfg.raise ? SAFE : []), ...(s.cfg.finishStack ? [FINISH] : [])];
    for (const c of cells) {
      const st = s.cells[c];
      if (c === FINISH && st.some((j) => !s.pieces[j].marked)) continue;
      if (v >= 2 && st.length >= v) {
        const j = st[st.length - v];
        if (s.pieces[j].side === side) out.push({ a: { type: 'raise', cell: c, k: v }, from: s.pieces[j].p, to: s.pieces[j].p, toCell: c, hit: false, star: false });
      }
      if (v === 1 && c !== FINISH && st.length >= 2 && s.lastRaise === 1 - side && st.some((j) => s.pieces[j].side === side))
        out.push({ a: { type: 'raise', cell: c, k: 0 }, from: 0, to: 0, toCell: c, hit: false, star: false });
    }
  }
  return out;
}

export function sToAct(s: SState): number[] {
  return s.phase === 'over' ? [] : [s.seats[s.cur]];
}

export function throwTetra(rng: Rng): number[] {
  return [rng.int(2), rng.int(2), rng.int(2)];
}
export const tetraValue = (d: number[]) => {
  const n = d.reduce((a, b) => a + b, 0);
  return n === 0 ? 4 : n;
};
/** Вероятности очков 1–4 (три пирамидки). */
export const TETRA_ODDS = [0, 3 / 8, 3 / 8, 1 / 8, 1 / 8];

const same = (a: SAction, b: SAction) => JSON.stringify(a) === JSON.stringify(b);

export function sapply(s0: SState, seat: number, a: SAction, rng: Rng): { state: SState; events: SEvent[] } | null {
  if (s0.phase === 'over' || seat !== s0.seats[s0.cur]) return null;
  const s: SState = structuredClone(s0);
  const ev: SEvent[] = [];
  if (a.type === 'roll') {
    if (s.phase !== 'roll' && s.phase !== 'start') return null;
    s.dice = throwTetra(rng);
    s.value = tetraValue(s.dice);
    if (s.phase === 'start' && s.value !== 1) {
      ev.push({ type: 'roll', seat, dice: s.dice, value: s.value, none: true, start: true });
      s.cur = 1 - s.cur;
      return { state: s, events: ev };
    }
    s.phase = 'move';
    const none = slegal(s).length === 0;
    ev.push({ type: 'roll', seat, dice: s.dice, value: s.value, none });
    if (none) {
      s.cur = 1 - s.cur;
      s.phase = 'roll';
    }
    return { state: s, events: ev };
  }
  if (s.phase !== 'move') return null;
  const m = slegal(s).find((x) => same(x.a, a));
  if (!m) return null;
  const side = s.cur;
  if (a.type === 'raise') {
    const st = s.cells[a.cell];
    if (a.k === 0) st.reverse();
    else {
      const j = st.splice(st.length - a.k, 1)[0];
      st.push(j);
    }
    s.lastRaise = side;
    ev.push({ type: 'raise', seat, side, cell: a.cell, k: a.k });
    s.cur = 1 - side;
    s.phase = 'roll';
    s.moves++;
    return { state: s, events: ev };
  }
  const x = s.pieces[a.id];
  const fromCell = x.p > 0 ? cellOf(side, x.p, x.loop) : -1;
  if (fromCell >= 0) s.cells[fromCell].pop();
  const from = x.p;
  if (a.loop != null) x.loop = a.loop;
  x.p = m.to;
  if (m.to < 12) x.loop = null;
  let flipped = false;
  if (!x.marked && x.p >= flipAt(s.cfg) && x.p < EXIT) {
    x.marked = true;
    flipped = true;
  }
  let hit: number | null = null;
  let ret = false;
  if (x.p === EXIT) {
    x.marked = true;
  } else {
    const c = m.toCell;
    if (m.hit) {
      hit = s.cells[c].pop()!;
      const y = s.pieces[hit];
      y.p = 0;
      y.marked = false;
      y.loop = null;
    }
    if (a.back && m.hit && STARS.includes(c) && s.cfg.backStar === 'return') {
      // срубила на «звезде» ходом назад — возвращается, откуда пришла
      x.p = from;
      ret = true;
      s.cells[fromCell].push(a.id);
    } else s.cells[c].push(a.id);
  }
  const again = !a.back && m.star;
  s.last = { side, from, to: x.p };
  s.lastRaise = null;
  s.moves++;
  ev.push({ type: 'smove', seat, side, id: a.id, from, to: x.p, fromCell, toCell: ret ? fromCell : m.toCell, back: !!a.back, hit, again, flipped, ret });
  if (s.pieces.filter((q) => q.side === side).every((q) => q.p === EXIT)) {
    s.phase = 'over';
    s.winner = side;
    ev.push({ type: 'end', winner: s.seats[side] });
    return { state: s, events: ev };
  }
  if (!again) s.cur = 1 - side;
  s.phase = 'roll';
  return { state: s, events: ev };
}
