/* Камисадо: доска, обязательный цвет, ход на месте и тупик, сумо и толчок, серия и расстановка, показы правил, боты. */
import { describe, expect, it } from 'vitest';
import { breather } from './harness';
import { SeededRng } from '../src/core/rng';
import { choose } from '../src/games/kamisado/ai';
import { def } from '../src/games/kamisado/def';
import * as km from '../src/games/kamisado/engine';

const at = km.at;
const mv = (x: number, y: number, x2: number, y2: number): km.Action => ({ type: 'move', from: at(x, y), to: at(x2, y2) });
function pos(towers: [number, number, number, number, number?][], turn = 0, forced = -1, target = 1) {
  const s = km.newState(km.cfgFrom({ target }));
  s.board.fill(-1);
  for (const [seat, c, x, y, r] of towers) {
    s.board[at(x, y)] = km.towerId(seat, c);
    s.rank[km.towerId(seat, c)] = r ?? 0;
  }
  s.turn = turn;
  s.forced = forced;
  return s;
}

describe('Камисадо', () => {
  it('доска: в каждом ряду и столбце все цвета, оранжевая справа у обоих, симметрия', () => {
    for (let i = 0; i < 8; i++) {
      expect(new Set([0, 1, 2, 3, 4, 5, 6, 7].map((x) => km.CELL[at(x, i)])).size).toBe(8);
      expect(new Set([0, 1, 2, 3, 4, 5, 6, 7].map((y) => km.CELL[at(i, y)])).size).toBe(8);
    }
    for (let p = 0; p < 64; p++) expect(km.CELL[63 - p]).toBe(km.CELL[p]);
    expect(km.CELL[at(7, 7)]).toBe(0);
    expect(km.CELL[at(0, 0)]).toBe(0);
    const s = km.newState(km.cfgFrom({}));
    for (let x = 0; x < 8; x++) expect(km.colorOf(s.board[at(x, 7)])).toBe(km.CELL[at(x, 7)]);
    // первый ход — любой башней: 8 башен по 13 и меньше ходов
    const l = km.legal(s);
    expect(new Set(l.map((a) => (a.type === 'move' ? a.from : -1))).size).toBe(8);
  });
  it('ход только вперёд, без прыжков; дальше — башня цвета клетки', () => {
    let s = km.newState(km.cfgFrom({}));
    expect(km.apply(s, 0, mv(4, 7, 4, 3))).not.toBeNull();
    expect(km.apply(s, 0, mv(4, 7, 4, 0))).toBeNull(); // в занятую
    s = km.apply(s, 0, mv(4, 7, 4, 3))!.state;
    expect(s.turn).toBe(1);
    expect(s.forced).toBe(km.CELL[at(4, 3)]);
    expect(km.legal(s).every((a) => a.type === 'move' && km.colorOf(s.board[a.from]) === s.forced)).toBe(true);
    // через башню не прыгают
    const b = pos([[0, 0, 3, 5], [1, 1, 3, 3]], 0, 0);
    expect(km.legal(b).some((a) => a.type === 'move' && a.to === at(3, 2))).toBe(false);
    expect(km.legal(b).some((a) => a.type === 'move' && a.to === at(3, 4))).toBe(true);
  });
  it('запертая башня — ход на месте, тупик — проигрывает виновник', () => {
    const s = pos([[1, km.CELL[at(5, 4)], 0, 0], [0, 2, 0, 1], [0, 3, 1, 1], [0, 0, 5, 6], [1, 7, 7, 0]], 0, 0);
    const r = km.step(s, mv(5, 6, 5, 4));
    expect(r.events.some((e) => e.type === 'pass')).toBe(true);
    expect(r.state.turn).toBe(0);
    expect(r.state.forced).toBe(km.CELL[at(0, 0)]);
    const d = pos([[1, km.CELL[at(0, 4)], 0, 3], [1, 2, 1, 3], [0, km.CELL[at(0, 3)], 0, 4], [0, 6, 1, 4], [0, 0, 2, 6]]);
    const r2 = km.step(d, mv(2, 6, 1, 5));
    expect(r2.state.over).toBe(true);
    expect(r2.state.winner).toBe(1);
  });
  it('сумо: короче ход, толчок, соперник пропускает', () => {
    const s = pos([[0, 5, 4, 7, 1], [0, 6, 6, 6], [1, 2, 4, 6], [1, 7, 0, 0]], 0, 5, 7);
    const to = km.legal(s).map((a) => (a.type === 'move' ? a.to : -1));
    expect(to).toContain(at(4, 6)); // толчок
    const far = pos([[0, 5, 7, 7, 1], [1, 7, 0, 0]], 0, 5, 7);
    const ys = km.legal(far).map((a) => (a.type === 'move' ? km.Y(a.to) : 9));
    expect(Math.min(...ys)).toBe(2); // не дальше 5 клеток
    const r = km.step(s, mv(4, 7, 4, 6));
    expect(r.state.board[at(4, 5)]).toBe(km.towerId(1, 2));
    expect(r.events[0].type).toBe('push');
    expect(r.state.turn).toBe(0);
    expect(r.state.forced).toBe(km.CELL[at(4, 6)]);
    // сумо не толкает сумо своего ранга; за толкаемой должно быть пусто
    const eq = pos([[0, 5, 4, 5, 1], [1, 2, 4, 4, 1], [1, 7, 0, 0]], 0, 5, 7);
    expect(km.pushLine(eq, at(4, 5))).toEqual([]);
    const two = pos([[0, 5, 4, 5, 1], [1, 2, 4, 4], [1, 3, 4, 3], [1, 7, 0, 0]], 0, 5, 7);
    expect(km.pushLine(two, at(4, 5))).toEqual([]);
    two.rank[km.towerId(0, 5)] = 2;
    expect(km.pushLine(two, at(4, 5)).length).toBe(2);
  });
  it('серия: очки по рангу, сумо, расстановка, первым ходит проигравший', () => {
    const s = pos([[0, 3, 3, 1, 1], [1, 0, 0, 0], [1, 1, 6, 0]], 0, 3, 3);
    const r = km.step(s, mv(3, 1, 3, 0));
    expect(r.state.score).toEqual([3, 0]);
    expect(r.state.over).toBe(true);
    const s2 = pos([[0, 3, 3, 1], [0, 4, 5, 5], [1, 0, 0, 0], [1, 1, 6, 0]], 0, 3, 3);
    const r2 = km.step(s2, mv(3, 1, 3, 0));
    expect(r2.state.phase).toBe('fill');
    expect(r2.state.rank[km.towerId(0, 3)]).toBe(1);
    const f = km.apply(r2.state, 0, { type: 'fill', side: 'right' })!.state;
    expect(f.turn).toBe(1);
    expect(f.forced).toBe(-1);
    // справа: у чёрных правый край — x = 7; ближний к дому ряд первым
    expect(f.board[at(7, 7)]).toBe(km.towerId(0, 4));
    expect(f.board[at(6, 7)]).toBe(km.towerId(0, 3));
    // у золотых их правый край — x = 0
    expect(f.board[at(0, 0)]).toBe(km.towerId(1, 0));
    expect(f.board[at(1, 0)]).toBe(km.towerId(1, 1));
  });
  it('показы правил идут по правилам', () => {
    for (const sec of def.rules.sections) {
      if (!sec.demo) continue;
      let s = sec.demo.setup ? (sec.demo.setup as () => km.State)() : def.setup(sec.demo.seats, {}, new SeededRng(1));
      for (const st of sec.demo.steps) {
        const r = def.apply(s, st.seat, st.action as km.Action, new SeededRng(1));
        expect(r, `${sec.title}: ${JSON.stringify(st.action)}`).not.toBeNull();
        s = r!.state;
      }
    }
  });
  it('боты доигрывают раунд и серию', async () => {
    const breathe = breather();
    for (const target of [1, 7]) {
      let s = km.newState(km.cfgFrom({ target }));
      const rng = new SeededRng(5);
      for (let i = 0; i < 3000 && !s.over; i++) {
        await breathe();
        const a = choose(s, s.turn, s.turn ? 0 : 2, rng);
        expect(a).not.toBeNull();
        s = km.apply(s, s.turn, a!)!.state;
      }
      expect(s.over).toBe(true);
    }
  }, 240000);
});
