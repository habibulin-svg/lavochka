/* Преферанс: старшинство ставок, мизер первым словом, распасы с прикупом, вист в светлую, запись (пуля, гора, висты, консоляция, помощь), итог — сумма ноль. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import type { Card, Suit } from '../src/cards/deck';
import { def } from '../src/games/preferans/def';
import { apply, bidRank, cfgFrom, deal, finalScores, makeView, newState, toAct, trickWinner, type Action, type State } from '../src/games/preferans/engine';

const rng = () => new SeededRng(6);
const C = (t: string): Card => ({ s: t.slice(-1) as Suit, r: ({ J: 11, Q: 12, K: 13, A: 14 } as Record<string, number>)[t.slice(0, -1)] ?? Number(t.slice(0, -1)) });
const L = (t: string) => t.split(/\s+/).filter(Boolean).map(C);
const HANDS = ['AS KS QS JS 10S 9S AH KH 7C 7D', '8S 7S AC KC QC JC 10C 9C 8C AD', 'KD QD JD 10D 9D 8D QH JH 10H 9H'];

function pos(extra: Partial<State> = {}, hands = HANDS, prikup = '8H 7H'): State {
  const s = newState(cfgFrom({}), [0, 1, 2]);
  s.players = [0, 1, 2];
  s.dealer = 2;
  s.turn = 0;
  s.round = 1;
  hands.forEach((h, i) => (s.hands[i] = L(h)));
  s.prikup = L(prikup);
  return Object.assign(s, extra);
}
const go = (s: State, seat: number, a: Action) => {
  const r = apply(s, seat, a, rng());
  expect(r, JSON.stringify(a)).not.toBeNull();
  return r!;
};

describe('торговля', () => {
  it('старшинство: 6♠ < 6БК < 7♠ < 8БК < мизер < 9♠ < 10БК', () => {
    const r = (b: Parameters<typeof bidRank>[0]) => bidRank(b);
    expect(r({ level: 6, trump: 'S' })).toBeLessThan(r({ level: 6, trump: 'NT' }));
    expect(r({ level: 6, trump: 'NT' })).toBeLessThan(r({ level: 7, trump: 'S' }));
    expect(r({ level: 8, trump: 'NT' })).toBeLessThan(r({ misere: true }));
    expect(r({ misere: true })).toBeLessThan(r({ level: 9, trump: 'S' }));
  });
  it('мизер — только первым словом; ниже ставки — нельзя', () => {
    let s = pos();
    s = go(s, 0, { type: 'bid', bid: { level: 6, trump: 'S' } }).state;
    expect(apply(s, 1, { type: 'bid', bid: { level: 6, trump: 'S' } }, rng())).toBeNull();
    s = go(s, 1, { type: 'bid', bid: { level: 6, trump: 'C' } }).state;
    s = go(s, 2, { type: 'pass' }).state;
    expect(apply(s, 0, { type: 'bid', bid: { misere: true } }, rng())).toBeNull();
  });
  it('все спасовали — распасы, первая взятка заходит прикупом', () => {
    let s = pos();
    s = go(s, 0, { type: 'pass' }).state;
    s = go(s, 1, { type: 'pass' }).state;
    s = go(s, 2, { type: 'pass' }).state;
    expect(s.kind).toBe('raspasy');
    expect(s.trick?.prikup).toEqual(C('8H'));
    expect(apply(s, 0, { type: 'play', card: C('AS') }, rng())).toBeNull();
    s = go(s, 0, { type: 'play', card: C('KH') }).state;
  });
});

describe('вист и розыгрыш', () => {
  it('один вистует — в светлую: за пасующего ходит вистующий', () => {
    let s = pos({ phase: 'whist', kind: 'game', bid: { level: 7, trump: 'S' }, contract: { level: 7, trump: 'S' }, declarer: 0, trump: 'S', turn: 1 }, ['AS KS QS JS 10S 9S AH KH 8H 7H', HANDS[1], HANDS[2]]);
    s = go(s, 1, { type: 'whist' }).state;
    s = go(s, 2, { type: 'pass-whist' }).state;
    expect(s.open).toBe(2);
    s = go(s, 0, { type: 'play', card: C('AS') }).state;
    s = go(s, 1, { type: 'play', card: C('7S') }).state;
    expect(s.turn).toBe(2);
    expect(toAct(s)).toEqual([1]);
    expect(apply(s, 2, { type: 'play', card: C('8D') }, rng())).toBeNull();
    s = go(s, 1, { type: 'play', card: C('8D') }).state;
    expect(s.tricks[0]).toBe(1);
    // карты открытого видят все
    expect(makeView(s, [0]).hands[2].length).toBe(9);
  });
  it('взятка: старшая в масти или козырь', () => {
    expect(trickWinner({ leader: 0, cards: [{ seat: 0, card: C('KH') }, { seat: 1, card: C('AH') }, { seat: 2, card: C('7S') }] }, 'S')).toBe(2);
    expect(trickWinner({ leader: 0, cards: [{ seat: 0, card: C('KH') }, { seat: 1, card: C('AH') }, { seat: 2, card: C('7S') }] }, 'NT')).toBe(1);
  });
});

describe('запись', () => {
  /** Последняя взятка кона — по одной карте, всё решено счётчиками. */
  function lastTrick(extra: Partial<State>): State {
    return pos({ phase: 'play', kind: 'game', declarer: 0, trump: 'S', contract: { level: 6, trump: 'S' }, bid: { level: 6, trump: 'S' }, whist: { 1: 'whist', 2: 'whist' }, tricksPlayed: 9, ...extra }, ['AS', '7C', '7D'], '');
  }
  const finish = (s: State) => {
    let r = go(s, 0, { type: 'play', card: C('AS') });
    r = go(r.state, 1, { type: 'play', card: C('7C') });
    r = go(r.state, 2, { type: 'play', card: C('7D') });
    return r;
  };
  it('сыграл — в пулю; вистующие пишут за свои взятки', () => {
    const r = finish(lastTrick({ tricks: [5, 3, 1, 0] }));
    const sc = r.events.find((e) => e.type === 'score')!;
    expect(sc.type === 'score' && sc.made).toBe(true);
    expect(sc.type === 'score' && sc.pulya[0]).toBe(2);
    expect(sc.type === 'score' && [sc.whists[1][0], sc.whists[2][0]]).toEqual([6, 2]);
  });
  it('недобор — гора и консоляция', () => {
    const r = finish(lastTrick({ tricks: [3, 4, 2, 0] }));
    const sc = r.events.find((e) => e.type === 'score')!;
    expect(sc.type === 'score' && sc.made).toBe(false);
    expect(sc.type === 'score' && sc.gora[0]).toBe(4);
    // консоляция 2·2 + висты за взятки
    expect(sc.type === 'score' && sc.whists[1][0]).toBe(4 + 8);
  });
  it('переполнил пулю — закрывает соседу и пишет на него висты', () => {
    const r = finish(lastTrick({ tricks: [5, 3, 1, 0], pulya: [9, 4, 0, 0] }));
    const sc = r.events.find((e) => e.type === 'score')!;
    expect(sc.type === 'score' && sc.pulya.slice(0, 3)).toEqual([10, 5, 0]);
    expect(sc.type === 'score' && sc.whists[0][1]).toBe(10);
  });
  it('итог — сумма ноль', () => {
    const f = finalScores({ seats: [0, 1, 2], gora: [4, 0, 10, 0], whists: [[0, 30, 12, 0], [8, 0, 0, 0], [2, 40, 0, 0], [0, 0, 0, 0]] });
    expect(f[0] + f[1] + f[2]).toBe(0);
  });
});

describe('скрытые карты и боты', () => {
  it('чужие руки и прикуп до торговли не видны', () => {
    const s = deal(newState(cfgFrom({}), [0, 1, 2]), rng()).state;
    const v = makeView(s, [0]);
    expect(v.hands[1]).toEqual([]);
    expect(v.prikup).toEqual([]);
    expect(v.counts[1]).toBe(10);
  });
  it('ходы ботов допустимы', async () => {
    const s = deal(newState(cfgFrom({}), [0, 1, 2]), rng()).state;
    for (const lv of [0, 1, 2]) {
      const a = (await def.bot.choose(makeView(s, [s.turn]), s.turn, lv, rng())) as Action;
      expect(apply(s, s.turn, a, rng())).not.toBeNull();
    }
  });
});
