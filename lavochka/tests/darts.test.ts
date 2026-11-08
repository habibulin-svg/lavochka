import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { checkout, choose, SHAKE } from '../src/games/darts/ai';
import { aimFor, hitAt, label, ORDER, R, sectorAt, wireDist, type Hit } from '../src/games/darts/board';
import { def } from '../src/games/darts/def';
import { apply, cfgFrom, newState, setup, type Action, type State } from '../src/games/darts/engine';
import { flight, land, V0 } from '../src/games/darts/physics';

/** Бросок «как надо» в поле (n, m) — приходит точно в середину поля. */
const at = (n: number, m: number, extra: Partial<Action> = {}): Action => ({ type: 'throw', ...aimFor(n, m), v: V0, side: 0, ...extra });
const rng = () => new SeededRng(7);

function run(s: State, seat: number, acts: Action[]) {
  let st = s;
  const evs = [];
  for (const [k, a0] of acts.entries()) {
    // дротики подхода — чуть врозь, чтобы не попасть в торчащий (это отдельный тест)
    const rr = Math.hypot(a0.x, a0.y);
    const d = ((k % 3) - 1) * 0.007;
    const a = rr > 0.02 ? { ...a0, x: a0.x + (a0.y / rr) * d, y: a0.y - (a0.x / rr) * d } : a0;
    const r = apply(st, seat, a, rng());
    expect(r, label(hitAt(a.x, a.y))).not.toBeNull();
    st = r!.state;
    evs.push(...r!.events);
  }
  return { s: st, evs };
}

describe('дартс: мишень', () => {
  it('сектора по порядку, 20 сверху, по часовой', () => {
    expect(ORDER).toEqual([20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5]);
    expect(hitAt(0, 0.05)).toEqual({ n: 20, m: 1 });
    expect(hitAt(0.05, 0)).toEqual({ n: 6, m: 1 });
    expect(hitAt(0, -0.05)).toEqual({ n: 3, m: 1 });
    expect(hitAt(-0.05, 0)).toEqual({ n: 11, m: 1 });
    expect(sectorAt(Math.sin(0.15), Math.cos(0.15))).toBe(0); // 8,6° — ещё «20»
    expect(sectorAt(Math.sin(0.16), Math.cos(0.16))).toBe(1); // 9,2° — уже «1»
  });
  it('кольца: бык, 25, утроение, удвоение, мимо', () => {
    expect(hitAt(0, 0.006)).toEqual({ n: 25, m: 2 });
    expect(hitAt(0, 0.01)).toEqual({ n: 25, m: 1 });
    expect(hitAt(0, 0.103)).toEqual({ n: 20, m: 3 });
    expect(hitAt(0, 0.166)).toEqual({ n: 20, m: 2 });
    expect(hitAt(0, 0.171)).toEqual({ n: 0, m: 0 });
    for (const n of ORDER)
      for (const m of [1, 2, 3]) expect(hitAt(aimFor(n, m).x, aimFor(n, m).y), `${n}×${m}`).toEqual({ n, m });
  });
  it('проволока: кольца и лучи', () => {
    expect(wireDist(0, R.tripleIn)).toBeLessThan(1e-9);
    expect(wireDist(aimFor(20, 3).x, aimFor(20, 3).y)).toBeGreaterThan(0.003);
    const a = (9 * Math.PI) / 180;
    expect(wireDist(Math.sin(a) * 0.13, Math.cos(a) * 0.13)).toBeLessThan(1e-9);
  });
});

describe('дартс: полёт', () => {
  it('«как надо» — точно в прицел; слабее — ниже, сильнее — выше; увод — вбок', () => {
    const a = aimFor(20, 3);
    const f = flight({ ...a, v: V0, side: 0 });
    expect(Math.hypot(f.at!.x - a.x, f.at!.y - a.y)).toBeLessThan(1e-4);
    const weak = flight({ ...a, v: V0 - 0.3, side: 0 }).at!;
    const hard = flight({ ...a, v: V0 + 0.3, side: 0 }).at!;
    expect(weak.y).toBeLessThan(a.y - 0.02);
    expect(hard.y).toBeGreaterThan(a.y + 0.02);
    expect(flight({ ...a, v: V0, side: 0.02 }).at!.x).toBeGreaterThan(0.02);
    // дротик приходит сверху вниз (дуга)
    expect(Math.atan2(-f.at!.vy, -f.at!.vz)).toBeGreaterThan(0.08);
  });
  it('мимо мишени — в шкафчик; совсем слабый — на пол', () => {
    expect(land({ x: 0, y: 0.3, v: V0, side: 0 }, [], () => 99).res).toBe('off');
    const w = land({ x: 0, y: 0, v: 3.5, side: 0 }, [], () => 99);
    expect(['off', 'weak']).toContain(w.res);
  });
  it('проволока: отскок или соскальзывание по жребию', () => {
    expect(land({ x: 0, y: R.doubleOut, v: V0, side: 0 }, [], () => 0).res).toBe('wire');
    expect(land({ x: 0, y: R.doubleOut, v: V0, side: 0 }, [], () => 99).res).toBe('stick');
  });
  it('в торчащий дротик: отскок или рядом', () => {
    const a = aimFor(20, 3);
    const st = [{ ...a, inc: 0.2, lat: 0, seat: 0 }];
    expect(land({ ...a, v: V0, side: 0 }, st, () => 0).res).toBe('dart');
    const r = land({ ...a, v: V0, side: 0 }, st, () => 99);
    expect(r.res).toBe('stick');
    expect(Math.hypot(r.x! - a.x, r.y! - a.y)).toBeGreaterThan(0.004);
  });
});

