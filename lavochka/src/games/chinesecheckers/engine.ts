/* Китайские шашки — правила, без DOM. Пресеты: «Ромашка» (советская доска-цветок), звезда, халма 16×16.
 *
 * Звезда — 121 лунка в осевых координатах шестиугольной сетки (q, r, s = −q − r): объединение двух больших треугольников
 * (q, r, s ≤ 4) и (q, r, s ≥ −4). Шесть лучей по 10 лунок — «дома». Каждый начинает в своём доме и ведёт фишки в дом напротив.
 * Халма — квадратная доска 16×16, лагеря в углах (вдвоём — по 19 фишек, вчетвером — по 13), ходы во все 8 сторон.
 * Ход — шаг на соседнюю свободную лунку или цепочка прыжков через соседнюю фишку (любую) на свободную за ней.
 * Победа — все лунки целевого дома заняты, и среди них есть хоть одна своя (так соперник не может «засесть» в чужом доме). */
import type { Options } from '../../core/types';

export type Mode = 'romashka' | 'star' | 'halma';
export interface Cfg {
  mode: Mode;
  players: number;
}
export function cfgFrom(o: Options, n: number): Cfg {
  const mode: Mode = o.mode === 'star' || o.mode === 'halma' ? o.mode : 'romashka';
  return { mode, players: n };
}

export interface Geo {
  /** Координаты лунок для отрисовки (в единицах шага). */
  x: number[];
  y: number[];
  /** Соседи по направлениям: nb[p][d] — лунка или −1. */
  nb: number[][];
  /** Дома (лучи / лагеря) по номеру угла. */
  homes: number[][];
  /** Угол напротив. */
  opp: number[];
  /** Вершина дома — дальняя лунка (для оценки расстояния). */
  tip: number[];
  /** Расстояние между лунками. */
  dist(a: number, b: number): number;
}

// ---------------------------------------------------------------- звезда

const HEX_DIRS = [
  [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1],
];

function starGeo(): Geo {
  const pts: [number, number][] = [];
  for (let q = -8; q <= 8; q++)
    for (let r = -8; r <= 8; r++) {
      const s = -q - r;
      if (Math.abs(s) > 8) continue;
      const a = q <= 4 && r <= 4 && s <= 4;
      const b = q >= -4 && r >= -4 && s >= -4;
      if (a || b) pts.push([q, r]);
    }
  const idx = new Map(pts.map(([q, r], i) => [`${q},${r}`, i]));
  const nb = pts.map(([q, r]) => HEX_DIRS.map(([dq, dr]) => idx.get(`${q + dq},${r + dr}`) ?? -1));
  // углы по часовой стрелке, начиная с нижнего: 0 — r > 4 (низ), 1 — q < −4… подбираем так, чтобы 0 и 3 были напротив
  const tests: ((q: number, r: number, s: number) => boolean)[] = [
    (_q, r) => r > 4,
    (q) => q < -4,
    (_q, _r, s) => s > 4,
    (_q, r) => r < -4,
    (q) => q > 4,
    (_q, _r, s) => s < -4,
  ];
  const homes = tests.map((t) => pts.map(([q, r], i) => (t(q, r, -q - r) ? i : -1)).filter((i) => i >= 0));
  const tipOf = (h: number[]) => {
    // дальняя от центра лунка дома
    let best = h[0];
    let bd = -1;
    for (const i of h) {
      const [q, r] = pts[i];
      const d = Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));
      if (d > bd) [best, bd] = [i, d];
    }
    return best;
  };
  const x = pts.map(([q, r]) => q + r / 2);
  const y = pts.map(([, r]) => (r * Math.sqrt(3)) / 2);
  return {
    x,
    y,
    nb,
    homes,
    opp: [3, 4, 5, 0, 1, 2],
    tip: homes.map(tipOf),
    dist: (a, b) => {
      const [q1, r1] = pts[a];
      const [q2, r2] = pts[b];
      return (Math.abs(q1 - q2) + Math.abs(r1 - r2) + Math.abs(q1 + r1 - q2 - r2)) / 2;
    },
  };
}

// ---------------------------------------------------------------- халма

