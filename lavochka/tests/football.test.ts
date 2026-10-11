/* Настольный футбол: мяч не покидает поднос (кроме ворот), пружинные фигурки бьют, голы забиваются,
 * сильный бот обыгрывает слабого, ввод из сети чистится, оттянутая фигурка возвращается на место. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { botInput } from '../src/games/football/ai';
import { BALL_R, cleanInput, FIG_R, GOAL_D, GOAL_W, idleInput, LX, newGame, snapshot, SPOTS, step, TX, TZ, type FbIn } from '../src/games/football/engine';

function play(lvA: number, lvB: number, seed: number, minutes = 3) {
  const rng = new SeededRng(seed);
  const g = newGame(99, minutes, rng);
  const mem = [{}, {}];
  let out = 0;
  let kicks = 0;
  for (let t = 0; t < minutes * 3600 + 600 && !g.over; t++) {
    const v = snapshot(g);
    const ev = step(g, [botInput(v, 0, lvA, mem[0], rng), botInput(v, 1, lvB, mem[1], rng)], rng);
    kicks += ev.filter((e) => e.k === 'kick').length;
    const b = g.ball;
    const inGoal = Math.abs(b.z) < GOAL_W && Math.abs(b.x) <= LX + GOAL_D;
    if (!inGoal) out = Math.max(out, Math.abs(b.x) - TX, Math.abs(b.z) - TZ);
  }
  return { g, out, kicks };
}

describe('футбол', () => {
  it('мяч остаётся в подносе, фигурки бьют, голы забиваются', () => {
    let goals = 0;
    for (let seed = 1; seed <= 3; seed++) {
      const { g, out, kicks } = play(2, 2, seed);
      expect(out).toBeLessThan(0.001);
      expect(kicks).toBeGreaterThan(30);
      goals += g.score[0] + g.score[1];
    }
    expect(goals).toBeGreaterThan(3);
  });

  it('сильный бот забивает больше слабого', () => {
    let a = 0;
    let b = 0;
    for (let seed = 1; seed <= 4; seed++) {
      const { g } = play(2, 0, seed);
      a += g.score[0];
      b += g.score[1];
    }
    expect(a).toBeGreaterThan(b);
  });

  it('оттянул и отпустил — мяч полетел от фигурки, фигурка вернулась', () => {
    const rng = new SeededRng(5);
    const g = newGame(5, 3, rng);
    g.faceoff = 0;
    const [x, z] = SPOTS[0][5];
    g.ball = { x: x + FIG_R + BALL_R + 0.001, z, vx: 0, vy: 0, vz: 0 } as never;
    const hold: FbIn = { f: 5, h: 1, g: 0, knock: 0 };
    for (let i = 0; i < 40; i++) step(g, [hold, idleInput()], rng);
    expect(g.figs[5].ox).toBeLessThan(-0.01);
    let top = 0;
    for (let i = 0; i < 60; i++) {
      step(g, [{ ...hold, h: 0 }, idleInput()], rng);
      top = Math.max(top, g.ball.vx);
    }
    expect(top).toBeGreaterThan(0.5);
    for (let i = 0; i < 120; i++) step(g, [idleInput(), idleInput()], rng);
    expect(Math.hypot(g.figs[5].ox, g.figs[5].oz)).toBeLessThan(0.001);
  });

  it('ввод из сети чистится', () => {
    expect(cleanInput(null)).toBeNull();
    const c = cleanInput({ f: 42, h: 'yes', px: 9, pz: NaN, g: -7, gs: 3, knock: -1, sp: 5 })!;
    expect(c).toEqual({ f: 9, h: 1, g: -1, gs: 1, knock: 0, sp: 1 });
  });

  it('время кончается — конец', () => {
    const rng = new SeededRng(3);
    const g = newGame(5, 0.05, rng);
    for (let i = 0; i < 400 && !g.over; i++) step(g, [idleInput(), idleInput()], rng);
    expect(g.over).toBe(true);
  });

  it('фигурки не стоят слишком тесно', () => {
    const all = [...SPOTS[0], ...SPOTS[1]];
    for (let i = 0; i < all.length; i++)
      for (let j = i + 1; j < all.length; j++) expect(Math.hypot(all[i][0] - all[j][0], all[i][1] - all[j][1])).toBeGreaterThan(0.05);
  });
});
