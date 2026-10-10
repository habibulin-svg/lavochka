/* Тысяча: взятки, марьяжи (и тузовый), торговля, тёмная, прикуп, роспись, пересдачи, подсчёт (бочка, болты, самосвал ±555, золотой кон), вчетвером, скрытые карты. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import type { Card, Suit } from '../src/cards/deck';
import { def } from '../src/games/thousand/def';
import { apply, cfgFrom, deal, legalCards, makeView, maxBid, newState, round5, trickWinner, type Action, type State } from '../src/games/thousand/engine';
import type { Options } from '../src/core/types';

const rng = () => new SeededRng(5);
const C = (t: string): Card => ({ s: t.slice(-1) as Suit, r: ({ J: 11, Q: 12, K: 13, A: 14 } as Record<string, number>)[t.slice(0, -1)] ?? Number(t.slice(0, -1)) });
const L = (t: string) => t.split(/\s+/).filter(Boolean).map(C);

function playPos(hands: string[], extra: Partial<State> = {}, opts: Options = {}): State {
  const s = newState(cfgFrom(opts), [0, 1, 2]);
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
    expect(s.phase).toBe('dark');
    s = go(s, s.turn, { type: 'light' }).state;
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

/** Доиграть последнюю взятку (у каждого по карте, по местам) и вернуть итог кона. */
function lastTrick(s: State, cards: [string, string, string]) {
  let r = go(s, s.turn, { type: 'play', card: C(cards[s.turn]) });
  r = go(r.state, r.state.turn, { type: 'play', card: C(cards[r.state.turn]) });
  r = go(r.state, r.state.turn, { type: 'play', card: C(cards[r.state.turn]) });
  const sc = r.events.find((e) => e.type === 'score');
  if (!sc || sc.type !== 'score') throw new Error('нет подсчёта');
  return { r, sc };
}

describe('тёмная', () => {
  it('первая рука не видит карт; темню — 120; перебить только марьяжем', () => {
    let s = deal(newState(cfgFrom({}), [0, 1, 2]), rng()).state;
    const first = s.first;
    expect(s.phase).toBe('dark');
    expect(makeView(s, [first]).hands[first]).toEqual([]);
    expect(makeView(s, [first]).counts[first]).toBe(7);
    s = go(s, first, { type: 'dark' }).state;
    expect(s.dark).toBe(true);
    expect(s.bid).toBe(120);
    expect(makeView(s, [first]).hands[first]).toEqual([]);
    const other = s.turn;
    expect(apply(s, other, { type: 'bid', value: 125 }, rng()) != null).toBe(maxBid(s.hands[other]) >= 125);
  });
  it('нельзя темнить в минусе и когда кто-то на бочке', () => {
    const a = newState(cfgFrom({}), [0, 1, 2]);
    a.scores = [-50, 0, 0, 0];
    a.round = 1;
    a.dealer = 1; // сдаёт Серёга, первая рука — Вовка
    expect(deal(a, rng()).state.first).toBe(0);
    expect(deal(a, rng()).state.phase).toBe('bid');
    const b = newState(cfgFrom({}), [0, 1, 2]);
    b.barrel = [0, 1, 0, 0];
    b.scores = [0, 880, 0, 0];
    expect(deal(b, rng()).state.phase).toBe('bid');
  });
  it('сыграл втёмную — +240, не сыграл — −240', () => {
    const won = lastTrick(playPos(['AC', '9C', '10C'], { bid: 120, dark: true, roundPts: [100, 0, 0, 0], tricksTaken: [6, 1, 1, 0], tricksPlayed: 6 }), ['AC', '9C', '10C']);
    expect(won.sc.deltas[0]).toBe(240);
    const lost = lastTrick(playPos(['9C', 'AC', '10C'], { bid: 120, dark: true, roundPts: [60, 30, 0, 0], tricksTaken: [3, 2, 1, 0], tricksPlayed: 6 }), ['9C', 'AC', '10C']);
    expect(lost.sc.deltas[0]).toBe(-240);
  });
});

