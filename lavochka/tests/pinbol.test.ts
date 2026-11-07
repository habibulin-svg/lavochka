/* Пинбол: шар не вылетает со стола, пружина запускает его на поле, флипперы отбивают, очки идут, игра кончается.
 * «Автоигрок» бьёт флиппером, когда шар подкатывается к нему. */
import { describe, expect, it } from 'vitest';
import { BALL_R, newGame, step, tableOf, TABLES, TH, TW, type PbInput, type PbState } from '../src/games/pinbol/logic';

function auto(st: PbState, t: number, pullFrom: { t: number }): PbInput {
  const tb = tableOf(st.table);
  let l = false;
  let r = false;
  for (const b of st.balls) {
    if (b.y > 900 && b.y < 1010) {
      for (const f of tb.flippers) {
        const near = Math.hypot(b.x - (f.x + (f.side === 'L' ? 50 : -50)), b.y - (f.y + 10)) < 55;
        if (near) {
          if (f.side === 'L') l = true;
          else r = true;
        }
      }
    }
  }
  let pull = false;
  if (st.inLane) {
    if (pullFrom.t < 0) pullFrom.t = t;
    pull = t - pullFrom.t < 0.6 + (st.ball % 3) * 0.2;
  } else pullFrom.t = -1;
  return { l, r, pull };
}

function play(table: string, smart: boolean, seconds = 600) {
  const st = newGame(table);
  const dt = 1 / 60;
  const pf = { t: -1 };
  let out = -1e9;
  let launches = 0;
  let flipHits = 0;
  const kinds = new Set<string>();
  for (let i = 0; i < seconds * 60 && !st.over; i++) {
    const inp = smart ? auto(st, i * dt, pf) : { l: false, r: false, pull: st.inLane && i % 120 < 50 };
    const ev = step(st, inp, dt);
    for (const e of ev) {
      kinds.add(e.k);
      if (e.k === 'launch') launches++;
      if (e.k === 'flipHit') flipHits++;
    }
    for (const b of st.balls) out = Math.max(out, -b.x, b.x - TW, -b.y + BALL_R);
    void TH;
  }
  return { st, out, launches, flipHits, kinds, time: st.t };
}

describe('пинбол', () => {
  for (const tb of TABLES) {
    it(`${tb.title}: шар на столе, игра идёт и кончается`, () => {
      const dumb = play(tb.id, false);
      expect(dumb.st.over).toBe(true);
      expect(dumb.out).toBeLessThan(0);
      expect(dumb.launches).toBeGreaterThanOrEqual(3);
      expect(dumb.st.score).toBeGreaterThan(0);
      const smart = play(tb.id, true);
      expect(smart.out).toBeLessThan(0);
      expect(smart.flipHits).toBeGreaterThan(5);
      expect(smart.kinds.has('bumper')).toBe(true);
      // флипперами шар держится дольше, чем без них
      expect(smart.time).toBeGreaterThan(dumb.time);
    });
  }
});
