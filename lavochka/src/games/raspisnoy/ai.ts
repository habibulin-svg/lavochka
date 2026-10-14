/* Расписной покер — боты. Видят свою руку (в тёмной — ничего, в лобовой — только чужие карты) и взятку на столе.
 *   Лёгкий — заказ на глаз с разбросом, карты почти наугад;
 *   Средний — заказ по силе руки, добирает заказ самой дешёвой бьющей картой, лишнее скидывает старшими проигрышными;
 *   Сложный — ещё и сдающим выбирает ближайший разрешённый заказ, джокером заходит «по старшим козырям», когда нужно выбить козыри,
 *   и подбирает заказ в лобовой по чужим картам. */
import type { Rng } from '../../core/types';
import { makeDeck, sameCard, SUITS, type Card, type Suit } from '../../cards/deck';
import { bidOptions, cur, isJoker, legal, trickWinner, trumpOf, type Action, type JokerPlay, type Played, type View } from './engine';

/** Ожидаемое число взяток с этой рукой. */
function estimate(v: View, hand: Card[]): number {
  const n = v.seats.length;
  const trump = v.cfg.circular ? null : v.trump;
  const cards = cur(v).cards;
  let e = 0;
  for (const c of hand) {
    if (isJoker(v.cfg, c)) {
      e += 1;
      continue;
    }
    const len = hand.filter((x) => x.s === c.s).length;
    if (c.s === trump) e += c.r === 14 ? 0.95 : c.r === 13 ? 0.75 : c.r === 12 ? 0.5 : c.r >= 10 ? 0.3 : 0.15;
    else if (c.r === 14) e += len <= 3 ? 0.75 : 0.45;
    else if (c.r === 13) e += len <= 2 ? 0.4 : 0.2;
    else if (c.r === 12 && cards >= 6) e += 0.1;
  }
  if (trump) {
    const t = hand.filter((c) => c.s === trump).length;
    if (t >= 3) e += (t - 2) * 0.3;
  }
  // за столом с большим числом игроков старшие карты бьют реже
  return e * (n <= 3 ? 1.1 : n >= 5 ? 0.85 : 1);
}

/** Лобовая: каков шанс, что моя невидимая карта возьмёт взятку против видимых чужих. */
function lobChance(v: View, seat: number): number {
  const seen = v.seats.filter((p) => p !== seat).map((p) => v.hands[p][0]).filter(Boolean) as Card[];
  if (seen.some((c) => isJoker(v.cfg, c))) return 0;
  const pool = makeDeck(v.cfg.deck).filter((c) => !seen.some((x) => sameCard(x, c)) && !(v.trumpCard && sameCard(v.trumpCard, c)));
  let win = 0;
  for (const mine of pool) {
    if (isJoker(v.cfg, mine)) {
      win++;
      continue;
    }
    // заходит левый от сдающего — грубо: берём, если старше всех видимых по козырю или в общей масти
    const all: Played[] = v.seats.map((p) => ({ seat: p, card: p === seat ? mine : v.hands[p][0] }));
    const order = all.slice(v.seats.indexOf(v.turn)).concat(all.slice(0, v.seats.indexOf(v.turn)));
    if (order[0].card && trickWinner(v, order.map((t) => (isJoker(v.cfg, t.card) ? { ...t, joker: { mode: 'high' } } : t))) === seat) win++;
  }
  return pool.length ? win / pool.length : 0;
}

function chooseBid(v: View, seat: number, level: number, rng: Rng): Action {
  const opts = bidOptions(v, seat);
  const kind = cur(v).kind;
  const cards = cur(v).cards;
  let want: number;
  if (kind === 'lob') want = level === 2 ? (lobChance(v, seat) > 0.5 ? 1 : 0) : rng.next() < 0.3 ? 1 : 0;
  else if (kind === 'dark') want = (cards / v.seats.length) * (level === 0 ? rng.next() * 2 : 0.8);
  else {
    want = estimate(v, v.hands[seat]);
    if (level === 0) want += (rng.next() - 0.5) * 2.5;
    if (level === 1) want += (rng.next() - 0.5) * 0.6;
  }
  const target = Math.max(0, Math.min(cards, Math.round(want)));
  // ближайший разрешённый (сдающему запрещённый — сложный смотрит, в какую сторону ошибиться дешевле: вниз)
  const best = opts.slice().sort((a, b) => Math.abs(a - target) - Math.abs(b - target) || (level === 2 ? a - b : b - a))[0];
  return { type: 'bid', n: best };
}

