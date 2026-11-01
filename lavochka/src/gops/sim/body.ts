/* Тело в мире ГОПС: круг против маски ландшафта. Всё в Q8 (1/256 px), скорость — Q8 за кадр (60 Гц).
 * Движение — подшагами не длиннее пикселя, чтобы быстрый снаряд не проскакивал тонкую стенку.
 * При касании — откат на последнее свободное место, отражение скорости по нормали земли (упругость + трение вдоль). */
import { ONE, TRIG_ONE, len, toPx, trunc } from './fx';
import type { Mask } from './mask';

/** Ускорение свободного падения, Q8 за кадр². */
export const GRAVITY = 38;
/** Ниже этой скорости по нормали удар не отскакивает, а гасится. */
const STICK = 64;

export interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Радиус, пиксели. */
  r: number;
  /** Доля нормальной скорости после отскока, из 256 (0 — не прыгает, 256 — без потерь). */
  bounce: number;
  /** Доля касательной скорости после удара, из 256. */
  slide: number;
}

export interface Hit {
  /** Нормаль земли, Q14 (единичная). */
  nx: number;
  ny: number;
  /** Скорость удара по нормали, Q8 за кадр (≥ 0). */
  speed: number;
}

/** Свободен ли круг тела, если поставить его центр в (x, y) Q8. */
export function free(mask: Mask, x: number, y: number, r: number): boolean {
  return !mask.hitsCircle(toPx(x + ONE / 2), toPx(y + ONE / 2), r);
}

/** Единичная нормаль земли около тела (Q14) или null, если земли рядом нет. */
export function groundNormal(mask: Mask, x: number, y: number, r: number): [number, number] | null {
  const [sx, sy] = mask.normal(toPx(x + ONE / 2), toPx(y + ONE / 2), r + 1);
  const l = len(sx, sy);
  if (l === 0) return null;
  return [trunc((sx * TRIG_ONE) / l), trunc((sy * TRIG_ONE) / l)];
}

/**
 * Один кадр полёта: гравитация, ветер (ускорение Q8 за кадр² по x), движение с подшагами.
 * Возвращает первый удар за кадр (после него тело стоит в точке касания с уже отражённой скоростью) или null.
 */
export function stepBody(b: Body, mask: Mask, gravity = GRAVITY, wind = 0): Hit | null {
  b.vy += gravity;
  b.vx += wind;
  const steps = (Math.max(Math.abs(b.vx), Math.abs(b.vy)) >> 8) + 1;
  // остаток от деления раскладываем по подшагам, чтобы за кадр пройти ровно v
  let px = b.x, py = b.y;
  for (let i = 1; i <= steps; i++) {
    const nx = b.x + trunc((b.vx * i) / steps);
    const ny = b.y + trunc((b.vy * i) / steps);
    if (!free(mask, nx, ny, b.r)) {
      b.x = px;
      b.y = py;
      return bounceOff(b, mask);
    }
    px = nx;
    py = ny;
  }
  b.x = px;
  b.y = py;
  return null;
}

/** Отражение скорости от земли в текущей точке. */
function bounceOff(b: Body, mask: Mask): Hit {
  const n = groundNormal(mask, b.x, b.y, b.r);
  if (!n) {
    // упёрлись в угол без внятной нормали — просто гасим
    const speed = len(b.vx, b.vy);
    b.vx = 0;
    b.vy = 0;
    return { nx: 0, ny: -TRIG_ONE, speed };
  }
  const [nx, ny] = n;
  // vn — проекция скорости на нормаль (отрицательная — летим в землю)
  const vn = trunc((b.vx * nx + b.vy * ny) / TRIG_ONE);
  const speed = Math.max(0, -vn);
  // разложение: v = vn·n + vt
  const tx = b.vx - trunc((vn * nx) / TRIG_ONE);
  const ty = b.vy - trunc((vn * ny) / TRIG_ONE);
  const keepN = speed < STICK ? 0 : trunc((speed * b.bounce) / 256);
  b.vx = trunc((tx * b.slide) / 256) + trunc((keepN * nx) / TRIG_ONE);
  b.vy = trunc((ty * b.slide) / 256) + trunc((keepN * ny) / TRIG_ONE);
  return { nx, ny, speed };
}

/** Тело почти не движется и стоит на земле (нормаль смотрит вверх). */
export function resting(b: Body, mask: Mask): boolean {
  if (Math.abs(b.vx) > STICK || Math.abs(b.vy) > STICK) return false;
  if (free(mask, b.x, b.y + ONE, b.r)) return false;
  const n = groundNormal(mask, b.x, b.y, b.r);
  return !!n && n[1] < -TRIG_ONE / 2;
}
