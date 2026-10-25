/* «В атаку!»: карта поля, ходы (река, броды, перелёт), пушка, ракета, мины, серии ходов, рамка, партии ботов. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { choose } from '../src/games/vataku/ai';
import { apply, at, cfgFrom, COUNT, FORD, FRAME, LETTERS, makeView, moves, newState, RESERVE, RIVER, setup, shots, toAct, type Kind, type State } from '../src/games/vataku/engine';

const X = (ch: string, r: number) => at(LETTERS.indexOf(ch), r - 1);
const rng = new SeededRng(1);
function pos(list: [number, number, Kind][], mines: [number[], number[]] = [[], []]): State {
  const s = newState(cfgFrom({}));
  s.phase = 'play';
  s.ready = [true, true];
  s.series = 3;
  s.left = 3;
  list.forEach(([p, side, kind], i) => (s.cells[p] = { id: i, side, kind, face: 1 }));
  s.mines = mines;
  return s;
}

describe('В атаку!', () => {
  it('поле: 20 рек, 6 бродов, 16 клеток резерва, рамки по 6', () => {
    expect(LETTERS.length).toBe(20);
    expect(RIVER.size).toBe(20);
    expect(FORD.size).toBe(6);
    expect(RESERVE.size).toBe(16);
    expect(FRAME[0].length).toBe(6);
    expect(FRAME[1].length).toBe(6);
  });

  it('расстановка: 21 фигура и 2 мины на своей половине; чужое скрыто', () => {
    const s = setup({}, new SeededRng(3));
    for (const side of [0, 1]) {
      expect(s.cells.filter((c) => c && c.side === side).length).toBe(Object.values(COUNT).reduce((a, b) => a + b, 0));
      expect(s.mines[side].length).toBe(2);
    }
    const v = makeView(s, [0]);
    expect(v.cells.some((c) => c && c.side === 1)).toBe(false);
    expect(v.mines[1]).toEqual([]);
  });

  it('река — по клетке за ход, броды — как суша, самолёт перелетает', () => {
    const s = pos([[X('И', 8), 0, 'tank'], [X('Ж', 3), 0, 'inf'], [X('Б', 12), 0, 'plane'], [X('В', 12), 0, 'inf'], [X('Ф', 2), 1, 'inf']]);
    const tank = moves(s, X('И', 8));
    expect(tank.has(X('К', 8))).toBe(true);
    expect(tank.has(X('Л', 8))).toBe(false);
    expect(moves(s, X('Ж', 3)).has(X('И', 3))).toBe(true);
    expect(moves(s, X('Б', 12)).has(X('Л', 12))).toBe(true);
    expect(moves(s, X('Б', 12)).has(X('В', 12))).toBe(false);
  });

  it('пушка стреляет на 3 и остаётся; ракета бьёт и снимается', () => {
    const s = pos([[X('Г', 10), 0, 'gun'], [X('Ж', 10), 1, 'tank'], [X('Б', 3), 0, 'rocket'], [X('Б', 7), 1, 'plane'], [X('Ф', 12), 1, 'inf']]);
    expect(shots(s, X('Г', 10))).toContain(X('Ж', 10));
    const r1 = apply(s, 0, { type: 'shoot', from: X('Г', 10), to: X('Ж', 10) }, rng)!.state;
    expect(r1.cells[X('Г', 10)]?.kind).toBe('gun');
    expect(r1.cells[X('Ж', 10)]).toBeNull();
    const r2 = apply(r1, 0, { type: 'move', from: X('Б', 3), to: X('Б', 7) }, rng)!.state;
    expect(r2.cells[X('Б', 7)]).toBeNull();
    expect(r2.cells[X('Б', 3)]).toBeNull();
  });

  it('мина: прошёл через — подорвался', () => {
    const s = pos([[X('М', 4), 0, 'inf'], [X('Ф', 12), 1, 'inf']], [[], [X('Н', 4)]]);
    const r = apply(s, 0, { type: 'move', from: X('М', 4), to: X('О', 4) }, rng)!;
    expect(r.events.some((e) => e.type === 'move' && e.boom === X('Н', 4))).toBe(true);
    expect(r.state.cells[X('О', 4)]).toBeNull();
    expect(r.state.mines[1]).toEqual([]);
  });

  it('серии: 1, 2, 2, потом по 3', () => {
    let s = setup({}, new SeededRng(5));
    s = apply(s, 0, { type: 'ready' }, rng)!.state;
    s = apply(s, 1, { type: 'ready' }, rng)!.state;
    const order: number[] = [];
    for (let i = 0; i < 8; i++) {
      const seat = toAct(s)[0];
      order.push(seat);
      s = apply(s, seat, choose(makeView(s, [seat]), seat, 0, rng)!, rng)!.state;
    }
    expect(order).toEqual([0, 1, 1, 0, 0, 1, 1, 1]);
  });

  it('рамка: шесть клеток и трое пехотинцев — победа', () => {
    const s = pos([[X('У', 7), 0, 'inf'], [X('У', 8), 0, 'inf'], [X('Ф', 7), 0, 'tank'], [X('Ф', 8), 0, 'tank'], [X('Ф', 9), 0, 'gun'], [X('Т', 9), 0, 'inf'], [X('Р', 2), 1, 'inf']]);
    const r = apply(s, 0, { type: 'move', from: X('Т', 9), to: X('У', 9) }, rng)!.state;
    expect(r.phase).toBe('over');
    expect(r.why).toBe('frame');
  });

  it('партии ботов доходят до конца', () => {
    for (const lv of [[0, 1], [2, 1]]) {
      const r = new SeededRng(lv[0] * 7 + 11);
      let s = setup({}, r);
      for (let i = 0; i < 3000 && s.phase !== 'over'; i++) {
        const seat = toAct(s)[0];
        s = apply(s, seat, choose(makeView(s, [seat]), seat, lv[seat], r)!, r)!.state;
      }
      expect(s.phase).toBe('over');
    }
  }, 120000);
});
