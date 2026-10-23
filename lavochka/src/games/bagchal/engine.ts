/* Баг-Чал (Непал, «игра в тигров») — правила без DOM.
 * Доска 5×5 точек: соседние соединены по горизонтали и вертикали, а из точек, где сумма координат чётная, идут и диагонали.
 * 4 тигра стоят в углах, у коз (место 0) — 20 фишек вне доски, козы ходят первыми.
 * Пока не все козы на доске, коза ставится на любую пустую точку; потом козы ходят на соседнюю пустую точку.
 * Тигр ходит на соседнюю пустую точку или прыгает по линии через соседнюю козу на пустую точку за ней — коза снята.
 * Тигры выигрывают, сняв 5 коз; козы — заперев всех тигров. Козе нельзя повторять позицию, уже бывшую в партии
 * (иначе ходят по кругу); через 200 ходов без исхода — ничья.
 * Вариант «мирная расстановка»: пока козы не все на доске, тигры только ходят, но не едят. */
import type { Options } from '../../core/types';

export const N = 5;
export const GOAT = 1;
export const TIGER = 2;
export const GOATS = 0;
export const TIGERS = 1;

export type Look = 'brass' | 'wood';

export interface Cfg {
  /** Сколько коз нужно съесть тиграм. */
  need: number;
  /** Тигры не едят, пока идёт расстановка. */
  calm: boolean;
  look: Look;
}

export function cfgFrom(o: Options): Cfg {
  const need = Number(o.need);
  return { need: need === 4 || need === 6 ? need : 5, calm: o.calm === true, look: o.look === 'wood' ? 'wood' : 'brass' };
}

export interface State {
  cfg: Cfg;
  board: number[];
  turn: number;
  /** Коз ещё вне доски. */
  hand: number;
  eaten: number;
  ply: number;
  /** Позиции фазы ходов (для запрета повторов козам). */
  seen: string[];
  over: boolean;
  winner: number | null;
  last: number[];
}

export type Action = { type: 'place'; to: number } | { type: 'move'; from: number; to: number };
export type Event =
  | { type: 'place'; seat: number; to: number }
  | { type: 'move'; seat: number; from: number; to: number; kind: number; eat: number }
  | { type: 'end'; winner: number | null; why: 'eaten' | 'trapped' | 'long' };

const LIMIT = 200;

/** Соседи точки (с учётом диагоналей). */
export const NEIGH: number[][] = [];
/** Направления из точки: [сосед, точка за ним по той же линии или -1]. */
export const LINES: [number, number][][] = [];
for (let p = 0; p < N * N; p++) {
  const x = p % N;
  const y = (p - x) / N;
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  if ((x + y) % 2 === 0) dirs.push([1, 1], [1, -1], [-1, 1], [-1, -1]);
  const nb: number[] = [];
  const ln: [number, number][] = [];
  for (const [dx, dy] of dirs) {
    const x1 = x + dx;
    const y1 = y + dy;
    if (x1 < 0 || y1 < 0 || x1 >= N || y1 >= N) continue;
    nb.push(y1 * N + x1);
    const x2 = x1 + dx;
    const y2 = y1 + dy;
    ln.push([y1 * N + x1, x2 >= 0 && y2 >= 0 && x2 < N && y2 < N ? y2 * N + x2 : -1]);
  }
  NEIGH.push(nb);
  LINES.push(ln);
}

export function newState(cfg: Cfg): State {
  const board = Array(N * N).fill(0);
  for (const p of [0, N - 1, N * (N - 1), N * N - 1]) board[p] = TIGER;
  return { cfg, board, turn: GOATS, hand: 20, eaten: 0, ply: 0, seen: [], over: false, winner: null, last: [] };
}

export const setup = (_seats: number[], o: Options) => newState(cfgFrom(o));
export const toAct = (s: State) => (s.over ? [] : [s.turn]);
const key = (b: number[]) => b.join('');

