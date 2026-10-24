/* Гадание — разделы и адреса (без DOM: экрану, пререндеру и тестам). Раздел — `/gadanie-na-kartah/<раздел>/`;
 * у каждой карты — своя страница в справочнике: `/gadanie-na-kartah/znacheniya-kart/<карта>/` (таро — «devyatka-mechej»,
 * игральные — «shestyorka-pik»). */
import { tarotName, TAROT_SIZE } from '../../cards/tarot';
import { slug } from '../kruzhok/pages';
import { KARTY36, kartaMeaning } from './reading';
import type { DeckKind } from './spreads';

export const GADANIE_PATH = 'gadanie-na-kartah';

export const MODES = [
  { id: 'vybor', label: 'Выбор колоды', hint: 'таро или обычная колода', path: null },
  { id: 'taro', label: 'На таро', hint: '12 раскладов на колоде Уэйта — Смит', path: 'taro' },
  { id: 'karty', label: 'На обычной колоде', hint: 'бабушкино гадание на 36 картах', path: 'na-igralnyh-kartah' },
  { id: 'znacheniya', label: 'Справочник', hint: 'значения всех карт', path: 'znacheniya-kart' },
] as const;

const REF = 'znacheniya-kart';

/** Часть адреса карты: у таро — по имени («shut», «devyatka-mechej»), у игральных — «shestyorka-pik». */
export const cardSlug = (deck: DeckKind, c: number) => slug(deck === 'taro' ? tarotName(c) : kartaMeaning(c).name);
export const cardPath = (deck: DeckKind, c: number) => `/${GADANIE_PATH}/${REF}/${cardSlug(deck, c)}/`;

const BY_SLUG = new Map<string, { deck: DeckKind; card: number }>();
for (let c = 0; c < TAROT_SIZE; c++) BY_SLUG.set(cardSlug('taro', c), { deck: 'taro', card: c });
KARTY36.forEach((_, i) => BY_SLUG.set(cardSlug('karty', i), { deck: 'karty', card: i }));

/** Раздел по адресу: «/gadanie-na-kartah/taro/» → taro; страница карты → справочник с этой картой. */
export function parseGadanie(pathname: string): { mode: string; deck?: DeckKind; card?: number } | null {
  const parts = pathname.replace(/^\/+|\/+$/g, '').split('/');
  if (parts[0] !== GADANIE_PATH) return null;
  if (parts.length === 1) return { mode: 'vybor' };
  if (parts.length === 3 && parts[1] === REF) {
    const hit = BY_SLUG.get(parts[2]);
    return hit ? { mode: 'znacheniya', ...hit } : null;
  }
  const m = MODES.find((x) => x.path === parts[1]);
  return m && parts.length === 2 ? { mode: m.id } : null;
}
