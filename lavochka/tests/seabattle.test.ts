/* Морской бой: расстановка (размеры, касание), стрельба, «ещё выстрел», обводка потопленного, сальво, скрытый флот, боты. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { def, at } from '../src/games/seabattle/def';
import { apply, cfgFrom, makeView, newState, randomFleet, validFleet, type Action, type State } from '../src/games/seabattle/engine';

const rng = () => new SeededRng(3);
const CL = cfgFrom({});

function placed(c = CL): State {
  let s = newState(c);
  s = apply(s, 0, { type: 'place', ships: randomFleet(c, new SeededRng(1)) }, rng())!.state;
  s = apply(s, 1, { type: 'place', ships: randomFleet(c, new SeededRng(2)) }, rng())!.state;
  return { ...s, turn: 0 };
}

describe('расстановка', () => {
  it('случайный флот всегда по правилам', () => {
    for (let i = 0; i < 200; i++) expect(validFleet(randomFleet(CL, new SeededRng(i)), CL)).toBe(true);
    const w = cfgFrom({ fleet: 'west' });
    expect(validFleet(randomFleet(w, new SeededRng(5)), w)).toBe(true);
  });
  it('нельзя касаться, кривые и лишние корабли не принимаются', () => {
    const ok = randomFleet(CL, new SeededRng(9));
    expect(validFleet(ok, CL)).toBe(true);
    expect(validFleet(ok.slice(1), CL)).toBe(false);
    const bent = ok.map((sh) => (sh.length === 3 ? [sh[0], sh[1], sh[1] + 11] : sh));
    expect(validFleet(bent, CL)).toBe(false);
    // два катера по диагонали рядом
    const ones = ok.filter((sh) => sh.length === 1);
    const touching = ok.map((sh) => (sh === ones[1] ? [ones[0][0] + 11 < 100 && ones[0][0] % 10 < 9 ? ones[0][0] + 11 : ones[0][0] - 11] : sh));
    expect(validFleet(touching, CL)).toBe(false);
  });
  it('пока оба не расставились — бой не начинается; потом ходит один', () => {
    let s = newState(CL);
    expect(def.toAct(s).sort()).toEqual([0, 1]);
    s = apply(s, 1, { type: 'place', ships: randomFleet(CL, new SeededRng(1)) }, rng())!.state;
    expect(def.toAct(s)).toEqual([0]);
    s = apply(s, 0, { type: 'place', ships: randomFleet(CL, new SeededRng(2)) }, rng())!.state;
    expect(s.phase).toBe('battle');
    expect(def.toAct(s).length).toBe(1);
  });
});

describe('стрельба', () => {
  it('мимо — ход переходит; попал — ещё; потопил — обводка', () => {
    const sec = def.rules.sections.find((x) => x.title === 'Стрельба')!;
    let s = sec.demo!.setup!(def, rng()) as State;
    for (const st of sec.demo!.steps) s = def.apply(s, st.seat, st.action, rng())!.state;
    // линкор А1-Г1 потоплен, вокруг — заведомо пусто
    expect(s.sunk[1].some((sh) => sh.length === 4)).toBe(true);
    expect(s.shots[1][at('Д1')]).toBe(3);
    expect(s.shots[1][at('А2')]).toBe(3);
    expect(s.turn).toBe(0);
  });
  it('в одну клетку дважды не стреляют', () => {
    let s = placed();
    s = apply(s, 0, { type: 'shoot', cells: [0] }, rng())!.state;
    const seat = s.turn;
    if (seat === 0) expect(apply(s, 0, { type: 'shoot', cells: [0] }, rng())).toBeNull();
  });
  it('сальво: выстрелов — сколько кораблей на плаву', () => {
    const c = cfgFrom({ salvo: true });
    const s = placed(c);
    expect(apply(s, 0, { type: 'shoot', cells: [0, 1, 2] }, rng())).toBeNull();
    const ten = Array.from({ length: 10 }, (_, i) => i * 11 % 100);
    const r = apply(s, 0, { type: 'shoot', cells: ten }, rng());
    expect(r).not.toBeNull();
    expect(r!.state.turn).toBe(1);
  });
  it('чужой флот не виден, кроме потопленных', () => {
    const s = placed();
    const v = makeView(s, [0]);
    expect(v.ships[0].length).toBe(10);
    expect(v.ships[1]).toEqual([]);
  });
});

describe('боты', () => {
  it('доигрывают, и сложный топит быстрее лёгкого', async () => {
    const shotsTo = async (lv: number, g: number) => {
      let s = newState(CL);
      s = apply(s, 0, { type: 'place', ships: randomFleet(CL, new SeededRng(100 + g)) }, rng())!.state;
      s = apply(s, 1, { type: 'place', ships: randomFleet(CL, new SeededRng(200 + g)) }, rng())!.state;
      const r = new SeededRng(g);
      let n = 0;
      while (s.phase === 'battle' && n < 100) {
        s = { ...s, turn: 0 };
        const a = (await def.bot.choose(makeView(s, [0]), 0, lv, r)) as Action;
        s = apply(s, 0, a, r)!.state;
        n++;
      }
      expect(s.phase).toBe('over');
      return n;
    };
    let easy = 0;
    let hard = 0;
    for (let i = 0; i < 20; i++) {
      easy += await shotsTo(0, i);
      hard += await shotsTo(2, i);
    }
    expect(hard).toBeLessThan(easy);
  });
});
