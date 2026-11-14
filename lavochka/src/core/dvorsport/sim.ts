/* Дворовый спорт — общее для движков реального времени (без DOM: лапта, пекарь, чиж; их крутит комната, боты и тесты).
 *  - DS_SPEED_OPTION / dsSpeed — скорость игры: по умолчанию «как в жизни» (1). Аркадный SPEED_OPTION из core/realtime.ts
 *    замедлял всю физику вдвое — бег 6 м/с превращался в 3; здесь «помедленнее» — только выбор для новичков.
 *  - BODY — скорости и разгон пацанов: бег ~6,8 м/с, рывок быстрее, разгон и разворот быстрые (без «танка»).
 *  - drive(m, want, vmax, dt) — довести скорость до желаемой (и рывок), separate(тела) — мягко развести людей,
 *    чтобы не стояли друг в друге (капсула радиусом BODY.r), детерминированно, в шаге движка.
 *  - slowmo(s, сек, k) / dtScale(s) — замедление на ударе и ловле: шаг движка короче на заданное время (у всех одинаково).
 * Подключение: тело — { x, y, vx, vy, dash, cd } (как Man лапты), в шаге: drive(…) для каждого, потом separate(все тела),
 * dt шага = TICK × s.speed × dtScale(s). */
import type { OptionDef, Options } from '../types';

export const DS_SPEED_OPTION: OptionDef = {
  key: 'speed',
  label: 'Скорость игры',
  hint: 'как в жизни — по-настоящему; помедленнее — чтобы освоиться',
  type: 'select',
  choices: [
    { value: 1, label: 'как в жизни' },
    { value: 0.8, label: 'чуть медленнее' },
    { value: 0.6, label: 'медленно (для новичков)' },
  ],
  default: 1,
};

export const dsSpeed = (o: Options) => {
  const v = Number(o.speed ?? 1);
  return Number.isFinite(v) ? Math.max(0.4, Math.min(1, v)) : 1;
};

/** Пацаны: бег, рывок (во сколько раз, сколько длится, перезарядка), время разгона до полной скорости, радиус тела. */
export const BODY = { run: 6.8, dashK: 1.55, dashT: 0.4, dashCd: 1.3, accel: 0.08, r: 0.35 };

export interface Mover {
  x: number;
  y: number;
  vx: number;
  vy: number;
  dash: number;
  cd: number;
}

export interface Want {
  mx: number;
  my: number;
  dash?: boolean;
}

/** Довести скорость до желаемой (want — доли полной, длина ≤ 1): быстрый разгон и разворот, рывок — множитель. */
export function drive(m: Mover, w: Want, vmax: number, dt: number) {
  const l = Math.hypot(w.mx, w.my);
  const k0 = l > 1 ? 1 / l : 1;
  let vx = w.mx * k0 * vmax;
  let vy = w.my * k0 * vmax;
  if (m.dash > 0) (vx *= BODY.dashK), (vy *= BODY.dashK);
  // разворот на месте — сразу: при смене направления больше чем на 90° гасим старую скорость
  if (vx * m.vx + vy * m.vy < 0) (m.vx *= 0.3), (m.vy *= 0.3);
  const k = Math.min(1, dt / BODY.accel);
  m.vx += (vx - m.vx) * k;
  m.vy += (vy - m.vy) * k;
  m.x += m.vx * dt;
  m.y += m.vy * dt;
  m.dash = Math.max(0, m.dash - dt);
  m.cd = Math.max(0, m.cd - dt);
}

/** Начать рывок, если перезарядился. true — начат. */
export function dash(m: Mover): boolean {
  if (m.cd > 0) return false;
  m.dash = BODY.dashT;
  m.cd = BODY.dashCd;
  return true;
}

/** Мягко развести тела, стоящие ближе 2r: каждый сдвигается на половину перекрытия (за проход — до 3 раз).
 * Порядок обхода фиксирован — у комнаты и всех игроков одинаково. fixed(i) — кого не двигать (бьющий у дома). */
