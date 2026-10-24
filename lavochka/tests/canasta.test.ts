/* Канаста: комбинации и дикие, красные и чёрные тройки, первая выкладка, взятие сброса, выход только с канастой, счёт, боты. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { choose } from '../src/games/canasta/ai';
import { def } from '../src/games/canasta/def';
import * as cn from '../src/games/canasta/engine';
import type { Suit } from '../src/cards/deck';

const C = (t: string, d = 0): cn.CCard => (t === 'JK' ? { s: 'H', r: 15, d } : { s: t.slice(-1) as Suit, r: ({ J: 11, Q: 12, K: 13, A: 14 } as Record<string, number>)[t.slice(0, -1)] ?? Number(t.slice(0, -1)), d });
const L = (t: string) => t.split(/\s+/).filter(Boolean).map((x) => C(x.replace("'", ''), x.endsWith("'") ? 1 : 0));
const rng = new SeededRng(1);
function pos(hands: string[], pile: string, extra: Partial<cn.State> = {}) {
  const s = cn.newState(cn.cfgFrom({}), [0, 1]);
  hands.forEach((h, i) => (s.hands[i] = L(h)));
  s.stock = L("4C' 5C' 6C' 7C' 8C' 9C' 10C' JC' QC' KC'");
  s.pile = L(pile);
  s.turn = 0;
  s.phase = 'draw';
  return Object.assign(s, extra);
}

describe('Канаста', () => {
  it('комбинации: натуральных больше диких, тройки — только чёрные', () => {
    expect(cn.validMeld(13, L('KH KS KD'))).toBe(true);
    expect(cn.validMeld(13, L('KH KS 2D'))).toBe(true);
    expect(cn.validMeld(13, L('KH 2S 2D'))).toBe(false);
    expect(cn.validMeld(13, L('KH KS KD 2S 2D JK JK\''))).toBe(false); // четыре дикие
    expect(cn.validMeld(3, L('3S 3C 3S\''))).toBe(true);
    expect(cn.minMeld(-50)).toBe(15);
    expect(cn.minMeld(1600)).toBe(90);
  });

  it('первая выкладка — минимум 50', () => {
    const s = pos(['KH KS KD 7D 7H 7C AH AS AC 9S', 'QH'], '5D', { phase: 'play' });
    expect(cn.apply(s, 0, { type: 'meld', groups: [{ rank: 13, cards: L('KH KS KD') }, { rank: 7, cards: L('7D 7H 7C') }] }, rng)).toBeNull(); // 30 + 15 = 45 < 50
    expect(cn.apply(s, 0, { type: 'meld', groups: [{ rank: 13, cards: L('KH KS KD') }, { rank: 14, cards: L('AH AS AC') }] }, rng)).not.toBeNull(); // 30 + 60
  });

  it('колода сброса: две натуральные; чёрная тройка сверху — нельзя', () => {
    const s = pos(['KH KS 9D 9C 9H 7D 7H AC', 'QH'], '5S 8C 4D KD');
    expect(cn.canTakePile(s, 0, L('KH KS 9D 9C 9H'))).toBe(true);
    expect(cn.canTakePile(s, 0, L('KH KS'))).toBe(false); // 40 < 50
    const t = pos(['KH KS 9D', 'QH'], '5S 3S');
    expect(cn.canTakePile(t, 0, [])).toBe(false);
    const r = cn.apply(s, 0, { type: 'pile', cards: L('KH KS 9D 9C 9H') }, rng)!;
    expect(r.state.hands[0].length).toBe(3 + 3);
    expect(r.state.melds[0].length).toBe(2);
  });

  it('выход только с канастой; счёт', () => {
    const s = pos(['9S 8D', 'QH QS'], '5D', { phase: 'play', opened: [true, true], melds: [[{ rank: 14, cards: L("AH AS AD AC AH' AS' AD'") }], []] });
    const r = cn.apply(s, 0, { type: 'discard', card: C('9S') }, rng)!;
    expect(r).not.toBeNull();
    const t = pos(['9S', 'QH'], '5D', { phase: 'play', opened: [true, true], melds: [[{ rank: 14, cards: L('AH AS AD') }], []] });
    expect(cn.apply(t, 0, { type: 'discard', card: C('9S') }, rng)).toBeNull();
    // вдвоём для выхода нужны две канасты
    const u = pos(['9S'], '5D', { phase: 'play', opened: [true, true], melds: [[{ rank: 14, cards: L("AH AS AD AC AH' AS' AD'") }, { rank: 13, cards: L("KH KS KD KC KH' KS' KD'") }], []], laid: [true, true] });
    u.hands[1] = L('QH QS');
    const out = cn.apply(u, 0, { type: 'discard', card: C('9S') }, rng)!;
    const hand = out.events.find((e) => e.type === 'hand') as Extract<cn.Event, { type: 'hand' }>;
    expect(hand.add[0]).toBe(7 * 20 + 500 + 7 * 10 + 500 + 100);
    expect(hand.add[1]).toBe(-20);
  });

  it('боты доигрывают вдвоём и вчетвером', () => {
    for (const n of [2, 4]) {
      const r = new SeededRng(31 + n);
      let s = cn.setup(Array.from({ length: n }, (_, i) => i), { target: 2500 }, r);
      for (let i = 0; i < 30000 && !s.over; i++) {
        const seat = s.turn;
        const a = choose(def.view(s, [seat]), seat, i % 3, r)!;
        const res = cn.apply(s, seat, a, r);
        expect(res, `${n}: ${JSON.stringify(a)} фаза ${s.phase}`).not.toBeNull();
        s = res!.state;
      }
      expect(s.over, String(n)).toBe(true);
    }
  }, 300000);
});
