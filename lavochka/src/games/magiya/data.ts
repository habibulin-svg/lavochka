/**
 * «Магия» — поле: клетки с координатами на картинке public/magic/field.webp (4960×3720, склейка — tools/magiya/stitch.py)
 * и связи между ними. Без DOM.
 *
 * Основной путь — замкнутая змейка из четырёх рядов (A сверху … D снизу): D влево → левая колонка вверх → C вправо →
 * внутренняя правая колонка вверх → B влево → левая колонка вверх → A вправо → внешняя правая колонка вниз → снова D.
 * Ответвления начинаются с зелёной (голубой) стрелки и доступны только тому, кто начинает ход на ней.
 * Лабиринт внизу поля — сетка 4×30 со стенками: ходят на восток, север и юг, не возвращаясь на пройденные клетки.
 */

export type Spirit = 'ghost' | 'koldun' | 'death' | 'witch' | 'vampire' | 'night' | 'dragon' | 'leshy';
export type Power = 'ankh' | 'circles' | 'candle' | 'flame';
export type HeroId = 'knight' | 'princess' | 'monk' | 'hunter' | 'robber' | 'master';

export const SPIRITS: { id: Spirit; name: string; of: string }[] = [
  { id: 'ghost', name: 'Призрак', of: 'призрака' },
  { id: 'koldun', name: 'Колдун', of: 'колдуна' },
  { id: 'death', name: 'Демон смерти', of: 'демона смерти' },
  { id: 'vampire', name: 'Вампир', of: 'вампира' },
  { id: 'witch', name: 'Ведьма', of: 'ведьмы' },
  { id: 'night', name: 'Демон ночи', of: 'демона ночи' },
  { id: 'dragon', name: 'Дракон', of: 'дракона' },
  { id: 'leshy', name: 'Леший', of: 'лешего' },
];
export const POWERS: { id: Power; name: string }[] = [
  { id: 'ankh', name: 'Анх' },
  { id: 'circles', name: 'Три круга' },
  { id: 'candle', name: 'Светильник' },
  { id: 'flame', name: 'Пламя' },
];
export const HEROES: { id: HeroId; name: string }[] = [
  { id: 'knight', name: 'Рыцарь' },
  { id: 'princess', name: 'Принцесса' },
  { id: 'monk', name: 'Монах' },
  { id: 'hunter', name: 'Охотник' },
  { id: 'robber', name: 'Разбойник' },
  { id: 'master', name: 'Мастер' },
];
export const spiritOf = (id: Spirit) => SPIRITS.find((s) => s.id === id)!;
export const powerOf = (id: Power) => POWERS.find((p) => p.id === id)!;
export const heroOf = (id: HeroId) => HEROES.find((h) => h.id === id)!;

export const FIELD = { w: 4960, h: 3720 };

/** Знак клетки. */
export type Sign =
  | { k: 'none' }
  | { k: 'start' }
  /** красный треугольник с числом — взять из банка */
  | { k: 'gain'; n: number }
  /** перечёркнутый треугольник — потеря всех */
  | { k: 'lossAll' }
  /** конверт с числом — отдать, а нет — пропустить столько ходов */
  | { k: 'env'; n: number }
  /** чёрный квадрат 8 / 10 вне владений духов — отдать, а не хватает — в «чёрный квадрат» */
  | { k: 'black'; n: number }
  /** владения духа: чёрный квадрат 1–3 */
  | { k: 'domain'; spirit: Spirit; n: number }
  | { k: 'talisman' }
  /** конверт с черепом — отдать один талисман защиты */
  | { k: 'skull' }
  /** пространственный туннель */
  | { k: 'web' }
  /** зелёная стрелка — переход на другую линию или в карман */
  | { k: 'green' }
  /** голубая стрелка — путь к вершине пирамиды */
  | { k: 'blue' }
  /** синий кружок — фишку можно поставить на любую клетку голубой линии */
  | { k: 'line'; line: LineId }
  /** портрет героя — его хозяину ещё бросок */
  | { k: 'hero'; hero: HeroId }
  /** красная стрелка с белым треугольником — талисман власти */
  | { k: 'power'; power: Power }
  /** красный ромб на вершине пирамиды */
  | { k: 'apex' }
  /** «чёрный квадрат»: начало движения и выход (туннель) */
  | { k: 'bsqStart' }
  | { k: 'bsqWeb' };

