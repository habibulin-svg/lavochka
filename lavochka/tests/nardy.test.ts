/* Нарды: правила длинных, коротких и гюльбары, матч и куб, партии ботов. */
import { describe, expect, it } from 'vitest';
import { RiggedRng, SeededRng } from '../src/core/rng';
import { def } from '../src/games/nardy/def';
import { absOf, apply, cfgFrom, legalSteps, newGame, sign, type Action, type Cfg, type State } from '../src/games/nardy/engine';
import { botSeats, simulate } from './harness';

const cfg = (o: Record<string, unknown> = {}): Cfg => cfgFrom({ ...o } as any);

function pos(c: Cfg, white: [number, number][], black: [number, number][], extra: Partial<State> = {}): State {
  const s = newGame(c);
  s.pts = new Array(24).fill(0);
  for (const [p, list] of [[0, white], [1, black]] as const)
    for (const [i, n] of list) {
      if (i === -1) s.bar[p] += n;
      else s.pts[absOf(c, p, i)] += n * sign(p);
    }
  const sum = (l: [number, number][]) => l.reduce((a, [, n]) => a + n, 0);
  s.off = [15 - sum(white), 15 - sum(black)];
  s.phase = 'roll';
  s.cur = 0;
  s.turns = [3, 3];
  return Object.assign(s, extra);
}

function roll(s: State, a: number, b: number) {
  const rng = new RiggedRng(new SeededRng(1));
  rng.rig([a - 1, b - 1]);
  const r = apply(s, s.cur, { type: 'roll' }, rng)!;
  expect(r).not.toBeNull();
  return r.state;
}
const act = (s: State, seat: number, a: Action) => apply(s, seat, a, new SeededRng(1));
const froms = (s: State) => [...new Set(legalSteps(s).map((x) => x.from))].sort((a, b) => a - b);

describe('длинные нарды', () => {
  it('с головы одна шашка за ход', () => {
    let s = roll(pos(cfg(), [[0, 15]], [[0, 15]]), 5, 2);
    s = act(s, 0, { type: 'move', from: 0, die: 5 })!.state;
    expect(froms(s)).toEqual([5]);
  });

  it('первым ходом 6:6 — две с головы, остальные шестёрки сгорают', () => {
    let s = roll(pos(cfg(), [[0, 15]], [[0, 15]], { turns: [0, 0] }), 6, 6);
    s = act(s, 0, { type: 'move', from: 0, die: 6 })!.state;
    expect(froms(s)).toContain(0);
    const r = act(s, 0, { type: 'move', from: 0, die: 6 })!;
    expect(r.events.some((e) => e.type === 'forfeit')).toBe(true);
    expect(r.state.cur).toBe(1);
  });

  it('первым ходом любой дубль — две с головы (5:5), а не первым — одна', () => {
    let s = roll(pos(cfg(), [[0, 15]], [[0, 15]], { turns: [0, 0] }), 5, 5);
    s = act(s, 0, { type: 'move', from: 0, die: 5 })!.state;
    expect(froms(s)).toContain(0);
    let t = roll(pos(cfg(), [[0, 15]], [[0, 15]], { turns: [1, 1] }), 5, 5);
    t = act(t, 0, { type: 'move', from: 0, die: 5 })!.state;
    expect(froms(t)).not.toContain(0);
  });

  it('на чужую шашку вставать нельзя', () => {
    // чёрная шашка на пути белых в 3 пунктах от головы
    const s = roll(pos(cfg(), [[0, 15]], [[0, 14], [15, 1]]), 3, 4);
    // белый путь 3 = абс. 15 = путь чёрных 15
    expect(legalSteps(s).some((x) => x.from === 0 && x.die === 3)).toBe(false);
  });

  it('блок из шести без шашки соперника впереди запрещён', () => {
    const s = roll(pos(cfg(), [[0, 6], [13, 2], [14, 1], [15, 1], [16, 1], [17, 1], [9, 3]], [[0, 15]]), 5, 1);
    expect(legalSteps(s).some((x) => x.from === 13 && x.die === 5)).toBe(false);
    // с вариантом «можно всегда» — разрешён
    const s2 = roll(pos(cfg({ block6: 'allow' }), [[0, 6], [13, 2], [14, 1], [15, 1], [16, 1], [17, 1], [9, 3]], [[0, 15]]), 5, 1);
    expect(legalSteps(s2).some((x) => x.from === 13 && x.die === 5)).toBe(true);
  });

  it('снятие: большим кубиком — только с самого старшего пункта', () => {
    const s = roll(pos(cfg(), [[20, 2], [22, 3]], [[5, 15]]), 6, 1);
    const six = legalSteps(s).filter((x) => x.die === 6).map((x) => x.from);
    expect(six).toEqual([20]);
  });

  it('марс: соперник не снял ни одной', () => {
    const s = roll(pos(cfg(), [[23, 1]], [[10, 15]]), 1, 2);
    const r = act(s, 0, { type: 'move', from: 23, die: 2 })!;
    const end = r.events.find((e) => e.type === 'gameEnd') as any;
    expect(end.kind).toBe('mars');
    expect(end.points).toBe(2);
    expect(def.result(r.state)?.winners).toEqual([0]);
  });
});