export function choose(v: View, seat: number, level: number, rng: Rng): Action | null {
  if (v.phase === 'over' || v.turn !== seat) return null;
  if (v.phase === 'bid') return chooseBid(v, seat, level, rng);
  const kind = cur(v).kind;
  const hand = v.hands[seat];
  const moves = legal(v, seat);
  if (!moves.length) return null;
  const jk = (c: Card) => isJoker(v.cfg, c);
  const bid = v.bids[seat] ?? 0;
  const need = kind === 'gold' ? 99 : kind === 'misere' ? -1 : bid - v.tricks[seat];
  const wantTricks = need > 0;
  const lead = !v.trick.length;

  const jokerPlay = (take: boolean): JokerPlay => {
    if (!lead) return { mode: take ? 'high' : 'low' };
    if (take) {
      const t = v.cfg.circular ? null : v.trump;
      const mine = (s: Suit) => hand.filter((c) => c.s === s && !jk(c)).length;
      const suit = t && level === 2 && mine(t) >= 2 ? t : t ?? SUITS.slice().sort((a, b) => mine(a) - mine(b))[0];
      return { mode: 'want', suit };
    }
    const short = SUITS.slice().sort((a, b) => hand.filter((c) => c.s === a).length - hand.filter((c) => c.s === b).length)[0];
    return { mode: 'low', suit: short };
  };
  const act = (c: Card, take = wantTricks): Action => (jk(c) ? { type: 'play', card: c, joker: jokerPlay(take) } : { type: 'play', card: c });

  if (level === 0) {
    const c = moves[rng.int(moves.length)];
    return act(c, rng.next() < 0.5);
  }
  const plain = moves.filter((c) => !jk(c));
  const jokers = moves.filter(jk);
  const byR = (a: Card, b: Card) => a.r - b.r;
  const trump = trumpOf(v, lead ? [{ seat, card: plain[0] ?? moves[0] }] : v.trick);
  const val = (c: Card) => c.r + (c.s === trump ? 20 : 0);
  const wins = (c: Card) => trickWinner(v, [...v.trick, { seat, card: c }]) === seat;

  if (lead) {
    if (wantTricks) {
      // заход с самого верного: джокер (сложный — выбить козыри), туз, старший козырь
      if (jokers.length && (level === 2 || !plain.length)) return act(jokers[0], true);
      const aces = plain.filter((c) => c.r === 14 && c.s !== trump);
      if (aces.length) return act(aces[0]);
      const tr = plain.filter((c) => c.s === trump).sort(byR);
      if (tr.length && tr[tr.length - 1].r >= 13) return act(tr[tr.length - 1]);
      if (jokers.length) return act(jokers[0], true);
      return act(plain.slice().sort((a, b) => val(b) - val(a))[0]);
    }
    if (plain.length) return act(plain.slice().sort((a, b) => val(a) - val(b))[0]);
    return act(jokers[0], false);
  }

  if (wantTricks) {
    const winning = plain.filter(wins).sort((a, b) => val(a) - val(b));
    // последним хватит и маленькой; иначе берём самой дешёвой бьющей, но не тратим козырного туза зря
    if (winning.length) return act(winning[0]);
    if (jokers.length) return act(jokers[0], true);
    return act(plain.slice().sort((a, b) => val(a) - val(b))[0]);
  }
  // не брать: старшая из проигрышных, джокер — скинуть
  const losing = plain.filter((c) => !wins(c)).sort((a, b) => val(b) - val(a));
  if (losing.length) return act(losing[0]);
  if (jokers.length) return act(jokers[0], false);
  return act(plain.slice().sort((a, b) => val(a) - val(b))[0]);
}