export type LineId = 'B' | 'D';
export type Region = 'main' | 'maze' | 'pocket' | 'ten' | 'pyramid' | 'bsq' | 'start' | 'short';

export interface Cell {
  id: number;
  x: number;
  y: number;
  sign: Sign;
  region: Region;
  /** куда шагнуть дальше (вперёд); у развилки внутри «десяток» — два варианта */
  next: number[];
  /** ответвление: первый шаг хода, начатого на этой клетке (зелёная/голубая стрелка) */
  branch?: number;
  /** клетка лабиринта: строка и столбец */
  rc?: [number, number];
  name?: string;
}

const cells: Cell[] = [];
const named = new Map<string, number>();

function parse(tok: string): Sign {
  if (tok === '.') return { k: 'none' };
  if (tok === 'X') return { k: 'lossAll' };
  if (tok === 'T') return { k: 'talisman' };
  if (tok === 'S') return { k: 'skull' };
  if (tok === 'W') return { k: 'web' };
  if (tok === 'G') return { k: 'green' };
  if (tok === 'B') return { k: 'blue' };
  if (tok === 'A') return { k: 'apex' };
  if (tok[0] === '+') return { k: 'gain', n: Number(tok.slice(1)) };
  if (tok[0] === 'e') return { k: 'env', n: Number(tok.slice(1)) };
  if (tok[0] === 'k') return { k: 'black', n: Number(tok.slice(1)) };
  const [a, b, c] = tok.split(':');
  if (a === 'd') return { k: 'domain', spirit: b as Spirit, n: Number(c) };
  if (a === 'h') return { k: 'hero', hero: b as HeroId };
  if (a === 'p') return { k: 'power', power: b as Power };
  if (a === 'L') return { k: 'line', line: b as LineId };
  throw new Error('знак ' + tok);
}

/** Добавить клетку. tok — знак, после «#» — имя для ссылок. */
function add(x0: number, x1: number, y0: number, y1: number, tok: string, region: Region): number {
  const [t, name] = tok.split('#');
  const id = cells.length;
  cells.push({ id, x: Math.round((x0 + x1) / 2), y: Math.round((y0 + y1) / 2), sign: parse(t), region, next: [], name });
  if (name) named.set(name, id);
  return id;
}

/** Ряд клеток (в порядке хода): [x0, x1, знак] при общих y0..y1. */
const row = (y0: number, y1: number, list: [number, number, string][], region: Region = 'main') =>
  list.map(([x0, x1, t]) => add(x0, x1, y0, y1, t, region));
/** Колонка клеток (в порядке хода): [y0, y1, знак] при общих x0..x1. */
const col = (x0: number, x1: number, list: [number, number, string][], region: Region = 'main') =>
  list.map(([y0, y1, t]) => add(x0, x1, y0, y1, t, region));
/** Связать по порядку. */
const chain = (ids: number[]) => ids.forEach((id, i) => i + 1 < ids.length && cells[id].next.push(ids[i + 1]));

