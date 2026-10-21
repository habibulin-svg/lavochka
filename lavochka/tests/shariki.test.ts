/* «Шарики»: путь равномерный и ведёт к яме, цепочка выкатывается и без выстрелов доходит до ямы (проигрыш), прицельная стрельба убирает тройки и проходит лёгкий уровень. */
import { describe, expect, it } from 'vitest';
import { D, GRAY, makePath, levelSpec, Zuma } from '../src/games/shariki/logic';
import { chainOf, zumaOf } from '../src/games/shariki/versus';

describe('Шарики', () => {
  it('путь: шаг 2 точки, все 100 уровней', () => {
    for (let n = 1; n <= 100; n++) {
      const p = makePath(levelSpec(n));
      expect(p.len, `уровень ${n}`).toBeGreaterThan(1500);
      for (let i = 1; i < p.pts.length; i += 97) {
        const d = Math.hypot(p.pts[i][0] - p.pts[i - 1][0], p.pts[i][1] - p.pts[i - 1][1]);
        expect(Math.abs(d - 2)).toBeLessThan(0.01);
      }
    }
  });
  it('без выстрелов цепочка доходит до ямы — проигрыш', () => {
    const z = new Zuma(1);
    for (let i = 0; i < 60 * 600 && !z.lost; i++) z.update(16);
    expect(z.lost).toBe(true);
  });
  it('шары цепочки не налезают друг на друга', () => {
    const z = new Zuma(5);
    for (let i = 0; i < 600; i++) z.update(16);
    for (let i = 1; i < z.balls.length; i++) expect(z.balls[i].s - z.balls[i - 1].s).toBeGreaterThanOrEqual(D - 0.01);
  });
  it('прицельная стрельба набирает очки и проходит лёгкий уровень', () => {
    let wins = 0;
    for (const n of [1, 2]) {
      const z = new Zuma(n);
      for (let i = 0; i < 60 * 900 && !z.won && !z.lost; i++) {
        if (i % 20 === 0) {
          const a = z.bestAim();
          if (a != null) {
            z.aim = a;
            z.shoot();
          } else z.swap();
        }
        z.update(16);
      }
      expect(z.score).toBeGreaterThan(0);
      if (z.won) wins++;
    }
    expect(wins).toBeGreaterThan(0);
  });
  it('серые шары: сдвигают цепочку к яме, уходят только вместе с тройкой рядом', () => {
    const z = new Zuma(1);
    z.balls = [0, 0, GRAY, 1, 1].map((color, i) => ({ color, s: 300 + i * D, id: i + 1 }));
    const head = z.balls[4].s;
    z.addGray(2);
    expect(z.balls.length).toBe(7);
    expect(z.balls[z.balls.length - 1].s).toBeCloseTo(head + 2 * D);
    // серый не складывается в тройку
    z.balls = [GRAY, GRAY, GRAY, 2].map((color, i) => ({ color, s: 300 + i * D, id: i + 1 }));
    (z as any).checkAt(0, false);
    expect(z.balls.length).toBe(4);
    // тройка рядом с серым убирает и его
    z.balls = [3, 3, 3, GRAY, 1].map((color, i) => ({ color, s: 300 + i * D, id: i + 1 }));
    (z as any).checkAt(1, false);
    expect(z.balls.map((b) => b.color)).toEqual([1]);
    expect(z.pops[0].n).toBe(3);
  });

  it('цепочка в снимке сети — кусками и восстанавливается', () => {
    const z = new Zuma(1);
    z.balls = [0, 1, GRAY, 2].map((color, i) => ({ color, s: 100 + i * D + (i > 1 ? 50 : 0), id: i + 1 }));
    const ch = chainOf(z);
    expect(ch).toEqual([
      [100, '01'],
      [210, 'g2'],
    ]);
    const back = zumaOf({ ch, cur: 0, next: 1, aim: 0, score: 0 } as any, z.spec);
    expect(back.balls.map((b) => [b.color, b.s])).toEqual(z.balls.map((b) => [b.color, b.s]));
  });
});
