/* Отрисовка карт: сканы трёх советских колод (атласная, славянская, «Русский стиль»), собранные
 * скриптом tools/cards/build.py в public/cards/<колода>/<масть><ранг>.webp; рубашка — back.webp.
 * «Классическая» (Лавочка+, право cosmetics) — Vector Playing Cards, LGPL-3.0, tools/cards/classic.py.
 * Картон, потёртости и скругление уже в картинке; тень и блик — в CSS (.card). */
import { settings, type DeckStyle } from '../core/settings';
import { cardName, type Card } from './deck';

/** Пропорции карты: 58×90 мм. */
export const CARD_RATIO = 320 / 496;

const BASE = import.meta.env.BASE_URL;

export function cardUrl(c: Card | null, st: DeckStyle): string {
  return `${BASE}cards/${st}/${c ? c.s + c.r : 'back'}.webp`;
}

/** Джокер: в сканах колод его нет — рисуем в CSS той же бумагой и тем же шрифтом индекса, что у колоды. */
export function jokerHTML(c: Card, st: DeckStyle, cls = 'card'): string {
  const red = c.s === 'H' || c.s === 'D' ? 1 : 0;
  return `<span class="${cls} card-joker" data-deck="${st}" data-red="${red}" role="img" aria-label="джокер"><i>ДЖОКЕР</i><b>★</b><i>ДЖОКЕР</i></span>`;
}

/** Карта как HTML. null — рубашка. */
export function cardHTML(c: Card | null, st: DeckStyle, cls = 'card'): string {
  if (c && c.r === 15) return jokerHTML(c, st, cls);
  return `<img class="${cls}" src="${cardUrl(c, st)}" alt="${c ? cardName(c) : 'рубашка'}" draggable="false" decoding="async">`;
}

/** Подгруженные картинки: держим ссылки, чтобы браузер не выбросил раскодированное. */
const loaded = new Map<string, HTMLImageElement[]>();
/** Те же картинки по адресу — для 3D-текстур (холдем). */
const byUrl = new Map<string, HTMLImageElement>();
/** Подгрузить и раскодировать колоду заранее, чтобы при раздаче и перевороте карты не мигали пустотой. */
export function preloadDeck(st: DeckStyle) {
  if (loaded.has(st)) return;
  const urls = [cardUrl(null, st)];
  for (const s of ['S', 'C', 'D', 'H'] as const) for (let r = 2; r <= 14; r++) urls.push(cardUrl({ s, r }, st));
  loaded.set(
    st,
    urls.map((u) => {
      const im = new Image();
      // колода нужна раньше моделей и роликов, которые грузятся рядом
      im.fetchPriority = 'high';
      im.src = u;
      byUrl.set(u, im);
      im.decode().catch(() => {
        /* не раскодировалась заранее — раскодируется при показе */
      });
      return im;
    })
  );
}

/** Сколько колоды уже пришло (0…1); колода не заказана — 0. Для заставки холдема. */
export function deckProgress(st: DeckStyle): number {
  const list = loaded.get(st);
  if (!list) return 0;
  return list.filter((im) => im.complete).length / list.length;
}

/** Картинка карты, подгруженная preloadDeck (может быть ещё в пути). */
export function deckImage(url: string): HTMLImageElement | undefined {
  return byUrl.get(url);
}

export const DECK_STYLES: { id: DeckStyle; title: string; hint: string; plus?: true }[] = [
  { id: 'atlas', title: 'Атласные', hint: 'классическая советская колода' },
  { id: 'slavic', title: 'Славянские', hint: 'богатыри и узорочье' },
  { id: 'russian', title: 'Русский стиль', hint: 'бояре, стрельцы, боярыни' },
  { id: 'classic', title: 'Классическая', hint: 'как в покер-клубе: J, Q, K, A', plus: true },
];

/** Есть ли право на оформление из «Лавочки+» (сайт подставляет проверку по аккаунту). */
let cosmetics = () => false;
export function setCosmetics(f: () => boolean) {
  cosmetics = f;
}
export const mayDeck = (st: DeckStyle) => !DECK_STYLES.find((d) => d.id === st)?.plus || cosmetics();
/** Колода за столом: выбранная, а платная без подписки — атласная. */
export const deckStyle = (): DeckStyle => (mayDeck(settings.deck) ? settings.deck : 'atlas');
