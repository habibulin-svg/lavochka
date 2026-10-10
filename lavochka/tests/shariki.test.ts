/* «Шарики»: путь равномерный и ведёт к яме, цепочка выкатывается и без выстрелов доходит до ямы (проигрыш), прицельная стрельба убирает тройки и проходит лёгкий уровень. */
import { describe, expect, it } from 'vitest';
import { D, makePath, levelSpec, Zuma } from '../src/games/shariki/logic';

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
});
