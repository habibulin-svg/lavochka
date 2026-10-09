/* Карты: модель колоды. Без DOM — используется движками карточных игр. */
import { shuffle } from '../core/rng';
import type { Rng } from '../core/types';

/** Пики, трефы, бубны, черви. */
export type Suit = 'S' | 'C' | 'D' | 'H';
export const SUITS: Suit[] = ['S', 'C', 'D', 'H'];

/** r: 2..10, 11 — валет, 12 — дама, 13 — король, 14 — туз, 15 — джокер. */
export interface Card {
  s: Suit;
  r: number;
}

export const SUIT_NAME: Record<Suit, string> = { S: 'пики', C: 'трефы', D: 'бубны', H: 'черви' };
export const SUIT_SYM: Record<Suit, string> = { S: '♠', C: '♣', D: '♦', H: '♥' };
export const RANK_LABEL: Record<number, string> = { 11: 'В', 12: 'Д', 13: 'К', 14: 'Т', 15: '★' };
export const RANK_NAME: Record<number, string> = { 11: 'валет', 12: 'дама', 13: 'король', 14: 'туз', 15: 'джокер' };

export const isRed = (c: Card) => c.s === 'H' || c.s === 'D';
export const rankLabel = (r: number) => RANK_LABEL[r] ?? String(r);
export const cardId = (c: Card) => c.s + c.r;
export const sameCard = (a: Card, b: Card) => a.s === b.s && a.r === b.r;
export const cardName = (c: Card) => `${RANK_NAME[c.r] ?? c.r} ${SUIT_NAME[c.s]}`;

/** Колода: 32 (с семёрок), 36 (с шестёрок), 52 (с двоек), 54 (+2 джокера). */
export function makeDeck(size: 24 | 32 | 36 | 52 | 54 = 36): Card[] {
  const from = size === 24 ? 9 : size === 32 ? 7 : size === 36 ? 6 : 2;
  const out: Card[] = [];
  for (const s of SUITS) for (let r = from; r <= 14; r++) out.push({ s, r });
  if (size === 54) out.push({ s: 'H', r: 15 }, { s: 'S', r: 15 });
  return out;
}

export function shuffledDeck(size: 24 | 32 | 36 | 52 | 54, rng: Rng): Card[] {
  return shuffle(makeDeck(size), rng);
}

/** Сортировка руки: по масти (козырь в конце), внутри — по старшинству. */
export function sortHand(hand: Card[], trump?: Suit | null): Card[] {
  const order = (s: Suit) => (s === trump ? 9 : SUITS.indexOf(s));
  return hand.slice().sort((a, b) => order(a.s) - order(b.s) || a.r - b.r);
}
