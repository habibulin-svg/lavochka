/* Далдос (далдоса) — датско-норвежская игра на доске-лодке. Без DOM.
 *
 * Реконструкция — по en.wikipedia «Daldøs» (Billeskov Jansen 1927, Michaelsen 2001, Østergaard & Gaston 2001, Næsheim 2001);
 * спорное — в docs/STATE.md, «Решения, принятые без пользователя».
 *
 * Доска — три ряда лунок: 0 — домашний ряд места 0 (снизу), 1 — средний, 2 — домашний ряд места 1. В крайних рядах по H лунок,
 * в среднем — H + 1: лишняя лунка в носу. Столбец 0 — у кормы, H − 1 (и H в среднем ряду) — у носа. Клетка = ряд * W + столбец,
 * W = H + 1.
 *
 * Путь фишки: по своему ряду от носа к корме, из кормовой лунки — в средний ряд, по нему к носу, из носовой лунки — в ряд
 * соперника, по нему к корме, снова в средний ряд и так по кругу (в свой ряд фишка больше не возвращается). Оба игрока ходят
 * по среднему ряду в одну сторону.
 *
 * В начале все фишки стоят в своём ряду поперёк ряда — «не далены». Сдвинуть фишку можно, только «надалив» её: кость «A» (дал)
 * разворачивает фишку вдоль ряда и продвигает на одну лунку. Две кости-призмы: A (1), II, III, IIII. Очки костей ходят
 * разными фишками или складываются для одной (тогда снимается только фишка соперника в конце хода). Через свои фишки
 * перескакивать нельзя, через чужие — можно (их это не снимает); встать на свою нельзя, встав на чужую — снимаешь её.
 * Обе кости надо использовать, если можно; нельзя — хотя бы одну; нельзя и её — ход пропал. Дал-дал (две A) — ещё бросок.
 * Цель — снять все фишки соперника. */
import type { Options, Rng } from '../../core/types';

export type Size = 'dk' | 'no';
export interface Cfg {
  /** dk — датская доска 16 + 17 + 16, по 16 фишек; no — норвежская 12 + 13 + 12, по 12. */
  size: Size;
  /** Далить можно только недаленную фишку, ближайшую к корме. */
  sternOnly: boolean;
  /** Сложенными костями снимается и фишка на промежуточной лунке. */
  passCapture: boolean;
  /** Проигрывает тот, у кого осталась одна фишка. */
  lastOne: boolean;
}

export function cfgFrom(o: Options): Cfg {
  return { size: o.size === 'no' ? 'no' : 'dk', sternOnly: o.sternOnly === true, passCapture: o.passCapture === true, lastOne: o.lastOne === true };
}

/** Лунок в крайнем ряду. */
export const holes = (c: Cfg) => (c.size === 'no' ? 12 : 16);
/** Ширина строки клеток (лунок в среднем ряду). */
export const width = (c: Cfg) => holes(c) + 1;
export const cellOf = (c: Cfg, row: number, col: number) => row * width(c) + col;
export const rowOf = (c: Cfg, cell: number) => Math.floor(cell / width(c));
export const colOf = (c: Cfg, cell: number) => cell % width(c);
/** Ряд места: свой (домашний) и соперника. */
export const homeRow = (seat: number) => (seat === 0 ? 0 : 2);
/** Предел партии в полуходах: дальше — побеждает тот, у кого больше фишек (в настоящей партии не встречается). */
export const MAX_PLY = 3000;

/** Значения граней: A = 1. */
export const FACES = [1, 2, 3, 4];

/** Содержимое лунки: 0 — пусто, иначе место + 1 (и признак «надалена»). */
export interface Peg {
  seat: number;
  dal: boolean;
}

export interface State {
  cfg: Cfg;
  board: (Peg | null)[];
  turn: number;
  phase: 'roll' | 'move' | 'over';
  /** Выпавшие кости (1…4). */
  dice: number[];
  /** Какие кости уже сыграны. */
  used: boolean[];
  /** Куда встала фишка, сыгравшая первую кость отдельно: второй костью ей ходить нельзя (иначе это сложение). */
  moved: number;
  /** Фишек на доске. */
  count: [number, number];
  winner: number | null;
  why: 'all' | 'one' | 'limit' | null;
  ply: number;
}

/** use: номер кости или 2 — обе кости сложены на одну фишку. */
export type Action = { type: 'roll' } | { type: 'move'; from: number; to: number; use: number };

export interface Move {
  from: number;
  to: number;
  use: number;
  /** Лунки, по которым пройдёт фишка (последняя — to). */
  path: number[];
  /** Снимаемые фишки соперника. */
  took: number[];
  dal: boolean;
}

