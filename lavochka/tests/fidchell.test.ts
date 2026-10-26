/* Фидхел: расстановка, ход ладьёй, клещи (и с троном, и с углом), король на край / в угол, взятие короля, равные силы, партии ботов. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { choose } from '../src/games/fidchell/ai';
import { def } from '../src/games/fidchell/def';
import * as fd from '../src/games/fidchell/engine';

const { BRONZE: B, BONE: W, KING: K } = fd;

function pos(cells: [number, number, number][], turn = 0, opts = {}): fd.State {
  const s = fd.newState(fd.cfgFrom(opts));
  s.board.fill(0);
  for (const [x, y, v] of cells) s.board[fd.at(x, y)] = v;
  s.turn = turn;
  return s;
}
const mv = (s: fd.State, a: [number, number], b: [number, number]) => fd.apply(s, s.turn, { type: 'move', from: fd.at(...a), to: fd.at(...b) });

function game(levels: [number, number], seed: number, opts = {}): fd.State {
  const rng = new SeededRng(seed);
  let s = def.setup([], { ...opts }, rng) as fd.State;
  for (let i = 0; i < 1000 && !s.over; i++) {
    const a = choose(s, s.turn, levels[s.turn], rng);
    if (!a) throw new Error('бот не нашёл хода');
    const r = fd.apply(s, s.turn, a);
    if (!r) throw new Error('недопустимый ход бота');
    s = r.state;
  }
  return s;
}

describe('фидхел', () => {
  it('Ард-Ри: 16 бронзовых, 8 костяных и король на троне, первой ходит бронза', () => {
    const s = fd.newState(fd.cfgFrom({}));
    expect(fd.count(s, 0)).toBe(16);
    expect(fd.count(s, 1)).toBe(8);
    expect(s.board[fd.THRONE]).toBe(K);
    expect(s.turn).toBe(0);
    expect(fd.legal(s).every((a) => s.board[a.from] === B)).toBe(true);
  });

  it('клещи: двумя фишками и пустым троном; встать между двумя можно', () => {
    let s = pos([
      [1, 1, B],
      [5, 1, B],
      [2, 1, W],
      [2, 3, W],
      [0, 6, W],
      [3, 5, K],
      [6, 6, B],
    ]);
    let r = mv(s, [5, 1], [3, 1])!;
    expect(r.state.board[fd.at(2, 1)]).toBe(0);
    s = mv(r.state, [0, 6], [0, 5])!.state;
    r = mv(s, [1, 1], [1, 3])!;
    expect(r.state.board[fd.at(2, 3)]).toBe(0);
    // сам встал между двумя — цел
    s = pos(
      [
        [1, 0, B],
        [3, 0, B],
        [2, 4, W],
        [6, 6, K],
        [5, 5, B],
      ],
      1,
    );
    r = mv(s, [2, 4], [2, 0])!;
    expect(r.state.board[fd.at(2, 0)]).toBe(W);
  });

  it('на трон встаёт только король, через пустой трон пройти можно', () => {
    const s = pos([
      [3, 0, B],
      [0, 0, W],
      [6, 6, K],
    ]);
    const to = fd.movesFrom(s, fd.at(3, 0));
    expect(to).not.toContain(fd.THRONE);
    expect(to).toContain(fd.at(3, 6));
  });

  it('Ард-Ри: король на краю — победа кости; окружён у трона тремя — победа бронзы', () => {
    let s = pos(
      [
        [3, 0, B],
        [2, 4, W],
        [5, 1, B],
        [3, 3, K],
      ],
      1,
    );
    let r = mv(s, [3, 3], [6, 3])!;
    expect(r.state.over && r.state.winner).toBe(1);
    s = pos([
      [2, 2, B],
      [4, 2, B],
      [3, 0, B],
      [6, 6, W],
      [3, 2, K],
    ]);
    r = mv(s, [3, 0], [3, 1])!;
    expect(r.state.over && r.state.winner).toBe(0);
    // двумя короля не взять
    s = pos([
      [2, 1, B],
      [6, 1, B],
      [6, 6, W],
      [3, 1, K],
    ]);
    r = mv(s, [6, 1], [4, 1])!;
    expect(r.state.over).toBe(false);
  });

  it('Ланнах: король по шагу, углы — только королю и враждебны', () => {
    const L = { kind: 'lannach' };
    let s = pos(
      [
        [3, 0, B],
        [0, 4, B],
        [1, 3, W],
        [1, 1, K],
      ],
      1,
      L,
    );
    expect(fd.movesFrom(s, fd.at(1, 1)).length).toBe(4);
    s = mv(s, [1, 1], [0, 1])!.state;
    s = mv(s, [0, 4], [0, 2])!.state;
    expect(s.over).toBe(false);
    const r = mv(s, [0, 1], [0, 0])!;
    expect(r.state.over && r.state.winner).toBe(1);
    // угол помогает брать; бронза в угол не встаёт
    s = pos(
      [
        [0, 3, B],
        [6, 3, K],
        [5, 5, W],
      ],
      0,
      L,
    );
    expect(fd.movesFrom(s, fd.at(0, 3))).not.toContain(fd.at(0, 0));
    s = pos(
      [
        [3, 0, B],
        [1, 0, W],
        [6, 3, K],
        [5, 5, W],
      ],
      0,
      L,
    );
    expect(mv(s, [3, 0], [2, 0])!.state.board[fd.at(1, 0)]).toBe(0);
  });

  it('равные силы: по 8, одна фишка — проигрыш', () => {
    const E = { kind: 'equal' };
    const s0 = fd.newState(fd.cfgFrom(E));
    expect([fd.count(s0, 0), fd.count(s0, 1)]).toEqual([8, 8]);
    const s = pos(
      [
        [1, 3, B],
        [3, 6, B],
        [2, 3, W],
        [6, 0, W],
      ],
      0,
      E,
    );
    const r = mv(s, [3, 6], [3, 3])!;
    expect(r.state.over && r.state.winner).toBe(0);
  });

  it('показ правил проигрывается без ошибок', () => {
    for (const sec of def.rules!.sections) {
      const d = sec.demo;
      if (!d) continue;
      let s = d.setup ? (d.setup(def as never, new SeededRng(1)) as fd.State) : fd.newState(fd.cfgFrom(d.options ?? {}));
      for (const st of d.steps) {
        const r = fd.apply(s, st.seat, st.action as fd.Action);
        expect(r, `${sec.title}: ${st.caption ?? ''}`).toBeTruthy();
        s = r!.state;
      }
    }
  });

  it('партии ботов доходят до конца', () => {
    for (const kind of ['ardri', 'lannach', 'equal'])
      for (let seed = 1; seed <= 2; seed++) {
        const s = game([seed % 3, (seed + 1) % 3], seed, { kind });
        expect(s.over, kind).toBe(true);
      }
  });
});
