/* В путь-дорогу (Н. Обухова, «Малыш», 1990) — правила без DOM.
 *
 * Поле: две кольцевые дорожки по 20 клеток, клетки стоят парами «одна под другой»: наружная — для автобусов,
 * внутренняя — для пешеходов. В середине — город, по углам — четыре парка (жёлтый, красный, синий, зелёный).
 * Автобусы стоят на остановках «А», у каждого игрока — три пешехода своего цвета в городе.
 * Ход: бросить кубик, вывести нового пешехода (отсчёт от любой синей стрелки, сама клетка со стрелкой — первая)
 * или передвинуть того, что уже на дорожке; затем передвинуть все четыре автобуса на одну клетку.
 * Все движутся в одну сторону — против часовой стрелки. На клетке может быть сколько угодно пешеходов.
 * Сесть в свой автобус можно, когда он на соседней клетке («один под другим»), — и в чужой ход тоже.
 * Полный автобус въезжает в парк с одной из двух клеток, граничащих с ним (в правилах — «в одном из углов»;
 * парк своего цвета — вариант). Кто первым отвёз ребят в парк — победил.
 * Решения без пользователя: автобус въезжает в парк при движении автобусов, если уже стоит на одной из двух клеток у
 * своего парка; партия кончается на первом автобусе в парке; 600 ходов без исхода — побеждает тот, у кого больше ребят в автобусе. */
import type { Options, Rng } from '../../core/types';

export const CELLS = 20;
/** Лучи между клетками, градусы (0 — вправо, 90 — вниз): клетка k — между лучами k и k+1. */
export const RAYS = [0, 15.8, 32.1, 49.2, 67.8, 90, 112.2, 130.8, 147.9, 164.2, 180, 195.8, 212.1, 229.2, 247.8, 270, 292.2, 310.8, 327.9, 344.2];
/** Цвета мест: жёлтый, красный, зелёный, синий. */
export const COLORS = ['yellow', 'red', 'green', 'blue'] as const;
/** Где автобус стоит в начале (остановка «А»). */
export const STOP = [15, 0, 5, 10];
/** Две клетки у парка своего цвета. */
export const PARK = [
  [11, 12],
  [17, 18],
  [1, 2],
  [7, 8],
];
/** Клетки со синими стрелками — выход из города. */
export const ARROWS = [15, 5];

export const fwd = (c: number, n = 1) => (((c - n) % CELLS) + CELLS) % CELLS;

export interface Cfg {
  /** Пешеходов у каждого. */
  peds: number;
  /** Садятся сами, без кнопки. */
  autoBoard: boolean;
  /** Полный автобус въезжает в любой парк (в правилах — «в одном из углов») или только в парк своего цвета. */
  anyPark: boolean;
}

export function cfgFrom(o: Options): Cfg {
  return { peds: Number(o.peds) === 2 ? 2 : 3, autoBoard: o.board === 'auto', anyPark: o.park !== 'own' };
}

/** Пешеход: −1 — в городе, 0…19 — клетка внутренней дорожки, −2 — в автобусе. */
export const CITY = -1;
export const RIDING = -2;

export interface State {
  cfg: Cfg;
  players: number;
  /** Клетка автобуса цвета i (−1 — в парке). Автобусы есть всегда все четыре. */
  bus: number[];
  load: number[];
  /** В каком парке стоит автобус (−1 — ещё на дорожке). */
  parkedIn: number[];
  peds: number[][];
  turn: number;
  phase: 'roll' | 'walk' | 'drive' | 'board';
  die: number;
  /** Кто сейчас может посадить своих (после хода автобусов). */
  pending: number[];
  ply: number;
  over: boolean;
  winner: number | null;
  /** Последний ход пешехода — для подсветки. */
  last: number[];
}

export type Action =
  | { type: 'roll' }
  | { type: 'walk'; ped: number; to: number }
  | { type: 'board'; ped: number }
  | { type: 'drive' }
  | { type: 'pass' };

export type Event =
  | { type: 'roll'; seat: number; die: number; stuck: boolean }
  | { type: 'walk'; seat: number; ped: number; from: number; to: number }
  | { type: 'board'; seat: number; ped: number; cell: number }
  | { type: 'drive'; seat: number; from: number[]; to: number[]; parked: number[] }
  | { type: 'end'; winner: number | null; long?: boolean };

export const PLY_LIMIT = 600;

/** В какой парк может въехать автобус seat с клетки b (−1 — ни в какой). */
export function parkAt(s: State, seat: number, b: number): number {
  if (!s.cfg.anyPark) return PARK[seat].includes(b) ? seat : -1;
  return PARK.findIndex((cells) => cells.includes(b));
}

/** first — кто ходит первым (по жребию: от очерёдности зависит, где окажется свой автобус). */
export function newState(cfg: Cfg, players: number, first = 0): State {
  const n = Math.max(2, Math.min(4, players));
  return {
    cfg,
    players: n,
    bus: STOP.slice(),
    load: [0, 0, 0, 0],
    parkedIn: [-1, -1, -1, -1],
    peds: Array.from({ length: n }, () => Array(cfg.peds).fill(CITY)),
    turn: first % Math.max(2, Math.min(4, players)),
    phase: 'roll',
    die: 0,
    pending: [],
    ply: 0,
    over: false,
    winner: null,
    last: [],
  };
}

export function toAct(s: State): number[] {
  if (s.over) return [];
  return s.phase === 'board' ? s.pending.slice() : [s.turn];
}

/** Пешеходы места seat, стоящие под своим автобусом. */
export function boardable(s: State, seat: number): number[] {
  const b = s.bus[seat];
  if (b < 0 || s.load[seat] >= s.cfg.peds) return [];
  return s.peds[seat].flatMap((c, i) => (c === b ? [i] : []));
}

