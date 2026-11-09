/* Пекарь — поле и физика (без DOM: их гоняют сервер, боты и тесты): черты званий, банка, палка в полёте (body.ts набора
 * дворового спорта), отлёт сбитой банки, пинок на жеребьёвке. Оси: x — вбок, y — от черты рядового (0) к банке (dist), z — вверх. */
import { body, DT, kick, MAT, step, type Body, type BodyFrame, type BodyMat } from '../../core/dvorsport/body';
import type { Options } from '../../core/types';

/** Палка по утоптанной земле: скользит и подпрыгивает мало. */
export const STICK: BodyMat = { ...MAT.stick, roll: 4.2, bounce: 0.18 };
export const STICK_R = 0.025;
/** Банка: радиус и высота, м. */
export const CAN_R = 0.05;
export const CAN_H = 0.12;
/** Бег: игрок за палкой, пекарь, пекарь с банкой в руках. */
export const VR = 5.4;
export const VP = 5.4;
export const VP_CAN = 4.6;
/** На сколько пекарь дотягивается палкой, м; подобрать палку и банку — с какого расстояния. */
export const REACH = 1.1;
export const GRAB = 0.7;
/** Кружок банки (поставить — внутрь), м. */
export const CIRCLE = 0.6;

export type Style = 'flat' | 'lob';
/** Угол броска: низом «пропеллером» (палка крутится плашмя, сметает широко) и навесом (кувырком, падает у банки). */
export const PITCH: Record<Style, number> = { flat: 0.1, lob: 0.5 };
/** Насколько палка дотягивается до банки вокруг своего центра: плашмя — почти на половину длины. */
export const SWEEP: Record<Style, number> = { flat: 0.26, lob: 0.14 };
export const SPIN: Record<Style, number> = { flat: 15, lob: 11 };

/** Звания — по дворовым правилам (igry-na-ulice.ru, galen.by): от рядового до маршала. */
export const RANKS_FULL = ['Рядовой', 'Ефрейтор', 'Сержант', 'Лейтенант', 'Капитан', 'Майор', 'Полковник', 'Генерал', 'Маршал'];
export const RANKS_SHORT = ['Рядовой', 'Сержант', 'Лейтенант', 'Капитан', 'Генерал'];

export interface Cfg {
  /** Игроков (вместе с пекарем). */
  n: number;
  /** От черты рядового до банки, м. */
  dist: number;
  /** Звания (одно — «без званий»: все бросают с одной черты, считают сбитые банки). */
  ranks: string[];
  /** На сколько метров ближе черта следующего звания. */
  step: number;
  /** Без званий: до скольких сбитых банок. */
  target: number;
  /** Стал пекарем — звание вниз на ступень. */
  demote: boolean;
  /** Страховка: бросков за партию. */
  maxThrows: number;
}

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const clampI = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v) || lo));
export const r3 = (v: number) => Math.round(v * 1000) / 1000;

export function cfgFrom(o: Options, n = 4): Cfg {
  const dist = Number(o.dist ?? 14) || 14;
  const ranks = o.ranks === 'none' ? ['Игрок'] : o.ranks === 'short' ? RANKS_SHORT : RANKS_FULL;
  // черта маршала (или генерала) — не ближе 5 м к банке
  const step = ranks.length > 1 ? r3(Math.min(1, (dist - 5) / (ranks.length - 1))) : 0;
  return {
    n: clampI(n, 2, 6),
    dist,
    ranks,
    step,
    target: clampI(Number(o.target ?? 5), 1, 20),
    demote: o.demote === true || o.demote === 'yes',
    maxThrows: 400,
  };
}

/** Черта звания (y). */
export const lineY = (c: Cfg, rank: number) => r3(clamp(rank, 0, c.ranks.length - 1) * c.step);
/** Где стоит банка (кружок кона). */
export const canHome = (c: Cfg): [number, number] => [0, c.dist];
/** Где стоит пекарь: сбоку за банкой. */
export const pekarSpot = (c: Cfg): [number, number] => [1.3, r3(c.dist + 1.1)];
/** Где бросает: на черте посередине. */
export const throwSpot = (c: Cfg, rank: number): [number, number] => [0, lineY(c, rank)];
/** Где ждёт игрок за своей чертой: по обе стороны от бросающего. */
export function waitSpot(c: Cfg, who: number, rank: number): [number, number] {
  const side = who % 2 ? 1 : -1;
  return [r3(side * (2.4 + 1.0 * Math.floor(who / 2))), r3(lineY(c, rank) - 0.7)];
}

/** Откуда вылетает палка (из руки над плечом). */
export const RELEASE = { x: 0.25, dy: 0.3, z: 1.45 };

// ---------------------------------------------------------------- полёт палки

export interface StickFlight {
  frames: BodyFrame[];
  /** Сбила банку: когда и где. */
  hit: { t: number; x: number; y: number; v: number; vx: number; vy: number } | null;
  /** Где легла (x, y, угол). */
  rest: [number, number, number];
  t: number;
}

