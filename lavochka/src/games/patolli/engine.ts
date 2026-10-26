/* Патолли — игра ацтеков: крест из 52 клеток, пять бобов с точкой вместо кубика, ставки. Без DOM.
 *
 * Реконструкция — по en/ru.wikipedia «Patolli» (Durán, Codex Magliabechiano; Tylor 1879, Caso 1927) и современной
 * «играбельной» версии (playculturalgames.com); единого текста правил нет, спорное — в docs/STATE.md,
 * «Решения, принятые без пользователя».
 *
 * Поле: четыре луча по 2 столбца × 6 рядов и 2×2 клетки в середине — 52 клетки по кругу. Луч k (0 — левый верхний,
 * дальше по часовой): клетки 13k…13k+5 — наружу по столбцу, ближнему к предыдущему лучу, 13k+6…13k+11 — обратно к центру,
 * 13k+12 — средняя клетка между лучами k и k+1. Ряд 3 каждого луча — тёмные треугольники (платишь ставку в кон),
 * ряд 5 — полукруглый конец (бросаешь ещё раз), середина — место, где сбивают.
 * Фишки идут по часовой; у игрока свой луч: фишка входит на его первую клетку (путь 0…51) и уходит, пройдя круг.
 *
 * Бросок — пять бобов, у каждого метка на одной стороне. По Дурану: сколько меток — столько клеток, пять меток — 10,
 * ни одной — подношение (ставка в кон, ход пропал). Вариант: ни одной — 10, пять — 5 и бросок ещё раз.
 * Ставки: треугольник — ставка в кон; сбили в середине — хозяин сбитой платит сбившему; фишка прошла круг — каждый
 * соперник платит ей ставку, а кон забирает она. Кому нечем платить — проигрался и выбывает. */
import type { Options, Rng } from '../../core/types';

export const CELLS = 52;
export const ROWS = 6;
/** Ряд с треугольниками и ряд-полукруг на конце луча. */
export const TRI_ROW = 3;
export const CAP_ROW = 5;

export type Kind = 'plain' | 'tri' | 'cap' | 'mid';

export interface Cfg {
  /** Фишек у игрока. */
  pieces: number;
  /** Ставок у игрока в начале. */
  stakes: number;
  /** Броски: по Дурану (0 — подношение, 5 — 10) или современные (0 — 10, 5 — ещё раз). */
  throws: 'duran' | 'modern';
  /** Вход: только на единицу или любым броском (фишка встаёт на клетку броска). */
  enter: 'one' | 'any';
  /** Сбивать: только в середине креста или везде, кроме полукруглых концов. */
  hit: 'center' | 'any';
  /** Цель: провести все фишки или выиграть все ставки (фишки ходят по кругу снова и снова). */
  goal: 'race' | 'stakes';
  /** Уйти с поля только точным броском. */
  exact: boolean;
}

export function cfgFrom(o: Options): Cfg {
  const p = Number(o.pieces);
  const st = Number(o.stakes);
  return {
    pieces: [2, 3, 4, 6].includes(p) ? p : 6,
    stakes: [4, 6, 10, 15].includes(st) ? st : 10,
    throws: o.throws === 'modern' ? 'modern' : 'duran',
    enter: o.enter === 'any' ? 'any' : 'one',
    hit: o.hit === 'any' ? 'any' : 'center',
    goal: o.goal === 'stakes' ? 'stakes' : 'race',
    exact: o.exact !== false,
  };
}

/** Клетка → вид. */
export function kindOf(cell: number): Kind {
  const j = cell % 13;
  if (j === 12) return 'mid';
  const row = j < 6 ? j : 11 - j;
  return row === TRI_ROW ? 'tri' : row === CAP_ROW ? 'cap' : 'plain';
}

/** Луч каждого места: вдвоём — напротив друг друга, как игроки на листе кодекса. */
export function armsFor(n: number): number[] {
  return n === 2 ? [3, 1] : n === 3 ? [3, 0, 1] : [3, 0, 1, 2];
}

