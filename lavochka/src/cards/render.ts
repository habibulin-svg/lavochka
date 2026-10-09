/* Отрисовка карт: сканы трёх советских колод (атласная, славянская, «Русский стиль»), собранные
 * скриптом tools/cards/build.py в public/cards/<колода>/<масть><ранг>.webp; рубашка — back.webp.
 * Картон, потёртости и скругление уже в картинке; тень и блик — в CSS (.card). */
import type { DeckStyle } from '../core/settings';
import { cardName, type Card } from './deck';

/** Пропорции карты: 58×90 мм. */
export const CARD_RATIO = 320 / 496;

const BASE = import.meta.env.BASE_URL;

export function cardUrl(c: Card | null, st: DeckStyle): string {
  return `${BASE}cards/${st}/${c ? c.s + c.r : 'back'}.webp`;
}

/** Карта как HTML. null — рубашка. Джокера в колодах нет — рисуем простой картонкой. */
export function cardHTML(c: Card | null, st: DeckStyle, cls = 'card'): string {
  if (c && c.r === 15) return `<span class="${cls} card-joker" data-red="${c.s === 'H' || c.s === 'D' ? 1 : 0}"><b>★</b><small>ДЖОКЕР</small></span>`;
  return `<img class="${cls}" src="${cardUrl(c, st)}" alt="${c ? cardName(c) : 'рубашка'}" draggable="false" decoding="async">`;
}

const loaded = new Set<string>();
/** Подгрузить колоду заранее, чтобы при раздаче карты не мигали. */
export function preloadDeck(st: DeckStyle) {
  if (loaded.has(st)) return;
  loaded.add(st);
  const urls = [cardUrl(null, st)];
  for (const s of ['S', 'C', 'D', 'H'] as const) for (let r = 2; r <= 14; r++) urls.push(cardUrl({ s, r }, st));
  for (const u of urls) {
    const im = new Image();
    im.decoding = 'async';
    im.src = u;
  }
}

export const DECK_STYLES: { id: DeckStyle; title: string; hint: string }[] = [
  { id: 'atlas', title: 'Атласные', hint: 'классическая советская колода' },
  { id: 'slavic', title: 'Славянские', hint: 'богатыри и узорочье' },
  { id: 'russian', title: 'Русский стиль', hint: 'бояре, стрельцы, боярыни' },
];
