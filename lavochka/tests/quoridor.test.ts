/* Коридор: шаги и стенки, запрет отрезать путь, прыжок и обход вбок (и строгий вариант), четверо, показы, боты. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { choose } from '../src/games/quoridor/ai';
import { def } from '../src/games/quoridor/def';
import * as qr from '../src/games/quoridor/engine';

const at = (x: number, y: number) => qr.at(9, x, y);
function pos(pawns: [number, number, number][], walls: [number, number, 'h' | 'v'][] = [], diag = true) {
  const s = qr.newState(qr.cfgFrom({ diag }), [0, 2]);
  for (const [seat, x, y] of pawns) s.pos[seat] = at(x, y);
  for (const [x, y, o] of walls) (o === 'h' ? s.hw : s.vw)[y * 8 + x] = 1;
  return s;
}
const sorted = (a: number[]) => a.slice().sort((x, y) => x - y);

describe('Коридор', () => {
  it('расстановка, стенки по числу игроков', () => {
    const s = qr.setup([0, 2], {});
    expect(s.pos[0]).toBe(at(4, 8));
    expect(s.pos[2]).toBe(at(4, 0));
    expect(s.left[0]).toBe(10);
    const f = qr.setup([0, 1, 2, 3], {});
    expect(f.left).toEqual([5, 5, 5, 5]);
    expect(f.pos[1]).toBe(at(0, 4));
    expect(qr.setup([0, 2], { size: 7 }).left[0]).toBe(8);
    expect(qr.setup([0, 1, 2, 3], { size: 7 }).left[0]).toBe(4);
    expect(def.countsFor!({ mode: 'four' })).toEqual([4]);
    expect(def.seatsFor!(2)).toEqual([0, 2]);
  });
  it('шаги и стенки: сквозь стенку не ходят, стенки не пересекаются и не накладываются', () => {
    const s = pos([[0, 4, 6], [2, 4, 1]], [[3, 5, 'h']]);
    expect(sorted(qr.pawnMoves(s, 0))).toEqual(sorted([at(3, 6), at(5, 6), at(4, 7)]));
    expect(qr.wallFits(s, { x: 3, y: 5, o: 'v' })).toBe(false); // крест
    expect(qr.wallFits(s, { x: 4, y: 5, o: 'h' })).toBe(false); // наложение
    expect(qr.wallFits(s, { x: 2, y: 5, o: 'h' })).toBe(false);
    expect(qr.wallFits(s, { x: 5, y: 5, o: 'h' })).toBe(true);
    expect(qr.wallFits(s, { x: 3, y: 4, o: 'v' })).toBe(true);
  });
  it('нельзя отрезать пешку от цели', () => {
    // поперёк поля — стенки на столбцах 1–8, открыт только столбец 0; слева вверху его отгораживает вертикаль
    const s = pos([[0, 4, 8], [2, 4, 0]], [[1, 3, 'h'], [3, 3, 'h'], [5, 3, 'h'], [7, 3, 'h'], [0, 0, 'v']]);
    expect(qr.dist(9, s.hw, s.vw, 2, s.pos[2])).toBeGreaterThan(0);
    const last = { x: 0, y: 2, o: 'v' as const };
    expect(qr.wallFits(s, last)).toBe(true);
    expect(qr.wallOk(s, last)).toBe(false);
    expect(qr.apply(s, 0, { type: 'wall', ...last })).toBeNull();
  });
  it('прыжок через пешку, обход вбок; в строгом варианте — только прямо', () => {
    const s = pos([[0, 4, 5], [2, 4, 4]]);
    expect(qr.pawnMoves(s, 0)).toContain(at(4, 3));
    const w = pos([[0, 4, 5], [2, 4, 4]], [[4, 3, 'h']]);
    expect(sorted(qr.pawnMoves(w, 0))).toEqual(sorted([at(3, 4), at(5, 4), at(3, 5), at(5, 5), at(4, 6)]));
    const strict = pos([[0, 4, 5], [2, 4, 4]], [[4, 3, 'h']], false);
    expect(qr.pawnMoves(strict, 0)).not.toContain(at(5, 4));
    // через две пешки не прыгают, но вбок — можно
    const f = qr.setup([0, 1, 2, 3], {});
    f.pos[0] = at(4, 6);
    f.pos[1] = at(4, 5);
    f.pos[2] = at(4, 4);
    const m = qr.pawnMoves(f, 0);
    expect(m).not.toContain(at(4, 4));
    expect(m).not.toContain(at(4, 3));
    expect(m).toContain(at(3, 5));
  });
  it('победа — дойти до края; вчетвером ход по часовой', () => {
    const s = pos([[0, 4, 1], [2, 0, 8]]);
    const r = qr.apply(s, 0, { type: 'move', to: at(4, 0) })!;
    expect(r.state.over).toBe(true);
    expect(r.state.winner).toBe(0);
    let f = qr.setup([0, 1, 2, 3], {});
    const seq: number[] = [];
    for (let i = 0; i < 4; i++) {
      seq.push(f.turn);
      f = qr.apply(f, f.turn, { type: 'move', to: qr.pawnMoves(f, f.turn)[0] })!.state;
    }
    expect(seq).toEqual([0, 1, 2, 3]);
    // зелёные (справа) идут к левому краю
    expect(qr.isGoal(9, 3, at(0, 4))).toBe(true);
    expect(qr.isGoal(9, 1, at(8, 4))).toBe(true);
  });
  it('показы правил идут по правилам', () => {
    for (const sec of def.rules.sections) {
      if (!sec.demo) continue;
      let s = sec.demo.setup ? (sec.demo.setup as () => qr.State)() : def.setup(sec.demo.seats, sec.demo.options ?? {}, new SeededRng(1));
      for (const st of sec.demo.steps) {
        const r = def.apply(s, st.seat, st.action as qr.Action, new SeededRng(1));
        expect(r, `${sec.title}: ${JSON.stringify(st.action)}`).not.toBeNull();
        s = r!.state;
      }
    }
    expect(def.showcase!().over).toBe(false);
  });
  it('боты доигрывают вдвоём и вчетвером, сложный сильнее лёгкого', () => {
    let hard = 0;
    let easy = 0;
    for (const [n, size] of [
      [2, 9],
      [2, 7],
      [4, 9],
    ]) {
      for (let g = 0; g < 3; g++) {
        const rng = new SeededRng(11 + g);
        const order = qr.seatsFor(n);
        let s = qr.setup(order, { size });
        const lv: Record<number, number> = {};
        order.forEach((q, i) => (lv[q] = i === g % n ? 2 : 0));
        for (let i = 0; i < qr.PLY_LIMIT + 2 && !s.over; i++) {
          const a = choose(s, s.turn, lv[s.turn], rng);
          expect(a).not.toBeNull();
          const r = qr.apply(s, s.turn, a!);
          expect(r, JSON.stringify(a)).not.toBeNull();
          s = r!.state;
        }
        expect(s.over).toBe(true);
        if (n === 2) lv[s.winner!] === 2 ? hard++ : easy++;
      }
    }
    expect(hard).toBeGreaterThan(easy);
  }, 240000);
});
