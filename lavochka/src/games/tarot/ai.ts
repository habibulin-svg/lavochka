/* Французское таро — боты. Видят только свой вид (свою руку, сыгранное, открытый прикуп и показанные пуанье).
 * Лёгкий: заявка по грубой оценке с шумом, ход — любой разрешённый (без явных глупостей с Эскюзом).
 * Средний: оценка руки по очкам (удлеры, козыри, короли, длинные и пустые масти), снос «под оголение» мастей,
 * розыгрыш — бить дёшево, когда во взятке очки, не отдавать короли и пти соперникам, сбросить Эскюз заранее.
 * Сложный: то же + счёт вышедших козырей и королей, «загрузка» очками взятки напарника, когда она точно его,
 * взявший тянет козыри при перевесе, защита охотится за пти. */
import type { Rng } from '../../core/types';
import { rankOf, suitOf } from '../../cards/tarot';
import {
  canCall,
  canDiscard,
  chienSize,
  EXCUSE,
  half,
  handSize,
  isKing,
  isTrump,
  leadKind,
  legal,
  MONDE,
  OUDLERS,
  PETIT,
  poigneeMax,
  asksPoignee,
  topBid,
  trickWinner,
  type Action,
  type Contract,
  type View,
} from './engine';

const SUITS = ['W', 'C', 'S', 'P'] as const;

/** Оценка руки для заявки (вчетвером на 18 картах; для 24 и 15 — пересчёт). */
export function handValue(hand: number[], n: number): number {
  const trumps = hand.filter(isTrump);
  const T = trumps.length + (hand.includes(EXCUSE) ? 1 : 0);
  let v = 0;
  for (const t of trumps) v += t >= 16 ? 3 : 2;
  if (hand.includes(MONDE)) v += 10;
  if (hand.includes(EXCUSE)) v += 7;
  if (hand.includes(PETIT)) v += T >= 6 ? 8 : T >= 5 ? 5 : 0;
  for (const s of SUITS) {
    const cs = hand.filter((c) => suitOf(c) === s);
    const r = cs.map(rankOf);
    if (r.includes(14)) v += 6 + (r.includes(13) ? 1 : 0);
    if (r.includes(13)) v += 3;
    if (r.includes(12)) v += 2;
    if (r.includes(11)) v += 1;
    if (cs.length >= 5) v += 2 * (cs.length - 4);
    if (cs.length === 0 && T >= 4) v += 6;
    else if (cs.length === 1 && T >= 4) v += 3;
  }
  return (v * 18) / handSize(n);
}

function wantBid(v: View, seat: number, level: number, rng: Rng): Contract | 0 {
  let val = handValue(v.hands[seat], v.seats.length);
  if (level === 1) val += (rng.next() - 0.5) * 20;
  // впятером рука меньше, но есть напарник
  const k = v.seats.length === 5 ? 0.92 : v.seats.length === 3 ? 1.05 : 1;
  const want: Contract | 0 = val >= 82 * k ? 6 : val >= 72 * k ? 4 : val >= 56 * k ? 2 : val >= (level === 3 ? 38 : 40) * k ? 1 : 0;
  return want > topBid(v) ? want : 0;
}

function pickCall(v: View, seat: number): number {
  const opts = canCall(v, seat);
  const hand = v.hands[seat];
  // король масти, где у нас больше всего карт (и лучше с дамой), но не свой
  let best = opts[0];
  let bs = -1;
  for (const c of opts) {
    if (hand.includes(c)) continue;
    const s = suitOf(c)!;
    const cs = hand.filter((x) => suitOf(x) === s);
    const score = cs.length * 2 + (cs.some((x) => rankOf(x) === 13) ? 3 : 0);
    if (score > bs) {
      bs = score;
      best = c;
    }
  }
  return best;
}

