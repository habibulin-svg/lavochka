/* Реверси: перевороты, пропуск хода, свободное начало, анти-реверси, сила ботов. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { choose } from '../src/games/reversi/ai';
import { apply, BLACK, cfgFrom, count, flipsAt, movesFor, newState, WHITE, winnerOf, type State } from '../src/games/reversi/engine';

function pos(black: [number, number][], white: [number, number][], turn = 0, n = 8): State {
  const s = newState(cfgFrom({ size: n }));
  s.board.fill(0);
  for (const [x, y] of black) s.board[y * n + x] = BLACK;
  for (const [x, y] of white) s.board[y * n + x] = WHITE;
  s.turn = turn;
  return s;
}

describe('реверси', () => {
  it('начало накрест: у чёрных четыре хода', () => {
    const s = newState(cfgFrom({}));
    expect(count(s.board)).toEqual([2, 2]);
    expect(movesFor(s, BLACK).length).toBe(4);
  });

  it('переворачивает во все стороны сразу', () => {
    const s = pos(
      [
        [1, 4],
        [4, 7],
        [6, 2],
      ],
      [
        [2, 4],
        [3, 4],
        [4, 5],
        [4, 6],
        [5, 3],
        [5, 5],
      ]
    );
    expect(flipsAt(s.board, 8, 4 * 8 + 4, BLACK).sort((a, b) => a - b)).toEqual([4 * 8 + 2, 4 * 8 + 3, 5 * 8 + 4, 6 * 8 + 4, 3 * 8 + 5].sort((a, b) => a - b));
    expect(apply(s, 0, { type: 'play', p: 0 })).toBeNull();
  });

  it('нет хода — пропуск, нет ни у кого — конец', () => {
    // после хода чёрных у белых не остаётся фишек
    const s = pos([[0, 0]], [[1, 0]]);
    const r = apply(s, 0, { type: 'play', p: 2 })!;
    expect(r.state.over).toBe(true);
    expect(r.state.winner).toBe(0);
    // белые зажаты: ходов нет, чёрные ходят снова
    const t = pos(
      [
        [0, 0],
        [4, 4],
      ],
      [
        [1, 0],
        [4, 5],
      ]
    );
    const r2 = apply(t, 0, { type: 'play', p: 6 * 8 + 4 })!;
    expect(r2.events.map((e) => e.type)).toContain('pass');
    expect(r2.state.turn).toBe(0);
  });

  it('свободное начало: первые четыре — в центр, без переворотов', () => {
    let s = newState(cfgFrom({ start: 'free' }));
    expect(count(s.board)).toEqual([0, 0]);
    expect(apply(s, 0, { type: 'play', p: 0 })).toBeNull();
    for (const p of [27, 28, 36, 35]) s = apply(s, s.turn, { type: 'play', p })!.state;
    expect(count(s.board)).toEqual([2, 2]);
    expect(movesFor(s, BLACK).length).toBeGreaterThan(0);
  });

  it('анти-реверси: побеждает меньший счёт', () => {
    const b = Array(64).fill(0);
    b[0] = BLACK;
    b[1] = WHITE;
    b[2] = WHITE;
    expect(winnerOf(b, false)).toBe(1);
    expect(winnerOf(b, true)).toBe(0);
  });

  it('сложный бот обыгрывает лёгкого', () => {
    let wins = 0;
    for (let g = 0; g < 4; g++) {
      let s = newState(cfgFrom({}));
      const rng = new SeededRng(100 + g);
      const hard = g % 2;
      while (!s.over) {
        const a = choose(s, s.turn, s.turn === hard ? 2 : 0, rng)!;
        s = apply(s, s.turn, a)!.state;
      }
      if (s.winner === hard) wins++;
    }
    expect(wins).toBeGreaterThanOrEqual(3);
  }, 60_000);
});
