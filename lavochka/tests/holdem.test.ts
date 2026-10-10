/* Холдем: комбинации и кикеры, порядок ходов (вдвоём баттон — малый блайнд), минимальный рейз, побочные банки, скрытые карты, боты. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import type { Card, Suit } from '../src/cards/deck';
import { def } from '../src/games/holdem/def';
import { apply, category, cfgFrom, deal, evaluate, makeView, newState, type Action, type State } from '../src/games/holdem/engine';

const rng = () => new SeededRng(8);
const C = (t: string): Card => ({ s: t.slice(-1) as Suit, r: ({ J: 11, Q: 12, K: 13, A: 14 } as Record<string, number>)[t.slice(0, -1)] ?? Number(t.slice(0, -1)) });
const L = (t: string) => t.split(/\s+/).filter(Boolean).map(C);
const ev = (t: string) => evaluate(L(t));
const go = (s: State, seat: number, a: Action) => {
  const r = apply(s, seat, a, rng());
  expect(r, JSON.stringify(a)).not.toBeNull();
  return r!;
};

describe('комбинации', () => {
  it('категории', () => {
    expect(category(ev('AH KD 9S 7C 4H 3D 2C'))).toBe(0);
    expect(category(ev('AH AD 9S 7C 4H 3D 2C'))).toBe(1);
    expect(category(ev('AH AD 9S 9C 4H 3D 2C'))).toBe(2);
    expect(category(ev('AH AD AS 9C 4H 3D 2C'))).toBe(3);
    expect(category(ev('AH 2D 3S 4C 5H KD QC'))).toBe(4);
    expect(category(ev('AH 9H 3H 4H 7H KD QC'))).toBe(5);
    expect(category(ev('AH AD AS 9C 9H 3D 2C'))).toBe(6);
    expect(category(ev('AH AD AS AC 9H 3D 2C'))).toBe(7);
    expect(category(ev('9H 10H JH QH KH 3D 2C'))).toBe(8);
  });
  it('сравнение и кикеры; колесо — младший стрит', () => {
    expect(ev('AH AD KS 7C 4H')).toBeGreaterThan(ev('AH AD QS 7C 4H'));
    expect(ev('6H 2D 3S 4C 5H')).toBeGreaterThan(ev('AH 2D 3S 4C 5H'));
    expect(ev('KH KD 2S 2C 9H')).toBeGreaterThan(ev('QH QD JS JC AH'));
    expect(ev('2H 3H 4H 5H 7H')).toBeGreaterThan(ev('10H JD QS KC AH'));
  });
});

describe('торговля', () => {
  it('вдвоём: баттон — малый блайнд и ходит первым до флопа, после — второй', () => {
    let s = deal(newState(cfgFrom({}), [0, 1]), rng()).state;
    expect(s.sb).toBe(s.button);
    expect(s.turn).toBe(s.button);
    const other = s.bb;
    s = go(s, s.turn, { type: 'call' }).state;
    expect(s.turn).toBe(other);
    s = go(s, other, { type: 'check' }).state;
    expect(s.street).toBe('flop');
    expect(s.turn).toBe(other);
  });
  it('рейз не меньше прошлого повышения; пас — банк оставшемуся', () => {
    let s = deal(newState(cfgFrom({}), [0, 1, 2]), rng()).state;
    expect(apply(s, s.turn, { type: 'raise', to: 30 }, rng())).toBeNull();
    s = go(s, s.turn, { type: 'raise', to: 60 }).state;
    expect(apply(s, s.turn, { type: 'raise', to: 80 }, rng())).toBeNull();
    s = go(s, s.turn, { type: 'fold' }).state;
    const r = go(s, s.turn, { type: 'fold' });
    expect(r.events.find((e) => e.type === 'win')).toMatchObject({ uncontested: true, amount: 60 + 10 + 20 });
  });
  it('побочный банк: ва-банк с меньшим стеком претендует только на свою часть', () => {
    const s = deal(newState(cfgFrom({}), [0, 1, 2]), rng()).state;
    Object.assign(s, {
      street: 'river',
      board: L('2C 7D 9C JS 8S'),
      total: [100, 400, 400, 0, 0, 0, 0, 0, 0],
      bet: Array(9).fill(0),
      current: 0,
      acted: [2],
      chips: [0, 600, 600, 0, 0, 0, 0, 0, 0],
      turn: 1,
    });
    s.allin = s.allin.map((_, i) => i === 0);
    s.folded = s.folded.map(() => false);
    s.hole[0] = L('AH AD');
    s.hole[1] = L('KH KD');
    s.hole[2] = L('QH QD');
    const r = go(s, 1, { type: 'check' });
    const wins = r.events.filter((e) => e.type === 'win');
    expect(wins).toEqual([
      expect.objectContaining({ seat: 0, amount: 300 }),
      expect.objectContaining({ seat: 1, amount: 600 }),
    ]);
  });
});

describe('скрытые карты и боты', () => {
  it('чужие карты и колода не видны', () => {
    const s = deal(newState(cfgFrom({}), [0, 1, 2]), rng()).state;
    const v = makeView(s, [0]);
    expect(v.hole[1]).toEqual([]);
    expect(v.hole[0].length).toBe(2);
    expect(v.deck).toEqual([]);
  });
  it('ходы ботов допустимы', async () => {
    const s = deal(newState(cfgFrom({}), [0, 1, 2, 3]), rng()).state;
    for (const lv of [0, 1, 2]) {
      const a = (await def.bot.choose(makeView(s, [s.turn]), s.turn, lv, rng())) as Action;
      expect(apply(s, s.turn, a, rng())).not.toBeNull();
    }
  });
});