export function pickDiscard(hand: number[], k: number, level: number, rng: Rng): number[] {
  const ok = hand.filter((c) => canDiscard(hand, c, k));
  if (level === 1) return shuffleTake(ok.filter((c) => !isTrump(c)).length >= k ? ok.filter((c) => !isTrump(c)) : ok, k, rng);
  const out: number[] = [];
  // оголить короткие масти без короля целиком
  const bySuit = SUITS.map((s) => ({ s, cs: hand.filter((c) => suitOf(c) === s) }))
    .filter((x) => x.cs.length && !x.cs.some(isKing))
    .sort((a, b) => a.cs.length - b.cs.length);
  for (const x of bySuit) if (out.length + x.cs.length <= k) out.push(...x.cs);
  // дальше — самые дорогие карты без короля (их очки наши), потом мелочь
  const rest = ok.filter((c) => !out.includes(c) && !isTrump(c)).sort((a, b) => half(b) - half(a) || rankOf(a) - rankOf(b));
  while (out.length < k && rest.length) out.push(rest.shift()!);
  const tr = ok.filter((c) => isTrump(c) && !out.includes(c)).sort((a, b) => a - b);
  while (out.length < k && tr.length) out.push(tr.shift()!);
  return out;
}

function shuffleTake(cs: number[], k: number, rng: Rng) {
  const a = cs.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, k);
}

/** Свой ли игрок (по тому, что знает бот). */
function friend(v: View, me: number, x: number): boolean | null {
  const att = (y: number) => y === v.taker || (v.partner != null && y === v.partner);
  if (x === me) return true;
  const meAtt = att(me);
  // впятером, пока напарник не открыт: защитники не знают, кто напарник
  if (v.seats.length === 5 && v.partner == null && x !== v.taker) return null;
  return att(x) === meAtt;
}

export function choose(v: View, seat: number, level: number, rng: Rng): Action | null {
  if (v.over || v.turn !== seat) return null;
  if (v.phase === 'bid') {
    const c = wantBid(v, seat, level, rng);
    return c ? { type: 'bid', c } : { type: 'pass' };
  }
  if (v.phase === 'call') return { type: 'call', card: pickCall(v, seat) };
  if (v.phase === 'discard') return { type: 'discard', cards: pickDiscard(v.hands[seat], chienSize(v.seats.length), level, rng) };
  if (v.phase !== 'play') return null;
  if (asksPoignee(v, seat)) {
    const max = poigneeMax(v, seat);
    return { type: 'poignee', level: level === 1 ? (rng.next() < 0.5 ? max : 0) : max };
  }
  const L = legal(v, seat);
  if (L.length === 1) return { type: 'play', card: L[0] };
  if (level === 1) {
    const pool = v.hands[seat].length > 1 ? L : L.filter((c) => c !== EXCUSE).length ? L.filter((c) => c !== EXCUSE) : L;
    return { type: 'play', card: pool[rng.int(pool.length)] };
  }
  return { type: 'play', card: playCard(v, seat, L, level) };
}

