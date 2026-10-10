/* Холдем — боты. Видят свои карты, общие карты, ставки и стеки.
 *   Лёгкий — играет «на глазок»: пара или старшие — дальше, иначе часто пасует, изредка блефует невпопад;
 *   Средний — оценивает шансы (розыгрыш наугад против соперников) и сравнивает с ценой колла;
 *   Сложный — больше розыгрышей, учитывает позицию и число соперников, ставит на силе, иногда полублефует. */
import type { Rng } from '../../core/types';
import type { Card, Suit } from '../../cards/deck';
import { category, evaluate, minRaiseTo, toCall, type Action, type State } from './engine';

const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
export const tuning = { fast: !!env?.VITEST && !env?.SIM_GAMES };

const SUITS: Suit[] = ['S', 'C', 'D', 'H'];

/** Сила стартовой руки по Чену (примерно −1…20). */
export function chen(h: Card[]): number {
  const [a, b] = h[0].r >= h[1].r ? [h[0], h[1]] : [h[1], h[0]];
  const base = (r: number) => (r === 14 ? 10 : r === 13 ? 8 : r === 12 ? 7 : r === 11 ? 6 : r / 2);
  let v = base(a.r);
  if (a.r === b.r) return Math.max(5, v * 2);
  if (a.s === b.s) v += 2;
  const gap = a.r - b.r - 1;
  v -= gap === 0 ? 0 : gap === 1 ? 1 : gap === 2 ? 2 : gap === 3 ? 4 : 5;
  if (gap <= 1 && a.r < 12) v += 1;
  return v;
}

/** Шансы выиграть против opp случайных рук (розыгрыш наугад). */
export function equity(hole: Card[], board: Card[], opp: number, samples: number, rng: Rng): number {
  const known = [...hole, ...board];
  const deck: Card[] = [];
  for (const s of SUITS) for (let r = 2; r <= 14; r++) if (!known.some((c) => c.s === s && c.r === r)) deck.push({ s, r });
  let win = 0;
  for (let k = 0; k < samples; k++) {
    // частичное перемешивание: берём нужное число карт
    const need = opp * 2 + (5 - board.length);
    const d = deck.slice();
    for (let i = 0; i < need; i++) {
      const j = i + rng.int(d.length - i);
      [d[i], d[j]] = [d[j], d[i]];
    }
    const extra = d.slice(opp * 2, need);
    const full = [...board, ...extra];
    const mine = evaluate([...hole, ...full]);
    let best = true;
    let tie = 0;
    for (let o = 0; o < opp; o++) {
      const v = evaluate([d[o * 2], d[o * 2 + 1], ...full]);
      if (v > mine) {
        best = false;
        break;
      }
      if (v === mine) tie++;
    }
    if (best) win += tie ? 1 / (tie + 1) : 1;
  }
  return win / samples;
}

export function choose(s: State, seat: number, level: number, rng: Rng): Action | null {
  if (s.phase === 'over' || s.turn !== seat) return null;
  const hole = s.hole[seat];
  const call = toCall(s, seat);
  const pot = s.inHand.reduce((a, x) => a + s.total[x], 0);
  const opp = s.inHand.filter((x) => x !== seat && !s.folded[x]).length;
  const stack = s.chips[seat];
  const canRaise = stack > call;
  const raise = (to: number): Action => {
    const max = s.bet[seat] + stack;
    const min = minRaiseTo(s);
    if (to >= max || min >= max) return { type: 'allin' };
    return { type: 'raise', to: Math.max(min, Math.round(to)) };
  };
  const passive = (): Action => (call > 0 ? { type: 'fold' } : { type: 'check' });
  const callOr = (): Action => (call > 0 ? { type: 'call' } : { type: 'check' });

  // сила руки
  let strength: number;
  if (!s.board.length && (level === 0 || !hole.length)) strength = (chen(hole) + 1) / 21;
  else if (!s.board.length) strength = Math.min(0.95, (chen(hole) + 1) / 21) * 0.6 + equity(hole, [], Math.min(opp, 4), tuning.fast ? 20 : 120, rng) * 0.4 * (1 + 0.15 * Math.max(0, opp - 1));
  else {
    const samples = level === 0 ? 0 : tuning.fast ? 25 : level === 1 ? 150 : 400;
    // лёгкий — по комбинации «на глазок», остальные — розыгрышем
    strength = samples ? equity(hole, s.board, Math.max(1, Math.min(opp, 5)), samples, rng) : [0.2, 0.45, 0.6, 0.7, 0.78, 0.82, 0.9, 0.95, 0.99][category(evaluate([...hole, ...s.board]))];
  }

  if (level === 0) {
    const r = rng.next();
    if (strength > 0.6 && canRaise && r < 0.4) return raise(s.current + s.big * 2);
    if (strength > 0.35 || call <= s.big / 2 || r < 0.1) return callOr();
    return passive();
  }
  // шансы банка: сколько надо выигрывать, чтобы колл окупался
  const odds = call > 0 ? call / (pot + call) : 0;
  const pos = level === 2 ? (seat === s.button ? 0.03 : 0) : 0;
  const eq = strength + pos;
  const bluff = level === 2 && !call && rng.next() < 0.08 && opp <= 2;
  if ((eq > 0.72 || (eq > 0.58 && opp <= 1)) && canRaise) {
    const size = pot * (level === 2 ? 0.5 + rng.next() * 0.5 : 0.66);
    return raise(s.current + Math.max(s.big, size));
  }
  if (bluff && canRaise) return raise(s.current + Math.max(s.big, pot * 0.5));
  if (call === 0) return { type: 'check' };
  if (eq >= odds + (level === 2 ? 0.02 : 0.06)) return { type: 'call' };
  return { type: 'fold' };
}
