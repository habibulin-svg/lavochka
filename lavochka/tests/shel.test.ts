import { describe, expect, it } from 'vitest';
import board from '../src/games/hodilki/data/shel.json';

describe('Шёл солдат: поле', () => {
  it('сто сорок клеток по порядку, движение по возрастанию', () => {
    expect(board.cells.length).toBe(140);
    expect(board.end).toBe(140);
    expect(board.w).toBe(2435);
    expect(board.h).toBe(3094);
    // координаты внутри поля
    for (const [i, c] of board.cells.entries()) {
      expect(c.x, `клетка ${i + 1}`).toBeGreaterThanOrEqual(0);
      expect(c.x).toBeLessThanOrEqual(board.w);
      expect(c.y).toBeGreaterThanOrEqual(0);
      expect(c.y).toBeLessThanOrEqual(board.h);
    }
  });

  it('смысловые знаки сохранены, известные переведены в коды движка', () => {
    const withSign = board.cells.filter((c) => (c as { q?: string }).q);
    expect(withSign.length).toBe(140);
    const skip = board.cells.filter((c) => (c as { s?: string }).s === 'skip').length;
    const start = board.cells.filter((c) => (c as { s?: string }).s === 'start').length;
    expect(skip, 'привалы').toBe(8);
    expect(start, 'старт').toBe(1);
    // ярмарки чудес — на 9, 48 и 88
    const fairs = board.cells
      .map((c, i) => ({ i: i + 1, q: (c as { q?: string }).q }))
      .filter((c) => c.q === 'fair')
      .map((c) => c.i);
    expect(fairs).toEqual([9, 48, 88]);
    // нищенка — 15, 17, 19; ведьма — 21: от них зависит Конь-огонь
    const beggars = board.cells.map((c, i) => ({ i: i + 1, q: (c as { q?: string }).q })).filter((c) => c.q === 'beggar').map((c) => c.i);
    expect(beggars).toEqual([15, 17, 19]);
    const witch = board.cells.map((c, i) => ({ i: i + 1, q: (c as { q?: string }).q })).filter((c) => c.q === 'witch').map((c) => c.i);
    expect(witch).toEqual([21]);
  });
});