// ---------- основной путь (по ходу, от угла «X» внизу справа) ----------
const D = 2710, D1 = 2945;
const C = 1850, C1 = 2085;
const B = 1045, B1 = 1285;
const A = 345, A1 = 560;
const main: number[] = [
  add(4665, 4800, D, D1, 'X#xD', 'main'),
  ...row(D, D1, [
    [4530, 4665, 'T'], [4395, 4530, 'd:dragon:3'], [4255, 4395, '.'], [4115, 4255, 'd:dragon:2'], [3980, 4115, '.'],
    [3840, 3980, 'd:dragon:1'], [3700, 3840, 'L:D#Ld'], [3565, 3700, '+7'], [3425, 3565, 'G#gFlame'], [3290, 3425, '.'],
    [3150, 3290, 'W'], [3010, 3150, 'e4'], [2870, 3010, '.'], [2730, 2870, 'S'], [2600, 2730, '.'], [2480, 2600, '+4'],
    [2350, 2480, '.#pyrOut'], [2210, 2350, 'G#gMaze12'], [2075, 2210, '+2'], [1930, 2075, 'B#blue'], [1795, 1930, 'e3'],
    [1660, 1795, 'W'], [1520, 1660, '.'], [1385, 1520, '+3'], [1245, 1385, 'e2'], [1110, 1245, '.'], [975, 1110, 'T'],
    [860, 975, 'G#gMaze2'], [745, 860, 'd:leshy:3'], [560, 745, 'h:knight'],
  ]),
  ...col(580, 740, [[2560, 2720, 'd:leshy:2'], [2400, 2560, '.'], [2240, 2400, 'd:leshy:1'], [2080, 2240, '+4']]),
  ...row(C, C1, [
    [560, 740, 'h:robber'], [740, 865, '.'], [865, 990, 'e1'], [990, 1120, '.'], [1120, 1255, '+2'], [1255, 1390, '.'],
    [1390, 1520, 'e1'], [1520, 1650, '.#outCandle'], [1650, 1790, '+7'], [1790, 1920, 'G#gCandle'], [1920, 2060, '.'],
    [2060, 2210, 'W'], [2210, 2345, '.#shortIn'], [2345, 2480, 'e2'], [2480, 2600, 'd:night:3'], [2600, 2745, '.'],
    [2745, 2885, 'd:night:2'], [2885, 3020, '.'], [3020, 3150, 'd:night:1'], [3150, 3285, '+5'], [3285, 3420, '.'],
    [3420, 3555, 'e3'], [3555, 3700, 'S'], [3700, 3835, '.'], [3835, 3975, 'e1'], [3975, 4110, '+3'], [4110, 4250, '.'],
    [4250, 4450, 'h:hunter'],
  ]),
  ...col(4245, 4450, [[1695, 1840, '.'], [1560, 1695, 'e3'], [1420, 1560, '.'], [1285, 1420, 'T']]),
  ...row(B, B1, [
    [4245, 4450, 'h:monk'], [4105, 4245, 'd:vampire:3'], [3970, 4105, '.#tenOut'], [3835, 3970, 'd:vampire:2'], [3705, 3835, '.'],
    [3570, 3705, 'd:vampire:1#vampire1'], [3430, 3570, '+3'], [3290, 3430, '.'], [3155, 3290, 'e4'], [3020, 3155, '.'],
    [2870, 3020, '.#outCircles'], [2730, 2870, '+7'], [2600, 2730, 'G#gCircles'], [2480, 2600, 'W'], [2350, 2480, 'e3'],
    [2210, 2350, 'G#gShort'], [2075, 2210, '.'], [1935, 2075, 'T#tB'], [1800, 1935, 'd:witch:3'], [1665, 1800, '.'],
    [1530, 1665, 'd:witch:2'], [1390, 1530, '.'], [1255, 1390, 'd:witch:1'], [1120, 1255, '.'], [990, 1120, '.'],
    [875, 990, 'e2'], [765, 875, 'L:B#Lb'], [560, 765, 'h:princess#princess'],
  ]),
  ...col(560, 760, [[880, 1040, '+3'], [715, 880, '.'], [540, 715, 'T']]),
  ...row(A, A1, [
    [560, 760, 'X'], [760, 875, 'd:ghost:3'], [875, 990, '.'], [990, 1120, 'd:ghost:2'], [1120, 1255, '.'], [1255, 1390, 'd:ghost:1'],
    [1390, 1530, 'e3#envA'], [1530, 1665, '.#outAnkh'], [1665, 1800, '+7#sevenA'], [1800, 1935, 'G#gAnkh'], [1935, 2090, 'W'],
    [2090, 2235, 'e1'], [2235, 2375, '.'], [2375, 2490, 'T#tA'], [2490, 2607, '.'], [2607, 2726, 'd:koldun:3#koldun3'], [2726, 2867, '.'],
    [2867, 3002, 'd:koldun:2'], [3002, 3138, '.'], [3138, 3277, 'd:koldun:1'], [3277, 3416, '.'], [3416, 3554, '+4'],
    [3554, 3690, '.'], [3690, 3825, 'S'], [3825, 3963, 'e1'], [3963, 4105, 'G#gTen'], [4105, 4245, '.'], [4245, 4385, 'T'],
    [4385, 4523, '.'], [4523, 4663, 'd:death:3'], [4663, 4800, 'h:master'],
  ]),
  ...col(4663, 4800, [
    [560, 730, 'd:death:2'], [730, 880, '.'], [880, 1050, 'd:death:1'], [1050, 1200, '.'], [1200, 1360, '+5'], [1360, 1510, '.'],
    [1510, 1660, '.'], [1660, 1810, 'W'], [1810, 1950, 'e2'], [1950, 2110, '.'], [2110, 2270, '+3'], [2270, 2430, '.#lineDEnd'],
    [2430, 2560, '.'], [2560, 2720, 'e1'],
  ]),
];
chain(main);
cells[main[main.length - 1]].next.push(main[0]);
export const MAIN = main;

