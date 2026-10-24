/* Чанги: расстановка, слон (шаг + два по диагонали), пушка (прыжок, не через пушку), дворцовые диагонали, пропуск, бикджан, очки, боты. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { choose } from '../src/games/janggi/ai';
import { def, pt } from '../src/games/janggi/def';
import { apply, cfgFrom, legal, newState, points, type State } from '../src/games/janggi/engine';

function pos(list: string, turn: 0 | 1 = 0): State {
  const s = newState(cfgFrom({}));
  s.board.fill('');
  for (const t of list.split(/\s+/).filter(Boolean)) s.board[pt(t.slice(1))] = t[0];
  s.turn = turn;
  s.keys = [];
  return s;
}
const nm = (p: number) => 'abcdefghi'[p % 9] + (Math.floor(p / 9) + 1);
const from = (s: State, sq: string) => legal(s).filter((m) => m.from === pt(sq)).map((m) => nm(m.to)).sort();

describe('чанги', () => {
  it('начальные очки: 72 и 73,5', () => {
    expect(points(newState(cfgFrom({})).board)).toEqual([72, 73.5]);
  });
  it('слон: шаг прямо и два по диагонали, с подножками', () => {
    expect(from(pos('Kd2 Ee5 kf9'), 'e5')).toEqual(['b3', 'b7', 'c2', 'c8', 'g2', 'g8', 'h3', 'h7']);
    expect(from(pos('Kd2 Ee5 Pe6 kf9'), 'e5')).toEqual(['b3', 'b7', 'c2', 'g2', 'h3', 'h7']);
  });
  it('пушка: только прыжком, не через пушку и не по пушке', () => {
    expect(from(pos('Kd2 Cb3 kf9'), 'b3')).toEqual([]);
    expect(from(pos('Kd2 Cb3 Pb4 hb8 kf9'), 'b3')).toEqual(['b5', 'b6', 'b7', 'b8']);
    expect(from(pos('Kd2 Cb3 Cb4 hb8 kf9'), 'b3')).toEqual([]);
    expect(from(pos('Kd2 Cb3 Pb4 cb8 kf9'), 'b3')).toEqual(['b5', 'b6', 'b7']);
  });
  it('колесница по диагонали дворца', () => {
    expect(from(pos('Kd2 Rd1 kf9'), 'd1')).toContain('e2');
    expect(from(pos('Ke1 Rd1 kf9'), 'd1')).toEqual(expect.arrayContaining(['e2', 'f3']));
  });
  it('пропуск хода и бикджан', () => {
    const s = pos('Ke2 Pa4 ke9 pa7');
    const r = apply(s, 0, { type: 'pass' })!;
    expect(r.state.turn).toBe(1);
    // генералы на одной вертикали — это бикджан: ход, не разорвавший его, кончает партию подсчётом
    const b = pos('Kd2 Pa4 ke9 pa7');
    const r1 = apply(b, 0, { type: 'move', from: pt('d2'), to: pt('e2') })!;
    expect(r1.state.bik).toBe(0);
    const r2 = apply(r1.state, 1, { type: 'move', from: pt('a7'), to: pt('b7') })!;
    expect(r2.state.reason).toBe('bikjang');
  });
  it('боты доигрывают все пресеты', () => {
    for (const p of def.presets!) {
      const rng = new SeededRng(7);
      let s = newState(cfgFrom(p.options!));
      let i = 0;
      for (; i < 400 && !s.over; i++) {
        const a = choose(def.view(s, [s.turn]), s.turn, i % 3, rng);
        expect(a, `${p.id}: ${i}`).not.toBeNull();
        const r = apply(s, s.turn, a!);
        expect(r, `${p.id}: ${JSON.stringify(a)}`).not.toBeNull();
        s = r!.state;
      }
      expect(s.over, p.id).toBe(true);
    }
  }, 300000);
});
