/* Фанорона (Мадагаскар) — правила без DOM.
 * Доска «алькерк» — точки и линии: соседние соединены по горизонтали и вертикали, а из точек, где сумма координат чётная,
 * идут и диагонали. Полная доска 9×5 (по 22 фишки), Фанорон-дими 5×5 (по 12), Фанорон-тэлу 3×3 (по 3, без взятий).
 * Белые (место 0) — снизу, ходят первыми. Средний ряд чередуется, центр пуст.
 * Ход — на соседнюю пустую точку по линии. Взятие подходом: за точкой прихода в том же направлении стоит чужая фишка —
 * снимается она и все чужие подряд за ней по линии. Взятие отходом: чужая фишка стоит сзади, у точки ухода, — снимается
 * линия позади. Если можно и так и так — игрок выбирает. Есть взятие — брать обязательно (любое).
 * После взятия та же фишка может брать дальше (цепочка), но не в точку, где уже побывала в этом ходе, и не в том же
 * направлении, что прошлый шаг; цепочку можно остановить. По желанию — первый ход партии только одним взятием (домашнее).
 * Выигрыш — снять все фишки соперника (или запереть). Вела: проигравший прошлую партию берёт по одной фишке за ход,
 * а победитель только ходит без взятий, пока у него не останется 5 фишек.
 * Фанорон-тэлу: каждый ставит по 3 фишки, потом ходит на соседнюю точку; три в ряд по линии — победа. */
import type { Options } from '../../core/types';

export const WHITE = 1;
export const BLACK = 2;
export type Size = 'full' | 'dimy' | 'telo';
export type Look = 'wood' | 'stone';

export interface Cfg {
  size: Size;
  /** Первый ход партии — только одно взятие. */
  opening: boolean;
  /** Вела: место, которое отдаёт фишки (−1 — без велы). */
  vela: number;
  look: Look;
}

export function cfgFrom(o: Options): Cfg {
  const size: Size = o.size === 'dimy' || o.size === 'telo' ? o.size : 'full';
  const vela = Number(o.vela);
  return { size, opening: o.opening === true, vela: size === 'full' && (vela === 0 || vela === 1) ? vela : -1, look: o.look === 'stone' ? 'stone' : 'wood' };
}

export interface Geo {
  w: number;
  h: number;
  n: number;
  /** nb[p][d] — сосед по направлению d или −1 (с учётом диагоналей). */
  nb: number[][];
  /** Линии «три в ряд» (для тэлу). */
  rows: number[][];
}

/** Направления: 0..7, противоположное — (d + 4) % 8. */
export const DIRS: [number, number][] = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];
export const back = (d: number) => (d + 4) % 8;

const geoCache = new Map<Size, Geo>();
export function geo(size: Size): Geo {
  const g = geoCache.get(size);
  if (g) return g;
  const w = size === 'full' ? 9 : size === 'dimy' ? 5 : 3;
  const h = size === 'full' ? 5 : w;
  const nb: number[][] = [];
  for (let p = 0; p < w * h; p++) {
    const x = p % w;
    const y = (p - x) / w;
    nb.push(
      DIRS.map(([dx, dy], d) => {
        if (d % 2 && (x + y) % 2) return -1;
        const x1 = x + dx;
        const y1 = y + dy;
        return x1 < 0 || y1 < 0 || x1 >= w || y1 >= h ? -1 : y1 * w + x1;
      })
    );
  }
  const rows: number[][] = [];
  if (size === 'telo') rows.push([0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]);
  const out = { w, h, n: w * h, nb, rows };
  geoCache.set(size, out);
  return out;
}

export interface Chain {
  /** Где стоит берущая фишка. */
  at: number;
  /** Точки, где она уже побывала в этом ходе. */
  seen: number[];
  /** Направление прошлого шага. */
  dir: number;
}

export interface Pend {
  from: number;
  to: number;
  dir: number;
  /** Снимутся подходом / отходом. */
  a: number[];
  w: number[];
}

export interface State {
  cfg: Cfg;
  board: number[];
  turn: number;
  /** Фишки вне доски (расстановка в тэлу). */
  hand: [number, number];
  ply: number;
  /** Ходов подряд без взятий. */
  quiet: number;
  chain: Chain | null;
  pend: Pend | null;
  /** В этом ходе уже было взятие. */
  took: boolean;
  /** Вела ещё идёт. */
  vela: boolean;
  over: boolean;
  winner: number | null;
  last: number[];
}

export type Action = { type: 'place'; to: number } | { type: 'move'; from: number; to: number } | { type: 'pick'; at: number } | { type: 'stop' };
export type Event =
  | { type: 'place'; seat: number; to: number }
  | { type: 'move'; seat: number; from: number; to: number; taken: number[]; how: 'a' | 'w' | null; chain: boolean }
  | { type: 'pick'; seat: number; taken: number[]; how: 'a' | 'w' }
  | { type: 'stop'; seat: number }
  | { type: 'vela'; seat: number }
  | { type: 'end'; winner: number | null; why: 'all' | 'stuck' | 'row' | 'long' };

