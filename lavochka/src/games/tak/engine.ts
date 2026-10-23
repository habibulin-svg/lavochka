/* Так — правила (без DOM). Квадратная доска 3×3…8×8, у каждого запас камней (и капстоунов на больших досках).
 *
 * Ход — одно из двух:
 *   поставить камень из запаса на пустую клетку: плоским, стоймя («стенка») или капстоун;
 *   переложить стопку, которой владеешь (твой камень сверху): снять сверху до N камней (N — сторона доски), идти по прямой
 *   и на каждой клетке оставлять снизу хотя бы один. На стенку и капстоун ходить нельзя — только капстоун, придя туда
 *   один последним шагом, сплющивает стенку в плоский камень.
 * Первым ходом каждый ставит плоский камень соперника. Белые начинают.
 * Победа — дорога: цепочка твоих верхних плоских камней и капстоунов (стенки не в счёт), соединяющая противоположные края.
 * Ход дал дорогу обоим — побеждает ходивший. Доска заполнилась или у кого-то кончился запас — считают плоские камни сверху:
 * у кого больше, тот выиграл (поровну — ничья).
 */
import type { Options } from '../../core/types';

export type Kind = 'F' | 'S' | 'C';
export interface Piece {
  o: number;
  k: Kind;
}

export interface Cfg {
  size: number;
  stones: number;
  caps: number;
  /** Коми: прибавка чёрным (ходят вторыми) при счёте плоских. */
  komi: number;
}

const RESERVE: Record<number, [number, number]> = { 3: [10, 0], 4: [15, 0], 5: [21, 1], 6: [30, 1], 7: [40, 2], 8: [50, 2] };

export function cfgFrom(o: Options): Cfg {
  const size = [3, 4, 5, 6, 7, 8].includes(Number(o.size)) ? Number(o.size) : 5;
  const [stones, caps] = RESERVE[size];
  return { size, stones, caps, komi: [0, 1, 2].includes(Number(o.komi)) ? Number(o.komi) : 0 };
}

export interface State {
  cfg: Cfg;
  board: Piece[][];
  stones: [number, number];
  caps: [number, number];
  turn: number;
  ply: number;
  last: { cells: number[] } | null;
  over: boolean;
  winner: number | null;
  how: 'road' | 'flats' | null;
  flats: [number, number] | null;
  road: number[] | null;
}

export type View = State;
export type Action = { type: 'place'; at: number; kind: Kind } | { type: 'move'; from: number; dir: number; drops: number[] };
export type Event =
  | { type: 'place'; seat: number; at: number; kind: Kind; owner: number; n: number }
  | { type: 'move'; seat: number; from: number; dir: number; drops: number[]; flatten: boolean; n: number }
  | { type: 'end'; winner: number | null; how: 'road' | 'flats'; flats: [number, number]; road: number[] | null };

export const DIRS: [number, number][] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];
export const DIR_RU = ['вверх', 'вправо', 'вниз', 'влево'];

export function newState(cfg: Cfg): State {
  return {
    cfg,
    board: Array.from({ length: cfg.size * cfg.size }, () => []),
    stones: [cfg.stones, cfg.stones],
    caps: [cfg.caps, cfg.caps],
    turn: 0,
    ply: 0,
    last: null,
    over: false,
    winner: null,
    how: null,
    flats: null,
    road: null,
  };
}

export const setup = (opts: Options): State => newState(cfgFrom(opts));
export const toAct = (s: State): number[] => (s.over ? [] : [s.turn]);
export const top = (s: State, c: number): Piece | undefined => s.board[c][s.board[c].length - 1];
/** Первый ход каждого — камень соперника. */
export const opening = (s: State) => s.ply < 2;

export function next(n: number, c: number, d: number): number {
  const x = (c % n) + DIRS[d][0];
  const y = Math.floor(c / n) + DIRS[d][1];
  return x < 0 || y < 0 || x >= n || y >= n ? -1 : y * n + x;
}

