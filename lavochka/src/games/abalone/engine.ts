/* Абалон — правила (без DOM). Шестиугольная доска на 61 лунку (по 5 с каждой стороны), по 14 шаров; первыми ходят чёрные.
 *
 * Ход — один, два или три своих шара, стоящих подряд на одной линии, сдвигаются на одну лунку в одном из шести направлений:
 *   «в линию» (вдоль своей линии) — передний шар идёт в пустую лунку или толкает чужие;
 *   «вбок» (два-три шара поперёк своей линии) — все лунки впереди должны быть пустыми, толкать вбок нельзя.
 * Сумито — толчок в линию: своих больше, чем чужих впереди (2 против 1, 3 против 1, 3 против 2), за чужими — пусто или край доски;
 * чужой шар за краем выбывает. Свой шар вытолкнуть нельзя, и толкать больше трёх своих нельзя.
 * Выигрывает тот, кто первым вытолкнул 6 шаров соперника. Предел ходов — побеждает вытолкнувший больше, поровну — ничья.
 */
import type { Options } from '../../core/types';

export type Layout = 'standard' | 'belgian' | 'german';

export interface Cfg {
  layout: Layout;
  /** Сколько шаров вытолкнуть для победы. */
  goal: number;
  /** Вид: чёрный пластик или тёмное дерево. */
  skin: 'classic' | 'wood';
}

export function cfgFrom(o: Options): Cfg {
  const layout: Layout = o.layout === 'belgian' || o.layout === 'german' ? o.layout : 'standard';
  return { layout, goal: [4, 6].includes(Number(o.goal)) ? Number(o.goal) : 6, skin: o.skin === 'wood' ? 'wood' : 'classic' };
}

export const N = 61;
export const R = 4;
/** Клетки: осевые координаты (q, r), |q|, |r|, |q + r| ≤ 4. Порядок — по рядам сверху вниз (r = −4 … 4), в ряду слева направо. */
export const CELLS: { q: number; r: number; row: number; col: number }[] = [];
const IDX = new Map<string, number>();
for (let r = -R; r <= R; r++) {
  const qmin = Math.max(-R, -R - r);
  const qmax = Math.min(R, R - r);
  for (let q = qmin; q <= qmax; q++) {
    IDX.set(`${q},${r}`, CELLS.length);
    CELLS.push({ q, r, row: r + R, col: q - qmin });
  }
}
export const at = (q: number, r: number) => IDX.get(`${q},${r}`) ?? -1;
export const byRow = (row: number, col: number) => CELLS.findIndex((c) => c.row === row && c.col === col);
/** Шесть направлений: 0 — вправо, дальше по часовой (на экране y вниз). */
export const DIRS: [number, number][] = [
  [1, 0],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [0, -1],
  [1, -1],
];
/** Сосед клетки в направлении (−1 — за краем). */
export const NB: number[][] = CELLS.map((c) => DIRS.map(([dq, dr]) => at(c.q + dq, c.r + dr)));
export const ring = (i: number) => Math.max(Math.abs(CELLS[i].q), Math.abs(CELLS[i].r), Math.abs(CELLS[i].q + CELLS[i].r));

function layout(kind: Layout): number[] {
  const b = new Array<number>(N).fill(-1);
  const put = (rows: string[]) =>
    rows.forEach((line, row) =>
      line
        .replace(/\s+/g, '')
        .split('')
        .forEach((ch, col) => {
          if (ch === 'B') b[byRow(row, col)] = 0;
          else if (ch === 'W') b[byRow(row, col)] = 1;
        })
    );
  if (kind === 'standard') put(['WWWWW', 'WWWWWW', '..WWW..', '........', '.........', '........', '..BBB..', 'BBBBBB', 'BBBBB']);
  else if (kind === 'belgian') put(['WW.BB', 'WWWBBB', '.WW.BB.', '........', '.........', '........', '.BB.WW.', 'BBBWWW', 'BB.WW']);
  else put(['.....', 'WW..BB', 'WWW.BBB', '.WW..BB.', '.........', '.BB..WW.', 'BBB.WWW', 'BB..WW', '.....']);
  return b;
}

export interface State {
  cfg: Cfg;
  board: number[];
  /** Сколько шаров потерял каждый (вытолкнуты). */
  lost: [number, number];
  turn: number;
  ply: number;
  last: { cells: number[]; dir: number; pushed: number[]; out: boolean } | null;
  over: boolean;
  winner: number | null;
}

export type View = State;
/** w — только для порядка перебора у ботов: толкает (1) или выталкивает (2). */
export type Action = { type: 'move'; cells: number[]; dir: number; w?: number };
export type Event = { type: 'move'; seat: number; cells: number[]; dir: number; pushed: number[]; out: boolean } | { type: 'end'; winner: number | null; lost: [number, number] };

export const MAX_PLY = 300;