describe('дартс: 501 и 301', () => {
  it('отнимает очки, три дротика — ход следующему, дротики вынуты', () => {
    const s0 = setup({ mode: 'x01', start: 501 }, [0, 1], rng());
    const { s, evs } = run(s0, 0, [at(20, 3), at(20, 3), at(20, 3)]);
    expect(s.p[0].score).toBe(321);
    expect(s.cur).toBe(1);
    expect(s.stuck).toHaveLength(0);
    expect(evs.some((e) => e.k === 'turn')).toBe(true);
  });
  it('дротики торчат до конца подхода', () => {
    const s0 = setup({ mode: 'x01', start: 501 }, [0, 1], rng());
    const { s } = run(s0, 0, [at(20, 3), at(19, 3)]);
    expect(s.stuck).toHaveLength(2);
    expect(s.cur).toBe(0);
  });
  it('double out: закрыть удвоением', () => {
    const s0 = setup({ mode: 'x01', start: 501, dout: true }, [0, 1], rng());
    s0.p[0].score = 40;
    s0.turnStart = 40;
    const { s } = run(s0, 0, [at(20, 2)]);
    expect(s.over).toBe(true);
    expect(s.winners).toEqual([0]);
    expect(def.result(s)!.winners).toEqual([0]);
  });
  it('перебор: больше остатка, единица, ноль не удвоением — счёт к началу подхода', () => {
    for (const [rem, acts] of [
      [32, [at(20, 1), at(20, 1)]],
      [41, [at(20, 2)]],
      [40, [at(20, 1), at(20, 1)]],
    ] as [number, Action[]][]) {
      const s0 = setup({ mode: 'x01', start: 501, dout: true }, [0, 1], rng());
      s0.p[0].score = rem;
      s0.turnStart = rem;
      const { s, evs } = run(s0, 0, acts);
      expect(evs.some((e) => e.k === 'bust'), `${rem}`).toBe(true);
      expect(s.p[0].score).toBe(rem);
      expect(s.cur).toBe(1);
      expect(s.over).toBe(false);
    }
  });
  it('без double out ноль одиночным — победа', () => {
    const s0 = setup({ mode: 'x01', start: 301, dout: false }, [0, 1], rng());
    s0.p[0].score = 20;
    s0.turnStart = 20;
    expect(run(s0, 0, [at(20, 1)]).s.over).toBe(true);
  });
  it('double in: до удвоения не считается', () => {
    const s0 = setup({ mode: 'x01', start: 301, din: true }, [0, 1], rng());
    const { s } = run(s0, 0, [at(20, 3), at(20, 2), at(20, 3)]);
    expect(s.p[0].score).toBe(301 - 40 - 60);
    expect(s.p[0].opened).toBe(true);
  });
  it('несколько легов: начинает следующий', () => {
    const s0 = setup({ mode: 'x01', start: 501, legs: 2 }, [0, 1], rng());
    s0.p[0].score = 50;
    s0.turnStart = 50;
    const { s } = run(s0, 0, [at(25, 2)]);
    expect(s.over).toBe(false);
    expect(s.p[0].legs).toBe(1);
    expect(s.p.map((p) => p.score)).toEqual([501, 501]);
    expect(s.cur).toBe(1);
  });
  it('таблица закрытий', () => {
    expect(checkout(170, 3, true)!.hits.map(label)).toEqual(['T20', 'T20', 'Бык']);
    expect(checkout(100, 3, true)!.hits.map(label)).toEqual(['T20', 'D20']);
    expect(checkout(40, 1, true)!.hits.map(label)).toEqual(['D20']);
    expect(checkout(159, 3, true)).toBeNull();
    expect(checkout(1, 3, true)).toBeNull();
    for (let r = 2; r <= 170; r++) {
      const c = checkout(r, 3, true);
      if (!c) continue;
      const last = c.hits[c.hits.length - 1];
      expect(c.hits.reduce((a, h) => a + h.n * h.m, 0), `${r}`).toBe(r);
      expect(last.m, `${r}`).toBe(2);
    }
  });
});

