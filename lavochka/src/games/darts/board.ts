/* Дартс — геометрия стандартной мишени (без DOM). Координаты — метры на плоскости мишени: x вправо, y вверх, (0, 0) — центр
 * «яблочка». 20 секторов по 18°, «20» сверху, по часовой стрелке 20-1-18-4-13-6-10-15-2-17-3-19-7-16-8-11-14-9-12-5.
 * Размеры — по правилам WDF/BDO: яблочко Ø 12,7 мм, кольцо «25» Ø 31,8 мм, утроение 99–107 мм, удвоение 162–170 мм от центра,
 * сама мишень Ø 451 мм. Картинку мишени собирают по этим же числам (studio/jobs/darts/export_art.py). */

export const ORDER = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];

/** Радиусы колец, м. */
export const R = {
  bull: 0.00635,
  outer: 0.0159,
  tripleIn: 0.099,
  tripleOut: 0.107,
  doubleIn: 0.162,
  doubleOut: 0.17,
  /** Край мишени (сизаль с кольцом цифр). */
  board: 0.2255,
};

/** Полутолщина проволоки с поправкой на кончик дротика: ближе — дротик задел проволоку. */
export const WIRE = 0.0011;

/** Попадание: n — число (25 — бык), m — множитель (1/2/3; у быка 1 — «25», 2 — «50»); n = 0 — мимо. */
export interface Hit {
  n: number;
  m: number;
}

export const MISS: Hit = { n: 0, m: 0 };

export const value = (h: Hit) => h.n * h.m;

/** Номер сектора (индекс в ORDER) по точке. */
export function sectorAt(x: number, y: number): number {
  // угол от «20» по часовой стрелке
  let deg = (Math.atan2(x, y) * 180) / Math.PI;
  deg = (((deg + 9) % 360) + 360) % 360;
  return Math.floor(deg / 18) % 20;
}

/** Куда попал дротик, воткнувшийся в точку (x, y). */
export function hitAt(x: number, y: number): Hit {
  const r = Math.hypot(x, y);
  if (r <= R.bull) return { n: 25, m: 2 };
  if (r <= R.outer) return { n: 25, m: 1 };
  if (r > R.doubleOut) return MISS;
  const n = ORDER[sectorAt(x, y)];
  if (r >= R.doubleIn) return { n, m: 2 };
  if (r >= R.tripleIn && r <= R.tripleOut) return { n, m: 3 };
  return { n, m: 1 };
}

const RINGS = [R.bull, R.outer, R.tripleIn, R.tripleOut, R.doubleIn, R.doubleOut];

/** Расстояние до ближайшей проволоки (кольца и лучи между секторами), м; за кольцом удвоения проволоки нет. */
export function wireDist(x: number, y: number): number {
  const r = Math.hypot(x, y);
  let d = Infinity;
  for (const k of RINGS) d = Math.min(d, Math.abs(r - k));
  if (r >= R.outer && r <= R.doubleOut) {
    let deg = (Math.atan2(x, y) * 180) / Math.PI;
    deg = (((deg + 9) % 360) + 360) % 360;
    const off = deg % 18;
    const da = (Math.min(off, 18 - off) * Math.PI) / 180;
    d = Math.min(d, r * Math.sin(da));
  }
  return d;
}

/** Центр сектора n по углу (рад, от «20» по часовой). */
export function angleOf(n: number): number {
  const i = ORDER.indexOf(n);
  return (i * 18 * Math.PI) / 180;
}

/** Куда целиться, чтобы попасть в (n, m): середина нужного поля; у одиночного — большее поле между утроением и удвоением. */
export function aimFor(n: number, m: number): { x: number; y: number } {
  if (n === 25) return m === 2 ? { x: 0, y: 0 } : { x: 0, y: (R.bull + R.outer) / 2 + 0.002 };
  const r = m === 3 ? (R.tripleIn + R.tripleOut) / 2 : m === 2 ? (R.doubleIn + R.doubleOut) / 2 : (R.tripleOut + R.doubleIn) / 2;
  const a = angleOf(n);
  return { x: Math.sin(a) * r, y: Math.cos(a) * r };
}

/** Короткая запись попадания: «T20», «D16», «7», «Бык», «25», «мимо». */
export function label(h: Hit): string {
  if (!h.n) return 'мимо';
  if (h.n === 25) return h.m === 2 ? 'Бык' : '25';
  return h.m === 3 ? `T${h.n}` : h.m === 2 ? `D${h.n}` : `${h.n}`;
}

/** Все поля мишени (для перебора закрытий): 20×3 + 25 + 50. */
export const ALL: Hit[] = [
  ...ORDER.flatMap((n) => [1, 2, 3].map((m) => ({ n, m }))),
  { n: 25, m: 1 },
  { n: 25, m: 2 },
];

/** Удвоение (для double in/out): D1–D20 и «яблочко». */
export const isDouble = (h: Hit) => h.m === 2 && h.n > 0;
