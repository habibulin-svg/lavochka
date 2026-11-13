/* Нарды: глубокое ревью — исправленные находки. */
import { describe, expect, it } from 'vitest';
import { RiggedRng, SeededRng } from '../src/core/rng';
import { absOf, apply, cfgFrom, legalSteps, newGame, sign, type Cfg, type State } from '../src/games/nardy/engine';

const cfg = (o: Record<string, unknown> = {}): Cfg => cfgFrom({ ...o } as any);
function pos(c: Cfg, white: [number, number][], black: [number, number][], extra: Partial<State> = {}): State {
  const s = newGame(c);
  s.pts = new Array(24).fill(0);
  for (const [p, list] of [[0, white], [1, black]] as const)
    for (const [i, n] of list) s.pts[absOf(c, p, i)] += n * sign(p);
  const sum = (l: [number, number][]) => l.reduce((a, [, n]) => a + n, 0);
  s.off = [15 - sum(white), 15 - sum(black)];
  s.phase = 'roll';
  s.cur = 0;
  s.turns = [5, 5];
  return Object.assign(s, extra);
}

describe('нарды: ревью', () => {
  it('гюльбара: после доигранного чужого остатка каскада соперник бросает сам', () => {
    const c = cfg({ mode: 'gulbara', head: 'free' });
    // чёрные доигрывают остаток за белых: ход чёрных, один шаг 4 осталось
    const s = pos(c, [[0, 14], [10, 1]], [[0, 13], [3, 2]], { phase: 'move', cur: 1, left: [4], dice: [4, 4], stealing: true });
    const st = legalSteps(s)[0];
    const r = apply(s, 1, { type: 'move', from: st.from, die: st.die }, new SeededRng(1))!;
    expect(r.state.phase).toBe('roll');
    expect(r.state.cur).toBe(1);
    expect(r.state.stealing).toBe(false);
  });

  it('тавли/греческие: настройка «марс» учитывается', () => {
    expect(cfgFrom({ mode: 'plakoto', mars: false } as any).mars).toBe(false);
    expect(cfgFrom({ mode: 'portes' } as any).mars).toBe(true);
  });
});

describe('нарды: обязанность играть кубики', () => {
  const roll = (s: State, ...d: number[]) => {
    const rng = new RiggedRng(new SeededRng(1));
    rng.rig(d.map((x) => x - 1));
    return apply(s, s.cur, { type: 'roll' }, rng)!.state;
  };

  it('сыграть можно только один кубик — обязан больший', () => {
    const c = cfg({ mode: 'short' });
    // чёрный индекс пункта, совпадающего с белым индексом 18 (10 + 5 + 3)
    const j = [...Array(24).keys()].find((k) => absOf(c, 1, k) === absOf(c, 0, 18))!;
    const s = roll(pos(c, [[10, 1]], [[j, 2], [0, 13]]), 3, 5);
    const steps = legalSteps(s);
    expect(steps.length).toBeGreaterThan(0);
    expect(steps.every((x) => x.die === 5)).toBe(true);
  });

  it('если можно сыграть оба кубика — ход одним не заканчивается', () => {
    const c = cfg({ mode: 'short' });
    const s = roll(pos(c, [[0, 2], [11, 5], [16, 3], [18, 5]], [[0, 2], [11, 5], [16, 3], [18, 5]]), 4, 2);
    const r = apply(s, 0, { type: 'move', from: 11, die: 4 }, new SeededRng(1))!;
    expect(r.state.cur).toBe(0);
    expect(r.state.left).toEqual([2]);
  });

  it('римские игры: правило «больший кубик» не применяется', () => {
    const c = cfg({ mode: 'tabula' });
    const s = newGame(c);
    s.phase = 'move';
    s.cur = 0;
    s.left = [2, 5];
    s.dice = [2, 5, 1];
    s.hand = [0, 0];
    s.pts = new Array(24).fill(0);
    s.pts[absOf(c, 0, 10)] = 15;
    s.pts[absOf(c, 1, 20)] = -15;
    expect(legalSteps(s).some((x) => x.die === 2)).toBe(true);
  });
});
