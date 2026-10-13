/* Вертушка: она и ветер показывает, и в бою решает, попадание или промах.
 * Секторы погоды на вертушке (жёлтый, голубые, красные) делим по восьми румбам:
 * два румба дают штиль, четыре — свежий ветер, два — ураган. Точного деления оригинала
 * по картинке не восстановить, поэтому взято ровное и записано как допущение.
 * Для стрельбы правила «Пиратов» говорят: выпал основной румб — промах, значит попадание
 * приходится на четвертные румбы, то есть на четыре из восьми.
 */
import { POINTS, type Point, type Weather, type Wind } from './wind';

export type Sector = 'calm' | 'breeze' | 'storm';

/** Погода по номеру сектора 0..7 (порядок — как на вертушке). */
export const SECTORS: Sector[] = ['breeze', 'calm', 'breeze', 'storm', 'breeze', 'calm', 'breeze', 'storm'];

export interface Spin extends Wind {
  /** Номер сектора 0..7 — чтобы показать вращение стрелки. */
  sector: number;
  /** Основной румб или четвертной: основные дают промах в бою. */
  main: boolean;
}

/** Крутим вертушку: случайный сектор, он же задаёт румб ветра и погоду. */
export function spin(rng: () => number): Spin {
  const sector = Math.min(7, Math.floor(rng() * 8));
  const from = POINTS[sector];
  return { sector, from, weather: SECTORS[sector], main: sector % 2 === 0 };
}

/** Попадание в бою: четвертные румбы бьют, основные дают промах. */
export const hit = (s: Spin) => !s.main;

/** Вертушка для боя — в «Пиратах» она отдельная от ветра. */
export function spinShot(rng: () => number): { sector: number; hit: boolean } {
  const sector = Math.min(7, Math.floor(rng() * 8));
  return { sector, hit: sector % 2 !== 0 };
}

/** Подписи для показа: сектор вертушки словами. */
export const SECTOR_NAMES: Record<Sector, string> = {
  calm: 'жёлтый сектор — штиль',
  breeze: 'голубой сектор — свежий ветер',
  storm: 'красный сектор — ураган',
};

export type { Point, Weather, Wind };