/** Все раскладки k камней по шагам: каждая часть ≥ 1; путь ограничен maxSteps клетками. */
function compositions(k: number, maxSteps: number): number[][] {
  const out: number[][] = [];
  const rec = (left: number, acc: number[]) => {
    if (!left) return void out.push(acc.slice());
    if (acc.length >= maxSteps) return;
    for (let i = 1; i <= left; i++) {
      acc.push(i);
      rec(left - i, acc);
      acc.pop();
    }
  };
  rec(k, []);
  return out;
}

/** Проверка переноса: можно ли и сплющивает ли стенку. */
export function checkMove(s: State, from: number, dir: number, drops: number[]): { ok: boolean; flatten: boolean } {
  const n = s.cfg.size;
  const st = s.board[from];
  const t = st[st.length - 1];
  const k = drops.reduce((x, y) => x + y, 0);
  if (!t || t.o !== s.turn || k < 1 || k > Math.min(n, st.length) || drops.some((x) => x < 1 || !Number.isInteger(x))) return { ok: false, flatten: false };
  const carried = st.slice(st.length - k);
  let c = from;
  let flatten = false;
  let used = 0;
  for (let i = 0; i < drops.length; i++) {
    c = next(n, c, dir);
    if (c < 0) return { ok: false, flatten: false };
    const tt = top(s, c);
    const last = i === drops.length - 1;
    if (tt && tt.k === 'C') return { ok: false, flatten: false };
    if (tt && tt.k === 'S') {
      // сплющить стенку может только капстоун, пришедший один последним шагом
      if (!(last && drops[i] === 1 && carried[carried.length - 1].k === 'C')) return { ok: false, flatten: false };
      flatten = true;
    }
    used += drops[i];
  }
  return { ok: used === k, flatten };
}

export function legal(s: State): Action[] {
  const out: Action[] = [];
  if (s.over) return out;
  const n = s.cfg.size;
  const me = s.turn;
  const op = opening(s);
  for (let c = 0; c < n * n; c++) {
    if (s.board[c].length) continue;
    if (op) out.push({ type: 'place', at: c, kind: 'F' });
    else {
      if (s.stones[me] > 0) out.push({ type: 'place', at: c, kind: 'F' }, { type: 'place', at: c, kind: 'S' });
      if (s.caps[me] > 0) out.push({ type: 'place', at: c, kind: 'C' });
    }
  }
  if (op) return out;
  for (let c = 0; c < n * n; c++) {
    const t = top(s, c);
    if (!t || t.o !== me) continue;
    const h = s.board[c].length;
    for (let d = 0; d < 4; d++) {
      // сколько клеток можно пройти
      let steps = 0;
      for (let p = next(n, c, d); p >= 0; p = next(n, p, d)) {
        const tt = top(s, p);
        if (tt && tt.k === 'C') break;
        steps++;
        if (tt && tt.k === 'S') break;
      }
      if (!steps) continue;
      for (let k = 1; k <= Math.min(n, h); k++)
        for (const drops of compositions(k, steps)) if (checkMove(s, c, d, drops).ok) out.push({ type: 'move', from: c, dir: d, drops });
    }
  }
  return out;
}

/** Дорога игрока: клетки цепочки от края до края (или null). */
export function road(s: State, me: number): number[] | null {
  const n = s.cfg.size;
  const mine = (c: number) => {
    const t = top(s, c);
    return !!t && t.o === me && t.k !== 'S';
  };
  for (const vertical of [true, false]) {
    const prev = new Map<number, number>();
    const q: number[] = [];
    for (let i = 0; i < n; i++) {
      const c = vertical ? i : i * n;
      if (mine(c)) (q.push(c), prev.set(c, -1));
    }
    while (q.length) {
      const c = q.shift()!;
      const done = vertical ? Math.floor(c / n) === n - 1 : c % n === n - 1;
      if (done) {
        const path: number[] = [];
        for (let x = c; x >= 0; x = prev.get(x)!) path.push(x);
        return path;
      }
      for (let d = 0; d < 4; d++) {
        const p = next(n, c, d);
        if (p >= 0 && !prev.has(p) && mine(p)) (prev.set(p, c), q.push(p));
      }
    }
  }
  return null;
}

