/* Баккара — боты. Шуз из шести колод, карты открыты всем — бот видит то же, что человек.
 *   Лёгкий — ставит наугад (иногда и на ничью), сумму — наугад; в шмен де фер на 5 и в свободных клетках — монетка;
 *   Средний — ставит на Банкира понемногу (у Банкира чуть больше шансов), на 5 берёт, банк держит до удвоения;
 *   Сложный — в свободных клетках считает шансы по оставшемуся шузу, ставку подстраивает под счёт партии:
 *             отстаёт под конец — рискует, ведёт — ставит по минимуму. */
import type { Rng } from '../../core/types';
import { bankChoices, bankerDraws, betRange, MIN_BET, total, uncovered, val, type Action, type View } from './engine';

const round10 = (n: number) => Math.max(MIN_BET, Math.round(n / 10) * 10);

/** Насколько выгоднее взять карту, чем стоять (для понтёра — шанс выиграть минус проиграть). */
function drawEdge(v: View, who: 'P' | 'B', rng: Rng): number {
  // по бесконечному шузу: карта — 0 с вероятностью 4/13, остальные по 1/13
  const cardVal = () => {
    const r = rng.int(13);
    return r >= 9 ? 0 : r + 1;
  };
  const trials = 600;
  let draw = 0;
  let stand = 0;
  for (let t = 0; t < trials; t++) {
    if (who === 'P') {
      // понтёр на 5: что сделает банкир дальше — по таблице пунто банко
      const p = total(v.player);
      const b = total(v.banker);
      const outcome = (pt: number, p3: number | null) => {
        let bt = b;
        if (bankerDraws(b, p3)) bt = (bt + cardVal()) % 10;
        return Math.sign(pt - bt);
      };
      const c = cardVal();
      draw += outcome((p + c) % 10, c);
      stand += outcome(p, null);
    } else {
      // банкир в свободной клетке: двух карт понтёра не знаем — перебираем подходящие
      const b = total(v.banker);
      const p3 = v.player.length === 3 ? val(v.player[2]) : null;
      let pt: number;
      for (;;) {
        const two = (cardVal() + cardVal()) % 10;
        if (two >= 8) continue;
        if (p3 == null ? two >= 5 : two <= 5) {
          pt = p3 == null ? two : (two + p3) % 10;
          break;
        }
      }
      const c = cardVal();
      draw += Math.sign((b + c) % 10 - pt);
      stand += Math.sign(b - pt);
    }
  }
  return (draw - stand) / trials;
}

export function choose(v: View, seat: number, level: number, rng: Rng): Action | null {
  if (v.over || v.turn !== seat) return null;
  const pb = v.cfg.mode === 'pb';
  const money = v.money[seat];
  const leader = Math.max(...v.seats.filter((x) => x !== seat).map((x) => v.money[x] + (x === v.bankSeat ? v.bank : 0)), 0);
  const left = v.cfg.coups - v.coup;
  switch (v.phase) {
    case 'open': {
      const ch = bankChoices(v, seat);
      if (level === 0) return { type: 'bank', n: ch[rng.int(ch.length)] };
      return { type: 'bank', n: ch[Math.min(ch.length - 1, level === 2 && money < leader && left < 6 ? ch.length - 1 : 1)] };
    }
    case 'bet': {
      const [lo, hi] = betRange(v, seat);
      if (hi < MIN_BET) return { type: 'skip' };
      if (!pb && level > 0 && uncovered(v) <= money && (rng.next() < 0.15 || (level === 2 && money < leader && left < 4))) return { type: 'banco' };
      let n: number;
      let side: 'P' | 'B' | 'T' = pb ? 'B' : 'P';
      if (level === 0) {
        n = round10(lo + rng.next() * Math.min(hi - lo, money * 0.2));
        if (pb) side = (['P', 'B', 'T'] as const)[rng.next() < 0.12 ? 2 : rng.int(2)];
      } else if (level === 1) n = round10(money * 0.05);
      else {
        const behind = leader - money;
        // отстаёт и сдач мало — ставит крупно (банко-стиль), ведёт — по минимуму
        if (behind > 0 && left <= 4) n = round10(Math.min(money, behind / Math.max(1, left) + MIN_BET));
        else if (behind < -200) n = MIN_BET;
        else n = round10(money * 0.04);
      }
      return { type: 'bet', side, n: Math.max(lo, Math.min(hi, n)) };
    }
    case 'punter':
      if (level === 0) return { type: rng.next() < 0.5 ? 'draw' : 'stand' };
      if (level === 1) return { type: 'draw' };
      return { type: drawEdge(v, 'P', rng) >= 0 ? 'draw' : 'stand' };
    case 'banker':
      if (level === 0) return { type: rng.next() < 0.5 ? 'draw' : 'stand' };
      if (level === 1) return { type: total(v.banker) <= 4 ? 'draw' : 'stand' };
      return { type: drawEdge(v, 'B', rng) >= 0 ? 'draw' : 'stand' };
    case 'keep': {
      if (level === 0) return { type: rng.next() < 0.5 ? 'keep' : 'pass' };
      const x = v.bank / Math.max(1, v.bankStart);
      if (level === 1) return { type: x < 2 ? 'keep' : 'pass' };
      // ведёт — забирает выигрыш; отстаёт — держит
      return { type: money + v.bank >= leader && x >= 2 ? 'pass' : 'keep' };
    }
  }
  return null;
}