export type Event =
  | { type: 'roll'; seat: number; dice: number[]; none: boolean; again: boolean; size: Size }
  | { type: 'move'; seat: number; from: number; to: number; path: number[]; took: number[]; dal: boolean; dice: number[] }
  | { type: 'turn'; seat: number; again: boolean }
  | { type: 'end'; winner: number | null; why: 'all' | 'one' | 'limit' };

export function newState(cfg: Cfg, turn = 0): State {
  const H = holes(cfg);
  const board: (Peg | null)[] = Array(3 * width(cfg)).fill(null);
  for (let c = 0; c < H; c++) {
    board[cellOf(cfg, 0, c)] = { seat: 0, dal: false };
    board[cellOf(cfg, 2, c)] = { seat: 1, dal: false };
  }
  return { cfg, board, turn, phase: 'roll', dice: [], used: [], moved: -1, count: [H, H], winner: null, why: null, ply: 0 };
}

export const setup = (o: Options, rng: Rng) => {
  // «Кто больше выбросит» — первым ходит выигравший пробный бросок
  let first = 0;
  for (let i = 0; i < 20; i++) {
    const a = rng.int(4) + rng.int(4);
    const b = rng.int(4) + rng.int(4);
    if (a !== b) {
      first = a > b ? 0 : 1;
      break;
    }
  }
  return newState(cfgFrom(o), first);
};

export const toAct = (s: State) => (s.phase === 'over' ? [] : [s.turn]);

/** Следующая лунка пути места после cell. */
export function next(cfg: Cfg, seat: number, cell: number): number {
  const H = holes(cfg);
  const row = rowOf(cfg, cell);
  const col = colOf(cfg, cell);
  if (row === 1) return col === H ? cellOf(cfg, 2 - homeRow(seat), H - 1) : cell + 1;
  if (row === homeRow(seat)) return col === 0 ? cellOf(cfg, 1, 0) : cell - 1;
  // ряд соперника: к корме, из кормы — в средний ряд
  return col === 0 ? cellOf(cfg, 1, 0) : cell - 1;
}

/** k лунок пути от cell (без неё самой). */
export function walk(cfg: Cfg, seat: number, cell: number, k: number): number[] {
  const out: number[] = [];
  let c = cell;
  for (let i = 0; i < k; i++) out.push((c = next(cfg, seat, c)));
  return out;
}

/** Недаленная фишка места, ближайшая к корме (у неё самый маленький столбец в своём ряду). */
function sternmost(s: State, seat: number): number {
  const W = width(s.cfg);
  const r = homeRow(seat);
  for (let c = 0; c < W - 1; c++) {
    const p = s.board[r * W + c];
    if (p && p.seat === seat && !p.dal) return r * W + c;
  }
  return -1;
}

/** Ход фишкой from на k лунок костью use (у недаленной фишки первая лунка — это дал). null — нельзя. */
function tryMove(s: State, seat: number, from: number, k: number, use: number): Move | null {
  const peg = s.board[from];
  if (!peg || peg.seat !== seat) return null;
  if (!peg.dal) {
    // далят костью A: отдельной или в сложении
    const a = use === 2 ? s.dice.includes(1) : s.dice[use] === 1;
    if (!a) return null;
    if (s.cfg.sternOnly && sternmost(s, seat) !== from) return null;
  }
  const path = walk(s.cfg, seat, from, k);
  for (const c of path) if (s.board[c]?.seat === seat) return null; // свои не перепрыгнуть и на свою не встать
  const to = path[path.length - 1];
  const took: number[] = [];
  if (use === 2 && s.cfg.passCapture) {
    // и с промежуточной лунки, где кончилась первая кость: у недаленной — после дала, иначе — после любой из костей
    const firsts = peg.dal ? [s.dice[0], s.dice[1]] : [1];
    const mid = firsts.map((f) => path[f - 1]).find((c) => c !== to && s.board[c] && s.board[c]!.seat !== seat);
    if (mid != null) took.push(mid);
  }
  if (s.board[to]) took.push(to);
  return { from, to, use, path, took, dal: !peg.dal };
}

/** Ходы одной костью или сложением (без правила «использовать обе»). */
function rawMoves(s: State): Move[] {
  const seat = s.turn;
  const out: Move[] = [];
  const free = [0, 1].filter((i) => !s.used[i]);
  s.board.forEach((p, cell) => {
    if (!p || p.seat !== seat || cell === s.moved) return;
    for (const i of free) {
      if (i === 1 && free.length === 2 && s.dice[0] === s.dice[1]) continue; // одинаковые кости — один и тот же ход
      const m = tryMove(s, seat, cell, s.dice[i], i);
      if (m) out.push(m);
    }
    if (free.length === 2) {
      const m = tryMove(s, seat, cell, s.dice[0] + s.dice[1], 2);
      if (m) out.push(m);
    }
  });
  return out;
}

