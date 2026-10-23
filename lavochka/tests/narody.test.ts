/* Игры народов мира: ключевые правила Баг-Чала, мельницы, креста (лиса и гуси, асальто, «Йога») и тафла. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import * as bc from '../src/games/bagchal/engine';
import * as fg from '../src/games/foxgeese/engine';
import { choose as yogaBot } from '../src/games/foxgeese/ai';
import * as ml from '../src/games/mill/engine';
import * as tf from '../src/games/tafl/engine';

describe('Баг-Чал', () => {
  it('тигр ест прыжком, в мирной расстановке — нет', () => {
    for (const calm of [false, true]) {
      const s = bc.newState(bc.cfgFrom({ calm }));
      s.board[1] = bc.GOAT; // (1,0) рядом с тигром в (0,0)
      s.hand = 19;
      s.turn = bc.TIGERS;
      const jump = bc.tigerMoves(s).some((m) => m.type === 'move' && m.from === 0 && m.to === 2);
      expect(jump).toBe(!calm);
    }
  });
  it('запертые тигры — победа коз', () => {
    const s = bc.newState(bc.cfgFrom({}));
    s.board.fill(bc.GOAT);
    for (const p of [0, 4, 20, 24]) s.board[p] = bc.TIGER;
    s.board[12] = 0;
    s.board[11] = 0;
    s.hand = 0;
    s.turn = bc.GOATS;
    const r = bc.step(s, { type: 'move', from: 7, to: 12 });
    expect(r.state.over).toBe(true);
    expect(r.state.winner).toBe(bc.GOATS);
  });
});

describe('Мельница', () => {
  it('мельница даёт снятие, фишки из чужой мельницы не трогают', () => {
    const s = ml.newState(ml.cfgFrom({}));
    s.board[8] = 2;
    s.board[9] = 2;
    s.board[10] = 2; // мельница чёрных
    s.board[20] = 2;
    s.board[0] = 1;
    s.board[1] = 1;
    s.hand = [5, 5];
    const r = ml.step(s, { type: 'place', to: 2 });
    expect(r.state.take).toBe(1);
    expect(r.state.turn).toBe(0);
    expect(ml.legal(r.state).map((a) => (a.type === 'take' ? a.at : -1))).toEqual([20]);
  });
  it('малая мельница: три в ряд — победа', () => {
    const s = ml.newState(ml.cfgFrom({ men: 3 }));
    s.board[0] = 1;
    s.board[1] = 1;
    s.hand = [1, 3];
    const r = ml.step(s, { type: 'place', to: 2 });
    expect(r.state.winner).toBe(0);
  });
  it('советская расстановка: по 9 фишек, средний ряд пуст', () => {
    const s = ml.newState(ml.cfgFrom({ set: true, diag: true, look: 'soviet' }));
    expect(s.board.filter((v) => v === 1).length).toBe(9);
    expect(s.board.filter((v) => v === 2).length).toBe(9);
    expect(s.hand).toEqual([0, 0]);
  });
});

describe('Крест', () => {
  const P = (x: number, y: number) => fg.geo(fg.cfgFrom({})).at[y * 7 + x];
  it('гуси не ходят назад и по диагонали', () => {
    const s = fg.newState(fg.cfgFrom({}));
    for (const a of fg.legal(s)) {
      if (a.type !== 'move') continue;
      const [x1, y1] = fg.geo(s.cfg).xy[a.from];
      const [x2, y2] = fg.geo(s.cfg).xy[a.to];
      expect(y2 <= y1 && (x1 === x2 || y1 === y2)).toBe(true);
    }
  });
  it('лиса может прыгать дальше или остановиться', () => {
    const s = fg.newState(fg.cfgFrom({}));
    s.board.fill(0);
    for (const [x, y] of [
      [3, 4],
      [2, 4],
      [0, 2],
      [1, 2],
      [0, 3],
      [6, 2],
      [6, 3],
      [6, 4],
      [5, 4],
      [4, 6],
    ])
      s.board[P(x, y)] = fg.MAN;
    s.board[P(3, 3)] = fg.FOX;
    s.turn = 1;
    const r = fg.step(s, { type: 'move', from: P(3, 3), to: P(3, 5) });
    expect(r.state.turn).toBe(1);
    expect(r.state.chain).toBe(P(3, 5));
    expect(fg.legal(r.state).some((a) => a.type === 'stop')).toBe(true);
  });
  it('асальто: офицер обязан бить', () => {
    const s = fg.newState(fg.cfgFrom({ mode: 'asalto', lines: 'alt' }));
    s.board[P(0, 2)] = 0; // за повстанцем в (1,2) пусто — офицер из (2,2) может бить
    s.turn = 1;
    const ms = fg.legal(s);
    expect(ms.length).toBeGreaterThan(0);
    expect(ms.every((a) => a.type === 'move' && Math.abs(fg.geo(s.cfg).xy[a.from][1] - fg.geo(s.cfg).xy[a.to][1]) + Math.abs(fg.geo(s.cfg).xy[a.from][0] - fg.geo(s.cfg).xy[a.to][0]) >= 2)).toBe(true);
  });
  it('«Йога»: сложный бот решает английский крест до одной фишки', () => {
    let s = fg.newState(fg.cfgFrom({ mode: 'yoga' }));
    const rng = new SeededRng(1);
    while (!s.over) s = fg.step(s, yogaBot(s, 0, 2, rng)!).state;
    expect(fg.men(s)).toBe(1);
  });
});

describe('Тафл', () => {
  const at = (x: number, y: number) => y * 11 + x;
  function empty(): tf.State {
    const s = tf.newState(tf.cfgFrom({}));
    s.board.fill(0);
    s.board[at(5, 5)] = tf.KING;
    return s;
  }
  it('клещи и угол', () => {
    const s2 = empty();
    s2.board[at(4, 0)] = tf.ATT;
    s2.board[at(1, 0)] = tf.DEF;
    const r2 = tf.apply(s2, 0, { type: 'move', from: at(4, 0), to: at(2, 0) })!;
    expect(r2.events[0].type === 'move' && r2.events[0].taken).toEqual([at(1, 0)]);
  });
  it('стенка вдоль края', () => {
    const s = empty();
    for (const [x, y] of [
      [3, 1],
      [4, 1],
      [2, 0],
      [5, 3],
    ])
      s.board[at(x, y)] = tf.ATT;
    s.board[at(3, 0)] = tf.DEF;
    s.board[at(4, 0)] = tf.DEF;
    const r = tf.apply(s, 0, { type: 'move', from: at(5, 3), to: at(5, 0) })!;
    expect(r.state.board[at(3, 0)]).toBe(0);
    expect(r.state.board[at(4, 0)]).toBe(0);
    // в Фетларе стенки нет
    const f = { ...s, cfg: tf.cfgFrom({ kind: 'fetlar' }) };
    expect(tf.apply(f, 0, { type: 'move', from: at(5, 3), to: at(5, 0) })!.state.board[at(3, 0)]).toBe(tf.DEF);
  });
  it('короля берут с четырёх сторон, на краю — нельзя; в угол — победа', () => {
    const s = empty();
    s.board[at(5, 5)] = 0;
    s.board[at(3, 3)] = tf.KING;
    for (const [x, y] of [
      [2, 3],
      [4, 3],
      [3, 2],
      [3, 7],
    ])
      s.board[at(x, y)] = tf.ATT;
    expect(tf.apply(s, 0, { type: 'move', from: at(3, 7), to: at(3, 4) })!.state.winner).toBe(0);
    const e = empty();
    e.board[at(5, 5)] = 0;
    e.board[at(0, 5)] = tf.KING;
    e.board[at(8, 8)] = tf.ATT;
    e.turn = 1;
    expect(tf.apply(e, 1, { type: 'move', from: at(0, 5), to: at(0, 0) })!.state.winner).toBe(1);
  });
  it('на угол и трон встаёт только король', () => {
    const s = empty();
    s.board[at(0, 3)] = tf.ATT;
    expect(tf.movesFrom(s, at(0, 3))).not.toContain(at(0, 0));
  });
});
