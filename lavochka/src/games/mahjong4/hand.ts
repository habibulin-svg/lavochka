/* Разбор руки маджонга без DOM: выигрышные разложения, шантен (сколько костей до готовности), ожидания.
 * Рука — счётчики по 34 видам (бонусные кости — цветы и сезоны — в руке не лежат). */
import { isHonor, isOrphan } from '../mahjong/tiles';

export type Counts = number[];

export const counts = (kinds: number[]): Counts => {
  const c = new Array(34).fill(0);
  for (const k of kinds) if (k < 34) c[k]++;
  return c;
};

/** Сет в разложении: 'chi' — ряд от k (k, k+1, k+2), 'pon' — три одинаковых, 'pair' — пара. */
export interface Part {
  t: 'chi' | 'pon' | 'pair';
  k: number;
}

/** Все разложения закрытой части на sets сетов и одну пару. */
export function decompose(c0: Counts, sets: number): Part[][] {
  const out: Part[][] = [];
  const c = c0.slice();
  const cur: Part[] = [];
  const rec = (i: number, setsLeft: number, pair: boolean) => {
    while (i < 34 && c[i] === 0) i++;
    if (i === 34) {
      if (setsLeft === 0 && pair) out.push(cur.slice());
      return;
    }
    if (c[i] >= 3 && setsLeft > 0) {
      c[i] -= 3;
      cur.push({ t: 'pon', k: i });
      rec(i, setsLeft - 1, pair);
      cur.pop();
      c[i] += 3;
    }
    if (!pair && c[i] >= 2) {
      c[i] -= 2;
      cur.push({ t: 'pair', k: i });
      rec(i, setsLeft, true);
      cur.pop();
      c[i] += 2;
    }
    if (setsLeft > 0 && i < 27 && i % 9 <= 6 && c[i + 1] > 0 && c[i + 2] > 0) {
      c[i]--;
      c[i + 1]--;
      c[i + 2]--;
      cur.push({ t: 'chi', k: i });
      rec(i, setsLeft - 1, pair);
      cur.pop();
      c[i]++;
      c[i + 1]++;
      c[i + 2]++;
    }
  };
  rec(0, sets, false);
  return out;
}

export function isSevenPairs(c: Counts): boolean {
  let pairs = 0;
  for (let i = 0; i < 34; i++) {
    if (c[i] === 2) pairs++;
    else if (c[i] !== 0) return false;
  }
  return pairs === 7;
}

const ORPHANS = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];
export function isThirteen(c: Counts): boolean {
  let pair = false;
  for (const k of ORPHANS) {
    if (c[k] === 0) return false;
    if (c[k] === 2) pair = true;
  }
  return pair && c.reduce((a, b) => a + b, 0) === 14;
}

// ---------------------------------------------------------------- шантен

/** Шантен обычной руки: −1 — готова (собрана), 0 — темпай. sets — сколько сетов нужно закрытой части. */
export function shantenNormal(c0: Counts, sets: number): number {
  const c = c0.slice();
  let best = 8;
  const rec = (i: number, m: number, p: number, pair: number) => {
    while (i < 34 && c[i] === 0) i++;
    if (i === 34) {
      const mm = Math.min(m, sets);
      const pp = Math.min(p, sets - mm);
      const s = 2 * (sets - mm) - pp - pair;
      if (s < best) best = s;
      return;
    }
    // оценка сверху: даже если всё оставшееся станет сетами — не лучше
    if (c[i] >= 3) {
      c[i] -= 3;
      rec(i, m + 1, p, pair);
      c[i] += 3;
    }
    if (i < 27 && i % 9 <= 6 && c[i + 1] && c[i + 2]) {
      c[i]--;
      c[i + 1]--;
      c[i + 2]--;
      rec(i, m + 1, p, pair);
      c[i]++;
      c[i + 1]++;
      c[i + 2]++;
    }
    if (c[i] >= 2) {
      c[i] -= 2;
      if (!pair) rec(i, m, p, 1);
      rec(i, m, p + 1, pair);
      c[i] += 2;
    }
    if (i < 27 && i % 9 <= 7 && c[i + 1]) {
      c[i]--;
      c[i + 1]--;
      rec(i, m, p + 1, pair);
      c[i]++;
      c[i + 1]++;
    }
    if (i < 27 && i % 9 <= 6 && c[i + 2]) {
      c[i]--;
      c[i + 2]--;
      rec(i, m, p + 1, pair);
      c[i]++;
      c[i + 2]++;
    }
    // кость в стороне
    const n = c[i];
    c[i] = 0;
    rec(i + 1, m, p, pair);
    c[i] = n;
  };
  rec(0, 0, 0, 0);
  return best;
}

export function shantenSeven(c: Counts): number {
  let pairs = 0;
  let kinds = 0;
  for (let i = 0; i < 34; i++)
    if (c[i] > 0) {
      kinds++;
      if (c[i] >= 2) pairs++;
    }
  return 6 - pairs + Math.max(0, 7 - kinds);
}

export function shantenThirteen(c: Counts): number {
  let kinds = 0;
  let pair = 0;
  for (const k of ORPHANS)
    if (c[k] > 0) {
      kinds++;
      if (c[k] >= 2) pair = 1;
    }
  return 13 - kinds - pair;
}

export interface HandRules {
  /** Сколько сетов нужно всего: 4 (13 костей) или 5 (16 костей). */
  sets: number;
  seven: boolean;
  thirteen: boolean;
}

/** Шантен с учётом особых рук; open — сколько сетов уже выложено. */
export function shanten(c: Counts, open: number, r: HandRules): number {
  let s = shantenNormal(c, r.sets - open);
  if (open === 0 && r.seven && r.sets === 4) s = Math.min(s, shantenSeven(c));
  if (open === 0 && r.thirteen && r.sets === 4) s = Math.min(s, shantenThirteen(c));
  return s;
}

/** Собрана ли рука (с выигрышной костью внутри c). */
export function isComplete(c: Counts, open: number, r: HandRules): boolean {
  if (decompose(c, r.sets - open).length) return true;
  if (open === 0 && r.sets === 4 && r.seven && isSevenPairs(c)) return true;
  if (open === 0 && r.sets === 4 && r.thirteen && isThirteen(c)) return true;
  return false;
}

/** Ожидания темпай-руки (13 костей закрытой части): какие виды собирают руку. */
export function waits(c: Counts, open: number, r: HandRules): number[] {
  const w: number[] = [];
  for (let k = 0; k < 34; k++) {
    if (c[k] >= 4) continue;
    c[k]++;
    if (isComplete(c, open, r)) w.push(k);
    c[k]--;
  }
  return w;
}

/** Виды, которые ещё может прийти: не больше 4 каждой. */
export function unseen(c: Counts, visible: Counts): number[] {
  return c.map((x, k) => Math.max(0, 4 - x - visible[k]));
}

export const honorOrTerminal = isOrphan;
export { isHonor };
