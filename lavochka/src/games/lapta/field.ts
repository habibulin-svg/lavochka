/* Лапта — поле, мяч и удар (без DOM): размеры по правилам партии, расстановка, полёт мяча по физике набора дворового
 * спорта (core/dvorsport/body.ts), оценка удара, перехват. Общее для комнаты (engine.ts), ботов (ai.ts) и экрана.
 * Оси: x — поперёк поля, y — от линии дома (0) к линии кона (L), z — вверх. */
import { body, fly, kick, MAT, type Body, type BodyFrame, type BodyMat } from '../../core/dvorsport/body';
import type { Options } from '../../core/types';

/** Мяч по утоптанной земле пустыря: катится меньше, чем по асфальту. */
export const BALL: BodyMat = { ...MAT.ball, roll: 2.6 };
export const BALL_R = 0.035;
/** Где мяч встречает биту: чуть перед домом, на высоте пояса. */
export const HIT_AT = { x: 0, y: 0.45, z: 1.0 };
/** Скорость бега: нападающий налегке, полевой — к мячу. */
export const VR = 6.2;
export const VF = 5.6;
/** К летящему мячу «под свечу» — медленнее: надо успеть встать и поймать. */
export const VF_AIR = 4.4;
/** Скорость брошенного мяча, м/с. */
export const VT = 19;
/** Реакция полевого на удар, замах броска, подобрать мяч, с. */
export const REACT = 0.35;
export const WIND = 0.3;
export const PICK = 0.25;
/** Ловля: до какой высоты достаёт руками, на сколько дотягивается в воздухе и с земли. */
export const REACH_Z = 2.2;
export const ARM = 0.6;
export const ARM_LOW = 0.4;

export type Style = 'candle' | 'far' | 'low';
export const PITCH: Record<Style, number> = { candle: 1.05, far: 0.6, low: 0.24 };

export interface Cfg {
  /** Игроков в команде. */
  n: number;
  /** Длина поля (дом — кон) и ширина, м. */
  L: number;
  W: number;
  /** Контрольная линия от дома, м. */
  ctrl: number;
  /** Попыток удара у бьющего. */
  tries: 1 | 2;
  /** Свеча: очко защите или смена. */
  candle: 'point' | 'swap';
  /** Из дома бежит только тот, кто сам ударил (ярославская лапта). */
  onlyHitter: boolean;
  /** До скольких очков. */
  target: number;
  /** Предел ударов на партию (страховка): потом — по счёту. */
  maxHits: number;
  /** Время партии, мин (0 — без времени). */
  minutes: number;
}

export type PStatus = 'ready' | 'used' | 'kon' | 'run';
export type HitKind = 'ok' | 'short' | 'out' | 'miss';

export function cfgFrom(o: Options): Cfg {
  const n = clampI(Number(o.n ?? 6), 3, 6);
  const L = Number(o.field ?? 50) || 50;
  const W = Math.round(L * 0.6);
  return {
    n,
    L,
    W,
    ctrl: Number(o.ctrl ?? Math.round(L / 5)) || 10,
    tries: Number(o.tries ?? 2) === 1 ? 1 : 2,
    candle: o.candle === 'swap' ? 'swap' : 'point',
    onlyHitter: o.onlyHitter === true || o.onlyHitter === 'yes',
    target: Number(o.target ?? 21) || 21,
    maxHits: 160,
    minutes: Number(o.minutes ?? 0) || 0,
  };
}

const clampI = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v) || lo));
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const r2 = (v: number) => Math.round(v * 1000) / 1000;

/** Расстановка полевых: доли ширины и длины поля. */
const FORM: Record<number, [number, number][]> = {
  3: [[-0.24, 0.42], [0.24, 0.42], [0, 0.8]],
  4: [[-0.27, 0.38], [0.27, 0.38], [-0.17, 0.76], [0.17, 0.76]],
  5: [[-0.28, 0.36], [0.28, 0.36], [0, 0.56], [-0.22, 0.8], [0.22, 0.8]],
  6: [[-0.3, 0.33], [0.3, 0.33], [0, 0.5], [-0.28, 0.72], [0.28, 0.72], [0, 0.92]],
};
export function formation(c: Cfg): [number, number][] {
  return (FORM[c.n] ?? FORM[6]).map(([fx, fy]) => [r2(fx * c.W), r2(fy * c.L)]);
}

/** Дорожка бегущего (x): у каждого игрока своя, вдоль боковых — подальше от полевых. */
export const lane = (c: Cfg, who: number) => r2((who % 2 ? 1 : -1) * c.W * (0.36 + 0.035 * Math.floor(who / 2)));
/** Откуда и докуда бегут: чуть за линиями. */
export const Y_DOM = -0.4;
export const yKon = (c: Cfg) => c.L + 0.4;

