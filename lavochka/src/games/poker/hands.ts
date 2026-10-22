/* Покер — оценка рук для всех видов (без DOM). Сила — число: старше — больше (для «низких» видов — меньше значит лучше,
 * но наружу отдаём уже «чем больше, тем лучше», чтобы делёж банка был одинаковым).
 *   high — старшая комбинация из любых пяти;
 *   highSD — Short Deck (колода с шестёрки): флеш старше фулл-хауса, A-6-7-8-9 — младший стрит;
 *   omahaHigh — ровно две свои + три общие;
 *   low27 — «двойка-семёрка»: туз старший, стриты и флеши считаются против, лучшая 7-5-4-3-2;
 *   lowA5 — «туз-пятёрка»: туз младший, стриты и флеши не считаются, лучшая 5-4-3-2-A (разз, лоу в хай-лоу);
 *   low8 — лоу «8 или лучше»: пять разных до восьмёрки, иначе нет лоу;
 *   badugi — четыре карты разных мастей и достоинств (туз младший): больше карт лучше, затем младше. */
import type { Card, Suit } from '../../cards/deck';

const SUITS: Suit[] = ['S', 'C', 'D', 'H'];
export const HIGH_NAMES = ['старшая карта', 'пара', 'две пары', 'сет', 'стрит', 'флеш', 'фулл-хаус', 'каре', 'стрит-флеш'];

function combos<T>(a: T[], k: number): T[][] {
  const out: T[][] = [];
  const rec = (s: number, acc: T[]) => {
    if (acc.length === k) return void out.push(acc.slice());
    for (let i = s; i <= a.length - (k - acc.length); i++) {
      acc.push(a[i]);
      rec(i + 1, acc);
      acc.pop();
    }
  };
  rec(0, []);
  return out;
}

const pack = (cat: number, ks: number[]) => {
  let v = cat;
  for (let i = 0; i < 5; i++) v = v * 15 + (ks[i] ?? 0);
  return v;
};
export const highCat = (v: number) => Math.floor(v / 15 ** 5);

