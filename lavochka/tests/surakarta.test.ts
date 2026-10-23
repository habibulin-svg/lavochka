/* Суракарта: круги и петли, взятие через петлю и сквозь свою точку, серия на очки, показы правил, боты. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { choose } from '../src/games/surakarta/ai';
import { def } from '../src/games/surakarta/def';
import * as sk from '../src/games/surakarta/engine';

const at = sk.at;
function pos(red: [number, number][], white: [number, number][], games = 1) {
  const s = sk.newState(sk.cfgFrom({ games }));
  s.board.fill(0);
  for (const [x, y] of red) s.board[at(x, y)] = sk.RED;
  for (const [x, y] of white) s.board[at(x, y)] = sk.WHITE;
  return s;
}
const can = (s: sk.State, a: [number, number], b: [number, number]) => sk.legal(s).some((m) => m.from === at(...a) && m.to === at(...b));

describe('Суракарта', () => {
  it('круги: по 24 точки, 4 петли, углы вне кругов', () => {
    for (const c of sk.CIRCUITS) {
      expect(c.seq.length).toBe(24);
      expect(c.loop.filter(Boolean).length).toBe(4);
      for (const p of [0, 5, 30, 35]) expect(c.seq.includes(p)).toBe(false);
    }
    const s = sk.newState(sk.cfgFrom({}));
    expect(sk.count(s, 0)).toBe(12);
    expect(sk.count(s, 1)).toBe(12);
    // в начале взятий нет, ходы — шаги второго ряда
    expect(sk.legal(s).every((m) => !s.board[m.to])).toBe(true);
  });
  it('шаг в 8 сторон, только на пустую', () => {
    const s = pos([[2, 2]], [[0, 0]]);
    expect(sk.legal(s).filter((m) => m.from === at(2, 2)).length).toBe(8);
  });
  it('взятие только через петлю', () => {
    const s = pos([[1, 3], [5, 5]], [[1, 1], [4, 4], [0, 0]]);
    expect(can(s, [1, 3], [1, 1])).toBe(false);
    expect(can(s, [1, 3], [4, 4])).toBe(true);
    const r = sk.step(s, { type: 'move', from: at(1, 3), to: at(4, 4) });
    expect(sk.count(r.state, 1)).toBe(2);
    const ev = r.events[0];
    expect(ev.type).toBe('take');
    if (ev.type === 'take') expect(sk.trackSteps(ev.track).at(-1)!.p).toBe(at(4, 4));
  });
  it('сквозь свою начальную точку по большому кругу', () => {
    const s = pos([[2, 2], [5, 5]], [[2, 4], [0, 0]]);
    expect(can(s, [2, 2], [2, 4])).toBe(true);
    // закрытый путь: своя фишка на дороге
    const b = pos([[2, 2], [0, 2], [5, 5]], [[2, 4], [0, 0]]);
    const t = sk.takesFrom(b.board, at(2, 2)).get(at(2, 4));
    // другой путь (вправо, через правую верхнюю петлю) — длиннее, но есть ли он, не важно; короткий закрыт
    if (t) expect(t.n).toBeGreaterThan(7);
  });
  it('своя фишка на пути закрывает взятие', () => {
    const s = pos([[3, 1], [5, 1], [0, 5]], [[4, 2], [0, 0]]);
    const t = sk.takesFrom(s.board, at(3, 1)).get(at(4, 2));
    // короткий путь по малому кругу (5 шагов) закрыт; по большому через (3,0) — открыт
    expect(t && t.c === 0 && t.n === 5).toBeFalsy();
    expect(t?.c).toBe(1);
  });
  it('серия на очки: очки — оставшиеся фишки, новая партия, первый ход по очереди', () => {
    const s = pos([[3, 1], [0, 5], [5, 5]], [[4, 2]], 2);
    const r = sk.step(s, { type: 'move', from: at(3, 1), to: at(4, 2) });
    expect(r.state.over).toBe(false);
    expect(r.state.score).toEqual([3, 0]);
    expect(r.state.game).toBe(1);
    expect(r.state.turn).toBe(1);
    expect(sk.count(r.state, 0)).toBe(12);
  });
  it('долго без взятий — побеждает тот, у кого больше', () => {
    const s = pos([[0, 5], [5, 5]], [[0, 0]]);
    s.quiet = sk.QUIET - 1;
    const r = sk.step(s, { type: 'move', from: at(0, 5), to: at(0, 4) });
    // красная на (0,4) может быть взята белой? у белой в углу взятий нет — партия кончилась по счёту
    expect(r.state.over).toBe(true);
    expect(r.state.winner).toBe(0);
  });
  it('показы правил идут по правилам', () => {
    for (const sec of def.rules.sections) {
      if (!sec.demo) continue;
      let s = sec.demo.setup ? (sec.demo.setup as () => sk.State)() : def.setup(sec.demo.seats, {}, new SeededRng(1));
      for (const st of sec.demo.steps) {
        const r = def.apply(s, st.seat, st.action as sk.Action, new SeededRng(1));
        expect(r, `${sec.title}: ${JSON.stringify(st.action)}`).not.toBeNull();
        s = r!.state;
      }
    }
  });
  it('боты доигрывают партию и серию', () => {
    for (const games of [1, 2]) {
      let s = sk.newState(sk.cfgFrom({ games }));
      const rng = new SeededRng(5);
      for (let i = 0; i < 3000 && !s.over; i++) {
        const a = choose(s, s.turn, s.turn ? 0 : 2, rng);
        expect(a).not.toBeNull();
        s = sk.apply(s, s.turn, a!)!.state;
      }
      expect(s.over).toBe(true);
    }
  }, 180000);
});
