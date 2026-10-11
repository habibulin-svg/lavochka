/* Бильярд, физика: шар в угловую и среднюю лузы, отскок от борта, «стоп», оттяжка и накат, винт о борт, разбой. */
import { describe, expect, it } from 'vitest';
import { geometry, HIT_BALL, HIT_RAIL, simulate, speedToPower, tableSpec, type Ball, type TableKind, type TableSize } from '../src/games/billiards/physics';

const shot = (angle: number, power: number, spinX = 0, spinY = 0) => ({ cue: 0, angle, power, spinX, spinY });

describe('физика', () => {
  const cases: [TableKind, TableSize][] = [
    ['pool', 'small'],
    ['pool', 'big'],
    ['russian', 'small'],
    ['russian', 'big'],
    ['snooker', 'big'],
  ];
  for (const [kind, size] of cases) {
    const spec = tableSpec(kind, size);
    const geo = geometry(spec);
    const name = `${kind} ${size}`;
    it(`${name}: шар по диагонали уходит в угловую лузу`, () => {
      const p = geo.pockets[0];
      const balls: Ball[] = [{ id: 0, x: 0.45, y: 0.45, on: true }];
      const res = simulate(geo, balls, shot(Math.atan2(p.y - 0.45, p.x - 0.45), 0.35));
      expect(res.pocketed).toEqual([{ id: 0, pocket: 0 }]);
    });
    it(`${name}: поперёк стола — в среднюю лузу`, () => {
      const balls: Ball[] = [{ id: 0, x: spec.w / 2, y: spec.h * 0.6, on: true }];
      const res = simulate(geo, balls, shot(-Math.PI / 2, 0.3));
      expect(res.pocketed).toEqual([{ id: 0, pocket: 1 }]);
    });
    it(`${name}: от борта отскакивает и останавливается на столе`, () => {
      const balls: Ball[] = [{ id: 0, x: spec.w / 2, y: spec.h / 2, on: true }];
      const res = simulate(geo, balls, shot(0.15, 0.4));
      expect(res.rails).toBeGreaterThan(0);
      expect(res.balls[0].on).toBe(true);
      expect(res.time).toBeGreaterThan(1);
    });
    it(`${name}: «стоп», оттяжка и накат`, () => {
      const y = spec.h / 2;
      const run = (spinY: number, power: number) => {
        const balls: Ball[] = [
          { id: 0, x: 0.5, y, on: true },
          { id: 1, x: 0.5 + 0.25, y, on: true },
        ];
        const res = simulate(geo, balls, shot(0, power, 0, spinY));
        expect(res.first).toBe(1);
        // где биток, когда прицельный дошёл до борта (потом тот может вернуться и задеть биток)
        const rail = res.hits.find((h) => h[1] === HIT_RAIL && h[4] === 1);
        let x = 0.5;
        for (const fr of res.frames) {
          if (rail && fr.t > rail[0]) break;
          for (let i = 0; i < fr.p.length; i += 3) if (fr.p[i] === 0 && fr.p[i + 1] >= 0) x = fr.p[i + 1] / 1000;
        }
        return x - (0.75 - 2 * spec.r);
      };
      // сильный удар без винта: биток скользит и встаёт на месте
      expect(Math.abs(run(0, 0.45))).toBeLessThan(spec.r * 3);
      // оттяжка — назад, накат — вперёд
      expect(run(-1, 0.45)).toBeLessThan(-0.15);
      expect(run(1, 0.3)).toBeGreaterThan(0.1);
    });
    it(`${name}: боковой винт меняет отскок от борта`, () => {
      const out = (spinX: number) => {
        const balls: Ball[] = [{ id: 0, x: spec.w * 0.3, y: spec.h * 0.7, on: true }];
        const res = simulate(geo, balls, shot(-Math.PI / 4, 0.4, spinX), true);
        // направление после первого борта: по кадрам ищем смену знака vy
        const f = res.frames;
        let y0 = spec.h * 0.7;
        let x0 = spec.w * 0.3;
        let pos = { x: x0, y: y0 };
        let minY = Infinity;
        let after: { x: number; y: number } | null = null;
        for (const fr of f) {
          for (let i = 0; i < fr.p.length; i += 3) if (fr.p[i] === 0 && fr.p[i + 1] >= 0) pos = { x: fr.p[i + 1] / 1000, y: fr.p[i + 2] / 1000 };
          if (pos.y < minY) {
            minY = pos.y;
            x0 = pos.x;
            y0 = pos.y;
          } else if (!after && pos.y > y0 + 0.2) after = pos;
        }
        expect(after).not.toBeNull();
        return Math.atan2(after!.y - y0, after!.x - x0);
      };
      const left = out(-1);
      const right = out(1);
      expect(Math.abs(left - right)).toBeGreaterThan(0.1);
    });
    it(`${name}: разбой — шары на столе или в лузах, кадры и удары записаны`, () => {
      const balls: Ball[] = [{ id: 0, x: spec.w * 0.25, y: spec.h / 2, on: true }];
      let k = 1;
      const d = spec.r * 2.005;
      for (let row = 0; row < 5; row++) for (let i = 0; i <= row; i++) balls.push({ id: k++, x: spec.w * 0.75 + row * d * 0.866, y: spec.h / 2 + (i - row / 2) * d, on: true });
      const t0 = performance.now();
      const res = simulate(geo, balls, shot(0, 1));
      const ms = performance.now() - t0;
      for (const b of res.balls)
        if (b.on) {
          expect(b.x).toBeGreaterThanOrEqual(spec.r * 0.9);
          expect(b.x).toBeLessThanOrEqual(spec.w - spec.r * 0.9);
          expect(b.y).toBeGreaterThanOrEqual(spec.r * 0.9);
          expect(b.y).toBeLessThanOrEqual(spec.h - spec.r * 0.9);
        }
      // остановились не внахлёст
      const on = res.balls.filter((b) => b.on);
      for (let i = 0; i < on.length; i++)
        for (let j = i + 1; j < on.length; j++) expect(Math.hypot(on[i].x - on[j].x, on[i].y - on[j].y)).toBeGreaterThan(2 * spec.r - 0.0003);
      // все шары разлетелись
      const moved = res.balls.filter((b, i) => !b.on || Math.hypot(b.x - balls[i].x, b.y - balls[i].y) > spec.r).length;
      expect(moved).toBeGreaterThan(10);
      expect(res.frames.length).toBeGreaterThan(30);
      expect(res.hits.filter((h) => h[1] === HIT_BALL).length).toBeGreaterThan(15);
      expect(res.time).toBeLessThan(60);
      expect(ms).toBeLessThan(1500);
    });
  }
  it('сила ↔ скорость', () => {
    expect(speedToPower(10)).toBeCloseTo(1);
    expect(speedToPower(0.12)).toBeCloseTo(0);
  });
});
