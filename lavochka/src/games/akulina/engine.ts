/* Акулина (она же Зассыха) — правила (без DOM). 2–6 игроков, колода 36 (или 52) без одной карты.
 *
 * Из колоды убирают даму треф — дама пик остаётся без пары, она и есть «Акулина» (дамы парами только по цвету: червы с бубнами).
 * В «Зассыхе» убирают случайную карту втёмную — без пары останется неизвестно что. Вариант «пиковый валет» — то же с валетами.
 * Раздают всё, сразу сбрасывают пары одного ранга (в строгом варианте — ранга и цвета). Дальше по кругу: тянешь наугад карту
 * у соседа слева; сложилась пара — в отбой. Кончились карты — вышел. Последний с картой — проиграл.
 */
import type { Options, Rng } from '../../core/types';
import { isRed, makeDeck, sameCard, type Card } from '../../cards/deck';
import { shuffle } from '../../core/rng';

export type Odd = 'queen' | 'jack' | 'random';

export interface Cfg {
  deck: 36 | 52;
  odd: Odd;
  /** Пары только одного цвета (красное с красным, чёрное с чёрным). */
  color: boolean;
}

export function cfgFrom(o: Options): Cfg {
  return { deck: Number(o.deck) === 52 ? 52 : 36, odd: o.odd === 'jack' || o.odd === 'random' ? o.odd : 'queen', color: !!o.color };
}

export interface State {
  cfg: Cfg;
  seats: number[];
  hands: Card[][];
  /** Сброшенные пары (открыто). */
  pairs: Card[][];
  /** Убранная карта (в «Зассыхе» её никто не видит до конца). */
  removed: Card;
  turn: number;
  done: number[];
  loser: number | null;
  /** Последний ход — для показа. */
  last: { seat: number; from: number; pair: boolean } | null;
}

export interface View extends State {
  counts: number[];
}

export type Action = { type: 'draw'; index: number };

export type Event =
  | { type: 'pairs'; seat: number; cards: Card[] }
  | { type: 'draw'; seat: number; from: number; index: number; card?: Card }
  | { type: 'pair'; seat: number; from: number; cards: Card[] }
  | { type: 'out'; seat: number; place: number }
  | { type: 'end'; loser: number; card: Card | null; removed: Card };

const nextIn = (list: number[], seat: number) => list[(list.indexOf(seat) + 1) % list.length];

/** Пара ли две карты. Ранг «акулины» (дамы/валеты) — только по цвету, чтобы без пары осталась именно пиковая. */
export function isPair(cfg: Cfg, a: Card, b: Card): boolean {
  if (a.r !== b.r || sameCard(a, b)) return false;
  const byColor = cfg.color || (cfg.odd === 'queen' && a.r === 12) || (cfg.odd === 'jack' && a.r === 11);
  return !byColor || isRed(a) === isRed(b);
}

/** Сбросить все пары с руки; вернуть сброшенное. */
function dropPairs(cfg: Cfg, hand: Card[]): { hand: Card[]; out: Card[] } {
  const left = hand.slice();
  const out: Card[] = [];
  for (let i = 0; i < left.length; i++)
    for (let j = i + 1; j < left.length; j++)
      if (isPair(cfg, left[i], left[j])) {
        out.push(left[i], left[j]);
        left.splice(j, 1);
        left.splice(i, 1);
        i--;
        break;
      }
  return { hand: left, out };
}

export function newState(cfg: Cfg, seats: number[]): State {
  return { cfg, seats: seats.slice(), hands: [[], [], [], [], [], []], pairs: [], removed: { s: 'C', r: 12 }, turn: seats[0], done: [], loser: null, last: null };
}

export const active = (s: State) => s.seats.filter((p) => !s.done.includes(p));

