/* Боты чижа — дают ввод на каждом шаге по view своего места (видят то же, что человек: чижа и его полёт). Бьющий
 * выбирает, куда бить (подальше от водящих: перебор направлений по настоящему полёту), подбивает и бьёт в «пояс» —
 * с ошибкой по времени тем больше, чем слабее бот; отбивает бросок, если чиж идёт в кон; добивает. Водящие бегут
 * туда, где чижа можно перехватить в воздухе, и ловят; не успели — к месту падения; подобрал — бросает в кон
 * (перебор силы по полёту, рука дрожит). Слабый бот медлит и ошибается чаще. */
import { sample } from '../../core/dvorsport/body';
import type { Rng } from '../../core/types';
import {
  airborne,
  awayYaw,
  BONUS_REACH,
  CATCH,
  chAt,
  chFlight,
  clamp,
  DEFEND,
  fieldSpot,
  hitBody,
  inKon,
  popBody,
  SWING,
  throwBody,
  VR,
  type In,
  type State,
} from './engine';

const LV = [
  { cErr: 0.28, err: 1.6, react: 0.45, tErr: 0.075, pow: 0.12, yaw: 0.14, thPow: 0.08, thYaw: 0.07, def: 0.3, run: 0.82, wait: 0.8, smart: false },
  { cErr: 0.16, err: 1.0, react: 0.3, tErr: 0.04, pow: 0.07, yaw: 0.07, thPow: 0.05, thYaw: 0.045, def: 0.6, run: 0.95, wait: 0.5, smart: true },
  { cErr: 0.08, err: 0.6, react: 0.18, tErr: 0.022, pow: 0.04, yaw: 0.04, thPow: 0.032, thYaw: 0.03, def: 0.85, run: 1, wait: 0.3, smart: true },
];

const gauss = (rng: Rng) => {
  let u = 0;
  for (let k = 0; k < 4; k++) u += rng.next();
  return (u - 2) * 1.7;
};

function toward(x: number, y: number, tx: number, ty: number, slow = 0.4, k = 1): { mx: number; my: number } {
  const dx = tx - x;
  const dy = ty - y;
  const d = Math.hypot(dx, dy);
  if (d < 0.06) return { mx: 0, my: 0 };
  const f = (d < slow ? d / slow : 1) * k;
  return { mx: (dx / d) * f, my: (dy / d) * f };
}

/** Куда бить: направление, при котором до места падения водящим бежать дольше всего. */
function bestYaw(s: State, i: number, x: number, y: number, base: number, smart: boolean, rng: Rng): number {
  if (!smart) return (rng.next() - 0.5) * 0.7;
  let best = 0;
  let bs = -Infinity;
  for (let yaw = -0.5; yaw <= 0.501; yaw += 0.1) {
    const f = chFlight(hitBody(x, y, SWING.best, -1, 0.95, base + yaw, 1));
    const lt = f.land;
    const fr = sample(f.frames, lt);
    let worst = Infinity;
    s.men.forEach((m, k) => {
      if (k === i) return;
      worst = Math.min(worst, Math.hypot(m.x - fr[1], m.y - fr[2]) - VR * lt);
    });
    const sc = worst + Math.hypot(fr[1], fr[2]) * 0.05 + rng.next() * 0.3;
    if (sc > bs) (bs = sc), (best = yaw);
  }
  return best;
}

/** Когда махнуть по подбитому чижу: время (от подбива), когда он падает через «пояс». */
function swingAt(b0: ReturnType<typeof popBody>): number {
  const f = chFlight(b0);
  let up = false;
  for (const fr of f.frames) {
    if (fr[3] > SWING.best + 0.05) up = true;
    if (up && fr[3] <= SWING.best) return fr[0];
  }
  return f.land * 0.7;
}

