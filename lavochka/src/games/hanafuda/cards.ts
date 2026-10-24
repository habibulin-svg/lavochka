/* Колода ханафуды (хвату): 48 карт, 12 месяцев по 4. Без DOM.
 * Карта — число 0…47: месяц = id >> 2 (0 — январь, сосна … 11 — декабрь, павлония), место в месяце = id & 3:
 * сначала «лучшая» карта месяца (свет или животное), потом лента (или второе животное), в конце — пустые (касу).
 * В корейской колоде ноябрь и декабрь переставлены (11 — павлония, 12 — ива с дождём): растения те же, меняются только номера. */

export type Kind = 'hikari' | 'tane' | 'tan' | 'kasu';
/** Лента: красная со стихом, красная простая, синяя. */
export type Ribbon = 'poem' | 'red' | 'blue';

export interface CardInfo {
  id: number;
  month: number;
  kind: Kind;
  ribbon?: Ribbon;
  /** Короткое имя по-русски: «журавль», «занавес», «луна»… */
  name: string;
  /** Имя файла рисунка (public/hanafuda/<набор>/<file>.webp). */
  file: string;
}

export const MONTHS = ['Сосна', 'Слива', 'Вишня', 'Глициния', 'Ирис', 'Пион', 'Леспедеца', 'Мискантус', 'Хризантема', 'Клён', 'Ива', 'Павлония'];
/** Месяц по-японски (для подписи) и по-корейски — номер месяца у хвату. */
export const MONTH_NUM_JP = (m: number) => m + 1;
export const MONTH_NUM_KR = (m: number) => (m === 10 ? 12 : m === 11 ? 11 : m + 1);

const EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

type Row = [Kind, string, Ribbon?];
const MONTH_CARDS: Row[][] = [
  [['hikari', 'журавль'], ['tan', 'лента со стихом', 'poem'], ['kasu', 'сосна'], ['kasu', 'сосна']],
  [['tane', 'соловей'], ['tan', 'лента со стихом', 'poem'], ['kasu', 'слива'], ['kasu', 'слива']],
  [['hikari', 'занавес'], ['tan', 'лента со стихом', 'poem'], ['kasu', 'вишня'], ['kasu', 'вишня']],
  [['tane', 'кукушка'], ['tan', 'красная лента', 'red'], ['kasu', 'глициния'], ['kasu', 'глициния']],
  [['tane', 'мостик'], ['tan', 'красная лента', 'red'], ['kasu', 'ирис'], ['kasu', 'ирис']],
  [['tane', 'бабочки'], ['tan', 'синяя лента', 'blue'], ['kasu', 'пион'], ['kasu', 'пион']],
  [['tane', 'кабан'], ['tan', 'красная лента', 'red'], ['kasu', 'леспедеца'], ['kasu', 'леспедеца']],
  [['hikari', 'луна'], ['tane', 'гуси'], ['kasu', 'мискантус'], ['kasu', 'мискантус']],
  [['tane', 'чашка сакэ'], ['tan', 'синяя лента', 'blue'], ['kasu', 'хризантема'], ['kasu', 'хризантема']],
  [['tane', 'олень'], ['tan', 'синяя лента', 'blue'], ['kasu', 'клён'], ['kasu', 'клён']],
  [['hikari', 'человек под дождём'], ['tane', 'ласточка'], ['tan', 'красная лента', 'red'], ['kasu', 'гроза']],
  [['hikari', 'феникс'], ['kasu', 'павлония'], ['kasu', 'павлония'], ['kasu', 'павлония']],
];

const FILE_KIND: Record<Kind, string> = { hikari: 'Hikari', tane: 'Tane', tan: 'Tanzaku', kasu: 'Kasu' };

export const CARDS: CardInfo[] = MONTH_CARDS.flatMap((row, m) => {
  let kasu = 0;
  return row.map(([kind, name, ribbon], k) => {
    const file = `${EN[m]}_${FILE_KIND[kind]}${kind === 'kasu' ? '_' + ++kasu : ''}`;
    return { id: m * 4 + k, month: m, kind, ribbon, name, file };
  });
});

export const monthOf = (id: number) => id >> 2;
export const info = (id: number) => CARDS[id];

// именованные карты
export const CRANE = 0;
export const CURTAIN = 8;
export const BOAR = 24;
export const MOON = 28;
export const GEESE = 29;
export const SAKE = 32;
export const DEER = 36;
export const BUTTERFLY = 20;
export const RAIN = 40;
export const SWALLOW = 41;
export const LIGHTNING = 43;
export const PHOENIX = 44;
export const WARBLER = 4;
export const CUCKOO = 12;
export const BRIGHTS = [CRANE, CURTAIN, MOON, RAIN, PHOENIX];
/** Двойные пустые (ссангпи) в го-стопе: гроза (ива) и жёлтая пустая павлонии. */
export const SSANGPI = [LIGHTNING, 46];

export const DECK = (): number[] => CARDS.map((c) => c.id);