const SQ_DIRS = [
  [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
];

function halmaGeo(players: number): Geo {
  const n = 16;
  const at = (f: number, r: number) => (f < 0 || r < 0 || f >= n || r >= n ? -1 : r * n + f);
  const x: number[] = [];
  const y: number[] = [];
  const nb: number[][] = [];
  for (let r = 0; r < n; r++)
    for (let f = 0; f < n; f++) {
      x.push(f);
      y.push(r);
      nb.push(SQ_DIRS.map(([df, dr]) => at(f + df, r + dr)));
    }
  // лагерь в углу (0,0): вдвоём — ряды 5,5,4,3,2 (19 фишек), вчетвером — 4,4,3,2 (13)
  const rows = players <= 2 ? [5, 5, 4, 3, 2] : [4, 4, 3, 2];
  const camp = (fx: (f: number) => number, fy: (r: number) => number) => {
    const out: number[] = [];
    rows.forEach((w, r) => {
      for (let f = 0; f < w; f++) out.push(at(fx(f), fy(r)));
    });
    return out;
  };
  // углы: 0 — левый нижний, 1 — правый нижний, 2 — правый верхний, 3 — левый верхний (напротив: 0↔2, 1↔3)
  const homes = [camp((f) => f, (r) => n - 1 - r), camp((f) => n - 1 - f, (r) => n - 1 - r), camp((f) => n - 1 - f, (r) => r), camp((f) => f, (r) => r)];
  return {
    x,
    y,
    nb,
    homes,
    opp: [2, 3, 0, 1],
    tip: [at(0, n - 1), at(n - 1, n - 1), at(n - 1, 0), at(0, 0)],
    dist: (a, b) => Math.max(Math.abs((a % n) - (b % n)), Math.abs(Math.floor(a / n) - Math.floor(b / n))),
  };
}

const GEOS = new Map<string, Geo>();
export function geoOf(cfg: Cfg): Geo {
  const k = cfg.mode === 'halma' ? `halma${cfg.players <= 2 ? 2 : 4}` : 'star';
  if (!GEOS.has(k)) GEOS.set(k, cfg.mode === 'halma' ? halmaGeo(cfg.players) : starGeo());
  return GEOS.get(k)!;
}

/** Какие места занимать при N игроках. В звезде место = угол (цвет шариков = цвет лепестка «Ромашки»):
 * вдвоём — синие против красных, втроём — через угол, вчетвером — две пары напротив. */
export function seatsFor(n: number): number[] {
  return n === 2 ? [2, 5] : n === 3 ? [1, 3, 5] : n === 4 ? [1, 2, 4, 5] : n === 5 ? [0, 1, 2, 3, 4] : [0, 1, 2, 3, 4, 5];
}
/** Угол места: в звезде — сам номер места, в халме — по порядку (вдвоём — напротив). */
function cornersOf(mode: Mode, seats: number[]): number[] {
  if (mode !== 'halma') return seats;
  return seats.length <= 2 ? [0, 2] : [0, 1, 2, 3];
}

// ---------------------------------------------------------------- партия

export interface State {
  cfg: Cfg;
  /** Места игроков по порядку хода. */
  seats: number[];
  /** Угол каждого места. */
  corner: Record<number, number>;
  /** Лунка → место владельца или −1. */
  board: number[];
  turn: number;
  moves: number;
  last: number[] | null;
  over: boolean;
  winner: number | null;
  /** Финишировавшие по порядку (партия до первого — обычно; для мест — порядок). */
  finished: number[];
}
export type View = State;

export type Action = { type: 'move'; from: number; to: number };
export type Event = { type: 'move'; seat: number; path: number[] } | { type: 'end'; winner: number | null };

export function newState(cfg: Cfg, seats: number[]): State {
  const g = geoOf(cfg);
  const corners = cornersOf(cfg.mode, seats);
  const board = new Array(g.x.length).fill(-1);
  const corner: Record<number, number> = {};
  seats.forEach((seat, i) => {
    corner[seat] = corners[i];
    for (const p of g.homes[corners[i]]) board[p] = seat;
  });
  return { cfg, seats, corner, board, turn: seats[0], moves: 0, last: null, over: false, winner: null, finished: [] };
}

/** Все пути хода фишки с from: шаг или цепочка прыжков (по одному пути на каждую лунку назначения). */
export function paths(board: number[], g: Geo, from: number): Map<number, number[]> {
  const out = new Map<number, number[]>();
  for (const q of g.nb[from]) if (q >= 0 && board[q] < 0) out.set(q, [from, q]);
  // прыжки: обход в ширину, фишка «поднята» с from
  const seen = new Set<number>([from]);
  const queue: number[][] = [[from]];
  while (queue.length) {
    const path = queue.shift()!;
    const p = path[path.length - 1];
    for (let d = 0; d < g.nb[p].length; d++) {
      const over = g.nb[p][d];
      if (over < 0 || over === from || board[over] < 0) continue;
      const land = g.nb[over][d];
      if (land < 0 || seen.has(land) || (board[land] >= 0 && land !== from)) continue;
      if (land === from) continue;
      seen.add(land);
      const np = [...path, land];
      if (!out.has(land)) out.set(land, np);
      queue.push(np);
    }
  }
  return out;
}

export function moves(s: State, seat: number): { from: number; to: number; path: number[] }[] {
  const g = geoOf(s.cfg);
  const out: { from: number; to: number; path: number[] }[] = [];
  const target = new Set(g.homes[g.opp[s.corner[seat]]]);
  for (let p = 0; p < s.board.length; p++) {
    if (s.board[p] !== seat) continue;
    for (const [to, path] of paths(s.board, g, p)) {
      // из целевого дома не уходят обратно наружу
      if (target.has(p) && !target.has(to)) continue;
      out.push({ from: p, to, path });
    }
  }
  return out;
}

export const toAct = (s: State) => (s.over ? [] : [s.turn]);

export function won(s: State, seat: number): boolean {
  const g = geoOf(s.cfg);
  const home = g.homes[g.opp[s.corner[seat]]];
  // своих фишек столько же, сколько лунок в доме; дом заполнен целиком и в нём есть свои
  return home.every((p) => s.board[p] >= 0) && home.some((p) => s.board[p] === seat);
}

/** Предел ходов: партия без победителя (боты могут запереть друг друга). */
export const MAX_MOVES = 1200;

export function apply(s0: State, seat: number, a: Action): { state: State; events: Event[] } | null {
  if (s0.over || seat !== s0.turn || !a || a.type !== 'move') return null;
  const m = moves(s0, seat).find((x) => x.from === a.from && x.to === a.to);
  if (!m) return null;
  const board = s0.board.slice();
  board[m.from] = -1;
  board[m.to] = seat;
  const s: State = { ...s0, board, moves: s0.moves + 1, last: m.path };
  const ev: Event[] = [{ type: 'move', seat, path: m.path }];
  if (won(s, seat)) {
    s.over = true;
    s.winner = seat;
    s.finished = [seat];
    ev.push({ type: 'end', winner: seat });
    return { state: s, events: ev };
  }
  if (s.moves >= MAX_MOVES) {
    // победа того, кто ближе к цели
    const g = geoOf(s.cfg);
    let best = s.seats[0];
    let bv = Infinity;
    for (const x of s.seats) {
      const v = remaining(s, g, x);
      if (v < bv) [best, bv] = [x, v];
    }
    s.over = true;
    s.winner = best;
    ev.push({ type: 'end', winner: best });
    return { state: s, events: ev };
  }
  // следующий, у кого есть ход
  const i = s.seats.indexOf(seat);
  for (let k = 1; k <= s.seats.length; k++) {
    const nx = s.seats[(i + k) % s.seats.length];
    if (moves(s, nx).length) {
      s.turn = nx;
      break;
    }
  }
  return { state: s, events: ev };
}

/** Сколько шагов осталось фишкам стороны до вершины целевого дома (для оценки и предела). */
export function remaining(s: State, g: Geo, seat: number): number {
  const tip = g.tip[g.opp[s.corner[seat]]];
  let sum = 0;
  for (let p = 0; p < s.board.length; p++) if (s.board[p] === seat) sum += g.dist(p, tip);
  return sum;
}
