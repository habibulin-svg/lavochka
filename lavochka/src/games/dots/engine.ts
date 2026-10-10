/* Точки — правила (без DOM). Поле w×h пересечений тетрадной сетки, индекс = y * w + x.
 *
 * Игроки по очереди ставят по точке своего цвета на свободное пересечение. Свои «живые» точки, соседние по вертикали,
 * горизонтали и диагонали, образуют стенку. Если стенка замкнулась вокруг точек соперника — они окружены: становятся
 * пленными (очко окружившему), а вся площадь внутри — его территория, туда больше не ставят.
 * Пустое окружение («домик») не засчитывается, но точка соперника, поставленная внутрь, сразу попадает в окружение.
 * Окружённая стенка тоже перестаёт быть стенкой, а свои пленные внутри нового окружения освобождаются.
 * Партия кончается, когда ставить некуда или все согласились закончить; побеждает тот, кто окружил больше точек.
 */
import type { Options } from '../../core/types';

export type Size = 'small' | 'medium' | 'sport';

export interface Cfg {
  size: Size;
  /** Начать с «креста» в центре (для двоих). */
  cross: boolean;
}

export const SIZES: Record<Size, { w: number; h: number; label: string }> = {
  small: { w: 16, h: 14, label: '16×14' },
  medium: { w: 24, h: 20, label: '24×20' },
  sport: { w: 39, h: 32, label: '39×32' },
};

export function cfgFrom(o: Options): Cfg {
  const sz = String(o.size);
  return { size: sz === 'small' || sz === 'sport' ? sz : 'medium', cross: o.cross !== false };
}

export interface Area {
  owner: number;
  pts: number[];
}

export interface State {
  cfg: Cfg;
  w: number;
  h: number;
  seats: number[];
  /** Чья точка: -1 — пусто. */
  dots: number[];
  /** Кем окружена точка (-1 — живая). */
  takenBy: number[];
  /** Чья территория (-1 — ничья). */
  owner: number[];
  areas: Area[];
  turn: number;
  scores: number[];
  last: number;
  moves: number;
  phase: 'play' | 'end' | 'over';
  /** Кто предложил закончить и кто уже согласился. */
  endBy: number;
  agreed: number[];
  winners: number[];
}

export type Action = { type: 'dot'; p: number } | { type: 'finish' } | { type: 'accept' } | { type: 'decline' };

export type Event =
  | { type: 'dot'; seat: number; p: number; x: number; y: number }
  | { type: 'capture'; seat: number; count: number; area: Area }
  | { type: 'finish'; seat: number }
  | { type: 'accept'; seat: number }
  | { type: 'decline'; seat: number }
  | { type: 'end'; winners: number[]; scores: number[]; reason: 'full' | 'agreed' };

export const nextSeat = (s: Pick<State, 'seats'>, seat: number) => s.seats[(s.seats.indexOf(seat) + 1) % s.seats.length];
export const free = (s: Pick<State, 'dots' | 'owner'>, p: number) => s.dots[p] === -1 && s.owner[p] === -1;

export function newState(cfg: Cfg, seats: number[]): State {
  const { w, h } = SIZES[cfg.size];
  const n = w * h;
  const s: State = {
    cfg,
    w,
    h,
    seats: seats.slice(),
    dots: Array(n).fill(-1),
    takenBy: Array(n).fill(-1),
    owner: Array(n).fill(-1),
    areas: [],
    turn: seats[0],
    scores: [0, 0, 0, 0],
    last: -1,
    moves: 0,
    phase: 'play',
    endBy: -1,
    agreed: [],
    winners: [],
  };
  if (cfg.cross && seats.length === 2) {
    // крест в центре: у каждого по две точки накрест
    const cx = Math.floor(w / 2) - 1;
    const cy = Math.floor(h / 2) - 1;
    const [a, b] = seats;
    s.dots[cy * w + cx] = a;
    s.dots[(cy + 1) * w + cx + 1] = a;
    s.dots[cy * w + cx + 1] = b;
    s.dots[(cy + 1) * w + cx] = b;
  }
  return s;
}

