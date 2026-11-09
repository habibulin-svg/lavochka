import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { def } from '../src/games/pekar/def';
import { choose } from '../src/games/pekar/ai';
import { apply, canHome, cfgFrom, chaseOf, newState, runnerAt, safeAt, stickFlight, throwBody, toAct, type Action, type State } from '../src/games/pekar/engine';

const rig = (vals: number[]) => {
  const r = new SeededRng(1);
  return { next: () => r.next(), int: (n: number) => (vals.length ? vals.shift()! : r.int(n)), getState: () => 0 };
};

/** После жеребьёвки: пекарь — 2, бросают 0 и 1. */
function ready(opts: Record<string, string | number | boolean> = {}): State {
  const s = newState(cfgFrom(opts, 3), [0, 1, 2]);
  s.kicks = [12, 10, 7];
  s.order = [0, 1, 2];
  s.pekar = 2;
  s.pl[2].stick = 'pekar';
  s.queue = [0, 1];
  s.phase = 'throw';
  return s;
}

const HIT: Action = { type: 'throw', pow: 0.66, yaw: -0.022, style: 'flat' };

describe('пекарь: палка и банка', () => {
  it('полёт детерминирован, броски показа попадают и мажут', () => {
    const c = cfgFrom({});
    const a = stickFlight(throwBody(c, 0, 0.66, -0.022, 'flat'), 'flat', canHome(c));
    expect(a.hit).not.toBeNull();
    expect(stickFlight(throwBody(c, 0, 0.3, -0.02, 'flat'), 'flat', canHome(c)).hit).toBeNull();
    const long = stickFlight(throwBody(c, 0, 0.95, 0.02, 'flat'), 'flat', canHome(c));
    expect(long.hit).toBeNull();
    expect(long.rest[1]).toBeGreaterThan(c.dist);
  });
  it('черта звания ближе к банке', () => {
    const c = cfgFrom({});
    expect(c.ranks.length).toBe(9);
    expect(c.step * 8).toBeLessThanOrEqual(c.dist - 5 + 1e-6);
  });
});

describe('пекарь: розыгрыш', () => {
  it('жеребьёвка: ближе всех — пекарь', () => {
    let s = newState(cfgFrom({}, 3), [0, 1, 2]);
    s = apply(s, 0, { type: 'kick', pow: 0.75 }, rig([999]))!.state;
    s = apply(s, 1, { type: 'kick', pow: 0.6 }, rig([999]))!.state;
    const r = apply(s, 2, { type: 'kick', pow: 0.3 }, rig([999]))!;
    expect(r.state.pekar).toBe(2);
    expect(r.state.order).toEqual([0, 1, 2]);
    expect(r.state.phase).toBe('throw');
  });
  it('сбил банку → звание, бег, банка на место', () => {
    let s = ready();
    let r = apply(s, 0, HIT, rig([]))!;
    expect(r.events.find((e) => e.k === 'throw')).toMatchObject({ hit: true });
    s = r.state;
    expect(s.pl[0].rank).toBe(1);
    expect(s.phase).toBe('run');
    s = apply(s, 0, { type: 'run', go: true }, rig([]))!.state;
    expect(s.phase).toBe('fix');
    r = apply(s, 2, { type: 'fix' }, rig([]))!;
    expect(r.state.can.up).toBe(true);
    expect(r.state.pl[0].stick === 'hand' || r.state.phase === 'chase').toBe(true);
  });
  it('палка у банки — осалили, осаленный пекарь', () => {
    let s = ready();
    s.pl[1].stick = 'field';
    [s.pl[1].sx, s.pl[1].sy] = [0.8, 17.5];
    s.queue = [0];
    s = apply(s, 0, HIT, rig([]))!.state;
    s = apply(s, 0, { type: 'run', go: true }, rig([]))!.state;
    s = apply(s, 1, { type: 'run', go: true }, rig([]))!.state;
    s = apply(s, 2, { type: 'fix' }, rig([]))!.state;
    expect(s.phase).toBe('chase');
    const r = apply(s, 2, { type: 'chase', who: 1 }, rig([0]))!;
    expect(r.events.find((e) => e.k === 'chase')).toMatchObject({ tag: true });
    expect(r.state.pekar).toBe(1);
    expect(r.state.pl[2].stick).toBe('hand');
  });
  it('бегущий за чертой — не осалить', () => {
    const c = cfgFrom({});
    const rr = { who: 0, from: [-1.6, -1] as [number, number], stick: [0, 8] as [number, number], home: [-1.6, -1] as [number, number], t0: 0.35, line: 0 };
    expect(runnerAt(rr, 100).field).toBe(false);
    expect(chaseOf([0, c.dist], safeAt(rr) + 0.1, rr).ok).toBe(false);
  });
  it('чужой ход и мусор — отказ', () => {
    const s = ready();
    expect(apply(s, 1, HIT, rig([]))).toBeNull();
    expect(apply(s, 0, { type: 'throw', pow: NaN, yaw: 0, style: 'flat' }, rig([]))).toBeNull();
    expect(apply(s, 0, { type: 'fix' }, rig([]))).toBeNull();
  });
});

describe('пекарь: показ правил', () => {
  for (const sec of def.rules!.sections) {
    const demo = sec.demo;
    if (!demo) continue;
    it(sec.title, () => {
      let s: State = demo.setup ? demo.setup(def as never, new SeededRng(1)) : def.setup(demo.seats, demo.options ?? {}, new SeededRng(1));
      for (const st of demo.steps) {
        expect(toAct(s)).toContain(st.seat);
        const r = apply(s, st.seat, st.action as Action, rig(st.rig?.slice() ?? []));
        expect(r, st.caption).not.toBeNull();
        s = r!.state;
      }
    });
  }
});

describe('пекарь: боты', () => {
  const game = (levels: number[], opts: Record<string, string | number | boolean>, seed: number) => {
    const rng = new SeededRng(seed);
    let s = def.setup(levels.map((l, i) => ({ seat: i, kind: 'bot', name: `b${i}`, level: l })), opts, rng);
    let moves = 0;
    while (!s.over && moves < 3000) {
      const seat = toAct(s)[0];
      const a = choose(s, seat, levels[seat], rng);
      const r = apply(s, seat, a, rng);
      expect(r, JSON.stringify({ phase: s.phase, a })).not.toBeNull();
      s = r!.state;
      moves++;
    }
    return { s, moves };
  };
  it('партии доходят до конца во всех пресетах', () => {
    for (const p of def.presets!) {
      const { s, moves } = game([2, 1, 0, 2], p.options, 7);
      expect(s.over).toBe(true);
      expect(moves).toBeLessThan(3000);
      console.log(p.id, moves, s.throws, s.winners, s.pl.map((x) => x.rank + '/' + x.knocks).join(' '));
    }
  });
  it('сильный чаще выигрывает у слабого', () => {
    let strong = 0;
    for (let k = 0; k < 6; k++) {
      const { s } = game([2, 0], { ranks: 'short', dist: 11 }, 100 + k);
      if (s.winners.includes(0)) strong++;
    }
    expect(strong).toBeGreaterThanOrEqual(4);
  });
});
