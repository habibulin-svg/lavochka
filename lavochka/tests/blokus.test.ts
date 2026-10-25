/* Блоки: фигурки и повороты, первый ход в угол, касание уголком, не стороной, выбывание, счёт, режимы, боты. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { choose } from '../src/games/blokus/ai';
import * as bk from '../src/games/blokus/engine';

describe('Блоки', () => {
  it('21 фигурка, 89 клеток, 91 положение', () => {
    expect(bk.PIECES.length).toBe(21);
    expect(bk.TOTAL).toBe(89);
    expect(bk.ORIENTS.reduce((a, o) => a + o.length, 0)).toBe(91);
  });

  it('первая фигурка — на свою начальную клетку', () => {
    const s = bk.setup({}, 4);
    expect(bk.step(s, { type: 'place', piece: 0, cells: [1] })).toBeNull();
    expect(bk.step(s, { type: 'place', piece: 0, cells: [0] })).not.toBeNull();
    const d = bk.setup({ mode: 'duo' }, 2);
    expect(bk.anchors(d, 0)).toEqual([4 * 14 + 4]);
  });

  it('дальше — уголком к своим, не стороной', () => {
    let s = bk.setup({}, 4);
    s = bk.step(s, { type: 'place', piece: 0, cells: [0] })!.state;
    // остальные цвета ставят по клетке в свои углы
    s = bk.step(s, { type: 'place', piece: 0, cells: [19] })!.state;
    s = bk.step(s, { type: 'place', piece: 0, cells: [399] })!.state;
    s = bk.step(s, { type: 'place', piece: 0, cells: [380] })!.state;
    expect(bk.step(s, { type: 'place', piece: 1, cells: [1, 2] })).toBeNull(); // сторона
    expect(bk.step(s, { type: 'place', piece: 1, cells: [21, 22] })).not.toBeNull(); // уголок
    expect(bk.step(s, { type: 'place', piece: 1, cells: [21, 23] })).toBeNull(); // не фигурка
  });

  it('вдвоём — по два цвета; втроём — зелёный по очереди', () => {
    const two = bk.setup({}, 2);
    expect([0, 1, 2, 3].map((c) => bk.ownerOf(two, c))).toEqual([0, 1, 0, 1]);
    let s = bk.setup({ mode: 'three' }, 3);
    for (const c of [0, 19, 399]) s = bk.step(s, { type: 'place', piece: 0, cells: [c] })!.state;
    expect(bk.toAct(s)).toEqual([0]);
    s = bk.step(s, { type: 'place', piece: 0, cells: [380] })!.state;
    for (let i = 0; i < 3; i++) s = bk.step(s, bk.legal(s)[0])!.state;
    expect(bk.toAct(s)).toEqual([1]); // второй круг зелёным — второй игрок
  });

  it('счёт: минус оставшиеся клетки; всё выложил — +15, последней одиночная — +20', () => {
    const s = bk.setup({ mode: 'duo' }, 2);
    s.hand[0] = [];
    s.lastPiece[0] = 0;
    s.hand[1] = [20, 0];
    expect(bk.score(s)).toEqual([20, -6]);
  });

  it('боты доигрывают во всех режимах', () => {
    for (const [mode, n] of [['classic', 4], ['classic', 2], ['three', 3], ['duo', 2]] as const) {
      let s = bk.setup({ mode }, n);
      const rng = new SeededRng(3);
      for (let i = 0; i < 200 && !s.over; i++) s = bk.step(s, choose(s, bk.toAct(s)[0], i % 3, rng)!)!.state;
      expect(s.over).toBe(true);
      expect(s.scores!.length).toBe(n);
    }
  }, 120000);
});
