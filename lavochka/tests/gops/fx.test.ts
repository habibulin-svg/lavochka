import { describe, expect, it } from 'vitest';
import {
  ANG_FULL, ONE, TRIG_ONE, angleOf, atan2Q, cosQ, fdiv, fmul, fromAngle, isqrt, len, sinQ, toFx, toPx,
} from '../../src/gops/sim/fx';

const turn = (a: number) => (a / ANG_FULL) * 2 * Math.PI;

describe('gops/fx: фиксированная точка', () => {
  it('константы', () => {
    expect(ONE).toBe(256);
    expect(TRIG_ONE).toBe(16384);
    expect(ANG_FULL).toBe(4096);
  });

  it('toFx/toPx: пиксели ↔ Q8, toPx — пол', () => {
    expect(toFx(3)).toBe(768);
    expect(toPx(768)).toBe(3);
    expect(toPx(767)).toBe(2);
    expect(toPx(-1)).toBe(-1);
    expect(toPx(-256)).toBe(-1);
    expect(toPx(-257)).toBe(-2);
  });

  it('fmul/fdiv: усечение к нулю, целый результат', () => {
    expect(fmul(512, 384)).toBe(768); // 2 × 1.5
    expect(fmul(-512, 384)).toBe(-768);
    expect(fmul(3, 3)).toBe(0); // 9/256 → 0
    expect(fmul(-3, 3)).toBe(0);
    expect(fdiv(768, 512)).toBe(384); // 3 / 2
    expect(fdiv(-768, 512)).toBe(-384);
    expect(fdiv(1, 3)).toBe(85); // 256/3 = 85.33
    expect(fdiv(-1, 3)).toBe(-85);
    for (const v of [fmul(491520, 4097), fdiv(491520, 7)]) expect(Number.isInteger(v)).toBe(true);
  });

  it('isqrt: точный пол корня до 2^52', () => {
    for (let n = 0; n < 5000; n++) expect(isqrt(n)).toBe(Math.floor(Math.sqrt(n)));
    for (const n of [2 ** 31 - 1, 2 ** 32, 2 ** 40 + 12345, 2 ** 52 - 1, 999999999999]) {
      const r = isqrt(n);
      expect(r * r <= n && (r + 1) * (r + 1) > n).toBe(true);
    }
    expect(isqrt(-5)).toBe(0);
  });

  it('len: длина вектора — пол', () => {
    expect(len(3, 4)).toBe(5);
    expect(len(-300, 400)).toBe(500);
    expect(len(0, 0)).toBe(0);
    expect(len(1, 1)).toBe(1);
  });

  it('sinQ/cosQ: таблица Q14, точность ±1, периодичность и знаки', () => {
    for (let a = -ANG_FULL; a < 2 * ANG_FULL; a += 7) {
      expect(Math.abs(sinQ(a) - Math.round(Math.sin(turn(a)) * TRIG_ONE))).toBeLessThanOrEqual(1);
      expect(Math.abs(cosQ(a) - Math.round(Math.cos(turn(a)) * TRIG_ONE))).toBeLessThanOrEqual(1);
    }
    expect(sinQ(0)).toBe(0);
    expect(sinQ(1024)).toBe(TRIG_ONE);
    expect(sinQ(2048)).toBe(0);
    expect(sinQ(3072)).toBe(-TRIG_ONE);
    expect(cosQ(0)).toBe(TRIG_ONE);
    expect(cosQ(2048)).toBe(-TRIG_ONE);
    for (let a = 0; a < ANG_FULL; a++) {
      expect(sinQ(a) + sinQ(-a)).toBe(0);
      expect(sinQ(a)).toBe(sinQ(a + ANG_FULL));
      expect(cosQ(a)).toBe(sinQ(a + 1024));
      expect(Number.isInteger(sinQ(a))).toBe(true);
    }
  });

  it('atan2Q: угол 0…4095, ошибка ≤ 2 единиц', () => {
    expect(atan2Q(0, 100)).toBe(0);
    expect(atan2Q(100, 0)).toBe(1024);
    expect(atan2Q(0, -100)).toBe(2048);
    expect(atan2Q(-100, 0)).toBe(3072);
    expect(atan2Q(0, 0)).toBe(0);
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) % 200001) - 100000;
    for (let i = 0; i < 3000; i++) {
      const y = rnd(), x = rnd();
      if (x === 0 && y === 0) continue;
      const a = atan2Q(y, x);
      expect(Number.isInteger(a) && a >= 0 && a < ANG_FULL).toBe(true);
      let want = (Math.atan2(y, x) / (2 * Math.PI)) * ANG_FULL;
      if (want < 0) want += ANG_FULL;
      let d = Math.abs(a - want);
      d = Math.min(d, ANG_FULL - d);
      expect(d).toBeLessThanOrEqual(2);
    }
  });

  it('fromAngle/angleOf: скорость по углу и обратно', () => {
    expect(fromAngle(0, 1000)).toEqual([1000, 0]);
    expect(fromAngle(1024, 1000)).toEqual([0, 1000]);
    expect(fromAngle(2048, 1000)).toEqual([-1000, 0]);
    const [vx, vy] = fromAngle(512, 1000); // 45°: 707.1
    expect(vx).toBe(707);
    expect(vy).toBe(707);
    expect(angleOf(vx, vy)).toBe(512);
  });
});
