/* Криббедж: подсчёт руки (в том числе 29), очки розыгрыша, «пас», сброс в криб, втроём и парами, боты. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { choose } from '../src/games/cribbage/ai';
import { def } from '../src/games/cribbage/def';
import * as cb from '../src/games/cribbage/engine';
import type { Card, Suit } from '../src/cards/deck';

const C = (t: string): Card => ({ s: t.slice(-1) as Suit, r: ({ J: 11, Q: 12, K: 13, A: 14 } as Record<string, number>)[t.slice(0, -1)] ?? Number(t.slice(0, -1)) });
const L = (t: string) => t.split(/\s+/).filter(Boolean).map(C);
const hand = (h: string, st: string, crib = false) => cb.sumItems(cb.scoreHand(L(h), C(st), crib));
const peg = (cards: string) => {
  const p = L(cards);
  return cb.sumItems(cb.pegScore(p, p.reduce((x, c) => x + cb.pip(c), 0)));
};
const rng = new SeededRng(1);

describe('Криббедж', () => {
  it('подсчёт руки', () => {
    expect(hand('5H 5D 5C JS', '5S')).toBe(29);
    expect(hand('4H 5D 6C 6S', 'KD')).toBe(3 * 2 + 2 + 3 * 2); // 15: 4+5+6 дважды и 5+К; пара шестёрок; 4-5-6 дважды
    expect(hand('AH 3H 5H 7H', '9C')).toBe(4 + 4); // масть 4; 15: 7+5+3 и 9+5+1
    expect(hand('AH 3H 5H 7H', '9C', true)).toBe(4); // в крибе масть из 4 не считается
    expect(hand('AH 3H 5H 7H', '9H', true)).toBe(5 + 2 + 2); // масть 5, 15: 7+5+3, 9+5+1
    expect(hand('JD 2C 4S 8H', '6D')).toBe(1); // только валет «за нос»
  });

  it('очки розыгрыша', () => {
    expect(peg('10S 5H')).toBe(2);
    expect(peg('KS 7H 4D 10C')).toBe(2); // 31
    expect(peg('3H 3S')).toBe(2);
    expect(peg('3H 3S 3D')).toBe(6);
    expect(peg('3H 3S 3D 3C')).toBe(12);
    expect(peg('4H 6S 5D')).toBe(2 + 3); // 15 и последовательность
    expect(peg('2H 9S 3D 4C')).toBe(0); // 9, 3, 4 — не подряд
    expect(peg('2H 4S 3D')).toBe(3);
  });

  it('сброс в криб, стартер, первый ход — сосед сдатчика', () => {
    const s0 = cb.setup([0, 1], {}, new SeededRng(5));
    expect(s0.hands[0].length).toBe(6);
    expect(cb.toAct(s0).sort()).toEqual([0, 1]);
    let s = s0;
    for (const x of [0, 1]) s = cb.apply(s, x, { type: 'discard', cards: s.hands[x].slice(0, 2) }, rng)!.state;
    expect(s.crib.length).toBe(4);
    expect(s.starter).not.toBeNull();
    expect(s.phase).toBe('peg');
    expect(s.turn).toBe(s.dealer === 0 ? 1 : 0);
    const t = cb.setup([0, 1, 2], {}, new SeededRng(5));
    expect(t.hands[0].length).toBe(5);
    expect(t.crib.length).toBe(1);
  });

  it('«пас»: очко последнему положившему, счёт с нуля', () => {
    const s = cb.newState(cb.cfgFrom({}), [0, 1]);
    s.phase = 'peg';
    s.dealer = 1;
    s.hands = [L('KS QS 2H AD'), L('10S JS 9D 8D')];
    s.left = [L('2H'), L('9D')];
    s.pile = [{ seat: 0, card: C('KS') }, { seat: 1, card: C('10S') }];
    s.count = 20;
    s.played = s.pile.slice();
    s.turn = 0;
    s.starter = C('4C');
    // 2: 22; у второго 9 — 31!
    let r = cb.apply(s, 0, { type: 'play', card: C('2H') }, rng)!;
    expect(r.state.turn).toBe(1);
    r = cb.apply(r.state, 1, { type: 'play', card: C('9D') }, rng)!;
    expect(r.events.find((e) => e.type === 'play')).toMatchObject({ count: 31 });
    // 31 — 2 очка, это последняя карта, показ рук и новая сдача
    expect(r.events.some((e) => e.type === 'show')).toBe(true);
    const s2 = cb.newState(cb.cfgFrom({}), [0, 1]);
    Object.assign(s2, { phase: 'peg', dealer: 1, hands: [L('KS 9H'), L('QS 8C')], left: [L('9H'), L('8C')], pile: [{ seat: 0, card: C('KS') }, { seat: 1, card: C('QS') }], count: 20, turn: 0, starter: C('4C') });
    s2.played = s2.pile.slice();
    const r2 = cb.apply(s2, 0, { type: 'play', card: C('9H') }, rng)!;
    // 29: у второго 8 — не лезет, «пас», очко первому, счёт заново, ходит второй
    expect(r2.events.some((e) => e.type === 'go' && e.seat === 1)).toBe(true);
    expect(r2.events.some((e) => e.type === 'goPoint' && e.seat === 0)).toBe(true);
    expect(r2.state.count).toBe(0);
    expect(r2.state.turn).toBe(1);
  });

  it('боты доигрывают партии вдвоём, втроём и парами', () => {
    for (const n of [2, 3, 4]) {
      const r = new SeededRng(20 + n);
      let s = cb.setup(Array.from({ length: n }, (_, i) => i), { target: 61 }, r);
      for (let i = 0; i < 5000 && !s.over; i++) {
        const seat = cb.toAct(s)[0];
        const a = choose(def.view(s, [seat]), seat, i % 3, r)!;
        const res = cb.apply(s, seat, a, r);
        expect(res, `${n}: ${JSON.stringify(a)}`).not.toBeNull();
        s = res!.state;
      }
      expect(s.over).toBe(true);
      if (n === 4) expect(s.score[0]).toBe(s.score[2]);
    }
  });

  it('сложный бот обыгрывает лёгкого', () => {
    let wins = 0;
    for (let g = 0; g < 6; g++) {
      const r = new SeededRng(70 + g);
      let s = cb.setup([0, 1], { target: 121 }, r);
      const lv = g % 2 ? [2, 0] : [0, 2];
      while (!s.over) {
        const seat = cb.toAct(s)[0];
        s = cb.apply(s, seat, choose(def.view(s, [seat]), seat, lv[seat], r)!, r)!.state;
      }
      if (lv[s.winners[0]] === 2) wins++;
    }
    expect(wins).toBeGreaterThanOrEqual(4);
  });
});
