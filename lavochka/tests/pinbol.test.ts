/* Пинбол: шар не вылетает со стола и не пролетает сквозь стены, не застревает, пружина запускает его на поле,
 * флипперы отбивают, рампы, вертушки, стойки, круги и магниты срабатывают, очки идут, игра кончается.
 * «Автоигрок» бьёт флиппером, когда шар подкатывается к нему; сила пуска и момент удара меняются от партии к партии. */
import { describe, expect, it } from 'vitest';
import {
  BALL_R,
  crosses,
  newGame,
  rampAt,
  rampLen,
  step,
  tableOf,
  TABLES,
  TW,
  wallsOf,
  type Ball,
  type PbInput,
  type PbState,
} from '../src/games/pinbol/logic';

function auto(st: PbState, t: number, pullFrom: { t: number }, seed: number): PbInput {
  const tb = tableOf(st.table);
  let l = false;
  let r = false;
  const reach = 40 + (seed % 4) * 8;
  for (const b of st.balls) {
    if (b.ramp != null || b.held > 0) continue;
    if (b.y > 900 && b.y < 1010) {
      for (const f of tb.flippers) {
        const near = Math.hypot(b.x - (f.x + (f.side === 'L' ? reach : -reach)), b.y - (f.y + 10)) < 55;
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
    pull = t - pullFrom.t < 0.3 + ((st.ball + seed) % 5) * 0.15;
  } else pullFrom.t = -1;
  return { l, r, pull };
}

interface Run {
  st: PbState;
  out: number;
  launches: number;
  flipHits: number;
  kinds: Set<string>;
  time: number;
  /** Пролёты сквозь стены: где. */
  tunnels: string[];
  /** Дольше всего шар стоял на месте вне жёлоба (с). */
  stuck: number;
}

function play(table: string, smart: boolean, seconds = 600, seed = 0): Run {
  const st = newGame(table);
  const tb = tableOf(table);
  const walls = wallsOf(tb).filter((w) => !w.n);
  const segs: number[][] = [...walls.map((w) => [w.ax, w.ay, w.bx, w.by]), ...tb.standups];
  const dt = 1 / 60;
  const pf = { t: -1 };
  let out = -1e9;
  let launches = 0;
  let flipHits = 0;
  const kinds = new Set<string>();
  const tunnels: string[] = [];
  const still = new Map<Ball, { x: number; y: number; t: number }>();
  let stuck = 0;
  const trace = (b: Ball, px: number, py: number) => {
    for (const s of segs) if (crosses(px, py, b.x, b.y, s[0], s[1], s[2], s[3])) tunnels.push(`(${px.toFixed(0)},${py.toFixed(0)})→(${b.x.toFixed(0)},${b.y.toFixed(0)}) через ${s.map((v) => v.toFixed(0)).join(',')}`);
    for (const [x, y, r] of tb.posts) if (Math.hypot(b.x - x, b.y - y) < r) tunnels.push(`внутри столбика ${x},${y}`);
    for (const [x, y] of tb.bumpers) if (Math.hypot(b.x - x, b.y - y) < 26) tunnels.push(`внутри грибка ${x},${y}`);
  };
  for (let i = 0; i < seconds * 60 && !st.over; i++) {
    const inp = smart ? auto(st, i * dt, pf, seed) : { l: false, r: false, pull: st.inLane && i % 120 < 50 };
    const ev = step(st, inp, dt, tunnels.length < 5 ? trace : undefined);
    for (const e of ev) {
      kinds.add(e.k);
      if (e.k === 'launch') launches++;
      if (e.k === 'flipHit') flipHits++;
    }
    for (const b of st.balls) {
      out = Math.max(out, -b.x, b.x - TW, -b.y + BALL_R);
      // стоит ли шар: вне жёлоба, не в лунке/магните, не на рампе, не лежит на флиппере
      const free = b.held <= 0 && b.ramp == null && b.x < 548 && b.y < 960;
      const s = still.get(b);
      if (!free || !s || Math.hypot(b.x - s.x, b.y - s.y) > 3) still.set(b, { x: b.x, y: b.y, t: st.t });
      else stuck = Math.max(stuck, st.t - s.t);
    }
  }
  return { st, out, launches, flipHits, kinds, time: st.t, tunnels, stuck };
}

describe('пинбол', () => {
  for (const tb of TABLES) {
    it(`${tb.title}: шар на столе, игра идёт и кончается`, () => {
      const dumb = play(tb.id, false);
      expect(dumb.st.over).toBe(true);
      expect(dumb.out).toBeLessThan(0);
      expect(dumb.tunnels).toEqual([]);
      expect(dumb.launches).toBeGreaterThanOrEqual(3);
      expect(dumb.st.score).toBeGreaterThan(0);
      const smart = play(tb.id, true);
      expect(smart.out).toBeLessThan(0);
      expect(smart.tunnels).toEqual([]);
      expect(smart.flipHits).toBeGreaterThan(5);
      expect(smart.kinds.has('bumper')).toBe(true);
      // флипперами шар держится дольше, чем без них
      expect(smart.time).toBeGreaterThan(dumb.time);
    });

    it(`${tb.title}: элементы стола срабатывают, шар не застревает`, () => {
      const kinds = new Set<string>();
      let stuck = 0;
      let missions = 0;
      for (let seed = 0; seed < 8; seed++) {
        const r = play(tb.id, true, 400, seed);
        expect(r.tunnels).toEqual([]);
        expect(r.out).toBeLessThan(0);
        r.kinds.forEach((k) => kinds.add(k));
        stuck = Math.max(stuck, r.stuck);
        missions += r.st.mission + r.st.mlevel * tb.missions.length;
      }
      // «поиск шара» толкает замерший через 4 с — дольше шар не стоит
      expect(stuck).toBeLessThan(5);
      for (const k of ['spin', 'stand', 'rampIn', 'saucer', 'lane', 'sling']) expect(kinds, k).toContain(k);
      if (tb.disc) expect(kinds).toContain('disc');
      if (tb.magnet) expect(kinds).toContain('magnet');
      expect(missions).toBeGreaterThan(0);
    });

    it(`${tb.title}: рампа — с разгона шар проезжает к флипперу, без разгона скатывается назад`, () => {
      tb.ramps.forEach((R, i) => {
        for (const [v, back] of [
          [1500, false],
          [500, true],
        ] as const) {
          const st = newGame(tb.id);
          st.inLane = false;
          st.balls = [{ x: R.mouth[0] - R.dir[0] * 18, y: R.mouth[1] - R.dir[1] * 18, vx: R.dir[0] * v, vy: R.dir[1] * v, held: 0 }];
          const kinds = new Set<string>();
          for (let k = 0; k < 240; k++) for (const e of step(st, { l: false, r: false, pull: false }, 1 / 60)) kinds.add(e.k);
          expect(kinds.has('rampIn'), `въезд ${v}`).toBe(true);
          expect(kinds.has(back ? 'rampBack' : 'ramp'), `рампа ${i} ${v}`).toBe(true);
        }
        // выход рампы — над дорожкой к флипперу, внутри поля
        const [ex, ey] = rampAt(R, rampLen(R));
        expect(ex).toBeGreaterThan(62 + BALL_R);
        expect(ex).toBeLessThan(548 - 62 - BALL_R + 20);
        expect(ey).toBeLessThan(800);
      });
    });
  }
});
