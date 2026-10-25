/* «Акционеры» — боты. Победа — капитал в собственности, поэтому покупка фирмы и предприятия переводит наличные в очки один к одному;
 * весь вопрос — сколько держать на руках, чтобы не разориться на чужих предприятиях.
 * Лёгкий решает почти наугад и строит редко. Средний покупает и строит, оставляя твёрдый запас, берёт кредиты, страхуется при деньгах.
 * Сложный держит запас по самой дорогой чужой прибыли на поле, строит там, где прибыль на вложенный рубль выше, выкупает заложенное,
 * играет на бирже (ожидание выгодно), учится в школе бизнеса, когда есть собственность, и не берёт теневых денег с карточкой фининспектора.
 * Бот видит то же, что и человек: скрытого в «Акционерах» нет. */
import type { Rng } from '../../core/types';
import { CELLS, CLUB, FIRM_CELLS, START, inBig } from './data';
import { aucNextBid, buyPrice, canBuild, entCost, firmOf, lapLimit, owned, priceOf, profitOf, valueOf, type Action, type Ask, type State } from './engine';

const pick = (a: Ask, id: string): Action => ({ type: 'choose', id: a.opts.some((o) => o.id === id) ? id : (a.opts.find((o) => o.main)?.id ?? a.opts[0].id) });

/** Самая большая прибыль, которую можно заплатить на чужих фирмах сейчас. */
function danger(s: State, seat: number): number {
  let m = 0;
  for (const c of FIRM_CELLS) {
    const o = s.owner[c];
    if (o == null || o === seat || s.out[o] || s.mort[c]) continue;
    m = Math.max(m, profitOf(s, c));
  }
  return m;
}

function reserve(s: State, seat: number, level: number): number {
  if (level === 0) return 50000;
  if (level === 1) return 300000;
  const big = inBig(s.pos[seat]) || s.pos[seat] === CLUB;
  return big ? Math.min(3000000, Math.max(200000, danger(s, seat) * 0.6)) : 150000;
}

/** Где выгоднее строить: прибыль следующего предприятия на рубль стоимости. */
function bestBuild(s: State, seat: number, level: number, rng: Rng): number | null {
  const can = owned(s, seat).filter((c) => canBuild(s, seat, c));
  if (!can.length) return null;
  const res = reserve(s, seat, level);
  const ok = can.filter((c) => s.cash[seat] - entCost(s, c) >= res);
  if (!ok.length) return null;
  if (level === 0) return rng.next() < 0.3 ? ok[rng.int(ok.length)] : null;
  if (level === 1) return ok[0];
  const gain = (c: number) => firmOf(c).profit[s.ent[c]] / entCost(s, c);
  return ok.sort((a, b) => gain(b) - gain(a))[0];
}

export function choose(s: State, seat: number, level: number, rng: Rng): Action | null {
  const r = () => rng.next();
  if (s.result) return null;
  // перед ходом: постройки и выкуп
  if (s.turn === seat && (s.phase === 'roll' || s.ask?.kind === 'route') && !s.auc) {
    const b = bestBuild(s, seat, level, rng);
    if (b != null) return { type: 'build', cell: b };
    if (level === 2) {
      const res = reserve(s, seat, level);
      const m = owned(s, seat).find((c) => s.mort[c] && s.cash[seat] - valueOf(s, c) >= res * 2);
      if (m != null) return { type: 'redeem', cell: m };
    }
  }
  if (s.phase === 'move') return s.turn === seat ? { type: 'move' } : null;
  if (s.phase === 'roll') return s.turn === seat ? { type: 'roll' } : null;
  const a = s.ask;
  if (!a || a.seat !== seat) return null;
  const cash = s.cash[seat];
  const res = reserve(s, seat, level);

  switch (a.kind) {
    case 'route': {
      if (level === 0) return pick(a, a.opts[rng.int(a.opts.length)].id);
      if (s.pos[seat] === START) {
        // ещё круг малого бизнеса — пока денег мало для большого
        const enough = level === 1 ? 1200000 : 2500000;
        const again = s.laps[seat] < lapLimit(s);
        return pick(a, again && cash < enough ? 'again' : 'fly');
      }
      const poor = level === 1 ? cash < 400000 : cash < 900000 && owned(s, seat).every((c) => s.ent[c] === 3 || s.mort[c] || cash < entCost(s, c));
      return pick(a, poor ? 'small' : 'big');
    }
    case 'buy': {
      const price = buyPrice(s, seat, a.cell);
      if (level === 0) return pick(a, r() < 0.7 ? 'yes' : 'no');
      return pick(a, cash - price >= (level === 2 ? Math.min(res, cash * 0.4) : res * 0.5) ? 'yes' : 'no');
    }
    case 'auction': {
      const need = a.price ?? aucNextBid(s.auc!);
      if (s.auc?.charity) {
        if (level === 0) return pick(a, r() < 0.15 && cash > need * 5 ? 'bid' : 'pass');
        const max = level === 1 ? 100000 : Math.min(250000, cash * 0.1);
        return pick(a, need <= max && cash - need >= res ? 'bid' : 'pass');
      }
      const price = priceOf(s, a.cell);
      const k = level === 0 ? 1 + r() * 0.2 : level === 1 ? 1.2 : 1.5;
      return pick(a, need <= price * k && cash - need >= res * 0.5 ? 'bid' : 'pass');
    }
    case 'credit':
      if (level === 0) return pick(a, r() < 0.6 ? 'take' : 'no');
      return pick(a, 'take');
    case 'shadow':
      if (level === 0) return pick(a, r() < 0.5 ? 'take' : 'no');
      if (level === 1) return pick(a, s.shadow[seat] === 0 && s.courts[seat] === 0 ? 'take' : 'no');
      return pick(a, !s.inspector[seat] && s.courts[seat] === 0 ? 'take' : 'no');
    case 'school': {
      const fee = CELLS[a.cell].n!;
      if (level === 0) return pick(a, r() < 0.4 ? 'yes' : 'no');
      if (level === 1) return pick(a, cash - fee >= 600000 ? 'yes' : 'no');
      return pick(a, cash - fee >= 300000 && (owned(s, seat).length > 0 || cash > 1500000) ? 'yes' : 'no');
    }
    case 'insure': {
      const fee = CELLS[a.cell].n!;
      if (level === 0) return pick(a, r() < 0.3 ? 'yes' : 'no');
      return pick(a, cash - fee >= (level === 1 ? 700000 : 400000) ? 'yes' : 'no');
    }
    case 'charityOr': {
      if (level === 0) return pick(a, a.opts[rng.int(a.opts.length)].id);
      const sums = a.opts.filter((o) => o.id !== 'card').map((o) => Number(o.id));
      if (level === 1) return pick(a, sums.length && cash > 600000 ? String(sums[0]) : 'card');
      const want = sums.filter((v) => cash - v >= Math.max(res, 800000));
      return pick(a, want.length ? String(want[Math.min(1, want.length - 1)]) : 'card');
    }
    case 'playExchange':
      // при равных шансах ×3 и ÷3 ожидание выгодно
      if (level === 0) return pick(a, r() < 0.5 ? 'yes' : 'no');
      if (level === 1) return pick(a, cash < 400000 ? 'yes' : 'no');
      return pick(a, 'yes');
    case 'mecenat':
      if (level === 0) return pick(a, r() < 0.3 ? 'yes' : 'no');
      if (level === 1) return pick(a, 'no');
      return pick(a, cash > 1200000 ? 'yes' : 'no');
  }
  return pick(a, a.opts[0].id);
}