export const setup = (seats: number[], opts: Options) => newState(cfgFrom(opts), seats);

export function toAct(s: State): number[] {
  if (s.phase === 'over') return [];
  if (s.phase === 'end') return s.seats.filter((x) => x !== s.endBy && !s.agreed.includes(x)).slice(0, 1);
  return [s.turn];
}

/** Окружения игрока c: компоненты (по 4 соседям), куда нельзя пройти с края, не переступая живые точки c. */
export function enclosures(s: Pick<State, 'w' | 'h' | 'dots' | 'takenBy'>, c: number): number[][] {
  const { w, h } = s;
  const n = w * h;
  const wall = (p: number) => s.dots[p] === c && s.takenBy[p] === -1;
  const seen = new Uint8Array(n);
  const stack: number[] = [];
  for (let x = 0; x < w; x++)
    for (const y of [0, h - 1]) {
      const p = y * w + x;
      if (!wall(p) && !seen[p]) {
        seen[p] = 1;
        stack.push(p);
      }
    }
  for (let y = 0; y < h; y++)
    for (const x of [0, w - 1]) {
      const p = y * w + x;
      if (!wall(p) && !seen[p]) {
        seen[p] = 1;
        stack.push(p);
      }
    }
  const flood = (st: number[], mark: Uint8Array, out?: number[]) => {
    while (st.length) {
      const p = st.pop()!;
      out?.push(p);
      const x = p % w;
      const y = (p - x) / w;
      const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
      for (const q of nb) {
        if (q < 0 || mark[q] || wall(q)) continue;
        mark[q] = 1;
        st.push(q);
      }
    }
  };
  flood(stack, seen);
  const comps: number[][] = [];
  for (let p = 0; p < n; p++) {
    if (seen[p] || wall(p)) continue;
    seen[p] = 1;
    const comp: number[] = [];
    flood([p], seen, comp);
    comps.push(comp);
  }
  return comps;
}

/** Применить окружения игрока c: где внутри есть живые чужие точки — захват. Возвращает новые области. */
function capture(s: State, c: number): { area: Area; count: number }[] {
  const out: { area: Area; count: number }[] = [];
  for (const comp of enclosures(s, c)) {
    const prey = comp.filter((p) => s.dots[p] !== -1 && s.dots[p] !== c && s.takenBy[p] === -1);
    if (!prey.length) continue;
    const before = s.scores[c];
    for (const p of comp) {
      s.owner[p] = c;
      const d = s.dots[p];
      if (d === -1) continue;
      if (d === c) {
        // свои пленные освобождаются
        if (s.takenBy[p] !== -1) {
          s.scores[s.takenBy[p]]--;
          s.takenBy[p] = -1;
        }
      } else if (s.takenBy[p] !== c) {
        if (s.takenBy[p] !== -1) s.scores[s.takenBy[p]]--;
        s.takenBy[p] = c;
        s.scores[c]++;
      }
    }
    const set = new Set(comp);
    s.areas = s.areas.filter((a) => !a.pts.every((p) => set.has(p)));
    const area = { owner: c, pts: comp };
    s.areas.push(area);
    out.push({ area, count: s.scores[c] - before });
  }
  return out;
}

function aliveNeighbors(s: State, c: number, p: number): number {
  const x = p % s.w;
  const y = (p - x) / s.w;
  let n = 0;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const X = x + dx;
      const Y = y + dy;
      if (X < 0 || Y < 0 || X >= s.w || Y >= s.h) continue;
      const q = Y * s.w + X;
      if (s.dots[q] === c && s.takenBy[q] === -1) n++;
    }
  return n;
}

