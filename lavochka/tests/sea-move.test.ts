import { describe, expect, it } from 'vitest';
import {
  boardOf,
  canEnterPort,
  canSail,
  currentDrift,
  key,
  line,
  stepsAllowed,
  type Board,
  type MoveContext,
  type MovingShip,
} from '../src/games/sea/move';

const ship = (at: { x: number; y: number }, over: Partial<MovingShip> = {}): MovingShip => ({
  id: 's1',
  cls: 'galleon',
  side: 'spanish',
  hits: 0,
  ammo: 5,
  at,
  ...over,
});

const board: Board = boardOf(
  Array.from({ length: 8 }, (_, x) => Array.from({ length: 8 }, (_, y) => ({ x, y }))).flat(),
  8,
  8,
);

const ctx = (over: Partial<MoveContext> = {}): MoveContext => ({
  board,
  occupied: new Map(),
  ship: ship({ x: 3, y: 3 }),
  wind: { from: 'N', weather: 'breeze' },
  ...over,
});

describe('ход корабля: линия, ветер и запреты', () => {
  it('линия идёт по румбу, ближний шаг первым', () => {
    expect(line(2, 2, 'E', 3)).toEqual([{ x: 3, y: 2 }, { x: 4, y: 2 }, { x: 5, y: 2 }]);
    expect(line(2, 2, 'NW', 2)).toEqual([{ x: 1, y: 1 }, { x: 0, y: 0 }]);
  });

  it('скорость берётся из ветра: румб — это ОТКУДА дует', () => {
    // ветер с норда: в корму идёт курс на зюйд
    const c = ctx();
    expect(stepsAllowed(c, 'S')).toBe(3);
    expect(stepsAllowed(c, 'SE')).toBe(3);
    expect(stepsAllowed(c, 'E')).toBe(2);
    expect(stepsAllowed(c, 'NE')).toBe(1);
    expect(stepsAllowed(c, 'N')).toBe(0);

    const calm = ctx({ wind: { from: 'N', weather: 'calm' } });
    expect(stepsAllowed(calm, 'S')).toBe(0);
    expect(stepsAllowed({ ...calm, oars: true }, 'N')).toBe(1);

    const storm = ctx({ wind: { from: 'N', weather: 'storm' }, oars: true });
    expect(stepsAllowed(storm, 'S')).toBe(0);
  });

  it('дальше разрешённого не пройти, чужие корабли и чужие порты не пускают', () => {
    expect(canSail(ctx(), 'S', 4)).toEqual({ ok: false, why: 'ветер не позволит пройти столько' });
    expect(canSail(ctx(), 'S', 3)).toEqual({ ok: true, to: { x: 3, y: 6 } });
    expect(canSail(ctx(), 'S', 0)).toEqual({ ok: true, to: { x: 3, y: 3 } });

    const blocked = ctx({ occupied: new Map([[key(3, 4), ['s2']]]) });
    expect(canSail(blocked, 'S', 3)).toEqual({ ok: false, why: 'клетка занята другим кораблём' });

    const withPort = boardOf([{ x: 3, y: 3 }, { x: 3, y: 4, port: { side: 'pirate' } }], 8, 8);
    expect(canSail(ctx({ board: withPort }), 'S', 1)).toEqual({ ok: false, why: 'чужой порт' });

    const ownPort = boardOf([{ x: 3, y: 3 }, { x: 3, y: 4, port: { side: 'spanish' } }], 8, 8);
    const crowded = ctx({ board: ownPort, occupied: new Map([[key(3, 4), ['s2', 's3']]]) });
    expect(canSail(crowded, 'S', 1).ok).toBe(true);
  });

  it('за пределы карты не выйти, и понятно, кто в какой порт может заходить', () => {
    const edge = ctx({ ship: ship({ x: 7, y: 7 }) });
    expect(canSail(edge, 'S', 1)).toEqual({ ok: false, why: 'за пределами карты' });

    expect(canEnterPort('spanish', { side: 'spanish' })).toBe(true);
    expect(canEnterPort('spanish', { side: 'pirate' })).toBe(false);
    expect(canEnterPort('pirate', { side: 'pirate' })).toBe(true);
    expect(canEnterPort('pirate', { side: 'spanish' })).toBe(false);
  });

  it('течение сносит к острию только если там есть клетка', () => {
    const withCurrent = boardOf([{ x: 0, y: 0, current: 'E' }, { x: 1, y: 0 }], 2, 2);
    expect(currentDrift(withCurrent, { x: 0, y: 0 })).toEqual({ x: 1, y: 0 });
    expect(currentDrift(withCurrent, { x: 1, y: 0 })).toBeNull();
    const edge = boardOf([{ x: 1, y: 0, current: 'E' }], 2, 2);
    expect(currentDrift(edge, { x: 1, y: 0 })).toBeNull();
  });
});
