/* Санторин: расстановка, шаг (не выше чем на ярус, не на купол и строителя), постройка, купол, победа подъёмом, проигрыш без ходов, боты. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { choose } from '../src/games/santorini/ai';
import * as st from '../src/games/santorini/engine';

const at = (r: number, c: number) => r * st.N + c;
function pos(h: Record<number, number>, w0: number[], w1: number[], turn = 0) {
  const s = st.newState();
  for (const [c, v] of Object.entries(h)) {
    if (v === 4) (s.h[Number(c)] = 3), (s.dome[Number(c)] = true);
    else s.h[Number(c)] = v;
  }
  s.workers = [w0, w1];
  s.phase = 'move';
  s.turn = turn;
  return s;
}

describe('Санторин', () => {
  it('расстановка: двое белых, потом двое синих, потом ход белых', () => {
    let s = st.setup({});
    for (const c of [0, 1, 2, 3]) s = st.step(s, { type: 'place', at: c })!.state;
    expect(s.workers).toEqual([
      [0, 1],
      [2, 3],
    ]);
    expect(s.phase).toBe('move');
    expect(s.turn).toBe(0);
    expect(st.step(st.setup({}), { type: 'move', w: 0, to: 1 })).toBeNull();
  });

  it('шаг: вверх не больше яруса, вниз — сколько угодно, не на купол и не на строителя', () => {
    const s = pos({ [at(1, 1)]: 1, [at(1, 2)]: 2, [at(2, 1)]: 4, [at(0, 0)]: 3 }, [at(1, 0), at(4, 4)], [at(2, 0), at(4, 0)]);
    const to = st.legal(s).filter((a) => a.type === 'move' && a.w === 0).map((a) => (a as { to: number }).to);
    expect(to).toContain(at(1, 1));
    expect(to).not.toContain(at(0, 0)); // ярус 3 с нуля
    expect(to).not.toContain(at(2, 1)); // купол
    expect(to).not.toContain(at(2, 0)); // строитель
  });

  it('после шага — постройка рядом; на третьем ярусе — купол', () => {
    let s = pos({ [at(2, 3)]: 3 }, [at(2, 1), at(4, 4)], [at(0, 0), at(0, 4)]);
    s = st.step(s, { type: 'move', w: 0, to: at(2, 2) })!.state;
    expect(s.phase).toBe('build');
    expect(st.step(s, { type: 'build', at: at(4, 4) })).toBeNull();
    s = st.step(s, { type: 'build', at: at(2, 3) })!.state;
    expect(s.dome[at(2, 3)]).toBe(true);
    expect(s.turn).toBe(1);
  });

  it('подъём на третий ярус — победа', () => {
    const s = pos({ [at(2, 2)]: 2, [at(2, 3)]: 3 }, [at(2, 2), at(4, 4)], [at(0, 0), at(0, 4)]);
    const r = st.step(s, { type: 'move', w: 0, to: at(2, 3) })!;
    expect(r.state.over).toBe(true);
    expect(r.state.winner).toBe(0);
  });

  it('нет ходов — проигрыш', () => {
    // оба синих в углах: вокруг купола и ярус 2, на который с земли не подняться
    const s = pos({ [at(0, 1)]: 4, [at(1, 0)]: 4, [at(1, 1)]: 2, [at(0, 3)]: 4, [at(1, 4)]: 4, [at(1, 3)]: 1 }, [at(3, 3), at(4, 0)], [at(0, 0), at(0, 4)]);
    let r = st.step(s, { type: 'move', w: 0, to: at(2, 3) })!;
    expect(r.state.over).toBe(false);
    r = st.step(r.state, { type: 'build', at: at(1, 3) })!; // 1 → 2: последний выход закрыт
    expect(r.state.over).toBe(true);
    expect(r.state.winner).toBe(0);
    expect(r.state.how).toBe('stuck');
  });

  it('боты доигрывают партию', () => {
    let s = st.setup({});
    const rng = new SeededRng(5);
    for (let i = 0; i < 400 && !s.over; i++) s = st.step(s, choose(s, s.turn, i % 2 ? 2 : 1, rng)!)!.state;
    expect(s.over).toBe(true);
  });
});
