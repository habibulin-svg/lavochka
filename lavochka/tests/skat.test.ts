/* Скат: козыри и старшинство, матадоры, ценность игры, торги, скат и снос, перебор, нуль, счёт, боты. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { choose } from '../src/games/skat/ai';
import { def } from '../src/games/skat/def';
import * as sk from '../src/games/skat/engine';
import type { Card, Suit } from '../src/cards/deck';

const C = (t: string): Card => ({ s: t.slice(-1) as Suit, r: ({ J: 11, Q: 12, K: 13, A: 14 } as Record<string, number>)[t.slice(0, -1)] ?? Number(t.slice(0, -1)) });
const L = (t: string) => t.split(/\s+/).filter(Boolean).map(C);
const rng = new SeededRng(1);

describe('Скат', () => {
  it('матадоры и ценность', () => {
    expect(sk.matadors(L('JC JS JH AH'), 'H')).toBe(3);
    expect(sk.matadors(L('JH AH 10H'), 'H')).toBe(-2);
    expect(sk.gameValue({ kind: 'H', hand: false }, L('JC JS JH AH'), { schneider: false, schwarz: false })).toBe(10 * 4);
    expect(sk.gameValue({ kind: 'grand', hand: true }, L('JC JS'), { schneider: true, schwarz: false })).toBe(24 * (2 + 1 + 1 + 1));
    expect(sk.gameValue({ kind: 'null', hand: true, ouvert: true }, [], { schneider: false, schwarz: false })).toBe(59);
  });

  it('валет — козырь, а не своя масть; в масть обязательно', () => {
    const s = sk.newState(sk.cfgFrom({}), [0, 1, 2]);
    Object.assign(s, { phase: 'play', contract: { kind: 'H', hand: false }, hands: [L('AS'), L('JS 9S QH'), L('7C')], trick: [{ seat: 0, card: C('AS') }], turn: 1 });
    expect(sk.legal(s, 1).map((c) => c.s + c.r)).toEqual(['S9']);
    expect(sk.trickWinner([{ seat: 0, card: C('AH') }, { seat: 1, card: C('JD') }], 'H')).toBe(1);
    expect(sk.trickWinner([{ seat: 0, card: C('AS') }, { seat: 1, card: C('10S') }], 'H')).toBe(0);
  });

  it('торги: второй называет первому, третий — победителю', () => {
    let s = sk.setup([0, 1, 2], {}, new SeededRng(2));
    const m = sk.middle(s);
    const f = sk.fore(s);
    expect(s.turn).toBe(m);
    s = sk.apply(s, m, { type: 'bid', n: 18 }, rng)!.state;
    expect(s.turn).toBe(f);
    s = sk.apply(s, f, { type: 'hold' }, rng)!.state;
    s = sk.apply(s, m, { type: 'pass' }, rng)!.state;
    expect(s.asker).toBe(sk.rear(s));
    s = sk.apply(s, s.turn, { type: 'pass' }, rng)!.state;
    expect(s.phase).toBe('skat');
    expect(s.declarer).toBe(f);
    s = sk.apply(s, f, { type: 'skat', take: true }, rng)!.state;
    expect(s.hands[f].length).toBe(12);
    s = sk.apply(s, f, { type: 'discard', cards: s.hands[f].slice(0, 2) }, rng)!.state;
    expect(s.phase).toBe('declare');
  });

  it('перебор: цена меньше заявки — проигрыш', () => {
    const s = sk.newState(sk.cfgFrom({ fabian: false }), [0, 1, 2]);
    Object.assign(s, { phase: 'play', declarer: 0, bid: 48, contract: { kind: 'D', hand: false }, orig: L('JC AD 10D'), put: L('AS 10S'), hands: [L('AD'), L('7C'), L('8C')], trick: [], turn: 0, pts: [100, 0, 0] });
    const r = sk.apply(s, 0, { type: 'play', card: C('AD') }, rng)!;
    const r2 = sk.apply(r.state, 1, { type: 'play', card: C('7C') }, rng)!;
    const r3 = sk.apply(r2.state, 2, { type: 'play', card: C('8C') }, rng)!;
    const h = r3.events.find((e) => e.type === 'hand') as Extract<sk.Event, { type: 'hand' }>;
    expect(h.won).toBe(false);
    // ценность 9 × (1 + 1 + шнайдер 1) = 27 < 48 → наименьшее кратное 9 ≥ 48 = 54, проигрыш −108
    expect(h.add[0]).toBe(-108);
  });

  it('боты доигрывают все пресеты', () => {
    for (const p of def.presets!) {
      const r = new SeededRng(19);
      let s = sk.setup([0, 1, 2], { ...p.options, deals: 6 }, r);
      for (let i = 0; i < 20000 && !s.over; i++) {
        const seat = s.turn;
        const a = choose(def.view(s, [seat]), seat, i % 3, r)!;
        const res = sk.apply(s, seat, a, r);
        expect(res, `${p.id}: ${JSON.stringify(a)} фаза ${s.phase}`).not.toBeNull();
        s = res!.state;
      }
      expect(s.over, p.id).toBe(true);
    }
  }, 300000);
});
