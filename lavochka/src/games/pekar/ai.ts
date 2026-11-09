/* Боты пекаря. Видят то же, что человек (где банка, где лежат палки, кто бежит), и прикидывают по тем же часам и
 * физике, что комната: бросают так, чтобы палка прошла через банку (перебор силы и направления по настоящему полёту),
 * рука дрожит тем сильнее, чем слабее бот; за палкой бегут, если пекарь не успеет осалить; пекарем — салят того,
 * кого вернее догнать. Слабый бот рискует невпопад. */
import type { Rng } from '../../core/types';
import {
  actor,
  canHome,
  chaseOf,
  dist2,
  pekarSpot,
  REACT,
  safeAt,
  flyStick,
  tagChance,
  throwBody,
  VP,
  VP_CAN,
  PICK_CAN,
  SET_CAN,
  waitSpot,
  lineY,
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

/** Дрожь руки (направление, сила), перебор вариантов, порог риска и небрежность. */
const LV = [
  { yaw: 0.075, pow: 0.1, tries: 12, risk: 0.55, careless: 0.35 },
  { yaw: 0.05, pow: 0.07, tries: 40, risk: 0.35, careless: 0.12 },
  { yaw: 0.035, pow: 0.05, tries: 50, risk: 0.22, careless: 0.03 },
];

/** Насколько надёжен бросок: доля попаданий в окрестности (рука дрожит). */
function rateThrow(s: State, rank: number, pow: number, yaw: number, style: Style, lv: (typeof LV)[number]): number {
  const c = s.cfg;
  const home = canHome(c);
  let hits = 0;
  const k = [-1, 0, 1];
  for (const dy of k)
    for (const dp of k) {
      const f = flyStick(throwBody(c, rank, clamp(pow + dp * lv.pow * 0.8, 0, 1), yaw + dy * lv.yaw * 0.8, style), style, home, 0, true);
      if (f.hit) hits++;
    }
  return hits / 9;
}

function chooseThrow(s: State, me: number, lv: (typeof LV)[number], rng: Rng): Action {
  const rank = s.pl[me].rank;
  let best = { pow: 0.6, yaw: 0, style: 'flat' as Style, r: -1 };
  for (let i = 0; i < lv.tries; i++) {
    const style: Style = rng.next() < 0.75 ? 'flat' : 'lob';
    const pow = rng.next();
    const yaw = -0.08 + rng.next() * 0.12;
    const r = rateThrow(s, rank, pow, yaw, style, lv) + (style === 'lob' ? 0.02 : 0);
    if (r > best.r) best = { pow, yaw, style, r };
  }
  return { type: 'throw', pow: clamp(best.pow + gauss(rng) * lv.pow, 0, 1), yaw: best.yaw + gauss(rng) * lv.yaw, style: best.style };
}

/** Опасность сбегать за палкой: шанс, что пекарь (поставив банку) осалит. */
function runDanger(s: State, me: number): number {
  const c = s.cfg;
  const p = s.pl[me];
  const r: Runner = { who: me, from: waitSpot(c, me, p.rank), stick: [p.sx, p.sy], home: waitSpot(c, me, p.rank), t0: REACT, line: lineY(c, p.rank) };
  let pk = s.sc?.pk ?? pekarSpot(c);
  let tc = s.sc?.t ?? 0;
  if (s.sc?.knocked && s.sc.fixT == null) {
    const can: [number, number] = [s.can.x, s.can.y];
    const home = canHome(c);
    const to: [number, number] = [home[0] + 0.35, home[1] + 0.25];
    tc = REACT + dist2(pk, can) / VP + PICK_CAN + dist2(can, to) / VP_CAN + SET_CAN;
    pk = to;
  }
  if (safeAt(r) <= tc) return 0;
  return tagChance(chaseOf(pk, tc, r).margin);
}

export function choose(s: State, seat: number, level: number, rng: Rng): Action {
  const lv = LV[clamp(level, 0, 2)];
  const me = actor(s);
  if (me < 0 || s.seats[me] !== seat) return { type: 'chase', who: null };
  if (s.phase === 'kick') {
    // посильнее, но не до срыва
    const pow = clamp(0.74 + gauss(rng) * (0.04 + lv.pow), 0.3, 1);
    return { type: 'kick', pow };
  }
  if (s.phase === 'throw') return chooseThrow(s, me, lv, rng);
  if (s.phase === 'run') {
    const d = runDanger(s, me);
    if (rng.next() < lv.careless) return { type: 'run', go: rng.next() < 0.6 };
    return { type: 'run', go: d <= lv.risk };
  }
  if (s.phase === 'fix') return { type: 'fix' };
  // пекарь: за кем вернее
  const sc = s.sc;
  if (!sc) return { type: 'chase', who: null };
  let best: number | null = null;
  let bc = 0;
  for (const r of sc.runners) {
    if (safeAt(r) <= sc.t) continue;
    const ch = chaseOf(sc.pk, sc.t, r);
    const p = tagChance(ch.margin);
    if (p > bc) (bc = p), (best = r.who);
  }
  if (best != null && rng.next() < lv.careless) {
    // слабый — гонится за первым попавшимся
    const any = sc.runners.filter((r) => safeAt(r) > sc.t);
    best = any[rng.int(any.length)]?.who ?? best;
  }
  return { type: 'chase', who: bc > 0 ? best : null };
}