describe('дартс: остальные игры', () => {
  it('Вокруг света: по порядку, с «прыжками» — дальше', () => {
    const s0 = setup({ mode: 'clock' }, [0, 1], rng());
    let { s } = run(s0, 0, [at(1, 1), at(2, 3), at(5, 1)]);
    expect(s.p[0].target).toBe(3);
    const k0 = setup({ mode: 'clock', skip: true }, [0, 1], rng());
    ({ s } = run(k0, 0, [at(1, 1), at(2, 3)]));
    expect(s.p[0].target).toBe(5);
    const e0 = setup({ mode: 'clock', bull: true }, [0, 1], rng());
    e0.p[0].target = 20;
    ({ s } = run(e0, 0, [at(20, 1), at(25, 1)]));
    expect(s.over).toBe(true);
  });
  it('крикет: закрытие и очки только по открытому у соперника', () => {
    const s0 = setup({ mode: 'cricket' }, [0, 1], rng());
    let { s } = run(s0, 0, [at(20, 3), at(20, 3), at(19, 1)]);
    expect(s.p[0].marks[0]).toBe(3);
    expect(s.p[0].score).toBe(60);
    expect(s.p[0].marks[1]).toBe(1);
    // соперник закрыл 20 — очков больше нет
    ({ s } = run(s, 1, [at(20, 3), at(14, 1), at(14, 1)]));
    ({ s } = run(s, 0, [at(20, 3)]));
    expect(s.p[0].score).toBe(60);
  });
  it('крикет: победа — всё закрыто и очков не меньше', () => {
    const s0 = setup({ mode: 'cricket' }, [0, 1], rng());
    s0.p[0].marks = [3, 3, 3, 3, 3, 3, 1];
    s0.p[0].score = 10;
    s0.p[1].score = 0;
    const { s } = run(s0, 0, [at(25, 2)]);
    expect(s.over).toBe(true);
    expect(s.winners).toEqual([0]);
  });
  it('крикет «головорез»: очки соперникам', () => {
    const s0 = setup({ mode: 'cricket', cut: true }, [0, 1], rng());
    const { s } = run(s0, 0, [at(20, 3), at(20, 2)]);
    expect(s.p[0].score).toBe(0);
    expect(s.p[1].score).toBe(40);
  });
  it('Шанхай: только сектор раунда, «Шанхай» — победа', () => {
    const s0 = setup({ mode: 'shanghai' }, [0, 1], rng());
    let { s } = run(s0, 0, [at(1, 3), at(2, 3), at(1, 1)]);
    expect(s.p[0].score).toBe(4);
    const k = setup({ mode: 'shanghai' }, [0, 1], rng());
    k.round = 4;
    ({ s } = run(k, 0, [at(4, 1), at(4, 2), at(4, 3)]));
    expect(s.over).toBe(true);
  });
  it('Убийца: стать убийцей и снимать жизни', () => {
    const s0 = setup({ mode: 'killer', lives: 3 }, [0, 1], rng());
    s0.p[0].num = 16;
    s0.p[1].num = 5;
    const { s } = run(s0, 0, [at(5, 2), at(16, 2), at(5, 2)]);
    expect(s.p[0].killer).toBe(true);
    expect(s.p[1].lives).toBe(2);
  });
  it('предел раундов — решает счёт', () => {
    const s0 = setup({ mode: 'x01', start: 301 }, [0], rng());
    let s = s0;
    const miss = at(0, 0, { y: 0.3 });
    for (let k = 0; k < 200 && !s.over; k++) s = apply(s, 0, miss, rng())!.state;
    expect(s.over).toBe(true);
  });
});

describe('дартс: боты', () => {
  const play = (lv: number[], o: Record<string, unknown>, seed: number) => {
    const r = new SeededRng(seed);
    let s = setup(o as never, [0, 1], r);
    let darts = 0;
    while (!s.over && darts < 2000) {
      const seat = s.seats[s.cur];
      const a = choose(s, seat, lv[seat], r)!;
      s = apply(s, seat, a, r)!.state;
      darts++;
    }
    return s;
  };
  it('сильный обыгрывает слабого чаще', () => {
    expect(SHAKE[2].aim).toBeLessThan(SHAKE[0].aim);
    let w = 0;
    for (let k = 0; k < 20; k++) if (play([2, 0], { mode: 'x01', start: 301 }, k + 1).winners[0] === 0) w++;
    expect(w).toBeGreaterThanOrEqual(15);
  });
  it('все игры доигрываются', () => {
    for (const p of def.presets!) {
      const s = play([1, 1], p.options, 3);
      expect(s.over, p.id).toBe(true);
    }
  });
  it('сложный на 501 закрывает лег разумным числом дротиков', () => {
    const r = new SeededRng(11);
    let total = 0;
    for (let k = 0; k < 10; k++) {
      let s = setup({ mode: 'x01', start: 501 }, [0], r);
      while (!s.over) s = apply(s, 0, choose(s, 0, 2, r)!, r)!.state;
      total += s.p[0].legDarts;
    }
    expect(total / 10).toBeLessThan(40);
  });
});

void ({} as Hit);
void newState;
void cfgFrom;