export function newState(cfg: Cfg): State {
  return { cfg, board: layout(cfg.layout), lost: [0, 0], turn: 0, ply: 0, last: null, over: false, winner: null };
}

export const setup = (opts: Options): State => newState(cfgFrom(opts));
export const toAct = (s: State): number[] => (s.over ? [] : [s.turn]);

const parallel = (axis: number, d: number) => d % 3 === axis % 3;

/** Разбор хода: проверка и что толкается. null — нельзя. */
export function resolve(s: State, cells: number[], dir: number): { line: number[]; pushed: number[]; out: boolean } | null {
  const me = s.turn;
  if (dir < 0 || dir > 5 || !cells.length || cells.length > 3) return null;
  if (cells.some((c) => c < 0 || c >= N || s.board[c] !== me)) return null;
  if (new Set(cells).size !== cells.length) return null;
  // упорядочить по линии
  let line = cells.slice();
  let axis = -1;
  if (cells.length > 1) {
    for (let a = 0; a < 3 && axis < 0; a++) {
      const start = cells.find((c) => !cells.includes(NB[c][a + 3]));
      if (start == null) continue;
      const seq = [start];
      while (seq.length < cells.length && cells.includes(NB[seq[seq.length - 1]][a])) seq.push(NB[seq[seq.length - 1]][a]);
      if (seq.length === cells.length) {
        axis = a;
        line = seq;
      }
    }
    if (axis < 0) return null;
  }
  if (cells.length === 1 || parallel(axis, dir)) {
    // в линию: передний — по направлению хода
    const front = dir === axis || cells.length === 1 ? line[line.length - 1] : line[0];
    let p = NB[front][dir];
    if (p < 0) return null;
    if (s.board[p] === -1) return { line, pushed: [], out: false };
    if (s.board[p] === me) return null;
    const pushed: number[] = [];
    while (p >= 0 && s.board[p] === 1 - me) {
      pushed.push(p);
      p = NB[p][dir];
    }
    if (pushed.length >= line.length) return null;
    if (p >= 0 && s.board[p] !== -1) return null;
    return { line, pushed, out: p < 0 };
  }
  // вбок: все лунки впереди пусты
  for (const c of line) {
    const p = NB[c][dir];
    if (p < 0 || s.board[p] !== -1) return null;
  }
  return { line, pushed: [], out: false };
}

/** Все ходы (линии из 1–3 шаров × 6 направлений). */
export function legal(s: State): Action[] {
  const out: Action[] = [];
  const me = s.turn;
  for (let c = 0; c < N; c++) {
    if (s.board[c] !== me) continue;
    for (let d = 0; d < 6; d++) {
      const r = resolve(s, [c], d);
      if (r) out.push({ type: 'move', cells: [c], dir: d, w: 0 });
    }
    for (let a = 0; a < 3; a++) {
      const line = [c];
      for (let k = 1; k < 3; k++) {
        const nx = NB[line[line.length - 1]][a];
        if (nx < 0 || s.board[nx] !== me) break;
        line.push(nx);
        for (let d = 0; d < 6; d++) {
          const r = resolve(s, line, d);
          if (r) out.push({ type: 'move', cells: line.slice(), dir: d, w: r.out ? 2 : r.pushed.length ? 1 : 0 });
        }
      }
    }
  }
  return out;
}

export function step(s0: State, a: Action): { state: State; events: Event[] } | null {
  if (s0.over || !a || a.type !== 'move' || !Array.isArray(a.cells)) return null;
  const r = resolve(s0, a.cells, a.dir);
  if (!r) return null;
  const s: State = { ...s0, board: s0.board.slice(), lost: [...s0.lost] as [number, number] };
  const me = s.turn;
  const d = a.dir;
  // сначала чужие (с дальнего), потом свои
  for (let i = r.pushed.length - 1; i >= 0; i--) {
    const c = r.pushed[i];
    const t = NB[c][d];
    if (t >= 0) s.board[t] = 1 - me;
    else s.lost[1 - me]++;
    s.board[c] = -1;
  }
  for (const c of r.line) s.board[c] = -1;
  for (const c of r.line) s.board[NB[c][d]] = me;
  s.last = { cells: r.line, dir: d, pushed: r.pushed, out: r.out };
  s.ply++;
  const events: Event[] = [{ type: 'move', seat: me, cells: r.line, dir: d, pushed: r.pushed, out: r.out }];
  if (s.lost[1 - me] >= s.cfg.goal) {
    s.over = true;
    s.winner = me;
  } else if (s.ply >= MAX_PLY) {
    s.over = true;
    s.winner = s.lost[0] === s.lost[1] ? null : s.lost[0] < s.lost[1] ? 0 : 1;
  } else s.turn = 1 - me;
  if (s.over) events.push({ type: 'end', winner: s.winner, lost: [...s.lost] as [number, number] });
  return { state: s, events };
}