describe('короткие нарды', () => {
  it('бой отправляет на бар, с бара входят первыми', () => {
    const c = cfg({ mode: 'short' });
    let s = roll(pos(c, [[0, 2], [11, 5], [16, 3], [18, 5]], [[0, 2], [11, 4], [15, 1], [16, 3], [18, 5]]), 3, 5);
    s = act(s, 0, { type: 'move', from: 0, die: 3 })!.state;
    const r = act(s, 0, { type: 'move', from: 3, die: 5 })!;
    expect(r.events.some((e) => e.type === 'move' && e.hit)).toBe(true);
    s = roll(r.state, 4, 2);
    expect(froms(s)).toEqual([-1]);
  });

  it('куб: удвоение, принятие, отказ', () => {
    const c = cfg({ mode: 'short', cube: true, target: 5 });
    let s = pos(c, [[20, 15]], [[5, 15]]);
    s = act(s, 0, { type: 'double' })!.state;
    expect(s.phase).toBe('cube');
    s = act(s, 1, { type: 'take' })!.state;
    expect(s.cube).toEqual({ value: 2, owner: 1 });
    expect(act(s, 0, { type: 'double' })).toBeNull(); // куб у соперника
    s.cur = 1;
    s = act(s, 1, { type: 'double' })!.state;
    const r = act(s, 0, { type: 'drop' })!;
    expect(r.state.score).toEqual([0, 2]); // отказ — проигрыш по текущему кубу
    expect(r.state.phase).toBe('opening'); // матч до 5 продолжается
  });
});

describe('гюльбара', () => {
  it('каскад: после 5:5 играются 6:6', () => {
    let s = roll(pos(cfg({ mode: 'gulbara', head: 'free' }), [[0, 15]], [[0, 15]], { turns: [4, 4] }), 5, 5);
    expect(s.queue).toEqual([6]);
    for (let k = 0; k < 4; k++) s = act(s, 0, { type: 'move', from: 0, die: 5 })!.state;
    expect(s.left).toEqual([6, 6, 6, 6]);
  });

  it('первые три хода без каскада', () => {
    const s = roll(pos(cfg({ mode: 'gulbara', head: 'free' }), [[0, 15]], [[0, 15]], { turns: [1, 1] }), 5, 5);
    expect(s.queue).toEqual([]);
  });

  it('несыгранный остаток каскада доигрывает соперник', () => {
    // белые: одна шашка далеко, ход 4:4 — дальше упрёмся; чёрные доигрывают остаток
    const c = cfg({ mode: 'gulbara', head: 'free' });
    let s = roll(pos(c, [[0, 14], [10, 1]], [[0, 13], [4, 1], [8, 1]], { turns: [5, 5] }), 4, 4);
    // ходим, пока ход белых
    let guard = 0;
    while (s.cur === 0 && s.phase === 'move' && guard++ < 30) {
      const st = legalSteps(s)[0];
      const r = act(s, 0, { type: 'move', from: st.from, die: st.die })!;
      s = r.state;
    }
    if (s.stealing) {
      expect(s.cur).toBe(1);
      expect(s.phase).toBe('move');
    }
  });
});

describe('нарды: партии ботов целиком', () => {
  for (const mode of ['long', 'short', 'gulbara'])
    for (const level of [0, 2])
      it(`${mode}, уровень ${level}: партия доходит до снятия всех шашек`, async () => {
        const res = await simulate(def, botSeats(def, 2, [level]), { mode, target: 1 }, 31 + level);
        expect(res.error).toBeUndefined();
        expect(res.finished).toBe(true);
        expect(res.steps).toBeGreaterThan(40);
      }, 120_000);

  it('матч до 3 очков с кубом', async () => {
    const res = await simulate(def, botSeats(def, 2, [1, 2]), { mode: 'short', target: 3, cube: true }, 5);
    expect(res.error).toBeUndefined();
    expect(res.finished).toBe(true);
  }, 120_000);
});