function playCard(v: View, seat: number, L: number[], level: number): number {
  const hand = v.hands[seat];
  const n = v.seats.length;
  const gone = new Set([...v.gone, ...v.trick.map((t) => t.card)]);
  // козыри, которых нет ни у меня, ни в сыгранном — у соперников (и в сносе)
  const outTrumps = Array.from({ length: 21 }, (_, i) => i + 1).filter((t) => !gone.has(t) && !hand.includes(t) && !v.ecartShown.includes(t));
  const noEx = L.filter((c) => c !== EXCUSE);
  // Эскюз: сбросить, пока не поздно (в последней взятке он пропадёт)
  if (L.includes(EXCUSE) && hand.length <= 2) return EXCUSE;

  const lead = leadKind(v.trick);
  const left = n - 1 - v.trick.length;
  const win = (c: number) => trickWinner([...v.trick, { seat, card: c }]) === seat;
  const curW = v.trick.length ? trickWinner(v.trick) : null;
  const mateWins = curW != null && friend(v, seat, curW) === true;
  const trickPts = v.trick.reduce((a, t) => a + half(t.card), 0);
  // взятка у своего «наверняка»: он последний сыграл старший из оставшихся козырей, или после меня никого
  const sure = (c: number) => {
    if (!isTrump(c)) return left === 0;
    return outTrumps.every((t) => t < c) || left === 0;
  };

  if (!v.trick.length) return leadCard(v, seat, noEx.length ? noEx : L, outTrumps, level);

  // свой берёт: загрузить очки (короли, дамы), не отдавая козырей зря
  if (mateWins && (left === 0 || (level === 3 && sure(v.trick.find((t) => t.seat === curW)!.card)))) {
    const plain = noEx.filter((c) => !isTrump(c) && !win(c));
    if (plain.length) return plain.sort((a, b) => half(b) - half(a))[0];
    const tr = noEx.filter((c) => isTrump(c) && c !== PETIT).sort((a, b) => a - b);
    if (tr.length) return tr[0];
  }

  const winners = noEx.filter(win);
  if (winners.length) {
    // последним — берём самым дешёвым, а пти — если он берёт, лучшего случая не будет
    if (left === 0) {
      if (winners.includes(PETIT)) return PETIT;
      return cheapest(winners);
    }
    // в середине — берём, если во взятке очки или беру козырем, который не перебьют
    const strong = winners.filter((c) => (isTrump(c) ? outTrumps.every((t) => t < c) || c >= 18 : isKing(c) || rankOf(c) === 13));
    if (trickPts >= 7 || (lead !== 'T' && strong.some((c) => !isTrump(c))))
      return (strong.length ? cheapest(strong) : cheapest(winners.filter((c) => c !== PETIT).length ? winners.filter((c) => c !== PETIT) : winners));
  }
  // проигрываем: отдать самое дешёвое, король или пти — только если иначе никак
  const losers = noEx.length ? noEx : L;
  const safe = losers.filter((c) => c !== PETIT && !isKing(c));
  const pool = safe.length ? safe : losers;
  // дорогую карту под чужую взятку лучше прикрыть Эскюзом
  if (L.includes(EXCUSE) && !mateWins && pool.every((c) => half(c) >= 7)) return EXCUSE;
  return pool.sort((a, b) => half(a) - half(b) || (isTrump(a) ? 1 : 0) - (isTrump(b) ? 1 : 0) || (isTrump(a) && isTrump(b) ? a - b : rankOf(a) - rankOf(b)))[0];
}

function cheapest(cs: number[]) {
  return cs.slice().sort((a, b) => (isTrump(a) ? 100 + a : half(a) * 2 + rankOf(a)) - (isTrump(b) ? 100 + b : half(b) * 2 + rankOf(b)))[0];
}

function leadCard(v: View, seat: number, L: number[], outTrumps: number[], level: number): number {
  const hand = v.hands[seat];
  const att = seat === v.taker || seat === v.partner;
  const myTr = L.filter(isTrump).sort((a, b) => a - b);
  const played = new Set(v.gone);
  // короли — пока масть не ходили, они обычно проходят
  const fresh = (s: string) => !v.gone.some((c) => suitOf(c) === s);
  const kings = L.filter((c) => isKing(c) && fresh(suitOf(c)!));
  if (att) {
    // взявший с перевесом в козырях тянет их (не пти)
    if (myTr.length && myTr.length >= outTrumps.length && myTr.some((t) => t !== PETIT)) {
      const big = myTr.filter((t) => t !== PETIT);
      return level === 3 && outTrumps.length && big[big.length - 1] > Math.max(...outTrumps) ? big[big.length - 1] : big[0];
    }
    if (kings.length) return kings[0];
  } else {
    if (kings.length) return kings[0];
    // сложный: пти ещё не вышел, у меня козырей много — тянем козыри, чтобы его поймать
    if (level === 3 && !played.has(PETIT) && !hand.includes(PETIT) && myTr.length >= 5) return myTr.filter((t) => t !== PETIT)[0] ?? myTr[0];
  }
  // иначе — мелкая карта самой длинной масти
  const plain = L.filter((c) => !isTrump(c) && !OUDLERS.includes(c));
  if (plain.length) {
    const len = (c: number) => hand.filter((x) => suitOf(x) === suitOf(c)).length;
    return plain.sort((a, b) => len(b) - len(a) || half(a) - half(b) || rankOf(a) - rankOf(b))[0];
  }
  const tr = L.filter((c) => c !== PETIT && c !== EXCUSE).sort((a, b) => a - b);
  return tr[0] ?? L[0];
}

