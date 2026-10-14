/* «Чудовище Джио-Джанги»: граф ленты, снятый с картинки поля, и развилки. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { CELLS, HOTEL, NEIGH, apply, distFrom, isAnimal, isStop, newState, options } from '../src/games/djio/engine';

const dist = (a: number, b: number) => Math.hypot(CELLS[a].x - CELLS[b].x, CELLS[a].y - CELLS[b].y);

describe('Джио-Джанги: граф поля', () => {
  it('рёбра двусторонние, без петель и повторов', () => {
    NEIGH.forEach((ns, i) => {
      expect(new Set(ns).size, `клетка ${i}`).toBe(ns.length);
      for (const n of ns) {
        expect(n, `петля ${i}`).not.toBe(i);
        expect(NEIGH[n], `ребро ${i}→${n} без обратного`).toContain(i);
      }
    });
  });

  it('соседи — ближайшие клетки ленты: нет перескоков через клетку', () => {
    const lens = NEIGH.flatMap((ns, i) => ns.filter((n) => !isStop(i) && !isStop(n)).map((n) => dist(i, n))).sort((a, b) => a - b);
    const step = lens[Math.floor(lens.length / 2)];
    NEIGH.forEach((ns, i) => {
      for (const n of ns) if (!isStop(i) && !isStop(n)) expect(dist(i, n), `ребро ${i}–${n}`).toBeLessThan(step * 1.6);
    });
  });

  it('у обычной клетки 2–3 соседа, тупики — только у логов зверей', () => {
    NEIGH.forEach((ns, i) => {
      if (isStop(i)) return;
      expect(ns.length, `клетка ${i}`).toBeGreaterThan(0);
      expect(ns.length, `клетка ${i}`).toBeLessThanOrEqual(3);
      if (ns.length === 1) expect(CELLS[i].lair, `тупик ${i} не у зверя`).toBe(true);
    });
  });

  it('из любой клетки можно дойти до гостиницы и до каждого зверя', () => {
    const toHotel = distFrom([HOTEL]);
    CELLS.forEach((_, i) => expect(toHotel[i], `клетка ${i} оторвана от гостиницы`).toBeGreaterThanOrEqual(0));
    const animals = CELLS.map((_, i) => i).filter(isAnimal);
    expect(animals.length).toBeGreaterThanOrEqual(5);
    for (const a of animals) expect(distFrom([a]).every((d) => d >= 0), `зверь ${a}`).toBe(true);
    for (const k of ['hotel', 'house', 'monastery', 'hut', 'fire']) expect(CELLS.filter((c) => c.kind === k).length, k).toBe(1);
  });

  it('после броска на развилке доступны все дороги', () => {
    for (let i = 0; i < CELLS.length; i++) {
      if (NEIGH[i].length < 2 || isStop(i)) continue;
      const s = newState([0, 1], new SeededRng(i));
      s.done = [true, true];
      s.phase = 'roll';
      s.rounds = 1;
      s.pos[0] = i;
      s.items[0] = ['horse'];
      const res = apply(s, 0, { type: 'roll' }, { int: () => 5, next: () => 0, getState: () => 0 })!;
      if (res.state.phase !== 'move' || res.state.pos[0] !== i) continue;
      expect(options(res.state, 0).sort(), `клетка ${i}`).toEqual(NEIGH[i].slice().sort());
    }
  });
});
