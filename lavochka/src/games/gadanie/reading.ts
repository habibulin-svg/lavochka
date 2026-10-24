/* Гадание: колода, тасовка, вытянутые карты и итог расклада. Без DOM — стол, тесты и сервер (Светка) читают одно и то же.
 * Карта гадания — число: у таро 0…77 (src/cards/tarot.ts), у обычной колоды — индекс в колоде 36 (KARTY36). */
import { makeDeck, type Card } from '../../cards/deck';
import { shuffle } from '../../core/rng';
import type { Rng } from '../../core/types';
import { isMajor, tarotLabel, tarotName, TAROT_SIZE } from '../../cards/tarot';
import { spreadSize, type DeckKind, type Spread } from './spreads';
import taroData from './data/taro.json';
import kartyData from './data/karty36.json';

export interface TaroMeaning {
  name: string;
  pic: string;
  up: string[];
  down: string[];
  upText: string;
  downText: string;
  love: string;
  work: string;
  advice: string;
  /** «Да/нет»: [прямо, перевёрнуто], 1 — да, 0 — смотря как, −1 — нет. */
  yn: [number, number];
}

export interface KartaMeaning {
  key: string;
  name: string;
  short: string;
  up: string[];
  text: string;
  yn: number;
}

export interface KartyData {
  suits: Record<'S' | 'C' | 'D' | 'H', string>;
  cards: KartaMeaning[];
  persons: Record<string, string>;
  combos: { rank: number; count: number; text: string }[];
  near: { a: string; b: string; text: string }[];
}

export const TARO = taroData as TaroMeaning[];
export const KARTY = kartyData as KartyData;
/** Обычная колода гадания: 36 карт, порядок — как в справочнике (пики, трефы, бубны, черви; 6…туз). */
export const KARTY36: Card[] = makeDeck(36);
const KEY = (c: Card) => c.s + c.r;
const KARTA_BY_KEY = new Map(KARTY.cards.map((m) => [m.key, m]));
export const kartaMeaning = (i: number) => KARTA_BY_KEY.get(KEY(KARTY36[i]))!;

export interface Drawn {
  card: number;
  /** Перевёрнута (только таро). */
  rev: boolean;
}

export interface ReadingOpts {
  /** Перевёрнутые карты (таро). */
  reversed: boolean;
  /** Только старшие арканы. */
  majors: boolean;
  /** На кого гадают (обычная колода, «на короля»): эта карта не тянется. */
  person?: number;
}

/** Колода для расклада: перетасованные карты и у каждой — лежит ли она вверх ногами. */
export function shuffleDeck(deck: DeckKind, opts: ReadingOpts, rng: Rng): Drawn[] {
  let cards = deck === 'taro' ? Array.from({ length: TAROT_SIZE }, (_, i) => i) : KARTY36.map((_, i) => i);
  if (deck === 'taro' && opts.majors) cards = cards.filter(isMajor);
  if (opts.person != null) cards = cards.filter((c) => c !== opts.person);
  return shuffle(cards, rng).map((card) => ({ card, rev: deck === 'taro' && opts.reversed && rng.next() < 0.5 }));
}

/** Имя карты гадания: «Туз Жезлов», «XVI. Башня», «дама червей». */
export function drawnName(deck: DeckKind, c: number, label = false): string {
  if (deck === 'taro') return label ? tarotLabel(c) : tarotName(c);
  return kartaMeaning(c).name;
}

/** Места расклада, по которым разложены карты по порядку вытягивания (у места на 2 карты — два раза подряд). */
export function slotsOf(s: Spread): number[] {
  return s.spots.flatMap((p, i) => Array.from({ length: p.n ?? 1 }, () => i));
}

export type Verdict = { word: 'да' | 'нет' | 'не ясно' | 'сбудется' | 'не сбудется' | 'сбудется не сразу'; text: string };

/** Итог расклада с особым ответом: «да/нет» по большинству, «на желание» — по червям. */
export function verdictOf(s: Spread, cards: Drawn[]): Verdict | null {
  if (cards.length < spreadSize(s)) return null;
  if (s.verdict === 'yesno') {
    const votes = cards.map((d) => (s.deck === 'taro' ? TARO[d.card].yn[d.rev ? 1 : 0] : kartaMeaning(d.card).yn));
    const sum = votes.reduce((a, b) => a + b, 0);
    const yes = votes.filter((v) => v > 0).length;
    const no = votes.filter((v) => v < 0).length;
    if (sum > 0) return { word: 'да', text: yes === votes.length ? 'Все карты говорят «да».' : 'Карт за «да» больше, чем против.' };
    if (sum < 0) return { word: 'нет', text: no === votes.length ? 'Все карты говорят «нет».' : 'Карт за «нет» больше, чем за «да».' };
    return { word: 'не ясно', text: 'Карты разошлись: ответ зависит от того, как вы поступите. Посмотрите, что советует каждая.' };
  }
  if (s.verdict === 'wish') {
    const keys = cards.map((d) => KEY(KARTY36[d.card]));
    const hearts = keys.filter((k) => k[0] === 'H').length;
    const spades = keys.filter((k) => k[0] === 'S').length;
    if (keys.includes('H14') || keys.includes('H9'))
      return { word: 'сбудется', text: `${keys.includes('H14') ? 'Червонный туз' : 'Девятка червей'} — желание сбудется${spades ? ', хоть пики и обещают помехи' : ''}.` };
    if (hearts >= 2 && hearts > spades) return { word: 'сбудется не сразу', text: `Червей ${hearts} — желание исполнится, но придётся подождать.` };
    return { word: 'не сбудется', text: spades ? 'Ни туза, ни девятки червей, а пики встали поперёк — в этот раз не судьба. Загадайте в другой день.' : 'Ни туза, ни девятки червей — в этот раз не вышло. Загадайте в другой день.' };
  }
  return null;
}

/** Одинаковые карты среди вытянутых (обычная колода): «три девятки — …». */
export function combosOf(cards: Drawn[]): string[] {
  const by = new Map<number, number>();
  for (const d of cards) {
    const r = KARTY36[d.card].r;
    by.set(r, (by.get(r) ?? 0) + 1);
  }
  const out: string[] = [];
  for (const [rank, count] of [...by].sort((a, b) => b[1] - a[1] || b[0] - a[0])) {
    if (count < 2) continue;
    const c = KARTY.combos.find((x) => x.rank === rank && x.count === count);
    if (c) out.push(c.text);
  }
  return out;
}

/** Известные пары рядом (обычная колода). */
export function nearOf(cards: Drawn[]): string[] {
  const keys = new Set(cards.map((d) => KEY(KARTY36[d.card])));
  return KARTY.near.filter((n) => keys.has(n.a) && keys.has(n.b)).map((n) => n.text);
}

/** Сколько у таро старших арканов в раскладе — «судьбоносность» (у Уэйта старшие весомее младших). */
export const majorCount = (cards: Drawn[]) => cards.filter((d) => isMajor(d.card)).length;