/** Ходов подряд без взятий до ничьей (в тэлу — всего ходов). */
export const QUIET = 50;
const TELO_LIMIT = 120;
/** До скольких фишек отдаёт вела. */
export const VELA_LEFT = 5;

export const own = (seat: number) => (seat === 0 ? WHITE : BLACK);
export const count = (s: State, seat: number) => s.board.reduce((n, v) => n + (v === own(seat) ? 1 : 0), 0);

export function newState(cfg: Cfg): State {
  const g = geo(cfg.size);
  const board = Array(g.n).fill(0);
  if (cfg.size !== 'telo') {
    const mid = (g.h - 1) / 2;
    for (let p = 0; p < g.n; p++) {
      const x = p % g.w;
      const y = (p - x) / g.w;
      if (y < mid) board[p] = BLACK;
      else if (y > mid) board[p] = WHITE;
      else if (x !== (g.w - 1) / 2) {
        // средний ряд: слева чёрная, белая, …; справа зеркально — центр пуст
        const left = x < (g.w - 1) / 2;
        board[p] = (x % 2 === 0) === left ? BLACK : WHITE;
      }
    }
  }
  const hand: [number, number] = cfg.size === 'telo' ? [3, 3] : [0, 0];
  return { cfg, board, turn: 0, hand, ply: 0, quiet: 0, chain: null, pend: null, took: false, vela: cfg.vela >= 0, over: false, winner: null, last: [] };
}

export const setup = (_seats: number[], o: Options) => newState(cfgFrom(o));
export const toAct = (s: State) => (s.over ? [] : [s.turn]);

/** Чужие фишки подряд от точки q по направлению d. */
function line(s: State, q: number, d: number, enemy: number): number[] {
  const g = geo(s.cfg.size);
  const out: number[] = [];
  while (q >= 0 && s.board[q] === enemy) {
    out.push(q);
    q = g.nb[q][d];
  }
  return out;
}

/** Что снимет ход from→to по направлению d: подходом и отходом. */
export function captures(s: State, from: number, d: number, seat: number): { a: number[]; w: number[] } {
  const g = geo(s.cfg.size);
  const enemy = own(1 - seat);
  const to = g.nb[from][d];
  const ahead = g.nb[to][d];
  const behind = g.nb[from][back(d)];
  return { a: ahead >= 0 ? line(s, ahead, d, enemy) : [], w: behind >= 0 ? line(s, behind, back(d), enemy) : [] };
}

/** Взятия фишкой из точки p (с учётом цепочки: запретные точки и направление). */
function takesFrom(s: State, p: number, seat: number, chain: Chain | null): Action[] {
  const g = geo(s.cfg.size);
  const out: Action[] = [];
  for (let d = 0; d < 8; d++) {
    const to = g.nb[p][d];
    if (to < 0 || s.board[to]) continue;
    if (chain && (d === chain.dir || chain.seen.includes(to))) continue;
    const c = captures(s, p, d, seat);
    if (c.a.length || c.w.length) out.push({ type: 'move', from: p, to });
  }
  return out;
}

/** Все ходы без взятий (пайка). */
function quietMoves(s: State, seat: number): Action[] {
  const g = geo(s.cfg.size);
  const out: Action[] = [];
  for (let p = 0; p < g.n; p++) {
    if (s.board[p] !== own(seat)) continue;
    for (const to of g.nb[p]) if (to >= 0 && !s.board[to]) out.push({ type: 'move', from: p, to });
  }
  return out;
}

/** Направление хода from→to (или −1). */
export function dirOf(s: State, from: number, to: number): number {
  return geo(s.cfg.size).nb[from].indexOf(to);
}

export function legal(s: State): Action[] {
  if (s.over) return [];
  const seat = s.turn;
  if (s.pend) {
    return [
      { type: 'pick', at: s.pend.a[0] },
      { type: 'pick', at: s.pend.w[0] },
    ];
  }
  if (s.cfg.size === 'telo') {
    if (s.hand[seat] > 0) return s.board.flatMap((v, p) => (v ? [] : [{ type: 'place', to: p } as Action]));
    return quietMoves(s, seat);
  }
  if (s.chain) return [...takesFrom(s, s.chain.at, seat, s.chain), { type: 'stop' }];
  // вела: отдающий только ходит без взятий
  if (s.vela && seat === s.cfg.vela) return quietMoves(s, seat);
  const g = geo(s.cfg.size);
  const takes: Action[] = [];
  for (let p = 0; p < g.n; p++) if (s.board[p] === own(seat)) takes.push(...takesFrom(s, p, seat, null));
  return takes.length ? takes : quietMoves(s, seat);
}

function win3(s: State, seat: number): boolean {
  return geo(s.cfg.size).rows.some((r) => r.every((p) => s.board[p] === own(seat)));
}

