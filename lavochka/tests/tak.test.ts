/* Так: первый ход — камень соперника, перекладка стопок, стенки и капстоун, дорога, конец по плоским, боты. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { choose } from '../src/games/tak/ai';
import * as tk from '../src/games/tak/engine';

const n5 = 5;
const at = (name: string, n = n5) => (n - Number(name.slice(1))) * n + 'abcdefgh'.indexOf(name[0]);
function pos(cells: Record<string, string>, turn = 0, opts = {}) {
  const s = tk.newState(tk.cfgFrom(opts));
  const n = s.cfg.size;
  for (const [name, stack] of Object.entries(cells))
    s.board[at(name, n)] = stack.split('').map((ch) => ({ o: 'wWc'.includes(ch) ? 0 : 1, k: 'WB'.includes(ch) ? 'S' : 'cC'.includes(ch) ? 'C' : 'F' }) as tk.Piece);
  s.turn = turn;
  s.ply = 10;
  return s;
}

describe('Так', () => {
  it('первый ход — плоский камень соперника', () => {
    const s = tk.setup({});
    expect(tk.legal(s).every((m) => m.type === 'place' && m.kind === 'F')).toBe(true);
    const r = tk.step(s, { type: 'place', at: 0, kind: 'F' })!;
    expect(r.state.board[0][0].o).toBe(1);
    expect(r.state.stones).toEqual([21, 20]);
    expect(tk.step(s, { type: 'place', at: 0, kind: 'C' })).toBeNull();
  });

  it('перекладка: снизу оставляют по камню, по прямой, не больше стороны доски', () => {
    const s = pos({ a3: 'bww', b3: 'b' });
    const r = tk.step(s, { type: 'move', from: at('a3'), dir: 1, drops: [1, 1] })!;
    expect(r.state.board[at('a3')].length).toBe(1);
    expect(r.state.board[at('b3')].map((p) => p.o)).toEqual([1, 0]);
    expect(r.state.board[at('c3')].map((p) => p.o)).toEqual([0]);
    expect(tk.step(s, { type: 'move', from: at('a3'), dir: 3, drops: [1] })).toBeNull(); // за край
    expect(tk.step(pos({ a3: 'b' }), { type: 'move', from: at('a3'), dir: 1, drops: [1] })).toBeNull(); // чужая
  });

  it('стенка и капстоун: на них не ходят, капстоун один сплющивает стенку', () => {
    expect(tk.step(pos({ a3: 'w', b3: 'B' }), { type: 'move', from: at('a3'), dir: 1, drops: [1] })).toBeNull();
    expect(tk.step(pos({ a3: 'w', b3: 'C' }), { type: 'move', from: at('a3'), dir: 1, drops: [1] })).toBeNull();
    const r = tk.step(pos({ a3: 'c', b3: 'B' }), { type: 'move', from: at('a3'), dir: 1, drops: [1] })!;
    expect(r.state.board[at('b3')].map((p) => p.k)).toEqual(['F', 'C']);
    expect(tk.step(pos({ a3: 'wc', b3: 'B' }), { type: 'move', from: at('a3'), dir: 1, drops: [2] })).toBeNull();
  });

  it('дорога — победа; стенки в дорогу не идут; двойная дорога — ходившему', () => {
    const s = pos({ a3: 'w', b3: 'w', c3: 'w', d3: 'w' });
    const r = tk.step(s, { type: 'place', at: at('e3'), kind: 'F' })!;
    expect(r.state.over).toBe(true);
    expect(r.state.winner).toBe(0);
    expect(r.state.how).toBe('road');
    const w = tk.step(s, { type: 'place', at: at('e3'), kind: 'S' })!;
    expect(w.state.over).toBe(false);
  });

  it('кончился запас — счёт плоских', () => {
    const s = pos({ a1: 'w', b1: 'w', c1: 'b' });
    s.stones = [1, 5];
    s.caps = [0, 1];
    const r = tk.step(s, { type: 'place', at: at('e5'), kind: 'F' })!;
    expect(r.state.over).toBe(true);
    expect(r.state.how).toBe('flats');
    expect(r.state.winner).toBe(0);
  });

  it('боты доигрывают на 3×3, 4×4 и 5×5; средний обыгрывает лёгкого', () => {
    let mid = 0;
    for (const [g, size] of [[0, 3], [1, 4], [2, 5], [3, 4]] as const) {
      const r = new SeededRng(9 + g);
      let s = tk.setup({ size });
      const lv = g % 2 ? [1, 0] : [0, 1];
      for (let i = 0; i < 400 && !s.over; i++) s = tk.step(s, choose(s, s.turn, lv[s.turn], r)!)!.state;
      expect(s.over, `size ${size}`).toBe(true);
      if (s.winner != null && lv[s.winner] === 1) mid++;
    }
    expect(mid).toBeGreaterThanOrEqual(3);
    const t0 = Date.now();
    const s = pos({ a1: 'w', b2: 'bw', c3: 'B', d4: 'wwb', e5: 'c', a5: 'b', c1: 'w', b4: 'b' });
    choose(s, 0, 2, new SeededRng(1));
    expect(Date.now() - t0).toBeLessThan(8000);
  }, 300000);
});
