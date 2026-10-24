/* Сянци: ходы фигур (подножка коня, глаз слона, река, пушка с лафетом, солдат за рекой), генералы не смотрят друг на друга,
 * мат и пат, вечный шах, ко-уп с закрытыми фигурами, боты. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { choose } from '../src/games/xiangqi/ai';
import { def, pt } from '../src/games/xiangqi/def';
import { apply, cfgFrom, legal, makeView, newState, setup, type State } from '../src/games/xiangqi/engine';

function pos(list: string, turn: 0 | 1 = 0, mode = 'xiangqi'): State {
  const s = newState(cfgFrom({ mode }));
  s.board.fill('');
  for (const t of list.split(/\s+/).filter(Boolean)) s.board[pt(t.slice(1))] = t[0];
  s.turn = turn;
  s.keys = [];
  return s;
}
const name = (p: number) => 'abcdefghi'[p % 9] + (Math.floor(p / 9) + 1);
const from = (s: State, sq: string) => legal(s).filter((m) => m.from === pt(sq)).map((m) => name(m.to)).sort();

describe('сянци', () => {
  it('начальная позиция: 44 хода у красных', () => {
    expect(legal(newState(cfgFrom({}))).length).toBe(44);
  });
  it('конь с подножкой, слон с глазом и рекой', () => {
    const s = pos('Ke1 Hb1 Pb2 Ec1 ke10 Pe5');
    expect(from(s, 'b1')).toEqual([]); // вверх — подножка b2, вправо — слон c1, влево — край
    expect(from(s, 'c1')).toEqual(['e3']); // к a3 — глаз b2 закрыт
    const r = pos('Ke1 Ec5 kd10');
    expect(from(r, 'c5')).toEqual(['a3', 'e3']);
  });
  it('пушка бьёт только через лафет', () => {
    const s = pos('Ke1 Ce3 Pe4 he8 kd10');
    expect(from(s, 'e3')).toContain('e8');
    expect(from(s, 'e3')).not.toContain('e4');
    const t = pos('Ke1 Ce3 he8 kd10');
    expect(from(t, 'e3')).not.toContain('e8');
  });
  it('солдат: за рекой — и вбок', () => {
    expect(from(pos('Ke1 Pc5 kd10'), 'c5')).toEqual(['c6']);
    expect(from(pos('Ke1 Pc6 kd10'), 'c6')).toEqual(['b6', 'c7', 'd6']);
  });
  it('генералы не смотрят друг на друга', () => {
    const s = pos('Ke1 Re5 ke10');
    expect(from(s, 'e5').every((x) => x[0] === 'e')).toBe(true);
    expect(from(pos('Kd1 ke10'), 'd1')).not.toContain('e1');
  });
  it('мат и пат — победа', () => {
    const r = apply(pos('Ke1 Rh9 Ra1 kd10 ad9 af9'), 0, { type: 'move', from: pt('a1'), to: pt('a10') })!;
    expect(r.state.reason).toBe('mate');
    expect(r.state.winner).toBe(0);
  });
  it('ко-уп: фигуры закрыты, закрытая ходит по своему месту', () => {
    const s = setup({ mode: 'up' }, new SeededRng(3));
    const v = makeView(s);
    expect(v.board.filter((x) => x === '?').length).toBe(15);
    expect(from(s, 'b3').length).toBe(from(newState(cfgFrom({})), 'b3').length);
    const r = apply(s, 0, { type: 'move', from: pt('b3'), to: pt('e3') })!;
    expect(r.state.hidden[pt('e3')]).toBe(false);
    expect(r.events[0].type === 'move' && r.events[0].revealed).toBeTruthy();
  });
  it('боты доигрывают все пресеты', () => {
    for (const p of def.presets!) {
      const rng = new SeededRng(11);
      let s = setup(p.options!, rng);
      let i = 0;
      for (; i < 600 && !s.over; i++) {
        const a = choose(def.view(s, [s.turn]), s.turn, i % 3, rng);
        expect(a, `${p.id}: ${i}`).not.toBeNull();
        const r = apply(s, s.turn, a!);
        expect(r, `${p.id}: ${JSON.stringify(a)}`).not.toBeNull();
        s = r!.state;
      }
      expect(s.over || i === 600, p.id).toBe(true);
    }
  }, 300000);
});