export function separate(bodies: { x: number; y: number }[], r = BODY.r, fixed?: (i: number) => boolean) {
  const d2 = 2 * r;
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    for (let i = 0; i < bodies.length; i++)
      for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i];
        const b = bodies[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        if (d >= d2) continue;
        // ровно в одной точке — разводим по номерам, не случайно
        if (d < 1e-6) (dx = ((i * 7 + j * 3) % 5) - 2 || 1), (dy = ((i * 3 + j * 5) % 5) - 2), (d = Math.hypot(dx, dy));
        const push = (d2 - d) / 2;
        const ux = dx / d;
        const uy = dy / d;
        const fa = fixed?.(i);
        const fb = fixed?.(j);
        if (fa && fb) continue;
        const ka = fa ? 0 : fb ? 2 : 1;
        const kb = fb ? 0 : fa ? 2 : 1;
        a.x -= ux * push * ka;
        a.y -= uy * push * ka;
        b.x += ux * push * kb;
        b.y += uy * push * kb;
        moved = true;
      }
    if (!moved) break;
  }
}

/** Замедление (на ударе, ловле): до какого времени партии и во сколько раз короче шаг. */
export interface Slow {
  slowUntil?: number;
  slowK?: number;
  t: number;
}
export function slowmo(s: Slow, sec: number, k = 0.35) {
  s.slowUntil = s.t + sec * k;
  s.slowK = k;
}
export const dtScale = (s: Slow) => (s.slowUntil != null && s.t < s.slowUntil ? (s.slowK ?? 1) : 1);

/** Дойти до места своим ходом (расход по местам, смена сторон): издалека бегом, у места шагом. Возвращает, сколько осталось. */
export function approach(m: { x: number; y: number; vx: number; vy: number }, x: number, y: number, dt: number, vmax = 8.5): number {
  const dx = x - m.x;
  const dy = y - m.y;
  const d = Math.hypot(dx, dy);
  if (d < 0.05 || dt <= 0) {
    if (d < 0.05) (m.x = x), (m.y = y), (m.vx = m.vy = 0);
    return d;
  }
  const v = Math.min(d / dt, Math.max(2.4, Math.min(vmax, d * 2.2)));
  m.vx = (dx / d) * v;
  m.vy = (dy / d) * v;
  m.x += m.vx * dt;
  m.y += m.vy * dt;
  return d - v * dt;
}

/** Расход по местам после смены: люди идут сами (а не «телепортом»), игра ждёт; потом — «приготовились» (readyT):
 * до этого времени движок не принимает удар/бросок (нажатие не пропадает), а боты не начинают отсчёт своего «подумать». */
export interface Settling {
  t: number;
  settle?: { until: number; to: ([number, number] | null)[] } | null;
  readyT?: number;
}
/** Сколько секунд «приготовились» после расхода по местам. */
export const READY = 0.9;
export function settleTo(s: Settling, to: ([number, number] | null)[], maxSec = 4.5) {
  s.settle = { until: s.t + maxSec, to };
}
/** Шаг расхода: true — ещё идут (движок ждёт). Дошли или вышло время — все ровно на местах, включается «приготовились». */
export function settling(s: Settling, men: { x: number; y: number; vx: number; vy: number }[], dt: number, vmax = 8.5): boolean {
  const st = s.settle;
  if (!st) return false;
  let far = false;
  men.forEach((m, i) => {
    const p = st.to[i];
    if (p && approach(m, p[0], p[1], dt, vmax) > 0.08) far = true;
  });
  if (far && s.t < st.until) return true;
  men.forEach((m, i) => {
    const p = st.to[i];
    if (p) (m.x = p[0]), (m.y = p[1]), (m.vx = m.vy = 0);
  });
  s.settle = null;
  s.readyT = s.t + READY;
  return false;
}
/** Можно действовать: расход закончен и «приготовились» прошло. */
export const isReady = (s: Settling) => !s.settle && s.t >= (s.readyT ?? 0);
