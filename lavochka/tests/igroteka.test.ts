/* «Наша игротека»: расстановки, особые правила брошюры, турецкие шашки по щелчкам, партии ботов во всех двенадцати играх. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { choose } from '../src/games/igroteka/ai';
import { def } from '../src/games/igroteka/def';
import * as ig from '../src/games/igroteka/engine';
import { geo } from '../src/games/igroteka/geo';

const P = (g: ig.GameId, r: number, c: number) => geo(ig.BOARD_OF[g]).at(r, c);
function pos(g: ig.GameId, w: [number, number][], b: [number, number][], o: Partial<ig.State> = {}, opts: Record<string, unknown> = {}) {
  const s = ig.newState(ig.cfgFrom({ game: g, ...opts }));
  s.board.fill(0);
  for (const [r, c] of w) s.board[P(g, r, c)] = 1;
  for (const [r, c] of b) s.board[P(g, r, c)] = 2;
  s.hand = [0, 0];
  s.ply = 1;
  return { ...s, ...o };
}
const mv = (g: ig.GameId, a: [number, number], b: [number, number]): ig.Action => ({ type: 'move', from: P(g, a[0], a[1]), to: P(g, b[0], b[1]) });
const has = (s: ig.State, a: ig.Action) => ig.legal(s).some((m) => ig.same(m, a));

describe('Наша игротека', () => {
  it('поля: число точек и связей', () => {
    expect(geo('sheep').pts.length).toBe(32);
    expect(geo('fox').pts.length).toBe(33);
    expect(geo('mill').pts.length).toBe(24);
    expect(geo('leopards').pts.length).toBe(49);
    expect(geo('alquerque').pts.length).toBe(25);
    expect(geo('bolotudu').pts.length).toBe(30);
    // у мельницы: 24 стороны квадратов, 8 перемычек, 8 диагоналей
    expect(geo('mill').links.flat().length / 2).toBe(40);
    // вершина треугольника леопардов: 3 стороны квадрата, 2 диагонали и 3 линии треугольника
    expect(geo('leopards').links[P('leopards', 0, 2)].length).toBe(8);
  });

  it('расстановки', () => {
    const cnt = (g: ig.GameId, o: Record<string, unknown> = {}) => {
      const s = ig.newState(ig.cfgFrom({ game: g, ...o }));
      return [ig.count(s, 0), ig.count(s, 1)];
    };
    expect(cnt('sheep')).toEqual([1, 4]);
    expect(cnt('fox')).toEqual([13, 0]);
    expect(cnt('fox', { geese: 17 })).toEqual([17, 0]);
    expect(cnt('senegal')).toEqual([14, 14]);
    expect(cnt('alquerque')).toEqual([12, 12]);
    expect(cnt('hasami')).toEqual([18, 18]);
    expect(cnt('tickle')).toEqual([4, 4]);
    const s = ig.newState(ig.cfgFrom({ game: 'senegal' }));
    expect(s.board[P('senegal', 2, 2)]).toBe(0);
    expect(s.board[P('senegal', 2, 3)]).toBe(0);
  });

  it('волк и овцы: овцы только вперёд, волк прорвался — победа', () => {
    const s = ig.newState(ig.cfgFrom({ game: 'sheep' }));
    const t = ig.step(s, mv('sheep', [0, 3], [1, 4])).state;
    expect(ig.legal(t).length).toBe(7);
    for (const a of ig.legal(t)) if (a.type === 'move') expect(geo('sheep').pts[a.to].r).toBeLessThan(geo('sheep').pts[a.from].r);
    const w = pos('sheep', [[5, 2]], [[6, 1], [6, 5], [5, 6], [4, 3]]);
    const r = ig.step(w, mv('sheep', [5, 2], [6, 3]));
    expect(r.state.over).toBe(true);
    expect(r.state.winner).toBe(0);
  });

  it('лиса ставится первой и съедает гуся, гусей меньше девяти — победа лисы', () => {
    const s = ig.newState(ig.cfgFrom({ game: 'fox' }));
    expect(ig.toAct(s)).toEqual([1]);
    const a = pos('fox', [[3, 3], [4, 0], [4, 1], [4, 2], [4, 4], [4, 5], [4, 6], [5, 2], [5, 3]], [[2, 3]], { turn: 1 });
    const r = ig.step(a, mv('fox', [2, 3], [4, 3]));
    expect(r.state.over).toBe(true);
    expect(r.state.winner).toBe(1);
  });

  it('мельница: прыжок через фишку и тройка по диагонали', () => {
    const s = pos('mill', [[0, 0], [3, 6], [6, 6]], [[0, 3], [1, 1], [5, 5], [2, 4]]);
    expect(has(s, mv('mill', [0, 0], [0, 6]))).toBe(true);
    const d = pos('mill', [[0, 0], [2, 2], [0, 3]], [[3, 0], [6, 6], [4, 4], [3, 4]]);
    const r = ig.step(d, mv('mill', [0, 3], [1, 3])).state;
    expect(r.take).toBe(0);
    const d2 = pos('mill', [[0, 0], [2, 2], [1, 3]], [[3, 0], [6, 6], [4, 4], [3, 4]]);
    const r2 = ig.step(d2, mv('mill', [1, 3], [1, 1])).state;
    expect(r2.take).toBe(1);
  });

  it('болотуду: две фишки за ход далеко друг от друга, тройка снимает соседнюю', () => {
    let s = ig.newState(ig.cfgFrom({ game: 'bolotudu' }));
    s = ig.step(s, { type: 'place', to: P('bolotudu', 0, 0) }).state;
    expect(s.turn).toBe(0);
    expect(has(s, { type: 'place', to: P('bolotudu', 1, 1) })).toBe(false);
    expect(has(s, { type: 'place', to: P('bolotudu', 0, 3) })).toBe(true);
    s = ig.step(s, { type: 'place', to: P('bolotudu', 0, 3) }).state;
    expect(s.turn).toBe(1);
    const t = pos('bolotudu', [[2, 0], [2, 1], [1, 2], [4, 4], [4, 5]], [[3, 2], [1, 3], [0, 0], [4, 0]]);
    const r = ig.step(t, mv('bolotudu', [1, 2], [2, 2])).state;
    expect(r.take).toBe(1);
    expect(new Set(r.takeSet)).toEqual(new Set([P('bolotudu', 3, 2), P('bolotudu', 1, 3)]));
  });

  it('сенегальские: бить обязательно, у последнего ряда шашка снимается', () => {
    let s = ig.newState(ig.cfgFrom({ game: 'senegal' }));
    s = ig.step(s, mv('senegal', [3, 2], [2, 2])).state;
    for (const a of ig.legal(s)) if (a.type === 'move') expect(geo('bolotudu').links[a.from].some((l) => l.to === a.to)).toBe(false);
    const e = pos('senegal', [[1, 4], [4, 0]], [[3, 5], [2, 0]]);
    const r = ig.step(e, mv('senegal', [1, 4], [0, 4])).state;
    expect(r.board[P('senegal', 0, 4)]).toBe(0);
    expect(r.lost[0]).toBe(1);
  });

  it('сиджа: в центр не ставят, зажатая снимается, пропуск хода', () => {
    const s = ig.newState(ig.cfgFrom({ game: 'sidja' }));
    expect(has(s, { type: 'place', to: P('sidja', 2, 2) })).toBe(false);
    const t = pos('sidja', [[1, 0], [0, 2], [4, 0]], [[1, 1], [3, 3], [4, 4]]);
    const r = ig.step(t, mv('sidja', [0, 2], [1, 2])).state;
    expect(r.caps[0]).toBe(1);
    expect(ig.legal(r).some((a) => a.type === 'pass')).toBe(true);
    const p = ig.step(r, { type: 'pass' }).state;
    expect(ig.legal(p).some((a) => a.type === 'pass')).toBe(false);
  });

  it('алькуерк: первый ход в центр; бросил цепочку — фишку снимают', () => {
    const s = ig.newState(ig.cfgFrom({ game: 'alquerque' }));
    for (const a of ig.legal(s)) if (a.type === 'move') expect(a.to).toBe(P('alquerque', 2, 2));
    const c = pos('alquerque', [[4, 0], [4, 4]], [[3, 0], [1, 0], [0, 4]]);
    const r = ig.step(c, mv('alquerque', [4, 0], [2, 0])).state;
    expect(r.chain).toBe(P('alquerque', 2, 0));
    const h = ig.step(r, { type: 'stop' }).state;
    expect(h.board[P('alquerque', 2, 0)]).toBe(0);
    expect(h.lost[0]).toBe(1);
  });

  it('хасами шоги: зажим и пять в ряд в средних рядах', () => {
    const s = pos('hasami', [[5, 3], [4, 5], [8, 0]], [[4, 4], [0, 0]]);
    const r = ig.step(s, mv('hasami', [5, 3], [4, 3])).state;
    expect(r.caps[0]).toBe(1);
    const l = pos('hasami', [[3, 4], [4, 4], [5, 4], [6, 4], [2, 3], [8, 0]], [[0, 0], [1, 8]]);
    const w = ig.step(l, mv('hasami', [2, 3], [2, 4])).state;
    expect(w.over).toBe(true);
    expect(w.winner).toBe(0);
    // в крайних рядах пятёрка не считается
    const n = pos('hasami', [[4, 4], [5, 4], [6, 4], [7, 4], [8, 3], [0, 8]], [[0, 0], [1, 7]]);
    expect(ig.step(n, mv('hasami', [8, 3], [8, 4])).state.over).toBe(false);
  });

  it('турецкие: ход и взятие щелчками', () => {
    let s = ig.newState(ig.cfgFrom({ game: 'turk' }));
    for (const a of [mv('turk', [5, 3], [4, 3]), mv('turk', [2, 4], [3, 4]), mv('turk', [4, 3], [3, 3])]) {
      const r = ig.apply(s, s.turn, a);
      expect(r).not.toBeNull();
      s = r!.state;
    }
    const caps = ig.legal(s);
    expect(caps.length).toBe(2);
    const r = ig.apply(s, 1, mv('turk', [2, 3], [4, 3]))!.state;
    expect(r.caps[1]).toBe(1);
    expect(r.turn).toBe(0);
  });

  it('партии ботов во всех играх доходят до конца', () => {
    const rng = new SeededRng(11);
    for (const p of def.presets!) {
      for (const lv of [0, 1]) {
        let s = def.setup([{ seat: 0, kind: 'bot', name: 'a', level: lv }, { seat: 1, kind: 'bot', name: 'b', level: lv }], p.options, rng);
        let n = 0;
        while (!s.over && n < 600) {
          const seat = def.toAct(s)[0];
          const a = choose(s, seat, lv, rng);
          expect(a, `${p.id}: нет хода`).not.toBeNull();
          const r = def.apply(s, seat, a!, rng);
          expect(r, `${p.id}: ход не принят ${JSON.stringify(a)}`).not.toBeNull();
          s = r!.state;
          n++;
        }
        expect(s.over, `${p.id}: не закончилась`).toBe(true);
        expect(n, `${p.id}: слишком короткая партия`).toBeGreaterThan(4);
      }
    }
  }, 240000);
});
