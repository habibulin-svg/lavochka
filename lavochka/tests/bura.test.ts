/* Бура: покрытие нескольких карт, взятка последнему побившему, добор, вскрытие (верное и ошибочное), бура, конец по картам, скрытые карты. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import type { Card, Suit } from '../src/cards/deck';
import { def } from '../src/games/bura/def';
import { apply, cfgFrom, covers, deal, makeView, newState, type Action, type State } from '../src/games/bura/engine';

const rng = () => new SeededRng(9);
const C = (t: string): Card => ({ s: t.slice(-1) as Suit, r: ({ J: 11, Q: 12, K: 13, A: 14 } as Record<string, number>)[t.slice(0, -1)] ?? Number(t.slice(0, -1)) });
const L = (t: string) => t.split(/\s+/).filter(Boolean).map(C);

function pos(seats: number[], hands: string[], trump: string, deck: string, extra: Partial<State> = {}): State {
  const s = newState(cfgFrom({}), seats);
  hands.forEach((h, i) => (s.hands[seats[i]] = L(h)));
  s.trumpCard = C(trump);
  s.trump = s.trumpCard.s;
  s.deck = [...L(deck), s.trumpCard];
  s.round = 1;
  s.turn = seats[0];
  return Object.assign(s, extra);
}
const go = (s: State, seat: number, a: Action) => {
  const r = apply(s, seat, a, rng());
  expect(r, JSON.stringify(a)).not.toBeNull();
  return r!;
};

describe('отбой', () => {
  it('каждую карту — старшей той же масти или козырем', () => {
    expect(covers(L('10C 6H'), L('9C KC'), 'H')).toBe(true);
    expect(covers(L('10C 6S'), L('9C KC'), 'H')).toBe(false);
    expect(covers(L('AS'), L('10S'), 'H')).toBe(true);
    expect(covers(L('KS'), L('10S'), 'H')).toBe(false);
  });
  it('заход — одной масти; бить нечем — нельзя «побить»', () => {
    const s = pos([0, 1], ['9C KD 7S', 'AS 6H 10C'], 'QH', '7D 8D 9D');
    expect(apply(s, 0, { type: 'lead', cards: L('9C KD') }, rng())).toBeNull();
    const t = go(s, 0, { type: 'lead', cards: L('7S') }).state;
    expect(apply(t, 1, { type: 'beat', cards: L('10C') }, rng())).toBeNull();
  });
  it('втроём взятка — последнему побившему, со скинутым; добор с него', () => {
    let s = pos([0, 1, 2], ['10S 9C 8C', 'AS 7D 8D', '6S 7C 9D'], 'QH', '6C 7H 8H 9H 10H JH JS');
    s = go(s, 0, { type: 'lead', cards: L('10S') }).state;
    s = go(s, 1, { type: 'beat', cards: L('AS') }).state;
    const r = go(s, 2, { type: 'skip', cards: L('6S') });
    s = r.state;
    expect(s.piles[1].length).toBe(3);
    expect(s.turn).toBe(1);
    expect([0, 1, 2].map((x) => s.hands[x].length)).toEqual([3, 3, 3]);
    expect(r.events.find((e) => e.type === 'draw')).toMatchObject({ seat: 1 });
  });
});

describe('конец кона', () => {
  it('вскрылся с 31 — кон; без 31 — палки ему', () => {
    const ok = go(pos([0, 1], ['9C KC 7D', '10C 6H 8S'], 'QH', '7S 8D', { piles: [L('AS 10S AD'), [], [], []] }), 0, { type: 'declare' });
    expect(ok.events.find((e) => e.type === 'round')).toMatchObject({ winner: 0, add: [0, 4, 0, 0] });
    const bad = go(pos([0, 1], ['9C KC 7D', '10C 6H 8S'], 'QH', '7S 8D', { piles: [L('AS 10S'), L('KD'), [], []] }), 0, { type: 'declare' });
    expect(bad.events.find((e) => e.type === 'round')).toMatchObject({ winner: null, add: [4, 0, 0, 0] });
  });
  it('бура — сразу кон, проигравшим по 4', () => {
    const s = pos([0, 1], ['6H 9H AH', '10C 7S 8S'], 'QH', '7D 8D');
    expect(apply(s, 1, { type: 'show', kind: 'bura' }, rng())).toBeNull();
    const r = go(s, 0, { type: 'show', kind: 'bura' });
    expect(r.events.find((e) => e.type === 'round')).toMatchObject({ winner: 0, reason: 'bura', add: [0, 4, 0, 0] });
  });
  it('карты кончились — у кого больше очков', () => {
    let s = pos([0, 1], ['AS', '6S'], 'QH', '', { deck: [] });
    s = go(s, 0, { type: 'lead', cards: L('AS') }).state;
    const r = go(s, 1, { type: 'skip', cards: L('6S') });
    expect(r.events.find((e) => e.type === 'round')).toMatchObject({ winner: 0, reason: 'cards' });
  });
});

describe('скрытые карты и боты', () => {
  it('чужие руки и взятки не видны, скинутое втёмную — тоже', () => {
    let s = deal(newState(cfgFrom({}), [0, 1]), rng()).state;
    const v = makeView(s, [0]);
    expect(v.hands[1]).toEqual([]);
    expect(v.counts[1]).toBe(3);
    expect(v.deck).toEqual([]);
    s = go(s, s.turn, { type: 'lead', cards: [s.hands[s.turn][0]] }).state;
    const other = s.turn;
    s = go(s, other, { type: 'skip', cards: [s.hands[other][0]] }).state;
    expect(def.redact!({ type: 'skip', seat: 1, count: 1, cards: L('6S') }, [0])).toMatchObject({ cards: undefined });
  });
  it('ходы ботов допустимы', async () => {
    const s = deal(newState(cfgFrom({}), [0, 1, 2]), rng()).state;
    for (const lv of [0, 1, 2]) {
      const a = (await def.bot.choose(makeView(s, [s.turn]), s.turn, lv, rng())) as Action;
      expect(apply(s, s.turn, a, rng())).not.toBeNull();
    }
  });
});
