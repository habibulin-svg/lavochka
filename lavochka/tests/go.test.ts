/* Го, тибетское (миг-манг): расстановка 17×17, первый ход белых, ход рядом со своим, усиленное ко, бонус центра и штраф за угол, боты. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { choose } from '../src/games/go/ai';
import { def } from '../src/games/go/def';
import * as go from '../src/games/go/engine';

const N = 17;
const P = (x: number, y: number) => y * N + x;
const tib = () => go.newState(go.cfgFrom({ rules: 'tibetan' }));
const play = (s: go.State, seat: number, x: number, y: number) => go.apply(s, seat, { type: 'play', p: P(x, y) }, new SeededRng(1))?.state ?? null;

describe('Тибетское го', () => {
  it('17×17, 12 камней на третьей линии через три пункта, цвета чередуются, ходят белые, коми нет', () => {
    const s = tib();
    expect(s.n).toBe(17);
    expect(s.turn).toBe(1);
    expect(s.komi).toBe(0);
    expect(s.board.filter((c) => c === go.BLACK)).toHaveLength(6);
    expect(s.board.filter((c) => c === go.WHITE)).toHaveLength(6);
    expect(s.board[P(2, 2)]).toBe(go.BLACK);
    expect(s.board[P(6, 2)]).toBe(go.WHITE);
    expect(s.board[P(14, 14)]).toBe(go.BLACK);
    expect(s.board[P(2, 14)]).toBe(go.WHITE);
    expect(go.hoshi(17)).toEqual([]);
  });

  it('камень — не дальше пункта от своего', () => {
    const s = tib();
    expect(go.isLegal(s, P(6, 4))).toBe(true); // через пункт от белого (6,2)
    expect(go.isLegal(s, P(8, 8))).toBe(false); // центр далеко
    expect(go.isLegal(s, P(3, 3))).toBe(false); // рядом только чёрный (2,2)
    expect(play(s, 1, 8, 8)).toBeNull();
  });

  it('усиленное ко: в только что снятый пункт ходить нельзя, через ход — можно', () => {
    let s = tib();
    for (const [x, y, c] of [[6, 6, 1], [7, 6, 2], [5, 7, 1], [7, 7, 1], [8, 7, 2], [6, 8, 1], [7, 8, 2]]) s.board[P(x, y)] = c;
    s = play(s, 1, 6, 7)!;
    expect(s.board[P(7, 7)]).toBe(0);
    expect(go.isLegal(s, P(7, 7))).toBe(false);
    s = play(s, 0, 4, 3)!;
    s = play(s, 1, 7, 4)!;
    expect(go.isLegal(s, P(7, 7))).toBe(true);
    s = play(s, 0, 7, 7)!;
    expect(s.board[P(6, 7)]).toBe(0);
  });

  it('центр: +5 первому; угол расстановки в чужой территории: −20', () => {
    let s = tib();
    s.board[P(8, 7)] = go.WHITE;
    s = play(s, 1, 8, 8)!;
    expect(s.center).toBe(1);
    const owner = s.board.slice();
    expect(go.tibetBonus(owner, s.center)).toEqual([0, 5]);
    owner[P(2, 2)] = go.WHITE; // чёрный угол захвачен
    expect(go.tibetBonus(owner, s.center)).toEqual([-20, 5]);
  });

  it('боты всех уровней ходят законно', () => {
    const s = tib();
    for (const lv of [0, 1, 2]) {
      const a = choose(s, 1, lv, new SeededRng(lv + 3));
      expect(a).not.toBeNull();
      if (a!.type === 'play') expect(go.isLegal(s, a!.p)).toBe(true);
    }
  });

  it('партия ботов на пресете доходит до конца', () => {
    const preset = def.presets!.find((p) => p.id === 'tibet')!;
    const rng = new SeededRng(11);
    let s = def.setup([0, 1].map((seat) => ({ seat, kind: 'bot' as const, name: '', level: 0 })), preset.options, rng);
    for (let k = 0; k < 2000 && !s.over; k++) {
      const seat = s.turn;
      const a = choose(s, seat, k % 3, rng)!;
      const r = go.apply(s, seat, a, rng);
      expect(r).not.toBeNull();
      s = r!.state;
    }
    expect(s.over).toBe(true);
    expect(def.result!(s)).not.toBeNull();
  });
});