export function flatCount(s: State): [number, number] {
  const f: [number, number] = [0, 0];
  for (const st of s.board) {
    const t = st[st.length - 1];
    if (t && t.k === 'F') f[t.o]++;
  }
  return f;
}

function finish(s: State, ev: Event[], winner: number | null, how: 'road' | 'flats', rd: number[] | null) {
  s.over = true;
  s.winner = winner;
  s.how = how;
  s.flats = flatCount(s);
  s.road = rd;
  ev.push({ type: 'end', winner, how, flats: s.flats, road: rd });
}

export function step(s0: State, a: Action): { state: State; events: Event[] } | null {
  if (s0.over || !a) return null;
  const n = s0.cfg.size;
  const me = s0.turn;
  const s: State = { ...s0, board: s0.board.map((x) => x.slice()), stones: [...s0.stones] as [number, number], caps: [...s0.caps] as [number, number] };
  const ev: Event[] = [];
  if (a.type === 'place') {
    if (!(a.at >= 0 && a.at < n * n) || s.board[a.at].length) return null;
    const op = opening(s);
    const owner = op ? 1 - me : me;
    if (op && a.kind !== 'F') return null;
    if (a.kind === 'C') {
      if (s.caps[me] <= 0) return null;
      s.caps[me]--;
    } else if (a.kind === 'F' || a.kind === 'S') {
      if (s.stones[op ? 1 - me : me] <= 0) return null;
      s.stones[op ? 1 - me : me]--;
    } else return null;
    s.board[a.at] = [{ o: owner, k: a.kind }];
    s.last = { cells: [a.at] };
    ev.push({ type: 'place', seat: me, at: a.at, kind: a.kind, owner, n });
  } else if (a.type === 'move') {
    if (opening(s) || !Array.isArray(a.drops) || a.dir < 0 || a.dir > 3 || !(a.from >= 0 && a.from < n * n)) return null;
    const chk = checkMove(s, a.from, a.dir, a.drops);
    if (!chk.ok) return null;
    const k = a.drops.reduce((x, y) => x + y, 0);
    const st = s.board[a.from];
    let hand = st.slice(st.length - k);
    s.board[a.from] = st.slice(0, st.length - k);
    let c = a.from;
    const cells: number[] = [];
    for (const d of a.drops) {
      c = next(n, c, a.dir);
      const t = top(s, c);
      if (t && t.k === 'S') s.board[c][s.board[c].length - 1] = { o: t.o, k: 'F' };
      s.board[c] = [...s.board[c], ...hand.slice(0, d)];
      hand = hand.slice(d);
      cells.push(c);
    }
    s.last = { cells: [a.from, ...cells] };
    ev.push({ type: 'move', seat: me, from: a.from, dir: a.dir, drops: a.drops.slice(), flatten: chk.flatten, n });
  } else return null;
  s.ply++;
  s.turn = 1 - me;
  // дороги: ход дал обоим — побеждает ходивший
  const rMe = road(s, me);
  const rOp = road(s, 1 - me);
  if (rMe) finish(s, ev, me, 'road', rMe);
  else if (rOp) finish(s, ev, 1 - me, 'road', rOp);
  else if (s.board.every((x) => x.length) || (s.stones[0] + s.caps[0] === 0 || s.stones[1] + s.caps[1] === 0)) {
    const f = flatCount(s);
    const b = f[1] + s.cfg.komi;
    finish(s, ev, f[0] > b ? 0 : b > f[0] ? 1 : null, 'flats', null);
  } else if (s.ply >= 400) {
    const f = flatCount(s);
    const b = f[1] + s.cfg.komi;
    finish(s, ev, f[0] > b ? 0 : b > f[0] ? 1 : null, 'flats', null);
  }
  return { state: s, events: ev };
}
