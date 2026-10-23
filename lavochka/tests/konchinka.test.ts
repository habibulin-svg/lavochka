/* Кончинка: сдача, взятие по сумме и по равенству, обязательное взятие, скопа, подсчёт, пары, боты. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { choose } from '../src/games/konchinka/ai';
import { def } from '../src/games/konchinka/def';
import * as kc from '../src/games/konchinka/engine';
import type { Card, Suit } from '../src/cards/deck';

const C = (t: string): Card => ({ s: t.slice(-1) as Suit, r: ({ J: 11, Q: 12, K: 13, A: 14 } as Record<string, number>)[t.slice(0, -1)] ?? Number(t.slice(0, -1)) });
const L = (t: string) => t.split(/\s+/).filter(Boolean).map(C);
const ids = (cs: Card[][]) => cs.map((set) => set.map((c) => c.s + c.r).sort().join(',')).sort();
const rng = new SeededRng(1);

describe('Кончинка', () => {
  it('сдача: по 4 и 4 на стол; скопа — по 3, 40 карт; научное — стол пуст', () => {
    const s = kc.setup([0, 1], {}, new SeededRng(2));
    expect(s.hands[0].length).toBe(4);
    expect(s.table.length).toBe(4);
    expect(s.deck.length).toBe(52 - 12);
    const t = kc.setup([0, 1, 2], { rules: 'scopa', hand: 3 }, new SeededRng(2));
    expect(t.deck.length).toBe(40 - 4 - 9);
    const u = kc.setup([0, 1, 2, 3], { rules: 'scopa', hand: 10 }, new SeededRng(2));
    expect(u.table.length).toBe(0);
    expect(u.deck.length).toBe(0);
  });

  it('взятие: равная карта или сумма; картинки — только такую же', () => {
    const cfg = kc.cfgFrom({});
    expect(ids(kc.captures(cfg, L('7H 2C AH QD 6S'), C('10D')))).toEqual(['C2,H14,H7']);
    expect(ids(kc.captures(cfg, L('7H 3C 4D'), C('7S')))).toEqual(['C3,D4', 'H7']);
    expect(ids(kc.captures(cfg, L('QH 2C 10D'), C('QS')))).toEqual(['H12']);
    expect(kc.captures(cfg, L('JH AC'), C('QS'))).toEqual([]);
  });

  it('скопа: есть равная — только она; эскоба — до 15', () => {
    const sc = kc.cfgFrom({ rules: 'scopa' });
    expect(ids(kc.captures(sc, L('7H 3C 4D'), C('7S')))).toEqual(['H7']);
    expect(kc.value(sc, C('KS'))).toBe(10);
    const es = kc.cfgFrom({ rules: 'escoba' });
    expect(ids(kc.captures(es, L('5H 7S 3C'), C('KD')))).toEqual(['H5']);
    expect(ids(kc.captures(es, L('5H 7S 3C'), C('5C')))).toEqual(['C3,S7']);
  });

  it('взять можно — брать обязательно', () => {
    const s = kc.newState(kc.cfgFrom({}), [0, 1]);
    s.hands = [L('7C 2H'), L('3S')];
    s.table = L('4D 3H');
    s.deck = L('2S 3S');
    s.turn = 0;
    expect(kc.moves(s, 0).every((m) => m.take.length)).toBe(true);
    expect(kc.apply(s, 0, { type: 'play', card: C('2H'), take: [] }, rng)).toBeNull();
    expect(kc.apply(s, 0, { type: 'play', card: C('7C'), take: L('4D 3H') }, rng)).not.toBeNull();
  });

  it('скопа даёт очко, остаток стола — последнему взявшему, подсчёт кончинки', () => {
    const s = kc.newState(kc.cfgFrom({ rules: 'scopa', hand: 3 }), [0, 1]);
    s.hands = [L('7D AS'), L('2H')];
    s.table = L('4H 3S');
    s.turn = 0;
    const r = kc.apply(s, 0, { type: 'play', card: C('7D'), take: L('4H 3S') }, rng)!;
    expect(r.events.find((e) => e.type === 'play')).toMatchObject({ sweep: true });
    expect(r.state.sweeps[0]).toBe(1);

    const k = kc.newState(kc.cfgFrom({}), [0, 1]);
    k.piles = [L('2C 10D 3C 4C 5H'), L('6H 7H')];
    const t = kc.tally(k);
    expect(t.add[0]).toBe(2 + 1 + 1 + 1);
    expect(t.add[1]).toBe(0);
    k.piles = [L('2C 3H'), L('10D 3C')];
    // поровну карт — по 1, треф поровну — никому
    expect(kc.tally(k).add).toEqual([2, 2]);
  });

  it('примиера', () => {
    expect(kc.primiera(L('7D 7C 7H 7S'))).toBe(84);
    expect(kc.primiera(L('7D 7C 7H'))).toBe(0);
    expect(kc.primiera(L('AD 6C KH 2S'))).toBe(16 + 18 + 10 + 12);
  });

  it('боты доигрывают все пресеты; вчетвером пара получает очки вместе', () => {
    for (const p of def.presets!) {
      const counts = def.countsFor!(p.options);
      const n = counts.includes(4) ? 4 : counts[0];
      const r = new SeededRng(7);
      let s = kc.setup(Array.from({ length: n }, (_, i) => i), p.options, r);
      for (let i = 0; i < 20000 && !s.over; i++) {
        const seat = s.turn;
        const a = choose(def.view(s, [seat]), seat, i % 3, r)!;
        const res = kc.apply(s, seat, a, r);
        expect(res, `${p.id} ${JSON.stringify(a)}`).not.toBeNull();
        s = res!.state;
      }
      expect(s.over, p.id).toBe(true);
      if (n === 4) expect(s.score[0]).toBe(s.score[2]);
    }
  });

  it('сложный бот обыгрывает лёгкого', () => {
    let wins = 0;
    for (let g = 0; g < 6; g++) {
      const r = new SeededRng(40 + g);
      let s = kc.setup([0, 1], { rules: g % 2 ? 'scopa' : 'konch', hand: g % 2 ? 3 : 4, target: 11 }, r);
      const lv = g % 4 < 2 ? [2, 0] : [0, 2];
      while (!s.over) {
        const seat = s.turn;
        s = kc.apply(s, seat, choose(def.view(s, [seat]), seat, lv[seat], r)!, r)!.state;
      }
      if (lv[s.winners[0]] === 2) wins++;
    }
    expect(wins).toBeGreaterThanOrEqual(4);
  });
});
