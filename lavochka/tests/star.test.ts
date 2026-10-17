/* «Звезда Африки»: граф, шаги, плата за море и перелёт, жетоны, алмаз. */
import { describe, expect, it } from 'vitest';
import { RiggedRng, SeededRng } from '../src/core/rng';
import { def } from '../src/games/star/def';
import {
  AIR, AIR_FEE, CAPE, CELLS, DECK, EDGE, FINISH, HALT_AT, IDX, ISLAND_AT, NEIGH, OPEN_FEE, SEA_FEE, SLAVE, START_MONEY, TOKEN_AT,
  apply, newState, view,
  type State,
} from '../src/games/star/engine';

const rng = () => new RiggedRng(new SeededRng(41));

const step = (s: State, seat: number, to: number, r: RiggedRng) => apply(s, seat, { type: 'step', to }, r);
const turnRoll = (s: State, seat: number, die: number, r: RiggedRng) => {
  r.rig([die - 1]);
  const a = apply(s, seat, { type: 'roll' }, r);
  expect(a, 'бросок').not.toBeNull();
  return a!;
};

describe('Звезда Африки: морской путь через Суакин', () => {
  it('Суакин стоит на линии Красного моря: s13 — Суакин — s15, в обе стороны', () => {
    const su = IDX['10'];
    expect(NEIGH[IDX['s13']]).toContain(su);
    expect(NEIGH[su]).toContain(IDX['s13']);
    expect(NEIGH[su]).toContain(IDX['s15']);
    expect(NEIGH[IDX['s13']]).not.toContain(IDX['s15']); // мимо порта напрямую нельзя
  });
});

