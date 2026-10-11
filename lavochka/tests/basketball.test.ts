/* Настольный баскетбол: мяч не покидает колпак, ложится в лунки, точный бросок попадает, быстрый бот набирает больше медленного. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { botInput, keyPos } from '../src/games/basketball/ai';
import { BALL_R, CELLS, cleanInput, domeDist, idleInput, labelOf, newGame, restY, snapshot, step, type BbIn, type BbState } from '../src/games/basketball/engine';

function play(lvA: number, lvB: number, seed: number, minutes = 3) {
  const rng = new SeededRng(seed);
  const g = newGame(999, minutes, rng);
  const mem = [{}, {}];
  let worst = -1;
  let shots = 0;
  let caps = 0;
  let lastCap = 0;
  for (let t = 0; t < minutes * 3600 + 60 && !g.over; t++) {
    const v = snapshot(g);
    const ev = step(g, [botInput(v, 0, lvA, mem[0], rng), botInput(v, 1, lvB, mem[1], rng)], rng);
    shots += ev.filter((e) => e.k === 'shot').length;
    if (g.cap !== lastCap) (caps++, (lastCap = g.cap));
    worst = Math.max(worst, domeDist(g.ball.x, g.ball.y, g.ball.z)[0] + BALL_R);
  }
  return { g, worst, shots, caps };
}

/** Мяч в лунке h, стреляет команда team: попал ли. */
function shoot(team: 0 | 1, hole: number, seed: number): boolean {
  const rng = new SeededRng(seed);
  const g: BbState = newGame(99, 3, rng);
  g.serve = 0;
  const c = CELLS[hole];
  g.ball = { x: c.hx, y: restY(), z: c.hz, vx: 0, vy: 0, vz: 0 };
  g.hole = hole;
  const press: BbIn = { k: keyPos(labelOf(team, hole)), n: 1 };
  step(g, team === 0 ? [press, idleInput()] : [idleInput(), press], rng);
  for (let i = 0; i < 120 && g.hole < 0; i++) step(g, [null, null], rng);
  return g.score[team] > 0;
}

describe('баскетбол', () => {
  it('мяч остаётся под колпаком и ложится в лунки', () => {
    for (let seed = 1; seed <= 3; seed++) {
      const { worst, shots, caps } = play(2, 1, seed, 2);
      expect(worst).toBeLessThan(0.003);
      expect(shots).toBeGreaterThan(40);
      expect(caps).toBeGreaterThan(40);
    }
  });

  it('из каждой лунки попадают заметно часто, но не всегда', () => {
    for (const team of [0, 1] as const) {
      let hit = 0;
      let n = 0;
      for (let h = 0; h < CELLS.length; h++)
        for (let s = 1; s <= 30; s++) {
          n++;
          if (shoot(team, h, s * 31 + h)) hit++;
        }
      expect(hit / n).toBeGreaterThan(0.3);
      expect(hit / n).toBeLessThan(0.85);
    }
  });

  it('быстрый бот набирает больше медленного', () => {
    let a = 0;
    let b = 0;
    for (let seed = 1; seed <= 3; seed++) {
      const { g } = play(2, 0, seed, 2);
      a += g.score[0];
      b += g.score[1];
    }
    expect(a).toBeGreaterThan(b);
  });

  it('не та клавиша — рука залипает, бросок не выходит', () => {
    const rng = new SeededRng(7);
    const g = newGame(21, 3, rng);
    g.serve = 0;
    const c = CELLS[0];
    g.ball = { x: c.hx, y: restY(), z: c.hz, vx: 0, vy: 0, vz: 0 };
    g.hole = 0;
    const wrong = keyPos(labelOf(0, 1));
    step(g, [{ k: wrong, n: 1 }, null], rng);
    expect(g.hole).toBe(0);
    expect(g.lock[0]).toBeGreaterThan(0);
    step(g, [{ k: keyPos(labelOf(0, 0)), n: 2 }, null], rng);
    expect(g.hole).toBe(0);
  });

  it('ввод из сети чистится', () => {
    expect(cleanInput(null)).toBeNull();
    expect(cleanInput({ k: 42, n: -5 })).toEqual({ k: 9, n: 0 });
    expect(cleanInput({ k: 'x', n: 3.4 })).toEqual({ k: -1, n: 3 });
  });

  it('у каждой лунки свои номера у красных и синих', () => {
    for (const t of [0, 1] as const) expect(new Set(CELLS.map((_, h) => labelOf(t, h))).size).toBe(10);
  });
});
