/* Домино: раздача, ходы, базар, рыба и яйца, запись очков (порог 13, «пусто-пусто» = 25), осёл, скрытые кости. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { def } from '../src/games/domino/def';
import { apply, cfgFrom, deal, ends, handPips, makeView, newState, placements, type Action, type Bone, type State } from '../src/games/domino/engine';

const rng = () => new SeededRng(7);
const empty = () => [0, 1, 2, 3].map(() => ({ tiles: [], closed: false }));

function pos(variant: string, seats: number[], hands: Record<number, Bone[]>, extra: Partial<State> = {}): State {
  const s = newState(cfgFrom({ variant }), seats);
  for (const [k, h] of Object.entries(hands)) s.hands[+k] = h;
  s.round = 1;
  return Object.assign(s, extra);
}

const play = (s: State, seat: number, a: number, b: number, arm: number, close = false) => {
  const r = apply(s, seat, { type: 'play', bone: [a, b], arm, close }, rng());
  expect(r, `${a}-${b} → ${arm}`).not.toBeNull();
  return r!;
};

describe('раздача', () => {
  it('вчетвером — по 7, базара нет; начинает 1-1', () => {
    const s = deal(newState(cfgFrom({}), [0, 1, 2, 3]), rng()).state;
    expect(s.seats.map((x) => s.hands[x].length)).toEqual([7, 7, 7, 7]);
    expect(s.bazaar.length).toBe(0);
    expect(s.hands[s.turn].some((b) => b[0] === 1 && b[1] === 1)).toBe(true);
    expect(s.opener).toEqual([1, 1]);
  });
  it('вдвоём — по 7 и 14 в базаре', () => {
    const s = deal(newState(cfgFrom({}), [0, 2]), rng()).state;
    expect(s.bazaar.length).toBe(14);
  });
});

describe('ходы', () => {
  it('первый ход — только обязательной костью; дальше — к концу с тем же числом', () => {
    let s = pos('kozel', [0, 1, 2, 3], { 0: [[1, 1], [2, 5]], 1: [[1, 4], [3, 3]], 2: [[0, 0], [1, 5]], 3: [[6, 6]] }, { opener: [1, 1], turn: 0 });
    expect(apply(s, 0, { type: 'play', bone: [2, 5], arm: -1 }, rng())).toBeNull();
    s = play(s, 0, 1, 1, -1).state;
    expect(apply(s, 1, { type: 'play', bone: [3, 3], arm: 0 }, rng())).toBeNull();
    s = play(s, 1, 1, 4, 1).state;
    expect(ends(s.chain, s.cfg).map((e) => e.v)).toEqual([1, 4]);
  });
  it('базар: берут, только когда нечем ходить; пусто — пропуск', () => {
    let s = pos('kozel', [0, 2], { 0: [[1, 2]], 2: [[4, 4], [2, 6]] }, {
      turn: 0,
      bazaar: [[2, 4], [5, 6]],
      chain: { center: { a: 5, b: 5, seat: 2 }, arms: empty() },
    });
    expect(apply(s, 0, { type: 'pass' }, rng())).toBeNull();
    s = apply(s, 0, { type: 'draw' }, rng())!.state;
    s = apply(s, 0, { type: 'draw' }, rng())!.state;
    expect(apply(s, 0, { type: 'draw' }, rng())).toBeNull();
    expect(s.lacks[0]).toContain(5);
    s = play(s, 0, 5, 6, 1).state;
    expect(s.turn).toBe(2);
  });
});

describe('конец кона', () => {
  it('рыба: меньше очков — выиграл, проигравшие пишут свои', () => {
    const sec = def.rules.sections.find((x) => x.title === 'Рыба')!;
    const s = sec.demo!.setup!(def, rng()) as State;
    const r = play(s, 0, 5, 6, 1);
    const ev = r.events.find((e) => e.type === 'round');
    expect(ev && ev.type === 'round' && ev.res.fish).toBe(true);
    expect(r.state.round).toBe(2);
  });
  it('вышел — проигравшие пишут очки с рук; меньше 13 висит', () => {
    const s = pos('kozel', [0, 1, 2, 3], { 0: [[1, 2]], 1: [[0, 1], [0, 2]], 2: [[6, 6]], 3: [[0, 3]] }, {
      turn: 0,
      chain: { center: { a: 2, b: 2, seat: 0 }, arms: empty() },
    });
    const r = play(s, 0, 1, 2, 0);
    // пара Б (места 1 и 3): 1 + 2 + 3 = 6 — меньше 13, висит
    expect(r.state.scores).toEqual([0, 0]);
    expect(r.state.hang[1]).toBe(6);
    expect(r.state.lastWinner).toBe(0);
  });
  it('одинокое «пусто-пусто» — 25 очков', () => {
    expect(handPips([[0, 0]])).toBe(25);
    expect(handPips([[0, 0], [1, 1]])).toBe(2);
  });
  it('набрал 101 — козёл', () => {
    const s = pos('kozel', [0, 1, 2, 3], { 0: [[1, 2]], 1: [[6, 6], [5, 6]], 2: [[4, 4]], 3: [[5, 5]] }, {
      turn: 0,
      scores: [10, 80],
      chain: { center: { a: 2, b: 2, seat: 0 }, arms: empty() },
    });
    const r = play(s, 0, 1, 2, 0);
    expect(r.state.phase).toBe('over');
    expect(r.state.goat).toBe(1);
    expect(r.state.winners.sort()).toEqual([0, 2]);
  });
});

describe('осёл', () => {
  it('от дубля — четыре стороны, дубли докладывают, «Закрыто»', () => {
    let s = pos('osel', [0, 1, 2, 3], { 0: [[3, 3], [0, 1]], 1: [[3, 5], [0, 2]], 2: [[1, 3], [2, 4]], 3: [[3, 6], [6, 6], [0, 4]] }, { turn: 0 });
    s = play(s, 0, 3, 3, -1).state;
    expect(ends(s.chain, s.cfg).length).toBe(4);
    s = play(s, 1, 3, 5, 2).state;
    s = play(s, 2, 1, 3, 3).state;
    s = play(s, 3, 3, 6, 0).state;
    expect(s.phase).toBe('more');
    expect(s.turn).toBe(3);
    s = play(s, 3, 6, 6, 0, true).state;
    expect(s.chain.arms[0].closed).toBe(true);
    expect(ends(s.chain, s.cfg).map((e) => e.arm)).toEqual([1, 2, 3]);
    expect(s.turn).toBe(0);
  });
});

describe('скрытые кости', () => {
  it('чужие руки и базар не видны', () => {
    const s = deal(newState(cfgFrom({}), [0, 2]), rng()).state;
    const v = makeView(s, [0]);
    expect(v.hands[2]).toEqual([]);
    expect(v.counts[2]).toBe(7);
    expect(v.bazaar).toEqual([]);
    expect(v.bazaarCount).toBe(14);
    const drawEv = { type: 'draw' as const, seat: 2, bone: [1, 2] as Bone, left: 3 };
    expect(def.redact!(drawEv, [0])).toMatchObject({ bone: undefined });
  });
  it('бот ходит по своему view', async () => {
    const s = deal(newState(cfgFrom({}), [0, 1, 2, 3]), rng()).state;
    for (const lv of [0, 1, 2]) {
      const a = (await def.bot.choose(makeView(s, [s.turn]), s.turn, lv, rng())) as Action;
      expect(apply(s, s.turn, a, rng())).not.toBeNull();
    }
    expect(placements(s, s.hands[s.turn]).length).toBeGreaterThan(0);
  });
});
