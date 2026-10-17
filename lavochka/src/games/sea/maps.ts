/* Поля морских игр В. М. Голицына: клетки, порты, течения и геометрия сетки на картинке карты.
 * Клетки сняты с настоящих карт (tools/sea: grid-*.py — линии сетки, *-mask.txt — разметка, gen-maps.py — этот набор данных).
 * У «Пиратов» сетка ровная, у «Захвата колоний» карта склеена из листов и линии чуть наклонены — каждая задана прямой. */
import { PIRATY, KOLONII } from './maps-data';
import { POINT_STEP, POINTS, type Point } from './wind';

export type MapId = 'piraty' | 'kolonii';

/** Чей порт: испанский (там чинятся галионы), пиратская база, колония («Захват колоний»). */
export type PortKind = 'es' | 'pi' | 'col';

export interface PortDef {
  id: number;
  name: string;
  x: number;
  y: number;
  kind: PortKind;
  /** Очки за колонию — крупная цифра на карте. */
  value?: number;
}

export interface SeaMap {
  id: MapId;
  title: string;
  w: number;
  h: number;
  /** Картинка карты и её размер в пикселях. */
  img: string;
  mini: string;
  imgW: number;
  imgH: number;
  /** Ширина исходного скана — до неё можно приближать. */
  srcW: number;
  rows: string[];
  ports: PortDef[];
  /** Течения: клетка → куда сносит. */
  cur: Map<number, Point>;
  /** Квадратик, откуда выходят корабли («Захват колоний»): клетки старта. */
  home: number[];
  v: [number, number][];
  hl: [number, number][];
}

const P = (name: string, x: number, y: number, kind: PortKind, value?: number) => ({ name, x, y, kind, value });

/* «Пираты»: шесть пиратских баз (три в Европе, три у Америки) и порты с крестом в квадрате —
 * «порты испанские и других стран, где могут чиниться испанские галионы». */
const PIRATY_PORTS = [
  P('Вера-Круц', 2, 20, 'es'),
  P('Гавана', 9, 17, 'es'),
  P('Сант-Яго', 12, 19, 'es'),
  P('Понсе', 17, 21, 'es'),
  P('Гваделупа', 20, 22, 'es'),
  P('Порто-Белло', 11, 25, 'es'),
  P('Бермуды', 18, 12, 'es'),
  P('Азорские о-ва', 36, 8, 'es'),
  P('Мадейра', 42, 12, 'es'),
  P('Канарские о-ва', 41, 15, 'es'),
  P('о-ва Зелёного Мыса', 38, 21, 'es'),
  P('Кадикс', 47, 9, 'es'),
  P('Мериленд', 13, 8, 'pi'),
  P('Тортуга', 14, 19, 'pi'),
  P('о. Тринидад', 20, 25, 'pi'),
  P('Ланд-Энд', 48, 0, 'pi'),
  P('Ла-Манш', 51, 0, 'pi'),
  P('Сан-Мало', 49, 1, 'pi'),
];

/* «Захват колоний»: порты с красным значком; цена — крупная цифра на стране или острове (Сингапур — 3, Кокосовые — 1). */
const KOLONII_PORTS = [
  P('Бомбей', 2, 4, 'col', 6),
  P('Гоа', 2, 7, 'col', 1),
  P('Мадрас', 6, 8, 'col', 6),
  P('Коломбо', 6, 11, 'col', 2),
  P('Калькутта', 11, 2, 'col', 6),
  P('Рангун', 15, 5, 'col', 6),
  P('Банкок', 19, 8, 'col', 6),
  P('Сайгон', 22, 9, 'col', 6),
  P('Цюньчжоу', 24, 3, 'col', 1),
  P('Кантон', 26, 1, 'col', 8),
  P('Гонконг', 27, 2, 'col', 1),
  P('Тайнань', 31, 2, 'col', 2),
  P('Манила', 31, 7, 'col', 4),
  P('Сингапур', 21, 15, 'col', 3),
  P('Паданг', 18, 16, 'col', 5),
  P('Батавия', 23, 19, 'col', 3),
  P('Кокосовые о-ва', 17, 22, 'col', 1),
  P('Лабуан', 27, 12, 'col', 2),
  P('Банджармасин', 27, 18, 'col', 5),
  P('Макассар', 30, 19, 'col', 3),
  P('Амбоина', 35, 18, 'col', 2),
  P('Купанг', 33, 22, 'col', 2),
  P('Порт-Дарвин', 37, 23, 'col', 5),
  P('Броом', 31, 27, 'col', 6),
  P('Дорей', 38, 16, 'col', 3),
  P('Порт-Морсби', 47, 21, 'col', 3),
  P('Порт-Симсон', 48, 19, 'col', 2),
  P('Таунсвиль', 46, 27, 'col', 6),
];

