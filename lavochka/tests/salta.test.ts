/* Сальто: расстановка и места, шаг вперёд-назад, обязательный прыжок, запрет запирания, победа, подсчёт, пирамида, партии ботов. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { choose } from '../src/games/salta/ai';
import { def } from '../src/games/salta/def';
import * as sa from '../src/games/salta/engine';

const sq = (f: number, r: number, n = 10) => r * n + f;
const id = (s: sa.State, seat: number, sym: sa.Sym, num: number) => s.pieces.findIndex((p) => p.seat === seat && p.sym === sym && p.num === num);
function pos(cells: [number, sa.Sym, number, number, number][], turn = 0): sa.State {
  const s = sa.newState(sa.cfgFrom({}));
  s.board.fill(-1);
  for (const [seat, sym, num, f, r] of cells) s.board[sq(f, r)] = id(s, seat, sym, num);
  s.turn = turn;
  return s;
}
const has = (s: sa.State, from: number, to: number) => sa.moves(s, s.turn).some((m) => m.from === from && m.to === to);

function game(levels: [number, number], seed: number, opts = {}): sa.State {
  const rng = new SeededRng(seed);
  let s = def.setup([], { ...opts }, rng) as sa.State;
  for (let i = 0; i < 1000 && !s.over; i++) {
    const a = choose(s, s.turn, levels[s.turn], rng);
    if (!a) throw new Error('бот не нашёл хода');
    const r = sa.apply(s, s.turn, a);
    if (!r) throw new Error('недопустимый ход бота');
    s = r.state;
  }
  return s;
}

describe('сальто', () => {
  it('расстановка: звёзды, луны, солнца; места — через семь рядов, зеркально по знаку', () => {
    const s = sa.newState(sa.cfgFrom({}));
    expect(s.pieces.length).toBe(30);
    const g1 = id(s, 0, 'star', 1);
    expect(s.board[sq(0, 0)]).toBe(g1);
    expect(s.pieces[g1].tgt).toBe(sq(1, 7));
    // на месте зелёной звезды № 1 стоит красное солнце № 5
    expect(s.board[sq(1, 7)]).toBe(id(s, 1, 'sun', 5));
    // красная звезда № 1 — в правом верхнем углу (её левый край)
    expect(s.board[sq(9, 9)]).toBe(id(s, 1, 'star', 1));
    expect(s.pieces[id(s, 0, 'sun', 3)].tgt).toBe(sq(5, 9));
    // на старте ходят только солнца вперёд
    expect(sa.moves(s, 0).every((m) => sa.rowOf(s, m.from) === 2 && sa.rowOf(s, m.to) === 3)).toBe(true);
  });

  it('шаг назад можно, прыжок — только вперёд и обязателен', () => {
    let s = pos([
      [0, 'moon', 3, 4, 4],
      [0, 'sun', 2, 2, 2],
      [1, 'star', 2, 5, 5],
      [1, 'moon', 4, 1, 7],
    ]);
    const ms = sa.moves(s, 0);
    expect(ms.length).toBe(1);
    expect(ms[0]).toMatchObject({ from: sq(4, 4), to: sq(6, 6), jump: true });
    s = sa.apply(s, 0, { type: 'move', from: sq(4, 4), to: sq(6, 6) })!.state;
    expect(s.board[sq(5, 5)]).toBe(id(s, 1, 'star', 2)); // без взятия
    s = sa.apply(s, 1, { type: 'move', from: sq(1, 7), to: sq(2, 6) })!.state;
    expect(has(s, sq(6, 6), sq(7, 5))).toBe(true);
    // прыжок назад через красную звезду — нет
    expect(has(s, sq(6, 6), sq(4, 4))).toBe(false);
  });

  it('свою фишку не перепрыгивают', () => {
    const s = pos([
      [0, 'moon', 3, 4, 4],
      [0, 'sun', 2, 5, 5],
      [1, 'star', 1, 9, 9],
    ]);
    expect(has(s, sq(4, 4), sq(6, 6))).toBe(false);
  });

  it('запирать соперника нельзя', () => {
    const s = pos([
      [0, 'sun', 1, 7, 7],
      [0, 'sun', 2, 9, 7],
      [0, 'moon', 5, 3, 3],
      [1, 'star', 5, 9, 9],
    ]);
    expect(has(s, sq(9, 7), sq(8, 8))).toBe(false);
    expect(has(s, sq(7, 7), sq(8, 8))).toBe(true);
    expect(sa.rawMoves(s, 0).some((m) => m.from === sq(9, 7) && m.to === sq(8, 8))).toBe(true);
  });

  it('победа — все на местах', () => {
    const s = sa.newState(sa.cfgFrom({}));
    s.board.fill(-1);
    s.pieces.forEach((pc, i) => {
      if (pc.seat === 0) s.board[pc.tgt] = i;
    });
    s.board[sq(9, 5)] = id(s, 1, 'star', 1);
    const star1 = id(s, 0, 'star', 1);
    s.board[sq(1, 7)] = -1;
    s.board[sq(2, 6)] = star1;
    const r = sa.apply(s, 0, { type: 'move', from: sq(2, 6), to: sq(1, 7) })!;
    expect(r.state.over).toBe(true);
    expect(r.state.winner).toBe(0);
  });

  it('подсчёт после лимита', () => {
    let s = sa.newState(sa.cfgFrom({ limit: 80 }));
    s.made = [80, 79];
    s.turn = 1;
    const m = sa.moves(s, 1)[0];
    s = sa.apply(s, 1, { type: 'move', from: m.from, to: m.to })!.state;
    expect(s.over).toBe(true);
    expect(s.why).toBe('limit');
    // красные сделали на ход больше — им меньше осталось
    expect(s.winner).toBe(1);
    expect(s.left![0]).toBe(sa.left(s, 0));
  });

  it('пирамида: треугольники, только вперёд, цепочка прыжков', () => {
    const s = sa.newState(sa.cfgFrom({ mode: 'pyramid' }));
    expect(s.n).toBe(8);
    expect(sa.camp(8, 'pyramid', 0)).toEqual([sq(0, 0, 8), sq(2, 0, 8), sq(4, 0, 8), sq(6, 0, 8), sq(1, 1, 8), sq(3, 1, 8), sq(5, 1, 8), sq(2, 2, 8), sq(4, 2, 8), sq(3, 3, 8)]);
    expect(sa.camp(8, 'pyramid', 1)).toEqual(sa.camp(8, 'pyramid', 0).map((p) => 63 - p));
    for (const m of sa.moves(s, 0)) expect(sa.rowOf(s, m.to)).toBeGreaterThan(sa.rowOf(s, m.from));
    // прыжок через свою: с (2,0) через (3,1)? занято (4,2) — нет; через (1,1) на (0,2) — да
    expect(sa.moves(s, 0).some((m) => m.from === sq(2, 0, 8) && m.to === sq(0, 2, 8) && m.jump)).toBe(true);
  });

  it('показ правил и превью', () => {
    expect(def.showcase!().over).toBe(false);
    for (const sec of def.rules.sections) {
      if (!sec.demo) continue;
      let s = sec.demo.setup ? sec.demo.setup(def, new SeededRng(1)) : def.setup([], sec.demo.options ?? {}, new SeededRng(1));
      for (const st of sec.demo.steps) {
        const r = def.apply(s, st.seat, st.action, new SeededRng(1));
        expect(r, `${sec.title}: ${JSON.stringify(st.action)}`).not.toBeNull();
        s = r!.state;
      }
    }
  });

  it('партии ботов кончаются, сложный сильнее лёгкого', { timeout: 120_000 }, () => {
    let hard = 0;
    for (let i = 0; i < 4; i++) {
      const a = game([2, 0], 100 + i);
      const b = game([0, 2], 200 + i);
      expect(a.over && b.over).toBe(true);
      hard += (a.winner === 0 ? 1 : 0) + (b.winner === 1 ? 1 : 0);
    }
    expect(hard).toBeGreaterThanOrEqual(6);
    for (let i = 0; i < 3; i++) expect(game([1, 2], 300 + i, { mode: 'pyramid' }).over).toBe(true);
  });
});
