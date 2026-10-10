/* 101: ход в масть/достоинство, шестёрку кроют сами, 7/8/туз/пиковый король, дама с заказом, добор, подсчёт, обнуление, выбывание. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import type { Card, Suit } from '../src/cards/deck';
import { def } from '../src/games/sto/def';
import { apply, canPlay, cfgFrom, deal, makeView, newState, type Action, type State } from '../src/games/sto/engine';

const rng = () => new SeededRng(4);
const C = (t: string): Card => ({ s: t.slice(-1) as Suit, r: ({ J: 11, Q: 12, K: 13, A: 14 } as Record<string, number>)[t.slice(0, -1)] ?? Number(t.slice(0, -1)) });
const L = (t: string) => t.split(/\s+/).filter(Boolean).map(C);

function pos(n: number, hands: string[], pile: string, stock: string, extra: Partial<State> = {}, opts = {}): State {
  const seats = Array.from({ length: n }, (_, i) => i);
  const s = newState(cfgFrom(opts), seats);
  hands.forEach((h, i) => (s.hands[i] = L(h)));
  s.pile = L(pile);
  s.stock = L(stock);
  s.round = 1;
  s.turn = 0;
  return Object.assign(s, extra);
}
const go = (s: State, seat: number, a: Action) => {
  const r = apply(s, seat, a, rng());
  expect(r, JSON.stringify(a)).not.toBeNull();
  return r!;
};
const P = (c: string, suit?: Suit): Action => ({ type: 'play', card: C(c), suit });

describe('ход', () => {
  it('в масть или в достоинство; дама — на любую', () => {
    const s = pos(2, ['9S KH 7C QD', 'AS'], '9H', '6S');
    expect(canPlay(s, C('9S'))).toBe(true);
    expect(canPlay(s, C('KH'))).toBe(true);
    expect(canPlay(s, C('7C'))).toBe(false);
    expect(canPlay(s, C('QD'))).toBe(true);
    expect(apply(s, 0, P('QD'), rng())).toBeNull();
    const t = go(s, 0, P('QD', 'C')).state;
    expect(canPlay(t, C('AS'))).toBe(false);
    expect(canPlay(t, C('7C'))).toBe(true);
  });
  it('шестёрку кроет тот же игрок; нечем — тянет', () => {
    let s = pos(2, ['6H 9C 7C', 'AS 8D'], '9H', '10H 6S');
    s = go(s, 0, P('6H')).state;
    expect(s.turn).toBe(0);
    expect(s.cover).toBe(true);
    expect(apply(s, 0, P('9C'), rng())).toBeNull();
    s = go(s, 0, { type: 'draw' }).state;
    s = go(s, 0, P('10H')).state;
    expect(s.turn).toBe(1);
  });
  it('7 — две и пропуск, 8 — одна и пропуск, туз — пропуск, пиковый король — четыре и пропуск', () => {
    const base = (card: string) => pos(3, [`${card} 9C`, 'AD', 'JD'], `9${card.slice(-1)}`, '6S 7S 8S 9S 10S');
    let r = go(base('7H'), 0, P('7H'));
    expect(r.state.hands[1].length).toBe(3);
    expect(r.state.turn).toBe(2);
    r = go(base('8H'), 0, P('8H'));
    expect(r.state.hands[1].length).toBe(2);
    expect(r.state.turn).toBe(2);
    r = go(base('AH'), 0, P('AH'));
    expect(r.state.hands[1].length).toBe(1);
    expect(r.state.turn).toBe(2);
    r = go(base('KS'), 0, P('KS'));
    expect(r.state.hands[1].length).toBe(5);
  });
});

describe('подсчёт', () => {
  it('вышел на даме — себе минус 20; соперники пишут очки', () => {
    const s = pos(3, ['QH', 'AS KD', '10C 7D'], '9H', '6S 7S', { scores: [30, 10, 0, 0, 0, 0] });
    const r = go(s, 0, P('QH', 'S'));
    const ev = r.events.find((e) => e.type === 'round');
    expect(ev).toMatchObject({ winner: 0, bonus: -20 });
    expect(r.state.scores.slice(0, 3)).toEqual([10, 25, 17]);
  });
  it('ровно 101 — в ноль, больше — выбыл; остался один — победил', () => {
    const s = pos(3, ['9H', 'AS KD', '10C 7D'], '9C', '6S 7S', { scores: [0, 90, 95, 0, 0, 0] });
    const r = go(s, 0, P('9H'));
    const ev = r.events.find((e) => e.type === 'round');
    expect(ev).toMatchObject({ reset: [], out: [1, 2] });
    expect(r.state.phase).toBe('over');
    expect(r.state.winner).toBe(0);
    const s2 = pos(3, ['9H', 'AS KD', '10C 7D'], '9C', '6S 7S', { scores: [0, 86, 0, 0, 0, 0] });
    const r2 = go(s2, 0, P('9H'));
    expect(r2.events.find((e) => e.type === 'round')).toMatchObject({ reset: [1] });
  });
});

describe('скрытые карты и боты', () => {
  it('чужие руки и колода не видны', () => {
    const s = deal(newState(cfgFrom({}), [0, 1, 2]), rng()).state;
    const v = makeView(s, [0]);
    expect(v.hands[1]).toEqual([]);
    expect(v.counts[1]).toBe(4);
    expect(v.stock).toEqual([]);
    expect(v.stockCount).toBe(36 - 12);
  });
  it('ходы ботов допустимы', async () => {
    const s = deal(newState(cfgFrom({}), [0, 1, 2]), rng()).state;
    for (const lv of [0, 1, 2]) {
      const a = (await def.bot.choose(makeView(s, [s.turn]), s.turn, lv, rng())) as Action;
      expect(apply(s, s.turn, a, rng())).not.toBeNull();
    }
  });
});
