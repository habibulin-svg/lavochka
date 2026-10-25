/* Шагды: нумерация, сочетания, клетки со штрихом, снятие, запрет запирать 5–10, начало партии из листовки, партии ботов. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { choose } from '../src/games/shagdy/ai';
import { comboIdx, def } from '../src/games/shagdy/def';
import * as sg from '../src/games/shagdy/engine';

const C = (seat: number, pos: number, slot = 0) => sg.CELLS[seat][pos][slot];
function play(s: sg.State, a: sg.Action): sg.State {
  const r = sg.apply(s, s.turn, a);
  if (!r) throw new Error(`нельзя: ${JSON.stringify(a)} ход ${s.turn}, шаги ${s.left}`);
  return r.state;
}
/** Ход листовки: сочетание и шаги «откуда—куда» номерами (0 — из запаса), слот — по правилу занятости. */
function turn(s: sg.State, a: number, b: number, steps: [number, number][]): sg.State {
  s = play(s, { type: 'combo', i: comboIdx(s.cfg.variant, a, b) });
  const seat = s.turn;
  for (const [f, t] of steps) {
    const from = f === 0 ? sg.RESERVE : sg.CELLS[seat][f].find((c) => s.board[c] === seat + 1)!;
    const to = sg.landing(s, seat, t)!.cell;
    s = play(s, { type: 'step', from, to });
  }
  return s;
}

describe('Шагды', () => {
  it('нумерация: 20 номеров, клетки не пересекаются у одного игрока, второй — поворот на 180°', () => {
    for (const seat of [0, 1]) {
      const all = sg.CELLS[seat].flat();
      expect(new Set(all).size).toBe(all.length);
      expect(sg.CELLS[seat].length).toBe(21);
    }
    expect(C(0, 1)).toBe(63 - C(1, 1));
    // 11-я клетка одного — это 1-я другого (общая дорожка)
    expect(C(0, 11)).toBe(C(1, 1));
    // цель — 14 клеток крепости противника
    let goal = 0;
    sg.CELLS[0].forEach((cells, pos) => cells.forEach((c, slot) => sg.inGoal(pos, slot) && (goal++, expect(sg.fortOf(c)).toBe(1))));
    expect(goal).toBe(14);
  });

  it('сочетания: 21, 28 и 36; дубль — четыре шага', () => {
    expect(sg.combos('easy').length).toBe(21);
    expect(sg.combos('normal').length).toBe(28);
    expect(sg.combos('hard').length).toBe(36);
    expect(sg.stepsOf('normal', 3, 3)).toEqual([3, 3, 3, 3]);
    expect(sg.stepsOf('hard', 3, 3)).toEqual([3, 3]);
  });

  it('начало партии из листовки', () => {
    let s = sg.newState(sg.cfgFrom({}));
    s = turn(s, 4, 4, [[0, 4], [4, 8], [8, 12], [0, 4]]); // светлые: 0—4, 0—12
    s = turn(s, 4, 4, [[0, 4], [4, 8], [8, 12], [0, 4]]); // тёмные: так же
    expect(s.board[C(0, 12)]).toBe(1);
    expect(s.board[C(1, 12)]).toBe(2);
    s = turn(s, 1, 1, [[0, 1], [0, 1], [4, 5], [12, 13]]); // 0—1, 0—1′, 4—5, 12—13
    expect(s.board[C(0, 1, 1)]).toBe(1);
    expect(s.board[C(0, 13)]).toBe(1);
    expect(s.moves).toEqual([2, 1]);
    expect(s.turn).toBe(1);
    // ход сочетанием закрывает его: второй раз 4/4 взять нельзя
    expect(sg.legal(s).some((a) => a.type === 'combo' && a.i === comboIdx('normal', 4, 4))).toBe(false);
    expect(sg.legal(s).length).toBe(27);
  });

  it('в крепость — только когда введены все 10, одинокую снимают, парную — нет', () => {
    const s = sg.newState(sg.cfgFrom({}));
    s.board[C(0, 13)] = 1;
    s.reserve = [9, 10];
    s.entered = [1, 0];
    expect(sg.landing(s, 0, 15)).toBeNull();
    s.entered = [10, 10];
    s.board[C(1, 5)] = 2; // одинокая красная на 15-й белых
    expect(sg.landing(s, 0, 15)).toEqual({ cell: C(0, 15), took: C(0, 15) });
    s.board[C(1, 5, 1)] = 2; // парная
    expect(sg.landing(s, 0, 15)).toBeNull();
  });

  it('нельзя занять все свои основные 5–10', () => {
    let s = sg.newState(sg.cfgFrom({}));
    for (const k of [5, 6, 7, 8, 9]) s.board[C(0, k)] = 1;
    s.board[C(0, 4)] = 1;
    s.reserve = [4, 10];
    s.entered = [6, 0];
    s = play(s, { type: 'combo', i: comboIdx('normal', 6, 0) });
    expect(sg.stepMoves(s).some((a) => a.to === C(0, 10))).toBe(false);
    // а уйти с 5-й на 11-ю — можно: 5-я освобождается
    expect(sg.stepMoves(s).some((a) => a.from === C(0, 5) && a.to === C(0, 11))).toBe(true);
  });

  it('партии ботов доходят до конца', () => {
    const rng = new SeededRng(5);
    for (const p of def.presets!)
      for (const lv of [0, 1, 2]) {
        let s = def.setup([{ seat: 0, kind: 'bot', name: 'a', level: lv }, { seat: 1, kind: 'bot', name: 'b', level: lv }], p.options, rng);
        let n = 0;
        while (!s.over && n < 1000) {
          const seat = def.toAct(s)[0];
          const a = choose(s, seat, lv, rng);
          expect(a).not.toBeNull();
          const r = def.apply(s, seat, a!, rng);
          expect(r, JSON.stringify(a)).not.toBeNull();
          s = r!.state;
          n++;
        }
        expect(s.over).toBe(true);
      }
  }, 300000);
});
