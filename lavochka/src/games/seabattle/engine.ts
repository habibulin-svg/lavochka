/* Морской бой — правила (без DOM). Поле 10×10: строки 1…10 сверху вниз, столбцы А…К (без Й), клетка = строка * 10 + столбец.
 *
 * Сначала оба расставляют флот (одновременно, втайне): корабли — прямые полоски, друг друга не касаются даже углами
 * (если не включено «можно касаться»). Потом стреляют по очереди; попал — стреляешь ещё (если так договорились).
 * Потопленный корабль «обводят»: клетки вокруг него заведомо пустые. Кто первым потопил весь флот соперника — победил.
 * «Сальво»: за ход столько выстрелов, сколько у тебя осталось кораблей.
 */
import type { Options, Rng } from '../../core/types';

export const N = 10;
export const LETTERS = 'АБВГДЕЖЗИК';
export const cellName = (c: number) => `${LETTERS[c % N]}${Math.floor(c / N) + 1}`;

export type Fleet = 'ussr' | 'west';

export interface Cfg {
  fleet: Fleet;
  /** Корабли могут касаться углами и бортами. */
  touch: boolean;
  /** Попал — стреляешь ещё раз. */
  again: boolean;
  /** Сальво: за ход — столько выстрелов, сколько своих кораблей на плаву. */
  salvo: boolean;
}

export function cfgFrom(o: Options): Cfg {
  return { fleet: o.fleet === 'west' ? 'west' : 'ussr', touch: !!o.touch, again: o.again !== false, salvo: !!o.salvo };
}

export const SIZES: Record<Fleet, number[]> = {
  ussr: [4, 3, 3, 2, 2, 2, 1, 1, 1, 1],
  west: [5, 4, 3, 3, 2],
};

export const NAMES: Record<number, string> = { 1: 'одно', 2: 'двух', 3: 'трёх', 4: 'четырёх', 5: 'пяти' };

/** Клетка выстрела: 0 — не стреляли, 1 — мимо, 2 — попал, 3 — заведомо пусто (вокруг потопленного). */
export type Shot = 0 | 1 | 2 | 3;

export interface State {
  cfg: Cfg;
  phase: 'place' | 'battle' | 'over';
  /** Корабли каждого: список клеток. */
  ships: [number[][], number[][]];
  ready: [boolean, boolean];
  /** shots[s] — куда стрелял игрок s (по полю соперника). */
  shots: [Shot[], Shot[]];
  /** Потопленные корабли соперника, которые видит стрелявший: sunk[s] — потопил игрок s. */
  sunk: [number[][], number[][]];
  turn: 0 | 1;
  /** Выстрелы в этом ходу (сальво) — сколько ещё можно. */
  winner: number | null;
  /** Номер хода — для журнала. */
  moves: number;
}

export type Action = { type: 'place'; ships: number[][] } | { type: 'shoot'; cells: number[] } | { type: 'resign' };

export type ShotRes = { cell: number; hit: boolean; sunk?: number[] };

export type Event =
  | { type: 'placed'; seat: number }
  | { type: 'start'; first: number }
  | { type: 'shots'; seat: number; res: ShotRes[]; again: boolean }
  | { type: 'end'; winner: number; ships?: [number[][], number[][]]; resign?: boolean };

// ---------------------------------------------------------------- флот

const rc = (c: number) => [Math.floor(c / N), c % N];

/** Соседи клетки (8 сторон). */
export function around(c: number): number[] {
  const [r, f] = rc(c);
  const out: number[] = [];
  for (let dr = -1; dr <= 1; dr++)
    for (let df = -1; df <= 1; df++) {
      if (!dr && !df) continue;
      const R = r + dr;
      const C = f + df;
      if (R >= 0 && R < N && C >= 0 && C < N) out.push(R * N + C);
    }
  return out;
}

/** Корабль длины len с носа c (по горизонтали или вертикали); null — не влезает. */
export function shipAt(c: number, len: number, vertical: boolean): number[] | null {
  const [r, f] = rc(c);
  if (vertical ? r + len > N : f + len > N) return null;
  return Array.from({ length: len }, (_, i) => (vertical ? (r + i) * N + f : r * N + f + i));
}

/** Можно ли поставить корабль к уже стоящим. */
export function fits(ship: number[], placed: number[][], touch: boolean): boolean {
  const busy = new Set<number>();
  for (const s of placed)
    for (const c of s) {
      busy.add(c);
      if (!touch) for (const a of around(c)) busy.add(a);
    }
  return ship.every((c) => !busy.has(c));
}

function straight(ship: number[]): boolean {
  if (!ship.length) return false;
  const cells = ship.slice().sort((a, b) => a - b);
  if (new Set(cells).size !== cells.length || cells.some((c) => c < 0 || c >= N * N || !Number.isInteger(c))) return false;
  const row = cells.every((c) => Math.floor(c / N) === Math.floor(cells[0] / N)) && cells.every((c, i) => c === cells[0] + i);
  const col = cells.every((c) => c % N === cells[0] % N) && cells.every((c, i) => c === cells[0] + i * N);
  return row || col;
}

/** Проверка расстановки: размеры по правилам, прямые, не перекрываются и (если надо) не касаются. */
export function validFleet(ships: number[][], cfg: Cfg): boolean {
  if (!Array.isArray(ships)) return false;
  const need = SIZES[cfg.fleet].slice().sort();
  const got = ships.map((s) => (Array.isArray(s) ? s.length : -1)).sort();
  if (need.join() !== got.join()) return false;
  const placed: number[][] = [];
  for (const s of ships) {
    if (!straight(s) || !fits(s, placed, cfg.touch)) return false;
    placed.push(s);
  }
  return true;
}

