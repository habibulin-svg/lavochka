/* Настольный хоккей: шайба не покидает площадку (кроме ворот), голы засчитываются, время идёт, сильный бот обыгрывает слабого. */
import { describe, expect, it } from 'vitest';
import { figPos, GOAL, H, Hockey, PUCK_R, W } from '../src/games/hockey/logic';

function play(lvA: number, lvB: number, seed: number, seconds = 180) {
  const g = new Hockey('duel', 99, seconds / 60, seed);
  let maxOut = 0;
  for (let t = 0; t < seconds * 60 && !g.over; t++) {
    g.update(1000 / 60, [g.bot(0, lvA), g.bot(1, lvB)]);
    const inMouth = Math.abs(g.py - H / 2) < GOAL / 2;
    if (!inMouth) maxOut = Math.max(maxOut, -g.px, g.px - W, -g.py, g.py - H);
    g.sounds.length = 0;
  }
  return { g, maxOut };
}

describe('хоккей', () => {
  it('шайба остаётся на площадке, голы забиваются', () => {
    let goals = 0;
    for (let seed = 1; seed <= 4; seed++) {
      const { g, maxOut } = play(2, 2, seed);
      expect(maxOut).toBeLessThan(PUCK_R);
      goals += g.score[0] + g.score[1];
    }
    expect(goals).toBeGreaterThan(0);
  });
  it('сильный бот забивает больше слабого', () => {
    let a = 0;
    let b = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const { g } = play(2, 0, seed);
      a += g.score[0];
      b += g.score[1];
    }
    expect(a).toBeGreaterThan(b);
  });
  it('время кончается — конец; до N шайб — конец', () => {
    const g = new Hockey('bot1', 5, 0.05, 3);
    for (let i = 0; i < 400 && !g.over; i++) g.update(16, [{ dx: 0, dy: 0, turn: 0 }, { dx: 0, dy: 0, turn: 0 }]);
    expect(g.over).toBe(true);
  });
  it('фигурки не уезжают с прорезей', () => {
    const g = new Hockey('duel', 5, 1, 4);
    for (let i = 0; i < 300; i++) g.update(16, [{ dx: 1, dy: 1, turn: 1 }, { dx: -1, dy: -1, turn: -1 }]);
    for (const f of g.figs) {
      expect(f.s).toBeGreaterThanOrEqual(0);
      expect(f.s).toBeLessThanOrEqual(1);
      const p = figPos(f);
      expect(p.x).toBeGreaterThan(0);
      expect(p.x).toBeLessThan(W);
    }
  });
});
