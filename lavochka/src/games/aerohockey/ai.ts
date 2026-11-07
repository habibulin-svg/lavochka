/* Бот аэрохоккея: тот же ввод, что у человека (куда тянется рука), видит только снимок стола.
 * Шайба уходит к нему — встаёт на линию «шайба — свои ворота» и ловит; шайба на его половине и не летит в ворота —
 * заходит за неё со стороны своих ворот и бьёт сквозь, прямо или от борта. Шайба у соседа — возвращается к воротам. */
import type { Rng } from '../../core/types';
import { GOAL, homeOf, L, MAL_R, malBounds, PUCK_R, W, type AhIn, type AhState, type Seat } from './engine';

interface Level {
  /** Как часто думает (с), разброс руки (м), упреждение (с), насколько глубоко защищается, бьёт ли от борта, сила удара. */
  think: number;
  jitter: number;
  look: number;
  guard: number;
  bank: number;
  punch: number;
  /** Сколько замечает удар соседа (с): пока не заметил — рука стоит, где стояла. */
  react: number;
}

export const LEVELS: Level[] = [
  { think: 0.2, jitter: 0.06, look: 0.05, guard: 0.18, bank: 0, punch: 0.1, react: 0.32 },
  { think: 0.09, jitter: 0.03, look: 0.14, guard: 0.22, bank: 0.3, punch: 0.16, react: 0.2 },
  { think: 0.04, jitter: 0.015, look: 0.22, guard: 0.26, bank: 0.55, punch: 0.22, react: 0.12 },
];

interface Mem {
  t?: number;
  next?: number;
  goal?: [number, number];
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  wait?: number;
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/** Где будет шайба через t секунд (с отскоками от длинных бортов). */
function predict(st: AhState, t: number): [number, number] {
  const p = st.puck;
  let x = p.x + p.vx * t;
  const y = p.y + p.vy * t;
  const xm = W / 2 - PUCK_R;
  // отражения от боковых бортов — «зеркалом»
  for (let i = 0; i < 4 && (x > xm || x < -xm); i++) x = x > xm ? 2 * xm - x : -2 * xm - x;
  return [x, y];
}

export function botInput(st: AhState, seat: number, level: number, memAny: Record<string, unknown>, rng: Rng): AhIn {
  const mem = memAny as Mem;
  const lv = LEVELS[clamp(level, 0, 2)];
  const s = (seat === 1 ? 1 : 0) as Seat;
  const dt = 1 / 60;
  mem.t = (mem.t ?? 0) + dt;
  const me = st.mal[s];
  const p = st.puck;
  // «вверх» — к чужим воротам
  const fwd = s === 0 ? 1 : -1;
  const myGoalY = s === 0 ? 0 : L;
  const mine = s === 0 ? p.y < L / 2 : p.y > L / 2;
  const toward = p.vy * fwd < -0.15;
  const b = malBounds(s);
  if (st.goalT > 0 || st.over) {
    const [hx, hy] = homeOf(s);
    return { x: hx, y: hy, kx: 0, ky: 0 };
  }
  // шайба резко сменила ход (удар соседа, борт) — пока не заметил, рука стоит
  const dvx = p.vx - (mem.vx ?? p.vx);
  const dvy = p.vy - (mem.vy ?? p.vy);
  mem.vx = p.vx;
  mem.vy = p.vy;
  if (Math.hypot(dvx, dvy) > 0.8 && toward) mem.wait = mem.t + lv.react * (0.7 + rng.next() * 0.6);
  if (mem.wait != null && mem.t < mem.wait && mem.x != null && mem.y != null) return { x: mem.x, y: mem.y, kx: 0, ky: 0 };
  if (mem.next != null && mem.t < mem.next && mem.x != null && mem.y != null) return { x: mem.x, y: mem.y, kx: 0, ky: 0 };
  mem.next = mem.t + lv.think;

  let tx: number;
  let ty: number;
  const fast = Math.hypot(p.vx, p.vy) > 1.2;
  if (mine && !(toward && fast)) {
    // атака: цель — чужие ворота (иногда — отражение от борта), заходим за шайбу и бьём сквозь неё
    if (!mem.goal || rng.next() < 0.02) {
      const bank = rng.next() < lv.bank;
      const gx = (rng.next() - 0.5) * GOAL * 0.6;
      const gy = s === 0 ? L : 0;
      mem.goal = bank ? [(rng.next() < 0.5 ? -1 : 1) * (W - PUCK_R * 2) - gx, gy] : [gx, gy];
    }
    const [px, py] = predict(st, lv.look * 0.5);
    let dx = mem.goal[0] - px;
    let dy = mem.goal[1] - py;
    const d = Math.hypot(dx, dy) || 1;
    dx /= d;
    dy /= d;
    // точка за шайбой на линии удара
    const behindX = px - dx * (MAL_R + PUCK_R + 0.03);
    const behindY = py - dy * (MAL_R + PUCK_R + 0.03);
    const off = Math.hypot(me.x - behindX, me.y - behindY);
    // бита ещё не за шайбой (или с её чужой стороны) — сначала обойти
    const wrongSide = (me.y - py) * fwd > -0.01;
    if (wrongSide) {
      tx = px + (me.x < px ? -1 : 1) * (MAL_R + PUCK_R + 0.06);
      ty = py - fwd * (MAL_R + PUCK_R + 0.05);
    } else if (off > 0.07) {
      tx = behindX;
      ty = behindY;
    } else {
      // удар: рука идёт сквозь шайбу
      tx = px + dx * lv.punch * 3;
      ty = py + dy * lv.punch * 3;
    }
  } else {
    // защита: между шайбой и серединой своих ворот, на глубине guard
    const [px, py] = toward ? predict(st, Math.min(0.6, Math.abs((p.y - (myGoalY + fwd * lv.guard)) / (p.vy || 1)))) : predict(st, lv.look);
    const gy = myGoalY + fwd * lv.guard;
    const k = clamp(Math.abs(gy - myGoalY) / Math.max(0.05, Math.abs(py - myGoalY)), 0, 1);
    tx = px * k;
    ty = gy;
    if (!toward && !mine) tx *= 0.6;
  }
  const err = lv.jitter * (1 + Math.hypot(p.vx, p.vy) * 0.6);
  tx += (rng.next() - 0.5) * err * 2;
  ty += (rng.next() - 0.5) * lv.jitter;
  tx = clamp(tx, b.x0, b.x1);
  ty = clamp(ty, b.y0, b.y1);
  mem.x = tx;
  mem.y = ty;
  return { x: tx, y: ty, kx: 0, ky: 0 };
}
