/* Покер (2D) — боты. Видят свои карты, открытые карты стада, общие карты, ставки.
 * Шансы считают розыгрышем наугад: неизвестные карты соперников и будущие карты (общие, улицы стада, обмены — по тем же
 * правилам обмена, что у самих ботов) раскладываются случайно, банк делится как на вскрытии (с хай-лоу).
 *   Лёгкий — мало розыгрышей и шум, часто «посмотреть»;
 *   Средний — сравнивает шансы с ценой колла, ставит с сильной;
 *   Сложный — больше розыгрышей, полублеф и ставка «на стоп» в лимите. */
import type { Rng } from '../../core/types';
import type { Card } from '../../cards/deck';
import { allCards, badugi, combos, high, highSD } from './hands';
import { contenders, GAMES, info, potSize, raiseRange, toCall, values, type Action, type State, type View } from './engine';

const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
const fast = !!env?.VITEST && !env?.SIM_GAMES;

const key = (c: Card) => c.s + c.r;

/** Какие карты сменить (правила обмена для каждого вида). */
export function discards(game: State['game'], hand: Card[]): Card[] {
  const low = (r: number, aceLow: boolean) => (r === 14 ? (aceLow ? 1 : 14) : r);
  if (game === 'badugi') {
    // оставить лучшее бадуги; карты старше девятки в неполном бадуги — менять
    let best: Card[] = [];
    let bv = -Infinity;
    for (let k = Math.min(4, hand.length); k >= 1; k--)
      for (const c of combos(hand, k)) {
        const v = badugi(c);
        if (c.length === new Set(c.map((x) => x.s)).size && c.length === new Set(c.map((x) => low(x.r, true))).size && v > bv) {
          bv = v;
          best = c;
        }
      }
    const keep = best.length === 4 ? best : best.filter((c) => low(c.r, true) <= 9);
    return hand.filter((c) => !keep.includes(c));
  }
  if (game === 'td27' || game === 'tda5' || game === 'badeucy' || game === 'badacey') {
    const aceLow = game === 'tda5' || game === 'badacey';
    const seen = new Set<number>();
    const keep: Card[] = [];
    for (const c of hand.slice().sort((a, b) => low(a.r, aceLow) - low(b.r, aceLow))) {
      const r = low(c.r, aceLow);
      if (r <= 8 && !seen.has(r) && !(game === 'td27' && c.r === 14)) {
        seen.add(r);
        keep.push(c);
      }
    }
    // 2–7: стрит или флеш на пяти — сломать старшей
    if (keep.length === 5 && (game === 'td27' || game === 'badeucy')) {
      const flush = keep.every((c) => c.s === keep[0].s);
      const rs = keep.map((c) => c.r).sort((a, b) => a - b);
      if (flush || rs[4] - rs[0] === 4) keep.splice(keep.indexOf(keep.reduce((a, c) => (c.r > a.r ? c : a))), 1);
    }
    return hand.filter((c) => !keep.includes(c));
  }
  // старшее дро: пары и выше оставить; иначе 4 к флешу; иначе две старших
  const cnt = new Map<number, number>();
  for (const c of hand) cnt.set(c.r, (cnt.get(c.r) ?? 0) + 1);
  const made = hand.filter((c) => cnt.get(c.r)! >= 2);
  if (made.length) {
    const v = high(hand);
    if (Math.floor(v / 15 ** 5) >= 4) return [];
    return hand.filter((c) => !made.includes(c));
  }
  for (const s of ['S', 'H', 'D', 'C']) {
    const f = hand.filter((c) => c.s === s);
    if (f.length >= 4) return hand.filter((c) => !f.includes(c)).slice(0, 1);
  }
  const top = hand.slice().sort((a, b) => b.r - a.r).slice(0, 2);
  return hand.filter((c) => !top.includes(c));
}

/** Пайнэппл: какую из трёх карт сбросить — оставить лучшую пару карт (до флопа — на глазок, после — по комбинации с доской). */
export function pineDiscard(game: State['game'], hand: Card[], board: Card[]): Card {
  const score = (two: Card[]) => {
    if (board.length >= 3) return (GAMES[game].short ? highSD : high)([...two, ...board]);
    const [a, b] = two[0].r >= two[1].r ? two : [two[1], two[0]];
    return (a.r === b.r ? 40 + a.r * 2 : a.r + b.r / 2) + (a.s === b.s ? 3 : 0) + (a.r - b.r <= 2 && a.r !== b.r ? 2 : 0);
  };
  let best = hand[0];
  let bv = -Infinity;
  for (const c of hand) {
    const v = score(hand.filter((x) => x !== c));
    if (v > bv) {
      bv = v;
      best = c;
    }
  }
  return best;
}