const id = (name: string) => {
  const v = named.get(name);
  if (v == null) throw new Error('нет клетки ' + name);
  return v;
};

/** Ответвление: клетки по порядку, вход с клетки from (стрелка), выход на клетку to. */
function branch(from: string, list: number[], to: string | number) {
  chain(list);
  cells[id(from)].branch = list[0];
  cells[list[list.length - 1]].next.push(typeof to === 'number' ? to : id(to));
}

// ---------- карманы с талисманами власти ----------
branch('gAnkh', [
  ...col(1800, 1935, [[547, 662, '.'], [662, 800, 'k8'], [800, 920, 'p:ankh'], [920, 1030, 'e3']], 'pocket'),
  add(1665, 1800, 920, 1030, 'p:ankh', 'pocket'),
  ...col(1530, 1665, [[920, 1030, 'e3'], [800, 920, 'p:ankh'], [662, 800, '.'], [547, 662, '+8']], 'pocket'),
], 'outAnkh');
branch('gCircles', [
  ...col(2600, 2730, [[1290, 1425, '.'], [1425, 1545, 'k8'], [1545, 1665, 'p:circles'], [1665, 1775, 'e3']], 'pocket'),
  add(2730, 2870, 1665, 1775, 'p:circles', 'pocket'),
  ...col(2870, 3010, [[1665, 1775, 'e3'], [1545, 1665, 'p:circles'], [1425, 1545, '.'], [1290, 1425, '+8']], 'pocket'),
], 'outCircles');
branch('gCandle', [
  ...col(1790, 1920, [[2090, 2230, '.'], [2230, 2340, 'k8'], [2340, 2460, 'p:candle'], [2460, 2560, 'e3']], 'pocket'),
  add(1650, 1790, 2460, 2560, 'p:candle', 'pocket'),
  ...col(1520, 1650, [[2460, 2560, 'e3'], [2340, 2460, 'p:candle'], [2230, 2340, '.'], [2090, 2230, '+8']], 'pocket'),
], 'outCandle');
branch('gFlame', [
  ...col(3420, 3560, [[2597, 2712, '.'], [2482, 2597, 'k8'], [2362, 2482, 'p:flame'], [2262, 2362, 'e3']], 'pocket'),
  add(3560, 3700, 2262, 2362, 'p:flame', 'pocket'),
  ...col(3700, 3840, [[2262, 2362, 'e3'], [2362, 2482, 'p:flame'], [2482, 2597, '.'], [2597, 2712, '+8']], 'pocket'),
], 'Ld');

