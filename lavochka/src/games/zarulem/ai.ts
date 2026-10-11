/* Боты «За рулём»: держат машинку на дороге, целясь в середину чуть впереди (с упреждением на изгиб), обгоняют
 * медленные машинки по другой полосе; передачу выбирают прикидкой: проедет ли машинка следующие секунды на этой скорости,
 * не вылетев с дороги. Слабый осторожен (не выше второй), реагирует с запозданием и виляет. */
import type { Rng } from '../../core/types';
import { dAng, GEARS, R_MAX, R_MIN, STEER, track, type Car, type Track, type ZrIn, type ZrState } from './engine';

interface Level {
  /** Самая высокая передача; запас по ширине дороги в прикидке (доля полуширины); реакция руля, с; вилянье. */
  maxG: number;
  margin: number;
  react: number;
  noise: number;
}

export const LEVELS: Level[] = [
  { maxG: 2, margin: 0.5, react: 0.2, noise: 0.35 },
  { maxG: 3, margin: 0.66, react: 0.08, noise: 0.12 },
  { maxG: 3, margin: 0.8, react: 0, noise: 0 },
];

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
/** Куда целиться поперёк: середина дороги чуть впереди (упреждение растёт со скоростью). */
const aim = (t: Track, a: number, w: number) => t.rc(a + 0.04 + w * 0.32);
/** Руль к цели: плюс — вправо (к центру, радиус меньше). */
const steerTo = (r: number, target: number) => clamp((r - target) / 0.035, -1, 1);

/** Проедет ли машинка ближайшую секунду (потом успеет сбросить) на передаче g, держа середину, не выходя за margin полуширины. */
export function feasible(t: Track, c: Pick<Car, 'a' | 'r' | 'w'>, g: number, margin: number): boolean {
  let { a, r, w } = c;
  const dt = 0.05;
  for (let i = 0; i < 22; i++) {
    w += clamp(GEARS[g] - w, -1.6 * dt, 0.55 * dt);
    a += w * dt;
    r = clamp(r - steerTo(r, aim(t, a, w)) * STEER * dt, R_MIN, R_MAX);
    if (i > 3 && Math.abs(r - t.rc(a)) > t.w * margin) return false;
  }
  return true;
}

/** Медленная машинка впереди — обойти по другой полосе: смещение цели от середины дороги и где помеха. */
function dodge(st: ZrState, t: Track, me: Car): { off: number; at: number | null } {
  const lim = t.w * 0.92;
  const myOff = me.r - t.rc(me.a);
  let best: { d: number; a: number; lo: number; hi: number } | null = null;
  for (const c of st.cars) {
    if (c === me || c.out || c.fin >= 0 || !(c.stun > 0 || c.w < me.w * 0.95 || c.g < me.g)) continue;
    const d = dAng(c.a - me.a);
    // впереди или ещё сбоку (пока не обошли целиком)
    if (d <= -0.3 || d > 0.6) continue;
    const o = c.r - t.rc(c.a);
    const lo = o - 0.115;
    const hi = o + 0.115;
    if (lo >= 0 || hi <= 0) continue;
    if (!best || d < best.d) best = { d, a: c.a, lo, hi };
  }
  if (!best) return { off: 0, at: null };
  const okLo = best.lo > -lim;
  const okHi = best.hi < lim;
  const off = okLo && okHi ? (Math.abs(best.lo - myOff) < Math.abs(best.hi - myOff) ? best.lo : best.hi) : okLo ? best.lo : okHi ? best.hi : 0;
  return { off, at: best.a };
}

export function botInput(st: ZrState, seat: number, level: number, m: Record<string, any>, rng: Rng): ZrIn {
  const mem = m as { gAt?: number; g?: number; sAt?: number; s?: number; wob?: number };
  const lv = LEVELS[clamp(level, 0, 2)];
  const me = st.cars.find((c) => c.seat === seat);
  if (!me || me.out) return { s: 0, g: 0 };
  const t = track(st.track);
  // передача — раз в 0,2 с: самая высокая, на которой прикидка проходит
  if (mem.gAt == null || st.t >= mem.gAt || st.t < mem.gAt - 1) {
    mem.gAt = st.t + 0.2;
    let g = 1;
    for (let k = lv.maxG; k >= 1; k--)
      if (feasible(t, me, k, lv.margin)) {
        g = k;
        break;
      }
    mem.g = g;
  }
  // руль
  if (mem.sAt == null || st.t >= mem.sAt || st.t < mem.sAt - 1) {
    mem.sAt = st.t + lv.react;
    const dd = dodge(st, t, me);
    // объезжаем — целимся в точку рядом с помехой (не дальше неё), чтобы мимо неё пройти со смещением
    const lead = me.a + 0.04 + me.w * 0.32;
    const target = dd.at == null ? aim(t, me.a, me.w) : t.rc(Math.max(me.a + 0.02, Math.min(lead, me.a + dAng(dd.at - me.a)))) + dd.off;
    if (lv.noise && rng.next() < 0.1) mem.wob = (rng.next() - 0.5) * 2 * lv.noise;
    mem.s = clamp(steerTo(me.r, target) + (mem.wob ?? 0), -1, 1);
  }
  return { s: mem.s ?? 0, g: mem.g ?? 1 };
}
