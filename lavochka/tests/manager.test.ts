/* «Менеджер» / «Космос 2000»: правила полей и партии ботов на обоих полях. */
import { describe, expect, it } from 'vitest';
import { RiggedRng, SeededRng } from '../src/core/rng';
import { boardOf } from '../src/games/manager/boards';
import { def } from '../src/games/manager/def';
import { apply, canBuild, newState, rent, toAct, type Action, type State } from '../src/games/manager/engine';
import { botSeats, defaults, simulate } from './harness';

const rng = () => new RiggedRng(new SeededRng(7));

function act(s: State, seat: number, a: Action, rig?: number[]): State {
  const r = rng();
  r.rig(rig);
  const res = apply(s, seat, a, r);
  expect(res, JSON.stringify(a)).not.toBeNull();
  return res!.state;
}

describe('Менеджер', () => {
  it('поле: 40 клеток, 24 участка в 8 группах, цены растут', () => {
    const b = boardOf('manager');
    expect(b.cells.length).toBe(40);
    const props = b.cells.filter((c) => c.kind === 'prop');
    expect(props.length).toBe(24);
    for (let g = 0; g < 8; g++) expect(props.filter((c) => c.group === g).length).toBe(3);
    for (let i = 1; i < props.length; i++) expect(props[i].price!).toBeGreaterThan(props[i - 1].price!);
    expect(b.decks[0].cards.length).toBe(48);
    expect(b.decks[1].cards.length).toBe(48);
  });

  it('плата за наём: двойная за пустой участок полной группы, нет за заложенный', () => {
    const s = newState('manager', [0, 1], {}, rng());
    s.owner[1] = 0;
    s.owner[2] = 0;
    expect(rent(s, 1)).toBe(100);
    s.owner[4] = 0;
    expect(rent(s, 1)).toBe(200);
    s.houses[1] = 1;
    expect(rent(s, 1)).toBe(1000);
    s.mort[2] = true;
    expect(rent(s, 2)).toBe(0);
  });

  it('строят равномерно и только на полной группе', () => {
    let s = newState('manager', [0, 1], {}, rng());
    s.owner[1] = 0;
    s.owner[2] = 0;
    expect(canBuild(s, 0, 1)).toBe(false);
    s.owner[4] = 0;
    s = act(s, 0, { type: 'build', cell: 1 });
    expect(canBuild(s, 0, 1)).toBe(false);
    expect(canBuild(s, 0, 2)).toBe(true);
    s = act(s, 0, { type: 'build', cell: 2 });
    s = act(s, 0, { type: 'build', cell: 4 });
    expect(s.houses.slice(0, 5)).toEqual([0, 1, 1, 0, 1]);
    expect(s.stock[0]).toBe(23);
    expect(s.cash[0]).toBe(5000);
  });

  it('дубль — ещё ход, три дубля — на биржу; выход за 500', () => {
    let s = newState('manager', [0, 1], {}, rng());
    s = act(s, 0, { type: 'roll' }, [0, 0]); // 2: Володарского
    expect(s.phase).toBe('buy');
    s = act(s, 0, { type: 'buy' });
    expect(toAct(s)).toEqual([0]);
    s = act(s, 0, { type: 'roll' }, [1, 1]); // 6: Юбилейный
    s = act(s, 0, { type: 'pass' }); // торги
    expect(s.phase).toBe('auction');
    s = act(s, 1, { type: 'fold' });
    s = act(s, 0, { type: 'fold' });
    expect(s.owner[6]).toBeNull();
    s = act(s, 0, { type: 'roll' }, [2, 2]);
    expect(s.jail[0]).toBe(1);
    expect(s.pos[0]).toBe(10);
    expect(s.turn).toBe(1);
    s = act(s, 1, { type: 'roll' }, [0, 1]);
    expect(s.turn).toBe(0);
    s = act(s, 0, { type: 'payJail' });
    expect(s.jail[0]).toBe(0);
  });

  it('проход через «Старт» — 2 000', () => {
    let s = newState('manager', [0, 1], {}, rng());
    s.pos[0] = 36;
    const cash = s.cash[0];
    s = act(s, 0, { type: 'roll' }, [1, 3]); // 36 + 6 = 2
    expect(s.pos[0]).toBe(2);
    expect(s.cash[0]).toBe(cash + 2000);
  });

  it('долг: заложить и заплатить, иначе разорение и выплата кредитору банком', () => {
    let s = newState('manager', [0, 1, 2], {}, rng());
    for (const c of [6, 7, 9]) {
      s.owner[c] = 1;
      s.houses[c] = 4;
    }
    s.cash[0] = 1000;
    const c1 = s.cash[1];
    s = act(s, 0, { type: 'roll' }, [2, 3]); // 7: предприятие, 60 000
    expect(s.out[0]).toBe(true);
    expect(s.cash[1]).toBe(c1 + 60000);
    expect(s.turn).toBe(1);
  });
});