/** Конец хода: передать очередь и проверить конец партии. */
function endTurn(s: State, seat: number, events: Event[]) {
  s.chain = null;
  s.pend = null;
  s.quiet = s.took ? 0 : s.quiet + 1;
  s.took = false;
  s.ply++;
  s.turn = 1 - seat;
  if (s.vela && count(s, s.cfg.vela) <= VELA_LEFT) {
    s.vela = false;
    events.push({ type: 'vela', seat: s.cfg.vela });
  }
  let why: 'all' | 'stuck' | 'row' | 'long' | null = null;
  if (s.cfg.size === 'telo') {
    if (win3(s, seat)) {
      s.winner = seat;
      why = 'row';
    } else if (!legal(s).length) {
      s.winner = seat;
      why = 'stuck';
    } else if (s.ply >= TELO_LIMIT) why = 'long';
  } else if (!count(s, s.turn)) {
    s.winner = seat;
    why = 'all';
  } else if (!legal(s).length) {
    s.winner = seat;
    why = 'stuck';
  } else if (s.quiet >= QUIET) why = 'long';
  if (why) {
    s.over = true;
    events.push({ type: 'end', winner: s.winner, why });
  }
}

/** После взятия: продолжить цепочку или закончить ход. */
function afterTake(s: State, seat: number, from: number, to: number, dir: number, events: Event[]) {
  s.took = true;
  const seen = s.chain ? s.chain.seen : [from];
  const chain: Chain = { at: to, seen: [...seen, to], dir };
  const first = s.cfg.opening && s.ply === 0;
  // в веле берущий берёт по одной фишке за ход — без цепочки
  const velaTaker = s.vela && seat !== s.cfg.vela;
  if (!first && !velaTaker && count(s, 1 - seat) && takesFrom(s, to, seat, chain).length) {
    s.chain = chain;
    return;
  }
  endTurn(s, seat, events);
}

function remove(s: State, ps: number[]) {
  for (const p of ps) s.board[p] = 0;
}

/** Применить ход без проверки (для ботов и apply). */
export function step(s0: State, a: Action): { state: State; events: Event[] } {
  const s: State = { ...s0, board: s0.board.slice(), hand: [s0.hand[0], s0.hand[1]], last: s0.chain || s0.pend ? s0.last : [] };
  const seat = s0.turn;
  const events: Event[] = [];
  if (a.type === 'place') {
    s.board[a.to] = own(seat);
    s.hand[seat]--;
    s.last = [a.to];
    events.push({ type: 'place', seat, to: a.to });
    endTurn(s, seat, events);
  } else if (a.type === 'stop') {
    events.push({ type: 'stop', seat });
    endTurn(s, seat, events);
  } else if (a.type === 'pick') {
    const p = s.pend!;
    const how = p.a.includes(a.at) ? 'a' : 'w';
    const taken = how === 'a' ? p.a : p.w;
    // в веле берущий снимает только одну фишку
    const real = s.vela && seat !== s.cfg.vela ? taken.slice(0, 1) : taken;
    remove(s, real);
    s.pend = null;
    events.push({ type: 'pick', seat, taken: real, how });
    afterTake(s, seat, p.from, p.to, p.dir, events);
  } else {
    const d = dirOf(s, a.from, a.to);
    // в тэло взятий нет; отдающий в веле ходит без взятий
    const c = s.cfg.size === 'telo' || (s.vela && seat === s.cfg.vela) ? { a: [], w: [] } : captures(s, a.from, d, seat);
    const chain = !!s.chain;
    s.board[a.to] = s.board[a.from];
    s.board[a.from] = 0;
    s.last = s.chain ? [...s.last, a.to] : [a.from, a.to];
    if (c.a.length && c.w.length) {
      s.pend = { from: a.from, to: a.to, dir: d, a: c.a, w: c.w };
      events.push({ type: 'move', seat, from: a.from, to: a.to, taken: [], how: null, chain });
    } else if (c.a.length || c.w.length) {
      const how = c.a.length ? 'a' : 'w';
      const all = how === 'a' ? c.a : c.w;
      const taken = s.vela && seat !== s.cfg.vela ? all.slice(0, 1) : all;
      remove(s, taken);
      events.push({ type: 'move', seat, from: a.from, to: a.to, taken, how, chain });
      afterTake(s, seat, a.from, a.to, d, events);
    } else {
      events.push({ type: 'move', seat, from: a.from, to: a.to, taken: [], how: null, chain });
      endTurn(s, seat, events);
    }
  }
  return { state: s, events };
}

const same = (a: Action, b: Action) =>
  a.type === b.type &&
  (a.type === 'stop' ||
    (a.type === 'place' && b.type === 'place' && a.to === b.to) ||
    (a.type === 'pick' && b.type === 'pick' && a.at === b.at) ||
    (a.type === 'move' && b.type === 'move' && a.from === b.from && a.to === b.to));

export function apply(s: State, seat: number, a: Action): { state: State; events: Event[] } | null {
  if (s.over || seat !== s.turn || !a) return null;
  return legal(s).some((m) => same(m, a)) ? step(s, a) : null;
}
