/* Разведчик и дозор (Ю. Лобачёв, «Малыш», 1984) — правила без DOM.
 *
 * Поле — лес с кружками и тропинками: 10 красных кружков по краю (соединены красной линией), 7 жёлтых в середине
 * (жёлтое кольцо) и 34 белых. Ходят только по линиям на соседний свободный кружок, без прыжков.
 * Дозорные (шесть, с номерами) по очереди ставятся на свободные красные кружки, затем разведчик — на любой жёлтый.
 * Ход обязателен; пропустить можно, только если рядом нет свободного кружка.
 * Дозор выигрывает, окружив разведчика (ему некуда ходить); разведчик — заняв любой красный кружок.
 *
 * Порядок ходов: «по коробке» — за круг ходят все дозорные по номерам, потом разведчик; «по очереди» — дозорный,
 * разведчик, следующий дозорный, разведчик… Игроков 2–7: место 0 — разведчик, остальные делят дозорных по кругу.
 * Предел — 100 ходов разведчика (в правилах его нет): не прорвался и не пойман — ничья. */
import type { Options } from '../../core/types';

/** Кружки: x, y на снимке поля 1500×1000 и цвет (r — красный, y — жёлтый, w — белый). */
export const PTS: [number, number, 'r' | 'y' | 'w'][] = [
  [257, 59, 'r'], [988, 44, 'r'], [700, 80, 'w'], [868, 88, 'w'], [1224, 64, 'r'], [374, 170, 'w'], [741, 193, 'w'], [950, 193, 'w'],
  [1108, 213, 'w'], [1264, 184, 'w'], [221, 222, 'r'], [480, 281, 'w'], [650, 270, 'w'], [851, 267, 'w'], [1041, 315, 'w'], [352, 350, 'w'],
  [575, 353, 'w'], [691, 377, 'y'], [794, 357, 'y'], [924, 363, 'y'], [1190, 359, 'w'], [473, 453, 'w'], [599, 459, 'w'], [1013, 443, 'y'],
  [1113, 454, 'w'], [219, 461, 'r'], [736, 473, 'y'], [845, 530, 'y'], [951, 528, 'y'], [1221, 505, 'w'], [357, 564, 'w'], [636, 574, 'w'],
  [512, 602, 'w'], [771, 599, 'w'], [1050, 609, 'w'], [1294, 609, 'w'], [206, 646, 'r'], [598, 696, 'w'], [882, 661, 'w'], [392, 722, 'w'],
  [732, 728, 'w'], [1130, 712, 'w'], [1003, 771, 'w'], [1221, 793, 'w'], [583, 829, 'w'], [1083, 855, 'w'], [768, 869, 'w'], [345, 909, 'r'],
  [1270, 920, 'r'], [631, 956, 'r'], [986, 957, 'r'],
];

/** Тропинки (и красная, и жёлтая линии) — сверено по полю. */
const EDGES: [number, number][] = [
  [0, 1], [0, 10], [1, 3], [1, 4], [2, 3], [2, 5], [2, 6], [2, 11], [3, 6], [3, 9], [4, 9], [5, 10], [5, 15], [6, 7], [6, 11], [6, 13],
  [7, 8], [7, 14], [8, 9], [8, 14], [8, 20], [9, 29], [9, 35], [10, 25], [11, 16], [11, 21], [12, 13], [12, 16], [12, 18], [13, 14], [13, 19],
  [14, 23], [14, 24], [15, 21], [15, 30], [16, 18], [16, 21], [16, 22], [17, 18], [17, 22], [17, 26], [17, 31], [18, 19], [19, 23], [20, 24],
  [20, 29], [21, 30], [21, 32], [22, 31], [22, 32], [23, 28], [24, 28], [24, 34], [25, 30], [25, 36], [26, 27], [26, 31], [26, 33], [27, 28],
  [27, 38], [28, 34], [29, 34], [29, 35], [29, 41], [30, 36], [30, 39], [31, 33], [31, 37], [31, 40], [31, 42], [32, 37], [32, 39], [33, 38],
  [34, 38], [35, 43], [36, 39], [36, 47], [37, 40], [37, 44], [38, 41], [38, 42], [39, 44], [39, 47], [40, 42], [40, 45], [40, 46], [41, 42],
  [41, 43], [42, 46], [43, 45], [43, 48], [44, 46], [44, 47], [44, 49], [45, 46], [45, 50], [46, 49], [47, 49], [48, 50], [49, 50],
];

export const N = PTS.length;
export const ADJ: number[][] = PTS.map(() => []);
for (const [a, b] of EDGES) {
  ADJ[a].push(b);
  ADJ[b].push(a);
}
export const RED = PTS.flatMap(([, , c], i) => (c === 'r' ? [i] : []));
export const YELLOW = PTS.flatMap(([, , c], i) => (c === 'y' ? [i] : []));
export const isRed = (p: number) => PTS[p][2] === 'r';

export type Order = 'box' | 'alt';

export interface Cfg {
  order: Order;
  /** Сколько дозорных. */
  dozors: number;
}

export function cfgFrom(o: Options): Cfg {
  return { order: o.order === 'alt' ? 'alt' : 'box', dozors: Number(o.dozors) === 5 ? 5 : 6 };
}

/** Разведчик — фишка 0, дозорные — 1…dozors. */
export const SCOUT = 0;

export interface State {
  cfg: Cfg;
  /** Мест за столом (1 — разведчик + игроки дозора). */
  players: number;
  /** Где стоит фишка (−1 — ещё не поставлена). */
  pos: number[];
  phase: 'place' | 'move';
  /** Чья очередь — номер фишки. */
  cur: number;
  /** Номер хода в круге «по очереди»: какой дозорный ходит следующим. */
  nextDozor: number;
  scoutMoves: number;
  over: boolean;
  /** 0 — разведчик, 1 — дозор, null — ничья. */
  winner: 0 | 1 | null;
  why: EndWhy | null;
  last: number[];
}