/** Заперта ли клетка p стенкой игрока c: заливка от p (по 4 соседям), пока не дойдёт до края. */
export function enclosedBy(s: Pick<State, 'w' | 'h' | 'dots' | 'takenBy'>, c: number, p: number): boolean {
  const { w, h } = s;
  const wall = (q: number) => s.dots[q] === c && s.takenBy[q] === -1;
  const seen = new Set<number>([p]);
  const queue = [p];
  for (let i = 0; i < queue.length; i++) {
    const q = queue[i];
    const x = q % w;
    const y = (q - x) / w;
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1) return false;
    for (const r of [q - 1, q + 1, q - w, q + w]) {
      if (seen.has(r) || wall(r)) continue;
      seen.add(r);
      queue.push(r);
    }
  }
  return true;
}

const clone = (s: State): State => ({
  ...s,
  dots: s.dots.slice(),
  takenBy: s.takenBy.slice(),
  owner: s.owner.slice(),
  areas: s.areas.slice(),
  scores: s.scores.slice(),
  agreed: s.agreed.slice(),
});

/** Поставить точку (без проверок очереди) — для ботов и apply. Сначала окружает ходивший, потом остальные (точка «в домик»). */
export function placeDot(s0: State, seat: number, p: number): { state: State; captures: { seat: number; area: Area; count: number }[] } {
  const s = clone(s0);
  s.dots[p] = seat;
  s.last = p;
  s.moves++;
  const captures: { seat: number; area: Area; count: number }[] = [];
  // своё кольцо может замкнуть только точка, касающаяся хотя бы двух своих живых
  if (aliveNeighbors(s, seat, p) >= 2) for (const x of capture(s, seat)) captures.push({ seat, ...x });
  // чужое — только если точку поставили внутрь их кольца («в домик»)
  for (const c of s.seats)
    if (c !== seat && s.takenBy[p] === -1 && enclosedBy(s, c, p)) for (const x of capture(s, c)) captures.push({ seat: c, ...x });
  return { state: s, captures };
}

function finishGame(s: State, ev: Event[], reason: 'full' | 'agreed') {
  const best = Math.max(...s.seats.map((x) => s.scores[x]));
  s.winners = s.seats.filter((x) => s.scores[x] === best);
  s.phase = 'over';
  ev.push({ type: 'end', winners: s.winners, scores: s.scores.slice(), reason });
}

export const freeCount = (s: Pick<State, 'dots' | 'owner'>) => s.dots.reduce((a, d, p) => a + (d === -1 && s.owner[p] === -1 ? 1 : 0), 0);

export function apply(s0: State, seat: number, a: Action): { state: State; events: Event[] } | null {
  if (!toAct(s0).includes(seat) || !a || typeof a !== 'object') return null;
  const ev: Event[] = [];
  if (s0.phase === 'end') {
    if (a.type === 'accept') {
      const s = clone(s0);
      s.agreed.push(seat);
      ev.push({ type: 'accept', seat });
      if (s.seats.every((x) => x === s.endBy || s.agreed.includes(x))) finishGame(s, ev, 'agreed');
      return { state: s, events: ev };
    }
    if (a.type === 'decline') {
      ev.push({ type: 'decline', seat });
      return { state: { ...clone(s0), phase: 'play', endBy: -1, agreed: [] }, events: ev };
    }
    return null;
  }
  if (a.type === 'finish') {
    if (s0.moves < 4) return null;
    ev.push({ type: 'finish', seat });
    return { state: { ...clone(s0), phase: 'end', endBy: seat, agreed: [] }, events: ev };
  }
  if (a.type !== 'dot' || !Number.isInteger(a.p) || a.p < 0 || a.p >= s0.dots.length || !free(s0, a.p)) return null;
  const { state: s, captures } = placeDot(s0, seat, a.p);
  ev.push({ type: 'dot', seat, p: a.p, x: a.p % s.w, y: Math.floor(a.p / s.w) });
  for (const c of captures) ev.push({ type: 'capture', seat: c.seat, count: c.count, area: c.area });
  s.turn = nextSeat(s, seat);
  if (!freeCount(s)) finishGame(s, ev, 'full');
  return { state: s, events: ev };
}