export function botInput(s: State, seat: number, level: number, mem: Record<string, any>, rng: Rng): In {
  const lv = LV[clamp(level, 0, 2)];
  const i = s.seats.indexOf(seat);
  const out: In = { mx: 0, my: 0 };
  if (i < 0 || s.over) return out;
  for (const k of ['th', 's', 'c', 'd', 'st'] as const) mem[k] ??= 0;
  if (mem.thIn) out.th = mem.thIn;
  out.s = mem.s;
  out.c = mem.c;
  out.d = mem.d;
  out.st = mem.st;
  if (s.phase === 'pause') {
    mem.plan = undefined;
    mem.flyKey = undefined;
    return out;
  }
  const m = s.men[i];
  const ch = s.ch;
  const sp = s.speed;
  const key = ch.t0 != null ? `${ch.mode}${ch.t0}` : ch.mode;

  // ---------------- бьющий
  if (i === s.batter) {
    if (s.phase === 'tee' || s.phase === 'bonus') {
      if (s.phase === 'bonus') {
        // встать к чижу со стороны кона
        const dir = awayYaw(ch.x, ch.y);
        const gx = ch.x - 0.45 * Math.sin(dir);
        const gy = ch.y - 0.45 * Math.cos(dir);
        const d = Math.hypot(m.x - ch.x, m.y - ch.y);
        if (d > BONUS_REACH * 0.8) {
          mem.plan = undefined;
          Object.assign(out, toward(m.x, m.y, gx, gy, 0.3));
          return out;
        }
      }
      mem.plan ??= { at: s.t + lv.wait * sp * (0.6 + rng.next() * 0.8) };
      if (s.t >= mem.plan.at && Math.hypot(m.vx, m.vy) < 0.3) {
        const base = s.phase === 'tee' ? 0 : awayYaw(ch.x, ch.y);
        const yaw = clamp(bestYaw(s, i, ch.x, ch.y, base, lv.smart, rng) + gauss(rng) * lv.yaw, -1, 1);
        const pow = clamp(0.92 + gauss(rng) * lv.pow, 0, 1);
        mem.thIn = { n: ++mem.th, pow, yaw };
        out.th = mem.thIn;
        mem.plan = undefined;
      }
      return out;
    }
    if (s.phase === 'pop') {
      if (!mem.swing || mem.swing.key !== key) mem.swing = { key, at: swingAt(ch.b0!) + gauss(rng) * lv.tErr, done: false };
      if (!mem.swing.done && s.t - ch.t0! >= mem.swing.at) {
        mem.swing.done = true;
        out.s = ++mem.s;
      }
      return out;
    }
    // водящие с чижом: встать между ним и коном, отбивать бросок
    if (s.phase === 'field' || s.phase === 'back' || s.phase === 'fly') {
      const [cx, cy, cz] = chAt(s);
      const src = s.phase === 'back' && ch.b0 ? [ch.b0.x, ch.b0.y] : [cx, cy];
      const dd = Math.hypot(src[0], src[1]) || 1;
      Object.assign(out, toward(m.x, m.y, (src[0] / dd) * 0.7 - 0.25, (src[1] / dd) * 0.7, 0.3));
      if (s.phase === 'back' && airborne(s)) {
        if (mem.defKey !== key) {
          const f = chFlight(ch.b0!);
          mem.defKey = key;
          mem.def = inKon(s.cfg, f.rest[0], f.rest[1]) || rng.next() < 0.3 ? rng.next() < lv.def : false;
          mem.defDone = false;
        }
        const d = Math.hypot(m.x - cx, m.y - cy);
        if (mem.def && !mem.defDone && d < DEFEND.reach * 0.9 && cz > DEFEND.z0 + 0.1 && cz < DEFEND.z1 - 0.1) {
          mem.defDone = true;
          out.s = ++mem.s;
        }
      }
      return out;
    }
    return out;
  }

  // ---------------- водящие
  const k = s.men.slice(0, i).filter((_, j) => j !== s.batter).length;
  if (s.phase === 'tee' || s.phase === 'pop') {
    const [gx, gy] = fieldSpot(k);
    Object.assign(out, toward(m.x, m.y, gx, Math.max(gy, s.cfg.line + 1.2), 0.5));
    return out;
  }
  if (s.phase === 'fly') {
    if (mem.flyKey !== key) {
      mem.flyKey = key;
      mem.flyGo = s.t + lv.react * sp * (0.7 + rng.next() * 0.6);
      mem.goal = null;
    }
    if (s.t < mem.flyGo) return out;
    const f = chFlight(ch.b0!);
    const tt = s.t - ch.t0!;
    // где перехватить: первая точка спуска на высоте рук, куда успеваю
    if (!mem.goal) {
      let goal: [number, number, boolean] | null = null;
      mem.cPress = Infinity;
      // когда успевает под чижа каждый водящий: ловить идут двое первых, остальные — к месту падения
      const when = (q: { x: number; y: number }, run: number) => {
        for (const fr of f.frames) {
          if (fr[0] <= tt || fr[0] > f.land || fr[3] > 1.9 || fr[3] < 0.4) continue;
          if (Math.max(0, Math.hypot(fr[1] - q.x, fr[2] - q.y) - 0.35) / (VR * run) <= fr[0] - tt) return fr[0];
        }
        return Infinity;
      };
      const mine = when(m, lv.run);
      const ahead = s.men.filter((q, j) => j !== i && j !== s.batter && when(q, 1) < mine).length;
      for (const fr of ahead >= 2 ? [] : f.frames) {
        if (fr[0] <= tt || fr[0] > f.land) continue;
        if (fr[3] > 1.9 || fr[3] < 0.4) continue;
        const need = Math.max(0, Math.hypot(fr[1] - m.x, fr[2] - m.y) - 0.35) / (VR * lv.run);
        if (need <= fr[0] - tt) {
          goal = [fr[1], fr[2], true];
          // «Ловить» — к моменту, когда чиж будет у рук; рука ошибается по времени (окно кнопки ~0,45 с)
          mem.cPress = fr[0] - CATCH.win * 0.35 + gauss(rng) * lv.cErr;
          break;
        }
      }
      // глаз ошибается: чиж маленький и быстрый
      mem.goal = goal ? [goal[0] + gauss(rng) * lv.err * 0.6, goal[1] + gauss(rng) * lv.err, true] : [f.rest[0], f.rest[1], false];
    }
    Object.assign(out, toward(m.x, m.y, mem.goal[0], mem.goal[1], 0.15, lv.run));
    if (airborne(s) && tt >= mem.cPress) {
      out.c = ++mem.c;
      mem.cPress = Infinity;
    }
    return out;
  }
  if (s.phase === 'field') {
    if (s.holder === i) {
      mem.hold ??= s.t + lv.wait * sp * (0.6 + rng.next() * 0.8);
      if (s.t >= mem.hold) {
        const ok: number[] = [];
        for (let p = 0; p <= 1.0001; p += 0.025) {
          const f = chFlight(throwBody(ch.x, ch.y, p, 0));
          if (inKon(s.cfg, f.rest[0], f.rest[1])) ok.push(p);
        }
        const p0 = ok.length ? ok[Math.floor(ok.length / 2)] : 1;
        mem.thIn = { n: ++mem.th, pow: clamp(p0 + gauss(rng) * lv.thPow, 0, 1), yaw: gauss(rng) * lv.thYaw };
        out.th = mem.thIn;
        mem.hold = undefined;
      }
      return out;
    }
    mem.hold = undefined;
    if (s.holder < 0) Object.assign(out, toward(m.x, m.y, ch.x, ch.y, 0.05, lv.run));
    return out;
  }
  if (s.phase === 'bonus' || s.phase === 'back') {
    // разойтись подальше в сторону следующего удара
    const [cx, cy] = chAt(s);
    const dir = awayYaw(cx, cy);
    const side = (k % 2 ? 1 : -1) * (1 + Math.floor(k / 2)) * 0.35;
    const dd = 9 + k * 4;
    Object.assign(out, toward(m.x, m.y, cx + Math.sin(dir + side) * dd, cy + Math.cos(dir + side) * dd, 0.5, 0.8));
    return out;
  }
  return out;
}
