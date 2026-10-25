/* Санторин — правила (без DOM). Поле 5×5, у каждого два строителя.
 *
 * Сначала расстановка: первый игрок ставит обоих строителей на любые свободные клетки, потом второй.
 * Ход — два действия одним строителем:
 *   шаг на любую из восьми соседних клеток: свободную, без купола, подняться можно не больше чем на ярус (спускаться — на сколько угодно);
 *   постройка на соседней с ним свободной клетке: ярус выше (0→1→2→3), на третьем ярусе — купол. Купол — навсегда.
 * Победа — строитель поднялся на третий ярус (с яруса 2). Не может сходить ни один строитель — проиграл.
 */
import type { Options } from '../../core/types';

export const N = 5;

export interface State {
  /** Высота клеток: 0–3 ярусы. */
  h: number[];
  /** Купол на клетке (ставится только на третий ярус). */
  dome: boolean[];
  /** Клетки строителей: workers[seat][i], -1 — ещё не поставлен. */
  workers: [number[], number[]];
  turn: number;
  phase: 'place' | 'move' | 'build';
  /** Какой строитель ходит в этом ходу (после шага). */
  active: number | null;
  ply: number;
  last: { from: number | null; to: number | null; built: number | null } | null;
  over: boolean;
  winner: number | null;
  how: 'climb' | 'stuck' | null;
}

export type View = State;
export type Action = { type: 'place'; at: number } | { type: 'move'; w: number; to: number } | { type: 'build'; at: number };
export type Event =
  | { type: 'place'; seat: number; at: number }
  | { type: 'move'; seat: number; w: number; from: number; to: number; up: number }
  | { type: 'build'; seat: number; at: number; level: number; dome: boolean }
  | { type: 'end'; winner: number; how: 'climb' | 'stuck' };

/** Предел ходов (страховка, в настоящей партии не нужен): дальше побеждает тот, чьи строители выше. */
export const MAX_PLY = 300;

export function newState(): State {
  return {
    h: new Array(N * N).fill(0),
    dome: new Array(N * N).fill(false),
    workers: [
      [-1, -1],
      [-1, -1],
    ],
    turn: 0,
    phase: 'place',
    active: null,
    ply: 0,
    last: null,
    over: false,
    winner: null,
    how: null,
  };
}

export const setup = (_o: Options): State => newState();
export const toAct = (s: State): number[] => (s.over ? [] : [s.turn]);
export const rc = (c: number): [number, number] => [Math.floor(c / N), c % N];

export function around(c: number): number[] {
  const [r, k] = rc(c);
  const out: number[] = [];
  for (let dr = -1; dr <= 1; dr++)
    for (let dk = -1; dk <= 1; dk++) {
      if (!dr && !dk) continue;
      const rr = r + dr;
      const kk = k + dk;
      if (rr >= 0 && rr < N && kk >= 0 && kk < N) out.push(rr * N + kk);
    }
  return out;
}

export const occupied = (s: State, c: number) => s.workers[0].includes(c) || s.workers[1].includes(c);
export const free = (s: State, c: number) => !s.dome[c] && !occupied(s, c);

/** Куда может шагнуть строитель с клетки from. */
export function stepsFrom(s: State, from: number): number[] {
  return around(from).filter((c) => free(s, c) && s.h[c] <= s.h[from] + 1);
}

/** Где можно строить рядом с клеткой at. */
export function buildsFrom(s: State, at: number): number[] {
  return around(at).filter((c) => free(s, c));
}

export function legal(s: State): Action[] {
  if (s.over) return [];
  const me = s.turn;
  if (s.phase === 'place') {
    const out: Action[] = [];
    for (let c = 0; c < N * N; c++) if (!occupied(s, c)) out.push({ type: 'place', at: c });
    return out;
  }
  if (s.phase === 'move') {
    const out: Action[] = [];
    s.workers[me].forEach((c, w) => {
      for (const to of stepsFrom(s, c)) out.push({ type: 'move', w, to });
    });
    return out;
  }
  return buildsFrom(s, s.workers[me][s.active!]).map((at) => ({ type: 'build', at }) as Action);
}

const canMove = (s: State, seat: number) => s.workers[seat].some((c) => stepsFrom(s, c).length > 0);

function endTurn(s: State, events: Event[]) {
  s.turn = 1 - s.turn;
  s.phase = 'move';
  s.active = null;
  s.ply++;
  if (!canMove(s, s.turn)) {
    s.over = true;
    s.winner = 1 - s.turn;
    s.how = 'stuck';
    events.push({ type: 'end', winner: s.winner, how: 'stuck' });
  } else if (s.ply >= MAX_PLY) {
    // страховка от бесконечной партии: побеждает тот, чьи строители выше
    const top = (seat: number) => s.workers[seat].reduce((a, c) => a + s.h[c], 0);
    s.over = true;
    s.winner = top(0) >= top(1) ? 0 : 1;
    s.how = 'stuck';
    events.push({ type: 'end', winner: s.winner, how: 'stuck' });
  }
}

export function apply(s0: State, a: Action): { state: State; events: Event[] } {
  const s: State = { ...s0, h: [...s0.h], dome: [...s0.dome], workers: [[...s0.workers[0]], [...s0.workers[1]]] };
  const me = s.turn;
  const events: Event[] = [];
  if (a.type === 'place') {
    const w = s.workers[me].indexOf(-1);
    s.workers[me][w] = a.at;
    s.last = { from: null, to: a.at, built: null };
    events.push({ type: 'place', seat: me, at: a.at });
    if (w === 1) {
      if (me === 0) s.turn = 1;
      else {
        s.turn = 0;
        s.phase = 'move';
      }
    }
    return { state: s, events };
  }
  if (a.type === 'move') {
    const from = s.workers[me][a.w];
    s.workers[me][a.w] = a.to;
    s.active = a.w;
    s.last = { from, to: a.to, built: null };
    const up = s.h[a.to] - s.h[from];
    events.push({ type: 'move', seat: me, w: a.w, from, to: a.to, up });
    if (s.h[a.to] === 3 && up === 1) {
      s.over = true;
      s.winner = me;
      s.how = 'climb';
      events.push({ type: 'end', winner: me, how: 'climb' });
      return { state: s, events };
    }
    s.phase = 'build';
    return { state: s, events };
  }
  if (s.h[a.at] === 3) s.dome[a.at] = true;
  else s.h[a.at]++;
  s.last = { ...(s.last ?? { from: null, to: null }), built: a.at };
  events.push({ type: 'build', seat: me, at: a.at, level: s.h[a.at], dome: s.dome[a.at] });
  endTurn(s, events);
  return { state: s, events };
}

export function step(s: State, a: Action): { state: State; events: Event[] } | null {
  if (s.over) return null;
  const ok = legal(s).some((m) => JSON.stringify(m) === JSON.stringify(a));
  return ok ? apply(s, a) : null;
}
