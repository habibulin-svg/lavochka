/* Аэрохоккей: шайба не покидает стол (кроме ворот), голы забиваются, сильный бот обыгрывает слабого,
 * биты не заходят за центр, ввод из сети чистится, время кончается. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { botInput } from '../src/games/aerohockey/ai';
import { cleanInput, GOAL, L, newGame, PUCK_R, snapshot, step, W } from '../src/games/aerohockey/engine';

function play(lvA: number, lvB: number, seed: number, goals = 99, minutes = 3, speed = 0.7) {
  const rng = new SeededRng(seed);
  const g = newGame(goals, minutes, rng, speed);
  const mem = [{}, {}];
  let maxOut = 0;
  let cross = -1;
  let hits = 0;
  for (let t = 0; t < Math.max(minutes, 3) * 3600 + 600 && !g.over; t++) {
    const v = snapshot(g);
    const inputs = [botInput(v, 0, lvA, mem[0], rng), botInput(v, 1, lvB, mem[1], rng)];
    const ev = step(g, inputs, rng);
    hits += ev.filter((e) => e.k === 'hit').length;
    const inMouth = Math.abs(g.puck.x) < GOAL / 2;
    maxOut = Math.max(maxOut, Math.abs(g.puck.x) - W / 2);
    if (!inMouth) maxOut = Math.max(maxOut, -g.puck.y, g.puck.y - L);
    cross = Math.max(cross, g.mal[0].y - L / 2, L / 2 - g.mal[1].y);
  }
  return { g, maxOut, hits, cross };
}

describe('аэрохоккей', () => {
  it('шайба на столе, биты бьют и не заходят за центр, голы забиваются', () => {
    let goals = 0;
    for (let seed = 1; seed <= 3; seed++) {
      const { g, maxOut, hits, cross } = play(2, 2, seed);
      expect(maxOut).toBeLessThan(PUCK_R * 0.5);
      expect(cross).toBeLessThan(0);
      expect(hits).toBeGreaterThan(30);
      goals += g.score[0] + g.score[1];
    }
    expect(goals).toBeGreaterThan(2);
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

  it('партия кончается по счёту и по времени', () => {
    const r1 = play(2, 1, 7, 3, 0);
    expect(r1.g.over).toBe(true);
    expect(Math.max(...r1.g.score)).toBe(3);
    const r2 = play(1, 1, 8, 99, 1);
    expect(r2.g.over).toBe(true);
  });

  it('ввод из сети чистится', () => {
    expect(cleanInput(null)).toBeNull();
    expect(cleanInput({ kx: 5, ky: -9, x: 1e9, y: 'a' })).toEqual({ kx: 1, ky: -1 });
    expect(cleanInput({ kx: 0, ky: 0, x: 0.1, y: 0.2, sp: 0.5 })).toEqual({ kx: 0, ky: 0, x: 0.1, y: 0.2, sp: 0.5 });
  });
});
