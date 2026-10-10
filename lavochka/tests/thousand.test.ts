/* Тысяча: взятки, обязанность козырять, марьяжи, торговля, прикуп, подсчёт (округление, бочка, болты, самосвал), вчетвером, скрытые карты. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import type { Card, Suit } from '../src/cards/deck';
import { def } from '../src/games/thousand/def';
import { apply, cfgFrom, deal, legalCards, makeView, maxBid, newState, round5, trickWinner, type Action, type State } from '../src/games/thousand/engine';

const rng = () => new SeededRng(5);
const C = (t: string): Card => ({ s: t.slice(-1) as Suit, r: ({ J: 11, Q: 12, K: 13, A: 14 } as Record<string, number>)[t.slice(0, -1)] ?? Number(t.slice(0, -1)) });
const L = (t: string) => t.split(/\s+/).filter(Boolean).map(C);

function playPos(hands: string[], extra: Partial<State> = {}): State {
  const s = newState(cfgFrom({}), [0, 1, 2]);
  s.players = [0, 1, 2];
  s.dealer = 2;
  hands.forEach((h, i) => (s.hands[i] = L(h)));
  s.phase = 'play';
  s.turn = 0;
  s.bidder = 0;
  s.bid = 100;
  s.round = 1;
  return Object.assign(s, extra);
}
const go = (s: State, seat: number, a: Action) => {
  const r = apply(s, seat, a, rng());
  expect(r, JSON.stringify(a)).not.toBeNull();
  return r!;
};

describe('взятки', () => {
  it('десятка старше короля, козырь бьёт', () => {
    expect(trickWinner({ leader: 0, cards: [{ seat: 0, card: C('KH') }, { seat: 1, card: C('10H') }, { seat: 2, card: C('QH') }] }, null)).toBe(1);
    expect(trickWinner({ leader: 0, cards: [{ seat: 0, card: C('AH') }, { seat: 1, card: C('9S') }, { seat: 2, card: C('KH') }] }, 'S')).toBe(1);
    expect(trickWinner({ leader: 0, cards: [{ seat: 0, card: C('AH') }, { seat: 1, card: C('9S') }, { seat: 2, card: C('KH') }] }, null)).toBe(0);
  });
  it('в масть, нет масти — козырем', () => {
    const s = playPos(['AH', '9H JD', 'KS QD'], { trump: 'S', trick: { leader: 0, cards: [{ seat: 0, card: C('AH') }] } });
    expect(legalCards(s, 1)).toEqual([C('9H')]);
    expect(legalCards(s, 2)).toEqual([C('KS')]);
  });
});

describe('марьяж', () => {
  it('не в первый ход; объявленный — очки и козырь', () => {
    let s = playPos(['KH QH AS 9C', '9H 10S JS 9D', 'JH KS QS 10D']);
    expect(apply(s, 0, { type: 'play', card: C('QH'), marriage: true }, rng())).toBeNull();
    s = go(s, 0, { type: 'play', card: C('AS') }).state;
    s = go(s, 1, { type: 'play', card: C('10S') }).state;
    s = go(s, 2, { type: 'play', card: C('KS') }).state;
    expect(s.turn).toBe(0);
    s = go(s, 0, { type: 'play', card: C('QH'), marriage: true }).state;
    expect(s.trump).toBe('H');
    expect(s.roundPts[0]).toBe(11 + 10 + 4 + 100);
  });
});

describe('торговля и прикуп', () => {
  it('больше 120 — только с марьяжем; прикуп заказчику, отдаёт по карте, поднимает', () => {
    expect(maxBid(L('KH QH 9S'))).toBe(220);
    expect(maxBid(L('KH QS'))).toBe(120);
    let s = deal(newState(cfgFrom({}), [0, 1, 2]), rng()).state;
    const first = s.bidder;
    const order = [s.turn, ...s.players.filter((x) => x !== s.turn)];
    expect(order).toContain(first);
    // все пасуют — играет «сидящий на ста»
    while (s.phase === 'bid') s = go(s, s.turn, { type: 'pass' }).state;
    expect(s.bidder).toBe(first);
    expect(s.hands[first].length).toBe(10);
    const others = s.players.filter((x) => x !== first);
    for (const to of others) s = go(s, first, { type: 'give', to, card: s.hands[first][0] }).state;
    expect(s.phase).toBe('raise');
    expect(apply(s, first, { type: 'raise', value: 95 }, rng())).toBeNull();
    s = go(s, first, { type: 'raise', value: 100 }).state;
    expect(s.phase).toBe('play');
    expect(s.players.map((x) => s.hands[x].length)).toEqual([8, 8, 8]);
  });
});

describe('подсчёт', () => {
  it('округление до 5', () => {
    expect([12, 13, 17, 18, 0].map(round5)).toEqual([10, 15, 15, 20, 0]);
  });
  it('заказ не сыгран — минус; соперники пишут свои', () => {
    // одна последняя взятка: всё решено
    const s = playPos(['9C', 'AC', '10C'], { bid: 120, roundPts: [60, 30, 0, 0], tricksTaken: [3, 2, 1, 0], tricksPlayed: 6 });
    let r = go(s, 0, { type: 'play', card: C('9C') });
    r = go(r.state, 1, { type: 'play', card: C('AC') });
    r = go(r.state, 2, { type: 'play', card: C('10C') });
    const sc = r.events.find((e) => e.type === 'score');
    expect(sc && sc.type === 'score' && sc.deltas.slice(0, 3)).toEqual([-120, 50, 0]);
  });
  it('бочка: с 880 очки не растут, выход — только своим заказом', () => {
    const s = playPos(['9C', 'AC', '10C'], { bid: 120, bidder: 1, turn: 0, roundPts: [0, 100, 0, 0], tricksTaken: [1, 3, 1, 0], tricksPlayed: 6, scores: [870, 880, 0, 0], barrel: [0, 1, 0, 0] });
    let r = go(s, 0, { type: 'play', card: C('9C') });
    r = go(r.state, 1, { type: 'play', card: C('AC') });
    r = go(r.state, 2, { type: 'play', card: C('10C') });
    // Ленка (на бочке) сыграла 120 — тысяча; Вовка набрал бы 880 — но выигрыш раньше
    expect(r.state.phase).toBe('over');
    expect(r.state.winner).toBe(1);
  });
  it('болт: кон без взятки; три болта — минус 120', () => {
    const s = playPos(['9C', 'AC', '10C'], { bid: 100, bidder: 1, turn: 0, roundPts: [0, 120, 0, 0], tricksTaken: [0, 7, 0, 0], tricksPlayed: 7, scores: [200, 0, 300, 0], bolts: [2, 0, 0, 0] });
    let r = go(s, 0, { type: 'play', card: C('9C') });
    r = go(r.state, 1, { type: 'play', card: C('AC') });
    r = go(r.state, 2, { type: 'play', card: C('10C') });
    const sc = r.events.find((e) => e.type === 'score')!;
    expect(sc.type === 'score' && sc.scores[0]).toBe(80);
    expect(sc.type === 'score' && sc.notes).toContain('bolt3:0');
  });
});

describe('вчетвером и скрытые карты', () => {
  it('сдающий не играет; чужие руки не видны', () => {
    const s = deal(newState(cfgFrom({}), [0, 1, 2, 3]), rng()).state;
    expect(s.players.length).toBe(3);
    expect(s.players).not.toContain(s.dealer);
    expect(s.hands[s.dealer]).toEqual([]);
    const v = makeView(s, [s.players[0]]);
    expect(v.hands[s.players[1]]).toEqual([]);
    expect(v.counts[s.players[1]]).toBe(7);
    expect(v.prikup).toEqual([]);
  });
  it('боты делают допустимые ходы', async () => {
    const s = deal(newState(cfgFrom({}), [0, 1, 2]), rng()).state;
    for (const lv of [0, 1, 2]) {
      const a = (await def.bot.choose(makeView(s, [s.turn]), s.turn, lv, rng())) as Action;
      expect(apply(s, s.turn, a, rng())).not.toBeNull();
    }
  });
});
