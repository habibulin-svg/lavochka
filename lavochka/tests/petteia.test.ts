/* Петтейя и латрункули: ход, клещи, угол, дукс, расстановка, ход после взятия, прыжки цепочкой, партии ботов. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { choose } from '../src/games/petteia/ai';
import { def } from '../src/games/petteia/def';
import * as pt from '../src/games/petteia/engine';

function pos(cells: [number, number, number][], turn = 0, opts = {}): pt.State {
  const s = pt.newState(pt.cfgFrom(opts));
  s.board.fill(0);
  for (const [x, y, v] of cells) s.board[pt.at(s, x, y)] = v;
  s.phase = 'play';
  s.hand = [0, 0];
  s.duxHand = [false, false];
  s.turn = turn;
  return s;
}
const mv = (s: pt.State, a: [number, number], b: [number, number]) => pt.apply(s, s.turn, { type: 'move', from: pt.at(s, ...a), to: pt.at(s, ...b) });

function game(levels: [number, number], seed: number, opts = {}): pt.State {
  const rng = new SeededRng(seed);
  let s = def.setup([], { ...opts }, rng) as pt.State;
  for (let i = 0; i < 3000 && !s.over; i++) {
    const a = choose(s, s.turn, levels[s.turn], rng);
    if (!a) throw new Error('бот не нашёл хода');
    const r = pt.apply(s, s.turn, a);
    if (!r) throw new Error('недопустимый ход бота');
    s = r.state;
  }
  return s;
}

describe('петтейя', () => {
  it('расстановка и ход ладьёй', () => {
    const s = pt.newState(pt.cfgFrom({}));
    expect(pt.count(s, 0)).toBe(8);
    expect(pt.count(s, 1)).toBe(8);
    // из ряда — только вверх, на 6 клеток каждая фишка
    expect(pt.legal(s).length).toBe(8 * 6);
  });

  it('клещи берут, самому встать между двумя можно', () => {
    let s = pos([
      [2, 4, 1],
      [4, 7, 1],
      [5, 6, 1],
      [3, 4, 2],
      [6, 0, 2],
      [4, 1, 2],
      [6, 1, 2],
    ]);
    let r = mv(s, [4, 7], [4, 4])!;
    expect(r.state.board[pt.at(s, 3, 4)]).toBe(0);
    s = mv(r.state, [6, 0], [7, 0])!.state;
    r = mv(s, [5, 6], [5, 1])!;
    expect(r.state.board[pt.at(s, 5, 1)]).toBe(1);
    expect(pt.count(r.state, 1)).toBe(3);
  });

  it('одна фишка — проигрыш', () => {
    const s = pos([
      [4, 3, 1],
      [6, 7, 1],
      [5, 3, 2],
      [0, 0, 2],
    ]);
    const r = mv(s, [6, 7], [6, 3])!;
    expect(r.state.over).toBe(true);
    expect(r.state.winner).toBe(0);
  });
});

describe('латрункули', () => {
  const K = { kind: 'kowalski' };
  it('Ковальский: 8×12, двенадцать и дукс, угол берут двумя', () => {
    const s0 = pt.newState(pt.cfgFrom(K));
    expect([s0.w, s0.h]).toEqual([12, 8]);
    expect(pt.count(s0, 0)).toBe(13);
    const s = pos(
      [
        [11, 1, 1],
        [5, 0, 1],
        [6, 6, 3],
        [11, 0, 2],
        [8, 1, 2],
        [0, 3, 4],
      ],
      0,
      K
    );
    const r = mv(s, [5, 0], [10, 0])!;
    expect(r.state.board[pt.at(s, 11, 0)]).toBe(0);
  });

  it('Ковальский: дукса не берут, запертый дукс — проигрыш', () => {
    let s = pos(
      [
        [0, 2, 1],
        [2, 3, 1],
        [0, 7, 1],
        [6, 6, 3],
        [8, 1, 2],
        [9, 1, 2],
        [1, 3, 4],
      ],
      0,
      K
    );
    // клещи на дукса не действуют
    let r = mv(s, [0, 7], [0, 3])!;
    expect(r.state.board[pt.at(s, 1, 3)]).toBe(4);
    s = pos(
      [
        [0, 2, 1],
        [1, 3, 1],
        [0, 7, 1],
        [6, 6, 3],
        [8, 1, 2],
        [9, 1, 2],
        [0, 3, 4],
      ],
      0,
      K
    );
    r = mv(s, [0, 7], [0, 4])!;
    expect(r.state.over).toBe(true);
    expect(r.state.winner).toBe(0);
  });

  it('Белл: расстановка по две, дукс последним, взял — ходи ещё, дукс прыгает', () => {
    let s = pt.newState(pt.cfgFrom({ kind: 'bell' }));
    expect(s.phase).toBe('place');
    s = pt.apply(s, 0, { type: 'place', to: 50 })!.state;
    expect(s.turn).toBe(0);
    s = pt.apply(s, 0, { type: 'place', to: 51 })!.state;
    expect(s.turn).toBe(1);
    // доиграть расстановку ботами: дукс ставится последним
    const rng = new SeededRng(4);
    while (s.phase === 'place') {
      const seat = s.turn;
      const wasDux = s.hand[seat] === 0 && s.duxHand[seat];
      const r = pt.apply(s, seat, choose(s, seat, 1, rng)!)!;
      const ev = r.events.find((e) => e.type === 'place')!;
      if (ev.type === 'place') expect(pt.isDux(ev.piece)).toBe(wasDux);
      s = r.state;
    }
    expect(pt.count(s, 0)).toBe(17);
    expect(pt.count(s, 1)).toBe(17);
    expect(s.board.includes(3) && s.board.includes(4)).toBe(true);

    const b = pos(
      [
        [1, 6, 1],
        [3, 7, 1],
        [5, 5, 3],
        [2, 6, 2],
        [5, 4, 2],
        [0, 0, 2],
        [7, 0, 2],
      ],
      0,
      { kind: 'bell' }
    );
    // на клетку, не дальше
    expect(mv(b, [3, 7], [3, 5])).toBeNull();
    const r = mv(b, [3, 7], [3, 6])!;
    expect(r.state.turn).toBe(0);
    const j = mv(r.state, [5, 5], [5, 3])!;
    expect(j.state.board[pt.at(b, 5, 4)]).toBe(2);
    expect(j.state.turn).toBe(1);
  });

  it('Шедлер: прыжки цепочкой, взятие там, где остановилась; не вставать между двумя без взятия', () => {
    const S = { kind: 'schadler' };
    const s = pos(
      [
        [1, 6, 1],
        [1, 3, 1],
        [3, 2, 1],
        [7, 7, 1],
        [1, 5, 2],
        [2, 2, 2],
        [6, 0, 2],
        [7, 0, 2],
      ],
      0,
      S
    );
    let r = mv(s, [1, 6], [1, 4])!;
    expect(r.state.chain).toBe(pt.at(s, 1, 4));
    expect(r.state.turn).toBe(0);
    expect(pt.legal(r.state).some((a) => a.type === 'stop')).toBe(true);
    r = mv(r.state, [1, 4], [1, 2])!;
    expect(r.state.board[pt.at(s, 2, 2)]).toBe(0);
    expect(r.state.turn).toBe(1);

    const t = pos(
      [
        [3, 5, 1],
        [3, 7, 1],
        [2, 4, 2],
        [4, 4, 2],
        [0, 0, 2],
      ],
      0,
      S
    );
    expect(mv(t, [3, 5], [3, 4])).toBeNull();
  });
});

describe('боты', () => {
  for (const kind of ['petteia', 'kowalski', 'bell', 'schadler'])
    it(`${kind}: партии доходят до конца`, () => {
      // у Ковальского доска больше и ходов за сотню — одной партии хватит
      for (let seed = 1; seed <= (kind === 'kowalski' ? 1 : 2); seed++) {
        const s = game([0, 1], seed, { kind });
        expect(s.over).toBe(true);
      }
    });

  it('сложный обыгрывает лёгкого в петтейю', () => {
    let wins = 0;
    for (let seed = 1; seed <= 3; seed++) {
      const s = game(seed % 2 ? [2, 0] : [0, 2], seed);
      const hard = seed % 2 ? 0 : 1;
      if (s.winner === hard) wins++;
    }
    expect(wins).toBeGreaterThanOrEqual(2);
  }, 120_000);

  it('«Расставить случайно»: все свои фишки разом на своей половине, соперник ставит дальше', () => {
    const s = pt.newState(pt.cfgFrom({ kind: 'bell' }));
    expect(s.phase).toBe('place');
    const r = pt.apply(s, 0, { type: 'scatter' }, new SeededRng(5))!;
    expect(r).not.toBeNull();
    const n = r.state.board.filter((v, p) => (v === 1 || v === 3) && p >= (s.h / 2) * s.w).length;
    expect(n).toBe(s.hand[0] + (s.duxHand[0] ? 1 : 0));
    expect(r.state.turn).toBe(1);
    expect(r.state.phase).toBe('place');
    // соперник тоже разом — и партия начинается
    const r2 = pt.apply(r.state, 1, { type: 'scatter' }, new SeededRng(6))!;
    expect(r2.state.phase).toBe('play');
    expect(pt.apply(r2.state, 0, { type: 'scatter' })).toBeNull();
  });
});
