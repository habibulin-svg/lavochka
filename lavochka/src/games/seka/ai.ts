/* Сека — боты. Сила руки — доля случайных рук, которые она бьёт (таблица по очкам считается один раз на правила). */
import type { Rng } from '../../core/types';
import { makeDeck } from '../../cards/deck';
import { joinFee, owe, raiseTo, score, type Action, type Cfg, type View } from './engine';

const tables = new Map<string, number[]>();

/** Доля случайных рук с очками меньше s (ничья — пополам). */
function beats(cfg: Cfg, s: number): number {
  const key = `${cfg.deck}${cfg.joker}${cfg.sevens}`;
  let t = tables.get(key);
  if (!t) {
    // перебор всех рук из колоды: на 36 картах — 7140 рук, один раз
    const d = makeDeck(cfg.deck);
    const cnt = new Array(40).fill(0);
    let n = 0;
    for (let i = 0; i < d.length; i++) for (let j = i + 1; j < d.length; j++) for (let k = j + 1; k < d.length; k++) cnt[score(cfg, [d[i], d[j], d[k]])]++, n++;
    t = [];
    let acc = 0;
    for (let x = 0; x < 40; x++) {
      t.push((acc + cnt[x] / 2) / n);
      acc += cnt[x];
    }
    tables.set(key, t);
  }
  return t[Math.min(39, s)];
}

export function choose(v: View, seat: number, level: number, rng: Rng): Action | null {
  if (v.over || v.turn !== seat) return null;
  if (v.phase === 'join') {
    const fee = joinFee(v);
    return { type: 'join', yes: v.money[seat] >= fee * 3 && rng.next() < (level === 2 ? 0.35 : 0.45) };
  }
  const c = owe(v, seat);
  const ups = raiseTo(v, seat);
  if (!v.seen[seat]) {
    // втёмную: сложный иногда доставляет не глядя, пока ставки маленькие
    if (level === 2 && !v.acted.includes(seat) && c <= v.cfg.ante * 2 && rng.next() < 0.5) return { type: 'call' };
    return { type: 'look' };
  }
  const sc = score(v.cfg, v.hands[seat]);
  const k = v.live.length - 1;
  const eq = Math.pow(beats(v.cfg, sc), k);
  const raise = (big: boolean): Action => ({ type: 'raise', to: big ? ups[ups.length - 1] : ups[0] });
  if (level === 0) {
    if (ups.length && sc >= 27 && rng.next() < 0.6) return raise(false);
    if (c === 0) return { type: 'call' };
    return sc >= 20 || rng.next() < 0.3 ? { type: 'call' } : { type: 'fold' };
  }
  const bluff = level === 2 && rng.next() < 0.08;
  if (ups.length && (eq > (level === 2 ? 0.62 : 0.7) || bluff)) return raise(level === 2 && eq > 0.85);
  if (c === 0) return { type: 'call' };
  // шансы банка: доставить, если ожидание не хуже
  const margin = level === 2 ? 1 : 1.25;
  return eq * (v.pot + c) >= c * margin ? { type: 'call' } : { type: 'fold' };
}