describe('роспись и пересдача', () => {
  const givePos = (opts: Options, prikup: string) => {
    const s = playPos(['9S JC 10D 9C QC JH 9H QD JD 9D', 'AS 10S KS AH JS AD 10H', 'QS KH AC 10C KC QH KD'], { phase: 'give', bid: 110, shown: true }, opts);
    s.prikup = L(prikup);
    return s;
  };
  it('роспись: себе минус заказ, соперникам по 60 (или по половине)', () => {
    for (const [mode, pay] of [['60', 60], ['half', 55]] as const) {
      let s = givePos({ rospis: mode }, 'QD JD 9D');
      s = go(s, 0, { type: 'give', to: 1, card: C('9S') }).state;
      s = go(s, 0, { type: 'give', to: 2, card: C('9C') }).state;
      const r = go(s, 0, { type: 'rospis' });
      const sc = r.events.find((e) => e.type === 'score')!;
      expect(sc.type === 'score' && sc.deltas.slice(0, 3)).toEqual([-110, pay, pay]);
    }
  });
  it('без росписи и на бочке — нельзя', () => {
    let s = givePos({ rospis: 'off' }, 'QD JD 9D');
    s = go(s, 0, { type: 'give', to: 1, card: C('9S') }).state;
    s = go(s, 0, { type: 'give', to: 2, card: C('9C') }).state;
    expect(apply(s, 0, { type: 'rospis' }, rng())).toBeNull();
    s = { ...s, cfg: cfgFrom({}), barrel: [1, 0, 0, 0], scores: [880, 0, 0, 0] };
    expect(apply(s, 0, { type: 'rospis' }, rng())).toBeNull();
  });
  it('пересдача по прикупу — по выбору заказчика, пока не отдал карт', () => {
    expect(apply(givePos({}, 'QD JD 10D'), 0, { type: 'redeal' }, rng())).toBeNull();
    const r = go(givePos({}, '9D 9H AD'), 0, { type: 'redeal' });
    expect(r.events[0]).toMatchObject({ type: 'redeal', reason: 'prikup9' });
    expect(r.state.round).toBe(1);
    expect(r.state.dealer).toBe(2);
    expect(r.state.scores).toEqual([0, 0, 0, 0]);
    expect(go(givePos({ redealPrikup9: false }, 'JD 9D 9H'), 0, { type: 'redeal' }).events[0]).toMatchObject({ reason: 'prikupLow' });
    expect(apply(givePos({ redealPrikup9: false, redealPrikupMin: 0 }, 'JD 9D 9H'), 0, { type: 'redeal' }, rng())).toBeNull();
    const given = go(givePos({}, '9D 9H AD'), 0, { type: 'give', to: 1, card: C('9S') }).state;
    expect(apply(given, 0, { type: 'redeal' }, rng())).toBeNull();
  });
  it('каждая третья роспись — ещё минус 120, счёт росписей заново', () => {
    const third = (opts: Options) => {
      let s = { ...givePos(opts, 'QD JD 9D'), rospisN: [2, 0, 0, 0] };
      s = go(s, 0, { type: 'give', to: 1, card: C('9S') }).state;
      s = go(s, 0, { type: 'give', to: 2, card: C('9C') }).state;
      return go(s, 0, { type: 'rospis' });
    };
    const r = third({});
    const sc = r.events.find((e) => e.type === 'score')!;
    expect(sc.type === 'score' && sc.deltas.slice(0, 3)).toEqual([-230, 60, 60]);
    expect(sc.type === 'score' && sc.notes).toContain('rospis3:0');
    expect(r.state.rospisN[0]).toBe(0);
    const off = third({ rospis3: false }).events.find((e) => e.type === 'score')!;
    expect(off.type === 'score' && off.deltas[0]).toBe(-110);
  });
  it('три пересдачи подряд — сдающему минус 120', () => {
    const first = go(givePos({}, '9D 9H AD'), 0, { type: 'redeal' });
    expect(first.events.some((e) => e.type === 'fine')).toBe(false);
    expect(first.state.redeals).toBeGreaterThanOrEqual(1);
    const third = go({ ...givePos({}, '9D 9H AD'), redeals: 2 }, 0, { type: 'redeal' });
    expect(third.events.find((e) => e.type === 'fine')).toMatchObject({ seat: 2, amount: -120 });
    expect(third.state.scores[2]).toBe(-120);
    expect(third.state.sheet[third.state.sheet.length - 1]).toMatchObject({ tag: 'fine', bidder: 2 });
    const off = go({ ...givePos({ redeal3: false }, '9D 9H AD'), redeals: 2 }, 0, { type: 'redeal' });
    expect(off.events.some((e) => e.type === 'fine')).toBe(false);
    expect(off.state.scores[2]).toBe(0);
  });
  it('четыре девятки на руке — пересдают сами', () => {
    for (let seed = 1; seed < 400; seed++) {
      const s = deal(newState(cfgFrom({}), [0, 1, 2]), new SeededRng(seed)).state;
      for (const p of s.players) expect(s.hands[p].filter((c) => c.r === 9).length).toBeLessThan(4);
    }
  });
});

