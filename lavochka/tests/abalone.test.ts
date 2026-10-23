/* Абалон: доска, расстановки, ходы в линию и вбок, сумито, выталкивание, боты (показы правил проверяет общий харнесс). */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { choose } from '../src/games/abalone/ai';
import * as ab from '../src/games/abalone/engine';

const at = ab.at;
function pos(black: [number, number][], white: [number, number][], turn = 0) {
  const s = ab.newState(ab.cfgFrom({}));
  s.board.fill(-1);
  for (const [q, r] of black) s.board[at(q, r)] = 0;
  for (const [q, r] of white) s.board[at(q, r)] = 1;
  s.turn = turn;
  return s;
}
const mv = (cells: [number, number][], dir: number): ab.Action => ({ type: 'move', cells: cells.map(([q, r]) => at(q, r)), dir });

describe('Абалон', () => {
  it('доска 61 лунка, по 14 шаров во всех расстановках', () => {
    expect(ab.CELLS.length).toBe(61);
    for (const layout of ['standard', 'belgian', 'german']) {
      const s = ab.setup({ layout });
      expect(s.board.filter((x) => x === 0).length, layout).toBe(14);
      expect(s.board.filter((x) => x === 1).length, layout).toBe(14);
    }
    // стандартная: у чёрных в первый ход — 44 хода (известное число)
    expect(ab.legal(ab.setup({})).length).toBe(44);
  });

  it('сумито: 3 на 2 можно, 2 на 2 нельзя, свой позади — нельзя', () => {
    const s = pos([[0, 1], [0, 2], [0, 3]], [[0, 0], [0, -1]]);
    const r = ab.step(s, mv([[0, 1], [0, 2], [0, 3]], 4))!;
    expect(r.state.board[at(0, -2)]).toBe(1);
    expect(r.state.board[at(0, 0)]).toBe(0);
    expect(r.state.board[at(0, 3)]).toBe(-1);
    expect(ab.step(pos([[0, 1], [0, 2]], [[0, 0], [0, -1]]), mv([[0, 1], [0, 2]], 4))).toBeNull();
    expect(ab.step(pos([[0, 1], [0, 2], [0, 3]], [[0, 0], [0, -1]].concat([[0, -2]]) as [number, number][]), mv([[0, 1], [0, 2], [0, 3]], 4))).toBeNull();
    expect(ab.step(pos([[0, 1], [0, 2], [0, 3]], [[0, 0]].concat([[0, -2]]) as [number, number][]).board.length ? pos([[0, 1], [0, 2], [0, 3]], [[0, 0]]) : pos([], []), mv([[0, 1], [0, 2], [0, 3]], 4))).not.toBeNull();
  });

  it('вбок — только в пустые лунки; толкать вбок нельзя', () => {
    const s = pos([[-1, 2], [0, 2], [1, 2]], []);
    expect(ab.step(s, mv([[-1, 2], [0, 2], [1, 2]], 5))).not.toBeNull();
    const t = pos([[-1, 2], [0, 2], [1, 2]], [[1, 1]]);
    expect(ab.step(t, mv([[-1, 2], [0, 2], [1, 2]], 5))).toBeNull();
    // не линия — нельзя
    expect(ab.step(pos([[0, 0], [2, 0]], []), mv([[0, 0], [2, 0]], 0))).toBeNull();
  });

  it('вытолкнутый шар выбывает; шестой — победа', () => {
    const s = pos([[0, -3], [0, -2]], [[0, -4]]);
    s.lost = [0, 5];
    const r = ab.step(s, mv([[0, -3], [0, -2]], 4))!;
    expect(r.state.lost[1]).toBe(6);
    expect(r.state.over).toBe(true);
    expect(r.state.winner).toBe(0);
  });

  it('боты доигрывают, средний обыгрывает лёгкого, ход быстрый', () => {
    let mid = 0;
    let worst = 0;
    for (let g = 0; g < 4; g++) {
      const r = new SeededRng(5 + g);
      let s = ab.setup({ layout: 'belgian', goal: 4 });
      const lv = g % 2 ? [1, 0] : [0, 1];
      for (let i = 0; i < 400 && !s.over; i++) {
        const t0 = Date.now();
        const a = choose(s, s.turn, lv[s.turn], r)!;
        worst = Math.max(worst, Date.now() - t0);
        s = ab.step(s, a)!.state;
      }
      if (s.winner != null && lv[s.winner] === 1) mid++;
    }
    expect(mid).toBeGreaterThanOrEqual(3);
    const t0 = Date.now();
    choose(ab.setup({ layout: 'belgian' }), 0, 2, new SeededRng(1));
    expect(Date.now() - t0).toBeLessThan(6000);
    expect(worst).toBeLessThan(3000);
  }, 300000);
});
