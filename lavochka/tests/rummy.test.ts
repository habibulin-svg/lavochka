/* Рамми, джин, кункен: комбинации, разбор руки, выкладка на 40, сброс-обязаловка, стук и андеркат, выход, боты. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { choose } from '../src/games/rummy/ai';
import { def } from '../src/games/rummy/def';
import * as rm from '../src/games/rummy/engine';
import { bestSplit, isMeld, isRun, isSet, type RCard } from '../src/games/rummy/melds';
import type { Suit } from '../src/cards/deck';

const C = (t: string): RCard => (t === 'JK' ? { s: 'H', r: 15, d: 0 } : { s: t.slice(-1) as Suit, r: ({ J: 11, Q: 12, K: 13, A: 14 } as Record<string, number>)[t.slice(0, -1)] ?? Number(t.slice(0, -1)) });
const L = (t: string) => t.split(/\s+/).filter(Boolean).map(C);
const R = rm.rulesOf(rm.cfgFrom({}));
const K = rm.rulesOf(rm.cfgFrom({ mode: 'kunken' }));
const rng = new SeededRng(1);

describe('Рамми', () => {
  it('комбинации', () => {
    expect(isSet(L('7H 7S 7D'), R)).toBe(true);
    expect(isSet(L('7H 7H 7D'), R)).toBe(false);
    expect(isRun(L('5H 6H 7H 8H'), R)).toBe(true);
    expect(isRun(L('AH 2H 3H'), R)).toBe(true);
    expect(isRun(L('QH KH AH'), R)).toBe(false); // туз младший
    expect(isRun(L('KH AH 2H'), K)).toBe(true); // кункен: через туза
    expect(isRun(L('5H JK 7H'), K)).toBe(true);
    expect(isMeld(L('5H JK JK'), K)).toBe(false); // джокеров больше половины
    expect(isSet(L('9C 9D JK'), K)).toBe(true);
  });

  it('разбор руки: наименьший хвост', () => {
    const sp = bestSplit(L('5H 6H 7H 7S 7D KC 2C'), R);
    // 7♥ нужна и в 5-6-7♥, и в тройке семёрок — выгоднее тройка: лишние 5 + 6 + 10 + 2
    expect(sp.deadValue).toBe(23);
    expect(sp.melds.flat().length).toBe(3);
  });

  it('ход: взять, выложить (несколько комбинаций сразу), доложить, сбросить; выход', () => {
    const s = rm.newState(rm.cfgFrom({}), [0, 1]);
    s.hands = [L('5H 6H 7H 9S 9D 9C 2C'), L('KC KD QS JS 3D 4H 8C')];
    s.stock = L('8H 2S 3S');
    s.discard = L('4C');
    s.phase = 'draw';
    s.turn = 0;
    let r = rm.apply(s, 0, { type: 'draw', from: 'stock' }, rng)!;
    r = rm.apply(r.state, 0, { type: 'meld', cards: L('5H 6H 7H 8H 9S 9D 9C') }, rng)!;
    expect(r.state.melds.length).toBe(2);
    expect(r.state.hands[0]).toEqual(L('2C'));
    r = rm.apply(r.state, 0, { type: 'discard', card: C('2C') }, rng)!;
    const hand = r.events.find((e) => e.type === 'hand') as Extract<rm.Event, { type: 'hand' }>;
    expect(hand.winner).toBe(0);
    expect(hand.add[0]).toBe(10 + 10 + 10 + 10 + 3 + 4 + 8);
  });

  it('кункен: первая выкладка от 40, из сброса — только в дело', () => {
    const s = rm.newState(rm.cfgFrom({ mode: 'kunken' }), [0, 1]);
    s.hands = [L('2H 3H 4H 9C 9D KS QS'), L('KC KD QD JS 3D 4C 8C')];
    s.stock = L('8H 2S 3S');
    s.discard = L('5D');
    s.phase = 'play';
    s.turn = 0;
    expect(rm.apply(s, 0, { type: 'meld', cards: L('2H 3H 4H') }, rng)).toBeNull(); // 9 очков < 40
    s.phase = 'draw';
    expect(rm.canTakeDiscard(s, 0)).toBe(false); // 5♦ некуда
    s.discard = L('9S');
    s.hands[0] = L('2H 3H 4H 9C 9D KS QS JS 10S');
    expect(rm.canTakeDiscard(s, 0)).toBe(true); // 9♠ в набор девяток; 9+27+... ≥ 40 с последовательностью пик
  });

  it('джин: стук и андеркат', () => {
    const s = rm.newState(rm.cfgFrom({ mode: 'gin' }), [0, 1]);
    s.hands = [L('5H 6H 7H 9S 9D 9C 2C 3D KS QS AC'), L('KC KD KH 4S 5S 6S 8D 8C 2H 3C')];
    s.stock = L('8H 2S 3S');
    s.discard = L('4C');
    s.phase = 'play';
    s.turn = 0;
    // хвост после сброса K♠: 2+3+10+1 = 16 > 10 — стучать нельзя
    expect(rm.apply(s, 0, { type: 'discard', card: C('KS'), knock: true }, rng)).toBeNull();
    s.hands[0] = L('5H 6H 7H 9S 9D 9C 2C 3D KS AC AD');
    const r = rm.apply(s, 0, { type: 'discard', card: C('KS'), knock: true }, rng)!;
    const hand = r.events.find((e) => e.type === 'hand') as Extract<rm.Event, { type: 'hand' }>;
    // у стучавшего 2+3+1+1 = 7, у защитника 8+8+2+3 = 21 → +14
    expect(hand.winner).toBe(0);
    expect(hand.add[0]).toBe(14);
  });

  it('боты доигрывают все режимы', () => {
    for (const p of def.presets!) {
      const n = p.options.mode === 'gin' ? 2 : 3;
      const r = new SeededRng(11);
      let s = rm.setup(Array.from({ length: n }, (_, i) => i), { ...p.options, target: 50 }, r);
      for (let i = 0; i < 20000 && !s.over; i++) {
        const seat = s.turn;
        const a = choose(def.view(s, [seat]), seat, i % 3, r)!;
        const res = rm.apply(s, seat, a, r);
        expect(res, `${p.id}: ${JSON.stringify(a)} фаза ${s.phase}`).not.toBeNull();
        s = res!.state;
      }
      expect(s.over, p.id).toBe(true);
    }
  }, 300000);
});
