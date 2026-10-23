/* Баккара: счёт, таблица третьей карты, выплаты пунто банко, банк в шмен де фер, боты. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { choose } from '../src/games/baccarat/ai';
import { def } from '../src/games/baccarat/def';
import * as bc from '../src/games/baccarat/engine';
import type { Card, Suit } from '../src/cards/deck';

const C = (t: string): Card => ({ s: t.slice(-1) as Suit, r: ({ J: 11, Q: 12, K: 13, A: 14 } as Record<string, number>)[t.slice(0, -1)] ?? Number(t.slice(0, -1)) });
const L = (t: string) => t.split(/\s+/).filter(Boolean).map(C);
const rng = new SeededRng(1);
const FILL = '2S 3S 4S 5S 6S 7S 8S 9S 10S JS QS KS AS 2H 3H 4H 5H 6H 7H 8H 9H 10H JH QH KH AH 2C 3C 4C 5C';
function pos(n: number, shoe: string, opts = {}) {
  const s = bc.newState(bc.cfgFrom(opts), Array.from({ length: n }, (_, i) => i));
  s.shoe = L(shoe + ' ' + FILL);
  s.coup = 1;
  if (s.cfg.mode === 'pb') {
    s.phase = 'bet';
    s.order = s.seats.slice();
    s.turn = 0;
  } else {
    s.bankSeat = 0;
    s.phase = 'open';
    s.turn = 0;
  }
  return s;
}
const act = (s: bc.State, seat: number, a: bc.Action) => {
  const r = bc.apply(s, seat, a, rng);
  expect(r, JSON.stringify(a)).not.toBeNull();
  return r!;
};
const result = (evs: bc.Event[]) => evs.find((e) => e.type === 'result') as Extract<bc.Event, { type: 'result' }>;

describe('Баккара', () => {
  it('счёт: последняя цифра, картинки — ноль, туз — один', () => {
    expect(bc.total(L('7H 8S'))).toBe(5);
    expect(bc.total(L('KH AS'))).toBe(1);
    expect(bc.natural(L('4H 4S'))).toBe(true);
    expect(bc.natural(L('4H 4S 1D'.replace('1D', 'AD')))).toBe(false);
  });

  it('таблица банкира', () => {
    expect(bc.bankerDraws(5, null)).toBe(true);
    expect(bc.bankerDraws(6, null)).toBe(false);
    expect(bc.bankerDraws(3, 8)).toBe(false);
    expect(bc.bankerDraws(3, 9)).toBe(true);
    expect(bc.bankerDraws(4, 1)).toBe(false);
    expect(bc.bankerDraws(4, 7)).toBe(true);
    expect(bc.bankerDraws(5, 3)).toBe(false);
    expect(bc.bankerDraws(6, 6)).toBe(true);
    expect(bc.bankerDraws(6, 5)).toBe(false);
    expect(bc.bankerDraws(7, 0)).toBe(false);
  });

  it('пунто банко: натуральная, выплаты с комиссией, ничья 8:1 и возврат', () => {
    let s = pos(2, '3H 9D 4C KS');
    s = act(s, 0, { type: 'bet', side: 'B', n: 100 }).state;
    const r = act(s, 1, { type: 'bet', side: 'P', n: 50 });
    expect(result(r.events)).toMatchObject({ p: 7, b: 9, win: 'B', natural: true });
    expect(r.state.money[0]).toBe(1095);
    expect(r.state.money[1]).toBe(950);
    let t = pos(2, '4H 4D 3C 3S');
    t = act(t, 0, { type: 'bet', side: 'T', n: 10 }).state;
    const r2 = act(t, 1, { type: 'bet', side: 'P', n: 50 });
    expect(result(r2.events).win).toBe('T');
    expect(r2.state.money[0]).toBe(1080);
    expect(r2.state.money[1]).toBe(1000);
  });

  it('третьи карты по таблице', () => {
    const s = pos(1, '2H 5D 2C KS 6S 3H');
    const r = act(s, 0, { type: 'bet', side: 'P', n: 100 });
    expect(result(r.events)).toMatchObject({ p: 0, b: 8, win: 'B' });
    expect(r.state.coup).toBe(2);
  });

  it('шмен де фер: банко, решение на пятёрке, банк держать или передать', () => {
    let s = pos(3, '3H 2D 2C 4S 6C 2S', { mode: 'chemmy' });
    s = act(s, 0, { type: 'bank', n: 100 }).state;
    expect(s.money[0]).toBe(900);
    expect(s.turn).toBe(1);
    const r = act(s, 1, { type: 'banco' });
    expect(r.state.phase).toBe('punter');
    expect(r.state.punter).toBe(1);
    const r2 = act(r.state, 1, { type: 'draw' });
    expect(result(r2.events).win).toBe('B');
    expect(r2.state.phase).toBe('keep');
    expect(r2.state.bank).toBe(200);
    const r3 = act(r2.state, 0, { type: 'pass' });
    expect(r3.state.money[0]).toBe(1100);
    expect(r3.state.bankSeat).toBe(1);
    expect(r3.state.phase).toBe('open');
  });

  it('шмен де фер: понтёр выиграл — банк переходит', () => {
    let s = pos(2, '9H 2D KC 4S', { mode: 'chemmy' });
    s = act(s, 0, { type: 'bank', n: 100 }).state;
    const r = act(s, 1, { type: 'bet', side: 'P', n: 60 });
    expect(result(r.events)).toMatchObject({ p: 9, win: 'P' });
    expect(r.state.money[1]).toBe(1060);
    expect(r.state.money[0]).toBe(940);
    expect(r.state.bankSeat).toBe(1);
  });

  it('боты доигрывают обе игры, деньги не теряются из ниоткуда в шмен де фер', () => {
    for (const mode of ['pb', 'chemmy']) {
      for (let g = 0; g < 4; g++) {
        const r = new SeededRng(10 + g);
        let s = bc.setup([0, 1, 2, 3], { mode, coups: 20 }, r);
        for (let i = 0; i < 3000 && !s.over; i++) {
          const seat = s.turn!;
          const a = choose(def.view(s, [seat]), seat, g % 3, r)!;
          const res = bc.apply(s, seat, a, r);
          expect(res, `${mode} ${JSON.stringify(a)} ${s.phase}`).not.toBeNull();
          s = res!.state;
          if (mode === 'chemmy') expect(s.seats.reduce((x, y) => x + s.money[y], 0) + s.bank + (['bet', 'punter', 'banker'].includes(s.phase) ? s.bets.reduce((x, b) => x + b.n, 0) : 0)).toBe(4000);
        }
        expect(s.over).toBe(true);
      }
    }
  });
});
