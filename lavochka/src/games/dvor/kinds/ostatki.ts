/* Остатки (китайская теорема по-дворовому): ребята делятся на команды — по 3, по 4, по 5… — и каждый раз кто-то
 * остаётся лишним. Сколько всего ребят, если известно, что их меньше стольких-то? Ответ единственный. Без DOM. */
import type { Rng } from '../../../core/types';
import { shuffle } from '../../../core/rng';

export interface OstatkiData {
  /** Делились на команды по m — лишних r. */
  splits: { m: number; r: number }[];
  /** Ребят больше lo и меньше hi. */
  lo: number;
  hi: number;
  /** Чем делятся (повод): «команды», «пары», «тройки»… — текст строится в поле. */
  what: string;
}

export const fitsAll = (d: OstatkiData, x: number) => d.splits.every((s) => x % s.m === s.r);

export function solveOstatki(d: OstatkiData): number {
  for (let x = d.lo + 1; x < d.hi; x++) if (fitsAll(d, x)) return x;
  return 0;
}

const WHAT = ['команды для вышибал', 'команды для «вышибал»', 'команды для футбола', 'звенья для «Зарницы»'];

/** Уровень: 0 — два деления, ответ до 40; 1 — три деления, до 70; 2 — три-четыре деления, до 130. */
export function genOstatki(level: number, rng: Rng): { data: OstatkiData; sol: number } {
  const hi0 = [40, 70, 130][level];
  const k = level === 0 ? 2 : level === 1 ? 3 : 3 + rng.int(2);
  for (let attempt = 0; attempt < 500; attempt++) {
    const x = 8 + rng.int(hi0 - 10);
    const ms = shuffle([2, 3, 4, 5, 6, 7, 8, 9], rng).slice(0, k).sort((a, b) => a - b);
    const splits = ms.map((m) => ({ m, r: x % m }));
    // хотя бы в одном делении кто-то лишний и не во всех одинаково — иначе слишком просто
    if (splits.every((s) => s.r === 0)) continue;
    if (level > 0 && new Set(splits.map((s) => s.r)).size === 1) continue;
    const lo = level === 0 ? 5 : Math.max(5, x - 30 - rng.int(20));
    const hi = hi0;
    const d: OstatkiData = { splits, lo, hi, what: WHAT[rng.int(WHAT.length)] };
    let n = 0;
    for (let y = lo + 1; y < hi; y++) if (fitsAll(d, y)) n++;
    if (n !== 1) continue;
    return { data: d, sol: x };
  }
  throw new Error('остатки: не сложилось');
}