function doMove(s0: State, m: Move): State {
  const s: State = { ...s0, board: s0.board.slice(), used: s0.used.slice(), count: [s0.count[0], s0.count[1]] };
  const peg = s.board[m.from]!;
  for (const t of m.took) {
    const v = s.board[t];
    if (v) s.count[v.seat]--;
    s.board[t] = null;
  }
  s.board[m.from] = null;
  s.board[m.to] = { seat: peg.seat, dal: true };
  if (m.use === 2) s.used = [true, true];
  else {
    s.used[m.use] = true;
    s.moved = m.to;
  }
  return s;
}

/** Можно ли сыграть обе кости (обе свободны): 2 — да, 1 — только одну, 0 — ни одной. */
function canUse(s: State): number {
  let best = 0;
  for (const m of rawMoves(s)) {
    if (m.use === 2 || rawMoves(doMove(s, m)).length) return 2;
    best = 1;
  }
  return best;
}

/** Ходы, которые сейчас можно сделать (с правилом «обе кости, если можно»). */
export function legalMoves(s: State): Move[] {
  if (s.phase !== 'move') return [];
  const raw = rawMoves(s);
  if (!raw.length) return [];
  const left = s.used.filter((u) => !u).length;
  if (left < 2) return raw;
  const need = canUse(s);
  if (need < 2) return raw;
  return raw.filter((m) => m.use === 2 || rawMoves(doMove(s, m)).length > 0);
}

export function legal(s: State): Action[] {
  if (s.phase === 'over') return [];
  if (s.phase === 'roll') return [{ type: 'roll' }];
  return legalMoves(s).map((m) => ({ type: 'move', from: m.from, to: m.to, use: m.use }));
}

function clone(s: State): State {
  return { ...s, board: s.board.slice(), dice: s.dice.slice(), used: s.used.slice(), count: [s.count[0], s.count[1]] };
}

/** Конец хода: дал-дал — ещё бросок, иначе ход соперника. Партия могла кончиться. */
function endTurn(s: State, ev: Event[]) {
  const again = s.dice[0] === 1 && s.dice[1] === 1;
  s.phase = 'roll';
  s.used = [];
  s.moved = -1;
  if (!again) s.turn = 1 - s.turn;
  if (s.ply >= MAX_PLY) {
    const [a, b] = s.count;
    return finish(s, ev, a === b ? null : a > b ? 0 : 1, 'limit');
  }
  ev.push({ type: 'turn', seat: s.turn, again });
}

function finish(s: State, ev: Event[], winner: number | null, why: 'all' | 'one' | 'limit') {
  s.phase = 'over';
  s.winner = winner;
  s.why = why;
  ev.push({ type: 'end', winner, why });
}

/** Бросок с заданными костями (показ правил подкручивает их через rig). */
export function applyRoll(s0: State, dice: number[]): { state: State; events: Event[] } {
  const s = clone(s0);
  s.dice = dice;
  s.used = [false, false];
  s.moved = -1;
  s.phase = 'move';
  s.ply++;
  const none = legalMoves(s).length === 0;
  const again = dice[0] === 1 && dice[1] === 1;
  const ev: Event[] = [{ type: 'roll', seat: s.turn, dice: dice.slice(), none, again, size: s.cfg.size }];
  if (none) endTurn(s, ev);
  return { state: s, events: ev };
}

export function applyMove(s0: State, a: Action & { type: 'move' }): { state: State; events: Event[] } | null {
  const m = legalMoves(s0).find((x) => x.from === a.from && x.to === a.to && x.use === a.use);
  if (!m) return null;
  const seat = s0.turn;
  const s = doMove(s0, m);
  s.dice = s0.dice.slice();
  s.ply++;
  const ev: Event[] = [{ type: 'move', seat, from: m.from, to: m.to, path: m.path, took: m.took, dal: m.dal, dice: m.use === 2 ? s.dice.slice() : [s.dice[m.use]] }];
  const opp = 1 - seat;
  if (s.count[opp] === 0) finish(s, ev, seat, 'all');
  else if (s.cfg.lastOne && s.count[opp] <= 1) finish(s, ev, seat, 'one');
  else if (s.used.every((u) => u) || !legalMoves(s).length) endTurn(s, ev);
  return { state: s, events: ev };
}

export function apply(s: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (s.phase === 'over' || seat !== s.turn || !a || typeof a !== 'object') return null;
  if (a.type === 'roll') return s.phase === 'roll' ? applyRoll(s, [rng.int(4) + 1, rng.int(4) + 1]) : null;
  if (a.type === 'move' && s.phase === 'move') return applyMove(s, a);
  return null;
}

/** Фишек места: надаленных и нет. */
export function tally(s: State, seat: number): { dal: number; wait: number } {
  let dal = 0;
  let wait = 0;
  for (const p of s.board) if (p && p.seat === seat) p.dal ? dal++ : wait++;
  return { dal, wait };
}
