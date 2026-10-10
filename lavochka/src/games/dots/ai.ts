/* Точки — боты. Ходы ищут рядом с уже поставленными точками.
 *   Лёгкий — окружает, когда видит сразу, иначе ставит куда попало рядом;
 *   Средний — ещё и закрывает места, где соперник окружил бы следующим ходом, не лезет «в домик»;
 *   Сложный — для лучших ходов смотрит лучший ответ соперника и свои будущие угрозы. */
import type { Rng } from '../../core/types';
import { enclosures, free, nextSeat, placeDot, type Action, type State } from './engine';

const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
export const tuning = { fast: !!env?.VITEST && !env?.SIM_GAMES };

function candidates(s: State, radius: number): number[] {
  const { w, h } = s;
  const out = new Set<number>();
  let any = false;
  for (let p = 0; p < s.dots.length; p++) {
    if (s.dots[p] === -1 || s.takenBy[p] !== -1) continue;
    any = true;
    const x = p % w;
    const y = (p - x) / w;
    for (let dy = -radius; dy <= radius; dy++)
      for (let dx = -radius; dx <= radius; dx++) {
        const X = x + dx;
        const Y = y + dy;
        if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
        const q = Y * w + X;
        if (free(s, q)) out.add(q);
      }
  }
  if (!any || !out.size) {
    const all: number[] = [];
    for (let p = 0; p < s.dots.length; p++) if (free(s, p)) all.push(p);
    if (!any) {
      const c = Math.floor(h / 2) * w + Math.floor(w / 2);
      return all.sort((a, b) => dist(s, a, c) - dist(s, b, c)).slice(0, 9);
    }
    return all;
  }
  return [...out];
}

const dist = (s: State, a: number, b: number) => Math.max(Math.abs((a % s.w) - (b % s.w)), Math.abs(Math.floor(a / s.w) - Math.floor(b / s.w)));

/** Окружённые места каждого игрока (кэш на позицию): чужая точка, поставленная туда, попадётся. */
const encCache = new WeakMap<State, Map<number, Set<number>>>();
function enclosed(s: State, c: number): Set<number> {
  let m = encCache.get(s);
  if (!m) encCache.set(s, (m = new Map()));
  let set = m.get(c);
  if (!set) m.set(c, (set = new Set(enclosures(s, c).flat())));
  return set;
}

function ownNeighbors(s: State, seat: number, p: number): number {
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
      if (s.dots[q] === seat && s.takenBy[q] === -1) n++;
    }
  return n;
}

/** Область, запертая стенкой c, где лежит q (по 4 соседям); null — выход к краю есть. */
function regionOf(s: State, c: number, q: number, limit: number): number[] | null {
  const { w, h } = s;
  const seen = new Set<number>([q]);
  const queue = [q];
  for (let i = 0; i < queue.length; i++) {
    const r = queue[i];
    const x = r % w;
    const y = (r - x) / w;
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || queue.length > limit) return null;
    for (const t of [r - 1, r + 1, r - w, r + w]) {
      if (seen.has(t) || (s.dots[t] === c && s.takenBy[t] === -1)) continue;
      seen.add(t);
      queue.push(t);
    }
  }
  return queue;
}

/** Сколько очков даст ход (минус, если свою точку тут же окружат). Позицию не копирует: точку ставит и убирает. */
function gain(s: State, seat: number, p: number): number {
  // замкнуть стенку можно, только касаясь хотя бы двух своих точек
  if (ownNeighbors(s, seat, p) < 2) return s.seats.some((o) => o !== seat && enclosed(s, o).has(p)) ? -3 : 0;
  const { w } = s;
  const x = p % w;
  s.dots[p] = seat;
  let g = 0;
  const done = new Set<number>();
  const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w];
  for (const q of nb) {
    if (q < 0 || q >= s.dots.length || done.has(q) || (s.dots[q] === seat && s.takenBy[q] === -1)) continue;
    const reg = regionOf(s, seat, q, s.dots.length / 2);
    if (!reg) continue;
    for (const r of reg) {
      done.add(r);
      if (s.dots[r] !== -1 && s.dots[r] !== seat && s.takenBy[r] === -1) g++;
    }
  }
  s.dots[p] = -1;
  if (!g && s.seats.some((o) => o !== seat && enclosed(s, o).has(p))) return -3;
  return g;
}

/** Лучший захват, который есть у seat прямо сейчас. */
function bestCapture(s: State, seat: number, cands: number[]): { p: number; g: number } {
  let best = { p: -1, g: 0 };
  for (const p of cands) {
    const g = gain(s, seat, p);
    if (g > best.g) best = { p, g };
  }
  return best;
}

function shape(s: State, seat: number, p: number): number {
  // рядом свои — стенка растёт; рядом чужие — давим
  const { w } = s;
  const x = p % w;
  const y = (p - x) / w;
  let v = 0;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const X = x + dx;
      const Y = y + dy;
      if (X < 0 || Y < 0 || X >= s.w || Y >= s.h) continue;
      const d = s.dots[Y * w + X];
      if (d === -1 || s.takenBy[Y * w + X] !== -1) continue;
      if (d === seat) v += dx && dy ? 3 : 2;
      else v += 2.5;
    }
  // не жмёмся к краю: у края не окружают
  if (x === 0 || y === 0 || x === s.w - 1 || y === s.h - 1) v -= 4;
  return v;
}

export function choose(s: State, seat: number, level: number, rng: Rng): Action | null {
  if (s.phase === 'over') return null;
  if (s.phase === 'end') {
    const mine = s.scores[seat];
    const best = Math.max(...s.seats.filter((x) => x !== seat).map((x) => s.scores[x]));
    return { type: mine >= best ? 'accept' : 'decline' };
  }
  if (s.turn !== seat) return null;
  const cands = candidates(s, level === 0 || tuning.fast ? 1 : 2);
  if (!cands.length) return null;
  if (level === 0) {
    const cap = bestCapture(s, seat, cands);
    if (cap.g > 0 && rng.next() < 0.7) return { type: 'dot', p: cap.p };
    return { type: 'dot', p: cands[rng.int(cands.length)] };
  }
  const opp = nextSeat(s, seat);
  // где соперник окружил бы следующим ходом
  const threat = new Map<number, number>();
  for (const q of cands) {
    const g = gain(s, opp, q);
    if (g > 0) threat.set(q, g);
  }
  const scored = cands.map((p) => {
    const g = gain(s, seat, p);
    return { p, v: g * 100 + (threat.get(p) ?? 0) * 90 + shape(s, seat, p) + rng.next() * 2 };
  });
  scored.sort((a, b) => b.v - a.v);
  if (level === 1) return { type: 'dot', p: scored[0].p };
  // сложный: лучшие ходы проверяем ответом соперника
  const top = scored.slice(0, tuning.fast ? 3 : 10);
  let best = top[0];
  let bestV = -Infinity;
  for (const x of top) {
    const after = placeDot(s, seat, x.p).state;
    after.turn = opp;
    const near = candidates(after, 1);
    const reply = bestCapture(after, opp, near).g;
    // свои угрозы на следующий ход
    let mine = 0;
    if (!tuning.fast) for (const q of near.slice(0, 40)) if (gain(after, seat, q) > 0) mine++;
    const v = x.v - reply * 95 + mine * 12;
    if (v > bestV) {
      bestV = v;
      best = x;
    }
  }
  return { type: 'dot', p: best.p };
}
