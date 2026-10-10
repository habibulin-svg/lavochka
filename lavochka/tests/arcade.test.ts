/* Аркады (ЖК «Электроника»): логика без экрана — честность раздачи яиц, штрафы, конец игры. */
import { describe, expect, it } from 'vitest';
import { litDigits } from '../src/arcade/lcd-core';
import { NuPogodi, RAMPS, STEPS } from '../src/games/nupogodi/logic';

describe('цифры', () => {
  it('семисегментные: 1247 и двоеточие', () => {
    const s = new Set<string>();
    litDigits('1247', s, true);
    expect(s.has('d0b') && s.has('d0c') && !s.has('d0a')).toBe(true);
    expect(s.has('col')).toBe(true);
  });
});

describe('Ну, погоди!', () => {
  /** Идеальный волк: подставляет корзину под ближайшее к краю яйцо. */
  const perfect = (g: NuPogodi) => {
    const next = g.eggs.slice().sort((a, b) => b.step - a.step)[0];
    if (next) g.press(RAMPS[next.ramp]);
  };
  it('яйца приходят по одному — идеальный волк не роняет ни одного', () => {
    for (const mode of ['A', 'B'] as const) {
      const g = new NuPogodi(mode, 7);
      for (let i = 0; i < 3000 && !g.over; i++) {
        perfect(g);
        g.tick();
      }
      expect(g.misses).toBe(0);
      expect(g.score).toBeGreaterThan(300);
    }
  });
  it('никто не ловит — три штрафа и конец; при зайце штраф половинный', () => {
    const g = new NuPogodi('A', 3);
    g.press('lu');
    let n = 0;
    while (!g.over && n++ < 5000) {
      // корзина всегда не там, где яйцо
      const e = g.eggs.find((x) => x.step === STEPS - 1);
      if (e) g.press(RAMPS[(e.ramp + 1) % 4]);
      g.tick();
    }
    expect(g.over).toBe(true);
    expect(g.misses).toBeGreaterThanOrEqual(6);
    const h = new NuPogodi('A', 3);
    h.hare = 10;
    h.eggs = [{ ramp: 0, step: STEPS - 1 }];
    h.press('rd');
    h.tick();
    expect(h.misses).toBe(1);
  });
  it('темп растёт с очками', () => {
    const g = new NuPogodi('A', 1);
    const slow = g.interval();
    g.score = 80;
    expect(g.interval()).toBeLessThan(slow);
  });
});
