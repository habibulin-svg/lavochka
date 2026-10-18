/* Раскладки пасьянса. Координаты — в полукостях: кость занимает 2×2 клетки, x вправо, y вниз, z — этаж.
 * Сдвиг на одну клетку — кость «на стыке» двух нижних (как верхушка черепахи). Без DOM. */

export interface Pos {
  x: number;
  y: number;
  z: number;
}

export interface Layout {
  id: string;
  label: string;
  hint: string;
  pos: Pos[];
}

/** Прямоугольник костей w×h с левым верхним углом (x, y) на этаже z. */
function rect(x: number, y: number, w: number, h: number, z: number): Pos[] {
  const r: Pos[] = [];
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) r.push({ x: x + 2 * i, y: y + 2 * j, z });
  return r;
}

/** Ряд из n костей по центру оси cx (в клетках). */
const row = (cx: number, y: number, n: number, z: number) => rect(cx - n, y, n, 1, z);

function turtle(): Pos[] {
  const p: Pos[] = [];
  [12, 8, 10, 12, 12, 10, 8, 12].forEach((n, j) => p.push(...row(14, 2 * j, n, 0)));
  p.push({ x: 0, y: 7, z: 0 }, { x: 26, y: 7, z: 0 }, { x: 28, y: 7, z: 0 });
  p.push(...rect(8, 2, 6, 6, 1), ...rect(10, 4, 4, 4, 2), ...rect(12, 6, 2, 2, 3), { x: 13, y: 7, z: 4 });
  return p;
}

function pyramid(): Pos[] {
  return [...rect(0, 0, 8, 8, 0), ...rect(2, 2, 6, 6, 1), ...rect(4, 4, 4, 4, 2), ...rect(6, 6, 2, 2, 3)];
}

function fortress(): Pos[] {
  const p = rect(0, 0, 12, 8, 0);
  for (const [x, y] of [
    [0, 0],
    [20, 0],
    [0, 12],
    [20, 12],
  ])
    for (let z = 1; z <= 3; z++) p.push(...rect(x, y, 2, 2, z));
  return p;
}

/** Горка 4×4 + 3×3 + 2×2 + 1 со сдвигом на полкости. */
function hill(x: number, y: number): Pos[] {
  return [...rect(x, y, 4, 4, 0), ...rect(x + 1, y + 1, 3, 3, 1), ...rect(x + 2, y + 2, 2, 2, 2), { x: x + 3, y: y + 3, z: 3 }];
}

function mountains(): Pos[] {
  return [...hill(0, 2), ...hill(9, 0), ...hill(18, 2)];
}

function cross(): Pos[] {
  return [
    ...rect(0, 8, 12, 4, 0),
    ...rect(8, 0, 4, 4, 0),
    ...rect(8, 16, 4, 4, 0),
    ...rect(4, 10, 8, 2, 1),
    ...rect(10, 4, 2, 2, 1),
    ...rect(10, 14, 2, 2, 1),
    ...rect(10, 10, 2, 2, 2),
  ];
}

/** Бабочка: тельце посередине (x = 14), крылья зеркально; верхние крылья больше нижних, на крыльях и тельце — второй и третий этаж. */
function butterfly(): Pos[] {
  const p: Pos[] = [];
  const wings = (rows: number[], z: number, y0: number) =>
    rows.forEach((n, j) => {
      for (let i = 0; i < n; i++) p.push({ x: 12 - 2 * i, y: y0 + 2 * j, z }, { x: 16 + 2 * i, y: y0 + 2 * j, z });
    });
  wings([4, 5, 5, 3, 3, 5, 5, 4], 0, 0);
  wings([3, 3], 1, 2);
  wings([2, 2], 1, 10);
  wings([1, 1], 2, 2);
  for (let j = 1; j <= 6; j++) p.push({ x: 14, y: 2 * j, z: 0 });
  for (let j = 2; j <= 5; j++) p.push({ x: 14, y: 2 * j, z: 1 });
  p.push({ x: 14, y: 6, z: 2 }, { x: 14, y: 8, z: 2 });
  return p;
}

/** «Соединялка» (шисен-сё): плоское поле 18×8 — пары соединяют линией не больше чем с двумя поворотами. */
function connect(): Pos[] {
  return rect(0, 0, 18, 8, 0);
}

export const LAYOUTS: Layout[] = [
  { id: 'turtle', label: 'Черепаха', hint: 'классика: 144 кости, пять этажей', pos: turtle() },
  { id: 'pyramid', label: 'Пирамида', hint: 'квадратная, четыре этажа, 120 костей', pos: pyramid() },
  { id: 'fortress', label: 'Крепость', hint: 'стена и четыре башни по углам, 144 кости', pos: fortress() },
  { id: 'mountains', label: 'Три горы', hint: 'три горки со ступеньками в полкости, 90 костей', pos: mountains() },
  { id: 'cross', label: 'Крест', hint: 'плоский крест с горкой в середине, 108 костей', pos: cross() },
  { id: 'butterfly', label: 'Бабочка', hint: 'два крыла и тельце, 104 кости', pos: butterfly() },
  { id: 'connect', label: 'Соединялка', hint: 'шисен-сё: поле 18×8, пары соединяют линией с двумя поворотами', pos: connect() },
];

export const layoutOf = (id: unknown) => LAYOUTS.find((l) => l.id === id) ?? LAYOUTS[0];
