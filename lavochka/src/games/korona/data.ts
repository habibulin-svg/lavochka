/**
 * «Корона Эмбера» — доступ к данным игры.
 *
 * Четыре файла лежат рядом и собраны из PDF и отчёта разбора (см. tools/korona/):
 *  - data.json — поле 1: 81 позиция (76 клеток четырёх миров, два подполя, три панели);
 *  - links.json — 37 переходов между клетками («⇄» и «↕») + раздел special (cross-клетки, Провалы);
 *  - field2.json — поле 2 как зоны (дорога, лабиринт, дворец, покои, тронный зал, арена);
 *  - cards.json — 190 карточек приключений (текст, картинка, напечатанный номер).
 *
 * Координаты в точках PDF; растр отрендерен в 150 dpi, поэтому в пиксели переводим через SCALE.
 */
import cardsRaw from './cards.json';
import dataRaw from './data.json';
import field2Raw from './field2.json';
import linksRaw from './links.json';
import type { WorldId } from './rules';

export const SCALE = 150 / 72;

export interface KCell {
  n: number;
  name: string;
  world: string;
  col?: number;
  row?: number;
  x: number;
  y: number;
  w: number;
  h: number;
  panel?: boolean;
  subfield?: boolean;
}

export interface KLink {
  from: number | null;
  to: number | null;
  fromName: string;
  toName: string;
  x: number | null;
  y: number | null;
}

export interface KSpecial {
  text: string;
  x: number | null;
  y: number | null;
}

export interface KCard {
  n: number;
  num: number | null;
  page: number;
  text: string;
  img: string;
}

export const FIELD1 = { img: dataRaw.field.img as string, pt: dataRaw.field.pt as number[], scale: dataRaw.field.scale as number };
export const FIELD2 = { img: field2Raw.img as string, pt: field2Raw.pt as number[], scale: field2Raw.scale as number };

/** Все позиции поля 1 (включая подполя и панели). */
export const CELLS: KCell[] = dataRaw.cells as KCell[];
/** Игровые клетки поля 1 (без внеигровых панелей). */
export const PLAY_CELLS: KCell[] = CELLS.filter((c) => !c.panel);
/** Переходы между клетками. */
export const LINKS: KLink[] = linksRaw.links as KLink[];
/** Особые строки: cross-клетки и Провалы. */
export const SPECIAL: KSpecial[] = (linksRaw as { special?: KSpecial[] }).special ?? [];
/** Зоны поля 2. */
export const ZONES = field2Raw.zones as Record<string, unknown>[];
/** Карточки приключений. */
export const CARDS: KCard[] = cardsRaw.cards as KCard[];

const byNumber = new Map(CELLS.map((c) => [c.n, c]));
const linksFrom = new Map<number, KLink[]>();
for (const l of LINKS) {
  if (l.from == null) continue;
  const list = linksFrom.get(l.from) ?? [];
  list.push(l);
  linksFrom.set(l.from, list);
}

/** Клетка по её номеру на поле. */
export const cell = (n: number): KCell | undefined => byNumber.get(n);

/** Переходы, начинающиеся с клетки (знаки «⇄» и стрелки «↕»). */
export const linksOf = (n: number): KLink[] => linksFrom.get(n) ?? [];

/** Мир клетки в терминах правил. */
export function worldOf(n: number): WorldId | 'between' {
  const c = byNumber.get(n);
  if (!c) return 'between';
  const w = c.world.toLowerCase();
  if (w.includes('маги')) return 'magic';
  if (w.includes('ума')) return 'mind';
  if (w.includes('силы')) return 'might';
  if (w.includes('золот')) return 'gold';
  return 'between';
}

/** Игровые клетки одного мира. */
export const cellsOfWorld = (w: WorldId): KCell[] => PLAY_CELLS.filter((c) => worldOf(c.n) === w);

/** Позиция центра клетки в пикселях растра поля 1. */
export const cellPx = (n: number): { x: number; y: number } | undefined => {
  const c = byNumber.get(n);
  return c ? { x: (c.x + c.w / 2) * SCALE, y: (c.y + c.h / 2) * SCALE } : undefined;
};

/** Карточка по напечатанному на ней номеру. */
export const cardByNumber = (num: number): KCard | undefined => CARDS.find((c) => c.num === num);
