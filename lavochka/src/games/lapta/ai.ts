/* Боты лапты. Видят то же, что человек (поле, где мяч, кто бежит), и прикидывают по тем же часам и физике, что комната:
 * бьют в «дыру» между полевыми и не в руки (свеча), бегут, если до броска успевают, ловят тем, кто раньше успеет, кидают
 * в того, в кого вернее попасть (или отдают пас ближе к бегущему). Слабый бот ошибается чаще и рискует невпопад. */
import type { Rng } from '../../core/types';
import {
  aimAt,
  canRun,
  catchChance,
  def0,
  flight,
  formation,
  hitChance,
  intercept,
  judge,
  runnerAt,
  strike,
  VT,
  WIND,
  type Action,
  type Runner,
  type State,
  type Style,
} from './engine';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const gauss = (rng: Rng) => {
  let u = 0;
  for (let k = 0; k < 4; k++) u += rng.next();
  return (u - 2) * 1.7;
};

/** Разброс руки (удар) и сколько вариантов перебирает. */
const LV = [
  { yaw: 0.12, pow: 0.1, tries: 10, risk: 0.42, careless: 0.5 },
  { yaw: 0.06, pow: 0.06, tries: 40, risk: 0.4, careless: 0.2 },
  { yaw: 0.03, pow: 0.03, tries: 90, risk: 0.4, careless: 0.04 },
];

/** Оценка удара: действителен ли, сколько времени полевым до мяча, опасность свечи. */
function rateHit(s: State, pow: number, yaw: number, style: Style): number {
  const c = s.cfg;
  const b0 = strike(c, pow, yaw, style);
  const fl = flight(b0);
  if (judge(c, fl.land) !== 'ok') return -10;
  const fpos = formation(c);
  let best = Infinity;
  let air = 0;
  for (const f of fpos) {
    const ic = intercept(b0, f);
    if (ic.t < best) best = ic.t;
    if (ic.air) air = Math.max(air, catchChance(ic.margin));
  }
  const sw = c.candle === 'swap' ? 8 : 3;
  return best - air * sw + (fl.land!.y / c.L) * 0.6;
}

/** Опасность для бегущего r: лучший шанс попасть из точки from в момент t. */
function danger(s: State, from: [number, number], t: number, r: Runner): number {
  const a = aimAt(s.cfg, from, t, r);
  return a ? hitChance(a.d) : 0;
}

export function choose(s: State, seat: number, level: number, rng: Rng): Action | null {
  if (s.over || s.seats[s.phase === 'hit' || s.phase === 'run' ? s.atk : def0(s)] !== seat) return null;
  const lv = LV[clamp(level, 0, 2)];
  const c = s.cfg;
  if (s.phase === 'hit') {
    let best: { pow: number; yaw: number; style: Style; sc: number } = { pow: 0.7, yaw: 0, style: 'far', sc: -Infinity };
    const styles: Style[] = ['far', 'low', 'candle'];
    for (let k = 0; k < lv.tries; k++) {
      const style = styles[k % 3 === 2 && rng.next() < 0.4 ? 2 : k % 2];
      const pow = 0.45 + rng.next() * 0.47;
      const yaw = (rng.next() - 0.5) * 0.9;
      const sc = rateHit(s, pow, yaw, style);
      if (sc > best.sc) best = { pow, yaw, style, sc };
    }
    return { type: 'hit', style: best.style, pow: clamp(best.pow + gauss(rng) * lv.pow, 0.2, 0.95), yaw: clamp(best.yaw + gauss(rng) * lv.yaw, -0.7, 0.7) };
  }
  const p = s.play;
  if (!p) return null;
  if (s.phase === 'run') {
    const who: number[] = [];
    // бить больше некому — без перебежки смена: рискуем смелее
    const stuck = s.teams[s.atk].queue.length === 0 ? 0.3 : 0;
    for (const w of canRun(s)) {
      const from = s.teams[s.atk].st[w] === 'kon' ? 'kon' : 'dom';
      const r: Runner = { who: w, from, t0: p.t + (p.caught ? 0.15 : 0.35) };
      let risk: number;
      if (!p.caught) {
        // мяч ещё летит: кто и когда его возьмёт
        let tb = Infinity;
        let pos: [number, number] = [0, c.L / 2];
        let air = 0;
        for (const f of p.fpos) {
          const ic = intercept(p.b0, f);
          if (ic.t < tb) (tb = ic.t), (pos = [ic.x, ic.y]), (air = ic.air ? 1 : 0);
        }
        risk = danger(s, pos, tb + 0.25, r);
        if (air && c.candle === 'swap') risk *= 0.5; // всё равно смена — бежать не страшно
      } else {
        const h = p.holder ?? 0;
        risk = danger(s, p.fpos[h], p.t, r);
        // пас ближе — тоже опасно
        for (const f of p.fpos) {
          const tp = p.t + WIND + Math.hypot(f[0] - p.fpos[h][0], f[1] - p.fpos[h][1]) / VT + 0.15;
          risk = Math.max(risk, danger(s, f, tp, r) * 0.9);
        }
      }
      const thr = lv.risk + stuck + (rng.next() - 0.5) * lv.careless;
      if (risk < thr) who.push(w);
    }
    return { type: 'run', who };
  }
  if (s.phase === 'catch') {
    const opts = p.fpos.map((f, i) => ({ i, ic: intercept(p.b0, f) })).sort((a, b) => (b.ic.air ? 1 : 0) - (a.ic.air ? 1 : 0) || a.ic.t - b.ic.t);
    const pick = level === 0 && opts.length > 1 && rng.next() < 0.3 ? opts[1] : opts[0];
    return { type: 'catch', who: pick.i };
  }
  if (s.phase === 'throw') {
    const h = p.holder ?? 0;
    const from = p.fpos[h];
    let best: Action = { type: 'hold' };
    let bp = 0;
    for (const r of p.runners) {
      const d = danger(s, from, p.t, r);
      if (d > bp) (bp = d), (best = { type: 'throw', at: r.who });
    }
    if (level > 0) {
      // пас ближе к бегущему, если оттуда вернее и бегущий ещё не добежит
      p.fpos.forEach((f, i) => {
        if (i === h) return;
        const tp = p.t + WIND + Math.hypot(f[0] - from[0], f[1] - from[1]) / VT + 0.15;
        for (const r of p.runners) {
          if (runnerAt(c, r, tp).done) continue;
          const d = danger(s, f, tp, r) * 0.92;
          if (d > bp + 0.12) (bp = d), (best = { type: 'pass', to: i });
        }
      });
    }
    if (best.type === 'hold' && p.runners.length && level === 0) return { type: 'throw', at: p.runners[0].who };
    return best;
  }
  return null;
}