export type EndWhy = 'escaped' | 'caught' | 'long';
export type Action = { type: 'place'; to: number } | { type: 'move'; from: number; to: number };
export type Event =
  | { type: 'place'; seat: number; piece: number; to: number }
  | { type: 'move'; seat: number; piece: number; from: number; to: number }
  | { type: 'skip'; seat: number; piece: number }
  | { type: 'end'; winner: 0 | 1 | null; why: EndWhy };

export const SCOUT_LIMIT = 100;

/** Место, которое двигает фишку: дозорные делятся между игроками дозора по кругу. */
export function owner(s: { players: number }, piece: number): number {
  if (piece === SCOUT) return 0;
  const m = Math.max(1, s.players - 1);
  return 1 + ((piece - 1) % m);
}

export function newState(cfg: Cfg, players: number): State {
  return {
    cfg,
    players: Math.max(2, Math.min(players, cfg.dozors + 1)),
    pos: Array(cfg.dozors + 1).fill(-1),
    phase: 'place',
    cur: 1,
    nextDozor: 1,
    scoutMoves: 0,
    over: false,
    winner: null,
    why: null,
    last: [],
  };
}

export const toAct = (s: State) => (s.over ? [] : [owner(s, s.cur)]);

export function occupied(s: State): boolean[] {
  const o = Array(N).fill(false);
  for (const p of s.pos) if (p >= 0) o[p] = true;
  return o;
}

export function freeNeighbors(s: State, p: number, occ = occupied(s)): number[] {
  return ADJ[p].filter((q) => !occ[q]);
}

export function legal(s: State): Action[] {
  if (s.over) return [];
  const occ = occupied(s);
  if (s.phase === 'place') {
    const spots = s.cur === SCOUT ? YELLOW : RED;
    return spots.filter((p) => !occ[p]).map((to) => ({ type: 'place', to }));
  }
  const from = s.pos[s.cur];
  return freeNeighbors(s, from, occ).map((to) => ({ type: 'move', from, to }));
}

/** Кто ходит после фишки piece. */
function after(s: State, piece: number): number {
  const n = s.cfg.dozors;
  if (s.cfg.order === 'box') return piece === SCOUT ? 1 : piece === n ? SCOUT : piece + 1;
  return piece === SCOUT ? s.nextDozor : SCOUT;
}

/** Применить ход без проверки. Фишки без хода пропускаются сами; окружённый разведчик — конец партии. */
export function step(s0: State, a: Action): { state: State; events: Event[] } {
  const s: State = { ...s0, pos: s0.pos.slice(), last: [] };
  const events: Event[] = [];
  const piece = s.cur;
  const seat = owner(s, piece);
  const end = (winner: 0 | 1 | null, why: EndWhy) => {
    s.over = true;
    s.winner = winner;
    s.why = why;
    events.push({ type: 'end', winner, why });
    return { state: s, events };
  };
  if (a.type === 'place') {
    s.pos[piece] = a.to;
    s.last = [a.to];
    events.push({ type: 'place', seat, piece, to: a.to });
    if (piece === SCOUT) {
      s.phase = 'move';
      s.nextDozor = 1;
      settle(s, 1, events);
    } else s.cur = piece === s.cfg.dozors ? SCOUT : piece + 1;
    return { state: s, events };
  }
  s.pos[piece] = a.to;
  s.last = [a.from, a.to];
  events.push({ type: 'move', seat, piece, from: a.from, to: a.to });
  if (piece === SCOUT) {
    s.scoutMoves++;
    if (isRed(a.to)) return end(0, 'escaped');
  } else if (s.cfg.order === 'alt') s.nextDozor = piece === s.cfg.dozors ? 1 : piece + 1;
  if (!freeNeighbors(s, s.pos[SCOUT]).length) return end(1, 'caught');
  if (piece === SCOUT && s.scoutMoves >= SCOUT_LIMIT) return end(null, 'long');
  settle(s, after(s, piece), events);
  return { state: s, events };
}

/** Передать ход фишке next, пропуская дозорных без хода (разведчику ход всегда есть — иначе он уже пойман). */
function settle(s: State, next: number, events: Event[]) {
  for (let guard = 0; guard <= s.cfg.dozors + 1; guard++) {
    if (next === SCOUT || freeNeighbors(s, s.pos[next]).length) break;
    events.push({ type: 'skip', seat: owner(s, next), piece: next });
    if (s.cfg.order === 'alt') s.nextDozor = next === s.cfg.dozors ? 1 : next + 1;
    next = after(s, next);
  }
  s.cur = next;
}

export function apply(s: State, seat: number, a: Action): { state: State; events: Event[] } | null {
  if (s.over || seat !== owner(s, s.cur) || !a) return null;
  const ok = legal(s).some((m) => m.type === a.type && m.to === a.to && (m.type === 'place' || (a.type === 'move' && m.from === a.from)));
  return ok ? step(s, a) : null;
}

/** Расстояния по свободным кружкам от набора точек (занятые — стена, кроме самих истоков). */
export function bfs(sources: number[], occ: boolean[]): number[] {
  const d = Array(N).fill(Infinity);
  const q: number[] = [];
  for (const p of sources) {
    d[p] = 0;
    q.push(p);
  }
  for (let i = 0; i < q.length; i++) {
    const p = q[i];
    for (const r of ADJ[p])
      if (d[r] === Infinity && !occ[r]) {
        d[r] = d[p] + 1;
        q.push(r);
      }
  }
  return d;
}
