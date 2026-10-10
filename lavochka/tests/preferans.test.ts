/* Преферанс: старшинство ставок, мизер первым словом, распасы с прикупом, вист в светлую, запись (пуля, гора, висты, консоляция, помощь), итог — сумма ноль;
 * соглашения (полвиста, Сталинград, ответственность, жлобский/джентльменский, выход, переход сдачи, прогрессия) и записи (Ленинград, Ростов, Классика, Скачки). */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import type { Card, Suit } from '../src/cards/deck';
import { def } from '../src/games/preferans/def';
import type { Options } from '../src/core/types';
import { apply, bidRank, cfgFrom, deal, finalScores, makeView, minLevel, newState, prikupUnits, toAct, trickWinner, type Action, type State } from '../src/games/preferans/engine';

const rng = () => new SeededRng(6);
const C = (t: string): Card => ({ s: t.slice(-1) as Suit, r: ({ J: 11, Q: 12, K: 13, A: 14 } as Record<string, number>)[t.slice(0, -1)] ?? Number(t.slice(0, -1)) });
const L = (t: string) => t.split(/\s+/).filter(Boolean).map(C);
const HANDS = ['AS KS QS JS 10S 9S AH KH 7C 7D', '8S 7S AC KC QC JC 10C 9C 8C AD', 'KD QD JD 10D 9D 8D QH JH 10H 9H'];