/** Ходы тигров (взятия — с eat ≥ 0). */
export function tigerMoves(s: State): Action[] {
  const out: Action[] = [];
  const eat = !(s.cfg.calm && s.hand > 0);
  for (let p = 0; p < N * N; p++) {
    if (s.board[p] !== TIGER) continue;
    for (const [a, b] of LINES[p]) {
      if (!s.board[a]) out.push({ type: 'move', from: p, to: a });
      else if (eat && s.board[a] === GOAT && b >= 0 && !s.board[b]) out.push({ type: 'move', from: p, to: b });
    }
  }
  return out;
}

export function goatMoves(s: State): Action[] {
  const out: Action[] = [];
  if (s.hand > 0) {
    for (let p = 0; p < N * N; p++) if (!s.board[p]) out.push({ type: 'place', to: p });
    return out;
  }
  for (let p = 0; p < N * N; p++) {
    if (s.board[p] !== GOAT) continue;
    for (const q of NEIGH[p]) {
      if (s.board[q]) continue;
      const b = s.board.slice();
      b[p] = 0;
      b[q] = GOAT;
      if (!s.seen.includes(key(b))) out.push({ type: 'move', from: p, to: q });
    }
  }
  return out;
}

export const legal = (s: State): Action[] => (s.over ? [] : s.turn === GOATS ? goatMoves(s) : tigerMoves(s));

/** Какую козу съест прыжок тигра (или -1). */
export function jumped(from: number, to: number): number {
  for (const [a, b] of LINES[from]) if (b === to) return a;
  return -1;
}

/** Применить ход без проверки (для ботов и apply). */
export function step(s0: State, a: Action): { state: State; events: Event[] } {
  const s: State = { ...s0, board: s0.board.slice(), seen: s0.seen, last: [] };
  const seat = s0.turn;
  const events: Event[] = [];
  if (a.type === 'place') {
    s.board[a.to] = GOAT;
    s.hand--;
    s.last = [a.to];
    events.push({ type: 'place', seat, to: a.to });
  } else {
    const kind = s.board[a.from];
    s.board[a.from] = 0;
    s.board[a.to] = kind;
    let eat = -1;
    if (kind === TIGER && !NEIGH[a.from].includes(a.to)) {
      eat = jumped(a.from, a.to);
      s.board[eat] = 0;
      s.eaten++;
    }
    s.last = [a.from, a.to];
    events.push({ type: 'move', seat, from: a.from, to: a.to, kind, eat });
  }
  s.ply++;
  if (s.hand === 0) s.seen = [...s0.seen, key(s.board)];
  s.turn = 1 - seat;
  let why: 'eaten' | 'trapped' | 'long' | null = null;
  if (s.eaten >= s.cfg.need) {
    s.winner = TIGERS;
    why = 'eaten';
  } else if (s.turn === TIGERS && !tigerMoves(s).length) {
    s.winner = GOATS;
    why = 'trapped';
  } else if (s.turn === GOATS && !goatMoves(s).length) {
    // козам некуда ходить (все заперты или ходы повторяют позицию) — выигрывают тигры
    s.winner = TIGERS;
    why = 'trapped';
  } else if (s.ply >= LIMIT) why = 'long';
  if (why) {
    s.over = true;
    events.push({ type: 'end', winner: s.winner, why });
  }
  return { state: s, events };
}

export function apply(s: State, seat: number, a: Action): { state: State; events: Event[] } | null {
  if (s.over || seat !== s.turn || !a) return null;
  const ok = legal(s).some((m) => m.type === a.type && m.to === a.to && (m.type === 'place' || (a.type === 'move' && m.from === a.from)));
  return ok ? step(s, a) : null;
}

/** Сколько тигров заперто (ходить некуда). */
export function trapped(s: State): number {
  let n = 0;
  for (let p = 0; p < N * N; p++) {
    if (s.board[p] !== TIGER) continue;
    if (!LINES[p].some(([a, b]) => !s.board[a] || (s.board[a] === GOAT && b >= 0 && !s.board[b]))) n++;
  }
  return n;
}
