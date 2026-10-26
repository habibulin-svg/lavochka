import { describe, expect, it } from 'vitest';
import { choose } from '../src/games/daldos/ai';
import { def } from '../src/games/daldos/def';
import { apply, applyMove, applyRoll, cellOf, cfgFrom, legalMoves, newState, walk, type State } from '../src/games/daldos/engine';
import { SeededRng } from '../src/core/rng';

const DK = cfgFrom({});
const C = (r: number, c: number) => cellOf(DK, r, c);

function empty(list: [number, number, number, boolean][]): State {
  const s = newState(DK, 0);
  s.board = s.board.map(() => null);
  for (const [seat, r, c, dal] of list) s.board[C(r, c)] = { seat, dal };
  s.count = [list.filter((x) => x[0] === 0).length, list.filter((x) => x[0] === 1).length];
  return s;
}

function game(levels: [number, number], seed: number, opts = {}): State {
  const rng = new SeededRng(seed);
  let s = def.setup([], { ...opts }, rng) as State;
  for (let i = 0; i < 20000 && s.phase !== 'over'; i++) {
    const a = choose(s, s.turn, levels[s.turn], rng);
    if (!a) throw new Error('бот не нашёл хода');
    const r = apply(s, s.turn, a, rng);
    if (!r) throw new Error('недопустимый ход бота');
    s = r.state;
  }
  return s;
}

describe('далдос', () => {
  it('путь: свой ряд к корме, средний к носу, ряд соперника к корме, снова средний', () => {
    expect(walk(DK, 0, C(0, 1), 2)).toEqual([C(0, 0), C(1, 0)]);
    expect(walk(DK, 0, C(1, 15), 3)).toEqual([C(1, 16), C(2, 15), C(2, 14)]);
    expect(walk(DK, 1, C(1, 16), 1)).toEqual([C(0, 15)]);
    expect(walk(DK, 0, C(2, 0), 1)).toEqual([C(1, 0)]);
  });

  it('в начале ходит только дал крайней у кормы фишки; без дала ход пропадает', () => {
    const r = applyRoll(newState(DK, 0), [1, 3]);
    expect(legalMoves(r.state).map((m) => [m.from, m.to, m.use])).toEqual([[C(0, 0), C(1, 3), 2]]);
    const lost = applyRoll(newState(DK, 0), [2, 4]);
    expect(lost.events[0]).toMatchObject({ type: 'roll', none: true });
    expect(lost.state.turn).toBe(1);
  });

  it('дал-дал — ещё бросок', () => {
    let s = applyRoll(newState(DK, 0), [1, 1]).state;
    s = applyMove(s, { type: 'move', from: C(0, 0), to: C(1, 0), use: 0 })!.state;
    s = applyMove(s, { type: 'move', from: C(0, 1), to: C(0, 0), use: 1 })!.state;
    expect(s.turn).toBe(0);
    expect(s.phase).toBe('roll');
  });

  it('взятие, прыжок через чужую, свои не перепрыгнуть', () => {
    let s = empty([[0, 1, 4, true], [0, 1, 7, true], [1, 1, 6, true], [1, 1, 9, true], [1, 2, 3, false]]);
    s = applyRoll(s, [2, 3]).state;
    const ms = legalMoves(s);
    expect(ms.some((m) => m.from === C(1, 4) && m.use === 2)).toBe(false); // сложение упирается в свою на 7
    s = applyMove(s, { type: 'move', from: C(1, 7), to: C(1, 9), use: 0 })!.state;
    expect(s.count[1]).toBe(2);
    s = applyMove(s, { type: 'move', from: C(1, 4), to: C(1, 7), use: 1 })!.state;
    expect(s.board[C(1, 6)]?.seat).toBe(1);
  });

  it('сложенные кости снимают только в конце (а в варианте — и по пути)', () => {
    const list: [number, number, number, boolean][] = [[0, 1, 2, true], [1, 1, 4, true], [1, 1, 7, true], [1, 2, 0, false]];
    let s = applyRoll(empty(list), [2, 3]).state;
    s = applyMove(s, { type: 'move', from: C(1, 2), to: C(1, 7), use: 2 })!.state;
    expect(s.count[1]).toBe(2);
    let p = empty(list);
    p.cfg = cfgFrom({ passCapture: true });
    p = applyRoll(p, [2, 3]).state;
    p = applyMove(p, { type: 'move', from: C(1, 2), to: C(1, 7), use: 2 })!.state;
    expect(p.count[1]).toBe(1);
  });

  it('партии ботов доходят до конца на всех пресетах', () => {
    for (const pr of def.presets!) {
      const s = game([2, 1], 7, pr.options);
      expect(s.phase).toBe('over');
      expect(s.why).not.toBe('limit');
    }
  });

  it('сложный бот сильнее лёгкого и среднего', () => {
    let vsEasy = 0;
    let vsMid = 0;
    const N = Number(process.env.SIM_GAMES || 10);
    for (let i = 0; i < N; i++) {
      const hardFirst = i % 2 === 0;
      const a = game(hardFirst ? [2, 0] : [0, 2], 100 + i);
      if (a.winner === (hardFirst ? 0 : 1)) vsEasy++;
      const b = game(hardFirst ? [2, 1] : [1, 2], 200 + i);
      if (b.winner === (hardFirst ? 0 : 1)) vsMid++;
    }
    console.log(`далдос: сложный против лёгкого ${vsEasy}/${N}, против среднего ${vsMid}/${N}`);
    expect(vsEasy).toBeGreaterThanOrEqual(N * 0.7);
    expect(vsMid).toBeGreaterThanOrEqual(N * 0.5);
  });
});