/** Путь фишки p (0…51) → клетка поля. */
export const cellOf = (arm: number, p: number) => (13 * arm + p) % CELLS;

export interface State {
  cfg: Cfg;
  n: number;
  arms: number[];
  /** Фишки мест: −1 — в чаше, 0…51 — на пути, 52 — прошла круг (в гонке). */
  pos: number[][];
  stakes: number[];
  /** Кон — ставки в середине. */
  pot: number;
  /** Сколько кругов прошли фишки места. */
  laps: number[];
  /** Проигрался — выбыл. */
  out: boolean[];
  turn: number;
  phase: 'roll' | 'move' | 'over';
  /** Бобы последнего броска: 1 — меткой вверх. */
  beans: number[];
  /** Сколько клеток ходить; 0 — подношение. */
  value: number;
  /** Бросок ещё раз после хода. */
  again: boolean;
  winners: number[];
  why: 'race' | 'stakes' | 'limit' | null;
  ply: number;
}

/** from: путь фишки (0…51) или −1 — ввести из чаши. */
export type Action = { type: 'roll' } | { type: 'move'; from: number };

export interface Move {
  from: number;
  /** Путь, куда встанет; 52 — ушла с поля (прошла круг). */
  to: number;
  /** Клетки по дороге (последняя — куда встала). */
  path: number[];
  /** Чью фишку сбивает (место) или −1. */
  hit: number;
  kind: Kind | 'home';
}

/** Платёж: от места (−1 — из кона) к месту (−1 — в кон). */
export interface Pay {
  from: number;
  to: number;
  why: 'tri' | 'offer' | 'hit' | 'lap' | 'pot';
}

export type Event =
  | { type: 'roll'; seat: number; beans: number[]; value: number; none: boolean }
  | { type: 'move'; seat: number; from: number; to: number; path: number[]; hit: number; again: boolean }
  | { type: 'pay'; pays: Pay[] }
  | { type: 'bust'; seat: number }
  | { type: 'turn'; seat: number }
  | { type: 'end'; winners: number[]; why: 'race' | 'stakes' | 'limit' };

/** Предел партии в полуходах: дальше побеждает тот, у кого больше ставок (в настоящей партии не встречается). */
export const MAX_PLY = 3000;

/** Вероятность выпасть c меткам из пяти. */
export const PC = [1, 5, 10, 10, 5, 1].map((x) => x / 32);

export function throwValue(cfg: Cfg, beans: number[]): number {
  const c = beans.filter((x) => x).length;
  if (cfg.throws === 'modern') return c === 0 ? 10 : c;
  return c === 5 ? 10 : c;
}

export function newState(cfg: Cfg, n: number, turn = 0): State {
  return {
    cfg,
    n,
    arms: armsFor(n),
    pos: Array.from({ length: n }, () => Array(cfg.pieces).fill(-1)),
    stakes: Array(n).fill(cfg.stakes),
    pot: 0,
    laps: Array(n).fill(0),
    out: Array(n).fill(false),
    turn,
    phase: 'roll',
    beans: [],
    value: 0,
    again: false,
    winners: [],
    why: null,
    ply: 0,
  };
}

export function setup(o: Options, rng: Rng, n: number): State {
  const k = Math.max(2, Math.min(4, n || 2));
  return newState(cfgFrom(o), k, rng.int(k));
}

export const toAct = (s: State) => (s.phase === 'over' ? [] : [s.turn]);

/** Кто стоит на клетке: [место, путь] или null. */
export function occupant(s: State, cell: number): [number, number] | null {
  for (let i = 0; i < s.n; i++) {
    if (s.out[i]) continue;
    for (const p of s.pos[i]) if (p >= 0 && p < CELLS && cellOf(s.arms[i], p) === cell) return [i, p];
  }
  return null;
}

export function canHitAt(cfg: Cfg, cell: number): boolean {
  const k = kindOf(cell);
  return cfg.hit === 'center' ? k === 'mid' : k !== 'cap';
}

