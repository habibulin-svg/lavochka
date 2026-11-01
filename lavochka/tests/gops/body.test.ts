import { describe, expect, it } from 'vitest';
import { type Body, free, resting, stepBody } from '../../src/gops/sim/body';
import { toFx, toPx } from '../../src/gops/sim/fx';
import { Mask } from '../../src/gops/sim/mask';

const ball = (x: number, y: number, vx = 0, vy = 0, bounce = 128, slide = 200): Body =>
  ({ x: toFx(x), y: toFx(y), vx, vy, r: 4, bounce, slide });

function ground(top = 300): Mask {
  const m = new Mask(800, 400);
  m.fillRect(0, top, 800, 400 - top);
  return m;
}

describe('gops/body: тело против маски', () => {
  it('падает, касается земли и не проваливается', () => {
    const m = ground();
    const b = ball(100, 50, 0, 0, 0);
    let hits = 0;
    for (let t = 0; t < 600; t++) if (stepBody(b, m)) hits++;
    expect(hits).toBeGreaterThan(0);
    expect(free(m, b.x, b.y, b.r)).toBe(true);
    expect(toPx(b.y)).toBeGreaterThanOrEqual(294);
    expect(toPx(b.y)).toBeLessThan(300);
    expect(resting(b, m)).toBe(true);
  });

  it('быстрый снаряд не проскакивает тонкую стенку', () => {
    const m = new Mask(800, 400);
    m.fillRect(400, 0, 2, 400);
    const b = ball(100, 200, toFx(60), 0);
    for (let t = 0; t < 20; t++) stepBody(b, m, 0);
    expect(toPx(b.x)).toBeLessThan(400);
  });

  it('отскок от пола: мячик подпрыгивает ниже начальной высоты', () => {
    const m = ground();
    const b = ball(100, 100, 0, 0, 200);
    let up = false, top = 1e9;
    for (let t = 0; t < 400; t++) {
      stepBody(b, m);
      if (b.vy < 0) up = true;
      if (up) top = Math.min(top, toPx(b.y));
    }
    expect(up).toBe(true);
    expect(top).toBeGreaterThan(100);
  });

  it('детерминизм: два одинаковых прогона — одно и то же состояние', () => {
    const run = () => {
      const m = ground();
      m.fillCircle(300, 300, 60);
      const b = ball(120, 40, 900, -300, 160, 220);
      for (let t = 0; t < 500; t++) stepBody(b, m, 38, 3);
      return [b.x, b.y, b.vx, b.vy];
    };
    const a = run();
    expect(run()).toEqual(a);
    for (const v of a) expect(Number.isInteger(v)).toBe(true);
  });
});