/** Доля банка, которую в среднем возьмёт seat. */
export function equity(v: View, seat: number, samples: number, rng: Rng): number {
  const g = info(v);
  const known = new Set<string>();
  for (const h of v.hole) for (const c of h) if (c) known.add(key(c));
  for (const c of v.board) known.add(key(c));
  const pool = allCards(g.short).filter((c) => !known.has(key(c)));
  const opp = contenders(v).filter((p) => p !== seat);
  const drawsLeft = g.family === 'draw' ? g.draws - v.street + (v.phase === 'draw' && !v.drew[seat] ? 0 : 0) : 0;
  let share = 0;
  for (let k = 0; k < samples; k++) {
    const d = pool.slice();
    let di = 0;
    const take = () => {
      const j = di + rng.int(d.length - di);
      [d[di], d[j]] = [d[j], d[di]];
      return d[di++];
    };
    const hole = v.hole.map((h) => h.map((c) => c ?? take()));
    let board = v.board.slice();
    if (g.family === 'flop') while (board.length < 5) board.push(take());
    if (g.family === 'stud') for (const p of [seat, ...opp]) while (hole[p].length < g.cards) hole[p].push(take());
    if (g.discard) for (const p of [seat, ...opp]) if (hole[p].length > 2) hole[p] = hole[p].filter((c) => c !== pineDiscard(v.game, hole[p], v.board));
    if (g.family === 'draw')
      for (let r = 0; r < drawsLeft; r++)
        for (const p of [seat, ...opp]) {
          const out = discards(v.game, hole[p]);
          if (out.length && di + out.length <= d.length) hole[p] = [...hole[p].filter((c) => !out.includes(c)), ...out.map(() => take())];
        }
    const t = { ...(v as State), hole, board };
    const val = new Map([seat, ...opp].map((p) => [p, values(t, p)]));
    const part = (k2: 'hi' | 'lo') => {
      const vs = [seat, ...opp].map((p) => val.get(p)![k2]).filter((x): x is number => x != null);
      if (!vs.length) return null;
      const top = Math.max(...vs);
      const ws = [seat, ...opp].filter((p) => val.get(p)![k2] === top);
      return ws.includes(seat) ? 1 / ws.length : 0;
    };
    const hi = part('hi')!;
    const lo = v.hilo || g.pot === 'bad27' || g.pot === 'badA5' ? part('lo') : null;
    share += lo == null ? hi : (hi + lo) / 2;
  }
  return share / samples;
}

export function choose(v: View, seat: number, level: number, rng: Rng): Action | null {
  if (v.over || v.turn !== seat) return null;
  if (v.phase === 'discard') return { type: 'discard', card: pineDiscard(v.game, v.hole[seat], v.board) };
  if (v.phase === 'draw') {
    const out = discards(v.game, v.hole[seat]);
    if (level === 0 && out.length < v.hole[seat].length && rng.next() < 0.25) {
      const extra = v.hole[seat].find((c) => !out.includes(c));
      if (extra) out.push(extra);
    }
    return { type: 'draw', cards: out };
  }
  const call = toCall(v, seat);
  const pot = potSize(v);
  const opp = contenders(v).length - 1;
  const samples = fast ? 12 : level === 0 ? 25 : level === 1 ? 70 : 160;
  let eq = equity(v, seat, samples, rng);
  if (level === 0) eq += (rng.next() - 0.5) * 0.25;
  const rr = raiseRange(v, seat);
  const raise = (frac: number): Action => {
    if (!rr) return call > 0 ? { type: 'call' } : { type: 'check' };
    const to = Math.round(Math.max(rr[0], Math.min(rr[1], v.current + pot * frac)));
    if (to >= v.chips[seat] + v.bet[seat]) return { type: 'allin' };
    return { type: 'raise', to };
  };
  const fair = 1 / (opp + 1);
  const odds = call > 0 ? call / (pot + call) : 0;
  const strong = eq > fair * (level === 2 ? 1.6 : 1.8) && eq > 0.4;
  if (strong && rr && (level > 0 || rng.next() < 0.5)) return raise(level === 2 ? 0.5 + rng.next() * 0.4 : 0.6);
  if (level === 2 && !call && rr && rng.next() < 0.07) return raise(0.5);
  if (call === 0) return { type: 'check' };
  if (eq >= odds + (level === 2 ? 0.02 : 0.05) || (level === 0 && rng.next() < 0.2)) return call >= v.chips[seat] ? { type: 'allin' } : { type: 'call' };
  return { type: 'fold' };
}