function moveFor(s: State, seat: number, from: number, v: number): Move | null {
  const arm = s.arms[seat];
  let to: number;
  const path: number[] = [];
  if (from < 0) {
    if (!s.pos[seat].includes(-1)) return null;
    if (s.cfg.enter === 'one' && v !== 1) return null;
    to = v - 1;
    for (let p = 0; p <= to; p++) path.push(cellOf(arm, p));
  } else {
    if (!s.pos[seat].includes(from) || from >= CELLS) return null;
    to = from + v;
    if (to > CELLS) {
      if (s.cfg.exact) return null;
      to = CELLS;
    }
    for (let p = from + 1; p <= Math.min(to, CELLS - 1); p++) path.push(cellOf(arm, p));
  }
  if (to === CELLS) return { from, to, path, hit: -1, kind: 'home' };
  const cell = cellOf(arm, to);
  const occ = occupant(s, cell);
  let hit = -1;
  if (occ) {
    if (occ[0] === seat || !canHitAt(s.cfg, cell)) return null;
    hit = occ[0];
  }
  return { from, to, path, hit, kind: kindOf(cell) };
}

export function legalMoves(s: State): Move[] {
  if (s.phase !== 'move' || s.value <= 0) return [];
  const seat = s.turn;
  const out: Move[] = [];
  const seen = new Set<number>();
  for (const p of [-1, ...s.pos[seat]]) {
    if (seen.has(p) || p >= CELLS) continue;
    seen.add(p);
    const m = moveFor(s, seat, p, s.value);
    if (m) out.push(m);
  }
  return out;
}

export function legal(s: State): Action[] {
  if (s.phase === 'over') return [];
  if (s.phase === 'roll') return [{ type: 'roll' }];
  return legalMoves(s).map((m) => ({ type: 'move', from: m.from }));
}

function clone(s: State): State {
  return {
    ...s,
    pos: s.pos.map((x) => x.slice()),
    stakes: s.stakes.slice(),
    laps: s.laps.slice(),
    out: s.out.slice(),
    beans: s.beans.slice(),
    winners: s.winners.slice(),
  };
}

const alive = (s: State) => Array.from({ length: s.n }, (_, i) => i).filter((i) => !s.out[i]);

function finish(s: State, ev: Event[], winners: number[], why: 'race' | 'stakes' | 'limit') {
  s.phase = 'over';
  s.winners = winners;
  s.why = why;
  ev.push({ type: 'end', winners, why });
}

/** Проигрался: фишки снимаются с поля. Остался один — он победил. */
function bust(s: State, seat: number, ev: Event[]) {
  s.out[seat] = true;
  s.pos[seat] = s.pos[seat].map(() => -1);
  ev.push({ type: 'bust', seat });
  const a = alive(s);
  if (a.length === 1) finish(s, ev, a, 'stakes');
}

/** Провести платежи по порядку; кому нечем платить — выбывает. */
function settle(s: State, pays: Pay[], ev: Event[]) {
  const done: Pay[] = [];
  const busted: number[] = [];
  for (const p of pays) {
    if (s.phase === 'over') break;
    if (p.from >= 0) {
      if (s.out[p.from] || (p.to >= 0 && s.out[p.to])) continue;
      if (s.stakes[p.from] <= 0) {
        if (!busted.includes(p.from)) busted.push(p.from);
        continue;
      }
      s.stakes[p.from]--;
    } else {
      if (s.pot <= 0) continue;
      s.pot--;
    }
    if (p.to >= 0) s.stakes[p.to]++;
    else s.pot++;
    done.push(p);
  }
  if (done.length) ev.push({ type: 'pay', pays: done });
  for (const b of busted) if (s.phase !== 'over' && !s.out[b]) bust(s, b, ev);
}

