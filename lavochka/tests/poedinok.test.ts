/* «Поединок»: перекат кубика, стартовая раскладка, пути (ровно N шагов, один поворот, без перепрыгивания), взятие, дворец,
 * партии ботов. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { choose } from '../src/games/poedinok/ai';
import { apply, cfgFrom, COLS, legal, newState, PALACE, roll, routes, type Die, type State } from '../src/games/poedinok/engine';

const faces = (d: Die) => [d.t, 7 - d.t, d.n, 7 - d.n, d.e, 7 - d.e].sort().join('');

describe('Поединок', () => {
  it('перекат: грани остаются гранями кубика, четыре переката в одну сторону — исходное положение', () => {
    const d: Die = { owner: 0, king: false, t: 5, n: 4, e: 6 };
    for (const dir of ['n', 's', 'e', 'w'] as const) {
      let x = d;
      for (let i = 0; i < 4; i++) {
        x = roll(x, dir);
        expect(faces(x)).toBe('123456');
      }
      expect(x).toEqual(d);
    }
    expect(roll(roll(d, 'n'), 's')).toEqual(d);
    expect(roll(roll(d, 'e'), 'w')).toEqual(d);
  });

  it('старт: 5 1 2 6 К 6 2 1 5, к себе тройка, к сопернику четвёрка', () => {
    const s = newState(cfgFrom({}));
    const tops = (r: number) => Array.from({ length: COLS }, (_, c) => s.cells[r * COLS + c]!).map((d) => (d.king ? 'K' : d.t)).join('');
    expect(tops(7)).toBe('5126K6215');
    expect(tops(0)).toBe('5126K6215');
    for (let c = 0; c < COLS; c++) {
      const w = s.cells[7 * COLS + c]!;
      const b = s.cells[c]!;
      if (w.king) continue;
      expect(7 - w.n).toBe(3); // юг — к белым
      expect(b.n).toBe(3); // север — к чёрным
      expect(faces(w)).toBe('123456');
      expect(faces(b)).toBe('123456');
    }
    expect(s.cells[PALACE[0]]!.king && s.cells[PALACE[1]]!.king).toBe(true);
  });

  it('пути: ровно столько шагов, сколько точек сверху; не через кубики; король — на одну', () => {
    const s = newState(cfgFrom({}));
    // единица b1: только на b2 (вбок заняты соседи)
    const one = routes(s, 7 * COLS + 1);
    expect(one.map((r) => r.to)).toEqual([6 * COLS + 1]);
    // пятёрка a1: прямо на a6 и «Г» с поворотом вправо
    const five = routes(s, 7 * COLS);
    for (const r of five) {
      expect(r.path.length).toBe(6);
      expect(new Set(r.path).size).toBe(6);
    }
    expect(five.some((r) => r.to === 2 * COLS)).toBe(true);
    // король: в начале ходить некуда (вокруг свои), кроме вперёд
    expect(routes(s, PALACE[0]).map((r) => r.to)).toEqual([PALACE[0] - COLS]);
  });

  it('взятие и победа во дворце', () => {
    const s = newState(cfgFrom({}));
    s.cells = s.cells.map(() => null);
    s.cells[6 * COLS + 4] = { owner: 0, king: true, t: 1, n: 4, e: 2 };
    s.cells[1 * COLS + 4] = { owner: 0, king: true, t: 1, n: 4, e: 2 };
    s.cells[3 * COLS + 0] = { owner: 1, king: true, t: 1, n: 3, e: 2 };
    // второй белый король — только для проверки дворца: шагнуть на e8
    const r = apply(s, 0, { type: 'move', from: 1 * COLS + 4, d1: 'n', k: 1, d2: null });
    expect(r!.state.over).toBe(true);
    expect(r!.state.why).toBe('palace');
  });

  it('партии ботов доходят до конца; сложный сильнее лёгкого', () => {
    let hard = 0;
    for (let k = 0; k < 4; k++) {
      const rng = new SeededRng(40 + k);
      const lv = k % 2 ? [2, 0] : [0, 2];
      let s: State = newState(cfgFrom({}));
      for (let i = 0; i < 400 && !s.over; i++) {
        const a = choose(s, s.turn, lv[s.turn], rng) ?? legal(s, s.turn)[0];
        s = apply(s, s.turn, a)!.state;
      }
      expect(s.over).toBe(true);
      if (s.winner != null && lv[s.winner] === 2) hard++;
    }
    expect(hard).toBeGreaterThanOrEqual(3);
  }, 120000);
});
