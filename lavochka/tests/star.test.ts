/* «Звезда Африки»: граф, шаги, плата за море и перелёт, жетоны, алмаз. */
import { describe, expect, it } from 'vitest';
import { RiggedRng, SeededRng } from '../src/core/rng';
import { def } from '../src/games/star/def';
import {
  AIR, AIR_FEE, DECK, EDGE, FINISH, IDX, NEIGH, SEA_FEE, SLAVE, START_MONEY, TOKEN_AT, apply, newState, view,
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

describe('звезда африки: движок', () => {
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
    const a = step(s, 0, to, r)!;
    expect(a.state.pos[0]).toBe(to);
    expect(a.state.left).toBe(1);
    expect(a.state.turn).toBe(0);
    const b = step(a.state, 0, NEIGH[to].find((x) => x !== s.pos[0])!, r)!;
    expect(b.state.left).toBe(0);
    expect(b.state.turn).toBe(1); // очки кончились — ход перешёл
    expect(b.state.phase).toBe('roll');
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
    const next = NEIGH[sea!].find((x) => x !== s.pos[0])!;
    const b = step(a.state, 0, next, r)!;
    expect(b.state.money[0]).toBe(START_MONEY - SEA_FEE);
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

  it('подкова: 100 $ или лишний бросок', () => {
    const r = rng();
    let s = newState([0, 1], r);
    s = { ...s, horses: [1, 0] };
    let a = apply(s, 0, { type: 'horse', use: 'money' }, r)!;
    expect(a.state.money[0]).toBe(START_MONEY + 100);
    expect(a.state.horses[0]).toBe(0);
    s = { ...s, turn: 0, phase: 'step', left: 2 };
    a = apply(s, 0, { type: 'horse', use: 'move' }, r)!;
    expect(a.state.phase).toBe('roll');
    expect(a.state.turn).toBe(0);
    expect(apply({ ...s, horses: [0, 0] }, 0, { type: 'horse', use: 'money' }, r)).toBeNull();
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
});
