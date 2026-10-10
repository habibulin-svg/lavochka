/* Дурак — боты. Видят только свой view: свою руку, число карт у остальных, стол, отбой и карты, которые все видели.
 *   Лёгкий — ходит и кроет первой подходящей, подкидывает наугад, козыри не бережёт.
 *   Средний — ходит с младших, бережёт козыри, пока есть колода, переводит мелкими картами.
 *   Сложный — ещё и считает карты: помнит отбой и чужие взятые карты, ходит тем, чем соперник не отобьётся,
 *             под конец колоды избавляется от мелочи, а при пустой колоде старается выйти первым. */
import type { Rng } from '../../core/types';
import { sameCard, type Card } from '../../cards/deck';
import { beats, canTransfer, room, throwable, trumpOf, unbeaten, type Action, type View } from './engine';
import type { Suit } from '../../cards/deck';

/** Козырь бота, который сейчас думает (в длинном дураке у каждого свой). */
let T: Suit = 'S';

/** Цена карты: козыри дороже любых некозырей. */
function value(v: View, c: Card): number {
  let x = c.r;
  if (c.s === T) x += 20;
  // в японском пики почти козыри: бить их можно только старшей пикой
  if (v.cfg.spades && T !== 'S' && c.s === 'S') x += 6;
  return x;
}

const byValue = (v: View) => (a: Card, b: Card) => value(v, a) - value(v, b);

/** Карты, которых точно нет ни у кого из соперников (отбой, своя рука) — для подсчёта. */
function unseen(v: View, me: number): Card[] {
  const out: Card[] = [];
  const mine = v.hands[me] || [];
  const gone = [...v.bito, ...mine, ...v.table.flatMap((p) => (p.d ? [p.a, p.d] : [p.a]))];
  const from = v.size === 52 ? 2 : v.size === 24 ? 9 : v.size === 32 ? 7 : 6;
  for (const s of ['S', 'C', 'D', 'H'] as const)
    for (let r = from; r <= 14; r++) {
      const c = { s, r };
      if (!gone.some((g) => sameCard(g, c))) out.push(c);
    }
  return out;
}

/** Сможет ли соперник (по известным и возможным картам) покрыть карту a. Оценка от 0 до 1. */
function beatChance(v: View, me: number, opp: number, a: Card): number {
  const known = v.known[opp] || [];
  if (known.some((c) => beats(v, a, c))) return 1;
  const pool = unseen(v, me).filter((c) => !v.known.some((k, seat) => seat !== opp && k.some((x) => sameCard(x, c))));
  if (!pool.length) return 0;
  const hand = v.counts[opp] - known.length;
  if (hand <= 0) return 0;
  const good = pool.filter((c) => beats(v, a, c)).length;
  // вероятность, что среди hand случайных карт из pool есть хоть одна подходящая
  let miss = 1;
  for (let i = 0; i < hand; i++) miss *= Math.max(0, (pool.length - good - i) / (pool.length - i));
  return 1 - miss;
}

// ---------------------------------------------------------------- атака

function chooseAttack(v: View, me: number, level: number, rng: Rng): Action {
  const hand = (v.hands[me] || []).slice().sort(byValue(v));
  const maxN = Math.max(1, room(v));
  if (level === 0) {
    const c = hand[rng.int(Math.min(3, hand.length))];
    return { type: 'attack', cards: [c] };
  }
  const deck = v.deckCount;
  const groups = new Map<number, Card[]>();
  for (const c of hand) {
    if (!groups.has(c.r)) groups.set(c.r, []);
    groups.get(c.r)!.push(c);
  }
  let best: Card[] = [hand[0]];
  let bestScore = -Infinity;
  for (const cards of groups.values()) {
    const plain = cards.filter((c) => c.s !== T);
    // козыри в заход — только когда больше нечем или колода пуста
    const use = plain.length ? plain : deck > 0 && hand.some((c) => c.s !== T) ? [] : cards;
    if (!use.length) continue;
    const take = v.cfg.multiLead ? use.slice(0, maxN) : use.slice(0, 1);
    let score = -take.reduce((a, c) => a + value(v, c), 0) / take.length;
    score += (take.length - 1) * (deck > 6 ? 2 : 5);
    if (level >= 2) {
      // чем вероятнее, что не отобьётся, тем лучше
      const p = take.reduce((acc, c) => acc * beatChance(v, me, v.defender, c), 1);
      score += (1 - p) * (deck ? 6 : 14);
      // не оставлять себе одиночку того же достоинства для подкидывания — неважно; а вот пары лучше
    }
    if (score > bestScore) {
      bestScore = score;
      best = take;
    }
  }
  return { type: 'attack', cards: best };
}

// ---------------------------------------------------------------- защита

