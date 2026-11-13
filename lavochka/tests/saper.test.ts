import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { setup, view } from '../src/games/saper/engine';

describe('Сапёр «Наперегонки»', () => {
  it('поле подорвавшегося не открывается соперникам, пока партия не кончилась', () => {
    const s = setup([0, 1], { mode: 'race' }, new SeededRng(1));
    s.boards[0] = { ...s.boards[0], st: 'lost' };
    const other = view(s, [1]).boards[0];
    expect(other.hidden).toBe(true);
    expect(other.mine.length).toBe(0);
    expect(view(s, [0]).boards[0].mine.length).toBeGreaterThan(0);
    s.done = true;
    expect(view(s, [1]).boards[0].mine.length).toBeGreaterThan(0);
  });
});