/** Пятёрка: категория и кикеры; wheel — считать ли A-2-3-4-5 стритом (в Short Deck — A-6-7-8-9, а флеш старше фулл-хауса). */
function five(cards: Card[], wheel: boolean, sd = false): number {
  const rs = cards.map((c) => c.r).sort((a, b) => b - a);
  const flush = cards.every((c) => c.s === cards[0].s);
  const u = [...new Set(rs)];
  let st = 0;
  if (u.length === 5) {
    if (u[0] - u[4] === 4) st = u[0];
    else if (wheel && u[0] === 14 && (sd ? u[1] === 9 && u[4] === 6 : u[1] === 5)) st = sd ? 9 : 5;
  }
  if (st && flush) return pack(8, [st]);
  const cnt = new Map<number, number>();
  for (const r of rs) cnt.set(r, (cnt.get(r) ?? 0) + 1);
  const g = [...cnt.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const ord = g.flatMap(([r, n]) => Array(n).fill(r) as number[]);
  if (g[0][1] === 4) return pack(7, [g[0][0], g[1][0]]);
  if (g[0][1] === 3 && g[1][1] === 2) return pack(sd ? 5 : 6, [g[0][0], g[1][0]]);
  if (flush) return pack(sd ? 6 : 5, rs);
  if (st) return pack(4, [st]);
  if (g[0][1] === 3) return pack(3, [g[0][0], ...ord.slice(3)]);
  if (g[0][1] === 2 && g[1][1] === 2) return pack(2, [g[0][0], g[1][0], g[2][0]]);
  if (g[0][1] === 2) return pack(1, [g[0][0], ...ord.slice(2)]);
  return pack(0, rs);
}

/** Лучшая старшая пятёрка из 5–7 карт. */
export function high(cards: Card[]): number {
  if (cards.length <= 5) return cards.length === 5 ? five(cards, true) : partialHigh(cards);
  let best = -1;
  for (const c of combos(cards, 5)) best = Math.max(best, five(c, true));
  return best;
}

/** Лучшая пятёрка Short Deck из 5–8 карт. */
export function highSD(cards: Card[]): number {
  if (cards.length < 5) return partialHigh(cards);
  let best = -1;
  for (const c of combos(cards, 5)) best = Math.max(best, five(c, true, true));
  return best;
}

/** Название старшей комбинации (в Short Deck категории флеша и фулл-хауса переставлены). */
export function highName(v: number, sd = false): string {
  const c = highCat(v);
  return HIGH_NAMES[sd && c === 5 ? 6 : sd && c === 6 ? 5 : c] ?? '';
}

/** Меньше пяти карт (стад до раздачи всех, показ в дороге): пары и кикеры. */
function partialHigh(cards: Card[]): number {
  const cnt = new Map<number, number>();
  for (const c of cards) cnt.set(c.r, (cnt.get(c.r) ?? 0) + 1);
  const g = [...cnt.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const ord = g.flatMap(([r, n]) => Array(n).fill(r) as number[]);
  const cat = g[0]?.[1] === 4 ? 7 : g[0]?.[1] === 3 ? 3 : g[0]?.[1] === 2 && g[1]?.[1] === 2 ? 2 : g[0]?.[1] === 2 ? 1 : 0;
  return pack(cat, ord);
}

export function omahaHigh(hole: Card[], board: Card[]): number {
  let best = -1;
  for (const h of combos(hole, 2)) for (const b of combos(board, 3)) best = Math.max(best, five([...h, ...b], true));
  return best;
}

/** Двойка-семёрка: чем меньше старшая оценка без «колеса», тем лучше → отдаём со знаком минус. */
export function low27(cards: Card[]): number {
  let best = Infinity;
  for (const c of cards.length > 5 ? combos(cards, 5) : [cards]) best = Math.min(best, five(c, false));
  return -best;
}

/** Туз-пятёрка: пары плохо, стриты/флеши не считаются, туз = 1. */
function lowA5Five(cards: Card[]): number {
  const rs = cards.map((c) => (c.r === 14 ? 1 : c.r));
  const cnt = new Map<number, number>();
  for (const r of rs) cnt.set(r, (cnt.get(r) ?? 0) + 1);
  const g = [...cnt.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const cat = g[0][1] === 4 ? 6 : g[0][1] === 3 && g[1]?.[1] === 2 ? 5 : g[0][1] === 3 ? 3 : g[0][1] === 2 && g[1]?.[1] === 2 ? 2 : g[0][1] === 2 ? 1 : 0;
  // внутри категории: сначала сгруппированные (старше — хуже), потом остальные по убыванию
  const ord = g.flatMap(([r, n]) => Array(n).fill(r) as number[]);
  return pack(cat, cat ? ord : rs.slice().sort((a, b) => b - a));
}

export function lowA5(cards: Card[]): number {
  let best = Infinity;
  for (const c of cards.length > 5 ? combos(cards, 5) : [cards]) best = Math.min(best, lowA5Five(c));
  return -best;
}

/** Лоу «8 или лучше»: пять разных достоинств не старше восьмёрки; нет — null. omaha — ровно две свои + три общие. */
export function low8(cards: Card[], omaha?: { hole: Card[]; board: Card[] }): number | null {
  const sets = omaha ? combos(omaha.hole, 2).flatMap((h) => combos(omaha.board, 3).map((b) => [...h, ...b])) : cards.length > 5 ? combos(cards, 5) : [cards];
  let best = Infinity;
  for (const c of sets) {
    const rs = c.map((x) => (x.r === 14 ? 1 : x.r));
    if (new Set(rs).size !== 5 || Math.max(...rs) > 8) continue;
    best = Math.min(best, pack(0, rs.sort((a, b) => b - a)));
  }
  return best === Infinity ? null : -best;
}

/** Бадуги: из до четырёх карт (или лучших четырёх из пяти) — больше карт разных мастей и достоинств лучше, затем младше. */
export function badugi(cards: Card[]): number {
  let best = -Infinity;
  const n = Math.min(4, cards.length);
  for (let k = n; k >= 1; k--) {
    for (const c of combos(cards, k)) {
      const rs = c.map((x) => (x.r === 14 ? 1 : x.r));
      if (new Set(rs).size !== k || new Set(c.map((x) => x.s)).size !== k) continue;
      const v = k * 15 ** 5 - pack(0, rs.sort((a, b) => b - a)) / 15;
      best = Math.max(best, v);
    }
    if (best > -Infinity) return best;
  }
  return best;
}

/** Сколько карт в лучшем бадуги (для подписи). */
export function badugiSize(cards: Card[]): number {
  return Math.floor(badugi(cards) / 15 ** 5 + 0.9999);
}

/** Колода: 52 карты или короткая с шестёрки (36, Short Deck). */
export const allCards = (short = false): Card[] => SUITS.flatMap((s) => Array.from({ length: 13 }, (_, i) => ({ s, r: i + 2 }))).filter((c) => !short || c.r >= 6);

export { combos };
