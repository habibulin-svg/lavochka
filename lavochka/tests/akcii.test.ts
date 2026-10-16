/* «Акционеры»: поле и данные, маршрут (остановки на «Начале» и в «Клубе», аэропорт, лимит кругов), кредит под патенты, фирмы и прибыль,
 * суд, биржа и угроза банкротства, налог и льгота; партии ботов. */
import { describe, expect, it } from 'vitest';
import { RiggedRng, SeededRng } from '../src/core/rng';
import { AIR, BIG0, CELLS, CLUB, COS, FIRM_CELLS, IZV, PATENTS, PT_IDS, SMALL_END, START, STRIKE_CELL, TELEX, coFirms, firmByName } from '../src/games/akcii/data';
import { def } from '../src/games/akcii/def';
import { apply, creditFor, newState, priceOf, profitOf, type Action, type State } from '../src/games/akcii/engine';
import { botSeats, defaults, simulate } from './harness';

function act(s: State, seat: number, a: Action, rig?: number[]): State {
  const r = new RiggedRng(new SeededRng(5));
  r.rig(rig);
  const res = apply(s, seat, a, r);
  expect(res, JSON.stringify(a)).not.toBeNull();
  return res!.state;
}

const at = (s: State, seat: number, pos: number) => {
  s.pos[seat] = pos;
  s.fresh[seat] = false;
};

describe('Акционеры: данные', () => {
  it('74 клетки: «Начало», 36 малого бизнеса, «Аэропорт», 36 большого; 21 фирма в 8 компаниях', () => {
    expect(CELLS.length).toBe(74);
    expect(CELLS[START].kind).toBe('start');
    expect(CELLS[AIR].kind).toBe('air');
    expect(CELLS[SMALL_END].kind).toBe('inherit');
    expect(CELLS[BIG0].kind).toBe('telex');
    expect(CELLS[CLUB].kind).toBe('club');
    expect(FIRM_CELLS.length).toBe(21);
    for (let co = 0; co < COS.length; co++) expect(coFirms(co).length).toBeGreaterThanOrEqual(2);
    for (const t of PT_IDS) expect(PATENTS[t].length).toBe(10);
    expect(CELLS.filter((c) => c.kind === 'patent').length).toBe(12);
    expect(IZV.length).toBe(20);
    expect(TELEX.length).toBe(20);
  });

  it('кредит: после 3-го патента по 300 000, после 8-го — половина; во втором банке после 5-го по 500 000', () => {
    expect(creditFor(1, 7)).toEqual({ k: 4, sum: 1200000 });
    expect(creditFor(2, 7)).toEqual({ k: 2, sum: 1000000 });
    expect(creditFor(1, 10)).toEqual({ k: 7, sum: 5 * 300000 + 2 * 150000 });
    expect(creditFor(1, 3).k).toBe(0);
  });
});

describe('Акционеры: маршрут', () => {
  it('за «Наследством» — остановка на «Начале», следующим ходом — в аэропорт, оттуда — большой бизнес', () => {
    let s = newState([0, 1]);
    at(s, 0, SMALL_END - 1);
    s = act(s, 0, { type: 'roll' }, [4]);
    expect(s.pos[0]).toBe(START);
    expect(s.laps[0]).toBe(1);
    s = act(s, 1, { type: 'roll' }, [0, 0]);
    expect(s.ask?.kind).toBe('route');
    expect(s.ask?.opts.map((o) => o.id)).toEqual(['fly', 'again']);
    s = act(s, 0, { type: 'choose', id: 'fly' });
    expect(s.pos[0]).toBe(AIR);
    s = act(s, 1, { type: 'roll' }, [0, 0]);
    s = act(s, 0, { type: 'roll' }, [0, 0]);
    expect(s.pos[0]).toBe(BIG0);
  });

  it('кругов малого бизнеса подряд — не больше трёх, после покупки фирмы — двух', () => {
    let s = newState([0, 1]);
    at(s, 0, START);
    s.laps[0] = 2;
    s.turn = 1;
    s = act(s, 1, { type: 'roll' }, [0, 0]);
    expect(s.ask?.opts.map((o) => o.id)).toEqual(['fly', 'again']);
    s.anyBought = true;
    s.ask = null;
    s.phase = 'roll';
    s.turn = 1;
    s = act(s, 1, { type: 'roll' }, [0, 0]);
    expect(s.ask?.opts.map((o) => o.id)).toEqual(['fly']);
  });

  it('большой бизнес кончается в «Клубе бизнесменов»: остаток очков сгорает, дальше — выбор', () => {
    let s = newState([0, 1]);
    at(s, 0, CLUB - 2);
    s = act(s, 0, { type: 'roll' }, [5]);
    expect(s.pos[0]).toBe(CLUB);
    expect(s.club[0]).toBe(true);
    s = act(s, 1, { type: 'roll' }, [0, 0]);
    expect(s.ask?.opts.map((o) => o.id)).toEqual(['big', 'small']);
    s = act(s, 0, { type: 'choose', id: 'small' });
    expect(s.pos[0]).toBe(START);
    expect(s.fresh[0]).toBe(true);
  });
});

