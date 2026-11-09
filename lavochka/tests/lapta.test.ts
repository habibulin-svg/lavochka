import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { def } from '../src/games/lapta/def';
import { apply, cfgFrom, flight, intercept, judge, newState, runnerAt, strike, formation, type State } from '../src/games/lapta/engine';

const rig = (vals: number[]) => {
  const r = new SeededRng(1);
  return { next: () => r.next(), int: (n: number) => (vals.length ? vals.shift()! : r.int(n)), getState: () => 0 };
};

describe('лапта: удар и поле', () => {
  it('полёт мяча детерминирован', () => {
    const c = cfgFrom({});
    const a = flight(strike(c, 0.7, 0.1, 'far'));
    const b = flight({ ...strike(c, 0.7, 0.1, 'far') });
    expect(a.land).toEqual(b.land);
  });
  it('дальний удар в полную силу — чуть за кон, слабый — недолёт', () => {
    for (const L of [50, 36, 26]) {
      const c = cfgFrom({ field: L, ctrl: 5 });
      const far = flight(strike(c, 1, 0, 'far')).land!;
      expect(far.y).toBeGreaterThan(L);
      expect(far.y).toBeLessThan(L * 1.3);
    }
    const big = cfgFrom({ field: 50, ctrl: 10 });
    expect(judge(big, flight(strike(big, 0, 0, 'low')).land)).toBe('short');
  });
  it('аут — за боковую, недолёт — до контрольной', () => {
    const c = cfgFrom({});
    expect(judge(c, { x: c.W / 2 + 1, y: 20 })).toBe('out');
    expect(judge(c, { x: 0, y: c.ctrl - 1 })).toBe('short');
    expect(judge(c, { x: 0, y: c.L + 3 })).toBe('ok');
  });
  it('полевой под мячом ловит свечу с лёта', () => {
    const c = cfgFrom({});
    const b0 = strike(c, 0.5, 0, 'candle');
    const land = flight(b0).land!;
    const ic = intercept(b0, [land.x + 1, land.y]);
    expect(ic.air).toBe(true);
  });
});

describe('лапта: розыгрыш', () => {
  const st = (): State => newState(cfgFrom({}), [0, 1]);
  it('удар → бег → ловля → осалили → смена', () => {
    let s = st();
    let r = apply(s, 0, { type: 'hit', pow: 0.42, yaw: -0.12, style: 'low' }, rig([]))!;
    expect(r.events[0]).toMatchObject({ k: 'hit', kind: 'ok' });
    s = r.state;
    expect(s.phase).toBe('run');
    r = apply(s, 0, { type: 'run', who: [0] }, rig([]))!;
    s = r.state;
    expect(s.phase).toBe('catch');
    const f = formation(s.cfg);
    let best = 0;
    f.forEach((p, i) => (intercept(s.play!.b0, p).t < intercept(s.play!.b0, f[best]).t ? (best = i) : 0));
    r = apply(s, 1, { type: 'catch', who: best }, rig([]))!;
    s = r.state;
    expect(s.phase).toBe('throw');
    r = apply(s, 1, { type: 'throw', at: 0 }, rig([0]))!;
    expect(r.events.map((e) => e.k)).toContain('salit');
    expect(r.state.atk).toBe(1);
  });
  it('домой из кона — 2 очка и снова право удара', () => {
    let s = st();
    s.teams[0].st[1] = 'kon';
    s.teams[0].queue = [0, 2, 3, 4, 5];
    s = apply(s, 0, { type: 'hit', pow: 0.8, yaw: 0.25, style: 'low' }, rig([]))!.state;
    s = apply(s, 0, { type: 'run', who: [1] }, rig([]))!.state;
    s = apply(s, 1, { type: 'catch', who: 4 }, rig([]))!.state;
    const r = apply(s, 1, { type: 'hold' }, rig([]))!;
    expect(r.state.teams[0].score).toBe(2);
    expect(r.state.teams[0].st[1]).toBe('ready');
  });
  it('бегущий за линией — уже не осалить', () => {
    const c = cfgFrom({});
    const p = runnerAt(c, { who: 0, from: 'dom', t0: 0 }, 100);
    expect(p.done).toBe(true);
  });
  it('чужой ход и мусор — отказ', () => {
    const s = st();
    expect(apply(s, 1, { type: 'hit', pow: 0.5, yaw: 0, style: 'far' }, rig([]))).toBeNull();
    expect(apply(s, 0, { type: 'hit', pow: NaN, yaw: 0, style: 'far' }, rig([]))).toBeNull();
    expect(apply(s, 0, { type: 'run', who: [0] }, rig([]))).toBeNull();
  });
  it('боты доигрывают партию во всех пресетах', () => {
    for (const pr of def.presets!) {
      const rng = new SeededRng(7);
      let s = def.setup([{ seat: 0, kind: 'bot', name: 'a', level: 2 }, { seat: 1, kind: 'bot', name: 'b', level: 1 }], pr.options, rng) as State;
      let n = 0;
      while (!s.over && n < 3000) {
        const seat = def.toAct(s)[0];
        const a = def.bot.choose(s, seat, seat === 0 ? 2 : 1, rng) as never;
        const r = def.apply(s, seat, a, rng);
        expect(r, `${pr.id}: ${JSON.stringify(a)}`).not.toBeNull();
        s = r!.state;
        n++;
      }
      expect(s.over, pr.id).toBe(true);
      expect(def.result(s)).not.toBeNull();
    }
  });
});