/** Скорость палки в полную силу — подобрана по расстоянию: плашмя в полную силу улетает на 1,7 дистанции. */
const vmaxCache = new Map<string, number>();
export function vMax(c: Cfg, style: Style): number {
  const key = `${c.dist}|${style}`;
  const got = vmaxCache.get(key);
  if (got) return got;
  let lo = 4;
  let hi = 60;
  for (let i = 0; i < 24; i++) {
    const m = (lo + hi) / 2;
    const r = flyStick(kick(body(RELEASE.x, RELEASE.dy, RELEASE.z, STICK_R), m, 0, PITCH[style]), style, null);
    if (r.rest[1] < c.dist * 1.7) lo = m;
    else hi = m;
  }
  const v = (lo + hi) / 2;
  vmaxCache.set(key, v);
  return v;
}

/** Палка после броска с места (x, y): сила 0…1, направление (yaw: 0 — вдоль поля, плюс — вправо), стиль. */
export function throwFrom(c: Cfg, x: number, y: number, pow: number, yaw: number, style: Style): Body {
  const v = vMax(c, style) * (0.3 + 0.7 * clamp(pow, 0, 1));
  const b = kick(body(x + RELEASE.x, y + RELEASE.dy, RELEASE.z, STICK_R), v, clamp(yaw, -0.6, 0.6), PITCH[style] ?? PITCH.flat, SPIN[style]);
  return { ...b, x: r3(b.x), y: r3(b.y), vx: r3(b.vx), vy: r3(b.vy), vz: r3(b.vz) };
}

/** Полёт палки до остановки; can — где стоит банка (null — не проверять попадание). */
export function flyStick(b0: Body, style: Style, can: [number, number] | null, frameDt = 1 / 60, quick = false): StickFlight {
  const b = { ...b0 };
  // прикидка ботов: шаг крупнее, конец — как только попал или палка ушла за банку
  const dt = quick ? DT * 4 : DT;
  const frames: BodyFrame[] = frameDt > 0 ? [[0, b.x, b.y, b.z, b.a]] : [];
  let t = 0;
  let next = frameDt;
  let hit: StickFlight['hit'] = null;
  const reach = CAN_R + SWEEP[style];
  const n = Math.ceil(8 / dt);
  for (let i = 1; i <= n; i++) {
    t = i * dt;
    step(b, dt, STICK);
    if (frameDt > 0 && t >= next - 1e-9) {
      frames.push([t, b.x, b.y, b.z, b.a]);
      next += frameDt;
    }
    if (can && !hit && b.z - b.r < CAN_H + 0.03 && Math.hypot(b.x - can[0], b.y - can[1]) < reach) {
      hit = { t, x: b.x, y: b.y, v: Math.hypot(b.vx, b.vy), vx: b.vx, vy: b.vy };
      // банка гасит палку: та отскакивает и ложится рядом
      b.vx *= 0.25;
      b.vy *= 0.25;
      b.vz = Math.min(b.vz, 0);
    }
    if (b.z <= b.r + 1e-4 && b.vz === 0 && b.vx === 0 && b.vy === 0) break;
    if (quick && (hit || (can && b.y > can[1] + 0.6))) break;
  }
  if (frameDt > 0 && frames[frames.length - 1][0] < t) frames.push([t, b.x, b.y, b.z, b.a]);
  return { frames, hit, rest: [r3(b.x), r3(b.y), r3(b.a % (Math.PI * 2))], t };
}

const fcache = new Map<string, StickFlight>();
/** Полёт с кадрами (общий для комнаты, ботов и экрана), с кэшем. */
export function stickFlight(b0: Body, style: Style, can: [number, number] | null): StickFlight {
  const key = `${b0.x},${b0.y},${b0.z},${b0.vx},${b0.vy},${b0.vz},${style},${can?.join(',') ?? '-'}`;
  let f = fcache.get(key);
  if (!f) {
    f = flyStick(b0, style, can);
    if (fcache.size > 600) fcache.clear();
    fcache.set(key, f);
  }
  return f;
}

/** Куда отлетит сбитая банка: вдоль палки, тем дальше, чем сильнее удар. */
export function canFlight(hit: NonNullable<StickFlight['hit']>, can: [number, number]): { to: [number, number]; a: number } {
  const v = Math.max(0.1, hit.v);
  const dx = hit.vx / v;
  const dy = hit.vy / v;
  // попал краем — банка уходит вбок
  const off = (can[0] - hit.x) * dy - (can[1] - hit.y) * dx;
  const d = clamp(0.6 + v * 0.22, 0.8, 5);
  const ox = dx + dy * off * 2.5;
  const oy = dy - dx * off * 2.5;
  const ol = Math.hypot(ox, oy) || 1;
  return { to: [r3(can[0] + (ox / ol) * d), r3(can[1] + (oy / ol) * d)], a: r3(Math.atan2(ox, oy)) };
}

/** Пинок палки на жеребьёвке: с черты носком вперёд. */
export function kickBody(pow: number, who: number, slip = false): Body {
  const b = kick(body(0.15, 0.1, 0.12, STICK_R), 5 + 8 * clamp(pow, 0, 1), 0.04 * ((who % 3) - 1) + (slip ? 0.55 : 0), slip ? 0.3 : 0.55, 9);
  return { ...b, vx: r3(b.vx), vy: r3(b.vy), vz: r3(b.vz) };
}


/** Направление броска прямо на банку с места (x, y) — от него игрок отклоняет «рогаткой». */
export const yawTo = (c: Cfg, x: number, y: number) => Math.atan2(0 - (x + RELEASE.x), c.dist - (y + RELEASE.dy));
export const dist2 = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
