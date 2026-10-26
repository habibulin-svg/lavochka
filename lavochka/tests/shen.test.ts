import { describe, expect, it } from 'vitest';
import { choose } from '../src/games/shen/ai';
import { def } from '../src/games/shen/def';
import { apply, applyMove, applyRoll, cfgFrom, legalMoves, newState, setup, SHEN, throwValue, type State } from '../src/games/shen/engine';
import { SeededRng } from '../src/core/rng';

const stick = (v: number) => [0, 1, 2, 3].map((i) => (v < 5 && i < v ? 1 : 0));

function pos(a: number[], b: number[], hand: [number, number], opts = {}): State {
  const s = newState(cfgFrom(opts), 0);
  s.pegs = [a, b];
  s.hand = hand;
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

describe('шен (собаки и шакалы)', () => {
  it('палочки: число светлых, ни одной — 5', () => {
    expect(throwValue([1, 0, 0, 0])).toBe(1);
    expect(throwValue([1, 1, 1, 1])).toBe(4);
    expect(throwValue([0, 0, 0, 0])).toBe(5);
  });

  it('первым ходит выбросивший меньше — сразу на это число', () => {
    const s = setup({}, new SeededRng(3));
    expect(s.phase).toBe('move');
    expect(s.value).toBeGreaterThanOrEqual(1);
    expect(s.value).toBeLessThanOrEqual(4);
  });

  it('змейки: 6 → 20 вперёд, 20 → 6 назад; в варианте Картера только назад', () => {
    let s = applyRoll(pos([3], [17], [4, 4]), stick(3)).state;
    s = applyMove(s, 3)!.state;
    expect(s.pegs[0]).toEqual([20]);
    s = applyRoll(s, stick(3)).state;
    s = applyMove(s, 17)!.state;
    expect(s.pegs[1]).toEqual([6]);
    let c = applyRoll(pos([3], [], [4, 5], { mode: 'carter' }), stick(3)).state;
    c = applyMove(c, 3)!.state;
    expect(c.pegs[0]).toEqual([6]);
  });

  it('свои не обгоняют; в шен — только точно', () => {
    const s = applyRoll(pos([4, 6, 27], [10], [2, 4]), stick(4)).state;
    expect(legalMoves(s).map((m) => m.from)).toEqual([6]);
    const t = applyRoll(pos([4, 6, 27], [10], [2, 4]), stick(3)).state;
    expect(legalMoves(t).find((m) => m.from === 27)?.to).toBe(SHEN);
  });

  it('нефер: ещё бросок и новая фишка под пальмой', () => {
    let s = applyRoll(pos([4, 12], [9], [3, 4]), stick(3)).state;
    s = applyMove(s, 12)!.state;
    expect(s.turn).toBe(0);
    expect(s.phase).toBe('roll');
    expect(s.pegs[0]).toEqual([1, 4, 15]);
    expect(s.hand[0]).toBe(2);
  });

  it('вход в шен снимает отстающую фишку соперника, своя — в руку', () => {
    let s = applyRoll(pos([2, 27], [3, 18], [3, 3]), stick(3)).state;
    s = applyMove(s, 27)!.state;
    expect(s.pegs[1]).toEqual([18]);
    expect(s.lost[1]).toBe(1);
    expect(s.hand[0]).toBe(4);
    // последнюю фишку соперника сняли — победа
    let w = applyRoll(pos([28], [5], [0, 0]), stick(2)).state;
    w = applyMove(w, 28)!.state;
    expect(w.phase).toBe('over');
    expect(w.winner).toBe(0);
  });

  it('партии ботов доходят до конца на всех пресетах', () => {
    for (const pr of def.presets!) {
      const s = game([2, 1], 7, pr.options);
      expect(s.phase).toBe('over');
      expect(s.ply).toBeLessThan(4000);
    }
  });

  it('сложный бот сильнее лёгкого и не слабее среднего', () => {
    let vsEasy = 0;
    let vsMid = 0;
    const N = Number(process.env.SIM_GAMES || 100);
    for (let i = 0; i < N; i++) {
      const hardFirst = i % 2 === 0;
      const a = game(hardFirst ? [2, 0] : [0, 2], 100 + i);
      if (a.winner === (hardFirst ? 0 : 1)) vsEasy++;
      const b = game(hardFirst ? [2, 1] : [1, 2], 200 + i);
      if (b.winner === (hardFirst ? 0 : 1)) vsMid++;
    }
    console.log(`шен: сложный против лёгкого ${vsEasy}/${N}, против среднего ${vsMid}/${N}`);
    expect(vsEasy).toBeGreaterThanOrEqual(N * 0.68);
    expect(vsMid).toBeGreaterThanOrEqual(N * 0.5);
  });
});