function pos(extra: Partial<State> = {}, hands = HANDS, prikup = '8H 7H', opts: Options = {}): State {
  const s = newState(cfgFrom(opts), [0, 1, 2]);
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
    let s = pos({ phase: 'whist', kind: 'game', bid: { level: 7, trump: 'S' }, contract: { level: 7, trump: 'S' }, declarer: 0, trump: 'S', turn: 1, wstep: 'd1' }, ['AS KS QS JS 10S 9S AH KH 8H 7H', HANDS[1], HANDS[2]]);
    s = go(s, 1, { type: 'whist' }).state;
    s = go(s, 2, { type: 'pass-whist' }).state;
    expect(s.wstep).toBe('choose');
    expect(s.turn).toBe(1);
    s = go(s, 1, { type: 'show', open: true }).state;
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

describe('соглашения', () => {
  /** Последняя взятка кона: заказ 6♠ у Вовки, вистуют как задано. */
  function last(extra: Partial<State>, opts: Options = {}): State {
    return pos({ phase: 'play', kind: 'game', declarer: 0, trump: 'S', contract: { level: 6, trump: 'S' }, bid: { level: 6, trump: 'S' }, whist: { 1: 'whist', 2: 'whist' }, whistOrder: [1, 2], tricksPlayed: 9, ...extra }, ['AS', '7C', '7D'], '', opts);
  }
  const finish = (s: State) => {
    let r = go(s, toAct(s)[0], { type: 'play', card: C('AS') });
    r = go(r.state, toAct(r.state)[0], { type: 'play', card: C('7C') });
    r = go(r.state, toAct(r.state)[0], { type: 'play', card: C('7D') });
    return r;
  };
  const score = (r: ReturnType<typeof go>) => {
    const e = r.events.find((x) => x.type === 'score');
    if (!e || e.type !== 'score') throw new Error('нет записи');
    return e;
  };
  const whistPos = (contract: { level: number; trump: 'S' | 'C' | 'D' | 'H' | 'NT' }, opts: Options = {}) =>
    pos({ phase: 'whist', kind: 'game', bid: contract, contract, declarer: 0, trump: contract.trump, turn: 1, wstep: 'd1' }, HANDS, '8H 7H', opts);

  it('полвиста: игра сыграна, ушедший пишет половину обязательных взяток', () => {
    let s = whistPos({ level: 6, trump: 'S' });
    s = go(s, 1, { type: 'pass-whist' }).state;
    s = go(s, 2, { type: 'half-whist' }).state;
    expect(s.wstep).toBe('return');
    const sc = score(go(s, 1, { type: 'pass-whist' }));
    expect(sc.kind).toBe('half');
    expect(sc.pulya[0]).toBe(2);
    expect(sc.whists[2][0]).toBe(4); // 2 взятки × 2
  });
  it('возврат виста: вернувший играет один, ушедший за полвиста — пас', () => {
    let s = whistPos({ level: 7, trump: 'S' });
    s = go(s, 1, { type: 'pass-whist' }).state;
    s = go(s, 2, { type: 'half-whist' }).state;
    s = go(s, 1, { type: 'whist' }).state;
    expect(s.whist).toEqual({ 1: 'whist', 2: 'pass' });
    expect(s.wstep).toBe('choose');
    s = go(s, 1, { type: 'show', open: false }).state;
    expect(s.phase).toBe('play');
    expect(s.open).toBeNull();
  });
  it('полвиста — только на 6 и 7 и только после паса первого', () => {
    let s = whistPos({ level: 8, trump: 'S' });
    s = go(s, 1, { type: 'pass-whist' }).state;
    expect(apply(s, 2, { type: 'half-whist' }, rng())).toBeNull();
    s = whistPos({ level: 6, trump: 'S' });
    s = go(s, 1, { type: 'whist' }).state;
    expect(apply(s, 2, { type: 'half-whist' }, rng())).toBeNull();
    s = whistPos({ level: 6, trump: 'S' }, { halfWhist: false });
    s = go(s, 1, { type: 'pass-whist' }).state;
    expect(apply(s, 2, { type: 'half-whist' }, rng())).toBeNull();
  });
  it('Сталинград: на 6♠ вистуют оба сразу', () => {
    let s = pos({ phase: 'contract', kind: 'game', bid: { level: 6, trump: 'S' }, declarer: 0, turn: 0 }, ['AS KS QS JS 10S 9S AH KH', HANDS[1], HANDS[2]], '', { stalingrad: true });
    s = go(s, 0, { type: 'contract', bid: { level: 6, trump: 'S' } }).state;
    expect(s.phase).toBe('play');
    expect(s.whist).toEqual({ 1: 'whist', 2: 'whist' });
  });
  it('десятерная проверяется: играют в открытую, без виста', () => {
    let s = pos({ phase: 'contract', kind: 'game', bid: { level: 10, trump: 'S' }, declarer: 0, turn: 0 }, ['AS KS QS JS 10S 9S AH KH', HANDS[1], HANDS[2]], '', { ten: 'check' });
    s = go(s, 0, { type: 'contract', bid: { level: 10, trump: 'S' } }).state;
    expect(s.check).toBe(true);
    expect(makeView(s, [0]).hands[1].length).toBe(10);
  });
  it('ответственный и полуответственный недовист; вдвоём на шестерной — каждый за половину', () => {
    // по Кодексу: вистующие взяли 1 и 0 при обязательных 4 — первый без одной, второй без двух
    let sc = score(finish(last({ tricks: [8, 1, 0, 0] })));
    expect([sc.gora[1], sc.gora[2]]).toEqual([2, 4]);
    sc = score(finish(last({ tricks: [8, 1, 0, 0] }, { resp: 'half' })));
    expect([sc.gora[1], sc.gora[2]]).toEqual([1, 2]);
    // на восьмерной отвечает завистовавший вторым
    sc = score(finish(last({ tricks: [9, 0, 0, 0], contract: { level: 8, trump: 'S' }, bid: { level: 8, trump: 'S' }, whistOrder: [2, 1] })));
    expect([sc.gora[1], sc.gora[2]]).toEqual([6, 0]);
  });
  it('жлобский и джентльменский вист при подсаде', () => {
    const one = { whist: { 1: 'whist' as const, 2: 'pass' as const }, whistOrder: [1], open: 2 };
    let sc = score(finish(last({ ...one, tricks: [4, 3, 2, 0] })));
    expect([sc.whists[1][0], sc.whists[2][0]]).toEqual([10 + 2, 2]); // 5 взяток × 2 + консоляция; пасовавшему — только консоляция
    sc = score(finish(last({ ...one, tricks: [4, 3, 2, 0] }, { whistStyle: 'gentle' })));
    expect([sc.whists[1][0], sc.whists[2][0]]).toEqual([5 + 2, 5 + 2]);
  });
  it('Ленинград: висты вдвое, без помощи — перебор пули в итоге списывает гору', () => {
    const sc = score(finish(last({ tricks: [5, 3, 1, 0], pulya: [9, 4, 0, 0] }, { variant: 'leningrad' })));
    expect(sc.pulya[0]).toBe(11);
    expect(sc.whists[1][0]).toBe(12);
    const f = finalScores({ seats: [0, 1, 2], gora: [0, 0, 0, 0], whists: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], pulya: [12, 10, 8, 0], cfg: cfgFrom({ variant: 'leningrad' }) });
    expect(f[0]).toBeGreaterThan(0);
    expect(f[2]).toBeLessThan(0);
    expect(f[0] + f[1] + f[2]).toBe(0);
  });
  it('Ростов: распасы на висты — взявший меньше всех пишет по 5 за взятку', () => {
    let s = pos({}, HANDS, '8H 7H', { variant: 'rostov' });
    s = go(s, 0, { type: 'pass' }).state;
    s = go(s, 1, { type: 'pass' }).state;
    s = go(s, 2, { type: 'pass' }).state;
    expect(s.trick).toBeNull(); // прикуп не участвует
    s = { ...s, hands: [L('AS'), L('7C'), L('7D'), []], tricks: [5, 4, 0, 0], tricksPlayed: 9 };
    const sc = score(finish(s));
    expect(sc.whists[2][0]).toBe(30); // 6 взяток × 5
    expect(sc.whists[2][1]).toBe(20);
    expect(sc.pulya[2]).toBe(1);
  });
  it('выход из распасов: 6-7-8-8, по кругу и пас втёмную', () => {
    const c = cfgFrom({ exit: '6788' });
    expect([0, 1, 2, 3, 5].map((k) => minLevel({ cfg: c, raspasyRun: k, darkSeat: null, darkRun: 0 }))).toEqual([6, 7, 8, 8, 8]);
    const c2 = cfgFrom({ exit: '678678' });
    expect([1, 2, 3, 4].map((k) => minLevel({ cfg: c2, raspasyRun: k, darkSeat: null, darkRun: 0 }))).toEqual([7, 8, 6, 7]);
    expect(minLevel({ cfg: cfgFrom({}), raspasyRun: 0, darkSeat: 0, darkRun: 0 })).toBe(7);
    let s = pos({ raspasyRun: 1 }, HANDS, '8H 7H', { exit: '677' });
    expect(apply(s, 0, { type: 'bid', bid: { level: 6, trump: 'NT' } }, rng())).toBeNull();
    s = go(s, 0, { type: 'bid', bid: { level: 7, trump: 'S' } }).state;
  });
  it('выход подсадом: без него несыгранная игра оставляет распасы', () => {
    const run = (exitByFail: boolean) => finish(last({ tricks: [3, 4, 2, 0], raspasyRun: 2 }, { exitByFail })).state.raspasyRun;
    expect(run(true)).toBe(0);
    expect(run(false)).toBe(2);
  });
  it('переход сдачи: без него после распасов сдаёт тот же', () => {
    const run = (slide: boolean) => {
      const s = pos({}, HANDS, '8H 7H', { slide });
      return finish({ ...s, kind: 'raspasy', phase: 'play', trick: null, hands: [L('AS'), L('7C'), L('7D'), []], tricks: [5, 4, 0, 0], tricksPlayed: 9 }).state.dealer;
    };
    expect(run(true)).toBe(0);
    expect(run(false)).toBe(2);
  });
  it('прогрессия распасов 1-2-3', () => {
    const s = pos({ raspasyRun: 1 }, HANDS, '8H 7H', { prog: 'arith' });
    const sc = score(finish({ ...s, kind: 'raspasy', phase: 'play', trick: null, hands: [L('AS'), L('7C'), L('7D'), []], tricks: [5, 4, 0, 0], tricksPlayed: 9 }));
    expect(sc.gora[0]).toBe(12);
    expect(sc.pulya[2]).toBe(2);
  });
  it('сдать без трёх: гора за три на ставке, вистов нет', () => {
    const s = pos({ phase: 'contract', kind: 'game', bid: { level: 7, trump: 'H' }, declarer: 0, turn: 0 }, ['AS KS QS JS 10S 9S AH KH', HANDS[1], HANDS[2]], '', { concede: 3 });
    const sc = score(go(s, 0, { type: 'concede' }));
    expect(sc.kind).toBe('concede');
    expect(sc.gora[0]).toBe(12);
    expect(sc.whists[1][0]).toBe(0);
    expect(apply(pos({ phase: 'contract', kind: 'game', bid: { level: 7, trump: 'H' }, declarer: 0, turn: 0 }), 0, { type: 'concede' }, rng())).toBeNull();
  });
  it('платный прикуп: туз — 1, туз с королём — 2, два туза — 3, марьяж — 1', () => {
    expect(prikupUnits(L('AS 7H'))).toBe(1);
    expect(prikupUnits(L('AS KS'))).toBe(2);
    expect(prikupUnits(L('AS AH'))).toBe(3);
    expect(prikupUnits(L('KH QH'))).toBe(1);
    expect(prikupUnits(L('KH QS'))).toBe(0);
    const sc = score(finish(last({ tricks: [5, 3, 1, 0], prikup: L('AH KH') }, { paidPrikup: true })));
    expect(sc.whists[2][0]).toBe(2 + 2 * 2); // сдающий Серёга: висты за взятку + платный прикуп
  });
  it('Классика: обязательные распасы дают бомбы, бомба удваивает игру', () => {
    const s = deal(newState(cfgFrom({ variant: 'classic' }), [0, 1, 2]), rng()).state;
    expect(s.kind).toBe('raspasy');
    expect(s.forced).toBe(true);
    const sc = score(finish(last({ tricks: [5, 3, 1, 0], bombs: [[2], [], [], []] }, { variant: 'classic', opening: 0 })));
    expect(sc.pulya[0]).toBe(4);
    expect(sc.whists[1][0]).toBe(12);
    expect(sc.mult).toBe(2);
  });
  it('Классика: пас втёмную — свои карты не видны, перебить можно семерной', () => {
    let s = pos({ phase: 'dark' }, HANDS, '8H 7H', { variant: 'classic', opening: 0 });
    expect(makeView(s, [0]).hands[0]).toEqual([]);
    s = go(s, 0, { type: 'dark-pass' }).state;
    expect(s.passed).toEqual([0]);
    expect(apply(s, 1, { type: 'bid', bid: { level: 6, trump: 'C' } }, rng())).toBeNull();
    s = go(s, 1, { type: 'bid', bid: { level: 7, trump: 'S' } }).state;
  });
  it('Скачки: первая сдача — распасы по 2', () => {
    const s = deal(newState(cfgFrom({ variant: 'skachki' }), [0, 1, 2]), rng()).state;
    expect(s.kind).toBe('raspasy');
    const sc = score(finish({ ...s, hands: [L('AS'), L('7C'), L('7D'), []], trick: null, tricks: [5, 4, 0, 0], tricksPlayed: 9 }));
    expect(sc.gora[0]).toBe(12);
    expect(sc.pulya[2]).toBe(2);
  });
  it('Скачки: скак кончается набором 22, призы 300 и 200', () => {
    const s = last({ tricks: [5, 3, 1, 0], pulya: [20, 4, 0, 0], gora: [3, 0, 5, 0] }, { variant: 'skachki' });
    const r = finish(s);
    const sk = r.events.find((e) => e.type === 'skak');
    expect(sk && sk.type === 'skak' && sk.first).toEqual([0]);
    expect(sk && sk.type === 'skak' && sk.lowGora).toEqual([1]);
    expect(r.state.skak).toBe(2);
    expect(r.state.whists[0][1]).toBe(300);
    expect(r.state.whists[1][2]).toBe(200);
    expect(r.state.totPulya[0]).toBe(22);
  });
});
