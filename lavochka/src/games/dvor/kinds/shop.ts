/* Магазин (уравнения по картинкам): играют «в магазин» — у каждого товара своя цена в копейках. Даны покупки и их
 * стоимость; сколько стоит то, что спрашивают? Генератор: цены, покупки по 2–3 товара, пока ответ не станет
 * однозначным (перебор всех цен). Без DOM. */
import type { Rng } from '../../../core/types';
import { shuffle } from '../../../core/rng';

export const GOODS = [
  { icon: '🍦', name: 'пломбир' },
  { icon: '🍬', name: 'ириска' },
  { icon: '🥤', name: '«Буратино»' },
  { icon: '🍭', name: 'петушок на палочке' },
  { icon: '🍞', name: 'батон' },
  { icon: '🥛', name: 'молоко' },
  { icon: '🧃', name: 'берёзовый сок' },
  { icon: '🍪', name: 'печенье' },
];

export interface ShopData {
  /** Номера товаров из GOODS. */
  goods: number[];
  /** Покупка: сколько каждого товара (по goods) — и сумма. */
  buys: { n: number[]; sum: number }[];
  /** Что спрашивают: сколько каждого. */
  ask: number[];
}

const price = (n: number[], v: number[]) => n.reduce((t, k, i) => t + k * v[i], 0);

/** Все наборы цен 1…max, подходящие к покупкам. */
function fitting(d: ShopData, max: number): number[][] {
  const out: number[][] = [];
  const v = new Array(d.goods.length).fill(0);
  const go = (i: number) => {
    if (i === v.length) {
      if (d.buys.every((b) => price(b.n, v) === b.sum)) out.push(v.slice());
      return;
    }
    for (let x = 1; x <= max; x++) {
      v[i] = x;
      // отсечение: покупки, где все товары уже оценены, должны сойтись
      if (d.buys.every((b) => b.n.some((k, j) => k && j > i) || price(b.n, v) === b.sum)) go(i + 1);
    }
  };
  go(0);
  return out;
}

const MAX = 30;

/** Товар, цена которого по покупкам однозначна (для подсказки). */
export function shopKnown(d: ShopData): { i: number; v: number } | null {
  const f = fitting(d, MAX);
  if (!f.length) return null;
  for (let i = 0; i < d.goods.length; i++) if (!d.ask[i] && f.every((x) => x[i] === f[0][i])) return { i, v: f[0][i] };
  for (let i = 0; i < d.goods.length; i++) if (f.every((x) => x[i] === f[0][i])) return { i, v: f[0][i] };
  return null;
}

export function solveShop(d: ShopData): number {
  const f = fitting(d, MAX);
  return f.length ? price(d.ask, f[0]) : 0;
}

/** Уровень: 0 — 2 товара; 1 — 3 товара; 2 — 4 товара, спрашивают сразу набор. */
export function genShop(level: number, rng: Rng): { data: ShopData; sol: number } {
  const n = level + 2;
  for (let attempt = 0; attempt < 300; attempt++) {
    const goods = shuffle([...GOODS.keys()], rng).slice(0, n);
    const v = goods.map(() => 2 + rng.int(level === 0 ? 12 : 20));
    if (new Set(v).size < n) continue;
    const ask = level < 2 ? goods.map((_, i) => (i === n - 1 ? 1 : 0)) : goods.map(() => rng.int(3));
    if (ask.every((x) => !x)) continue;
    const d: ShopData = { goods, buys: [], ask };
    for (let t = 0; t < 12 && d.buys.length < n + 2; t++) {
      const k = goods.map(() => (rng.next() < 0.6 ? 1 + rng.int(level === 0 ? 2 : 3) : 0));
      const used = k.filter(Boolean).length;
      if (used < 2 || used > 3) continue;
      if (d.buys.some((b) => b.n.join() === k.join())) continue;
      d.buys.push({ n: k, sum: price(k, v) });
      const f = fitting(d, MAX);
      if (new Set(f.map((x) => price(ask, x))).size === 1) {
        // ответ однозначен; на лёгкой — проверим, что покупки не выдают его прямо
        if (d.buys.some((b) => b.n.join() === ask.join())) break;
        return { data: d, sol: price(ask, v) };
      }
    }
  }
  throw new Error('магазин: не сложилось');
}
