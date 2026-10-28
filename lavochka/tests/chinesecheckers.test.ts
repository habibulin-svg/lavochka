/* Китайские шашки: звезда на 121 лунку, дома по 10, шаги и цепочки прыжков, победа с «засевшим» чужим, халма, боты. */
import { describe, expect, it } from 'vitest';
import { breather } from './harness';
import { SeededRng } from '../src/core/rng';
import { choose } from '../src/games/chinesecheckers/ai';
import { def } from '../src/games/chinesecheckers/def';
import { apply, cfgFrom, geoOf, moves, newState, paths, seatsFor, won } from '../src/games/chinesecheckers/engine';

describe('китайские шашки', () => {
  it('звезда: 121 лунка, шесть домов по 10, дома напротив', () => {
    const g = geoOf(cfgFrom({}, 2));
    expect(g.x.length).toBe(121);
    expect(g.homes.map((h) => h.length)).toEqual([10, 10, 10, 10, 10, 10]);
    expect(new Set(g.homes.flat()).size).toBe(60);
  });
  it('халма: 256 полей, лагеря 19 и 13', () => {
    expect(geoOf(cfgFrom({ mode: 'halma' }, 2)).homes[0].length).toBe(19);
    expect(geoOf(cfgFrom({ mode: 'halma' }, 4)).homes[0].length).toBe(13);
  });
  it('цепочка прыжков', () => {
    const cfg = cfgFrom({}, 2);
    const g = geoOf(cfg);
    const board = new Array(121).fill(-1);
    // ряд: a _ b _ c — прыжок через соседа, потом ещё
    const c = 60; // центр
    const d = 0;
    const a1 = g.nb[c][d];
    const l1 = g.nb[a1][d];
    const a2 = g.nb[l1][d];
    const l2 = g.nb[a2][d];
    board[c] = 0;
    board[a1] = 1;
    board[a2] = 1;
    const p = paths(board, g, c);
    expect(p.get(l2)).toEqual([c, l1, l2]);
  });
  it('победа: дом занят целиком и в нём есть свои', () => {
    const s = newState(cfgFrom({}, 2), seatsFor(2));
    const g = geoOf(s.cfg);
    const target = g.homes[g.opp[s.corner[2]]];
    s.board = s.board.map(() => -1);
    target.forEach((p, i) => (s.board[p] = i === 0 ? 5 : 2));
    expect(won(s, 2)).toBe(true);
    s.board[target[1]] = 5;
    expect(won(s, 2)).toBe(true);
    target.forEach((p) => (s.board[p] = 5));
    expect(won(s, 2)).toBe(false);
  });
  it('начало: у синих есть ходы, шаг легален', () => {
    const s = newState(cfgFrom({}, 2), seatsFor(2));
    const ms = moves(s, 2);
    expect(ms.length).toBeGreaterThan(0);
    expect(apply(s, 2, { type: 'move', from: ms[0].from, to: ms[0].to })).not.toBeNull();
  });
  it('боты доигрывают на любом числе игроков', async () => {
    const breathe = breather();
    for (const mode of ['romashka', 'halma']) {
      for (const n of def.countsFor!({ mode })) {
        const rng = new SeededRng(n);
        let s = newState(cfgFrom({ mode }, n), seatsFor(n));
        let i = 0;
        for (; i < 2000 && !s.over; i++) {
          await breathe();
          const a = choose(s, s.turn, i % 3, rng);
          expect(a, `${mode}/${n}: ${i}`).not.toBeNull();
          const r = apply(s, s.turn, a!);
          expect(r).not.toBeNull();
          s = r!.state;
        }
        console.log(mode, n, 'ходов', i, 'победа', s.winner, s.moves);
        expect(s.over, `${mode}/${n}`).toBe(true);
      }
    }
  }, 300000);
});
