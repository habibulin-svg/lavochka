/* Боец ГОПС: ходьба по склону (подъём до CLIMB px на шаг), прыжок вперёд и сальто назад, полёт как тело,
 * урон от удара о землю, вылет в жидкость. Состояние — целые (Q8), шаг — кадр 60 Гц. */
import { type Body, GRAVITY, free, groundNormal, resting, stepBody } from './body';
import { ONE, TRIG_ONE, toPx } from './fx';
import type { Mask } from './mask';

export const WORM_R = 9;
/** Скорость ходьбы, Q8 за кадр (~0,6 px). */
export const WALK = 150;
/** Подъём и спуск за один пиксель шага без отрыва от земли. */
export const CLIMB = 6;
/** Прыжок вперёд и сальто назад: [vx, vy] Q8 за кадр. */
export const JUMP: readonly [number, number] = [380, -900];
export const FLIP: readonly [number, number] = [-160, -1350];
/** Удар о землю быстрее SAFE (Q8 за кадр) ранит: (speed − SAFE) / FALL_DIV хп. */
const SAFE = 1500;
const FALL_DIV = 40;

/** rope — висит на верёвке, fly — летит «за пацанов!» (физику того и другого ведёт world.ts). */
export type WormState = 'stand' | 'air' | 'rope' | 'fly' | 'dead';

export interface Worm extends Body {
  id: number;
  team: number;
  hp: number;
  facing: 1 | -1;
  state: WormState;
  /** Накопленный дробный шаг ходьбы, Q8. */
  stride: number;
  /** Кадров подряд «в воздухе», но почти без движения и с землёй под ногами (зажат в углу). */
  stuck: number;
  /** Заморожен: сколько ходов ещё не берёт урон и толчки. */
  frozen: number;
}

export function makeWorm(id: number, team: number, xPx: number, yPx: number, hp = 100): Worm {
  return { id, team, hp, x: xPx * ONE, y: yPx * ONE, vx: 0, vy: 0, r: WORM_R, bounce: 0, slide: 0, facing: 1, state: 'air', stride: 0, stuck: 0, frozen: 0 };
}

/** Что случилось с бойцом за кадр. */
export interface WormEvent {
  kind: 'land' | 'fall-damage' | 'drown' | 'blocked';
  id: number;
  value?: number;
}

/**
 * Шаг ходьбы в сторону dir (стоящий боец). Поднимается на ступеньку до CLIMB px, спускается так же;
 * если под ногами обрыв — срывается в полёт.
 */
export function walk(w: Worm, mask: Mask, dir: 1 | -1, out: WormEvent[]): void {
  if (w.state !== 'stand') return;
  w.facing = dir;
  w.stride += WALK;
  while (w.stride >= ONE) {
    w.stride -= ONE;
    const nx = w.x + dir * ONE;
    let ny = -1;
    for (let lift = 0; lift <= CLIMB; lift++) {
      if (free(mask, nx, w.y - lift * ONE, w.r)) {
        ny = w.y - lift * ONE;
        break;
      }
    }
    if (ny < 0) {
      w.stride = 0;
      out.push({ kind: 'blocked', id: w.id });
      return;
    }
    let drop = 0;
    while (drop <= CLIMB && free(mask, nx, ny + ONE, w.r)) {
      ny += ONE;
      drop++;
    }
    w.x = nx;
    w.y = ny;
    if (drop > CLIMB) {
      // обрыв: шаг сделан, дальше — полёт
      w.state = 'air';
      w.vx = dir * WALK;
      w.vy = 0;
      w.stride = 0;
      return;
    }
  }
}

export function jump(w: Worm, back = false): void {
  if (w.state !== 'stand') return;
  const [jx, jy] = back ? FLIP : JUMP;
  w.vx = jx * w.facing;
  w.vy = jy;
  w.state = 'air';
}

/** Кадр бойца: полёт, приземление, вылет в жидкость (waterY — верх жидкости, px). */
export function tickWorm(w: Worm, mask: Mask, waterY: number, out: WormEvent[], gravity = GRAVITY): void {
  if (w.state === 'dead' || w.state === 'rope' || w.state === 'fly') return;
  if (toPx(w.y) - w.r > waterY) {
    w.state = 'dead';
    w.hp = 0;
    out.push({ kind: 'drown', id: w.id });
    return;
  }
  if (w.state === 'stand') {
    // земля могла исчезнуть от взрыва
    if (free(mask, w.x, w.y + ONE, w.r)) w.state = 'air';
    else return;
  }
  const x0 = w.x, y0 = w.y;
  const hit = stepBody(w, mask, gravity);
  if (!hit) {
    w.stuck = 0;
    return;
  }
  if (hit.speed > SAFE) {
    const dmg = Math.trunc((hit.speed - SAFE) / FALL_DIV);
    if (dmg > 0) {
      w.hp = Math.max(0, w.hp - dmg);
      out.push({ kind: 'fall-damage', id: w.id, value: dmg });
    }
  }
  // на крутом склоне не стоим — съезжаем дальше; зажатый в углу (не едет, а земля под ногами) — встаёт
  const n = groundNormal(mask, w.x, w.y, w.r);
  const still = Math.abs(w.x - x0) + Math.abs(w.y - y0) < ONE / 2;
  w.stuck = still ? w.stuck + 1 : 0;
  if ((n && n[1] < -TRIG_ONE / 2 && resting(w, mask)) || w.stuck > 8) {
    w.vx = 0;
    w.vy = 0;
    w.stuck = 0;
    w.state = 'stand';
    out.push({ kind: 'land', id: w.id });
  } else if (n) {
    // соскальзывание вдоль склона
    w.vx += Math.trunc((n[0] * GRAVITY) / TRIG_ONE);
  }
}
