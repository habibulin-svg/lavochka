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

/** Карточка приключений в игре: заголовок и текст, вынутые из PDF. */
export interface AdvCard {
  /** номер в cards.json (поле n) */
  n: number;
  title: string;
  text: string;
}

/**
 * Колода приключений. Нарезка PDF дала 190 кусков, из них часть — обрывки соседних карточек
 * (начинаются со строчной буквы, повторяют чужой текст, короче пары фраз); в колоду идут только целые.
 * Заголовок — ведущие слова прописными («ЧЕРНАЯ КОШКА»), если их нет — тип из скобок («(враг)»).
 */
export const DECK: AdvCard[] = (() => {
  const out: AdvCard[] = [];
  const seen = new Set<string>();
  for (const c of CARDS) {
    const t = c.text.replace(/\s+/g, ' ').trim();
    if (t.length < 60 || /^[a-zа-яё0-9]/.test(t) || seen.has(t)) continue;
    seen.add(t);
    const m = /^((?:[А-ЯЁ][А-ЯЁ-]*\s+)*[А-ЯЁ][А-ЯЁ-]+)(?=\s)/.exec(t);
    let title = m && m[1].length >= 3 ? m[1] : '';
    let text = title ? t.slice(title.length).trim() : t;
    if (!title) {
      const kind = /^\(([^)]+)\)/.exec(t);
      title = kind ? kind[1].replace(/^./, (x) => x.toUpperCase()) : 'Приключение';
      if (kind) text = t.slice(kind[0].length).trim();
    }
    // обрывок соседней карточки: после типа сразу строчная фраза (кроме строки сил «магия ум сила 12 8 10»)
    if (text.length < 30 || (/^[а-яё]/.test(text) && !/^(магия|ум|сила)\b/.test(text))) continue;
    out.push({ n: c.n, title, text });
  }
  return out;
})();
export const deckCard = (n: number): AdvCard | undefined => DECK.find((c) => c.n === n);

/**
 * Проходы поля 1, сверенные глазами по контрольному листу `tools/korona/gaps.py` (все пары соседних клеток
 * с вырезкой их общей границы): тонкая линия между клетками — проход; толстая тёмная рамка, змея, чёрт,
 * синяя полоса — стена, если на ней нет серой стрелки «⇄». Плюс два перехода «можешь перейти в Мир Золота»
 * (ПУСТОШЬ ↔ АЭРОПОРТ, ЗАБРОШЕННОЕ ШОССЕ ↔ РОСТОВЩИК). Подполя 25 и 28 сюда не входят — в них попадают
 * с клеток-дверей 26 (Храм Бааля) и 29 (Перевал), а выходят сектором 8.
 */
export const EDGES1: [number, number][] = [
  [1, 3], [2, 12], [3, 4], [3, 14], [4, 5], [5, 6], [6, 7], [7, 18], [8, 9], [8, 18], [9, 10], [10, 11], [11, 12],
  [12, 22], [14, 23], [15, 16], [15, 24], [16, 17], [17, 18], [18, 19], [18, 26], [18, 27], [19, 20], [20, 21],
  [21, 29], [22, 30], [23, 31], [24, 32], [27, 34], [30, 36], [31, 38], [32, 39], [33, 41], [34, 42], [35, 44],
  [36, 45], [37, 38], [37, 47], [38, 48], [39, 49], [41, 52], [42, 52], [44, 55], [45, 46], [45, 56], [46, 57],
  [47, 58], [48, 59], [49, 50], [50, 51], [51, 52], [52, 53], [52, 63], [52, 64], [53, 54], [54, 55], [56, 68],
  [57, 69], [58, 72], [59, 60], [60, 61], [61, 62], [62, 63], [64, 65], [65, 66], [66, 67], [67, 68], [69, 81],
  [70, 74], [70, 75], [71, 78], [71, 79], [72, 73], [73, 74], [75, 76], [76, 77], [77, 78], [79, 80], [80, 81],
  [61, 70], [66, 71],
];

type St = 'ПС' | 'ПУ' | 'ПМ' | 'ПО';

/** Сектор подполя: текст с поля и его действие. */
export interface Sector {
  text: string;
  st?: Partial<Record<St, number>>;
  life?: number;
  thalers?: number;
  /** 1 из первой характеристики переходит во вторую */
  swap?: [St, St];
  /** не хватает характеристики — вместо неё теряешь 1 ПЖ */
  orLife?: boolean;
}