describe('звезда африки: движок', () => {
  it('дороги проходят и под квадратами жетонов — тупиков нет', () => {
    // «Бахр эль Газаль»: разметка агента обрывала дорогу на квадрате, и с жетона был только путь назад
    expect(NEIGH[IDX['16']]).toContain(IDX['b58']);
    expect(NEIGH[IDX['16']]).toContain(IDX['b73']);
    expect(NEIGH[IDX['b73']]).toContain(IDX['16']);
    // «Озеро Виктория» и жетон 19 — то же самое
    expect(NEIGH[IDX['25']]).toEqual(expect.arrayContaining([IDX['b105'], IDX['b110']]));
    expect(NEIGH[IDX['19']]).toContain(IDX['b72']);
    // ни один жетон не остался тупиком: у каждого не меньше двух дорог
    const lonely = CELLS.map((c, i) => (c.kind === 'token' ? i : -1)).filter((i) => i >= 0 && NEIGH[i].length < 2);
    expect(lonely.map((i) => CELLS[i].id)).toEqual([]);
  });

  it('начало партии: каждый сам выбирает город — Танжер или Каир', () => {
    const r = rng();
    const seats = [0, 1].map((seat) => ({ seat, kind: 'bot' as const, name: 'x', level: 1 }));
    const s = def.setup(seats, {}, r); // по умолчанию «каждый выбирает» — как в правилах
    expect(s.phase).toBe('start');
    expect(def.bot.choose(s, 0, 1, r)).toEqual({ type: 'start', at: IDX['Tg'] }); // средний выбирает Танжер
    // не своя очередь и не город — не проходит
    expect(apply(s, 1, { type: 'start', at: IDX['K'] }, r)).toBeNull();
    expect(apply(s, 0, { type: 'start', at: IDX['1'] }, r)).toBeNull();
    const a = apply(s, 0, { type: 'start', at: IDX['K'] }, r)!;
    expect(a.state.pos[0]).toBe(IDX['K']);
    expect(a.state.turn).toBe(1);
    const b = apply(a.state, 1, { type: 'start', at: IDX['Tg'] }, r)!;
    expect(b.state.pos[1]).toBe(IDX['Tg']);
    expect(b.state.phase).toBe('roll'); // выбрали все — поехали
    expect(b.state.turn).toBe(0);
    // «все из Каира» — сразу без выбора
    const fast = def.setup(seats, { city: 'K' }, r);
    expect(fast.phase).toBe('roll');
    expect(fast.pos[0]).toBe(IDX['K']);
  });

  it('раскладка: 30 жетонов по квадратам, у всех 500 $, все в Танжере', () => {
    const r = rng();
    const s = newState([0, 1], r);
    expect(s.tokens.filter(Boolean).length).toBe(30);
    expect(DECK.length).toBe(30);
    expect(DECK.filter((t) => t === 'diamond').length).toBe(1);
    expect(DECK.filter((t) => t === 'robber').length).toBe(5);
    const kinds = s.tokens.filter(Boolean).slice().sort().join(',');
    expect(kinds).toBe(DECK.slice().sort().join(','));
    expect(s.money[0]).toBe(START_MONEY);
    expect(s.pos[0]).toBe(IDX['Tg']);
    expect(s.diamond).toBe(-1);
  });

  it('шаг: только по ребру, очки ограничивают ход, потом ход переходит', () => {
    const r = rng();
    let s = newState([0, 1], r);
    s = turnRoll(s, 0, 2, r).state;
    expect(s.phase).toBe('step');
    expect(s.left).toBe(2);
    // не сосед — нельзя
    expect(step(s, 0, IDX['30'], r)).toBeNull();
    const to = NEIGH[s.pos[0]][0];
    let a = step(s, 0, to, r)!;
    // по однозначной дороге путь идёт сам: шагов в событиях — сколько очков истрачено
    const steps = a.events.filter((e) => e.type === 'step');
    expect(steps[0]).toMatchObject({ from: s.pos[0], to });
    if (a.state.left > 0) {
      expect(a.state.turn).toBe(0);
      a = step(a.state, 0, NEIGH[a.state.pos[0]].find((x) => x !== to)!, r)!;
    }
    expect(a.state.left).toBe(0);
    expect(a.state.turn).toBe(1); // очки кончились — ход перешёл
    expect(a.state.phase).toBe('roll');
  });

  it('путь по однозначной дороге прокладывается сам — до развилки или клетки с решением', () => {
    const r = rng();
    let s = newState([0, 1], r);
    s = { ...s, pos: s.pos.map((p, i) => (i === 0 ? IDX['b10'] : p)) };
    s = turnRoll(s, 0, 6, r).state;
    const a = step(s, 0, IDX['b13'], r)!;
    const steps = a.events.filter((e) => e.type === 'step');
    const last = a.state.pos[0];
    // остановка — не на простой точке с единственной дорогой вперёд
    const prev = steps.length > 1 ? (steps[steps.length - 1] as { from: number }).from : s.pos[0];
    const plainOne = CELLS[last].kind === 'land' || CELLS[last].kind === 'sea';
    if (a.state.phase === 'step') expect(!plainOne || NEIGH[last].filter((n) => n !== prev).length !== 1).toBe(true);
    expect(a.state.left).toBe(6 - steps.length);
  });

  it('можно остановиться, не истратив все очки', () => {
    const r = rng();
    let s = turnRoll(newState([0, 1], r), 0, 6, r).state;
    s = step(s, 0, NEIGH[s.pos[0]][0], r)!.state;
    const a = apply(s, 0, { type: 'stop' }, r)!;
    expect(a.state.turn).toBe(1);
    expect(a.state.phase).toBe('roll');
    expect(a.events.some((e) => e.type === 'stop')).toBe(true);
  });

  it('выход из порта в море стоит 100, из путевой точки — бесплатно', () => {
    const r = rng();
    // из Танжера (город-порт) есть морское ребро
    let s = newState([0, 1], r);
    const sea = NEIGH[s.pos[0]].find((to, i) => EDGE[s.pos[0]][i] === 'sea');
    expect(sea).toBeDefined();
    s = turnRoll(s, 0, 3, r).state;
    const a = step(s, 0, sea!, r)!;
    expect(a.state.money[0]).toBe(START_MONEY - SEA_FEE);
    expect(a.events.some((e) => e.type === 'step' && e.fee === SEA_FEE)).toBe(true);
    // следующий шаг — уже не из порта: бесплатно
    if (a.state.phase === 'step' && a.state.pos[0] === sea) {
      const next = NEIGH[sea!].find((x) => x !== s.pos[0])!;
      const b = step(a.state, 0, next, r)!;
      expect(b.state.money[0]).toBe(START_MONEY - SEA_FEE);
    } else expect(a.events.filter((e) => e.type === 'step' && e.fee).length).toBe(1);
  });

  it('перелёт: 300 $, без кубика, ход заканчивается', () => {
    const r = rng();
    let s = newState([0, 1], r);
    const to = AIR[s.pos[0]][0];
    expect(to).toBeDefined();
    // под жетоном в пункте назначения — пусто, чтобы считать только плату за перелёт
    s = { ...s, tokens: s.tokens.map((t, i) => (i === to ? 'empty' : t)), open: s.open.map(() => false) };
    const a = apply(s, 0, { type: 'air', to }, r)!;
    expect(a.state.money[0]).toBe(START_MONEY - AIR_FEE);
    expect(a.state.pos[0]).toBe(to);
    expect(a.state.turn).toBe(1);
    // без денег не улететь
    s = { ...s, money: s.money.map(() => 0) };
    expect(apply(s, 0, { type: 'air', to }, r)).toBeNull();
  });

  it('жетоны: камень в банк (на Золотом Берегу вдвое), подкова в руку, разбойник забирает деньги', () => {
    const r = rng();
    const base = newState([0, 1], r);
    const at = (id: string) => IDX[id];
    // подкладываем жетоны и ставим фишку на соседнюю клетку
    const make = (cell: number, tok: State['tokens'][number]) => {
      const s = { ...base, tokens: base.tokens.slice(), open: base.open.slice() };
      s.tokens[cell] = tok;
      s.open[cell] = false;
      s.pos = s.pos.map((p, i) => (i === 0 ? NEIGH[cell][0] : p));
      s.turn = 0;
      return s;
    };
    // топаз у Золотого Берега (id 14) — плата вдвое
    let a = step(turnRoll(make(at('14'), 'topaz'), 0, 1, r).state, 0, at('14'), r)!;
    expect(a.state.money[0]).toBe(START_MONEY + 600);
    expect(a.events.some((e) => e.type === 'token' && e.gain === 600)).toBe(true);
    // изумруд в другом месте — обычная цена
    a = step(turnRoll(make(at('12'), 'ruby'), 0, 1, r).state, 0, at('12'), r)!;
    expect(a.state.money[0]).toBe(START_MONEY + 800);
    // подкова
    a = step(turnRoll(make(at('9'), 'horse'), 0, 1, r).state, 0, at('9'), r)!;
    expect(a.state.horses[0]).toBe(1);
    // разбойник на Невольничьем Берегу — деньги в ноль и три хода рабства
    a = step(turnRoll(make(SLAVE, 'robber'), 0, 1, r).state, 0, SLAVE, r)!;
    expect(a.state.money[0]).toBe(0);
    expect(a.state.skip[0]).toBe(3);
    expect(a.events.some((e) => e.type === 'token' && e.tok === 'robber' && e.slavery)).toBe(true);
  });

  it('алмаз: найденный несёт к финишу, доставка — победа', () => {
    const r = rng();
    let s = newState([0, 1], r);
    // кладём алмаз в Танжер (жетон города) и ведём фишку к нему с алмазом
    s = { ...s, tokens: s.tokens.slice(), open: s.open.slice() };
    s.tokens[IDX['1']] = 'diamond';
    s.pos = s.pos.map((p, i) => (i === 0 ? NEIGH[IDX['1']][0] : p));
    s.turn = 0;
    let a = step(turnRoll(s, 0, 1, r).state, 0, IDX['1'], r)!;
    expect(a.state.diamond).toBe(0);
    // с алмазом идём на Tg
    let cur = { ...a.state, pos: a.state.pos.map((p, i) => (i === 0 ? NEIGH[IDX['Tg']][0] : p)), turn: 0 };
    const b = step(turnRoll(cur, 0, 1, r).state, 0, IDX['Tg'], r)!;
    expect(b.state.winner).toBe(0);
    expect(def.result(b.state)!.winners).toEqual([0]);
    expect(FINISH).toContain(IDX['Tg']);
  });

  it('подкова: 100 $ или лишний ход', () => {
    const r = rng();
    let s = newState([0, 1], r);
    s = { ...s, horses: [1, 0, 0, 0] };
    let a = apply(s, 0, { type: 'horse', use: 'money' }, r)!;
    expect(a.state.money[0]).toBe(START_MONEY + 100);
    expect(a.state.horses[0]).toBe(0);
    // лишний ход: после конца своего хода игрок ходит ещё раз
    a = apply(s, 0, { type: 'horse', use: 'move' }, r)!;
    expect(a.state.extra[0]).toBe(1);
    const t = turnRoll(a.state, 0, 1, r).state;
    const b = step(t, 0, NEIGH[t.pos[0]][0], r)!;
    expect(b.state.turn).toBe(0);
    expect(b.state.phase).toBe('roll');
    expect(b.events.some((e) => e.type === 'extra')).toBe(true);
    expect(apply({ ...s, horses: [0, 0, 0, 0] }, 0, { type: 'horse', use: 'money' }, r)).toBeNull();
  });

  it('пропуск хода: рабство отбывается, ход переходит', () => {
    const r = rng();
    let s = newState([0, 1], r);
    s = { ...s, skip: [2, 0], turn: 0 };
    const a = apply(s, 0, { type: 'roll' }, r)!;
    expect(a.state.skip[0]).toBe(1);
    expect(a.state.turn).toBe(1);
    expect(a.events.some((e) => e.type === 'skip')).toBe(true);
  });

  it('клиент не видит, что под закрытыми жетонами', () => {
    const r = rng();
    const s = newState([0, 1], r);
    const seen = view(s);
    expect(seen.tokens.filter(Boolean).length).toBe(0);
    const open = { ...s, open: s.open.map((o, i) => TOKEN_AT[i]) };
    const v2 = view(open);
    expect(v2.tokens.filter(Boolean).length).toBe(30);
  });

  it('обведённый кружок у Сахары: остановился — пропуск хода', () => {
    const r = rng();
    let s = newState([0, 1], r);
    s = { ...s, pos: s.pos.map((p, i) => (i === 0 ? IDX['b21'] : p)) };
    const a = step(turnRoll(s, 0, 1, r).state, 0, IDX['b24'], r)!;
    expect(a.events.some((e) => e.type === 'halt')).toBe(true);
    expect(a.state.skip[0]).toBe(1);
    // остальные кружки размечены так же
    expect(HALT_AT[IDX['b24']]).toBe(true);
    expect(HALT_AT[IDX['s47']]).toBe(true);
    expect(HALT_AT[IDX['s54']]).toBe(true);
  });

  it('проход не открывает жетон; истратив все очки, пройденный открывают за 100', () => {
    const r = rng();
    let s = newState([0, 1], r);
    s = { ...s, tokens: s.tokens.slice(), open: s.open.slice(), pos: s.pos.map((p, i) => (i === 0 ? IDX['b10'] : p)) };
    s.tokens[IDX['5']] = 'topaz';
    s.tokens[IDX['b21']] = null;
    s = turnRoll(s, 0, 3, r).state;
    s = step(s, 0, IDX['b13'], r)!.state;
    if (s.pos[0] !== IDX['5']) s = step(s, 0, IDX['5'], r)!.state;
    expect(s.pos[0]).toBe(IDX['5']); // путь сам остановился на квадрате жетона
    expect(s.open[IDX['5']]).toBe(false); // мимо — не открывается
    s = step(s, 0, IDX['b21'], r)!.state;
    expect(s.phase).toBe('open');
    expect(s.passed).toContain(IDX['5']);
    // без денег открыть нельзя, чужой жетон — тоже
    expect(apply({ ...s, money: s.money.map(() => 0) }, 0, { type: 'open', cell: IDX['5'] }, r)).toBeNull();
    expect(apply(s, 0, { type: 'open', cell: IDX['8'] }, r)).toBeNull();
    const a = apply(s, 0, { type: 'open', cell: IDX['5'] }, r)!;
    expect(a.state.money[0]).toBe(START_MONEY - OPEN_FEE + 300);
    expect(a.state.turn).toBe(1); // открывать больше нечего — ход перешёл
    // остановился раньше — пройденные не открыть: ход сразу переходит
    let e = turnRoll({ ...s, phase: 'roll', turn: 0, passed: [], pos: s.pos.map((p, i) => (i === 0 ? IDX['b10'] : p)) }, 0, 3, r).state;
    e = step(e, 0, IDX['b13'], r)!.state;
    if (e.pos[0] !== IDX['5']) e = step(e, 0, IDX['5'], r)!.state;
    e = step(e, 0, IDX['b21'], r)!.state;
    expect(e.phase).toBe('open');
    const stop = apply(e, 0, { type: 'stop' }, r)!;
    expect(stop.state.turn).toBe(1);
  });

  it('в море из порта без денег не выйти', () => {
    const r = rng();
    let s = newState([0, 1], r);
    s = turnRoll({ ...s, money: [50, 500, 500, 500] }, 0, 2, r).state;
    const sea = NEIGH[s.pos[0]].find((_, i) => EDGE[s.pos[0]][i] === 'sea')!;
    expect(step(s, 0, sea, r)).toBeNull();
  });

  it('владельцу алмаза нельзя через открытого разбойника', () => {
    const r = rng();
    let s = newState([0, 1], r);
    s = {
      ...s,
      tokens: s.tokens.slice(),
      open: s.open.slice(),
      diamond: 0,
      pos: s.pos.map((p, i) => (i === 0 ? IDX['b21'] : IDX['8'])),
    };
    s.tokens[IDX['5']] = 'robber';
    s.open[IDX['5']] = true;
    s = turnRoll(s, 0, 2, r).state;
    expect(step(s, 0, IDX['5'], r)).toBeNull();
    // а обычному игроку через него можно — и он становится разбойником-соперником
    const other = { ...s, turn: 1, phase: 'roll' as const, left: 0, pos: s.pos.map((p, i) => (i === 1 ? IDX['b21'] : p)) };
    const b = step(turnRoll(other, 1, 1, r).state, 1, IDX['5'], r)!;
    expect(b.state.bandit[1]).toBe(true);
    expect(b.state.banditTok[1]).toBe(IDX['5']); // жетон выбудет, когда разбойник догонит владельца
    expect(b.state.money[1]).toBe(START_MONEY); // деньги при нём
  });

  it('владелец налетел на разбойника: деньги в банк, алмаз открыто на Кейптауне', () => {
    const r = rng();
    let s = newState([0, 1], r);
    s = {
      ...s,
      tokens: s.tokens.slice(),
      open: s.open.slice(),
      diamond: 0,
      money: [900, 500],
      pos: s.pos.map((p, i) => (i === 0 ? IDX['b21'] : p)),
    };
    s.tokens[IDX['5']] = 'robber';
    s.open[IDX['5']] = false;
    const a = step(turnRoll(s, 0, 1, r).state, 0, IDX['5'], r)!;
    expect(a.state.diamond).toBe(-1);
    expect(a.state.diamondSite).toBe(CAPE);
    expect(a.state.money[0]).toBe(0);
    expect(a.events.some((e) => e.type === 'drop')).toBe(true);
    // кто дошёл до Кейптауна, тот и подобрал алмаз
    const near = { ...a.state, tokens: a.state.tokens.slice(), open: a.state.open.slice(), turn: 0 };
    near.tokens[CAPE] = 'empty';
    near.open[CAPE] = false;
    near.pos = near.pos.map((p, i) => (i === 0 ? IDX['b116'] : p));
    const b = step(turnRoll(near, 0, 1, r).state, 0, CAPE, r)!;
    expect(b.state.diamond).toBe(0);
    expect(b.state.diamondSite).toBe(-1);
  });

  it('разбойник-соперник догоняет владельца: алмаз и деньги переходят к нему', () => {
    const r = rng();
    let s = newState([0, 1], r);
    s = {
      ...s,
      tokens: s.tokens.slice(),
      open: s.open.slice(),
      diamond: 0,
      money: [700, 500],
      pos: s.pos.map((p, i) => (i === 0 ? IDX['b13'] : IDX['b21'])),
      turn: 1,
    };
    s.tokens[IDX['5']] = 'robber';
    s.open[IDX['5']] = true;
    let cur = turnRoll(s, 1, 2, r).state;
    cur = step(cur, 1, IDX['5'], r)!.state;
    expect(cur.bandit[1]).toBe(true);
    expect(cur.money[1]).toBe(500);
    const a = step(cur, 1, IDX['b13'], r)!;
    expect(a.state.diamond).toBe(1);
    expect(a.state.bandit[1]).toBe(false);
    expect(a.state.money[1]).toBe(1200);
    expect(a.state.money[0]).toBe(0);
    expect(a.events.some((e) => e.type === 'catch')).toBe(true);
    expect(a.state.tokens[IDX['5']]).toBe('empty'); // жетон разбойника выбыл из игры
  });

  it('остров: без денег и подков — три хода в ожидании', () => {
    const r = rng();
    let s = newState([0, 1], r);
    s = { ...s, pos: s.pos.map((p, i) => (i === 0 ? IDX['2'] : p)), money: [0, 500], turn: 0 };
    const a = apply(s, 0, { type: 'roll' }, r)!;
    expect(ISLAND_AT[IDX['2']]).toBe(true);
    expect(a.events.some((e) => e.type === 'island')).toBe(true);
    expect(a.state.skip[0]).toBe(2); // один ход уже пропущен, два ждут
    expect(a.state.turn).toBe(1);
  });
});
