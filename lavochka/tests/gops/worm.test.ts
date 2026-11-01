import { describe, expect, it } from 'vitest';
import { toPx } from '../../src/gops/sim/fx';
import { Mask } from '../../src/gops/sim/mask';
import { CLIMB, type WormEvent, jump, makeWorm, tickWorm, walk } from '../../src/gops/sim/worm';

const WATER = 390;

function flat(top = 300): Mask {
  const m = new Mask(800, 400);
  m.fillRect(0, top, 800, 400 - top);
  return m;
}

function settle(w: ReturnType<typeof makeWorm>, m: Mask, ev: WormEvent[] = [], n = 600) {
  for (let t = 0; t < n && w.state === 'air'; t++) tickWorm(w, m, WATER, ev);
}

describe('gops/worm: боец', () => {
  it('падает на землю и встаёт', () => {
    const m = flat();
    const w = makeWorm(1, 0, 100, 250);
    settle(w, m);
    expect(w.state).toBe('stand');
    expect(toPx(w.y)).toBeGreaterThan(285);
    expect(toPx(w.y)).toBeLessThan(300);
  });

  it('ходит по ровному и поднимается на ступеньку, но не на стену', () => {
    const m = flat();
    m.fillRect(200, 300 - CLIMB, 100, CLIMB); // ступенька
    m.fillRect(400, 200, 20, 100); // стена
    const w = makeWorm(1, 0, 150, 250);
    settle(w, m);
    const ev: WormEvent[] = [];
    for (let t = 0; t < 2000; t++) {
      walk(w, m, 1, ev);
      tickWorm(w, m, WATER, ev);
    }
    expect(toPx(w.x)).toBeGreaterThan(300);
    expect(toPx(w.x)).toBeLessThan(400);
    expect(ev.some((e) => e.kind === 'blocked')).toBe(true);
  });

  it('с обрыва — срывается в полёт и приземляется ниже', () => {
    const m = new Mask(800, 400);
    m.fillRect(0, 200, 300, 200);
    m.fillRect(300, 300, 500, 100);
    const w = makeWorm(1, 0, 280, 150);
    settle(w, m);
    const ev: WormEvent[] = [];
    let flew = false;
    for (let t = 0; t < 400; t++) {
      walk(w, m, 1, ev);
      tickWorm(w, m, WATER, ev);
      if (w.state === 'air') flew = true;
    }
    expect(flew).toBe(true);
    expect(toPx(w.y)).toBeGreaterThan(280);
  });

  it('прыжок вперёд — летит в сторону взгляда и встаёт', () => {
    const m = flat();
    const w = makeWorm(1, 0, 300, 250);
    settle(w, m);
    const x0 = w.x;
    w.facing = -1;
    jump(w);
    expect(w.state).toBe('air');
    settle(w, m);
    expect(w.state).toBe('stand');
    expect(w.x).toBeLessThan(x0);
  });

  it('падение с высоты ранит, с маленькой — нет', () => {
    const m = flat();
    const low = makeWorm(1, 0, 100, 270);
    const ev1: WormEvent[] = [];
    settle(low, m, ev1);
    expect(low.hp).toBe(100);
    const high = makeWorm(2, 0, 200, -300);
    const ev2: WormEvent[] = [];
    m.fillRect(0, 0, 0, 0);
    settle(high, new Mask(800, 400, flat().d), ev2, 2000);
    expect(high.hp).toBeLessThan(100);
    expect(ev2.some((e) => e.kind === 'fall-damage')).toBe(true);
  });

  it('в жидкость — выбыл', () => {
    const m = new Mask(800, 400);
    const w = makeWorm(1, 0, 100, 300);
    const ev: WormEvent[] = [];
    settle(w, m, ev);
    expect(w.state).toBe('dead');
    expect(ev.at(-1)?.kind).toBe('drown');
  });
});
