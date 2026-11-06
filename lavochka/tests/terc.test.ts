/* Терц: очки (150 в сдаче), раздача и колода, свободный ход и разбор фрица (с придержанием валета), комбинации и «Рост», марьяж,
 * обмен семёрки, счёт с округлением, партии ботов. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { makeDeck, type Card, type Suit } from '../src/cards/deck';
import { choose } from '../src/games/terc/ai';
import * as tc from '../src/games/terc/engine';

const C = (t: string): Card => ({ s: t.slice(-1) as Suit, r: ({ J: 11, Q: 12, K: 13, A: 14 } as Record<string, number>)[t.slice(0, -1)] ?? Number(t.slice(0, -1)) });
const L = (t: string) => t.split(/\s+/).filter(Boolean).map(C);
const rng = new SeededRng(1);

function pos(a: string, b: string, trump: Suit, stock: string, trumpCard: string | null, extra: Partial<tc.State> = {}): tc.State {
  const s = tc.newState(tc.cfgFrom({}), [0, 1]);
  s.hands[0] = L(a);
  s.hands[1] = L(b);
  s.trump = trump;
  s.stock = L(stock);
  s.trumpCard = trumpCard ? C(trumpCard) : null;
  s.deal = 1;
  return Object.assign(s, extra);
}

describe('Терц', () => {
  it('очки карт — 140 и последняя взятка 10', () => {
    expect(makeDeck(32).reduce((x, c) => x + tc.points(c, 'H'), 0)).toBe(140);
  });

  it('раздача: по 9, козырь — масть открытой, в колоде 13 и козырь', () => {
    const s = tc.setup([0, 1], {}, new SeededRng(3));
    expect(s.hands[0].length).toBe(9);
    expect(s.hands[1].length).toBe(9);
    expect(s.stock.length).toBe(13);
    expect(s.trump).toBe(s.trumpCard!.s);
    expect(s.turn).not.toBe(s.dealer);
  });

  it('пока есть колода — любой картой; разбор — в масть и перебить, валета козыря можно придержать', () => {
    let s = pos('AS 10S', '7S KS 7H', 'H', '8C', null, { trick: [{ seat: 0, card: C('QS') }], turn: 1 });
    expect(tc.legal(s, 1).length).toBe(3);
    s = pos('AS', 'KS 7S AH', 'H', '', null, { trick: [{ seat: 0, card: C('QS') }], turn: 1 });
    expect(tc.legal(s, 1).map((c) => c.r)).toEqual([13]);
    s = pos('AS', 'JH 7D', 'H', '', null, { trick: [{ seat: 0, card: C('QS') }], turn: 1 });
    expect(tc.legal(s, 1).length).toBe(2); // нет пик: козырем, но валет — по желанию
    s = pos('AS', 'JH 9H 7D', 'H', '', null, { trick: [{ seat: 0, card: C('QS') }], turn: 1 });
    expect(tc.legal(s, 1).map((c) => c.r).sort()).toEqual([11, 9].sort());
  });

  it('взятка и добор: взявший берёт первым, козырь — последним, после — разбор фрица', () => {
    let s = pos('AS 7C', '7S 8C', 'H', '9C', '10H');
    let r = tc.apply(s, 0, { type: 'play', card: C('AS') }, rng)!;
    r = tc.apply(r.state, 1, { type: 'play', card: C('7S') }, rng)!;
    s = r.state;
    expect(s.tricks[0]).toBe(1);
    expect(s.hands[0].some((c) => c.r === 9 && c.s === 'C')).toBe(true);
    expect(s.hands[1].some((c) => c.r === 10 && c.s === 'H')).toBe(true);
    expect(r.events.some((e) => e.type === 'break')).toBe(true);
    expect(r.events.some((e) => e.type === 'fritz')).toBe(true);
  });

  it('комбинации и «Рост»: полтинник бьёт терц, перебитая сгорает', () => {
    const s = pos('7S 8S 9S AC KC QC 7D 8D 10H', '10D JD QD KD 7C 8C 9H 8H 7H', 'H', '9C 9D', 'AH');
    const cs = tc.available(s, 0);
    const terc = cs.find((c) => c.suit === 'S')!;
    expect(terc.pts).toBe(20);
    let r = tc.apply(s, 0, { type: 'declare', combo: terc }, rng)!;
    expect(r.state.phase).toBe('answer');
    expect(tc.rostCombo(r.state, 1)!.pts).toBe(50);
    r = tc.apply(r.state, 1, { type: 'answer', rost: true }, rng)!;
    expect(r.state.score[1]).toBe(50);
    expect(r.state.score[0]).toBe(0);
    expect(r.state.turn).toBe(0);
    // одна комбинация за заход
    expect(tc.canDeclare(r.state, 0)).toBe(false);
    // четыре одинаковых — только после ломки
    const f = pos('AS AC AD AH 7S 8D 9C 10D JS', '7C 8C 9H 8H 7H QS KS QH KH', 'H', '9D', 'QD');
    expect(tc.available(f, 0).some((c) => c.kind === 'four')).toBe(false);
    expect(tc.available({ ...f, broken: true }, 0).find((c) => c.kind === 'four')!.pts).toBe(100);
  });

  it('марьяж +20, обмен семёрки', () => {
    let s = pos('KH QH 7H AS 10S 8C 9C 10D JD', 'AH KS QS 7D 10C JC 9D 8D QC', 'H', '7C 8C 9S', '10H');
    let r = tc.apply(s, 0, { type: 'swap' }, rng)!;
    expect(r.state.trumpCard).toEqual(C('7H'));
    r = tc.apply(r.state, 0, { type: 'marriage' }, rng)!;
    expect(r.state.score[0]).toBe(20);
    expect(tc.canMarriage(r.state, 0)).toBe(false);
    s = pos('7H AS', 'AH KS', 'H', '7C', '10H');
    expect(tc.canSwap(s, 0)).toBe(false);
  });

  it('округление до десятков: 25 → 20, 26 → 30', () => {
    expect(tc.round10(25)).toBe(20);
    expect(tc.round10(26)).toBe(30);
    expect(tc.round10(150)).toBe(150);
  });

  it('боты всех уровней доигрывают партию; в сдаче 150 очков взяток', () => {
    for (const [lv, seed, opts] of [[0, 1, {}], [1, 2, { target: 301 }], [2, 3, { target: 301 }], [1, 4, { multi: true, round: false }]] as const) {
      const r = new SeededRng(seed);
      let s = tc.setup([0, 1], opts, r);
      let guard = 0;
      while (!s.over && guard++ < 6000) {
        const seat = s.turn;
        const a = choose(tc.makeView(s, [seat]), seat, seat === 0 ? lv : 1, r)!;
        const res = tc.apply(s, seat, a, r);
        expect(res, `${lv} ${JSON.stringify(a)}`).not.toBeNull();
        for (const e of res!.events) if (e.type === 'hand') expect(e.pts[0] + e.pts[1]).toBe(150);
        s = res!.state;
      }
      expect(s.over).toBe(true);
    }
  });
});
