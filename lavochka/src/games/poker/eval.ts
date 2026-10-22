/* Покер — быстрая оценка старших рук для ботов и расчётов (без перебора пятёрок). Число то же, что у hands.high/highSD:
 * можно сравнивать с ними напрямую (тест сверяет на случайных руках). Классы стартовых рук холдема (169: «AKs», «T9o», «77»). */
import type { Card } from '../../cards/deck';
import { high, highSD, pack } from './hands';

const SI: Record<string, number> = { S: 0, C: 1, D: 2, H: 3 };

const cnt = new Int8Array(15);
const sm = [0, 0, 0, 0];
const sc = [0, 0, 0, 0];

function straightTop(mask: number, sd: boolean): number {
  for (let t = 14; t >= 6; t--) if (((mask >> (t - 4)) & 31) === 31) return t;
  if (sd) return (mask & 0b100001111000000) === 0b100001111000000 ? 9 : 0;
  return (mask & 0b100000000111100) === 0b100000000111100 ? 5 : 0;
}

function topRanks(mask: number, n: number, skip1 = 0, skip2 = 0): number[] {
  const out: number[] = [];
  for (let r = 14; r >= 2 && out.length < n; r--) if (mask & (1 << r) && r !== skip1 && r !== skip2) out.push(r);
  return out;
}

/** Лучшая старшая комбинация из 5–7 карт (sd — правила Short Deck). */
export function fastHigh(cs: Card[], sd = false): number {
  if (cs.length < 5) return sd ? highSD(cs) : high(cs);
  cnt.fill(0);
  sm[0] = sm[1] = sm[2] = sm[3] = 0;
  sc[0] = sc[1] = sc[2] = sc[3] = 0;
  let mask = 0;
  for (const c of cs) {
    cnt[c.r]++;
    mask |= 1 << c.r;
    const s = SI[c.s];
    sm[s] |= 1 << c.r;
    sc[s]++;
  }
  let fs = -1;
  for (let s = 0; s < 4; s++) if (sc[s] >= 5) fs = s;
  if (fs >= 0) {
    const sf = straightTop(sm[fs], sd);
    if (sf) return pack(8, [sf]);
  }
  let quad = 0;
  const trips: number[] = [];
  const pairs: number[] = [];
  for (let r = 14; r >= 2; r--) {
    if (cnt[r] === 4) quad = quad || r;
    else if (cnt[r] === 3) trips.push(r);
    else if (cnt[r] === 2) pairs.push(r);
  }
  if (quad) return pack(7, [quad, topRanks(mask, 1, quad)[0] ?? 0]);
  let best = -1;
  if (trips.length && (trips.length > 1 || pairs.length)) best = pack(sd ? 5 : 6, [trips[0], Math.max(trips[1] ?? 0, pairs[0] ?? 0)]);
  if (fs >= 0) best = Math.max(best, pack(sd ? 6 : 5, topRanks(sm[fs], 5)));
  if (best >= 0 && !sd) return best;
  const st = straightTop(mask, sd);
  if (st) best = Math.max(best, pack(sd ? 3 : 4, [st]));
  // в Short Deck сет старше стрита
  if (trips.length) best = Math.max(best, pack(sd ? 4 : 3, [trips[0], ...topRanks(mask, 2, trips[0])]));
  if (best >= 0) return best;
  if (pairs.length >= 2) return pack(2, [pairs[0], pairs[1], topRanks(mask, 1, pairs[0], pairs[1])[0] ?? 0]);
  if (pairs.length) return pack(1, [pairs[0], ...topRanks(mask, 3, pairs[0])]);
  return pack(0, topRanks(mask, 5));
}

/** Омаха: ровно две свои + три общие. */
export function fastOmaha(hole: Card[], board: Card[]): number {
  let best = -1;
  const five: Card[] = [null!, null!, null!, null!, null!];
  for (let a = 0; a < hole.length; a++)
    for (let b = a + 1; b < hole.length; b++) {
      five[0] = hole[a];
      five[1] = hole[b];
      for (let i = 0; i < board.length; i++)
        for (let j = i + 1; j < board.length; j++)
          for (let k = j + 1; k < board.length; k++) {
            five[2] = board[i];
            five[3] = board[j];
            five[4] = board[k];
            const v = fastHigh(five);
            if (v > best) best = v;
          }
    }
  return best;
}

/** Лоу «8 или лучше» из любых карт (стад хай-лоу): пять младших разных достоинств до восьмёрки; как hands.low8. */
export function fastLow8(cs: Card[]): number | null {
  const rs = [...new Set(cs.map((c) => (c.r === 14 ? 1 : c.r)).filter((r) => r <= 8))].sort((a, b) => a - b);
  if (rs.length < 5) return null;
  return -pack(0, rs.slice(0, 5).reverse());
}

/** Омаха хай-лоу: лоу «8 или лучше» из двух своих и трёх общих (то же число, что hands.low8; нет лоу — null). */
export function fastLow8Omaha(hole: Card[], board: Card[]): number | null {
  const lr = (c: Card) => (c.r === 14 ? 1 : c.r);
  const b = [...new Set(board.map(lr).filter((r) => r <= 8))];
  if (b.length < 3) return null;
  const h = [...new Set(hole.map(lr).filter((r) => r <= 8))];
  let best = Infinity;
  for (let i = 0; i < h.length; i++)
    for (let j = i + 1; j < h.length; j++)
      for (let x = 0; x < b.length; x++)
        for (let y = x + 1; y < b.length; y++)
          for (let z = y + 1; z < b.length; z++) {
            const rs = [h[i], h[j], b[x], b[y], b[z]];
            if (new Set(rs).size < 5) continue;
            rs.sort((p, q) => q - p);
            const v = pack(0, rs);
            if (v < best) best = v;
          }
  return best === Infinity ? null : -best;
}

// ---------------------------------------------------------------- классы стартовых рук холдема

const RN = '23456789TJQKA';
const rc = (r: number) => RN[r - 2];

/** Все 169 классов: пары, одномастные, разномастные. */
export const CLASSES: string[] = (() => {
  const out: string[] = [];
  for (let a = 14; a >= 2; a--)
    for (let b = a; b >= 2; b--) {
      if (a === b) out.push(rc(a) + rc(b));
      else out.push(rc(a) + rc(b) + 's', rc(a) + rc(b) + 'o');
    }
  return out;
})();
const CI = new Map(CLASSES.map((c, i) => [c, i]));

/** Класс двух карт: «AKs», «72o», «TT». */
export function classOf(a: Card, b: Card): string {
  const [h, l] = a.r >= b.r ? [a, b] : [b, a];
  if (h.r === l.r) return rc(h.r) + rc(l.r);
  return rc(h.r) + rc(l.r) + (h.s === l.s ? 's' : 'o');
}
export const classIndex = (a: Card, b: Card) => CI.get(classOf(a, b))!;
export const classIdx = (label: string) => CI.get(label) ?? -1;
/** Сколько сочетаний в классе: пара 6, одномастные 4, разномастные 12. */
export const classCombos = (label: string) => (label.length === 2 ? 6 : label[2] === 's' ? 4 : 12);
