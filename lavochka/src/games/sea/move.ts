/* Ход корабля — общее для «Захвата колоний» и «Пиратов».
 *
 * Из правил:
 *   «Корабли могут ходить везде, где есть клетки. В одном квадрате может находиться только
 *    один корабль (это ограничение не распространяется на портовые клетки). Проходить через
 *    клетки с другими кораблями и через чужие порты нельзя»;
 *   «Ходят только по прямой линии, „ходом коня“ двигаться нельзя»;
 *   «Если корабль попадает на задний кончик стрелки, его сносит к острию»;
 *   «Ветер, дующий прямо в нос корабля, называется противным: корабль должен сворачивать
 *    с курса или стоять на месте».
 *
 * Напоминание про ветер: `from` — ОТКУДА дует. При ветре с норда фордевинд — это курс на зюйд.
 */
import { POINT_STEP, sailSteps, type Point, type Wind } from './wind';
import { isSunk, type Ship, type Side } from './ship';

export interface Port {
  side: Side;
}

export interface Cell {
  x: number;
  y: number;
  /** Портовые клетки: в них может стоять несколько кораблей. */
  port?: Port;
  /** Течение: встав на клетку, корабль сносит на одну клетку в эту сторону. */
  current?: Point;
}

export interface Board {
  cells: Map<string, Cell>;
  width: number;
  height: number;
}

export const key = (x: number, y: number) => x + ',' + y;

export function boardOf(list: Cell[], width: number, height: number): Board {
  const cells = new Map<string, Cell>();
  for (const c of list) cells.set(key(c.x, c.y), c);
  return { cells, width, height };
}

/** Клетки прямой линии от исходной в сторону румба: ближний шаг первым. */
export function line(x: number, y: number, course: Point, count: number): { x: number; y: number }[] {
  const [dx, dy] = POINT_STEP[course];
  const out: { x: number; y: number }[] = [];
  for (let i = 1; i <= count; i++) out.push({ x: x + dx * i, y: y + dy * i });
  return out;
}

export interface MovingShip extends Ship {
  at: { x: number; y: number };
}

export interface MoveContext {
  board: Board;
  /** Ключ клетки — список кораблей на ней. */
  occupied: Map<string, string[]>;
  ship: MovingShip;
  wind: Wind;
  /** Пираты на вёслах: одна клетка в штиль и против ветра. */
  oars?: boolean;
}

/** Сколько клеток разрешает ветер этим курсом (с учётом вёсел). */
export function stepsAllowed(ctx: MoveContext, course: Point): number {
  const { wind, oars } = ctx;
  if (wind.weather === 'storm') return 0;
  if (wind.weather === 'calm') return oars ? 1 : 0;
  const sail = sailSteps(wind.from, course);
  return sail > 0 ? sail : oars ? 1 : 0;
}

export type MoveResult =
  | { ok: true; to: { x: number; y: number } }
  | { ok: false; why: string };

/** Может ли корабль пройти этим курсом столько шагов. */
export function canSail(ctx: MoveContext, course: Point, steps: number): MoveResult {
  const { board, occupied, ship } = ctx;
  if (isSunk(ship)) return { ok: false, why: 'корабль потоплен' };
  if (steps < 0) return { ok: false, why: 'шагов не может быть меньше нуля' };
  if (steps === 0) return { ok: true, to: ship.at };
  if (steps > stepsAllowed(ctx, course)) return { ok: false, why: 'ветер не позволит пройти столько' };
  const path = line(ship.at.x, ship.at.y, course, steps);
  for (const p of path) {
    const cell = board.cells.get(key(p.x, p.y));
    if (!cell) return { ok: false, why: 'за пределами карты' };
    const others = (occupied.get(key(p.x, p.y)) ?? []).filter((id) => id !== ship.id);
    if (others.length > 0 && !cell.port) return { ok: false, why: 'клетка занята другим кораблём' };
    if (cell.port && !canEnterPort(ship.side, cell.port)) return { ok: false, why: 'чужой порт' };
  }
  return { ok: true, to: path[path.length - 1] };
}

/** В свои порты можно, пиратам — в любые неиспанские, испанцам — только в испанские. */
export function canEnterPort(side: Side, port: Port): boolean {
  return side === 'pirate' ? port.side !== 'spanish' : port.side === 'spanish';
}

/** Течение: со клетки с течением сносит к острию, если там есть клетка. */
export function currentDrift(board: Board, at: { x: number; y: number }): { x: number; y: number } | null {
  const cell = board.cells.get(key(at.x, at.y));
  if (!cell?.current) return null;
  const [dx, dy] = POINT_STEP[cell.current];
  const to = { x: at.x + dx, y: at.y + dy };
  return board.cells.has(key(to.x, to.y)) ? to : null;
}

/** Ветер выбросил корабль за линию клеток — значит, на берег. */
export const isAshore = (board: Board, at: { x: number; y: number }): boolean => !board.cells.has(key(at.x, at.y));
