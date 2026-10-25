/* Плиточник: раздача по ящикам, закупка (остаток — на прилавок, мастерок), строки ведра и «бой», кладка и очки, бонусы, серая стена, боты. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { choose } from '../src/games/azul/ai';
import * as az from '../src/games/azul/engine';

const rng = () => new SeededRng(9);

describe('Плиточник', () => {
  it('ящиков 5/7/9, в каждом по 4 плитки', () => {
    for (const [p, f] of [[2, 5], [3, 7], [4, 9]]) {
      const s = az.setup({}, p, rng());
      expect(s.factories.length).toBe(f);
      expect(s.factories.every((x) => x.length === 4)).toBe(true);
    }
  });

  it('закупка из ящика: остаток — на прилавок; с прилавка первым — мастерок в «бой»', () => {
    let s = az.setup({}, 2, rng());
    s.factories[0] = [0, 0, 1, 2];
    s = az.step(s, { type: 'take', src: 0, kind: 0, row: 1 }, rng())!.state;
    expect(s.boards[0].lines[1]).toEqual({ k: 0, n: 2 });
    expect(s.center).toEqual([1, 2]);
    s = az.step(s, { type: 'take', src: -1, kind: 1, row: 0 }, rng())!.state;
    expect(s.boards[1].floor).toEqual([az.TROWEL]);
    expect(s.next).toBe(1);
  });

  it('лишнее — в «бой»; в строку — только один вид и не тот, что уже на стене', () => {
    let s = az.setup({}, 2, rng());
    s.factories[0] = [3, 3, 3, 1];
    s = az.step(s, { type: 'take', src: 0, kind: 3, row: 0 }, rng())!.state;
    expect(s.boards[0].lines[0]).toEqual({ k: 3, n: 1 });
    expect(s.boards[0].floor).toEqual([3, 3]);
    const b = s.boards[1];
    b.wall[2][az.colOf(4, 2)] = 4;
    expect(az.lineOk(b, 4, 2, false)).toBe(false);
    b.lines[3] = { k: 1, n: 2 };
    expect(az.lineOk(b, 2, 3, false)).toBe(false);
  });

  it('очки: одиночная 1, по ряду и столбцу — сумма цепочек', () => {
    const w = Array.from({ length: 5 }, () => new Array(5).fill(-1));
    w[0][0] = 0;
    expect(az.tilePoints(w, 0, 0)).toBe(1);
    w[0][1] = 1;
    w[1][1] = 2;
    expect(az.tilePoints(w, 0, 1)).toBe(4);
  });

  it('бонусы: ряд +2, столбец +7, все пять одного вида +10', () => {
    const b = { lines: [], wall: Array.from({ length: 5 }, () => new Array(5).fill(-1)), floor: [], score: 0 } as unknown as az.Board;
    for (let c = 0; c < 5; c++) b.wall[0][c] = az.kindAt(0, c);
    for (let r = 0; r < 5; r++) b.wall[r][0] = az.kindAt(r, 0);
    expect(az.bonus(b)).toBe(9);
    for (let r = 0; r < 5; r++) b.wall[r][az.colOf(0, r)] = 0;
    expect(az.bonus(b)).toBe(19);
  });

  it('боты доигрывают: цветная и серая стена, 2–4 игрока', () => {
    for (const [wall, p] of [['color', 2], ['color', 4], ['grey', 3], ['grey', 2]] as const) {
      let s = az.setup({ wall }, p, rng());
      const r = rng();
      for (let i = 0; i < 2000 && !s.over; i++) {
        const seat = az.toAct(s)[0];
        s = az.step(s, choose(s, seat, i % 3, r)!, r)!.state;
      }
      expect(s.over).toBe(true);
      expect(s.winners.length).toBeGreaterThan(0);
    }
  });
});