/** У кого тянет seat: следующий по кругу, кто ещё в игре. */
export function offerer(s: State, seat: number): number {
  let p = seat;
  for (let i = 0; i < s.seats.length; i++) {
    p = nextIn(s.seats, p);
    if (!s.done.includes(p) && p !== seat) return p;
  }
  return seat;
}

export function setup(seats: number[], opts: Options, rng: Rng): State {
  const s = newState(cfgFrom(opts), seats);
  let deck = shuffle(makeDeck(s.cfg.deck), rng);
  const removed = s.cfg.odd === 'random' ? deck[rng.int(deck.length)] : { s: 'C' as const, r: s.cfg.odd === 'jack' ? 11 : 12 };
  deck = deck.filter((c) => !sameCard(c, removed));
  s.removed = removed;
  deck.forEach((c, i) => s.hands[seats[i % seats.length]].push(c));
  for (const p of seats) {
    const d = dropPairs(s.cfg, s.hands[p]);
    s.hands[p] = shuffle(d.hand, rng);
    for (let i = 0; i < d.out.length; i += 2) s.pairs.push([d.out[i], d.out[i + 1]]);
  }
  // кто без карт уже после сброса — вышел сразу
  for (const p of seats) if (!s.hands[p].length) s.done.push(p);
  s.turn = seats[rng.int(seats.length)];
  if (s.done.includes(s.turn)) s.turn = offerer(s, s.turn);
  return s;
}

export const toAct = (s: State): number[] => (s.loser != null ? [] : [s.turn]);

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (s0.loser != null || seat !== s0.turn || !a || a.type !== 'draw') return null;
  const from = offerer(s0, seat);
  if (from === seat) return null;
  const fh = s0.hands[from];
  const i = Math.floor(Number(a.index));
  if (!(i >= 0 && i < fh.length)) return null;
  const s: State = { ...s0, hands: s0.hands.slice(), pairs: s0.pairs.slice(), done: s0.done.slice() };
  const ev: Event[] = [];
  const card = fh[i];
  s.hands[from] = fh.filter((_, k) => k !== i);
  ev.push({ type: 'draw', seat, from, index: i, card });
  const mate = s.hands[seat].find((c) => isPair(s.cfg, c, card));
  if (mate) {
    s.hands[seat] = s.hands[seat].filter((c) => !sameCard(c, mate));
    s.pairs.push([mate, card]);
    ev.push({ type: 'pair', seat, from, cards: [mate, card] });
  } else s.hands[seat] = shuffle([...s.hands[seat], card], rng);
  // соседу тасуем веер — где лежит взятое, не угадать
  s.hands[from] = shuffle(s.hands[from], rng);
  s.last = { seat, from, pair: !!mate };
  for (const p of [from, seat])
    if (!s.hands[p].length && !s.done.includes(p)) {
      s.done.push(p);
      ev.push({ type: 'out', seat: p, place: s.done.length });
    }
  const left = active(s);
  if (left.length <= 1) {
    s.loser = left[0] ?? seat;
    ev.push({ type: 'end', loser: s.loser, card: s.hands[s.loser][0] ?? null, removed: s.removed });
    return { state: s, events: ev };
  }
  // ход переходит к тому, у кого тянули (или дальше, если он вышел)
  s.turn = offerer(s, seat);
  return { state: s, events: ev };
}

export function makeView(s: State, seats: number[] | 'all'): View {
  const see = (x: number) => seats === 'all' || seats.includes(x);
  const v = s as Partial<View>;
  return {
    ...s,
    hands: s.hands.map((h, i) => (see(i) ? h.slice() : [])),
    // в «Зассыхе» убранную карту не видно до конца
    removed: s.cfg.odd === 'random' && s.loser == null && seats !== 'all' ? { s: 'S', r: 0 } : s.removed,
    counts: s.hands.map((h, i) => v.counts?.[i] ?? h.length),
  };
}

export const countOf = (s: State, seat: number) => ((s as Partial<View>).counts ? (s as View).counts[seat] : s.hands[seat].length);
