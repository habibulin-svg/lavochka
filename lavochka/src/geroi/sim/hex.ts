/* Поле боя: 15×11 гексов, нечётные ряды сдвинуты вправо на полгекса. Клетка — число y·15 + x. */
export const FIELD_W = 15;
export const FIELD_H = 11;
export const CELLS = FIELD_W * FIELD_H;

export const cellOf = (x: number, y: number): number => y * FIELD_W + x;
export const cellX = (c: number): number => c % FIELD_W;
export const cellY = (c: number): number => (c - c % FIELD_W) / FIELD_W;
export const onField = (x: number, y: number): boolean => x >= 0 && x < FIELD_W && y >= 0 && y < FIELD_H;

const EVEN: [number, number][] = [[1, 0], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1]];
const ODD: [number, number][] = [[1, 0], [1, -1], [0, -1], [-1, 0], [0, 1], [1, 1]];

const NEIGHBORS: number[][] = Array.from({ length: CELLS }, (_, c) => {
  const x = cellX(c);
  const y = cellY(c);
  return (y % 2 ? ODD : EVEN).filter(([dx, dy]) => onField(x + dx, y + dy)).map(([dx, dy]) => cellOf(x + dx, y + dy));
});

export const neighbors = (c: number): readonly number[] => NEIGHBORS[c];

/** Расстояние в гексах (через кубические координаты). */
export function hexDist(a: number, b: number): number {
  const ay = cellY(a);
  const by = cellY(b);
  const aq = cellX(a) - (ay - (ay & 1)) / 2;
  const bq = cellX(b) - (by - (by & 1)) / 2;
  const dq = aq - bq;
  const dy = ay - by;
  return (Math.abs(dq) + Math.abs(dy) + Math.abs(dq + dy)) / 2;
}

/** Зеркало поля слева направо: препятствия и топь стоят честно для обеих сторон. */
export const mirrorCell = (c: number): number => cellOf(FIELD_W - 1 - cellX(c), cellY(c));
