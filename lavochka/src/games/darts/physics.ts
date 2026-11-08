/* Дартс — полёт дротика (без DOM). Бросок с черты 2,37 м: рука выпускает дротик в 0,4 м перед чертой, чуть ниже центра мишени.
 * В полёте — тяжесть и небольшое сопротивление воздуха; дротик летит остриём по скорости.
 *
 * Бросок задаётся так, как его чувствует игрок: точка прицела (x, y) на мишени — куда воткнулся бы дротик, брошенный «как надо»
 * (с силой V0), сила v (м/с) и увод кисти вбок side (рад). Слабее — дротик проваливается ниже прицела, сильнее — выше;
 * увод — вбок. Угол вылета подбирается под прицел при силе V0 (как у живого игрока, который «набросал» руку).
 *
 * У мишени: попал в проволоку — может отскочить (или соскользнуть в соседнее поле), в уже торчащий дротик — отскок или воткнётся
 * рядом, мимо мишени — в дерево шкафчика и на пол, совсем вялый бросок (пришёл слишком круто) — не втыкается и падает. */
import { R, WIRE, wireDist } from './board';

/** Черта и рука. */
export const OCHE = 2.37;
export const HAND = { x: 0.02, y: -0.1, z: OCHE - 0.4 };
/** Сила «как надо», м/с (живой бросок — 5–7 м/с, дуга заметная). */
export const V0 = 6.5;
export const VMIN = 3.5;
export const VMAX = 10;
export const G = 9.81;
/** Сопротивление воздуха: a = −K·|v|·v. */
const K = 0.018;
const DT = 0.002;
/** Длина дротика, м (для отрисовки и столкновений с торчащими). */
export const DART_LEN = 0.155;

export interface Throw {
  x: number;
  y: number;
  v: number;
  side: number;
}

export interface Frame {
  t: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

export interface Flight {
  frames: Frame[];
  /** Где пересёк плоскость мишени (z = 0); null — упал раньше. */
  at: { x: number; y: number; t: number; vx: number; vy: number; vz: number } | null;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function clampThrow(t: Throw): Throw {
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  return {
    x: clamp(num(t.x, 0), -0.6, 0.6),
    y: clamp(num(t.y, 0), -0.6, 0.6),
    v: clamp(num(t.v, V0), VMIN, VMAX),
    side: clamp(num(t.side, 0), -0.12, 0.12),
  };
}

/** Полёт из руки с начальной скоростью (vx, vy, vz). frames — каждый шаг (для экрана), иначе только итог. */
function fly(vx: number, vy: number, vz: number, keep: boolean): Flight {
  let x = HAND.x;
  let y = HAND.y;
  let z = HAND.z;
  let t = 0;
  const frames: Frame[] = [];
  if (keep) frames.push({ t, x, y, z, vx, vy, vz });
  for (let k = 0; k < 2000; k++) {
    const sp = Math.sqrt(vx * vx + vy * vy + vz * vz);
    const ax = -K * sp * vx;
    const ay = -G - K * sp * vy;
    const az = -K * sp * vz;
    vx += ax * DT;
    vy += ay * DT;
    vz += az * DT;
    const nx = x + vx * DT;
    const ny = y + vy * DT;
    const nz = z + vz * DT;
    if (nz <= 0) {
      const f = z / (z - nz);
      const hx = x + (nx - x) * f;
      const hy = y + (ny - y) * f;
      const ht = t + DT * f;
      if (keep) frames.push({ t: ht, x: hx, y: hy, z: 0, vx, vy, vz });
      return { frames, at: { x: hx, y: hy, t: ht, vx, vy, vz } };
    }
    x = nx;
    y = ny;
    z = nz;
    t += DT;
    if (keep) frames.push({ t, x, y, z, vx, vy, vz });
    // упал на пол (рука на 1,63 м, пол — на 1,73 м ниже центра мишени)
    if (y < -1.73) return { frames, at: null };
  }
  return { frames, at: null };
}

function launchVel(v: number, yaw: number, elev: number) {
  return { vx: v * Math.sin(yaw) * Math.cos(elev), vy: v * Math.sin(elev), vz: -v * Math.cos(yaw) * Math.cos(elev) };
}

/** Угол вылета, при котором дротик с силой V0 приходит в точку прицела по высоте. */
export function elevationFor(x: number, y: number): number {
  const yaw = Math.atan2(x - HAND.x, HAND.z);
  let lo = -0.4;
  let hi = 0.7;
  for (let k = 0; k < 28; k++) {
    const mid = (lo + hi) / 2;
    const l = launchVel(V0, yaw, mid);
    const f = fly(l.vx, l.vy, l.vz, false);
    const hy = f.at ? f.at.y : -10;
    if (hy < y) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Полёт броска t. */
export function flight(t: Throw, keep = false): Flight {
  const c = clampThrow(t);
  const yaw = Math.atan2(c.x - HAND.x, HAND.z) + c.side;
  const l = launchVel(c.v, yaw, elevationFor(c.x, c.y));
  return fly(l.vx, l.vy, l.vz, keep);
}

/** Дротик в мишени: точка и наклон (для отрисовки). */
export interface Stuck {
  x: number;
  y: number;
  /** Угол прихода сверху вниз, рад (наклон хвоста вверх). */
  inc: number;
  /** Наклон вбок (рад): хвост в сторону, откуда летел. */
  lat: number;
  seat: number;
}

export type Outcome = 'stick' | 'wire' | 'dart' | 'off' | 'weak';

export interface Landing {
  res: Outcome;
  /** Где коснулся мишени (или стенки шкафчика); null — не долетел, упал на пол. */
  x: number | null;
  y: number | null;
  inc: number;
  lat: number;
  /** Время полёта, с. */
  t: number;
}

/** Слишком круто пришёл — не воткнётся. */
const STEEP = 0.62;
/** В торчащий дротик: ближе стольких метров — задел его. */
const DART_HIT = 0.0042;

/** Чем кончился бросок. roll(100) — случайность отскока (комната даёт свой rng; зовут только при касании проволоки/дротика). */
export function land(t: Throw, stuck: Stuck[], roll: (n: number) => number): Landing {
  const f = flight(t);
  if (!f.at) return { res: 'weak', x: null, y: null, inc: 0, lat: 0, t: 0.6 };
  let { x, y } = f.at;
  const { vx, vy, vz } = f.at;
  const inc = Math.atan2(-vy, -vz);
  const lat = Math.atan2(vx, -vz);
  const base = { inc, lat, t: f.at.t };
  if (Math.hypot(x, y) > R.board) return { res: 'off', x, y, ...base };
  if (inc > STEEP) return { res: 'weak', x, y, ...base };
  // в торчащий дротик
  for (const d of stuck) {
    const dd = Math.hypot(x - d.x, y - d.y);
    if (dd < DART_HIT) {
      if (roll(100) < 55) return { res: 'dart', x, y, ...base };
      // соскользнул по корпусу и воткнулся рядом
      const ux = dd > 1e-6 ? (x - d.x) / dd : 1;
      const uy = dd > 1e-6 ? (y - d.y) / dd : 0;
      x = d.x + ux * (DART_HIT + 0.0008);
      y = d.y + uy * (DART_HIT + 0.0008);
    }
  }
  // проволока: отскок тем вероятнее, чем точнее «в лоб» и чем круче пришёл
  const w = wireDist(x, y);
  if (w < WIRE) {
    const chance = Math.round(18 + 30 * (1 - w / WIRE) + 40 * Math.min(1, inc / STEEP));
    if (roll(100) < chance) return { res: 'wire', x, y, ...base };
  }
  return { res: 'stick', x, y, ...base };
}
