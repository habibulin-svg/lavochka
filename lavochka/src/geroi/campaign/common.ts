/* Общее для кампаний второй волны (CAMPAIGNS2.md): набросок прямоугольниками, Старшой, частые поражения. */
import type { HeroPick } from '../sim/heroes';
import type { Cond } from '../sim/adv/scenario';

export const HINT = 'Подсказка';
export const STARSHOY: HeroPick = { cls: 'kuznya-master', n: 0, lad: 'starshoy' };
/** У отрядов Старшого без города нет хозяйства. */
export const NOTHING = { semki: 0, wood: 0, stone: 0, amber: 0, salt: 0, stariron: 0, resin: 0 };

export const mainDead = (who: string): { text: string; cond: Cond } => ({ text: `${who} пал.`, cond: { t: 'heroDead', tag: 'main' } });
export const noTowns = (town: string): { text: string; cond: Cond } => ({ text: `${town} — потерян.`, cond: { t: 'noTowns' } });

/** Набросок по прямоугольникам: фон и поверх — [x, y, ширина, высота, символ] (в клетках наброска, позже — выше). Строки всегда одной длины. */
export function paint(w: number, h: number, base: string, rects: [number, number, number, number, string][]): string[] {
  const g = Array.from({ length: h }, () => Array<string>(w).fill(base));
  for (const [x, y, rw, rh, ch] of rects) {
    for (let yy = Math.max(0, y); yy < Math.min(h, y + rh); yy++) for (let xx = Math.max(0, x); xx < Math.min(w, x + rw); xx++) g[yy][xx] = ch;
  }
  return g.map((r) => r.join(''));
}
