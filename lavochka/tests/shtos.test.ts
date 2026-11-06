/* Штос: направо — банку, налево — понтёру; плие (весь куш или половина); углы и «пе»; медь; сода и хок; банк покрывает ставки;
 * сорванный банк; партии ботов сходятся по фишкам. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { type Card, type Suit } from '../src/cards/deck';
import { choose } from '../src/games/shtos/ai';
import * as st from '../src/games/shtos/engine';

const C = (t: string): Card => ({ s: t.slice(-1) as Suit, r: ({ J: 11, Q: 12, K: 13, A: 14 } as Record<string, number>)[t.slice(0, -1)] ?? Number(t.slice(0, -1)) });
const L = (t: string) => t.split(/\s+/).filter(Boolean).map(C);
const rng = new SeededRng(1);

/** Два места, банк 300 у места 0, ход понтёра 1; колода — заданные карты и дальше хвост. */
function pos(top: string, opts = {}, bank = 300): st.State {
  const s = st.newState(st.cfgFrom(opts), [0, 1]);
  s.deck = [...L(top), ...L('2S 3S 4S 5S 6S 8S 9S 2H 3H 4H 5H 6H 8H 9H')];
  s.talia = 1;
  s.banker = 0;
  s.money[0] -= bank;
  s.bank = s.bankStart = bank;
  s.phase = 'stake';
  s.order = [1];
  s.turn = 1;
  return s;
}
const go = (s: st.State, seat: number, a: st.Action) => {
  const r = st.apply(s, seat, a, rng);
  if (!r) throw new Error('нельзя: ' + JSON.stringify(a));
  return r.state;
};
const total = (s: st.State) => s.seats.reduce((x, k) => x + s.money[k], 0) + s.bank + s.bets.reduce((x, b) => x + b.amt + b.win, 0);

