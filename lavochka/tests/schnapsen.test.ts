/* Шнапсен: раздача, свободный ход и строгие правила, марьяж, обмен, закрытие, счёт сдачи, боты. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { choose } from '../src/games/schnapsen/ai';
import { def } from '../src/games/schnapsen/def';
import * as sn from '../src/games/schnapsen/engine';
import type { Card, Suit } from '../src/cards/deck';

const C = (t: string): Card => ({ s: t.slice(-1) as Suit, r: ({ J: 11, Q: 12, K: 13, A: 14 } as Record<string, number>)[t.slice(0, -1)] ?? Number(t.slice(0, -1)) });
const L = (t: string) => t.split(/\s+/).filter(Boolean).map(C);
function pos(hands: string[], trump: string, stock: string, extra: Partial<sn.State> = {}, opts = {}) {
  const s = sn.newState(sn.cfgFrom(opts), [0, 1]);
  hands.forEach((h, i) => (s.hands[i] = L(h)));
  s.trumpCard = trump ? C(trump) : null;
  s.trump = trump ? C(trump).s : 'H';
  s.stock = L(stock);
  s.deal = 1;
  return Object.assign(s, extra);
}
const rng = new SeededRng(1);
const play = (s: sn.State, seat: number, card: string, meld = false) => sn.apply(s, seat, { type: 'play', card: C(card), meld }, rng);
type HandEv = Extract<sn.Event, { type: 'hand' }>;
const handOf = (evs: sn.Event[]) => evs.find((e) => e.type === 'hand') as HandEv;

describe('Шнапсен', () => {
  it('раздача: по 5, козырь открыт, прикуп 9 + козырь; в 66 — по 6', () => {
    const s = sn.setup([0, 1], {}, new SeededRng(3));
    expect(s.hands[0].length).toBe(5);
    expect(s.hands[1].length).toBe(5);
    expect(s.stock.length).toBe(9);
    expect(s.trumpCard).not.toBeNull();
    expect(s.turn).toBe(0);
    const t = sn.setup([0, 1], { deck: 24 }, new SeededRng(3));
    expect(t.hands[0].length).toBe(6);
    expect(t.stock.length).toBe(11);
    expect(t.cfg.last10).toBe(true);
  });

  it('пока прикуп открыт — любой картой; взявший добирает первым', () => {
    const s = pos(['AH KS QS 10D JC', 'AC 10C KH JD QD'], 'JH', 'AS KD 10S QC QH 10H KC');
    const r = play(s, 0, '10D')!;
    expect(sn.legal(r.state, 1).length).toBe(5);
    const r2 = play(r.state, 1, 'AC')!;
    // трефовый туз не бьёт бубновую десятку: взятка у первого
    expect(r2.state.turn).toBe(0);
    expect(r2.state.pts[0]).toBe(21);
    expect(r2.events.filter((e) => e.type === 'draw').map((e) => e.seat)).toEqual([0, 1]);
    expect(r2.state.hands[0].some((c) => c.s === 'S' && c.r === 14)).toBe(true);
  });

  it('строгие правила: в масть и старше, нет масти — козырем', () => {
    const s = pos(['AS JC', '10S KS QH'], '', '', { closed: { seat: 0, oppTricks: 0 }, trump: 'H' });
    const r = play(s, 0, 'JC')!;
    expect(sn.legal(r.state, 1).map((c) => c.s + c.r)).toEqual(['H12']);
    const s2 = pos(['KS JC', '10S QS QH'], '', '', { closed: { seat: 0, oppTricks: 0 }, trump: 'H' });
    const r2 = play(s2, 0, 'KS')!;
    expect(sn.legal(r2.state, 1).map((c) => c.s + c.r)).toEqual(['S10']);
  });

  it('марьяж: 20, козырный 40; очки ждут взятки; ходить надо королём или дамой', () => {
    const s = pos(['KS QS AH JC 10D', 'AC 10C KH JD QD'], 'JH', 'AS KD 10S QC QH 10H KC');
    const r = play(s, 0, 'QS', true)!;
    expect(r.state.pending[0]).toBe(20);
    expect(sn.score(r.state, 0)).toBe(0);
    expect(play(s, 0, 'AH', true)).toBeNull();
    const s2 = pos(['KH QH AS JC 10D', 'AC 10C KS JD QD'], 'JH', 'AD KD 10S QC 10H KC QS', { tricks: [1, 0], pts: [10, 0] });
    const r2 = play(s2, 0, 'KH', true)!;
    expect(sn.score(r2.state, 0)).toBe(50);
  });

  it('обмен валета на открытый козырь; в 66 — только со взяткой', () => {
    const s = pos(['JH AS KS QS 10D', 'AC 10C KH JD QD'], 'AH', 'AD KD 10S QC');
    const r = sn.apply(s, 0, { type: 'exchange' }, rng)!;
    expect(r.state.trumpCard).toEqual(C('JH'));
    expect(r.state.hands[0].some((c) => c.s === 'H' && c.r === 14)).toBe(true);
    expect(r.state.shown[0]).toEqual([C('AH')]);
    const t = pos(['9H AS KS QS 10D JC', 'AC 10C KH JD QD 9D'], 'AH', 'AD KD 10S QC', {}, { deck: 24 });
    expect(sn.canExchange(t, 0)).toBe(false);
    expect(sn.canExchange({ ...t, tricks: [1, 0] }, 0)).toBe(true);
  });

  it('сдача: 1/2/3 очка по соперникам; закрывший не набрал — сопернику 2 или 3', () => {
    const s = pos(['AS QC', 'KD JC'], '', '', { tricks: [3, 2], pts: [55, 30] });
    const r = play(play(s, 0, 'AS')!.state, 1, 'JC')!;
    expect(handOf(r.events)).toMatchObject({ winner: 0, gp: 2 });
    const c = pos(['AS', 'KS'], '', '', { tricks: [2, 1], pts: [30, 40], closed: { seat: 0, oppTricks: 0 } });
    const r2 = play(play(c, 0, 'AS')!.state, 1, 'KS')!;
    expect(handOf(r2.events)).toMatchObject({ winner: 1, gp: 3, reason: 'closed' });
  });

  it('в уме: «Хватит!» без 66 — сдача сопернику', () => {
    const s = pos(['AS QC', 'KD JC'], '', '', { tricks: [3, 2], pts: [40, 30] }, { manual: true });
    const r = sn.apply(s, 0, { type: 'claim' }, rng)!;
    expect(handOf(r.events)).toMatchObject({ winner: 1, reason: 'wrong', gp: 2 });
  });

  it('боты доигрывают партии, сложный обыгрывает лёгкого', () => {
    let hardWins = 0;
    for (let g = 0; g < 6; g++) {
      const r = new SeededRng(100 + g);
      let s = sn.setup([0, 1], { target: 3, manual: g % 3 === 0 }, r);
      const lv = g % 2 ? [2, 0] : [0, 2];
      for (let i = 0; i < 2000 && !s.over; i++) {
        const seat = s.turn;
        const a = choose(def.view(s, [seat]), seat, lv[seat], r)!;
        const res = sn.apply(s, seat, a, r);
        expect(res, JSON.stringify(a)).not.toBeNull();
        s = res!.state;
      }
      expect(s.over).toBe(true);
      if (lv[s.winner!] === 2) hardWins++;
    }
    expect(hardWins).toBeGreaterThanOrEqual(4);
  });
});
