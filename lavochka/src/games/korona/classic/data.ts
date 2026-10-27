/**
 * «Корона Эмбера», «Классика 1994» — данные оригинала: путники, принцы, предметы, тексты карт и клеток.
 * JSON в data/ — дословные выгрузки из PDF игры (docs/analysis/korona/src/, см. docs/analysis/korona-classic.md).
 */
import advRaw from './data/adventures.json';
import charRaw from './data/characters.json';
import field1Raw from './data/field1.json';
import itemsRaw from './data/items.json';
import type { Align, Stat } from './script';

/** Название поля для сравнения: без кавычек, пометок в скобках, «ё», регистра и лишних пробелов. */
export const norm = (s: string) =>
  s
    .toUpperCase()
    .replace(/Ё/g, 'Е')
    .replace(/\(.*?\)/g, '')
    .replace(/^ПОДПОЛЕ\s+/, '')
    .replace(/[«»"„“”]/g, '')
    .replace(/ОРУЖЕНАЯ/g, 'ОРУЖЕЙНАЯ')
    .replace(/ВЫЖЖЕНАЯ/g, 'ВЫЖЖЕННАЯ')
    .replace(/ПОСТОЯННЫЙ/g, 'ПОСТОЯЛЫЙ')
    .replace(/ЗАГОТОВКОНТОРА/g, 'ЗАГОТКОНТОРА')
    .replace(/\s+/g, ' ')
    .trim();

export interface CellText {
  id: number;
  name: string;
  text: string;
}
/** Клетки поля 1 с дословными условиями (номера — как в разметке `korona/data.json`). */
export const CELL_TEXT: CellText[] = (field1Raw.cells as { id: number | null; name: string; text: string }[])
  .filter((c) => c.id != null)
  .map((c) => ({ id: c.id!, name: c.name, text: c.text }));
const cellByName = new Map<string, number[]>();
for (const c of CELL_TEXT) {
  const k = norm(c.name);
  cellByName.set(k, [...(cellByName.get(k) ?? []), c.id]);
}
/** Номера клеток по названию (у «Прерии», «Пустыни» и обменных пунктов их по две). */
export function cellsNamed(name: string): number[] {
  const k = norm(name);
  const hit = cellByName.get(k);
  if (hit) return hit;
  // «Храм Бааля» на поле — это и клетка-вход, и подполе; «Пик Олимп» без кавычек и т.п.
  for (const [key, ids] of cellByName) if (key.startsWith(k) || k.startsWith(key)) return ids;
  return [];
}
export const cellName = (id: number) => CELL_TEXT.find((c) => c.id === id)?.name ?? `поле ${id}`;
export const cellText = (id: number) => CELL_TEXT.find((c) => c.id === id)?.text ?? '';

// ---------- карты приключений (тексты) ----------

export interface AdvText {
  n: number;
  title: string;
  kind: string | null;
  text: string;
}
export const ADV_TEXT: AdvText[] = advRaw as AdvText[];
export const advText = (n: number) => ADV_TEXT.find((a) => a.n === n);

// ---------- путники и принцы ----------

export interface Traveller {
  id: number;
  name: string;
  sex: 'м' | 'ж';
  align: Align;
  honest: boolean;
  patient: boolean;
  life: number;
  st: Record<Stat, number>;
  gold: number;
  /** клетка старта */
  start: number;
  /** личный предмет (имя карты предмета, место — имя путника) */
  own?: string;
  /** особенности путника дословно */
  text: string;
}

const alignOf = (traits: string[]): Align => (traits.some((t) => t.startsWith('добр')) ? 'добрый' : traits.some((t) => t.startsWith('зл')) ? 'злой' : 'нейтральный');

type RawTraveller = { name: string; sex: string; traits: string[]; stats: Record<string, number>; gold: number; start: string; text: string };
export const TRAVELLERS: Traveller[] = (charRaw.travellers as RawTraveller[]).map((t, id) => {
  const startName = t.start.replace(/,\s*Мир\s+\S+$/, '');
  const own = /ЛИЧНЫЙ ПРЕДМЕТ:\s*(\S+)/.exec(t.text)?.[1]?.toLowerCase();
  return {
    id,
    name: t.name,
    sex: t.sex === 'ж' ? 'ж' : 'м',
    align: alignOf(t.traits),
    honest: t.traits.some((x) => x.startsWith('честн')),
    patient: t.traits.some((x) => x.startsWith('терпел')),
    life: t.stats['жизнь'],
    st: { ПС: t.stats['сила'], ПУ: t.stats['ум'], ПМ: t.stats['магия'] },
    gold: t.gold,
    start: cellsNamed(startName)[0] ?? 72,
    own,
    text: t.text,
  };
});

export interface Prince {
  name: string;
  sex: 'м' | 'ж';
  align: Align;
  honest: boolean;
  patient: boolean;
  life: number;
  st: Record<Stat, number>;
}
type RawPrince = { name: string; title?: string; traits: string[]; stats: Record<string, number> };
export const PRINCES: Prince[] = (charRaw.princes as RawPrince[]).map((p) => ({
  name: p.name,
  sex: p.title?.toLowerCase().includes('принцесса') ? 'ж' : 'м',
  align: alignOf(p.traits),
  honest: p.traits.some((x) => x.startsWith('честн')),
  patient: p.traits.some((x) => x.startsWith('терпел')),
  life: p.stats['жизнь'],
  st: { ПС: p.stats['сила'], ПУ: p.stats['ум'], ПМ: p.stats['магия'] },
}));

// ---------- предметы, амулеты, заклинания ----------

export type ItemKind = 'item' | 'magic' | 'owned' | 'amulet' | 'spell' | 'smuggle' | 'crown' | 'friend';

export interface ItemCard {
  /** индекс карты в items.json — её номер на поле предметов */
  id: number;
  /** где лежит на поле предметов («МАГШОП», «РАНЧО», имя путника для личных предметов) */
  place: string | null;
  name: string;
  kind: ItemKind;
  /** номер амулета / заклинания */
  num: number | null;
  /** цена в талерах (у векселя — сумма займа) */
  price: number | null;
  /** сколько ПО нужно, чтобы пользоваться */
  po: number;
  bonus: Partial<Record<Stat, number>>;
  uses: number | null;
  text: string;
}

type RawItem = { place: string | null; name: string; type: string; num: number | null; price: string | null; po: number | null; bonus: Record<string, number> | null; uses: string | null; text: string };
const STAT_RU: Record<string, Stat> = { сила: 'ПС', ум: 'ПУ', магия: 'ПМ' };
const kindOfItem = (t: string): ItemKind =>
  t.startsWith('амулет') ? 'amulet' : t.startsWith('заклинание') ? 'spell' : t.startsWith('контрабанда') ? 'smuggle' : t.startsWith('корона') ? 'crown' : t.startsWith('друг') ? 'friend' : t.includes('принадлежащий') ? 'owned' : t.includes('магический') ? 'magic' : 'item';
export const ITEMS: ItemCard[] = (itemsRaw as RawItem[]).map((r, id) => ({
  id,
  place: r.place,
  name: r.name.toLowerCase(),
  kind: kindOfItem(r.type),
  num: r.num,
  price: r.price ? Number(/\d+/.exec(r.price)?.[0] ?? 0) || null : null,
  po: r.po ?? 0,
  bonus: Object.fromEntries(Object.entries(r.bonus ?? {}).map(([k, v]) => [STAT_RU[k], v])) as Partial<Record<Stat, number>>,
  uses: r.uses ? Number(/\d+/.exec(r.uses)?.[0] ?? 1) : null,
  text: r.text,
}));
/** Карты предметов, лежащие на месте торговли (по названию поля). */
export const itemsAt = (place: string) => ITEMS.filter((i) => i.place && norm(i.place) === norm(place));
/** Первая свободная карта предмета по имени («шлем», «амулет №1», «корона регента мира силы»). */
export const itemNamed = (name: string) => ITEMS.filter((i) => i.name === name.toLowerCase());