describe('Штос', () => {
  it('налево — выигрыш понтёра, направо — проигрыш', () => {
    let s = pos('9C QD 7H 7S');
    s = go(s, 1, { type: 'stake', rank: 12, n: 50 });
    s = go(go(s, 1, { type: 'done' }), 0, { type: 'deal' });
    expect(s.bets[0].win).toBe(50);
    expect(s.bank).toBe(250);
    s = go(s, 1, { type: 'take', rank: 12 });
    expect(s.money[1]).toBe(1050);
    s = go(s, 1, { type: 'stake', rank: 7, n: 50 });
    s = go(go(s, 1, { type: 'done' }), 0, { type: 'deal' });
    expect(s.bets.length).toBe(0);
    expect(s.bank).toBe(300);
    expect(s.money[1]).toBe(1000);
  });

  it('плие: в штосе банку весь куш, в фараоне — половина', () => {
    for (const [split, back] of [[false, 950], [true, 975]] as const) {
      let s = pos('7S 7D', { split });
      s = go(s, 1, { type: 'stake', rank: 7, n: 50 });
      s = go(go(s, 1, { type: 'done' }), 0, { type: 'deal' });
      expect(s.money[1]).toBe(back);
      expect(s.bets.length).toBe(0);
    }
  });

  it('углы: пароли — три куша чистыми; пе — выигрыш в карман, куш стоит', () => {
    let s = pos('4C 10S 2H 10D');
    s = go(s, 1, { type: 'stake', rank: 10, n: 50 });
    s = go(go(s, 1, { type: 'done' }), 0, { type: 'deal' });
    s = go(s, 1, { type: 'paroli', rank: 10 });
    expect(s.bets[0]).toMatchObject({ amt: 100, level: 1, win: 0 });
    s = go(go(s, 1, { type: 'done' }), 0, { type: 'deal' });
    s = go(s, 1, { type: 'take', rank: 10 });
    expect(s.money[1]).toBe(1150);

    s = pos('4C 10S');
    s = go(s, 1, { type: 'stake', rank: 10, n: 50 });
    s = go(go(s, 1, { type: 'done' }), 0, { type: 'deal' });
    expect(st.apply(s, 1, { type: 'done' }, rng)).toBeNull(); // сначала решить про выигрыш
    s = go(s, 1, { type: 'paix', rank: 10 });
    expect(s.money[1]).toBe(1000);
    expect(s.bets[0]).toMatchObject({ amt: 50, win: 0 });
  });

  it('без углов пароли нельзя; медью — наоборот', () => {
    let s = pos('4C 10S', { corners: false });
    s = go(s, 1, { type: 'stake', rank: 10, n: 50 });
    s = go(go(s, 1, { type: 'done' }), 0, { type: 'deal' });
    expect(st.apply(s, 1, { type: 'paroli', rank: 10 }, rng)).toBeNull();
    s = pos('6S 2D', { copper: true });
    expect(st.apply(s, 1, { type: 'stake', rank: 6, n: 50, copper: true }, rng)).not.toBeNull();
    s = go(s, 1, { type: 'stake', rank: 6, n: 50, copper: true });
    s = go(go(s, 1, { type: 'done' }), 0, { type: 'deal' });
    expect(s.bets[0].win).toBe(50);
    expect(st.apply(pos('6S 2D'), 1, { type: 'stake', rank: 6, n: 50, copper: true }, rng)).toBeNull();
  });

  it('на картах — не больше банка; ва-банк выиграл — банк сорван', () => {
    let s = pos('2C AS', {}, 100);
    expect(st.apply(s, 1, { type: 'stake', rank: 14, n: 110 }, rng)).toBeNull();
    s = go(s, 1, { type: 'stake', rank: 14, n: 60 });
    expect(st.apply(s, 1, { type: 'stake', rank: 13, n: 50 }, rng)).toBeNull();
    s = go(s, 1, { type: 'stake', rank: 13, n: 40 });
    s = go(go(s, 1, { type: 'done' }), 0, { type: 'deal' });
    // туз выиграл 60: банк 40 — король ещё под ударом, «пе» на тузе банк не покроет
    expect(st.canPaix(s, s.bets.find((b) => b.rank === 14)!)).toBe(false);
    s = pos('2C AS', {}, 100);
    s = go(s, 1, { type: 'stake', rank: 14, n: 100 });
    const r = st.apply(go(s, 1, { type: 'done' }), 0, { type: 'deal' }, rng)!;
    expect(r.events.some((e) => e.type === 'endTalia' && e.broke)).toBe(true);
    expect(r.state.money[1]).toBe(1100);
    expect(r.state.money[0]).toBe(900);
  });

  it('фараон: сода и хок мёртвые, 25 пар', () => {
    let s = st.setup([0, 1], { sodaHock: true }, new SeededRng(5));
    s = go(s, 0, { type: 'bank', n: 300 });
    expect(s.soda).not.toBeNull();
    let pairs = 0;
    let guard = 0;
    while (s.talia === 1 && !s.over && guard++ < 200) {
      const seat = s.turn!;
      const a = s.phase === 'deal' ? ({ type: 'deal' } as st.Action) : ({ type: 'done' } as st.Action);
      const r = st.apply(s, seat, a, rng)!;
      for (const e of r.events) {
        if (e.type === 'pair') pairs++;
        if (e.type === 'endTalia') expect(e.hock).not.toBeNull();
      }
      s = r.state;
    }
    expect(pairs).toBe(25);
  });

  it('партии ботов: фишки сходятся, партия кончается', () => {
    for (const [preset, n] of [[{}, 4], [{ sodaHock: true, split: true, copper: true }, 3], [{ deck: 36, corners: false, rounds: 2 }, 2]] as const) {
      const r = new SeededRng(11 + n);
      let s = st.setup(Array.from({ length: n }, (_, i) => i), preset, r);
      const start = total(s);
      let steps = 0;
      while (!s.over && steps++ < 20000) {
        const seat = s.turn!;
        const a = choose(st.makeView(s, [seat]), seat, steps % 3, r);
        const res = st.apply(s, seat, a!, r);
        expect(res).not.toBeNull();
        s = res!.state;
        expect(s.bank).toBeGreaterThanOrEqual(0);
        expect(total(s)).toBe(start);
      }
      expect(s.over).toBe(true);
    }
  });
});
