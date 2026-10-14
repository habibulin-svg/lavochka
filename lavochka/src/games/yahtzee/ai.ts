/* Яхтзи, Генерал, Покер на костях — боты.
 *   Лёгкий — держит самые частые кости, пишет в графу с наибольшими очками прямо сейчас;
 *   Средний — перебирает, какие кости отложить, и оценивает исход прикидкой на десятке бросков; пишет с поправкой на верхний бонус;
 *   Сложный — то же, прикидка точнее (60 бросков на вариант), бережёт шанс и яхтзи, жертвует нулём в слабые графы.
 * В покере на костях: бросает, пока рука не лучше лучшей на столе (или пока есть броски), держит пары/тройки/стрит. */
import type { Rng } from '../../core/types';
import { catScore, cmpRank, counts, options, pokerRank, UPPER, type Action, type Cat, type State } from './engine';

/** Сколько «стоит» записать очки в графу с учётом того, что графа сгорает. */
function value(s: State, seat: number, cat: Cat, pts: number, level: number): number {
  if (level === 0) return pts;
  const v = s.cfg.variant;
  const up = UPPER.indexOf(cat);
  let w = pts;
  if (up >= 0 && v === 'yahtzee') {
    // к бонусу: норма — три кости номинала
    const par = (up + 1) * 3;
    w += (pts - par) * 0.6;
  }
  // ожидаемая ценность графы в будущем — чем дороже графа, тем жальче писать в неё мало
  const typical: Partial<Record<Cat, number>> =
    v === 'yahtzee'
      ? { three: 15, four: 8, full: 14, small: 18, large: 14, yahtzee: 12, chance: 22 }
      : { straight: 9, full: 12, poker: 8, generala: 6, double: 2 };
  if (typical[cat] != null) w -= typical[cat]! * (level === 2 ? 0.9 : 0.6);
  else w -= (up + 1) * (level === 2 ? 2.1 : 1.5);
  return w;
}

function bestScore(s: State, seat: number, level: number): { cat: Cat; w: number } {
  let best = { cat: options(s, seat)[0].cat, w: -Infinity };
  for (const o of options(s, seat)) {
    const w = value(s, seat, o.cat, o.pts, level);
    if (w > best.w) best = { cat: o.cat, w };
  }
  return best;
}

/** Оценка табличной игры для костей d с rolls бросками впереди: лучший вес записи. */
function evalDice(s: State, seat: number, d: number[], rollsDone: number, level: number): number {
  const t = { ...s, dice: d, rolls: rollsDone } as State;
  return bestScore(t, seat, level).w;
}

function rollWith(d: number[], hold: boolean[], rng: Rng) {
  return d.map((x, i) => (hold[i] ? x : 1 + rng.int(6)));
}

/** Все 32 варианта отложить кости. */
const HOLDS: boolean[][] = Array.from({ length: 32 }, (_, m) => [0, 1, 2, 3, 4].map((i) => !!(m & (1 << i))));

function chooseHold(s: State, seat: number, level: number, rng: Rng): boolean[] | null {
  const samples = level === 2 ? 60 : 12;
  const now = evalDice(s, seat, s.dice, s.rolls, level);
  let best: { hold: boolean[] | null; w: number } = { hold: null, w: now };
  for (const hold of HOLDS) {
    if (hold.every(Boolean)) continue;
    let acc = 0;
    for (let k = 0; k < samples; k++) acc += evalDice(s, seat, rollWith(s.dice, hold, rng), s.rolls + 1, level);
    const w = acc / samples;
    if (w > best.w + 0.5) best = { hold, w };
  }
  return best.hold;
}

/** Лёгкий: держит самое частое достоинство. */
function simpleHold(d: number[]): boolean[] {
  const c = counts(d);
  let top = 6;
  for (let v = 6; v >= 1; v--) if (c[v] > c[top]) top = v;
  return d.map((x) => x === top);
}

/** Покер: держим то, что составляет комбинацию (пары, тройки, стрит). */
function pokerHold(d: number[]): boolean[] {
  const r = pokerRank(d)[0];
  if (r === 4 || r === 5 || r === 6 || r === 8) return d.map(() => true);
  const c = counts(d);
  return d.map((x) => c[x] >= 2);
}

export function choose(s: State, seat: number, level: number, rng: Rng): Action | null {
  if (s.over || s.turn !== seat) return null;
  if (s.rolls === 0) return { type: 'roll' };
  if (s.cfg.variant === 'poker') {
    // лучшая рука на столе в этом коне
    let best: number[] | null = null;
    for (const p of s.seats) if (s.hands[p] && (!best || cmpRank(pokerRank(s.hands[p]!), best) > 0)) best = pokerRank(s.hands[p]!);
    const mine = pokerRank(s.dice);
    const ahead = best ? cmpRank(mine, best) > 0 : mine[0] >= (level === 0 ? 2 : 3);
    if (s.rolls >= 3 || ahead) return { type: 'stand' };
    const hold = level === 0 ? simpleHold(s.dice) : pokerHold(s.dice);
    if (hold.every(Boolean)) return { type: 'stand' };
    return { type: 'roll', hold };
  }
  if (s.rolls < 3) {
    if (level === 0) {
      const now = Math.max(...options(s, seat).map((o) => o.pts));
      if (now >= 25 && rng.next() < 0.7) return { type: 'score', cat: bestScore(s, seat, 0).cat };
      const hold = simpleHold(s.dice);
      if (!hold.every(Boolean)) return { type: 'roll', hold };
      return { type: 'score', cat: bestScore(s, seat, 0).cat };
    }
    const hold = chooseHold(s, seat, level, rng);
    if (hold) return { type: 'roll', hold };
  }
  return { type: 'score', cat: bestScore(s, seat, level).cat };
}

/** Очки, если записать прямо сейчас (для подсказки бота и показа). */
export const scoreNow = (s: State, cat: Cat) => catScore(cat, s.dice, s.cfg.variant === 'generala' ? 'generala' : 'yahtzee', s.rolls === 1);
