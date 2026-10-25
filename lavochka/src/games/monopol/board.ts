/* «Мо-но-пол» — поле кооператива «МИЛАГ» (1991). Без DOM. Разбор — docs/analysis/monopol.md.
 * Координаты — в пикселях поля шириной 1600 (картинка public/monopol/field.webp пропорциональна: 1600 × 1122). */

export const FW = 1600;
export const FH = 1122;

export type Kind = 'firm' | 'papa' | 'mama' | 'roulette' | 'zal' | 'plus' | 'lottery' | 'cat' | 'kassa' | 'race' | 'bath' | 'market' | 'wheel';

export interface Cell {
  name: string;
  kind: Kind;
  /** Фирма: цена и доля от настоящей цены, которую платит попавший (знаменатель дроби). */
  price?: number;
  den?: number;
  /** Рамка клетки на поле. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const top = [14, 169, 329, 491, 649, 808, 969, 1127, 1287, 1447];
const topR = [153, 315, 474, 633, 790, 950, 1110, 1270, 1429, 1582];
const bot = [16, 166, 326, 487, 647, 812, 968, 1128, 1288, 1449];
const botR = [149, 310, 469, 628, 788, 949, 1112, 1273, 1434, 1585];
const T = (i: number) => ({ x0: top[i], x1: topR[i], y0: 12, y1: 153 });
const B = (i: number) => ({ x0: bot[i], x1: botR[i], y0: 968, y1: 1105 });
const L = (y0: number, y1: number) => ({ x0: 14, x1: 152, y0, y1 });
const R = (y0: number, y1: number) => ({ x0: 1447, x1: 1584, y0, y1 });
const M = (y0: number, y1: number) => ({ x0: 808, x1: 950, y0, y1 });
const F = (name: string, price: number, den: number) => ({ name, kind: 'firm' as const, price, den });

/** Большой круг по часовой стрелке, 0 — «Папина сберкнижка» (старт). */
export const BIG: Cell[] = [
  { name: 'Папина сберкнижка', kind: 'papa', den: 10, ...T(0) },
  { ...F('Артель', 500, 10), ...T(1) },
  { name: 'Рулетка', kind: 'roulette', ...T(2) },
  { ...F('Автозавод', 700, 5), ...T(3) },
  { ...F('Кондитерская', 1000, 4), ...T(4) },
  { name: 'Зал игровых автоматов', kind: 'zal', ...T(5) },
  { ...F('Гостиница', 600, 10), ...T(6) },
  { ...F('Яхтклуб', 900, 10), ...T(7) },
  { ...F('Зоопарк', 2000, 5), ...T(8) },
  { name: '+500', kind: 'plus', ...T(9) },
  { ...F('Металлоремонт', 800, 4), ...R(165, 308) },
  { name: 'Лотерея «Спринт»', kind: 'lottery', ...R(325, 468) },
  { ...F('Старик Хоттабыч', 500, 5), ...R(484, 607) },
  { name: 'Чёрный кот', kind: 'cat', ...R(626, 792) },
  { ...F('Выставка', 800, 10), ...R(808, 952) },
  { name: 'Мамина сберкнижка', kind: 'mama', den: 5, ...B(9) },
  { ...F('Ферма «Хрю»', 600, 4), ...B(8) },
  { ...F('Студия', 600, 5), ...B(7) },
  { ...F('Клиника', 2500, 4), ...B(6) },
  { name: 'Касса игровых автоматов', kind: 'kassa', ...B(5) },
  { name: 'Тараканьи бега', kind: 'race', ...B(4) },
  { ...F('Пекарня', 1500, 5), ...B(3) },
  { ...F('Тир', 500, 10), ...B(2) },
  { ...F('Планетарий', 4000, 10), ...B(1) },
  { name: '+500', kind: 'plus', ...B(0) },
  { ...F('Сочи', 1000, 10), ...L(808, 952) },
  { name: 'Баня', kind: 'bath', ...L(628, 791) },
  { name: 'Рижский рынок', kind: 'market', ...L(486, 610) },
  { ...F('Hotel', 900, 5), ...L(326, 470) },
  { ...F('Вернисаж', 800, 4), ...L(168, 311) },
];

/** Малый круг: от Зала игровых автоматов (5) вниз к Кассе (19). */
export const SMALL: Cell[] = [
  { ...F('Калинка', 3000, 4), ...M(166, 309) },
  { ...F('Салон мод', 500, 10), ...M(331, 469) },
  { name: 'Белка в колесе', kind: 'wheel', ...M(485, 610) },
  { ...F('Парикмахерская', 1500, 10), ...M(630, 796) },
  { ...F('Тусовка', 3500, 5), ...M(811, 957) },
];

export const ZAL = 5;
export const KASSA = 19;
export const PAPA = 0;
export const MAMA = 15;
export const BATH = 26;
export const MARKET = 27;
export const CAT = 13;
export const HOTTABYCH = 12;
export const RACE = 20;
export const BAKERY = 21;
export const PLUS = [9, 24];
/** Выход из подвала — на Парикмахерскую (малый круг, 3). */
export const BARBER = 3;
export const WHEEL_CELL = 2;

/** Место на круге: большой (0…29) или малый (100…104). */
export const SM = 100;
export const cellAt = (loc: number): Cell => (loc >= SM ? SMALL[loc - SM] : BIG[loc]);
/** Все клетки по номеру места. */
export const LOCS: number[] = [...BIG.map((_, i) => i), ...SMALL.map((_, i) => SM + i)];
/** Фирмы — места, где фирма. */
export const FIRMS: number[] = LOCS.filter((l) => cellAt(l).kind === 'firm');

/** Следующее место по ходу (на развилке — по чётности броска). */
export function next(loc: number, even: boolean): number {
  if (loc === ZAL) return even ? SM : ZAL + 1;
  if (loc >= SM) return loc === SM + SMALL.length - 1 ? KASSA : loc + 1;
  return (loc + 1) % BIG.length;
}

// ---------------------------------------------------------------- подвал «Чёрного кота»: 7 × 5

export const CELLAR_W = 7;
export const CELLAR_H = 5;
/** Деньги клеток подвала (красные «+», синие «−»); null — кот, 0 — вход. */
export const CELLAR: (number | null)[][] = [
  [-100, 400, -200, 600, -300, -400, -200],
  [-600, -100, -300, -200, -300, 500, 0],
  [300, -200, 200, null, 100, -500, -300],
  [-300, -400, 300, -700, -600, -400, -200],
  [-900, 900, -300, 400, -100, -900, 800],
];
export const CELLAR_IN: [number, number] = [1, 6];
/** Выход — влево из клетки (1, 0). */
export const CELLAR_OUT: [number, number] = [1, 0];
export const CELLAR_ROLLS = 6;
export const CELLAR_FINE = 500;
/** Центр клетки подвала на поле. */
export const cellarXY = (r: number, c: number): [number, number] => [1008 + 55.2 * (c + 0.5), 652 + 55.2 * (r + 0.5)];

// ---------------------------------------------------------------- «Белка в колесе»: 8 секторов против часовой стрелки от входа

/** null — пустой сектор (выход). */
export const WHEEL: (number | null)[] = [200, -200, 300, null, -300, 500, 100, -100];
export const WHEEL_XY: [number, number][] = [
  [1069, 432],
  [1155, 519],
  [1249, 515],
  [1350, 410],
  [1320, 331],
  [1249, 264],
  [1140, 267],
  [1057, 342],
];

// ---------------------------------------------------------------- «Тараканьи бега»: 20 клеток, последние — ½ и ×2

export const HALF = 'half';
export const DOUBLE = 'double';
export const RACE_TRACK: (number | 'half' | 'double')[] = [-100, 100, -300, -200, 1000, -100, 100, -300, 500, 200, -100, 700, -400, 400, 500, -400, -700, 900, HALF, DOUBLE];
export const RACE_XY: [number, number][] = (() => {
  const cx = (i: number) => 150 + (85 + 101.5 * (i + 0.5)) / 1.846;
  const out: [number, number][] = [
    [cx(9), 915],
    [cx(9), 858],
  ];
  for (let i = 9; i >= 0; i--) out.push([cx(i), 804]);
  out.push([cx(0), 858]);
  for (let i = 0; i <= 6; i++) out.push([cx(i), 915]);
  return out;
})();

// ---------------------------------------------------------------- баня: 10 тазиков

export const BATH_N = 10;
export const BATH_XY: [number, number][] = [
  [220, 734],
  [312, 734],
  [396, 734],
  [486, 734],
  [589, 734],
  [708, 712],
  [600, 669],
  [499, 669],
  [394, 669],
  [277, 669],
];

// ---------------------------------------------------------------- лотерея «Спринт»

export type Lot =
  | { k: 'cash'; v: number }
  | { k: 'go'; to: number }
  | { k: 'kassa'; v: number }
  | { k: 'fund'; v: number }
  | { k: 'skip' }
  | { k: 'each'; v: number }
  | { k: 'any' }
  | { k: 'free' }
  | { k: 'again' };

/** Таблица выигрышей: LOTTERY[a − 1][b − 1]. */
export const LOTTERY: Lot[][] = [
  [{ k: 'cash', v: 100 }, { k: 'go', to: PAPA }, { k: 'go', to: MARKET }, { k: 'go', to: BATH }, { k: 'kassa', v: 500 }, { k: 'cash', v: 500 }],
  [{ k: 'go', to: MAMA }, { k: 'go', to: ZAL }, { k: 'go', to: CAT }, { k: 'go', to: MARKET }, { k: 'cash', v: 500 }, { k: 'go', to: 2 }],
  [{ k: 'skip' }, { k: 'go', to: MARKET }, { k: 'go', to: RACE }, { k: 'cash', v: 300 }, { k: 'kassa', v: 500 }, { k: 'go', to: SM + WHEEL_CELL }],
  [{ k: 'kassa', v: 100 }, { k: 'cash', v: 200 }, { k: 'any' }, { k: 'go', to: MARKET }, { k: 'cash', v: 100 }, { k: 'again' }],
  [{ k: 'each', v: 200 }, { k: 'skip' }, { k: 'kassa', v: 200 }, { k: 'cash', v: 300 }, { k: 'each', v: 400 }, { k: 'fund', v: 300 }],
  [{ k: 'any' }, { k: 'free' }, { k: 'kassa', v: 500 }, { k: 'cash', v: 500 }, { k: 'free' }, { k: 'cash', v: 1000 }],
];

export function lotText(l: Lot): string {
  switch (l.k) {
    case 'cash':
      return `получите ${l.v} банкнот из фонда игры`;
    case 'go':
      return `вы попадаете на клетку «${cellAt(l.to).name}»`;
    case 'kassa':
      return `заплатите ${l.v} банкнот в кассу игровых автоматов`;
    case 'fund':
      return `заплатите ${l.v} банкнот в фонд игры`;
    case 'skip':
      return 'вы пропускаете ход';
    case 'each':
      return `каждый играющий должен вам по ${l.v} банкнот`;
    case 'any':
      return 'вы на любой клетке по выбору';
    case 'free':
      return 'вы можете купить любую незанятую фирму (если все заняты — вы на «Рижском рынке»)';
    case 'again':
      return 'перебросьте кубик ещё раз';
  }
}