function walks(s: State, seat: number): Action[] {
  const out: Action[] = [];
  const seen = new Set<string>();
  s.peds[seat].forEach((c, i) => {
    const tos = c === CITY ? ARROWS.map((a) => fwd(a, s.die - 1)) : c >= 0 ? [fwd(c, s.die)] : [];
    for (const to of tos) {
      // одинаковые ходы (два пешехода в городе или на одной клетке) — один
      const k = `${c}:${to}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ type: 'walk', ped: i, to });
    }
  });
  return out;
}

export function legal(s: State, seat: number): Action[] {
  if (s.over) return [];
  if (s.phase === 'board') {
    if (!s.pending.includes(seat)) return [];
    return [...boardable(s, seat).slice(0, 1).map((ped) => ({ type: 'board', ped }) as Action), { type: 'pass' }];
  }
  if (seat !== s.turn) return [];
  if (s.phase === 'roll') return [{ type: 'roll' }];
  if (s.phase === 'walk') return walks(s, seat);
  return [...boardable(s, seat).slice(0, 1).map((ped) => ({ type: 'board', ped }) as Action), { type: 'drive' }];
}

function board(s: State, seat: number, ped: number, events: Event[]) {
  const cell = s.peds[seat][ped];
  s.peds[seat] = s.peds[seat].slice();
  s.peds[seat][ped] = RIDING;
  s.load = s.load.slice();
  s.load[seat]++;
  events.push({ type: 'board', seat, ped, cell });
}

function autoBoard(s: State, seats: number[], events: Event[]) {
  for (const seat of seats) for (const ped of boardable(s, seat)) board(s, seat, ped, events);
}

function nextTurn(s: State) {
  s.turn = (s.turn + 1) % s.players;
  s.phase = 'roll';
  s.die = 0;
  s.pending = [];
}

/** После движения автобусов: кто может посадить своих — тот решает (или садятся сами). */
function afterDrive(s: State, events: Event[]) {
  const can = Array.from({ length: s.players }, (_, i) => i).filter((i) => boardable(s, i).length);
  if (s.cfg.autoBoard || !can.length) {
    autoBoard(s, can, events);
    nextTurn(s);
  } else {
    s.phase = 'board';
    s.pending = can;
  }
}

/** Допустим ли ход: тот же вид, что в legal, пешеход — на свою цель, посадка — любого стоящего под автобусом. */
function valid(s: State, seat: number, a: Action): boolean {
  if (!a) return false;
  const ms = legal(s, seat);
  if (!ms.some((m) => m.type === a.type)) return false;
  if (a.type === 'walk') {
    const c = s.peds[seat][a.ped];
    if (c === undefined) return false;
    const tos = c === CITY ? ARROWS.map((x) => fwd(x, s.die - 1)) : c >= 0 ? [fwd(c, s.die)] : [];
    return tos.includes(a.to);
  }
  if (a.type === 'board') return boardable(s, seat).includes(a.ped);
  return true;
}

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (!valid(s0, seat, a)) return null;
  const s: State = { ...s0, peds: s0.peds.slice(), last: s0.last };
  const events: Event[] = [];
  s.ply++;
  switch (a.type) {
    case 'roll': {
      s.die = 1 + rng.int(6);
      const stuck = !walks(s, seat).length;
      events.push({ type: 'roll', seat, die: s.die, stuck });
      s.phase = stuck ? 'drive' : 'walk';
      break;
    }
    case 'walk': {
      const from = s.peds[seat][a.ped];
      s.peds[seat] = s.peds[seat].slice();
      s.peds[seat][a.ped] = a.to;
      s.last = [a.to];
      events.push({ type: 'walk', seat, ped: a.ped, from, to: a.to });
      s.phase = 'drive';
      if (s.cfg.autoBoard) autoBoard(s, [seat], events);
      break;
    }
    case 'board': {
      board(s, seat, a.ped, events);
      if (s.phase === 'board' && !boardable(s, seat).length) s.pending = s.pending.filter((x) => x !== seat);
      if (s.phase === 'board' && !s.pending.length) nextTurn(s);
      break;
    }
    case 'pass': {
      s.pending = s.pending.filter((x) => x !== seat);
      if (!s.pending.length) nextTurn(s);
      break;
    }
    case 'drive': {
      const from = s.bus.slice();
      const parked: number[] = [];
      s.parkedIn = s.parkedIn.slice();
      s.bus = s.bus.map((b, i) => {
        if (b < 0) return b;
        if (i < s.players && s.load[i] >= s.cfg.peds && parkAt(s, i, b) >= 0) {
          parked.push(i);
          s.parkedIn[i] = parkAt(s, i, b);
          return -1;
        }
        return fwd(b);
      });
      events.push({ type: 'drive', seat, from, to: s.bus.slice(), parked });
      if (parked.length) {
        // первый в парке — победитель (одновременно — тот, кто ближе по очереди от ходившего)
        const order = Array.from({ length: s.players }, (_, k) => (seat + k) % s.players);
        const w = order.find((i) => parked.includes(i))!;
        s.over = true;
        s.winner = w;
        events.push({ type: 'end', winner: w });
        return { state: s, events };
      }
      afterDrive(s, events);
      break;
    }
  }
  if (!s.over && s.ply >= PLY_LIMIT) {
    s.over = true;
    let best = -1;
    let w: number | null = null;
    for (let i = 0; i < s.players; i++) {
      if (s.load[i] > best) {
        best = s.load[i];
        w = i;
      } else if (s.load[i] === best) w = null;
    }
    s.winner = w;
    events.push({ type: 'end', winner: w, long: true });
  }
  return { state: s, events };
}
