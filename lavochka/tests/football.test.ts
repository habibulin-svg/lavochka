/* Настольный футбол: мяч не покидает поле (кроме ворот), удар рычагом бьёт только достающая фигурка, голы засчитываются, сильный бот обыгрывает слабого. */
import { describe, expect, it } from 'vitest';
import { BALL_R, Football, GOAL, H, W } from '../src/games/football/logic';

function play(lvA: number, lvB: number, seed: number, seconds = 180) {
  const g = new Football('duel', 99, seconds / 60, seed);
  let maxOut = 0;
  for (let t = 0; t < seconds * 60 && !g.over; t++) {
    g.bot(0, lvA, 1 / 60);
    g.bot(1, lvB, 1 / 60);
    g.update(1000 / 60);
    if (Math.abs(g.by - H / 2) >= GOAL / 2) maxOut = Math.max(maxOut, -g.bx, g.bx - W, -g.by, g.by - H);
    g.sounds.length = 0;
  }
  return { g, maxOut };
}

describe('футбол', () => {
  it('мяч на поле, голы забиваются', () => {
    let goals = 0;
    for (let seed = 1; seed <= 4; seed++) {
      const { g, maxOut } = play(2, 2, seed);
      expect(maxOut).toBeLessThan(BALL_R);
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
  it('удар: фигурка далеко — мяч не трогается, рядом — летит вперёд', () => {
    const g = new Football('duel', 5, 3, 7);
    g.pause = 0;
    const i = g.figs.findIndex((f) => f.team === 0 && f.line === 'M');
    const f = g.figs[i];
    g.bx = f.x + 0.2;
    g.by = f.y;
    g.vx = g.vy = 0;
    g.kickFig(i);
    expect(g.vx).toBe(0);
    f.kick = 0;
    g.bx = f.x + 0.03;
    g.by = f.y;
    g.kickFig(i);
    expect(g.vx).toBeGreaterThan(1);
  });
});
