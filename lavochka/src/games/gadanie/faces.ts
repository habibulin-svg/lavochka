/* Картинки карт гадания: таро Уэйта — Смит (public/tarot/rws) и обычная колода (та, что выбрана в настройках). */
import type { Card } from '../../cards/deck';
import { cardUrl, deckStyle } from '../../cards/render';
import { tarotFile, tarotName } from '../../cards/tarot';
import type { StageOpts } from '../../cards/stage';
import { KARTY36 } from './reading';
import type { DeckKind } from './spreads';

const BASE = import.meta.env.BASE_URL;

/** Рубашка таро — нарисована в SVG (public/tarot/rws/back.svg): одинакова при повороте, перевёрнутую по ней не узнать. */
export const TARO_BACK = `${BASE}tarot/rws/back.svg`;
export const taroUrl = (c: number, big = false) => `${BASE}tarot/rws/${big ? 'big/' : ''}${tarotFile(c)}.webp`;

/** Сцена карт (CardStage) знает только {s, r}: таро кладём в те же поля, как ханафуду. */
const SUITS = 'SCDH';
export const taroToStage = (c: number): Card => ({ s: SUITS[c & 3] as Card['s'], r: (c >> 2) + 1 });
export const taroFromStage = (c: Card) => (c.r - 1) * 4 + SUITS.indexOf(c.s);

/** Карта гадания → карта сцены. */
export const toStage = (deck: DeckKind, c: number): Card => (deck === 'taro' ? taroToStage(c) : KARTY36[c]);

/** Размер карты таро на сцене (скан 7:12). */
export const TARO_CARD = { w: 100, h: 171 };

export function stageOpts(deck: DeckKind): StageOpts {
  if (deck !== 'taro') return {};
  return {
    card: TARO_CARD,
    faces: {
      url: (c) => (c ? taroUrl(taroFromStage(c)) : TARO_BACK),
      alt: (c) => (c ? tarotName(taroFromStage(c)) : 'рубашка'),
    },
  };
}

/** Большая картинка карты (окно с толкованием, справочник). */
export const bigUrl = (deck: DeckKind, c: number) => (deck === 'taro' ? taroUrl(c, true) : cardUrl(KARTY36[c], deckStyle()));
export const smallUrl = (deck: DeckKind, c: number) => (deck === 'taro' ? taroUrl(c) : cardUrl(KARTY36[c], deckStyle()));
export const backUrl = (deck: DeckKind) => (deck === 'taro' ? TARO_BACK : cardUrl(null, deckStyle()));
