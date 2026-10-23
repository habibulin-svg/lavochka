/* Перекати-поле: перекат и шляпка, без прыжков, финиш и фиксация, запрет повтора, запертые кубики, показы правил, боты. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { choose } from '../src/games/perekati/ai';
import { def } from '../src/games/perekati/def';
import * as pk from '../src/games/perekati/engine';

const C = pk.cfgFrom({ size: 'malysh' });
const at = (x: number, y: number) => pk.at(C, x, y);
const mv = (x: number, y: number, x2: number, y2: number): pk.Action => ({ type: 'move', from: at(x, y), to: at(x2, y2) });
function pos(cubes: [number, number, number, number][], turn = 0) {
  const s = pk.newState(C, turn);
  s.board.fill(-1);
  const n = [0, 0];
  for (const [seat, x, y, f] of cubes) {
    const id = pk.cubeId(seat, n[seat]++);
    s.board[at(x, y)] = id;
    s.face[id] = f;
  }
  return s;
}

describe('Перекати-поле', () => {
  it('поля и расстановка', () => {
    for (const [size, w, l] of [['print', 6, 8], ['malysh', 5, 6], ['drawing', 5, 7]] as const) {
      const s = pk.newState(pk.cfgFrom({ size }));
      expect(s.board.length).toBe(w * l);
      expect(s.board.filter((v) => v >= 0).length).toBe(2 * w);
      expect(pk.done(s, 0)).toBe(0);
    }
    // жребий решает, кто первый
    const firsts = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((k) => pk.setup({}, new SeededRng(k)).turn));
    expect(firsts.size).toBe(2);
  });
  it('перекат: шляпка обходит грани, четыре переката — снова вверх', () => {
    let f = pk.UP;
    for (let i = 0; i < 4; i++) {
      f = pk.roll(f, 0);
      expect(f).toBe([pk.NORTH, pk.DOWN, pk.SOUTH, pk.UP][i]);
    }
    expect(pk.roll(pk.UP, 2)).toBe(pk.EAST);
    expect(pk.roll(pk.EAST, 3)).toBe(pk.UP);
    expect(pk.roll(pk.NORTH, 2)).toBe(pk.NORTH);
    // таблица расстояний: соседняя клетка шляпкой вверх — за 3 переката
    const t = pk.distTable(C);
    expect(t[at(1, 0)][at(0, 0) * 6 + pk.UP]).toBe(3);
    expect(t[at(0, 4)][at(0, 0) * 6 + pk.UP]).toBe(4);
  });
  it('только на свободную соседнюю, без диагонали и прыжков; кубик на финише шляпкой вверх не двигается', () => {
    const s = pos([[0, 2, 3, pk.UP], [1, 2, 2, pk.UP], [1, 0, 0, pk.UP]]);
    const to = pk.legal(s).filter((a) => a.from === at(2, 3)).map((a) => a.to).sort((a, b) => a - b);
    expect(to).toEqual([at(1, 3), at(3, 3), at(2, 4)].sort((a, b) => a - b));
    const f = pos([[0, 2, 1, pk.SOUTH], [0, 0, 5, pk.UP], [1, 4, 4, pk.UP]]);
    const r = pk.step(f, mv(2, 1, 2, 0));
    expect(r.events[0]).toMatchObject({ type: 'move', locked: true });
    expect(pk.done(r.state, 0)).toBe(1);
    const r2 = pk.step(r.state, mv(4, 4, 4, 5));
    expect(pk.legal(r2.state).some((a) => a.from === at(2, 0))).toBe(false);
  });
  it('все на финише — победа', () => {
    const cubes: [number, number, number, number][] = [0, 1, 2, 3].map((x) => [0, x, 0, pk.UP] as [number, number, number, number]);
    cubes.push([0, 4, 1, pk.SOUTH], [1, 0, 3, pk.UP]);
    const r = pk.step(pos(cubes), mv(4, 1, 4, 0));
    expect(r.state.over).toBe(true);
    expect(r.state.winner).toBe(0);
    expect(def.result(r.state)?.winners).toEqual([0]);
  });
  it('больше двух раз один и тот же ход нельзя (если есть другой)', () => {
    let s = pk.newState(C, 0);
    const seq: [number, pk.Action][] = [
      [0, mv(2, 5, 2, 4)],
      [1, mv(0, 0, 0, 1)],
      [0, mv(2, 4, 2, 5)],
      [1, mv(0, 1, 1, 1)],
      [0, mv(2, 5, 2, 4)],
      [1, mv(1, 1, 1, 2)],
      [0, mv(2, 4, 2, 5)],
      [1, mv(1, 2, 1, 3)],
    ];
    for (const [seat, a] of seq) s = pk.apply(s, seat, a)!.state;
    expect(pk.apply(s, 0, mv(2, 5, 2, 4))).toBeNull();
    expect(pk.apply(s, 0, mv(1, 5, 1, 4))).not.toBeNull();
    // единственный ход разрешён и повтором
    const blocker = pos([[0, 0, 0, pk.NORTH], [1, 1, 0, pk.UP], [1, 1, 1, pk.UP], [1, 4, 4, pk.UP]]);
    blocker.hist[0] = [`${at(0, 0)}-${at(0, 1)}-${pk.NORTH}`, `${at(0, 0)}-${at(0, 1)}-${pk.NORTH}`];
    expect(pk.legal(blocker)).toEqual([mv(0, 0, 0, 1)]);
  });
  it('заперты — конец, считают кубики на финише', () => {
    const s = pos([
      [0, 0, 1, pk.UP],
      [0, 1, 1, pk.UP],
      [0, 2, 1, pk.SOUTH],
      [0, 0, 5, pk.UP],
      [0, 1, 5, pk.UP],
      [1, 0, 0, pk.UP],
      [1, 1, 0, pk.UP],
      [1, 2, 5, pk.UP],
      [1, 3, 5, pk.UP],
      [1, 4, 5, pk.UP],
    ]);
    const r = pk.step(s, mv(2, 1, 2, 0));
    expect(r.state.over).toBe(true);
    expect(r.state.why).toBe('stuck');
    expect(r.state.winner).toBe(1);
    expect(r.events.at(-1)).toMatchObject({ type: 'end', done: [1, 3], stuck: 1 });
  });
  it('показы правил идут по правилам', () => {
    for (const sec of def.rules.sections) {
      if (!sec.demo) continue;
      let s = sec.demo.setup ? (sec.demo.setup as () => pk.State)() : def.setup(sec.demo.seats, sec.demo.options ?? {}, new SeededRng(1));
      for (const st of sec.demo.steps) {
        const r = def.apply(s, st.seat, st.action as pk.Action, new SeededRng(1));
        expect(r, `${sec.title}: ${JSON.stringify(st.action)}`).not.toBeNull();
        s = r!.state;
      }
    }
    expect(def.showcase!().over).toBe(false);
  });
  it('боты доигрывают на всех полях, сложный сильнее лёгкого', () => {
    let hard = 0;
    let easy = 0;
    for (const size of ['malysh', 'drawing', 'print']) {
      for (let g = 0; g < 4; g++) {
        const rng = new SeededRng(40 + g);
        let s = pk.setup({ size }, rng);
        const lv = g % 2 ? [2, 0] : [0, 2];
        for (let i = 0; i < pk.PLY_LIMIT + 2 && !s.over; i++) {
          const a = choose(s, s.turn, lv[s.turn], rng);
          expect(a).not.toBeNull();
          s = pk.apply(s, s.turn, a!)!.state;
        }
        expect(s.over).toBe(true);
        if (s.winner != null) (lv[s.winner] === 2 ? hard++ : easy++);
      }
    }
    expect(hard).toBeGreaterThan(easy);
  }, 240000);
});
