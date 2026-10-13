import { describe, expect, it } from 'vitest';
import { hit, SECTORS, spin, spinShot } from '../src/games/sea/spinner';
import { POINTS } from '../src/games/sea/wind';

describe('вертушка', () => {
  it('крутит восемь секторов и раздаёт румбы с погодой', () => {
    for (let i = 0; i < 8; i++) {
      const s = spin(() => i / 8 + 0.001);
      expect(s.sector).toBe(i);
      expect(s.from).toBe(POINTS[i]);
      expect(s.weather).toBe(SECTORS[i]);
    }
  });

  it('погода берётся из трёх видов и все они встречаются', () => {
    expect(new Set(SECTORS).size).toBe(3);
    expect(SECTORS.filter((s) => s === 'calm').length).toBe(2);
    expect(SECTORS.filter((s) => s === 'breeze').length).toBe(4);
    expect(SECTORS.filter((s) => s === 'storm').length).toBe(2);
  });

  it('в бою четвертные румбы бьют, основные дают промах — ровно половина', () => {
    const shots = Array.from({ length: 8 }, (_, i) => spinShot(() => i / 8 + 0.001));
    expect(shots.filter((s) => s.hit).length).toBe(4);
    expect(shots.map((s) => s.hit)).toEqual([false, true, false, true, false, true, false, true]);
    expect(hit(spin(() => 0.001))).toBe(false);
    expect(hit(spin(() => 0.13))).toBe(true);
  });

  it('вертушка не выходит за восемь секторов даже на границе', () => {
    expect(spin(() => 0.999999).sector).toBe(7);
    expect(spin(() => 1).sector).toBe(7);
    expect(spinShot(() => 1).sector).toBe(7);
  });
});
