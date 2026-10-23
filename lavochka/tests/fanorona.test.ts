/* Фанорона: подход и отход, выбор, цепочка с запретами, вела, тэло, показы правил. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { choose } from '../src/games/fanorona/ai';
import { def } from '../src/games/fanorona/def';
import * as fn from '../src/games/fanorona/engine';

const at = (x: number, y: number) => y * 9 + x;
function pos(white: [number, number][], black: [number, number][]) {
  const s = fn.newState(fn.cfgFrom({}));
  s.board.fill(0);
  for (const [x, y] of white) s.board[at(x, y)] = fn.WHITE;
  for (const [x, y] of black) s.board[at(x, y)] = fn.BLACK;
  s.ply = 2;
  return s;
}

describe('Фанорона', () => {
  it('расстановка: по 22, центр пуст', () => {
    const s = fn.newState(fn.cfgFrom({}));
    expect(s.board.filter((v) => v === fn.WHITE).length).toBe(22);
    expect(s.board.filter((v) => v === fn.BLACK).length).toBe(22);
    expect(s.board[at(4, 2)]).toBe(0);
    const d = fn.newState(fn.cfgFrom({ size: 'dimy' }));
    expect(d.board.filter((v) => v === fn.WHITE).length).toBe(12);
  });
  it('взятие обязательно: при взятии пайки нет', () => {
    const s = fn.newState(fn.cfgFrom({}));
    const ms = fn.legal(s);
    expect(ms.length).toBeGreaterThan(0);
    for (const a of ms) {
      if (a.type !== 'move') throw new Error('ход');
      const c = fn.captures(s, a.from, fn.dirOf(s, a.from, a.to), 0);
      expect(c.a.length + c.w.length).toBeGreaterThan(0);
    }
  });
  it('подход снимает весь ряд до пустой точки', () => {
    const s = pos([[1, 2], [7, 2], [0, 4]], [[3, 2], [4, 2], [5, 2], [8, 0]]);
    const r = fn.step(s, { type: 'move', from: at(1, 2), to: at(2, 2) });
    expect(fn.count(r.state, 1)).toBe(1);
    expect(r.state.turn).toBe(1);
  });
  it('подход или отход — выбор', () => {
    const s = pos([[4, 2], [0, 4]], [[1, 2], [2, 2], [3, 2], [6, 2], [8, 0]]);
    const r = fn.step(s, { type: 'move', from: at(4, 2), to: at(5, 2) });
    expect(r.state.pend).not.toBeNull();
    expect(fn.legal(r.state).length).toBe(2);
    const r2 = fn.step(r.state, { type: 'pick', at: at(6, 2) });
    expect(r2.state.board[at(6, 2)]).toBe(0);
    expect(r2.state.board[at(3, 2)]).toBe(fn.BLACK);
  });
  it('цепочка: поворот обязателен, остановиться можно', () => {
    const s = pos([[2, 2], [0, 4]], [[4, 2], [3, 0], [5, 1], [8, 4]]);
    let t = fn.step(s, { type: 'move', from: at(2, 2), to: at(3, 2) }).state;
    expect(t.turn).toBe(0);
    expect(t.chain).not.toBeNull();
    const ms = fn.legal(t);
    expect(ms.some((a) => a.type === 'stop')).toBe(true);
    expect(ms.some((a) => a.type === 'move' && a.to === at(4, 2))).toBe(false);
    t = fn.step(t, { type: 'move', from: at(3, 2), to: at(3, 1) }).state;
    t = fn.step(t, { type: 'move', from: at(3, 1), to: at(4, 1) }).state;
    expect(t.turn).toBe(1);
    expect(fn.count(t, 1)).toBe(1);
    const st = fn.step(fn.step(s, { type: 'move', from: at(2, 2), to: at(3, 2) }).state, { type: 'stop' }).state;
    expect(st.turn).toBe(1);
    expect(fn.count(st, 1)).toBe(3);
  });
  it('первый ход — одно взятие (по желанию)', () => {
    const s = fn.newState(fn.cfgFrom({ opening: true }));
    const a = fn.legal(s)[0];
    let t = fn.step(s, a).state;
    if (t.pend) t = fn.step(t, fn.legal(t)[0]).state;
    expect(t.turn).toBe(1);
  });
  it('вела: берут по одной, отдающий не берёт', () => {
    const s = fn.newState(fn.cfgFrom({ vela: 1 }));
    const r = fn.step(s, { type: 'move', from: at(4, 3), to: at(4, 2) }).state;
    expect(fn.count(r, 1)).toBe(21);
    expect(r.turn).toBe(1);
    const before = fn.count(r, 0);
    for (const a of fn.legal(r)) expect(fn.count(fn.step(r, a).state, 0)).toBe(before);
  });
  it('тэло: три в ряд — победа', () => {
    let s = fn.newState(fn.cfgFrom({ size: 'telo' }));
    for (const p of [4, 0, 2, 1, 6]) s = fn.step(s, { type: 'place', to: p }).state;
    expect(s.over).toBe(true);
    expect(s.winner).toBe(0);
  });
  it('показы правил идут по правилам', () => {
    for (const sec of def.rules.sections) {
      if (!sec.demo) continue;
      let s = sec.demo.setup ? (sec.demo.setup as () => fn.State)() : def.setup(sec.demo.seats, {}, new SeededRng(1));
      for (const st of sec.demo.steps) {
        const r = def.apply(s, st.seat, st.action as fn.Action, new SeededRng(1));
        expect(r, `${sec.title}: ${JSON.stringify(st.action)}`).not.toBeNull();
        s = r!.state;
      }
    }
  });
  it('боты доигрывают все доски', () => {
    for (const size of ['full', 'dimy', 'telo']) {
      let s = fn.newState(fn.cfgFrom({ size }));
      const rng = new SeededRng(3);
      for (let i = 0; i < 2000 && !s.over; i++) {
        const a = choose(s, s.turn, s.turn ? 0 : 1, rng);
        expect(a).not.toBeNull();
        s = fn.apply(s, s.turn, a!)!.state;
      }
      expect(s.over).toBe(true);
    }
  }, 120000);
});