// ---------- спуск с ряда B на ряд C ----------
branch('gShort', col(2210, 2350, [[1285, 1410, '.'], [1410, 1555, '+4'], [1555, 1695, '.'], [1695, 1835, '.']], 'short'), 'shortIn');

// ---------- «десятки» под рядом A ----------
{
  const X = [3420, 3560, 3660, 3765, 3870, 3965, 4110];
  const Y = [572, 687, 807, 927, 1047];
  const at = (r: number, c: number, t: string) => add(X[c], X[c + 1], Y[r], Y[r + 1], t, 'ten');
  const a0 = at(0, 0, 'k10'), b0 = at(0, 1, '.'), c0 = at(0, 2, 'k10'), d0 = at(0, 3, '.'), e0 = at(0, 4, '+10'), f0 = at(0, 5, 'k10');
  const a1 = at(1, 0, '+10'), c1 = at(1, 2, '+10'), f1 = at(1, 5, '+10');
  const a2 = at(2, 0, '.'), b2 = at(2, 1, 'k10'), c2 = at(2, 2, '.'), d2 = at(2, 3, '.'), e2 = at(2, 4, '+10'), f2 = at(2, 5, '.');
  const f3 = at(3, 5, 'k10');
  cells[id('gTen')].branch = f0;
  const link = (a: number, b: number) => cells[a].next.push(b);
  link(f0, f1); link(f0, e0); link(e0, d0); link(d0, c0); link(c0, b0); link(c0, c1); link(b0, a0); link(a0, a1); link(a1, a2);
  link(a2, b2); link(b2, c2); link(c1, c2); link(c2, d2); link(d2, e2); link(e2, f2); link(f1, f2); link(f2, f3);
  link(f3, id('tenOut'));
}

// ---------- пирамида ----------
export const APEX = add(2150, 2270, 2210, 2340, 'A', 'pyramid');
branch('blue', [
  add(1935, 2080, 2565, 2705, '.', 'pyramid'),
  add(2010, 2160, 2430, 2565, 'S', 'pyramid'),
  add(2070, 2200, 2330, 2430, '.', 'pyramid'),
], APEX);
{
  const right = [add(2225, 2350, 2330, 2430, '.', 'pyramid'), add(2290, 2440, 2430, 2565, '.', 'pyramid'), add(2330, 2480, 2565, 2705, '.', 'pyramid')];
  cells[APEX].next.push(right[0]);
  chain(right);
  cells[right[2]].next.push(id('pyrOut'));
}

// ---------- «чёрный квадрат»: кольцо против часовой стрелки ----------
{
  const X = [638, 735, 840, 945, 1055];
  const Y = [1320, 1440, 1555, 1665, 1800];
  const at = (r: number, c: number, t: string) => add(X[c], X[c + 1], Y[r], Y[r + 1], t, 'bsq');
  const ring = [
    at(0, 3, '.#bsqStart'), at(0, 2, '.'), at(0, 1, '.'), at(0, 0, '.'), at(1, 0, '.'), at(2, 0, '.'), at(3, 0, '.'),
    at(3, 1, '.'), at(3, 2, '.'), at(3, 3, '.#bsqWeb'), at(2, 3, '.'), at(1, 3, '.'),
  ];
  cells[ring[0]].sign = { k: 'bsqStart' };
  cells[ring[9]].sign = { k: 'bsqWeb' };
  chain(ring);
  cells[ring[ring.length - 1]].next.push(ring[0]);
}

