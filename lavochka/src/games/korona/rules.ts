/**
 * «Корона Эмбера 1994» — правила и таблицы.
 *
 * Числа собраны из книжки правил (tools/korona/rules-raw.json) и отчёта разбора
 * (docs/analysis/korona-embera.md, §3.4): характеристики ПС/ПУ/ПМ/ПО, талеры, амулеты и мечи,
 * четыре мира поля 1, зоны поля 2 (лабиринт, покои, тронный зал, арена).
 *
 * Точные формулы боёв и проверок характеристик вычитываются из rules-raw.json при написании
 * engine.ts — здесь только то, что уже точно известно.
 */

/** Четыре характеристики героя. ПС — сила, ПУ — ум, ПМ — магия, ПО — самая ходовая (опыт/обаяние). */
export const STATS = ['ПС', 'ПУ', 'ПМ', 'ПО'] as const;
export type Stat = (typeof STATS)[number];

export const STAT_NAMES: Record<Stat, string> = {
  ПС: 'Сила',
  ПУ: 'Ум',
  ПМ: 'Магия',
  ПО: 'Опыт',
};

export interface Hero {
  /** характеристики */
  st: Record<Stat, number>;
  /** талеры (деньги) */
  thalers: number;
  /** амулеты и мечи в котомке */
  items: number[];
}

export const START: Record<Stat, number> = { ПС: 3, ПУ: 3, ПМ: 3, ПО: 3 };
export const START_THALERS = 20;
/** Сколько предметов помещается в котомку (по правилам — ограниченная поклажа). */
export const PACK_LIMIT = 4;

/** Миры поля 1 и сколько в них клеток (из data.json: 76 игровых клеток). */
export const WORLDS = [
  { id: 'magic', name: 'Мир Магии', cells: 17 },
  { id: 'mind', name: 'Мир Ума', cells: 17 },
  { id: 'might', name: 'Мир Силы', cells: 17 },
  { id: 'gold', name: 'Мир Золота', cells: 18 },
] as const;
export type WorldId = (typeof WORLDS)[number]['id'] | 'between';

/** Межмировые клетки: обменные пункты, ЛАЗАРЕТ и ЗАГОТКОНТОРА (9 позиций в data.json). */
export const BETWEEN_KINDS = ['exchange', 'hospital', 'office'] as const;
export type BetweenKind = (typeof BETWEEN_KINDS)[number];

/** Cross-клетки поля 1: на них бросок кубика решает, что делать (см. links-special.txt). */
export const CROSS_CELLS = [
  { name: 'ПУСТОШЬ', pair: 'АЭРОПОРТ' },
  { name: 'ЗАБРОШЕННОЕ ШОССЕ', pair: 'РОСТОВЩИК' },
] as const;

/** ПРОВАЛЫ: через них уходят во вторую часть — «Королевство Эмбер». */
export const FALLS = 3;

/** Поле 2: зоны (field2.json). */
export const ZONES = ['road', 'labyrinth', 'palace', 'chambers', 'throne', 'arena'] as const;
export type ZoneId = (typeof ZONES)[number];

/** Дворцовые покои: четыре клетки, шаг 56,7 pt, «движешься на 1 поле за 1 ход». */
export const CHAMBERS = [
  { n: 1, pj: 3 },
  { n: 2, pj: 2 },
  { n: 3, pj: 1 },
  { n: 4, pj: 1 },
] as const;

/** Ворота лабиринта: слева выигрыш на 4–6, справа потеря на 1–3. */
export const GATES = {
  left: { roll: [4, 5, 6] as const, effect: 'take' as const },
  right: { roll: [1, 2, 3] as const, effect: 'give' as const },
};
/** Три кольца лабиринта. */
export const RINGS = 3;
/** Из центра лабиринта попадаешь во дворец. */
export const LABYRINTH_CENTER_TO: ZoneId = 'palace';

/** Коронация в тронном зале. */
export const CORONATION_TEXT = 'Ты коронован — становишься Владыкой Королевства Эмбер';
/** Арена: поединок принцев за корону. */
export const ARENA_RULE = 'поединок принцев: правила напечатаны на самом поле';

/** Сколько карточек приключений в оригинале и сколько уже нарезано. */
export const DECK_SIZE = 200;
export const CARDS_READY = 190;