/** Подполе из восьми секторов: дверь (клетка, с которой туда попадают), выход сектором 8 и сектора 1–7. */
export interface Rosette {
  cell: number;
  door: number;
  exit: number;
  name: string;
  sectors: Sector[];
}

/** Тексты секторов — с самого поля (номера стоят у стрелок по кругу). Амулетов и предметов в этой версии нет. */
export const ROSETTES: Rosette[] = [
  {
    cell: 25,
    door: 26,
    exit: 33,
    name: 'Храм Бааля',
    sectors: [
      { text: 'можешь обменять ПС на ПМ', swap: ['ПС', 'ПМ'] },
      { text: 'теряешь 2 ПМ', st: { ПМ: -2 } },
      { text: 'теряешь 3 ПС, а если у тебя нет 3 ПС — 1 ПЖ', st: { ПС: -3 }, orLife: true },
      { text: 'получи амулет №7 (амулетов в этой версии нет — возьми 1 ПМ)', st: { ПМ: 1 } },
      { text: 'нашёл 10 талеров', thalers: 10 },
      { text: 'все твои амулеты исчезают (их нет — обошлось)' },
      { text: 'получи 3 ПС', st: { ПС: 3 } },
    ],
  },
  {
    cell: 28,
    door: 29,
    exit: 35,
    name: 'Перевал',
    sectors: [
      { text: 'ОСЫПЬ: твой 1 ПС переходит в 1 ПУ', swap: ['ПС', 'ПУ'] },
      { text: 'РОДНИК: возьми 1 ПЖ', life: 1 },
      { text: 'КАМНЕПАД: теряешь 1 предмет, а если предметов нет — 1 ПС', st: { ПС: -1 } },
      { text: 'СНЕЖНЫЙ ЧЕЛОВЕК: теряешь 1 амулет, а если амулетов нет — 1 ПС', st: { ПС: -1 } },
      { text: 'ЛАВИНА: теряешь 1 ПЖ', life: -1 },
      { text: 'ПРИВАЛ: с тюком провизии или бурдюком возьми 1 ПС (их нет — просто отдых)' },
      { text: 'ОТШЕЛЬНИК: возьми 1 ПУ', st: { ПУ: 1 } },
    ],
  },
];
export const rosetteOf = (cellOrDoor: number): Rosette | undefined => ROSETTES.find((r) => r.cell === cellOrDoor || r.door === cellOrDoor);

/** Центр сектора k (1…8) подполя в пикселях поля 1: сектор 1 — справа сверху, дальше против часовой стрелки; 0 — середина. */
export function sectorPx(rosette: number, k: number): { x: number; y: number } {
  const c = byNumber.get(rosette)!;
  const cx = (c.x + c.w / 2) * SCALE;
  const cy = (c.y + c.h / 2) * SCALE;
  if (k <= 0) return { x: cx, y: cy };
  const a = ((-22.5 - 45 * (k - 1)) * Math.PI) / 180;
  const r = c.w * SCALE * 0.33;
  return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
}

/**
 * Поле 2: дорога от ПРОВАЛА к столице. Клетки — квадраты 130 px растра (field2.webp, 1743×3567), сетка снята
 * по рендеру: столбцы с x = 220 + 130·i, ряды с y = 2445 + 130·j. «Всегда следуешь по направлению стрелки»,
 * на развилке (кружок) — по чётному (2, 4, 6) или нечётному (1, 3, 5) броску этого хода.
 */
export interface RoadNode {
  id: string;
  x: number;
  y: number;
  /** что на клетке: «+1ПС», «−2ПУ» */
  st?: 'ПС' | 'ПУ' | 'ПМ';
  d?: number;
  /** обменный пункт: ПС ↔ ПУ ↔ ПМ */
  exchange?: boolean;
  next?: string;
  even?: string;
  odd?: string;
}

const R = (id: string, i: number, j: number, rest: Partial<RoadNode>): RoadNode => ({ id, x: 220 + 130 * i, y: 2445 + 130 * j, ...rest });