/** Где ждут игроки нападения: в доме — за линией, в кону — за линией кона (оси игры). */
export function homeSpot(c: Cfg, who: number, at: 'dom' | 'kon'): [number, number] {
  // в доме — сбоку от площадки бьющего, у левой боковой, двумя рядами
  return at === 'dom' ? [r2(-3.6 - (who % 3) * 1.25), r2(-1.6 - Math.floor(who / 3) * 1.4)] : [lane(c, who), r2(yKon(c) + 1.2)];
}

/** Скорость мяча при полной силе — подобрана по длине поля: дальний удар в полную силу улетает чуть за кон. */
const vmaxCache = new Map<number, number>();
export function vMax(c: Cfg): number {
  const k = c.L;
  const got = vmaxCache.get(k);
  if (got) return got;
  let lo = 8;
  let hi = 70;
  for (let i = 0; i < 26; i++) {
    const m = (lo + hi) / 2;
    const r = fly(kick(body(HIT_AT.x, HIT_AT.y, HIT_AT.z, BALL_R), m, 0, PITCH.far), { mat: BALL, maxT: 12, frameDt: 0, stop: (b) => b.z <= BALL_R + 1e-4 });
    if ((r.land?.y ?? r.body.y) < c.L * 1.12) lo = m;
    else hi = m;
  }
  const v = (lo + hi) / 2;
  vmaxCache.set(k, v);
  return v;
}

/** Мяч после удара: сила 0…1, направление (yaw: 0 — вдоль поля, плюс — вправо), стиль — угол вверх. */
export function strike(c: Cfg, pow: number, yaw: number, style: Style): Body {
  const v = vMax(c) * (0.3 + 0.7 * clamp(pow, 0, 1));
  const b = kick(body(HIT_AT.x, HIT_AT.y, HIT_AT.z, BALL_R), v, clamp(yaw, -0.75, 0.75), PITCH[style] ?? PITCH.far);
  return { ...b, vx: r2(b.vx), vy: r2(b.vy), vz: r2(b.vz) };
}

/** Полёт мяча кадрами (общий для комнаты, ботов и экрана). */
const flightCache = new Map<string, { frames: BodyFrame[]; land: { x: number; y: number; t: number } | null; rest: number }>();
export function flight(b0: Body) {
  const key = `${b0.x},${b0.y},${b0.z},${b0.vx},${b0.vy},${b0.vz}`;
  let f = flightCache.get(key);
  if (!f) {
    const r = fly(b0, { mat: BALL, maxT: 12, frameDt: 1 / 60 });
    f = { frames: r.frames, land: r.land, rest: r.t };
    if (flightCache.size > 400) flightCache.clear();
    flightCache.set(key, f);
  }
  return f;
}

/** Каков удар: в поле за контрольной (или за кон между боковыми), недолёт, аут. */
export function judge(c: Cfg, land: { x: number; y: number } | null): HitKind {
  if (!land) return 'out';
  if (land.y < 0 || Math.abs(land.x) > c.W / 2) return 'out';
  if (land.y < c.ctrl) return 'short';
  return 'ok';
}

/** Перехват: когда полевой из точки f успеет к мячу (в воздухе — до высоты рук, на земле — подобрать). */
export function intercept(b0: Body, f: [number, number]): { t: number; x: number; y: number; air: boolean; margin: number } {
  const fl = flight(b0);
  const tLand = fl.land?.t ?? Infinity;
  for (const [t, x, y, z] of fl.frames) {
    if (z > REACH_Z) continue;
    const air = t < tLand;
    const run = Math.max(0, (t - REACT) * (air ? VF_AIR : VF));
    const d = Math.hypot(x - f[0], y - f[1]);
    const arm = air ? ARM : ARM_LOW;
    if (air && z < 0.25) continue;
    if (d <= run + arm) return { t, x, y, air, margin: run + arm - d };
  }
  // мяч остановился раньше, чем добежали: бежим к лежащему
  const last = fl.frames[fl.frames.length - 1];
  const d = Math.hypot(last[1] - f[0], last[2] - f[1]);
  return { t: Math.max(last[0], REACT + Math.max(0, d - ARM_LOW) / VF), x: last[1], y: last[2], air: false, margin: 0 };
}

/** Шанс поймать с лёта по запасу (м). */
export const catchChance = (margin: number) => (margin > 1.2 ? 0.9 : margin > 0.4 ? 0.72 : 0.45);

