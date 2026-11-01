import { describe, expect, it } from 'vitest';
import { Rng, fnv1a } from '../../src/gops/sim/rng';

// Эталон — studio/post/terrain.py (Rng, fnv1a): генератор ландшафта на TS должен давать тот же поток.
describe('gops/rng: mulberry32 как в terrain.py', () => {
  it('u32 совпадает с Python', () => {
    const r = new Rng(1);
    expect([r.u32(), r.u32(), r.u32(), r.u32(), r.u32()]).toEqual([2693262067, 11749833, 2265367787, 4213581821, 4159151403]);
    const q = new Rng(0xdeadbeef);
    expect([q.u32(), q.u32(), q.u32()]).toEqual([4043151706, 1147597007, 3315858022]);
    expect(q.int(1, 6)).toBe(3);
    expect(q.int(-5, 5)).toBe(0);
  });

  it('fnv1a по UTF-8 совпадает с Python', () => {
    expect(fnv1a('hills')).toBe(4022750299);
    expect(fnv1a('мост')).toBe(2329027654);
  });

  it('состояние сохраняется и восстанавливается', () => {
    const a = new Rng(42);
    a.u32();
    const b = new Rng(0);
    b.s = a.s;
    expect(b.u32()).toBe(a.u32());
  });

  it('f в [0,1), int и range в границах, below — целое 0…n−1', () => {
    const r = new Rng(7);
    for (let i = 0; i < 2000; i++) {
      const f = r.f();
      expect(f >= 0 && f < 1).toBe(true);
      const k = r.int(-3, 3);
      expect(Number.isInteger(k) && k >= -3 && k <= 3).toBe(true);
      const x = r.range(2, 5);
      expect(x >= 2 && x < 5).toBe(true);
      const b = r.below(10);
      expect(Number.isInteger(b) && b >= 0 && b < 10).toBe(true);
    }
  });
});