export const ROAD: RoadNode[] = [
  { id: 'fall', x: 1397, y: 3330, next: 'a1' },
  R('a1', 9, 6, { st: 'ПС', d: -2, next: 'a2' }),
  R('a2', 9, 5, { st: 'ПМ', d: -2, next: 'a3' }),
  R('a3', 10, 5, { st: 'ПУ', d: -2, next: 'a4' }),
  R('a4', 10, 4, { st: 'ПС', d: 1, next: 'a5' }),
  R('a5', 10, 3, { st: 'ПМ', d: 1, next: 'a6' }),
  R('a6', 9, 3, { st: 'ПУ', d: 1, next: 'a7' }),
  R('a7', 8, 3, { st: 'ПС', d: -1, next: 'F1' }),
  R('F1', 7, 3, { even: 'e1', odd: 'o1' }),
  R('e1', 6, 3, { next: 'C' }),
  R('o1', 7, 2, { next: 't1' }),
  R('t1', 7, 1, { st: 'ПМ', d: 1, next: 't2' }),
  R('t2', 6, 1, { st: 'ПС', d: -2, next: 'FT' }),
  R('FT', 5, 1, { even: 'up', odd: 'd1' }),
  R('up', 5, 0, { next: 'capital' }),
  R('d1', 5, 2, { next: 'C' }),
  R('C', 5, 3, { even: 'cd', odd: 'cl1' }),
  R('cd', 5, 4, { next: 'm1' }),
  R('m1', 5, 5, { st: 'ПС', d: 1, next: 'm2' }),
  R('m2', 5, 6, { next: 'B' }),
  R('cl1', 4, 3, { next: 'cl2' }),
  R('cl2', 3, 3, { next: 'F2' }),
  R('F2', 2, 3, { even: 'cr1', odd: 'u1' }),
  R('cr1', 3, 3, { next: 'cr2' }),
  R('cr2', 4, 3, { next: 'C' }),
  R('u1', 2, 2, { next: 'u2' }),
  R('u2', 2, 1, { st: 'ПУ', d: 1, next: 'u3' }),
  R('u3', 3, 1, { st: 'ПМ', d: -2, next: 'u4' }),
  R('u4', 4, 1, { st: 'ПУ', d: -2, next: 'FT' }),
  R('B', 5, 7, { even: 'be', odd: 'bo' }),
  R('bo', 4, 7, { next: 'b1' }),
  R('b1', 3, 7, { st: 'ПУ', d: -1, next: 'b2' }),
  R('b2', 2, 7, { st: 'ПМ', d: -1, next: 'b3' }),
  R('b3', 1, 7, { st: 'ПС', d: -1, next: 'b4' }),
  R('b4', 0, 7, { st: 'ПС', d: 1, next: 'b5' }),
  R('b5', 0, 6, { st: 'ПМ', d: -1, next: 'b6' }),
  R('b6', 0, 5, { st: 'ПУ', d: -1, next: 'b7' }),
  R('b7', 0, 4, { exchange: true, next: 'b8' }),
  R('b8', 0, 3, { st: 'ПС', d: -1, next: 'b9' }),
  R('b9', 1, 3, { next: 'F2' }),
  R('be', 6, 7, { next: 'g1' }),
  R('g1', 7, 7, { st: 'ПУ', d: -3, next: 'g2' }),
  R('g2', 7, 6, { st: 'ПМ', d: -3, next: 'g3' }),
  R('g3', 7, 5, { st: 'ПС', d: -3, next: 'g4' }),
  R('g4', 7, 4, { exchange: true, next: 'F1' }),
];
export const ROAD_BY_ID = new Map(ROAD.map((r) => [r.id, r]));

type P = { x: number; y: number };
/** Места поля 2 (пиксели field2.webp) — сверены проверочной картинкой `tools/korona/field2-check.py`. */
export const PLACES2: {
  capital: P;
  labyrinthIn: P;
  ringL: P[];
  ringR: P[];
  palace: P;
  rooms: P[];
  throne: P;
  arena: P;
} = {
  capital: { x: 360, y: 2150 },
  labyrinthIn: { x: 860, y: 1868 },
  ringL: [{ x: 314, y: 1720 }, { x: 414, y: 1720 }, { x: 514, y: 1720 }],
  ringR: [{ x: 1420, y: 1720 }, { x: 1320, y: 1720 }, { x: 1214, y: 1720 }],
  palace: { x: 280, y: 1120 },
  rooms: [{ x: 305, y: 1000 }, { x: 305, y: 884 }, { x: 305, y: 766 }, { x: 305, y: 648 }],
  throne: { x: 1070, y: 373 },
  arena: { x: 1245, y: 871 },
};
/** ПЖ на клетках покоев снизу вверх. */
export const ROOM_PJ = [1, 1, 2, 3];
/** Ворота колец лабиринта снаружи внутрь: 4–6 — налево, возьми N ПЖ; 1–3 — направо, отложи M ПЖ. */
export const RINGS_PJ = [
  { take: 1, give: 3 },
  { take: 2, give: 4 },
  { take: 3, give: 5 },
];
