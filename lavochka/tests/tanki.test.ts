/* «Идут танки»: разметка поля, раздача мин и ракет, ход по кубику, перекрёсток, бой, мост, мина, полёт, цель, партии ботов. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { choose } from '../src/games/tanki/ai';
import { apply, cfgFrom, makeView, newState, routes, setup, toAct, type Mine, type State } from '../src/games/tanki/engine';
import { ARCS, BRIDGES, cellOf as C, CROSS, ROADS, STARTS } from '../src/games/tanki/map';

const rig = (v: number) => ({ next: () => 0.5, int: () => v - 1, getState: () => 0 });
function pos(list: [number, string, number][], mines: Mine[] = [], side = 0): State {
  const s = newState(cfgFrom({}), rig(1));
  s.tanks = list.map(([sd, name, dir], i) => {
    const p = C(name);
    return { id: sd * 10 + i, side: sd, p, road: ROADS.findIndex((r) => r.includes(p)), dir, state: 'board', repair: false };
  });
  s.mines = mines;
  s.rockets = [
    ['hit', 'hit', 'miss'],
    ['hit', 'hit', 'miss'],
  ];
  s.side = side;
  s.rolls = s.tanks.filter((t) => t.side === side).length;
  return s;
}

describe('Идут танки', () => {
  it('разметка: 4 дороги от верхних стартов к нижним, 6 перекрёстков, 7 мостов, по 3 дуги на половину', () => {
    expect(ROADS.length).toBe(4);
    expect(new Set(ROADS.map((r) => r[0]))).toEqual(new Set(STARTS[1]));
    expect(new Set(ROADS.map((r) => r[r.length - 1]))).toEqual(new Set(STARTS[0]));
    expect(CROSS.size).toBe(6);
    expect(BRIDGES.size).toBe(7);
    expect(ARCS.filter((a) => a.side === 0).length).toBe(3);
    expect(ARCS.filter((a) => a.side === 1).length).toBe(3);
  });

  it('раздача: по 4 мины и 3 ракеты (две «Ц-П», одна «П»); метки мин скрыты от всех', () => {
    const s = setup({}, new SeededRng(2));
    for (const side of [0, 1]) {
      expect(s.mines.filter((m) => m.side === side).length).toBe(4);
      expect([...s.rockets[side]].sort()).toEqual(['hit', 'hit', 'miss']);
    }
    const v = makeView(s, [0]);
    expect(v.mines.every((m) => m.label === null)).toBe(true);
    expect(v.rockets[1].every((r) => r === null)).toBe(true);
    expect(v.rockets[0].every((r) => r !== null)).toBe(true);
  });

  it('перекрёсток: свернуть можно, путь на кружок короче', () => {
    const s = pos([[0, 'd49', -1], [1, 'T1', 1]]);
    const t = s.tanks[0];
    const rs = routes(s, t, 3);
    const ends = rs.map((r) => r.path[r.path.length - 1]);
    expect(ends).toContain(C('bA')); // прямо: d46, d45, bA
    expect(ends.some((p) => p === C('bG') || p === C('d43'))).toBe(true); // свернул на d46 — ещё один кружок
  });

  it('бой, мост, мина', () => {
    let s = pos([[0, 'd68', -1], [0, 'd54', -1], [1, 'd56', 1], [1, 'T4', 1]]);
    s = apply(s, 0, { type: 'roll' }, rig(2))!.state;
    s = apply(s, 0, { type: 'move', id: 0, path: [C('d61'), C('d56')] }, rig(1))!.state;
    expect(s.tanks.find((t) => t.id === 12)!.state).toBe('dead');
    s = apply(s, 0, { type: 'roll' }, rig(1))!.state;
    s = apply(s, 0, { type: 'move', id: 1, path: [C('bG')] }, rig(1))!.state;
    expect(s.skip[0]).toBe(true);
    const m = pos([[0, 'd23', -1], [0, 'B1', -1], [1, 'T4', 1]], [{ p: C('d12'), side: 1, label: 'tr' }]);
    const r = apply(apply(m, 0, { type: 'roll' }, rig(3))!.state, 0, { type: 'move', id: 0, path: [C('d18'), C('d12'), C('bB')] }, rig(1))!;
    expect(r.state.tanks[0].state).toBe('dead');
    expect(r.state.mines.length).toBe(0);
  });

  it('полёт: танк раньше ракеты «Ц-П» — танк разбит и самолёт сбит', () => {
    const s = pos([[0, 'B1', -1], [1, 'd10', 1], [1, 'T4', 1]]);
    const r = apply(s, 0, { type: 'fly', plane: 0, arc: 0 }, rig(1))!;
    expect(r.state.tanks.find((t) => t.p === C('d10'))!.state).toBe('dead');
    expect(r.state.planes[0][0]).toBe(-1);
    expect(r.state.phase).toBe('rockets');
    expect(toAct(r.state)).toEqual([1]);
  });

  it('цель: танк на кружке соперника — дошёл', () => {
    let s = pos([[0, 'd6', -1], [0, 'B2', -1], [1, 'd50', 1]]);
    s = apply(s, 0, { type: 'roll' }, rig(1))!.state;
    s = apply(s, 0, { type: 'move', id: 0, path: [C('T1')] }, rig(1))!.state;
    expect(s.tanks[0].state).toBe('done');
  });

  it('партии ботов доходят до конца в обоих вариантах', () => {
    for (const mode of ['dice', 'fixed'])
      for (const lv of [[0, 2], [2, 1]]) {
        const rng = new SeededRng(lv[0] * 5 + (mode === 'dice' ? 1 : 2));
        let s = setup({ mode }, rng);
        for (let i = 0; i < 5000 && s.phase !== 'over'; i++) {
          const seat = toAct(s)[0];
          s = apply(s, seat, choose(makeView(s, [seat]), seat, lv[seat], rng)!, rng)!.state;
        }
        expect(s.phase).toBe('over');
      }
  }, 120000);
});
