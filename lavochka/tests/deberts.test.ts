/* Деберц: старшинство и очки, торги (два круга, обязон), раздача на 2/3/4, комбинации и белла, ход с перебитием, байт и висячий, белот, боты. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { choose } from '../src/games/deberts/ai';
import { def } from '../src/games/deberts/def';
import * as db from '../src/games/deberts/engine';
import type { Card, Suit } from '../src/cards/deck';

const C = (t: string): Card => ({ s: t.slice(-1) as Suit, r: ({ J: 11, Q: 12, K: 13, A: 14 } as Record<string, number>)[t.slice(0, -1)] ?? Number(t.slice(0, -1)) });
const L = (t: string) => t.split(/\s+/).filter(Boolean).map(C);
const rng = new SeededRng(1);

describe('Деберц', () => {
  it('раздача: вдвоём и втроём — 9 на руках, вчетвером — 8, белот — 8', () => {
    for (const [n, opts, want] of [[2, {}, 9], [3, {}, 9], [4, {}, 8], [4, { rules: 'belote' }, 8]] as const) {
      let s = db.setup(Array.from({ length: n }, (_, i) => i), opts, new SeededRng(n));
      s = db.apply(s, s.turn, { type: 'bid', play: true }, rng)!.state;
      for (const x of s.seats) expect(s.hands[x].length, `${n} ${JSON.stringify(opts)}`).toBe(want);
    }
  });

  it('торги: второй круг — другая масть; все пас — пересдача; клабор — обязон', () => {
    let s = db.setup([0, 1], {}, new SeededRng(5));
    const up = s.up!.s;
    s = db.apply(s, s.turn, { type: 'bid', play: false }, rng)!.state;
    s = db.apply(s, s.turn, { type: 'bid', play: false }, rng)!.state;
    expect(s.phase).toBe('bid2');
    expect(db.apply(s, s.turn, { type: 'bid', play: true, suit: up }, rng)).toBeNull();
    const r = db.apply(s, s.turn, { type: 'bid', play: false }, rng)!;
    const r2 = db.apply(r.state, r.state.turn, { type: 'bid', play: false }, rng)!;
    expect(r2.events.some((e) => e.type === 'redeal')).toBe(true);
    let k = db.setup([0, 1], { rules: 'klabor' }, new SeededRng(5));
    k = db.apply(k, k.turn, { type: 'bid', play: false }, rng)!.state;
    k = db.apply(k, k.turn, { type: 'bid', play: false }, rng)!.state;
    k = db.apply(k, k.turn, { type: 'bid', play: false }, rng)!.state;
    expect(k.turn).toBe(k.dealer);
    expect(db.apply(k, k.turn, { type: 'bid', play: false }, rng)).toBeNull();
  });

  it('комбинации: терц, полтинник, лучшая сторона; белот — карэ', () => {
    expect(db.combos(L('7H 8H 9H KS'), 'deberts')[0]).toMatchObject({ len: 3, pts: 20 });
    expect(db.combos(L('10H JH QH KH'), 'deberts')[0]).toMatchObject({ len: 4, pts: 50 });
    expect(db.combos(L('JH JS JD JC'), 'belote').some((c) => c.pts === 200)).toBe(true);
    expect(db.combos(L('JH JS JD JC'), 'deberts').length).toBe(0);
  });

  it('ход: в масть, нет — козырем, козырь — перебить', () => {
    const s = db.newState(db.cfgFrom({}), [0, 1]);
    s.trump = 'H';
    s.phase = 'play';
    s.hands = [L('AS'), L('KS 7H 9H')];
    s.trick = [{ seat: 0, card: C('AS') }];
    s.turn = 1;
    expect(db.legal(s, 1).map((c) => c.s + c.r)).toEqual(['S13']);
    s.hands[1] = L('7H 9H 8C');
    expect(db.legal(s, 1).length).toBe(2);
    s.trick = [{ seat: 0, card: C('10H') }];
    expect(db.legal(s, 1).map((c) => c.r)).toEqual([9]);
  });

  it('байт: у играющего меньше — его очки сопернику; поровну — висят', () => {
    const s = db.newState(db.cfgFrom({}), [0, 1]);
    Object.assign(s, { trump: 'H', taker: 0, phase: 'play', hands: [L('7S'), L('AS')], trick: [], turn: 0, pts: [40, 50] });
    const r = db.apply(s, 0, { type: 'play', card: C('7S') }, rng)!;
    const r2 = db.apply(r.state, 1, { type: 'play', card: C('AS') }, rng)!;
    const hand = r2.events.find((e) => e.type === 'hand') as Extract<db.Event, { type: 'hand' }>;
    // соперник: 50 + 11 + 10 = 71, у играющего 40 — байт: 40 уходят сопернику
    expect(hand.add).toEqual([0, 71 + 40]);
  });

  it('боты доигрывают все пресеты', () => {
    for (const p of def.presets!) {
      const n = p.options.rules === 'belote' || p.id === 'pairs' ? 4 : 2;
      const r = new SeededRng(17);
      let s = db.setup(Array.from({ length: n }, (_, i) => i), { ...p.options, target: 301 }, r);
      for (let i = 0; i < 20000 && !s.over; i++) {
        const seat = s.turn;
        const a = choose(def.view(s, [seat]), seat, i % 3, r)!;
        const res = db.apply(s, seat, a, r);
        expect(res, `${p.id}: ${JSON.stringify(a)} фаза ${s.phase}`).not.toBeNull();
        s = res!.state;
      }
      expect(s.over, p.id).toBe(true);
    }
  }, 300000);
});
