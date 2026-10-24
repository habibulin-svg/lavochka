/* Пинокль: мелды, торги (пас навсегда, сдатчик за 250), прикуп втроём, ход в масть и старше, счёт взяток, заказ не сыгран, боты. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { choose } from '../src/games/pinochle/ai';
import { def } from '../src/games/pinochle/def';
import * as pn from '../src/games/pinochle/engine';
import type { Suit } from '../src/cards/deck';

const C = (t: string, d = 0): pn.PCard => ({ s: t.slice(-1) as Suit, r: ({ J: 11, Q: 12, K: 13, A: 14 } as Record<string, number>)[t.slice(0, -1)] ?? Number(t.slice(0, -1)), d });
const L = (t: string) => t.split(/\s+/).filter(Boolean).map((x) => C(x.replace("'", ''), x.endsWith("'") ? 1 : 0));
const rng = new SeededRng(1);
const sum = (h: pn.PCard[], t: Suit) => pn.meldTotal(h, t);

describe('Пинокль', () => {
  it('мелды', () => {
    expect(sum(L('AH 10H KH QH JH'), 'H')).toBe(150);
    expect(sum(L('KH QH'), 'H')).toBe(40);
    expect(sum(L('KS QS'), 'H')).toBe(20);
    expect(sum(L('QS JD'), 'H')).toBe(40);
    expect(sum(L("QS JD QS' JD'"), 'H')).toBe(300 + 0);
    expect(sum(L('AH AS AD AC'), 'H')).toBe(100);
    expect(sum(L('9H 9H\''), 'H')).toBe(20);
    expect(sum(L('AH 10H KH QH JH 9H QS JD'), 'H')).toBe(150 + 10 + 40);
  });

  it('торги: спасовавший выбывает, все пас — сдатчик за 250', () => {
    let s = pn.setup([0, 1, 2, 3], {}, new SeededRng(3));
    for (let k = 0; k < 3; k++) s = pn.apply(s, s.turn, { type: 'pass' }, rng)!.state; // трое спасовали — сдатчик «застрял»
    expect(s.phase).toBe('trump');
    expect(s.bidder).toBe(s.dealer);
    expect(s.bid).toBe(250);
    let t = pn.setup([0, 1, 2, 3], {}, new SeededRng(3));
    expect(pn.apply(t, t.turn, { type: 'bid', n: 240 }, rng)).toBeNull();
    t = pn.apply(t, t.turn, { type: 'bid', n: 300 }, rng)!.state;
    for (let k = 0; k < 3; k++) t = pn.apply(t, t.turn, { type: 'pass' }, rng)!.state;
    expect(t.phase).toBe('trump');
    expect(t.bid).toBe(300);
  });

  it('втроём: прикуп и закапывание', () => {
    let s = pn.setup([0, 1, 2], {}, new SeededRng(4));
    expect(s.hands[0].length).toBe(15);
    expect(s.widow.length).toBe(3);
    const b = s.turn;
    s = pn.apply(s, b, { type: 'bid', n: 250 }, rng)!.state;
    s = pn.apply(s, s.turn, { type: 'pass' }, rng)!.state;
    s = pn.apply(s, s.turn, { type: 'pass' }, rng)!.state;
    expect(s.hands[b].length).toBe(18);
    s = pn.apply(s, b, { type: 'trump', suit: 'H' }, rng)!.state;
    expect(s.phase).toBe('bury');
    s = pn.apply(s, b, { type: 'bury', cards: s.hands[b].slice(0, 3) }, rng)!.state;
    expect(s.hands[b].length).toBe(15);
    expect(s.phase).toBe('play');
  });

  it('ход: в масть и старше; нет масти — козырем', () => {
    const s = pn.newState(pn.cfgFrom({}), [0, 1, 2, 3]);
    Object.assign(s, { phase: 'play', trump: 'H', hands: [L('KS'), L('9S AS 10H'), L('9C'), L('9D')], trick: [{ seat: 0, card: C('KS') }], turn: 1 });
    expect(pn.legal(s, 1).map((c) => c.r)).toEqual([14]);
    s.hands[1] = L('9C 10H JH');
    expect(pn.legal(s, 1).every((c) => c.s === 'H')).toBe(true);
    // одинаковые: старше первая
    expect(pn.beats(C('AS'), C('AS', 1), 'H')).toBe(false);
  });

  it('боты доигрывают пары и втроём', () => {
    for (const n of [4, 3]) {
      const r = new SeededRng(21 + n);
      let s = pn.setup(Array.from({ length: n }, (_, i) => i), { target: 500 }, r);
      for (let i = 0; i < 20000 && !s.over; i++) {
        const seat = s.turn;
        const a = choose(def.view(s, [seat]), seat, i % 3, r)!;
        const res = pn.apply(s, seat, a, r);
        expect(res, `${n}: ${JSON.stringify(a)} фаза ${s.phase}`).not.toBeNull();
        s = res!.state;
      }
      expect(s.over, String(n)).toBe(true);
    }
  }, 300000);
});