function build(id: MapId, title: string, raw: typeof PIRATY, ports: ReturnType<typeof P>[], img: { w: number; h: number; src: number }): SeaMap {
  const w = raw.rows[0].length;
  const h = raw.rows.length;
  const cur = new Map<number, Point>();
  for (const [i, j, d] of raw.cur) cur.set(j * w + i, d as Point);
  const home: number[] = [];
  raw.rows.forEach((r, j) => [...r].forEach((c, i) => c === 'H' && home.push(j * w + i)));
  return {
    id,
    title,
    w,
    h,
    img: `/${id}/field.webp`,
    mini: `/${id}/field-small.webp`,
    imgW: img.w,
    imgH: img.h,
    srcW: img.src,
    rows: raw.rows,
    ports: ports.map((p, i) => ({ id: i, ...p })),
    cur,
    home,
    v: raw.v,
    hl: raw.h,
  };
}

export const MAPS: Record<MapId, SeaMap> = {
  piraty: build('piraty', 'Пираты', PIRATY, PIRATY_PORTS, { w: 3200, h: 1896, src: 4270 }),
  kolonii: build('kolonii', 'Захват колоний', KOLONII, KOLONII_PORTS, { w: 3200, h: 2032, src: 4636 }),
};

export const idx = (m: SeaMap, x: number, y: number) => y * m.w + x;
export const inside = (m: SeaMap, x: number, y: number) => x >= 0 && y >= 0 && x < m.w && y < m.h;
export const charAt = (m: SeaMap, x: number, y: number) => (inside(m, x, y) ? m.rows[y][x] : '#');
/** Клетка, по которой можно плавать: море, порт, квадратик старта. */
export const isWater = (m: SeaMap, x: number, y: number) => charAt(m, x, y) !== '#';
export const portAt = (m: SeaMap, x: number, y: number) => m.ports.find((p) => p.x === x && p.y === y) ?? null;
export const isHome = (m: SeaMap, x: number, y: number) => charAt(m, x, y) === 'H';

/** Угол клетки на картинке: пересечение вертикали i и горизонтали j. */
function corner(m: SeaMap, i: number, j: number): [number, number] {
  const [a, b] = m.v[i];
  const [c, d] = m.hl[j];
  const y = (c + d * a) / (1 - d * b);
  return [a + b * y, y];
}

/** Середина клетки в пикселях карты. */
export function cellXY(m: SeaMap, x: number, y: number): { x: number; y: number } {
  const p = [corner(m, x, y), corner(m, x + 1, y), corner(m, x, y + 1), corner(m, x + 1, y + 1)];
  return { x: (p[0][0] + p[1][0] + p[2][0] + p[3][0]) / 4, y: (p[0][1] + p[1][1] + p[2][1] + p[3][1]) / 4 };
}

/** Размер клетки в пикселях (примерно — для фишек). */
export const cellSize = (m: SeaMap) => (m.v[m.v.length - 1][0] - m.v[0][0]) / (m.v.length - 1);

/** Клетка под точкой картинки (для касаний); null — мимо сетки. */
export function cellAt(m: SeaMap, px: number, py: number): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bd = Infinity;
  const s = cellSize(m);
  const gx = Math.round((px - m.v[0][0]) / s - 0.5);
  const gy = Math.round((py - m.hl[0][0]) / s - 0.5);
  for (let y = gy - 1; y <= gy + 1; y++)
    for (let x = gx - 1; x <= gx + 1; x++) {
      if (!inside(m, x, y)) continue;
      const c = cellXY(m, x, y);
      const d = (c.x - px) ** 2 + (c.y - py) ** 2;
      if (d < bd) {
        bd = d;
        best = { x, y };
      }
    }
  return best && bd < s * s ? best : null;
}

/** Соседи по восьми румбам. */
export const NEIGH = POINTS.map((p) => ({ p, d: POINT_STEP[p] }));

/** Расстояние «по клеткам» (король в шахматах): дальность стрельбы считается так. */
export const cheb = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
