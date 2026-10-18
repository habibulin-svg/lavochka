/* Быки и коровы: загадан код из разных цифр; по попыткам с ответами «быки» (цифра на своём месте)
 * и «коровы» (цифра есть, но не там) найти код. Генератор: попытки, пока подходящий код не останется один. Без DOM. */
import type { Rng } from '../../../core/types';

export interface BullsGuess {
  g: number[];
  b: number;
  c: number;
}

export interface BullsData {
  len: number;
  guesses: BullsGuess[];
}

/** Все коды из len разных цифр 0–9. */
function allCodes(len: number): number[][] {
  const out: number[][] = [];
  const cur: number[] = [];
  const used = new Array(10).fill(false);
  const go = () => {
    if (cur.length === len) return void out.push(cur.slice());
    for (let d = 0; d < 10; d++) {
      if (used[d]) continue;
      used[d] = true;
      cur.push(d);
      go();
      cur.pop();
      used[d] = false;
    }
  };
  go();
  return out;
}

const cache: Record<number, number[][]> = {};
const codes = (len: number) => (cache[len] ??= allCodes(len));

export function score(secret: number[], g: number[]): { b: number; c: number } {
  let b = 0;
  let c = 0;
  g.forEach((d, i) => {
    if (secret[i] === d) b++;
    else if (secret.includes(d)) c++;
  });
  return { b, c };
}

const fits = (code: number[], gs: BullsGuess[]) =>
  gs.every((q) => {
    const s = score(code, q.g);
    return s.b === q.b && s.c === q.c;
  });

export function candidates(d: BullsData): number[][] {
  return codes(d.len).filter((c) => fits(c, d.guesses));
}

export const solveBulls = (d: BullsData): number[] => candidates(d)[0] ?? [];

export function checkBulls(d: BullsData, a: unknown): boolean {
  if (!Array.isArray(a) || a.length !== d.len) return false;
  if (new Set(a).size !== d.len || a.some((x) => !Number.isInteger(x) || x < 0 || x > 9)) return false;
  return fits(a as number[], d.guesses);
}

/** Уровень: 0 — три цифры; 1 — четыре; 2 — четыре, но в попытках не больше двух угаданных цифр (рассуждать дольше). */
export function genBulls(level: number, rng: Rng): { data: BullsData; sol: number[] } {
  const len = level === 0 ? 3 : 4;
  const maxG = level === 0 ? 6 : level === 1 ? 7 : 9;
  const all = codes(len);
  for (let attempt = 0; attempt < 300; attempt++) {
    const secret = all[rng.int(all.length)];
    let cand = all;
    const guesses: BullsGuess[] = [];
    while (cand.length > 1 && guesses.length < maxG) {
      // из нескольких случайных попыток берём ту, что сильнее сужает (но не самую сильную — пусть будет над чем подумать)
      let best: { q: BullsGuess; rest: number[][] } | null = null;
      for (let t = 0; t < 12; t++) {
        const g = rng.next() < 0.5 && cand.length > 2 ? cand[rng.int(cand.length)] : all[rng.int(all.length)];
        if (g.every((x, i) => x === secret[i])) continue;
        const s = score(secret, g);
        if (level === 2 && s.b + s.c > 2) continue;
        if (guesses.some((q) => q.g.join() === g.join())) continue;
        const q = { g, ...s };
        const rest = cand.filter((c) => fits(c, [q]));
        if (rest.length === cand.length) continue;
        if (!best || rest.length < best.rest.length) best = { q, rest };
      }
      if (!best) break;
      guesses.push(best.q);
      cand = best.rest;
    }
    if (cand.length !== 1 || guesses.length < (level === 0 ? 3 : 4)) continue;
    return { data: { len, guesses }, sol: secret.slice() };
  }
  throw new Error('быки и коровы: не сложилось');
}