/** Случайная расстановка (с повтором, если зашли в тупик). */
export function randomFleet(cfg: Cfg, rng: Rng): number[][] {
  for (let attempt = 0; attempt < 200; attempt++) {
    const placed: number[][] = [];
    let ok = true;
    for (const len of SIZES[cfg.fleet]) {
      let done = false;
      for (let k = 0; k < 300 && !done; k++) {
        const ship = shipAt(rng.int(N * N), len, rng.next() < 0.5);
        if (ship && fits(ship, placed, cfg.touch)) {
          placed.push(ship);
          done = true;
        }
      }
      if (!done) {
        ok = false;
        break;
      }
    }
    if (ok) return placed;
  }
  throw new Error('не удалось расставить флот');
}

// ---------------------------------------------------------------- партия

export function newState(cfg: Cfg): State {
  return {
    cfg,
    phase: 'place',
    ships: [[], []],
    ready: [false, false],
    shots: [Array(N * N).fill(0), Array(N * N).fill(0)],
    sunk: [[], []],
    turn: 0,
    winner: null,
    moves: 0,
  };
}

export const setup = (opts: Options): State => newState(cfgFrom(opts));

export function toAct(s: State): number[] {
  if (s.phase === 'over') return [];
  if (s.phase === 'place') return [0, 1].filter((x) => !s.ready[x]);
  return [s.turn];
}

/** Сколько выстрелов за ход. */
export function shotsPerTurn(s: Pick<State, 'cfg' | 'sunk' | 'ships'>, seat: number, alive?: number): number {
  if (!s.cfg.salvo) return 1;
  // свои корабли на плаву: всего минус потопленные соперником
  const total = SIZES[s.cfg.fleet].length;
  return Math.max(1, alive ?? total - s.sunk[1 - seat].length);
}

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (!toAct(s0).includes(seat) || !a || typeof a !== 'object') return null;
  const ev: Event[] = [];
  if (a.type === 'resign') {
    if (s0.phase !== 'battle') return null;
    const s = { ...s0, phase: 'over' as const, winner: 1 - seat };
    ev.push({ type: 'end', winner: 1 - seat, ships: s.ships, resign: true });
    return { state: s, events: ev };
  }
  if (a.type === 'place') {
    if (s0.phase !== 'place' || !validFleet(a.ships, s0.cfg)) return null;
    const ships = [s0.ships[0], s0.ships[1]] as [number[][], number[][]];
    ships[seat] = a.ships.map((x) => x.slice().sort((p, q) => p - q));
    const ready = [...s0.ready] as [boolean, boolean];
    ready[seat] = true;
    const s: State = { ...s0, ships, ready };
    ev.push({ type: 'placed', seat });
    if (ready[0] && ready[1]) {
      s.phase = 'battle';
      s.turn = rng.int(2) as 0 | 1;
      ev.push({ type: 'start', first: s.turn });
    }
    return { state: s, events: ev };
  }
  if (a.type !== 'shoot' || s0.phase !== 'battle' || !Array.isArray(a.cells)) return null;
  const want = shotsPerTurn(s0, seat);
  const mine = s0.shots[seat];
  const cells = [...new Set(a.cells)];
  // в сальво можно меньше, если клеток не осталось
  const free = mine.filter((x) => x === 0).length;
  if (cells.length !== Math.min(want, free) || cells.some((c) => !Number.isInteger(c) || c < 0 || c >= N * N || mine[c] !== 0)) return null;
  const shots = [s0.shots[0].slice(), s0.shots[1].slice()] as [Shot[], Shot[]];
  const sunk = [s0.sunk[0].slice(), s0.sunk[1].slice()] as [number[][], number[][]];
  const enemy = s0.ships[1 - seat];
  const res: ShotRes[] = [];
  let anyHit = false;
  for (const c of cells) {
    const ship = enemy.find((sh) => sh.includes(c));
    if (!ship) {
      shots[seat][c] = 1;
      res.push({ cell: c, hit: false });
      continue;
    }
    shots[seat][c] = 2;
    anyHit = true;
    const r: ShotRes = { cell: c, hit: true };
    if (ship.every((x) => shots[seat][x] === 2)) {
      r.sunk = ship.slice();
      sunk[seat].push(ship.slice());
      // обводим потопленный
      for (const x of ship) for (const n of around(x)) if (shots[seat][n] === 0) shots[seat][n] = 3;
    }
    res.push(r);
  }
  const won = enemy.every((sh) => sh.every((x) => shots[seat][x] === 2));
  const again = !won && anyHit && s0.cfg.again && !s0.cfg.salvo;
  const s: State = { ...s0, shots, sunk, moves: s0.moves + 1, turn: again ? s0.turn : ((1 - seat) as 0 | 1) };
  ev.push({ type: 'shots', seat, res, again });
  if (won) {
    s.phase = 'over';
    s.winner = seat;
    ev.push({ type: 'end', winner: seat, ships: s.ships });
  }
  return { state: s, events: ev };
}

/** Что видит игрок: свой флот целиком, у соперника — только потопленные (в конце — всё). */
export function makeView(s: State, seats: number[] | 'all'): State {
  if (seats === 'all' || s.phase === 'over') return s;
  const see = (x: number) => seats.includes(x);
  const ships = [0, 1].map((x) => (see(x) ? s.ships[x] : s.sunk[1 - x])) as [number[][], number[][]];
  return { ...s, ships };
}
