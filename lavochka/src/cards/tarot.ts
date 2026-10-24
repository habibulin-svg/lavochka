/* Колода таро: 78 карт — 22 старших аркана и 4 масти по 14. Без DOM — для гадания и игры во французское таро.
 * Карта — число 0…77: 0…21 — старшие (номер аркана), дальше масти по 14 карт: жезлы, кубки, мечи, пентакли;
 * внутри масти ранг 1 (туз) … 10, 11 — паж, 12 — рыцарь, 13 — королева, 14 — король.
 * Рисунок — колода Уэйта — Смит 1909 (tools/tarot/cards.py): public/tarot/rws/<file>.webp, крупно — big/<file>.webp. */
import { shuffle } from '../core/rng';
import type { Rng } from '../core/types';

export type TarotSuit = 'W' | 'C' | 'S' | 'P';
export const TAROT_SUITS: TarotSuit[] = ['W', 'C', 'S', 'P'];

/** Масть во множественном числе (родительный падеж — для «Туз Жезлов»). */
export const SUIT_TITLE: Record<TarotSuit, string> = { W: 'Жезлы', C: 'Кубки', S: 'Мечи', P: 'Пентакли' };
export const SUIT_GEN: Record<TarotSuit, string> = { W: 'Жезлов', C: 'Кубков', S: 'Мечей', P: 'Пентаклей' };

/** Старшие арканы по Уэйту: Сила — VIII, Справедливость — XI. */
export const MAJORS = [
  'Шут', 'Маг', 'Верховная Жрица', 'Императрица', 'Император', 'Иерофант', 'Влюблённые', 'Колесница', 'Сила', 'Отшельник',
  'Колесо Фортуны', 'Справедливость', 'Повешенный', 'Смерть', 'Умеренность', 'Дьявол', 'Башня', 'Звезда', 'Луна', 'Солнце',
  'Суд', 'Мир',
];

const RANK_TITLE = ['', 'Туз', 'Двойка', 'Тройка', 'Четвёрка', 'Пятёрка', 'Шестёрка', 'Семёрка', 'Восьмёрка', 'Девятка', 'Десятка', 'Паж', 'Рыцарь', 'Королева', 'Король'];
const ROMAN = ['0', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX', 'XXI'];

export const TAROT_SIZE = 78;
export const isMajor = (c: number) => c < 22;
export const suitOf = (c: number): TarotSuit | null => (c < 22 ? null : TAROT_SUITS[Math.floor((c - 22) / 14)]);
/** Ранг младшей карты 1…14; у старшей — номер аркана. */
export const rankOf = (c: number) => (c < 22 ? c : ((c - 22) % 14) + 1);
export const minor = (s: TarotSuit, r: number) => 22 + TAROT_SUITS.indexOf(s) * 14 + r - 1;
export const isCourt = (c: number) => !isMajor(c) && rankOf(c) > 10;

/** Имя файла рисунка: M00…M21, W1…P14. */
export const tarotFile = (c: number) => (c < 22 ? 'M' + String(c).padStart(2, '0') : suitOf(c)! + rankOf(c));

/** «Шут», «Туз Жезлов», «Королева Мечей». */
export function tarotName(c: number): string {
  return isMajor(c) ? MAJORS[c] : `${RANK_TITLE[rankOf(c)]} ${SUIT_GEN[suitOf(c)!]}`;
}

/** Подпись с номером: «XVI. Башня»; у младших — просто имя. */
export const tarotLabel = (c: number) => (isMajor(c) ? `${ROMAN[c]}. ${MAJORS[c]}` : tarotName(c));
export const roman = (n: number) => ROMAN[n];

export const tarotDeck = (): number[] => Array.from({ length: TAROT_SIZE }, (_, i) => i);
export const majorsOnly = (): number[] => Array.from({ length: 22 }, (_, i) => i);
export const shuffledTarot = (rng: Rng, deck = tarotDeck()) => shuffle(deck, rng);

/** Пропорции карты (скан 2100×3600). */
export const TAROT_RATIO = 7 / 12;