// ---------- лабиринт ----------
const MX = [584, 717, 853, 990, 1126, 1261, 1396, 1533, 1669, 1807, 1946, 2081, 2216, 2353, 2489, 2589, 2688, 2825, 2965, 3100, 3235, 3369, 3505, 3643, 3782, 3918, 4056, 4188, 4328, 4463, 4600];
const MY = [2988, 3128, 3270, 3425, 3583];
export const MAZE_COLS = MX.length - 1;
const TRI = 'r0c1 r2c2 r1c5 r3c4 r0c8 r3c7 r1c10 r0c12 r2c13 r3c11 r0c16 r1c18 r3c16 r2c20 r0c22 r1c24 r2c27 r3c22 r3c26 r3c29'.split(' ');
/** Стенки между столбцами k и k+1 по строкам. */
const VWALL: number[][] = [
  [0, 3, 5, 7, 9, 14, 18, 21, 23, 27],
  [1, 4, 6, 8, 12, 17, 20, 22, 25, 27],
  [1, 6, 8, 9, 10, 12, 16, 18, 22, 24, 26, 28],
  [0, 2, 5, 9, 14, 17, 19, 23, 25, 27],
];
/** Стенки между строками r и r+1 по столбцам. */
const HWALL: number[][] = [
  [2, 11, 16, 20, 26, 29],
  [0, 3, 4, 6, 7, 12, 13, 16, 17, 19, 22, 23, 24],
  [4, 8, 11, 21],
];
const MAZE: number[][] = [];
for (let r = 0; r < 4; r++) {
  MAZE.push([]);
  for (let c = 0; c < MAZE_COLS; c++) {
    const i = add(MX[c], MX[c + 1], MY[r], MY[r + 1], TRI.includes(`r${r}c${c}`) ? '+3' : '.', 'maze');
    cells[i].rc = [r, c];
    MAZE[r].push(i);
  }
}
export const mazeAt = (r: number, c: number) => MAZE[r]?.[c];
/** Соседи клетки лабиринта, куда можно шагнуть: восток, север, юг (без стенок); с последнего столбца — выход на «X». */
export function mazeNext(cellId: number): number[] {
  const rc = cells[cellId].rc!;
  const [r, c] = rc;
  const out: number[] = [];
  if (c + 1 < MAZE_COLS) {
    if (!VWALL[r].includes(c)) out.push(MAZE[r][c + 1]);
  } else if (r <= 1) out.push(id('xD'));
  if (r > 0 && !HWALL[r - 1].includes(c)) out.push(MAZE[r - 1][c]);
  if (r < 3 && !HWALL[r].includes(c)) out.push(MAZE[r + 1][c]);
  return out;
}
cells[id('gMaze2')].branch = MAZE[0][2];
cells[id('gMaze12')].branch = MAZE[0][12];

// ---------- «Начало пути» ----------
export const START = add(120, 520, 3260, 3500, '.', 'start');
cells[START].sign = { k: 'start' };
cells[START].next.push(MAZE[3][0]);

export const CELLS: readonly Cell[] = cells;
/** Клетка по имени из разметки (для показа правил и тестов). */
export const cellByName = (name: string) => id(name);
export const BSQ_START = id('bsqStart');
export const BSQ_WEB = id('bsqWeb');
export const X_D = id('xD');
/** Туннели на поле (без выхода из «чёрного квадрата»). */
export const WEBS = cells.filter((c) => c.sign.k === 'web').map((c) => c.id);

/** Клетки голубой линии: до синего кружка по ходу (не включая его). */
function lineCells(from: string, circle: string): number[] {
  const a = main.indexOf(id(from));
  const b = main.indexOf(id(circle));
  const out: number[] = [];
  for (let i = a; i !== b; i = (i + 1) % main.length) out.push(main[i]);
  return out;
}
export const LINES: Record<LineId, number[]> = { B: lineCells('gShort', 'Lb'), D: lineCells('lineDEnd', 'Ld') };

/** Клетки с портретом героя. */
export const heroCell = (h: HeroId) => cells.find((c) => c.sign.k === 'hero' && c.sign.hero === h)!.id;
