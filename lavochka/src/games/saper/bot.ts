/* «Сапёр» — боты. Видят то же, что человек: открытые числа и флажки (чужим флажкам не верят — выводят мины сами).
 * Лёгкий — только простые выводы по одному числу и угадывает наугад; средний — ещё и по парам чисел;
 * сложный — плюс общий счёт мин, а угадывает там, где мина вероятнее всего не лежит (в охоте — наоборот). */
import type { Rng } from '../../core/types';
import { boardOf, nbrOf, type Action, type State } from './engine';
import { deduceAll, probs } from './solver';

/** Как часто бот что-то делает за ход в «одному/вместе» и «наперегонки» (остальное — «думает»). */
const PACE = [0.3, 0.55, 0.85];
const LOGIC = [0, 1, 2];

export function choose(v: State, seat: number, level: number, rng: Rng): Action {
  const L = Math.max(0, Math.min(2, level));
  const c = v.cfg;
  const flags = c.mode === 'flags';
  if (!flags && rng.next() >= PACE[L]) return { type: 'think' };
  const b = v.boards[boardOf(v, seat)];
  const n = c.w * c.h;
  if (b.st === 'new') {
    // первый щелчок — поближе к середине
    const x = Math.floor(c.w / 2) + rng.int(3) - 1;
    const y = Math.floor(c.h / 2) + rng.int(3) - 1;
    return { type: 'open', i: y * c.w + x };
  }
  const nbr = nbrOf(c);
  // в охоте найденные мины открыты, но для вывода это известные мины, а не числа
  const open = b.open.map((o, i) => o && b.owner[i] < 0);
  const known = b.owner.map((x) => x >= 0);
  const d = deduceAll(nbr, open, b.num, known, LOGIC[L], c.m);
  const hiddenUnknown: number[] = [];
  for (let i = 0; i < n; i++) if (!b.open[i] && !d.mine[i]) hiddenUnknown.push(i);

  if (flags) {
    const sure = d.mine.map((m, i) => (m && !b.open[i] ? i : -1)).filter((i) => i >= 0);
    if (sure.length) return { type: 'open', i: sure[rng.int(sure.length)] };
    if (!hiddenUnknown.length) return { type: 'think' };
    if (L === 0) return { type: 'open', i: hiddenUnknown[rng.int(hiddenUnknown.length)] };
    const p = probs(nbr, open, b.num, d.mine, c.m);
    const best = Math.max(...hiddenUnknown.map((i) => p.get(i) ?? 0));
    const pick = hiddenUnknown.filter((i) => (p.get(i) ?? 0) >= best - (L === 1 ? 0.15 : 1e-9));
    return { type: 'open', i: pick[rng.int(pick.length)] };
  }

  // лишний флажок на точно пустой клетке — снять
  const safe = d.safe;
  if (safe.length) {
    const i = safe[rng.int(safe.length)];
    return b.mark[i] === 1 ? { type: 'mark', i, m: 0 } : { type: 'open', i };
  }
  // лёгкий и средний ставят флажки на найденные мины — как человек
  if (L < 2) {
    const toFlag = d.mine.map((m, i) => (m && !b.open[i] && b.mark[i] !== 1 ? i : -1)).filter((i) => i >= 0);
    if (toFlag.length && rng.next() < 0.6) return { type: 'mark', i: toFlag[rng.int(toFlag.length)], m: 1 };
  }
  // вывести нечего — угадывать. Вместе с людьми бот угадывает неохотно: пусть рискнёт человек
  if (c.mode === 'solo' && v.seats.length > 1 && rng.next() > 0.12) return { type: 'think' };
  const cand = hiddenUnknown.filter((i) => b.mark[i] !== 1);
  if (!cand.length) {
    const any = hiddenUnknown[0];
    return any != null ? { type: 'mark', i: any, m: 0 } : { type: 'think' };
  }
  if (L === 0) return { type: 'open', i: cand[rng.int(cand.length)] };
  const p = probs(nbr, open, b.num, d.mine, c.m);
  if (L === 1) {
    // средний: подальше от чисел (вглубь), если есть куда
    const inner = cand.filter((i) => !nbr[i].some((j) => b.open[j]));
    const pool = inner.length ? inner : cand;
    return { type: 'open', i: pool[rng.int(pool.length)] };
  }
  const low = Math.min(...cand.map((i) => p.get(i) ?? 1));
  const pick = cand.filter((i) => (p.get(i) ?? 1) <= low + 1e-9);
  return { type: 'open', i: pick[rng.int(pick.length)] };
}
