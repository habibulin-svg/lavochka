/* Вертушка — роза ветров со стрелкой, как в журнале «Пионер» (1989): восемь румбов, а между ними узкие цветные секторы —
 * жёлтый (штиль) и красный (ураган); всё остальное поле — «промежуточный» сектор, свежий ветер.
 * Стрелка останавливается на каком-то градусе: ближайший румб — откуда дует ветер, цвет под стрелкой — погода.
 * Доли секторов сняты со шаблона вертушки: на каждые 45° жёлтого ≈8°, красного ≈7°.
 * В бою та же вертушка: выпал основной румб (N, O, S, W) — попадание, четвертной (NO, SO, SW, NW) — промах. */
import { POINTS, type Point, type Weather, type Wind } from './wind';

export interface Spin extends Wind {
  /** Куда остановилась стрелка, градусы по часовой от норда (0..359). */
  angle: number;
  /** Основной румб (N, O, S, W) — в бою это попадание. */
  main: boolean;
}

/** Отклонение от ближайшего румба: −22..22. Жёлтый сектор — по часовой стрелке от румба, красный — против. */
export const CALM_FROM = 13;
export const CALM_TO = 20;
export const STORM_FROM = -20;
export const STORM_TO = -14;

export function spinAt(angle: number): Spin {
  const a = ((Math.round(angle) % 360) + 360) % 360;
  const r = Math.round(a / 45) % 8;
  let d = a - r * 45;
  if (d > 180) d -= 360;
  const weather: Weather = d >= CALM_FROM && d <= CALM_TO ? 'calm' : d >= STORM_FROM && d <= STORM_TO ? 'storm' : 'breeze';
  return { angle: a, from: POINTS[r], weather, main: r % 2 === 0 };
}

/** Крутим вертушку: rng.int(360) — градус, где стоит стрелка (показ правил подкручивает его). */
export const spin = (rng: { int(n: number): number }) => spinAt(rng.int(360));

/** Попадание в бою. */
export const hit = (s: Spin) => s.main;

/** Градус для нужного исхода — показ правил подкручивает вертушку. */
export function angleFor(from: Point, weather: Weather = 'breeze'): number {
  const base = POINTS.indexOf(from) * 45;
  const d = weather === 'calm' ? 16 : weather === 'storm' ? -17 : 0;
  return (base + d + 360) % 360;
}

export const SECTOR_NAMES: Record<Weather, string> = {
  calm: 'жёлтый сектор — штиль',
  breeze: 'промежуточный сектор — свежий ветер',
  storm: 'красный сектор — ураган',
};

export type { Point, Weather, Wind };
