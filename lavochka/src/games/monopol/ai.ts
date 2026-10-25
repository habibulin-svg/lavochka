/* «Мо-но-пол» — боты. Решения по правилам большого пальца:
 *   покупка — если после неё остаётся запас (лёгкий — наугад); кредит на сберкнижке — когда денег мало, а свободные фирмы есть;
 *   долг — возвращают целиком, если есть с запасом, иначе платят процент; рулетку сложный и средний пропускают (игра честная);
 *   сложный перед ходом вкладывает банкноты в фирму, на которую соперники вероятнее всего встанут, а на «Рижском рынке»
 *   перекупает выгодные чужие фирмы; в подвале — самая денежная клетка, но так, чтобы успеть выйти. */
import type { Rng } from '../../core/types';
import { CELLAR_OUT, CELLAR_ROLLS, CELLAR_W, cellAt, FIRMS, next, PLUS } from './board';
import { cellarValue, firmsOf, legal, loanLimit, marketCost, rentOf, type Action, type State } from './engine';

const RESERVE = [100, 300, 400];

/** Насколько фирма хороша: плата с попавшего на рубль цены. */
const yieldOf = (loc: number) => 1 / (cellAt(loc).den ?? 10);

/** Вероятность, что соперники встанут на фирму следующим ходом (по одному броску каждого). */
function heat(s: State, seat: number, loc: number): number {
  let p = 0;
  for (let o = 0; o < s.n; o++) {
    if (o === seat || !s.alive[o] || s.where[o] !== 'board') continue;
    for (let d = 1; d <= 6; d++) {
      let l = s.loc[o];
      for (let i = 0; i < d; i++) l = next(l, d % 2 === 0);
      if (l === loc) p += 1 / 6;
    }
  }
  return p;
}

function cellarDistTo(from: number): number {
  const fr = Math.floor(from / CELLAR_W);
  const fc = from % CELLAR_W;
  return Math.abs(fr - CELLAR_OUT[0]) + Math.abs(fc - CELLAR_OUT[1]);
}

export function choose(s: State, seat: number, level: number, rng: Rng): Action | null {
  if (s.over || s.turn !== seat) return null;
  const acts = legal(s);
  if (!acts.length) return null;
  const cash = s.cash[seat];
  const reserve = RESERVE[Math.max(0, Math.min(2, level))];
  const pass: Action = { type: 'pass' };
  switch (s.phase) {
    case 'turn': {
      if (level >= 2 && cash > 1800) {
        let best = -1;
        let bv = 0.02;
        for (const l of firmsOf(s, seat)) {
          const v = heat(s, seat, l) * yieldOf(l);
          if (v > bv) {
            bv = v;
            best = l;
          }
        }
        if (best >= 0) return { type: 'invest', loc: best, amount: cash > 3000 ? 500 : 100 };
      }
      return { type: 'roll' };
    }
    case 'buy': {
      const l = s.loc[seat];
      const price = cellAt(l).price ?? 0;
      if (level <= 0) return rng.next() < 0.7 && cash >= price ? { type: 'buy', loc: l } : pass;
      return cash - price >= reserve ? { type: 'buy', loc: l } : pass;
    }
    case 'bank': {
      if (acts.some((a) => a.type === 'interest')) {
        const repay = acts.find((a) => a.type === 'repay');
        const loc = s.loc[seat];
        const debt = s.debt[seat][cellAt(loc).kind === 'mama' ? 1 : 0];
        return repay && cash - debt >= (level <= 0 ? 0 : 800) ? repay : { type: 'interest' };
      }
      const lim = loanLimit(s, seat);
      const free = FIRMS.some((f) => s.owner[f] < 0);
      const want = level <= 0 ? (rng.next() < 0.5 ? 500 : 0) : free && cash < 2500 ? (level >= 2 ? 2000 : 1000) : 0;
      const amount = Math.min(lim, want);
      return amount >= 100 ? { type: 'loan', amount: Math.floor(amount / 100) * 100 } : pass;
    }
    case 'roulette':
      if (level <= 0 && rng.next() < 0.4 && cash >= 100) return { type: 'bet', amount: 50, num: 1 + rng.int(6) };
      return pass;
    case 'pick': {
      // клетка на выбор: свободная выгодная фирма, которую по карману купить, иначе +500
      let best: number = PLUS[0];
      let bv = 0;
      for (const f of FIRMS)
        if (s.owner[f] < 0 && cash - (cellAt(f).price ?? 0) >= reserve) {
          const v = yieldOf(f) * (cellAt(f).price ?? 0);
          if (v > bv) {
            bv = v;
            best = f;
          }
        }
      return level <= 0 ? acts[rng.int(acts.length)] : { type: 'pick', loc: best };
    }
    case 'free':
    case 'market': {
      let best: Action = pass;
      let bv = 0;
      for (const a of acts) {
        if (a.type !== 'buy') continue;
        const cost = marketCost(s, a.loc);
        if (cash - cost < reserve) continue;
        const theirs = s.owner[a.loc] >= 0;
        if (theirs && level < 2) continue;
        // чужую перекупаем, если она приносит хозяину много
        const v = (cellAt(a.loc).price ?? 0) * yieldOf(a.loc) + (theirs ? rentOf(s, a.loc) * 2 : 0) - cost * 0.05;
        if (v > bv) {
          bv = v;
          best = a;
        }
      }
      return best;
    }
    case 'cellarGo': {
      if (level <= 0) return acts[rng.int(acts.length)];
      const left = CELLAR_ROLLS - s.rolls;
      let best = acts[0];
      let bv = -Infinity;
      for (const a of acts) {
        if (a.type !== 'go') continue;
        let v: number;
        if (a.cell < 0) v = left <= 1 ? 1000 : -50 * left;
        else {
          const need = cellarDistTo(a.cell) + 1;
          const risk = left === 0 ? 1 : need > 6 * left ? 1 : need > 3.5 * left ? 0.5 : need > 2 * left ? 0.15 : 0.02;
          v = cellarValue(a.cell) - risk * 500;
        }
        if (v > bv) {
          bv = v;
          best = a;
        }
      }
      return best;
    }
    default:
      return acts.find((a) => a.type === 'roll') ?? acts[0];
  }
}