/** Конец хода: ещё бросок тому же или следующий по кругу из оставшихся. */
function endTurn(s: State, ev: Event[]) {
  if (s.phase === 'over') return;
  s.phase = 'roll';
  if (s.ply >= MAX_PLY) {
    const a = alive(s);
    const best = Math.max(...a.map((i) => s.stakes[i]));
    return finish(s, ev, a.filter((i) => s.stakes[i] === best), 'limit');
  }
  if (s.again && !s.out[s.turn]) {
    s.again = false;
    ev.push({ type: 'turn', seat: s.turn });
    return;
  }
  s.again = false;
  let t = s.turn;
  for (let i = 0; i < s.n; i++) {
    t = (t + 1) % s.n;
    if (!s.out[t]) break;
  }
  s.turn = t;
  ev.push({ type: 'turn', seat: t });
}

/** Бросок с заданными бобами (показ правил подкручивает их через rig). */
export function applyRoll(s0: State, beans: number[]): { state: State; events: Event[] } {
  const s = clone(s0);
  s.beans = beans.slice();
  s.value = throwValue(s.cfg, beans);
  s.phase = 'move';
  s.ply++;
  s.again = s.cfg.throws === 'modern' && beans.every((x) => x);
  if (s.value === 0) {
    // подношение: ставка в кон, ход пропал
    const ev: Event[] = [{ type: 'roll', seat: s.turn, beans: beans.slice(), value: 0, none: true }];
    s.again = false;
    settle(s, [{ from: s.turn, to: -1, why: 'offer' }], ev);
    endTurn(s, ev);
    return { state: s, events: ev };
  }
  const none = legalMoves(s).length === 0;
  const ev: Event[] = [{ type: 'roll', seat: s.turn, beans: beans.slice(), value: s.value, none }];
  if (none) endTurn(s, ev);
  return { state: s, events: ev };
}

export function applyMove(s0: State, from: number): { state: State; events: Event[] } | null {
  const m = legalMoves(s0).find((x) => x.from === from);
  if (!m) return null;
  const s = clone(s0);
  const seat = s.turn;
  const mine = s.pos[seat];
  mine[mine.indexOf(m.from)] = m.to;
  const pays: Pay[] = [];
  if (m.hit >= 0) {
    const cell = cellOf(s.arms[seat], m.to);
    const occ = s.pos[m.hit];
    for (let k = 0; k < occ.length; k++) if (occ[k] >= 0 && occ[k] < CELLS && cellOf(s.arms[m.hit], occ[k]) === cell) occ[k] = -1;
    pays.push({ from: m.hit, to: seat, why: 'hit' });
  }
  if (m.kind === 'tri') pays.push({ from: seat, to: -1, why: 'tri' });
  if (m.kind === 'cap') s.again = true;
  if (m.kind === 'home') {
    s.laps[seat]++;
    if (s.cfg.goal === 'stakes') mine[mine.indexOf(CELLS)] = -1;
    for (let i = 1; i < s.n; i++) pays.push({ from: (seat + i) % s.n, to: seat, why: 'lap' });
  }
  s.ply++;
  const ev: Event[] = [{ type: 'move', seat, from: m.from, to: m.to, path: m.path, hit: m.hit, again: s.again }];
  // кон забирает прошедший круг — после того, как соперники заплатили
  const potTake = m.kind === 'home' ? s.pot : 0;
  settle(s, pays, ev);
  if (potTake && s.phase !== 'over' && !s.out[seat]) settle(s, Array.from({ length: s.pot }, () => ({ from: -1, to: seat, why: 'pot' as const })), ev);
  if (s.phase !== 'over' && s.out[seat]) s.again = false;
  if (s.phase !== 'over' && s.cfg.goal === 'race' && mine.every((p) => p === CELLS)) finish(s, ev, [seat], 'race');
  endTurn(s, ev);
  return { state: s, events: ev };
}

export function apply(s: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (s.phase === 'over' || seat !== s.turn || !a || typeof a !== 'object') return null;
  if (a.type === 'roll') return s.phase === 'roll' ? applyRoll(s, [0, 1, 2, 3, 4].map(() => rng.int(2))) : null;
  if (a.type === 'move' && s.phase === 'move' && Number.isInteger(a.from)) return applyMove(s, a.from);
  return null;
}
