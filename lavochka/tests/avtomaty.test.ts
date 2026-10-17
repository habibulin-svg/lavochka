/* Автоматы «15 копеек»: каждая плата грузит свой образ и рисует заставку; монета запускает игру. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ArcadeMachine } from '../src/arcade/machine';
import { Photon } from '../src/arcade/photon';
import { Photon2 } from '../src/arcade/photon2';
import { TiaMc1 } from '../src/arcade/tiamc1';
import { GAMES } from '../src/games/avtomaty/games';
import { coinMode, DAILY, giveBack, pocket, setCoinMode, takeCoin } from '../src/games/avtomaty/coins';

// карман хранится в localStorage — в node подставляем память
const mem = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
};

const load = (id: string, kind: (typeof GAMES)[number]['kind']): ArcadeMachine => {
  const img = new Uint8Array(readFileSync(join(__dirname, '..', 'public', 'avtomaty', `${id}.bin`)));
  return kind === 'photon' ? new Photon(img) : kind === 'photon2' ? new Photon2(img) : new TiaMc1(img, kind);
};
/** Заставка что-то нарисовала: не один цвет и заметно не-чёрных точек («Кот» пишет белым по чёрному). */
const drawn = (m: ArcadeMachine) => new Set(m.frame).size >= 2 && m.frame.filter((p) => (p & 0xffffff) !== 0).length > 500;
const run = (m: ArcadeMachine, s: number, each?: (f: number) => void) => {
  for (let f = 0; f < s * 50; f++) {
    each?.(f);
    m.run(m.cpuHz / 50, null);
  }
};

describe('автоматы', () => {
  for (const g of GAMES) {
    it(`${g.title}: заставка на экране`, () => {
      const m = load(g.id, g.kind);
      run(m, g.id === 'konek' || g.id === 'gorodki' ? 14 : 8);
      expect(drawn(m)).toBe(true);
    });
  }

  it('ТИА-МЦ-1: монета после загрузки запускает «S.O.S.», звук идёт', () => {
    const m = load('sosterm', 'tia');
    run(m, 4);
    expect(m.coinLocked).toBe(false);
    run(m, 3, (f) => m.set('coin', f < 5));
    expect(m.coinLocked).toBe(true); // идёт игра — приёмник закрыт
    const buf = new Float32Array(4000);
    expect(m.run(m.cpuHz / 50, buf)).toBeGreaterThan(1000);
  });

  it('карман: строго — шесть монет в день, возврат кладёт монету обратно', () => {
    setCoinMode('strict');
    const day = new Date(2026, 9, 17, 12);
    expect(pocket(day).left).toBeGreaterThanOrEqual(0);
    const next = new Date(2030, 0, 1, 12);
    expect(pocket(next).left).toBe(DAILY);
    for (let i = 0; i < DAILY; i++) expect(takeCoin(next)).toBe(true);
    expect(takeCoin(next)).toBe(false);
    giveBack(next);
    expect(pocket(next).left).toBe(1);
    setCoinMode('free');
    expect(coinMode()).toBe('free');
    expect(takeCoin(next)).toBe(true);
    expect(pocket(next).left).toBe(1);
    setCoinMode('strict');
  });
});
