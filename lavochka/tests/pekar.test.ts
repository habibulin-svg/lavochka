import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { def } from '../src/games/pekar/def';
import { botInput } from '../src/games/pekar/ai';
import { canHome, cfgFrom, newGame, step, stickFlight, throwFrom, whoThrows, yawTo, type Event, type In, type State } from '../src/games/pekar/engine';

const rng = () => new SeededRng(3);

/** После жеребьёвки: пекарь — 2, бросают 0 и 1; все на местах. */
function ready(opts: Record<string, string | number | boolean> = {}): State {
  const s = newGame({ ...opts, speed: 1 }, [0, 1, 2]);
  s.phase = 'play';
  s.kicks = [12, 10, 7];
  s.order = [0, 1, 2];
  s.pekar = 2;
  s.sticks[2].at = 'pekar';
  s.men[2].x = 1.3;
  s.men[2].y = s.cfg.dist + 1.1;
  return s;
}

/** Крутить шаги с вводом по месту. */
function run(s: State, sec: number, inputs: (s: State) => (In | null)[]) {
  const r = rng();
  const evs: Event[] = [];
  for (let k = 0; k < Math.round(sec * 60); k++) evs.push(...step(s, inputs(s), r));
  return evs;
}

describe('пекарь: палка и банка', () => {
  it('прямо в банку с черты рядового — попадает, слабо — недолёт', () => {
    const c = cfgFrom({});
    const yaw = yawTo(c, 0, 0);
    let hit = false;
    for (let p = 0.4; p <= 0.9; p += 0.05) if (stickFlight(throwFrom(c, 0, 0, p, yaw, 'flat'), 'flat', canHome(c)).hit) hit = true;
    expect(hit).toBe(true);
    expect(stickFlight(throwFrom(c, 0, 0, 0.1, yaw, 'flat'), 'flat', canHome(c)).hit).toBeNull();
  });
  it('черта маршала не ближе 5 м к банке', () => {
    const c = cfgFrom({});
    expect(c.ranks.length).toBe(9);
    expect(c.step * 8).toBeLessThanOrEqual(c.dist - 5 + 1e-6);
  });
});

describe('пекарь: партия в реальном времени', () => {
  it('жеребьёвка пинком: ближе всех — пекарь', () => {
    const s = newGame({ speed: 1 }, [0, 1, 2]);
    const pows = [0.75, 0.6, 0.3];
    const evs = run(s, 12, (st) => {
      const k = st.kicks.findIndex((x) => x == null);
      return [0, 1, 2].map((i) => (i === k ? { mx: 0, my: 0, k: { n: 1, pow: pows[i] } } : { mx: 0, my: 0 }));
    });
    expect(evs.some((e) => e.k === 'draw')).toBe(true);
    expect(s.pekar).toBe(2);
  });
  it('сбил банку → звание; пекарь подбирает и ставит банку', () => {
    const s = ready();
    const c = s.cfg;
    expect(whoThrows(s)).toBe(0);
    let pow = 0.6;
    for (let p = 0.4; p <= 0.9; p += 0.01)
      if (stickFlight(throwFrom(c, s.men[0].x, s.men[0].y, p, yawTo(c, s.men[0].x, s.men[0].y), 'flat'), 'flat', canHome(c)).hit) {
        pow = p;
        break;
      }
    let evs = run(s, 3, () => [{ mx: 0, my: 0, th: { n: 1, pow, yaw: 0, style: 'flat' } }, null, null]);
    expect(evs.some((e) => e.k === 'knock')).toBe(true);
    expect(s.men[0].rank).toBe(1);
    expect(s.can.mode).toBe('down');
    evs = run(s, 8, (st) => {
      const pm = st.men[2];
      const g = st.can.mode === 'held' ? canHome(c) : [st.can.x, st.can.y];
      const dx = g[0] - pm.x;
      const dy = g[1] - pm.y;
      const d = Math.hypot(dx, dy) || 1;
      return [null, null, st.can.mode === 'up' ? { mx: 0, my: 0 } : { mx: dx / d, my: dy / d }];
    });
    expect(evs.some((e) => e.k === 'can' && e.what === 'set')).toBe(true);
    expect(s.can.mode).toBe('up');
  });
  it('в поле — осалили, осаленный пекарь; за чертой — нет', () => {
    const s = ready();
    s.men[0].x = 0;
    s.men[0].y = 10;
    s.men[2].x = 0.8;
    s.men[2].y = 10.2;
    let evs = run(s, 0.1, () => [null, null, { mx: 0, my: 0, a: 1 }]);
    expect(evs.some((e) => e.k === 'tag' && e.who === 0)).toBe(true);
    evs = run(s, 2.5, () => [null, null, null]);
    expect(evs.some((e) => e.k === 'pekar')).toBe(true);
    expect(s.pekar).toBe(0);
    expect(s.sticks[2].at).toBe('hand');
    const t = ready();
    t.men[0].y = -0.5;
    t.men[2].x = 0.3;
    t.men[2].y = -0.3;
    evs = run(t, 0.2, () => [null, null, { mx: 0, my: 0, a: 1 }]);
    expect(evs.some((e) => e.k === 'tag')).toBe(false);
  });
  it('пока банка лежит — не салят', () => {
    const s = ready();
    s.can = { mode: 'down', x: 2, y: 16, a: 0, fx: 0, fy: 14, t0: 0 };
    s.men[0].y = 10;
    s.men[2].x = 0.3;
    s.men[2].y = 10.2;
    const evs = run(s, 0.2, () => [null, null, { mx: 0, my: 0, a: 1 }]);
    expect(evs.some((e) => e.k === 'tag')).toBe(false);
  });
});

describe('пекарь: боты', () => {
  const game = (levels: number[], opts: Record<string, string | number | boolean>, seed: number, maxSec = 1800) => {
    const r = new SeededRng(seed);
    const s = def.setup(
      levels.map((l, i) => ({ seat: i, kind: 'bot' as const, name: `b${i}`, level: l })),
      { ...opts, speed: 1 },
      r,
    );
    const mems = levels.map(() => ({}));
    let k = 0;
    while (!s.over && k < maxSec * 60) {
      const view = def.view(s, 'all');
      const ins = levels.map((l, i) => botInput(view, i, l, mems[i], r));
      step(s, ins, r);
      k++;
    }
    return { s, sec: k / 60 };
  };
  it('партии доходят до конца во всех пресетах', () => {
    for (const p of def.presets!) {
      const { s, sec } = game([2, 1, 0, 2], p.options, 7);
      expect(s.over, p.id).toBe(true);
      console.log(p.id, Math.round(sec), 'с', s.throws, 'бросков', s.winners, s.men.map((m) => `${m.rank}/${m.knocks}`).join(' '));
    }
  }, 120_000);
});
