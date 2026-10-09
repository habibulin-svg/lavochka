/* Шиш-беш: варианты поля, укрытий и выхода из парка. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { def } from '../src/games/shishbesh/def';
import { applyRoll, legalMoves, makeGeo, newGame, type Cfg, type State } from '../src/games/shishbesh/engine';
import { botSeats, simulate } from './harness';

const cfg = (c: Partial<Cfg>): Cfg => ({ arm: 5, houses: 'opposite', start: 'six', ...c });

describe('шиш-беш: геометрия вариантов', () => {
  it('обычное поле: 48 клеток, домик 49..52, углы 6/18/30/42', () => {
    const G = makeGeo(cfg({}));
    expect([G.L, G.HS, G.HE]).toEqual([48, 49, 52]);
    expect([...Array(49).keys()].filter((p) => G.isCorner(p))).toEqual([6, 18, 30, 42]);
    expect(G.homeCorner).toBe(42);
  });

  it('длинное поле: 56 клеток, домик из 5 клеток', () => {
    const G = makeGeo(cfg({ arm: 6 }));
    expect([G.L, G.HS, G.HE]).toEqual([56, 57, 61]);
    expect([...Array(57).keys()].filter((p) => G.isCorner(p))).toEqual([7, 21, 35, 49]);
    expect(G.homeCorner).toBe(49);
  });

  it('укрытий всегда 8: напротив — 3-е поле на обеих дорожках, через один — 3-е и 4-е', () => {
    const cells = (h: Cfg['houses'], arm = 5) => {
      const G = makeGeo(cfg({ houses: h, arm }));
      return [...Array(G.L).keys()].filter((g) => G.isHouseG(g));
    };
    expect(cells('opposite').slice(0, 2)).toEqual([2, 8]);
    expect(cells('alternate').slice(0, 2)).toEqual([2, 7]);
    expect(cells('alternate', 6).slice(0, 2)).toEqual([2, 9]);
    for (const h of ['opposite', 'alternate'] as const) for (const a of [5, 6]) expect(cells(h, a)).toHaveLength(8);
  });
});

describe('шиш-беш: выход из парка', () => {
  const start = (c: Cfg, dice: [number, number]) => {
    const s = newGame([0, 1], new SeededRng(1), c);
    s.cur = 0;
    return applyRoll(s, dice)!.state as State;
  };

  it('на шестёрку: дубль 3:3 не выводит', () => {
    expect(legalMoves(start(cfg({}), [3, 3]))).toHaveLength(0);
    expect(legalMoves(start(cfg({}), [6, 2])).some((m) => m.kind === 'enter')).toBe(true);
  });

  it('на дубль: 6:2 не выводит, 3:3 выводит', () => {
    expect(legalMoves(start(cfg({ start: 'double' }), [6, 2]))).toHaveLength(0);
    expect(legalMoves(start(cfg({ start: 'double' }), [3, 3])).some((m) => m.kind === 'enter')).toBe(true);
  });

  it('на шестёрку или дубль', () => {
    expect(legalMoves(start(cfg({ start: 'both' }), [6, 2])).some((m) => m.kind === 'enter')).toBe(true);
    expect(legalMoves(start(cfg({ start: 'both' }), [2, 2])).some((m) => m.kind === 'enter')).toBe(true);
    expect(legalMoves(start(cfg({ start: 'both' }), [2, 5]))).toHaveLength(0);
  });
});

describe('шиш-беш: все сочетания настроек играбельны', () => {
  for (const arm of [5, 6])
    for (const houses of ['opposite', 'alternate'])
      for (const st of ['six', 'double', 'both'])
        it(`плечо ${arm}, укрытия ${houses}, старт ${st}`, async () => {
          const res = await simulate(def, botSeats(def, 4, [0, 1, 2]), { arm, houses, start: st }, arm * 100 + st.length);
          expect(res.error).toBeUndefined();
          expect(res.finished).toBe(true);
        });
});