describe('Космос 2000', () => {
  it('поле: 28 клеток, 14 планет, «Старт» платит только за остановку', () => {
    const b = boardOf('kosmos');
    expect(b.cells.length).toBe(28);
    expect(b.cells.filter((c) => c.kind === 'prop').length).toBe(14);
    let s = newState('kosmos', [0, 1, 2], {}, rng());
    expect(s.cash[0]).toBe(2500);
    s.pos[0] = 25;
    s = act(s, 0, { type: 'roll' }, [3]); // 25 + 4 = 1, мимо «Старта»
    expect(s.cash[0]).toBe(2500);
    expect(newState('kosmos', [0, 1], {}, rng()).cash[0]).toBe(3000);
  });

  it('казино: звёздочка — повторный бросок по секторам 7–12', () => {
    let s = newState('kosmos', [0, 1], {}, rng());
    s.pos[0] = 4;
    s = act(s, 0, { type: 'roll' }, [2]);
    expect(s.phase).toBe('casino');
    expect(s.cash[0]).toBe(2950);
    s = act(s, 0, { type: 'spin' }, [1]); // сектор 2: −150 ★
    expect(s.phase).toBe('casino2');
    s = act(s, 0, { type: 'spin' }, [2]); // сектор 9: +400
    expect(s.cash[0]).toBe(2950 - 150 + 400);
    expect(s.turn).toBe(1);
  });

  it('пираты: всё Амазонкам; полная страховка спасает; банкрот получает ссуду', () => {
    let s = newState('kosmos', [0, 1], {}, rng());
    s.pos[0] = 10;
    s = act(s, 0, { type: 'roll' }, [3]);
    expect(s.pot).toBe(3000);
    expect(s.loan[0]).toBe(1200);
    expect(s.cash[0]).toBe(1000);
    expect(s.pos[0]).toBe(0);
    s = newState('kosmos', [0, 1], {}, rng());
    s.ins[0] = 2;
    s.pos[0] = 10;
    s = act(s, 0, { type: 'roll' }, [3]);
    expect(s.cash[0]).toBe(3000);
  });

  it('банковская планета: рента в банк и выкуп за цену + 100', () => {
    let s = newState('kosmos', [0, 1], {}, rng());
    s.owner[1] = -1;
    s = act(s, 0, { type: 'roll' }, [0]);
    expect(s.cash[0]).toBe(2980);
    expect(s.phase).toBe('bankBuy');
    s = act(s, 0, { type: 'buy' });
    expect(s.owner[1]).toBe(0);
    expect(s.cash[0]).toBe(2780);
  });
});

describe('партии ботов', () => {
  for (const map of ['manager', 'kosmos'] as const) {
    for (const limit of [0, 20]) {
      it(`${map}, ${limit ? limit + ' кругов' : 'до разорения'}: доигрывают на 2–6 игроках`, async () => {
        for (let n = 2; n <= 6; n++) {
          const res = await simulate(def, botSeats(def, n, [0, 1, 2]), { ...defaults(def), map, limit }, 500 + n + limit);
          expect(res.error, `${n} игроков`).toBeUndefined();
          expect(res.finished, `${n} игроков: ${res.steps} шагов`).toBe(true);
        }
      }, 120_000);
    }
  }
});
