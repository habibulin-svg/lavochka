import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { choose } from '../src/games/gorodki/ai';
import { def } from '../src/games/gorodki/def';
import { apply, cfgFrom, layout, lineOf, newState, resolve, type Action, type State } from '../src/games/gorodki/engine';
import { FIGURES, FIVE, TEN } from '../src/games/gorodki/figures';
import { inCity, inZone, landY, launch, powFor, rod, simulate } from '../src/games/gorodki/physics';

const at = (fig: string): State => {
  const s = newState(cfgFrom({}), [0, 1]);
  s.p[0].fig = s.cfg.figs.indexOf(fig);
  s.p[0].rods = layout(fig);
  return s;
};
const T = (x: number, ang: number, pow: number, spin = 0.6): Action => ({ type: 'throw', x, ang, pow, spin });

describe('городки: фигуры', () => {
  it('15 фигур по 5 городков, все в городе, не налезают друг на друга', () => {
    expect(FIGURES).toHaveLength(15);
    for (const f of FIGURES) {
      expect(f.pieces, f.name).toHaveLength(5);
      const rods = f.pieces.map((p) => rod(p.x, p.y, p.a, !!p.stand));
      for (const r of rods) expect(inCity(r), f.name).toBe(true);
      // расстановка неподвижна: «пустой» шаг физики ничего не сдвигает
      const bat = launch({ x: 0, ang: 0, pow: 0, spin: 0 }, -30);
      bat.y = -40;
      const sim = simulate(bat, rods, false);
      sim.rods.forEach((r, k) => expect(Math.hypot(r.x - rods[k].x, r.y - rods[k].y), `${f.name} #${k}`).toBeLessThan(0.01));
    }
    expect(TEN.every((id) => FIGURES.some((f) => f.id === id))).toBe(true);
    expect(FIVE.every((id) => FIGURES.some((f) => f.id === id))).toBe(true);
    expect(FIGURES.filter((f) => f.pieces.some((p) => p.mark)).map((f) => f.id)).toEqual(['pismo']);
  });
});

describe('городки: физика', () => {
  it('бросок детерминирован', () => {
    const rods = layout('zvezda').map((l) => rod(l.x, l.y, l.a, !!l.st));
    const a = simulate(launch({ x: 0.2, ang: -0.01, pow: 0.76, spin: 0.5 }, -13), rods, false);
    const b = simulate(launch({ x: 0.2, ang: -0.01, pow: 0.76, spin: 0.5 }, -13), rods, false);
    expect(JSON.stringify(a.rods)).toBe(JSON.stringify(b.rods));
  });
  it('powFor обратна landY', () => {
    for (const line of [-13, -6.5]) for (const y of [-0.5, 0, 0.8]) expect(landY(powFor(y, 0.05, line), 0.05, line)).toBeCloseTo(y, 2);
  });
  it('зона: город и пригород-трапеция', () => {
    expect(inZone(rod(0, -0.5, 0))).toBe(true);
    expect(inZone(rod(1.6, -0.9, 0))).toBe(true);
    expect(inZone(rod(1.6, -0.2, 0))).toBe(false);
    expect(inZone(rod(0, -1.2, 0))).toBe(false);
    expect(inZone(rod(0, 2.02, 0))).toBe(true); // краем на задней линии
    expect(inZone(rod(0, 2.04, 0))).toBe(false);
  });
});

