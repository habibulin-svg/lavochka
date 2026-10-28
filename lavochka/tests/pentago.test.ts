/* Пентаго: поворот квадранта, ряд до и после поворота, ничья, большая доска на четверых, поворот по желанию, показы, боты. */
import { describe, expect, it } from 'vitest';
import { breather } from './harness';
import { SeededRng } from '../src/core/rng';
import { choose } from '../src/games/pentago/ai';
import { def } from '../src/games/pentago/def';
import * as pt from '../src/games/pentago/engine';

function pos(rows: string[], turn = 0, o: Record<string, unknown> = {}) {
  const c = pt.cfgFrom({ size: rows.length, ...o });
  const s = pt.newState(c, [0, 1, 2, 3].slice(0, rows.length === 9 ? 4 : 2));
  rows.forEach((r, y) => [...r].forEach((ch, x) => (s.board[y * c.size + x] = '.xorb'.indexOf(ch) - 1)));
  s.turn = turn;
  return s;
}
const place = (x: number, y: number, n = 6): pt.Action => ({ type: 'place', p: y * n + x });

describe('Пентаго', () => {
  it('поворот квадранта по часовой и против', () => {
    const c = pt.cfgFrom({});
    const b = new Array(36).fill(-1);
    b[0] = 0; // (0,0)
    expect(pt.rotate(c, b, 0, 1)[2]).toBe(0); // в правый верхний угол квадранта
    expect(pt.rotate(c, b, 0, -1)[12]).toBe(0); // в левый нижний
    const r4 = [1, 2, 3, 4].reduce((x) => pt.rotate(c, x, 0, 1), b);
    expect(r4).toEqual(b);
    expect(pt.windows(c).length).toBe(32);
    expect(pt.windows(pt.cfgFrom({ size: 9 })).length).toBe(45 + 45 + 25 + 25);
  });
  it('ход: шарик, потом обязательный поворот; ряд после постановки — без поворота', () => {
    let s = pt.newState(pt.cfgFrom({}), [0, 1]);
    expect(pt.apply(s, 0, { type: 'twist', q: 0, dir: 1 })).toBeNull();
    s = pt.apply(s, 0, place(0, 0))!.state;
    expect(s.phase).toBe('twist');
    expect(pt.apply(s, 0, place(1, 0))).toBeNull();
    expect(pt.apply(s, 0, { type: 'twist', q: -1, dir: 0 })).toBeNull(); // без поворота нельзя
    s = pt.apply(s, 0, { type: 'twist', q: 3, dir: -1 })!.state;
    expect(s.turn).toBe(1);
    const w = pos(['xxxx..', '......', '......', 'oooo..', '......', '......']);
    const r = pt.step(w, place(4, 0));
    expect(r.state.over).toBe(true);
    expect(r.state.winners).toEqual([0]);
    expect(r.events.some((e) => e.type === 'twist')).toBe(false);
  });
  it('ряд поворотом; ряд у обоих — ничья; полная доска — ничья', () => {
    const s = pos(['xxx...', '......', '......', '......', 'x.....', 'oo.o.o']);
    let r = pt.step(s, place(0, 3)).state;
    r = pt.step(r, { type: 'twist', q: 0, dir: -1 }).state;
    expect(r.winners).toEqual([0]);
    // поворот правого верхнего квадранта по часовой ставит в ряд и чёрных (верх), и белых (второй ряд)
    const both = pos(['xxx...', 'oooxo.', '...xo.', '......', '......', '......']);
    let b = pt.step(both, place(0, 5)).state;
    expect(b.over).toBe(false);
    b = pt.step(b, { type: 'twist', q: 1, dir: 1 }).state;
    expect(b.over).toBe(true);
    expect(b.why).toBe('both');
    expect(b.winners).toEqual([]);
    // доска без рядов: клетка (x, y) — чёрная, если (x + 2y) mod 4 < 2
    const full = pt.newState(pt.cfgFrom({ free: true }), [0, 1]);
    for (let p = 0; p < 36; p++) full.board[p] = ((p % 6) + 2 * Math.floor(p / 6)) % 4 < 2 ? 0 : 1;
    expect(pt.lines(full.cfg, full.board).size).toBe(0);
    const last = full.board[35];
    full.board[35] = -1;
    full.turn = last;
    let f = pt.step(full, place(5, 5)).state;
    f = pt.step(f, { type: 'twist', q: -1, dir: 0 }).state;
    expect(f.over).toBe(true);
    expect(f.why).toBe('full');
  });
  it('большая доска: на четверых по кругу, только по часовой', () => {
    let s = pt.setup([0, 1, 2, 3], { size: 9 });
    expect(pt.legal(s).length).toBe(81);
    s = pt.apply(s, 0, place(0, 0, 9))!.state;
    expect(pt.legal(s).length).toBe(9);
    expect(pt.apply(s, 0, { type: 'twist', q: 4, dir: -1 })).toBeNull();
    s = pt.apply(s, 0, { type: 'twist', q: 4, dir: 1 })!.state;
    expect(s.turn).toBe(1);
    for (const seat of [1, 2, 3]) {
      s = pt.apply(s, seat, place(seat, 5, 9))!.state;
      s = pt.apply(s, seat, { type: 'twist', q: 8, dir: 1 })!.state;
    }
    expect(s.turn).toBe(0);
    expect(def.countsFor!({ size: 9 })).toEqual([2, 3, 4]);
    expect(def.countsFor!({ size: 6 })).toEqual([2]);
  });
  it('поворот по желанию', () => {
    let s = pt.newState(pt.cfgFrom({ free: true }), [0, 1]);
    s = pt.apply(s, 0, place(2, 2))!.state;
    s = pt.apply(s, 0, { type: 'twist', q: -1, dir: 0 })!.state;
    expect(s.turn).toBe(1);
    expect(s.board[14]).toBe(0);
  });
  it('показы правил идут по правилам', () => {
    for (const sec of def.rules.sections) {
      if (!sec.demo) continue;
      let s = sec.demo.setup ? (sec.demo.setup as () => pt.State)() : def.setup(sec.demo.seats, sec.demo.options ?? {}, new SeededRng(1));
      for (const st of sec.demo.steps) {
        const r = def.apply(s, st.seat, st.action as pt.Action, new SeededRng(1));
        expect(r, `${sec.title}: ${JSON.stringify(st.action)}`).not.toBeNull();
        s = r!.state;
      }
      if (sec.title === 'Пять в ряд') expect(s.winners).toEqual([0]);
    }
  });
  it('боты доигрывают, сложный не проигрывает лёгкому', async () => {
    const breathe = breather();
    let hard = 0;
    let easy = 0;
    for (const [size, n] of [
      [6, 2],
      [9, 3],
    ]) {
      for (let g = 0; g < 2; g++) {
        const rng = new SeededRng(7 + g);
        const order = [0, 1, 2, 3].slice(0, n);
        let s = pt.setup(order, { size });
        const lv = order.map((i) => (i === g % n ? 2 : 0));
        for (let i = 0; i < 400 && !s.over; i++) {
          await breathe();
          const a = choose(s, s.turn, lv[s.turn], rng);
          expect(a).not.toBeNull();
          s = pt.apply(s, s.turn, a!)!.state;
        }
        expect(s.over).toBe(true);
        for (const w of s.winners) lv[w] === 2 ? hard++ : easy++;
      }
    }
    expect(hard).toBeGreaterThanOrEqual(easy);
  }, 240000);
});