describe('Акционеры: деньги и собственность', () => {
  it('фирма: покупка, предприятия, прибыль только при предприятиях, диплом — вдвое, забастовка — без прибыли', () => {
    const knigi = firmByName('Книги');
    let s = newState([0, 1]);
    at(s, 0, knigi - 1);
    s.cash[0] = 2000000;
    s = act(s, 0, { type: 'roll' }, [0]);
    expect(s.ask?.kind).toBe('buy');
    s = act(s, 0, { type: 'choose', id: 'yes' });
    expect(s.owner[knigi]).toBe(0);
    expect(s.cash[0]).toBe(2000000 - 700000);
    // попавший на фирму без предприятий не платит
    at(s, 1, knigi - 1);
    s.cash[1] = 3000000;
    s = act(s, 1, { type: 'roll' }, [0]);
    expect(s.cash[1]).toBe(3000000);
    s = act(s, 0, { type: 'build', cell: knigi });
    s = act(s, 0, { type: 'build', cell: knigi });
    expect(s.ent[knigi]).toBe(2);
    expect(profitOf(s, knigi)).toBe(800000);
    s.diploma[0] = true;
    expect(profitOf(s, knigi)).toBe(1600000);
    s.diploma[0] = false;
    // владелец бастует — прибыли нет
    s.pos[0] = STRIKE_CELL;
    s.turn = 1;
    s.phase = 'roll';
    at(s, 1, knigi - 2);
    s = act(s, 1, { type: 'roll' }, [1]);
    expect(s.cash[1]).toBe(3000000);
    s.pos[0] = 45;
    s.turn = 1;
    s.phase = 'roll';
    at(s, 1, knigi - 2);
    s = act(s, 1, { type: 'roll' }, [1]);
    expect(s.cash[1]).toBe(3000000 - 800000);
  });

  it('кредит в банке: патенты сверх порога уходят банку, долг возвращается с процентами', () => {
    let s = newState([0, 1]);
    const bank = CELLS.find((c) => c.kind === 'bank' && c.n === 1)!.id;
    at(s, 0, bank - 1);
    s.pats[0] = Array.from({ length: 6 }, () => ({ t: 'kafe' as const, v: 1000 }));
    s = act(s, 0, { type: 'roll' }, [0]);
    s = act(s, 0, { type: 'choose', id: 'take' });
    expect(s.cash[0]).toBe(900000);
    expect(s.pats[0].length).toBe(3);
    expect(s.loans[0]).toEqual([{ sum: 1080000, left: 15 }]);
  });

  it('суд: теневик с карточкой фининспектора теряет всё и пропускает ходы; без инспектора — ничего', () => {
    const court = CELLS.find((c) => c.kind === 'court')!.id;
    const neft = firmByName('Нефть');
    let s = newState([0, 1]);
    at(s, 0, court - 1);
    s.shadow[0] = 1;
    s.cash[0] = 500000;
    s = act(s, 0, { type: 'roll' }, [0]);
    expect(s.cash[0]).toBe(500000);
    s = newState([0, 1]);
    at(s, 0, court - 1);
    s.shadow[0] = 1;
    s.inspector[0] = true;
    s.cash[0] = 500000;
    s.owner[neft] = 0;
    s = act(s, 0, { type: 'roll' }, [0]);
    expect(s.cash[0]).toBe(0);
    expect(s.owner[neft]).toBeNull();
    expect(s.skip[0]).toBe(3);
    expect(s.courts[0]).toBe(1);
  });

  it('биржа: указатель меняет курс компании; при понижении угроза банкротства разоряет владельца', () => {
    const exch = CELLS.find((c) => c.kind === 'exchange' && c.id > BIG0)!.id;
    const estrada = firmByName('Эстрада');
    let s = newState([0, 1, 2]);
    s.owner[estrada] = 0;
    s.anyBought = true;
    at(s, 1, exch - 2);
    s.turn = 1;
    s = act(s, 1, { type: 'roll' }, [1, 7, 0]);
    expect(s.rate[7]).toEqual([2, 1]);
    expect(priceOf(s, estrada)).toBe(4400000);
    s.threat[0] = 3;
    at(s, 1, exch - 2);
    s.turn = 1;
    s.phase = 'roll';
    s = act(s, 1, { type: 'roll' }, [1, 7, 1]);
    expect(s.rate[7]).toEqual([1, 2]);
    expect(s.out[0]).toBe(true);
  });

  it('налог: на первом круге малого бизнеса не берут, благотворителю — половина', () => {
    const tax = CELLS.find((c) => c.kind === 'tax' && c.n === 20000)!.id;
    let s = newState([0, 1]);
    at(s, 0, tax - 1);
    s.cash[0] = 100000;
    s = act(s, 0, { type: 'roll' }, [0]);
    expect(s.cash[0]).toBe(100000);
    s = newState([0, 1]);
    at(s, 0, tax - 1);
    s.smallDone[0] = 1;
    s.cash[0] = 100000;
    s.relief[0] = 15000;
    s = act(s, 0, { type: 'roll' }, [0]);
    expect(s.cash[0]).toBe(90000);
    expect(s.relief[0]).toBe(0);
  });
});

describe('Акционеры: партии ботов', () => {
  for (const exchange of [true, false]) {
    it(`${exchange ? 'с биржей' : 'простой вариант'}: доигрывают на 2–6 игроках`, async () => {
      for (let n = 2; n <= 6; n++) {
        const res = await simulate(def, botSeats(def, n, [0, 1, 2]), { ...defaults(def), exchange, rounds: 30 }, 700 + n);
        expect(res.error, `${n} игроков`).toBeUndefined();
        expect(res.finished, `${n} игроков: ${res.steps} шагов`).toBe(true);
      }
    }, 90_000);
  }
});