describe('городки: правила', () => {
  it('недолёт — потерянный бросок, городки на месте, бита засчитана', () => {
    const s = at('zvezda');
    const r = apply(s, 0, T(0, 0, powFor(-3, 0, -13)))!;
    const ev = r.events[0] as Extract<typeof r.events[0], { k: 'throw' }>;
    expect(ev.lost).toBe(true);
    expect(r.state.p[0].rods).toEqual(s.p[0].rods);
    expect(r.state.p[0].throws).toBe(1);
    expect(r.state.p[0].kon).toBe(true);
  });
  it('выбит хоть один — дальше с полукона; новая фигура — снова с кона', () => {
    let s = at('kolodec');
    let r = apply(s, 0, T(0.4, -0.0308, 0.8237))!;
    expect(r.state.p[0].figKnocked).toBeGreaterThan(0);
    expect(r.state.p[0].kon).toBe(false);
    expect(lineOf(r.state, 0)).toBe(-6.5);
    s = at('pushka');
    r = apply(s, 0, T(0, 0, 0.7676))!;
    expect(r.events.some((e) => e.k === 'figure')).toBe(true);
    expect(r.state.p[0].kon).toBe(true);
  });
  it('«Письмо» — только с кона', () => {
    const s = at('pismo');
    const r = apply(s, 0, T(0, 0, 0.7817))!;
    expect(r.state.p[0].figKnocked).toBeGreaterThan(0);
    expect(r.state.p[0].kon).toBe(true);
  });
  it('марка, задевшая соседей, возвращается в центр', () => {
    // марка в «Письме» с соседом вплотную: бита сносит обоих
    const s = at('pismo');
    s.p[0].rods = [
      { x: 0, y: 1, a: 0, mark: 1 },
      { x: 0, y: 1.06, a: 0 },
    ];
    let found = false;
    for (let k = 0; k < 40 && !found; k++) {
      const pow = powFor(0.7 + k * 0.01, 0, -13);
      const res = resolve(s, 0, { x: 0, ang: 0, pow, spin: 0.3 });
      if (res.markBack) {
        found = true;
        const mk = res.after.find((l) => l.mark)!;
        expect(mk).toBeTruthy();
        expect(mk.x).toBe(0);
        expect(mk.y).toBe(1);
      }
    }
    expect(found).toBe(true);
  });
  it('у штрафной линии — на отметку 20 или 40 см', () => {
    const s = at('pushka');
    // городок лежит в пригороде у самой штрафной линии; бросок мимо
    s.p[0].rods = [{ x: 0.5, y: -0.95, a: 0 }, ...s.p[0].rods.slice(1)];
    s.p[0].figKnocked = 1;
    const res = resolve(s, 0, { x: 1.4, ang: 0.3, pow: powFor(3, 0.3, -6.5), spin: 0 });
    expect(res.lost).toBe(false);
    expect(res.moved).toHaveLength(1);
    expect(res.after[res.moved[0]].y).toBeCloseTo(-0.8 + 0.025, 5);
    const s2 = at('pushka');
    s2.p[0].rods = [{ x: 0.5, y: -0.95, a: 0 }, ...s2.p[0].rods.slice(1)];
    const res2 = resolve(s2, 0, { x: 1.4, ang: 0.3, pow: powFor(3, 0.3, -13), spin: 0 });
    expect(res2.after[res2.moved[0]].y).toBeCloseTo(-0.6 + 0.025, 5);
  });
  it('подход — две биты, потом ход следующему', () => {
    let s = def.setup(def.rules.sections[0].demo!.seats, {}, new SeededRng(1));
    expect(def.toAct(s)).toEqual([0]);
    s = def.apply(s, 0, T(0, 0, powFor(-3, 0, -13)), new SeededRng(1))!.state;
    expect(def.toAct(s)).toEqual([0]);
    s = def.apply(s, 0, T(0, 0, powFor(-3, 0, -13)), new SeededRng(1))!.state;
    expect(def.toAct(s)).toEqual([1]);
    expect(def.apply(s, 0, T(0, 0, 0.5), new SeededRng(1))).toBeNull();
    expect(def.apply(s, 1, { type: 'throw', x: 9, ang: 0, pow: 0.5, spin: 0 } as Action, new SeededRng(1))).toBeNull();
  });
  it('сильный бот выбивает 15 фигур за разумное число бит', () => {
    let s = newState(cfgFrom({}), [0]);
    const rng = new SeededRng(3);
    let n = 0;
    while (!s.over && n < 200) {
      s = apply(s, 0, choose(s, 0, 1, rng)!)!.state;
      n++;
    }
    expect(s.over).toBe(true);
    expect(s.p[0].done).toBe(true);
    expect(s.p[0].throws).toBeLessThan(70);
    expect(def.result(s)!.winners).toEqual([0]);
  }, 60_000);
});

describe('журнал: подпись подхода', () => {
  it('кон 8 м — «с кона», полукон 4 м — «с полукона»', () => {
    const mk = (line: number) =>
      ({ k: 'throw', seat: 0, t: 0, line, fig: 'pushka', before: [], after: [], lost: false, out: [], markBack: false, moved: [] }) as never;
    const n = () => 'Я';
    expect(def.describe!(mk(-8), n)).toContain('с кона');
    expect(def.describe!(mk(-4), n)).toContain('с полукона');
    expect(def.describe!(mk(-6.5), n)).toContain('с полукона');
  });
});