describe('договорённости подсчёта', () => {
  it('самосвал: 555 и −555 — в ноль', () => {
    const plus = lastTrick(playPos(['AC', '9C', '10C'], { bid: 120, scores: [435, 0, 0, 0], roundPts: [100, 0, 0, 0], tricksTaken: [6, 1, 1, 0], tricksPlayed: 6 }), ['AC', '9C', '10C']);
    expect(plus.sc.scores[0]).toBe(0);
    const lost = (opts: Options) => lastTrick(playPos(['9C', 'AC', '10C'], { bid: 120, scores: [-435, 0, 0, 0], roundPts: [60, 30, 0, 0], tricksTaken: [3, 2, 1, 0], tricksPlayed: 6 }, opts), ['9C', 'AC', '10C']);
    expect(lost({}).sc.scores[0]).toBe(0);
    expect(lost({ dump: 'plus' }).sc.scores[0]).toBe(-555);
  });
  it('болты: три подряд — взятка обнуляет счётчик; каждый пятый', () => {
    const row = lastTrick(playPos(['AC', '9C', '10C'], { bid: 100, bidder: 1, roundPts: [20, 100, 0, 0], tricksTaken: [1, 6, 0, 0], tricksPlayed: 7, bolts: [2, 0, 0, 0] }, { bolts: '3row' }), ['AC', '9C', '10C']);
    expect(row.r.state.bolts[0]).toBe(0);
    const five = lastTrick(playPos(['9C', 'AC', '10C'], { bid: 100, bidder: 1, roundPts: [0, 120, 0, 0], tricksTaken: [0, 7, 0, 0], tricksPlayed: 7, bolts: [3, 0, 0, 0], scores: [200, 0, 0, 0] }, { bolts: '5' }), ['9C', 'AC', '10C']);
    expect(five.sc.scores[0]).toBe(200);
    expect(five.r.state.bolts[0]).toBe(4);
  });
  it('на бочке болтов не пишут; трижды слетел — в ноль', () => {
    const s = playPos(['9C', 'AC', '10C'], { bid: 100, bidder: 1, roundPts: [0, 120, 0, 0], tricksTaken: [0, 7, 0, 0], tricksPlayed: 7, scores: [880, 0, 0, 0], barrel: [3, 0, 0, 0], falls: [2, 0, 0, 0] });
    const { sc, r } = lastTrick(s, ['9C', 'AC', '10C']);
    expect(sc.notes).not.toContain('bolt:0');
    expect(sc.notes).toContain('zero:0');
    expect(r.state.scores[0]).toBe(0);
  });
  it('выход с бочки до 1001: 120 мало', () => {
    const s = playPos(['AC', '9C', '10C'], { bid: 120, scores: [880, 0, 0, 0], barrel: [1, 0, 0, 0], roundPts: [100, 0, 0, 0], tricksTaken: [6, 1, 1, 0], tricksPlayed: 6 }, { goal: 1001 });
    const { r } = lastTrick(s, ['AC', '9C', '10C']);
    expect(r.state.phase).not.toBe('over');
    expect(r.state.scores[0]).toBe(880);
  });
});

describe('марьяжи по договорённости и золотой кон', () => {
  it('тузовый марьяж: 200, козырь не меняется; без настройки — нельзя', () => {
    const hands = ['AH AS AD AC 9H', '9S 10S JS 9D 10D', 'JH 10H KS QS 10C'];
    let s = playPos(hands, { tricksPlayed: 1 }, { aces: true });
    expect(maxBid(s.hands[0], true)).toBe(320);
    s = go(s, 0, { type: 'play', card: C('AS'), marriage: true }).state;
    expect(s.roundPts[0]).toBe(200);
    expect(s.trump).toBeNull();
    expect(apply(playPos(hands, { tricksPlayed: 1 }), 0, { type: 'play', card: C('AS'), marriage: true }, rng())).toBeNull();
  });
  it('марьяж с первого хода — по настройке', () => {
    const hands = ['KH QH AS 9C', '9H 10S JS 9D', 'JH KS QS 10D'];
    expect(apply(playPos(hands), 0, { type: 'play', card: C('QH'), marriage: true }, rng())).toBeNull();
    expect(apply(playPos(hands, {}, { firstMarriage: true }), 0, { type: 'play', card: C('QH'), marriage: true }, rng())).not.toBeNull();
  });
  it('золотой кон: без торговли на 120, очки вдвойне', () => {
    const s = deal(newState(cfgFrom({ golden: true }), [0, 1, 2]), rng()).state;
    expect(s.golden).toBe(true);
    expect(s.phase).toBe('give');
    expect(s.bid).toBe(120);
    expect(s.bidder).toBe(s.first);
    const won = lastTrick(playPos(['AC', '9C', '10C'], { bid: 120, golden: true, roundPts: [100, 22, 10, 0], tricksTaken: [6, 1, 1, 0], tricksPlayed: 6 }), ['AC', '9C', '10C']);
    expect(won.sc.deltas.slice(0, 3)).toEqual([240, 40, 20]);
  });
});
