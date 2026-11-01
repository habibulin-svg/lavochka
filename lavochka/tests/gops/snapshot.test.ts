import { describe, expect, it } from 'vitest';
import { Bot } from '../../src/gops/bot/bot';
import { Mask } from '../../src/gops/sim/mask';
import { Rng } from '../../src/gops/sim/rng';
import { applySnapshot, takeSnapshot } from '../../src/gops/sim/snapshot';
import { ARSENAL_AMMO } from '../../src/gops/sim/weapons';
import { DEFAULT_SCHEME, type World, createWorld, step, worldHash } from '../../src/gops/sim/world';

function world(seed: number): World {
  const m = new Mask(1200, 500);
  m.fillRect(0, 380, 1200, 120);
  m.fillRect(500, 260, 120, 140);
  return createWorld({
    mask: m, waterY: 480, seed, scheme: DEFAULT_SCHEME,
    teams: [[200, 340], [850, 1000]].map((xs) => ({ spawns: xs.map((x) => [x, 380] as [number, number]), hp: 100, ammo: { ...ARSENAL_AMMO } })),
  });
}

describe('gops/snapshot: снимок мира', () => {
  it('снимок посреди боя накладывается на чужой мир — дальше оба идут бит в бит', () => {
    const a = world(9);
    const r = new Rng(5);
    const bots = [new Bot('hard', () => r.f()), new Bot('medium', () => r.f())];
    for (let i = 0; i < 2500; i++) step(a, bots[a.team].input(a));
    expect(a.mask.count()).toBeLessThan(world(9).mask.count()); // воронки есть
    const snap = takeSnapshot(a);
    expect(JSON.stringify(snap).length).toBeLessThan(200_000);
    // «разошедшийся» мир: другой сид и другие события
    const b = world(77);
    for (let i = 0; i < 500; i++) step(b, { move: 1 });
    applySnapshot(b, snap);
    expect(worldHash(b)).toBe(worldHash(a));
    for (let i = 0; i < 600; i++) {
      const inp = i % 90 < 40 ? { move: 1 as const } : { fire: i % 90 < 70 };
      step(a, inp);
      step(b, inp);
    }
    expect(worldHash(b)).toBe(worldHash(a));
  });
});
