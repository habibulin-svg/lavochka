/* Мельница: турнирное правило «две мельницы — одна фишка». */
import { describe, expect, it } from 'vitest';
import { apply, cfgFrom, newState } from '../src/games/mill/engine';

const R = (r: number, i: number) => r * 8 + i;
function pos(single: boolean) {
  const s = newState(cfgFrom({ men: 9, single }));
  s.board.fill(0);
  for (const p of [R(0, 0), R(0, 1), R(0, 3), R(0, 4)]) s.board[p] = 1;
  for (const p of [R(1, 1), R(1, 5), R(2, 7)]) s.board[p] = 2;
  s.hand = [5, 6];
  return s;
}

describe('мельница', () => {
  it('две мельницы разом: по-дворовому две фишки, по турнирным — одна', () => {
    expect(apply(pos(false), 0, { type: 'place', to: R(0, 2) })!.state.take).toBe(2);
    const t = apply(pos(true), 0, { type: 'place', to: R(0, 2) })!.state;
    expect(t.take).toBe(1);
    const after = apply(t, 0, { type: 'take', at: R(1, 1) })!.state;
    expect(after.turn).toBe(1);
  });
});
