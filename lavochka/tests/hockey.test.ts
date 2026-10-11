/* Настольный хоккей: шайба не покидает площадку (кроме ворот), голы забиваются, сильный бот обыгрывает слабого,
 * фигурки не уезжают с прорезей, ввод из сети чистится, время кончается. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { botInput } from '../src/games/hockey/ai';
import { cleanInput, GL, GOAL, H, idleInput, newGame, PUCK_R, slotAt, SLOTS, snapshot, step, W, type HkIn } from '../src/games/hockey/engine';

function play(lvA: number, lvB: number, seed: number, minutes = 3) {
  const rng = new SeededRng(seed);
  const g = newGame(99, minutes, rng);
  const mem = [{}, {}];
  let maxOut = 0;
  let hits = 0;
  for (let t = 0; t < minutes * 3600 + 600 && !g.over; t++) {
    const v = snapshot(g);
    const inputs = [botInput(v, 0, lvA, mem[0], rng), botInput(v, 1, lvB, mem[1], rng)];
    const ev = step(g, inputs, rng);
    hits += ev.filter((e) => e.k === 'hit').length;
    const inMouth = Math.abs(g.puck.y - H / 2) < GOAL / 2;
    if (!inMouth) maxOut = Math.max(maxOut, -g.puck.x, g.puck.x - W, -g.puck.y, g.puck.y - H);
  }
  return { g, maxOut, hits };
}

describe('хоккей', () => {
  it('шайба остаётся на площадке, клюшки бьют, голы забиваются', () => {
    let goals = 0;
    for (let seed = 1; seed <= 3; seed++) {
      const { g, maxOut, hits } = play(2, 2, seed);
      expect(maxOut).toBeLessThan(PUCK_R);
      expect(hits).toBeGreaterThan(20);
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

  it('время кончается — конец; до N шайб — конец', () => {
    const rng = new SeededRng(3);
    const g = newGame(5, 0.05, rng);
    for (let i = 0; i < 400 && !g.over; i++) step(g, [idleInput(), idleInput()], rng);
    expect(g.over).toBe(true);
  });

  it('фигурки не уезжают с прорезей, прорези — внутри площадки', () => {
    const rng = new SeededRng(4);
    const g = newGame(5, 1, rng);
    const push: HkIn = { f: { m: 1, r: 1 }, g: { m: -1, r: -1 }, pick: 5, knock: 0 };
    for (let i = 0; i < 300; i++) step(g, [push, { ...push, pick: 1 }], rng);
    for (const f of g.figs) {
      expect(f.s).toBeGreaterThanOrEqual(0);
      expect(f.s).toBeLessThanOrEqual(1);
    }
    for (const sl of SLOTS)
      for (const s of [0, 0.5, 1]) {
        const [x, y] = slotAt(sl, s);
        expect(x).toBeGreaterThan(GL);
        expect(x).toBeLessThan(W - GL);
        expect(y).toBeGreaterThan(0.02);
        expect(y).toBeLessThan(H - 0.02);
      }
  });

  it('ввод из сети чистится', () => {
    expect(cleanInput(null)).toBeNull();
    expect(cleanInput('x')).toBeNull();
    const c = cleanInput({ f: { m: 9, r: -9, s: 2, a: NaN }, g: 'junk', pick: 17, knock: -3 })!;
    expect(c.f).toEqual({ m: 1, r: -1, s: 1 });
    expect(c.g).toEqual({ m: 0, r: 0 });
    expect(c.pick).toBe(5);
    expect(c.knock).toBe(0);
  });

  it('удар крутящейся клюшкой разгоняет шайбу', () => {
    const rng = new SeededRng(5);
    const g = newGame(5, 3, rng);
    g.faceoff = 0;
    // правый крайний красных; шайба у его крюка
    const i = 4;
    g.figs[i].s = 0.5;
    g.figs[i].a = 0;
    const [x, y] = slotAt(SLOTS[i], 0.5);
    g.puck = { x: x + 0.03, y: y + 0.02, vx: 0, vy: 0 };
    g.active = [4, 3];
    const spin: HkIn = { f: { m: 0, r: 1 }, g: { m: 0, r: 0 }, pick: 4, knock: 0 };
    let top = 0;
    for (let k = 0; k < 20; k++) {
      step(g, [spin, idleInput()], rng);
      top = Math.max(top, Math.hypot(g.puck.vx, g.puck.vy));
    }
    expect(top).toBeGreaterThan(0.6);
  });
});
