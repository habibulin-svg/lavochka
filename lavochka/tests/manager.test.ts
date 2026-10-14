/* «Менеджер» / «Космос 2000»: правила полей и партии ботов на обоих полях. */
import { describe, expect, it } from 'vitest';
import { RiggedRng, SeededRng } from '../src/core/rng';
import { BOARDS, boardOf } from '../src/games/manager/boards';
import { def } from '../src/games/manager/def';
import { apply, canBuild, marketOpts, newState, rent, toAct, type Action, type State } from '../src/games/manager/engine';
import { STOCK_CARDS } from '../src/games/manager/boards';
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
  it('каждый пресет открывает своё поле', () => {
    const seats2 = [0, 1].map((seat) => ({ seat, kind: 'bot' as const, name: 'x', level: 1 }));
    // любое поле из списка должно настраиваться своим id (раньше перечень полей был выписан вслепую,
    // и новое поле «Одесса» в него не попало — пресет открывал ленинградское поле)
    for (const b of BOARDS) {
      const s = def.setup(seats2, { map: b.id, limit: 0 }, rng());
      expect(s.map, b.id).toBe(b.id);
      expect(boardOf(s.map).img, b.id).toBe(b.img);
    }
    for (const p of def.presets ?? []) {
      const s = def.setup(seats2, { ...defaults(def), ...p.options }, rng());
      expect(s.map, p.id).toBe(p.options?.map);
    }
  });

  it('одесское поле: то же кольцо, свои деньги и штраф за выход с биржи', () => {
    const o = boardOf('odessa');
    const m = boardOf('manager');
    expect(o.cells.length).toBe(40);
    expect(o.cells.length).toBe(m.cells.length);
    // углы те же: старт, биржа, отдых, маклер
    expect(o.cells[0].kind).toBe('start');
    expect(o.cells[10].kind).toBe('jail');
    expect(o.cells[20].kind).toBe('rest');
    expect(o.cells[30].kind).toBe('gojail');
    // типы клеток совпадают с ленинградским полем, кроме одного места: на скане одесского поля
    // «Извещение» стоит между гостиницами «Одесса» и «Красная» (клетка 27), а не после «Красной» (28)
    const kinds = (b: typeof o) => b.cells.map((c) => c.kind);
    const ok = kinds(o), mk = kinds(m);
    [ok[27], ok[28]] = [ok[28], ok[27]];
    expect(ok.join(',')).toBe(mk.join(','));
    expect(o.cells[27].kind).toBe('card');
    expect(o.cells[28].name).toBe('Красная');
    // масштаб денег одесский
    expect(o.money(3)).toBe(200000);
    expect(o.startPay).toBe(20000);
    expect(o.jailPay).toBe(5000);
    expect(m.jailPay ?? 500).toBe(500);
    // участки: те же группы и цена растёт по кругу
    const props = o.cells.filter((c) => c.kind === 'prop');
    expect(props.length).toBe(24);
    expect(new Set(props.map((c) => c.group)).size).toBe(8);
    expect(props[0].price).toBe(6000);
    expect(props[props.length - 1].price).toBe(34000);
    // обе колоды по 20 карт
    expect(o.decks.map((d) => d.cards.length)).toEqual([20, 20]);
  });

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

  it('Одесса: проход через «Старт» — 20 000 (правила те же, что у Ленинграда)', () => {
    let s = newState('odessa', [0, 1], {}, rng());
    const len = boardOf('odessa').cells.length;
    s.pos[0] = len - 4;
    const cash = s.cash[0];
    s = act(s, 0, { type: 'roll' }, [0, 3]); // 1 + 4: через «Старт» на 1, фабрика «Книжная» — не куплена
    expect(s.pos[0]).toBe(1);
    expect(s.cash[0]).toBe(cash + 20000);
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

describe('Бизнесмен', () => {
  const W = 'biznesmen' as const;
  it('поле: 66 клеток, 24 участка в 8 группах по 3, 10 фирм за рубежом, 52 карточки биржи', () => {
    const b = boardOf(W);
    expect(b.cells.length).toBe(66);
    const props = b.cells.filter((c) => c.kind === 'prop' && c.group != null);
    expect(props.length).toBe(24);
    for (let g = 0; g < 8; g++) expect(props.filter((c) => c.group === g).length).toBe(3);
    expect(b.cells.filter((c) => c.abroad).length).toBe(10);
    expect(STOCK_CARDS.length).toBe(52);
  });

  it('старт: 250 000, по акции каждого цвета, 3 большие и 4 малые карточки; чужие карточки скрыты', () => {
    const s = newState(W, [0, 1], {}, rng());
    expect(s.cash[0]).toBe(250000);
    expect(s.shares[1]).toEqual([1, 1, 1, 1]);
    expect(s.hand[0].length).toBe(7);
    expect(s.hand[0].filter((id) => id < 20).length).toBe(3);
    const v = def.view(s, [0]);
    expect(v.hand[1].every((id) => id === -1)).toBe(true);
    expect(v.hand[0]).toEqual(s.hand[0]);
  });

  it('плата: вдвое за группу, филиал, предприятие только после филиалов на всех участках', () => {
    let s = newState(W, [0, 1], {}, rng());
    for (const c of [1, 3, 5]) s.owner[c] = 0;
    expect(rent(s, 1)).toBe(4000);
    s = act(s, 0, { type: 'build', cell: 1 });
    expect(rent(s, 1)).toBe(20000);
    expect(canBuild(s, 0, 1)).toBe(false);
    s = act(s, 0, { type: 'build', cell: 3 });
    s = act(s, 0, { type: 'build', cell: 5 });
    s = act(s, 0, { type: 'build', cell: 1 });
    expect(s.houses[1]).toBe(4);
    expect(rent(s, 1)).toBe(60000);
    expect(s.stock).toEqual([18, 11]);
  });

  it('биржа: карточка +6/−3, кто играл — получает и за понижение', () => {
    let s = newState(W, [0, 1], {}, rng());
    const id = STOCK_CARDS.findIndex((k) => !k.big && k.c === 0 && k.up && k.a === 6);
    s.hand[0][0] = id;
    s.pos[0] = 6;
    s = act(s, 0, { type: 'roll' }, [1, 1]);
    expect(s.phase).toBe('stocks');
    s = act(s, 0, { type: 'shares', c: 0, n: 3 });
    expect(apply(s, 0, { type: 'shares', c: 0, n: 1 }, rng())).toBeNull(); // не больше четырёх
    s = act(s, 0, { type: 'play', card: 0, opt: 0 });
    expect(s.price).toEqual([16, 7, 7, 7]);
    expect(s.cash[0]).toBe(250000 - 30000 + 24000 + 9000);
    expect(s.cash[1]).toBe(250000 + 6000 - 9000);
    expect(marketOpts([10, 10, 10, 10], STOCK_CARDS.findIndex((k) => k.big && k.k === 'ten')).length).toBe(6);
  });

  it('банк: за рубеж за 4 акции и 25 000, обратно по автомагистрали до перекрёстка', () => {
    let s = newState(W, [0, 1], {}, rng());
    s.pos[0] = 21;
    s = act(s, 0, { type: 'roll' }, [1, 1]);
    expect(s.phase).toBe('hub');
    s = act(s, 0, { type: 'hub', opt: 'abroad' });
    expect(s.pos[0]).toBe(52);
    expect(s.shares[0]).toEqual([0, 0, 0, 0]);
    expect(s.cash[0]).toBe(250000 + 40000 - 25000);
    s.turn = 0;
    s.phase = 'hub';
    s = act(s, 0, { type: 'hub', opt: 'road' });
    expect(s.pos[0]).toBe(56);
    s.turn = 0;
    s.phase = 'roll';
    s = act(s, 0, { type: 'roll' }, [5, 5]); // 12 шагов, но перекрёсток — 10-я клетка
    expect(s.pos[0]).toBe(65);
    expect(s.phase).toBe('hub');
    s = act(s, 0, { type: 'hub', opt: 'exit' });
    expect(s.pos[0]).toBe(36);
  });

  it('рулетка в отеле: «В банк» — 200 000 и выход', () => {
    let s = newState(W, [0, 1], {}, rng());
    s.pos[0] = 26;
    s = act(s, 0, { type: 'roll' }, [1, 1]);
    s = act(s, 0, { type: 'hub', opt: 'roulette' });
    s = act(s, 0, { type: 'roulette', entry: 1 }, [3, 2]);
    expect(s.cash[0]).toBe(450000);
    expect(s.phase).toBe('hub');
  });
});

describe('Империя', () => {
  const I = 'imperiya' as const;
  it('поле: 38 клеток круга, 22 планеты в 8 системах, 4 базы и 2 башни; карточек по 14', () => {
    const b = boardOf(I);
    expect(b.cells.length).toBe(46);
    const planets = b.cells.filter((c) => c.kind === 'prop' && c.group != null);
    expect(planets.length).toBe(22);
    expect(b.cells.filter((c) => c.util === 'base').length).toBe(4);
    expect(b.cells.filter((c) => c.util === 'tower').length).toBe(2);
    for (const d of b.decks) expect(d.cards.length).toBe(14);
  });

  it('старт с космодрома: первый выход на «Гомера» — не круг; с «Лема» — малый круг и снова «Гомер» за 200', () => {
    let s = newState(I, [0, 1], {}, rng());
    expect(s.cash[0]).toBe(3000);
    s = act(s, 0, { type: 'roll' }, [0, 1]);
    expect(s.pos[0]).toBe(2);
    expect(s.cash[0]).toBe(3000);
    s = newState(I, [0, 1], {}, rng());
    s.pos[0] = 31;
    s.lapped[0] = true;
    s.owner[37] = 0; // «Лем» свой — решать нечего
    s = act(s, 0, { type: 'roll' }, [1, 3]);
    expect(s.pos[0]).toBe(37);
    expect(s.route[0]).toBe('inner');
    s.turn = 0;
    s.phase = 'roll';
    s = act(s, 0, { type: 'roll' }, [1, 2]); // 5: нуль переход, обмен разумов, антимир, космодром, «Гомер»
    expect(s.pos[0]).toBe(0);
    expect(s.cash[0]).toBe(3000 + 200);
  });

  it('нуль переход → подпространство: 20 за сектор и выход на планету сектора', () => {
    let s = newState(I, [0, 1], {}, rng());
    s.pos[0] = 39;
    s.route[0] = 'sub';
    s = act(s, 0, { type: 'roll' }, [1, 2]); // 5 секторов: I, II, III, IV, I
    expect(s.phase).toBe('sub');
    expect(s.pos[0]).toBe(42);
    expect(s.cash[0]).toBe(3100);
    expect(apply(s, 0, { type: 'exit', cell: 2 }, rng())).toBeNull();
    s = act(s, 0, { type: 'exit', cell: 35 });
    expect(s.pos[0]).toBe(35);
    expect(s.phase).toBe('buy');
  });

  it('отказ от покупки: отказавшийся торгуется только выше номинала, никто не купил — штраф половина цены', () => {
    let s = newState(I, [0, 1], {}, rng());
    s = act(s, 0, { type: 'roll' }, [0, 1]); // «Апулей», 70
    s = act(s, 0, { type: 'pass' });
    s = act(s, 1, { type: 'fold' });
    expect(apply(s, 0, { type: 'bid', amount: 60 }, rng())).toBeNull();
    s = act(s, 0, { type: 'fold' });
    expect(s.cash[0]).toBe(3000 - 40);
  });

  it('ракеты — на всю систему равномерно; плата по числу ракет; башня — кубики × 5', () => {
    let s = newState(I, [0, 1], {}, rng());
    s.owner[0] = 0;
    s.owner[2] = 0;
    expect(rent(s, 0)).toBe(10);
    s = act(s, 0, { type: 'build', cell: 0 });
    expect(canBuild(s, 0, 0)).toBe(false);
    s = act(s, 0, { type: 'build', cell: 2 });
    expect(rent(s, 2)).toBe(30);
    expect(s.stock[0]).toBe(38);
    s.owner[12] = 0;
    s.turn = 1;
    s.pos[1] = 9;
    s = act(s, 1, { type: 'roll' }, [1, 0, 3, 4]); // 3 → «Башня рабов», бросок 4 + 5
    expect(s.cash[1]).toBe(3000 - 45);
  });
});

describe('партии ботов', () => {
  it('imperiya, 20 кругов: доигрывают на 2–6 игроках', async () => {
    for (let n = 2; n <= 6; n++) {
      const res = await simulate(def, botSeats(def, n, [0, 1, 2]), { ...defaults(def), map: 'imperiya', limit: 20 }, 800 + n);
      expect(res.error, `${n} игроков`).toBeUndefined();
      expect(res.finished, `${n} игроков: ${res.steps} шагов`).toBe(true);
    }
  }, 120_000);
  it('biznesmen, 20 кругов: доигрывают на 2–6 игроках', async () => {
    for (let n = 2; n <= 6; n++) {
      const res = await simulate(def, botSeats(def, n, [0, 1, 2]), { ...defaults(def), map: 'biznesmen', limit: 20 }, 700 + n);
      expect(res.error, `${n} игроков`).toBeUndefined();
      expect(res.finished, `${n} игроков: ${res.steps} шагов`).toBe(true);
    }
  }, 120_000);
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
