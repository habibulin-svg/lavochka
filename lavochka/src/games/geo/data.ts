/* «География» — справочные данные без DOM: страны, территории и регионы (entities.json собирают tools/geo/shapes.mjs + wiki.py).
 * Контуры лежат отдельно, в public/geo/*.json (TopoJSON), и грузятся только в браузере (map.ts). */
import RAW from './entities.json';

export type Kind = 'country' | 'partial' | 'unrec' | 'dep' | 'region';
export type Layer = 'world' | 'ru' | 'us' | 'regions';

export interface Entity {
  id: string;
  /** Название по-русски. */
  n: string;
  /** Викиданные. */
  q?: string | null;
  k: Kind;
  /** Континенты (только мир): eu, as, af, na, sa, oc. */
  c?: string[];
  /** Чья территория / чей регион — id страны. */
  p?: string;
  l: Layer;
  /** Непризнанная республика внутри другой страны: контур — накладка поверх. */
  ovl?: 1;
  /** Статус оспаривается. */
  disp?: 1;
  cap?: string;
  pop?: number;
  area?: number;
  /** Статья в русской Википедии. */
  w?: string;
  /** Есть флаг / герб (картинки public/geo/f|a/<id>.webp). */
  f?: 1;
  a?: 1;
  /** Вместо герба — печать (штаты США). */
  seal?: 1;
}

export const ENTITIES = RAW as Entity[];
export const BY_ID: Record<string, Entity> = Object.fromEntries(ENTITIES.map((e) => [e.id, e]));
export const ent = (id: string) => BY_ID[id];

export const CONTINENTS: { id: string; title: string }[] = [
  { id: 'eu', title: 'Европа' },
  { id: 'as', title: 'Азия' },
  { id: 'af', title: 'Африка' },
  { id: 'na', title: 'Северная Америка' },
  { id: 'sa', title: 'Южная Америка' },
  { id: 'oc', title: 'Австралия и Океания' },
];

/** Страны с регионами в «Регионах стран» (код слоя в regions.json — объект с этим именем). */
export const REGION_COUNTRIES: { id: string; obj: string; title: string; unit: string }[] = [
  { id: 'DEU', obj: 'de', title: 'Германия', unit: 'земли' },
  { id: 'FRA', obj: 'fr', title: 'Франция', unit: 'регионы' },
  { id: 'ITA', obj: 'it', title: 'Италия', unit: 'области' },
  { id: 'ESP', obj: 'es', title: 'Испания', unit: 'автономные сообщества' },
  { id: 'GBR', obj: 'gb', title: 'Великобритания', unit: 'части королевства' },
  { id: 'CHE', obj: 'ch', title: 'Швейцария', unit: 'кантоны' },
  { id: 'AUT', obj: 'at', title: 'Австрия', unit: 'земли' },
  { id: 'CAN', obj: 'ca', title: 'Канада', unit: 'провинции и территории' },
  { id: 'AUS', obj: 'au', title: 'Австралия', unit: 'штаты и территории' },
  { id: 'BRA', obj: 'br', title: 'Бразилия', unit: 'штаты' },
  { id: 'MEX', obj: 'mx', title: 'Мексика', unit: 'штаты' },
];

export const SETS: { id: string; title: string }[] = [
  { id: 'world', title: 'Весь мир' },
  ...CONTINENTS,
  { id: 'ru', title: 'Регионы России' },
  { id: 'us', title: 'Штаты США' },
  { id: 'reg', title: 'Регионы стран' },
];

export const KIND_LABEL: Record<Kind, string> = {
  country: 'государство',
  partial: 'частично признанное государство',
  unrec: 'непризнанное государство',
  dep: 'зависимая территория',
  region: 'регион',
};

/** Что спрашиваем и чем отвечаем. */
export type Face = 'name' | 'flag' | 'arms' | 'capital' | 'outline' | 'parent';

export const FACE_LABEL: Record<Face, string> = {
  name: 'название',
  flag: 'флаг',
  arms: 'герб',
  capital: 'столица',
  outline: 'контур',
  parent: 'страна',
};

/** Регионы за морем — на карте страны не рисуются (в викторине остаются). */
export const OFF_MAP = new Set(['FR-GF', 'FR-MQ', 'FR-GP', 'FR-RE', 'FR-YT']);

/** У объекта есть то, что нужно показать. */
export function hasFace(e: Entity, f: Face): boolean {
  switch (f) {
    case 'name':
      return true;
    case 'flag':
      return !!e.f;
    case 'arms':
      return !!e.a;
    case 'capital':
      return !!e.cap;
    case 'outline':
      // у карликов (Ватикан, Монако, Базель) контур в Natural Earth — многоугольник из пары точек
      return (e.area ?? Infinity) >= 400;
    case 'parent':
      return !!e.p && !!BY_ID[e.p];
  }
}

export interface SetOpts {
  set: string;
  /** Регионы стран: id страны или 'all'. */
  country?: string;
  /** Мир: + непризнанные и зависимые территории. */
  hard?: boolean;
}

/** Все объекты набора. */
export function members(o: SetOpts): Entity[] {
  if (o.set === 'ru') return ENTITIES.filter((e) => e.l === 'ru');
  if (o.set === 'us') return ENTITIES.filter((e) => e.l === 'us');
  if (o.set === 'reg') return ENTITIES.filter((e) => e.l === 'regions' && (!o.country || o.country === 'all' || e.p === o.country));
  const kinds = o.hard ? ['country', 'partial', 'unrec', 'dep'] : ['country', 'partial'];
  return ENTITIES.filter((e) => e.l === 'world' && kinds.includes(e.k) && (o.set === 'world' || e.c?.includes(o.set)));
}

export const setTitle = (o: SetOpts) => {
  if (o.set === 'reg') return o.country && o.country !== 'all' ? `Регионы: ${REGION_COUNTRIES.find((c) => c.id === o.country)?.title}` : 'Регионы стран';
  return SETS.find((s) => s.id === o.set)?.title ?? o.set;
};

/** Карта, на которой ищут объект: слой и рамка. */
export interface Frame {
  layer: Layer;
  /** Рамка: id набора (мир/континент), 'ru', 'us' или код страны для регионов. */
  key: string;
}

export function frameOf(e: Entity, set: string): Frame {
  if (e.l === 'world') return { layer: 'world', key: set };
  if (e.l === 'ru') return { layer: 'ru', key: 'ru' };
  if (e.l === 'us') return { layer: 'us', key: 'us' };
  return { layer: 'regions', key: e.p! };
}

/** Полное имя с пояснением принадлежности: «Гренландия (Дания)». */
export function fullName(e: Entity) {
  const p = e.p && BY_ID[e.p];
  return p && e.k === 'dep' ? `${e.n} (${p.n})` : e.n;
}

export const flagUrl = (base: string, id: string) => `${base}geo/f/${id.toLowerCase()}.webp`;
export const armsUrl = (base: string, id: string) => `${base}geo/a/${id.toLowerCase()}.webp`;
