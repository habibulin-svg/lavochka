/* Бильярд, физика: шар по прямой в угловую лузу, отскок от борта, передача удара прямым соударением, разбой без выхода за стол. */
import { describe, expect, it } from 'vitest';
import { geometry, simulate, TABLES, type Ball } from '../src/games/billiards/physics';

describe('физика', () => {
  for (const id of ['russian', 'pool'] as const) {
    const spec = TABLES[id];
    const geo = geometry(spec);
    it(`${id}: шар по диагонали уходит в угловую лузу`, () => {
      const balls: Ball[] = [{ id: 0, x: 0.5, y: 0.5, on: true }];
      const res = simulate(geo, balls, { cue: 0, angle: Math.atan2(-0.5, -0.5), power: 0.5, spinX: 0, spinY: 0 });
      expect(res.pocketed).toEqual([{ id: 0, pocket: 0 }]);
    });
    it(`${id}: от борта отскакивает и останавливается на столе`, () => {
      const balls: Ball[] = [{ id: 0, x: spec.w / 2, y: spec.h / 2, on: true }];
      const res = simulate(geo, balls, { cue: 0, angle: 0, power: 0.4, spinX: 0, spinY: 0 });
      expect(res.rails).toBeGreaterThan(0);
      expect(res.balls[0].on).toBe(true);
      expect(res.time).toBeGreaterThan(0.5);
    });
    it(`${id}: прямой удар — биток почти встаёт, прицельный катится`, () => {
      const balls: Ball[] = [
        { id: 0, x: 0.6, y: spec.h / 2, on: true },
        { id: 1, x: 1.0, y: spec.h / 2, on: true },
      ];
      const res = simulate(geo, balls, { cue: 0, angle: 0, power: 0.3, spinX: 0, spinY: 0 });
      expect(res.first).toBe(1);
      const cue = res.balls[0];
      const obj = res.balls[1];
      expect(obj.x - 1.0).toBeGreaterThan(cue.x - 0.6);
    });
    it(`${id}: разбой — все шары на столе или в лузах, кадры записаны`, () => {
      const balls: Ball[] = [{ id: 0, x: spec.w * 0.25, y: spec.h / 2, on: true }];
      let k = 1;
      const d = spec.r * 2.02;
      for (let row = 0; row < 5; row++)
        for (let i = 0; i <= row; i++) balls.push({ id: k++, x: spec.w * 0.75 + row * d * 0.866, y: spec.h / 2 + (i - row / 2) * d, on: true });
      const res = simulate(geo, balls, { cue: 0, angle: 0, power: 1, spinX: 0, spinY: 0 });
      for (const b of res.balls) if (b.on) {
        expect(b.x).toBeGreaterThanOrEqual(spec.r * 0.9);
        expect(b.x).toBeLessThanOrEqual(spec.w - spec.r * 0.9);
        expect(b.y).toBeGreaterThanOrEqual(spec.r * 0.9);
        expect(b.y).toBeLessThanOrEqual(spec.h - spec.r * 0.9);
      }
      expect(res.frames.length).toBeGreaterThan(10);
      expect(res.time).toBeLessThan(25);
    });
  }
});