/** План защиты: какой картой крыть каждую непокрытую. null — не отбиться. */
function defensePlan(v: View, hand: Card[]): { i: number; card: Card }[] | null {
  const open = v.table.map((p, i) => ({ p, i })).filter((x) => !x.p.d);
  // сначала старшие и козырные атаки — им выбор меньше
  open.sort((x, y) => value(v, y.p.a) - value(v, x.p.a));
  const left = hand.slice().sort(byValue(v));
  const plan: { i: number; card: Card }[] = [];
  for (const { p, i } of open) {
    const k = left.findIndex((c) => beats(v, p.a, c));
    if (k < 0) return null;
    plan.push({ i, card: left[k] });
    left.splice(k, 1);
  }
  return plan;
}

function chooseDefense(v: View, me: number, level: number, rng: Rng): Action {
  const hand = (v.hands[me] || []).slice();
  // перевод: показом козыря — бесплатно; картой — если она мелкая
  if (v.cfg.transfer && level > 0) {
    const r = v.table[0]?.a.r;
    const same = hand.filter((c) => c.r === r).sort(byValue(v));
    const show = same.find((c) => c.s === T && canTransfer(v, c, true));
    if (show) return { type: 'show', card: show };
    const plain = same.find((c) => c.s !== T && canTransfer(v, c, false));
    if (plain && (value(v, plain) <= 10 || level < 2 || v.deckCount === 0)) return { type: 'transfer', card: plain };
  } else if (v.cfg.transfer && level === 0 && rng.next() < 0.5) {
    const c = hand.find((x) => canTransfer(v, x, false));
    if (c) return { type: 'transfer', card: c };
  }
  const plan = defensePlan(v, hand);
  if (!plan) return { type: 'take' };
  if (level === 0) return { type: 'beat', ...plan[0] };
  // стоит ли отбиваться: дорогими козырями при большой колоде — лучше взять мелочь
  const cost = plan.reduce((a, x) => a + Math.max(0, value(v, x.card) - 12), 0);
  const taken = v.table.length;
  const deck = v.deckCount;
  let limit = deck > 12 ? 10 : deck > 0 ? 18 : 99;
  if (level >= 2) {
    // взятие под конец хуже: набирается рука
    if (hand.length + taken > 9) limit += 8;
    // бить, если иначе соперники подкинут ещё
    if (unbeaten(v.table) === 1 && taken <= 1 && deck > 12) limit -= 2;
  }
  if (cost > limit && taken <= 2) return { type: 'take' };
  return { type: 'beat', ...plan[0] };
}

// ---------------------------------------------------------------- подкидывание

function chooseThrow(v: View, me: number, level: number, rng: Rng): Action {
  const can = throwable(v, me).sort(byValue(v));
  const n = room(v);
  if (!can.length || n <= 0) return { type: 'pass' };
  const taking = v.phase === 'take';
  if (level === 0) {
    if (rng.next() < 0.5) return { type: 'pass' };
    return { type: 'throw', cards: [can[0]] };
  }
  const deck = v.deckCount;
  // что не жалко отдать: при взятии — любую мелочь (соперник всё равно забирает); иначе — некозырную мелочь
  const cheap = can.filter((c) => {
    if (deck === 0) return level >= 2 || c.s !== T;
    if (c.s === T) return false;
    return taking ? c.r <= 11 : c.r <= (deck > 10 ? 10 : 12);
  });
  if (!cheap.length) return { type: 'pass' };
  // подкидывать одного достоинства пачкой — сразу всё, что можно
  let cards = cheap.slice(0, n);
  if (level >= 2 && !taking && deck === 0) {
    // при пустой колоде подкидываем то, чем соперник не отобьётся, — пусть берёт
    cards.sort((a, b) => beatChance(v, me, v.defender, a) - beatChance(v, me, v.defender, b));
    cards = cards.slice(0, n);
  }
  return { type: 'throw', cards };
}

export function choose(v: View, seat: number, level: number, rng: Rng): Action | null {
  T = trumpOf(v, seat);
  switch (v.phase) {
    case 'trump': {
      // король назначает козырем масть, которой у него больше всего (и старше)
      const hand = v.hands[seat] || [];
      const score: Record<string, number> = { S: 0, C: 0, D: 0, H: 0 };
      for (const c of hand) score[c.s] += 1 + c.r / 14;
      const suits = (['S', 'C', 'D', 'H'] as const).slice().sort((a, b) => score[b] - score[a]);
      return { type: 'trump', suit: level === 0 ? suits[rng.int(4)] : suits[0] };
    }
    case 'attack':
      return chooseAttack(v, seat, level, rng);
    case 'defend':
      return chooseDefense(v, seat, level, rng);
    case 'throw':
    case 'take':
      return chooseThrow(v, seat, level, rng);
    default:
      return null;
  }
}

