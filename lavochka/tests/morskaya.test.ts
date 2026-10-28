/* «Морская игра»: поле и расстановка, старшинство, удар в нос/борт/корму, подлодка, мины и береговые пушки, партии ботов. */
import { describe, expect, it } from 'vitest';
import { breather } from './harness';
import { SeededRng } from '../src/core/rng';
import { choose } from '../src/games/morskaya/ai';
import { apply, at, canHit, cfgFrom, GUNS, legal, newState, senior, setup, toAct, type Kind, type State } from '../src/games/morskaya/engine';

const rig = (v: number) => ({ next: () => 0.5, int: () => v, getState: () => 0 });
function pos(list: [number, Kind, number, number, number][], turn = 0): State {
  const s = newState(cfgFrom({}));
  s.ships = list.map(([side, kind, c, r, dir], id) => ({ id, side, kind, p: at(c, r), dir }));
  s.turn = turn;
  return s;
}

describe('Морская игра', () => {
  it('расстановка: по 12 кораблей, нужного состава, у своих берегов', () => {
    const s = newState(cfgFrom({}));
    for (const side of [0, 1]) {
      const k = s.ships.filter((x) => x.side === side).map((x) => x.kind).sort().join(',');
      expect(k).toBe('bb,cr,cr,dd,dd,dd,dd,gb,gb,gb,ms,ss');
    }
    expect(GUNS[0].length).toBe(4);
  });

  it('старшинство и подлодка', () => {
    expect(senior('bb', 'cr')).toBe(1);
    expect(senior('ss', 'bb')).toBe(1);
    expect(senior('ss', 'gb')).toBe(-1);
    expect(senior('dd', 'ss')).toBe(1);
    expect(senior('cr', 'cr')).toBe(0);
  });

  it('удар: в корму нельзя, в борт всем, в нос — старшему', () => {
    // нападающий идёт на восток (1)
    expect(canHit('dd', 1, 'bb', 1)).toBe(false); // корма
    expect(canHit('dd', 1, 'bb', 0)).toBe(true); // борт
    expect(canHit('dd', 1, 'bb', 3)).toBe(false); // нос, младший
    expect(canHit('bb', 1, 'dd', 3)).toBe(true); // нос, старший
    expect(canHit('cr', 1, 'cr', 3)).toBe(false); // нос, равные
  });

  it('мина: заход — бросок, «взрыв» топит; тральщик ставит мину не в счёт хода', () => {
    let s = pos([[0, 'ms', 5, 3, 1], [1, 'gb', 6, 3, 3], [1, 'dd', 9, 7, 2]]);
    s = apply(s, 0, { type: 'mine', id: 0 }, rig(5))!.state;
    expect(s.mines).toEqual([at(5, 3)]);
    expect(toAct(s)).toEqual([0]);
    s = apply(s, 0, { type: 'turn', id: 0, d: 'l' }, rig(5))!.state;
    s = apply(s, 1, { type: 'turn', id: 2, d: 'l' }, rig(5))!.state;
    s = apply(s, 0, { type: 'fwd', id: 0 }, rig(5))!.state;
    const r = apply(s, 1, { type: 'fwd', id: 1 }, rig(0))!;
    expect(r.state.ships.some((x) => x.id === 1)).toBe(false);
    expect(r.state.mines).toEqual([at(5, 3)]);
  });

  it('береговые пушки бьют чужих, подлодку — нет', () => {
    const gun = GUNS[1][0];
    const c = gun % 11;
    const r = Math.floor(gun / 11);
    const s = pos([[0, 'dd', c - 1, r, 1], [1, 'bb', 5, 5, 3]]);
    expect(apply(s, 0, { type: 'fwd', id: 0 }, rig(0))!.state.ships.length).toBe(1);
    const sub = pos([[0, 'ss', c - 1, r, 1], [1, 'bb', 5, 5, 3]]);
    expect(apply(sub, 0, { type: 'fwd', id: 0 }, rig(0))!.state.ships.length).toBe(2);
  });

  it('партии ботов доходят до конца; средний сильнее лёгкого', async () => {
    const breathe = breather();
    let hard = 0;
    for (let k = 0; k < 4; k++) {
      const rng = new SeededRng(50 + k);
      const lv = k % 2 ? [1, 0] : [0, 1];
      let s = setup({});
      for (let i = 0; i < 3000 && !s.over; i++) {
        await breathe();
        s = apply(s, s.turn, choose(s, s.turn, lv[s.turn], rng)!, rng)!.state;
      }
      expect(s.over).toBe(true);
      if (s.winner != null && lv[s.winner] === 1) hard++;
    }
    expect(hard).toBeGreaterThanOrEqual(2);
    expect(legal(newState(cfgFrom({})), 0).length).toBeGreaterThan(0);
  }, 300000);
});
