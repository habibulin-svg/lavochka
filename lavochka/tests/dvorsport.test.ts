import { describe, expect, it } from 'vitest';
import { arc, body, carry, fly, kick, MAT, nearest, sample, speedFor } from '../src/core/dvorsport/body';

describe('дворовый спорт: физика тел', () => {
  const ball = () => body(0, 0, 1.2, 0.035);

  it('детерминированно: один удар — один полёт', () => {
    const b = kick(ball(), 18, 0.1, 0.5, 4);
    const a = fly(b, { mat: MAT.ball });
    const c = fly(b, { mat: MAT.ball });
    expect(a.body).toEqual(c.body);
    expect(a.frames).toEqual(c.frames);
  });

  it('мяч падает, подпрыгивает, катится и останавливается', () => {
    const r = fly(kick(ball(), 15, 0, 0.6), { mat: MAT.ball, maxT: 20 });
    expect(r.rest).toBe(true);
    expect(r.land).not.toBeNull();
    expect(r.hits.filter((h) => h.k === 'ground').length).toBeGreaterThan(1);
    expect(r.body.y).toBeGreaterThan(r.land!.y);
    expect(r.body.z).toBeCloseTo(0.035, 5);
  });

  it('без воздуха место падения совпадает с расчётом carry, speedFor обратна carry', () => {
    const mat = { ...MAT.ball, drag: 0 };
    const v = 14;
    const p = 0.55;
    const r = fly(kick(ball(), v, 0, p), { mat });
    const c = carry(v, p, 1.2, 0.035);
    expect(r.land!.y).toBeCloseTo(c.d, 1);
    expect(speedFor(c.d, p, 1.2, 0.035)).toBeCloseTo(v, 3);
    const pts = arc(kick(ball(), v, 0, p), 10);
    expect(pts[9][1]).toBeCloseTo(c.d, 3);
  });

  it('сопротивление воздуха укорачивает полёт', () => {
    const b = kick(ball(), 25, 0, 0.6);
    expect(fly(b, { mat: MAT.ball }).land!.y).toBeLessThan(fly(b, { mat: { ...MAT.ball, drag: 0 } }).land!.y);
  });

  it('стенки отражают, stop обрывает полёт', () => {
    const walls = { x0: -5, x1: 5, y0: -5, y1: 5, wall: 0.5 };
    const r = fly(kick(body(0, 0, 0.035, 0.035), 10, 0, 0), { mat: MAT.ball, walls, maxT: 20 });
    expect(r.hits.some((h) => h.k === 'wall')).toBe(true);
    expect(Math.abs(r.body.y)).toBeLessThanOrEqual(5);
    const s = fly(kick(ball(), 15, 0, 0.6), { mat: MAT.ball, stop: (_b, t) => t > 0.5 });
    expect(s.t).toBeLessThan(0.51);
  });

  it('кадры и ловля: sample между кадрами, nearest находит ближнюю точку', () => {
    const r = fly(kick(ball(), 15, 0, 0.5), { mat: MAT.chizh });
    const m = sample(r.frames, 0.25);
    expect(m[2]).toBeGreaterThan(0);
    const n = nearest(r.frames, 0, r.land!.y, 2.1);
    expect(n).not.toBeNull();
    expect(n!.d).toBeLessThan(0.5);
  });
});
