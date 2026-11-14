/* Боты пекаря — дают ввод на каждом шаге по view своего места (видят то же, что человек). Бросают так, чтобы палка прошла
 * через банку (перебор силы и направления по настоящему полёту с «дрожью руки», тем сильнее, чем слабее бот); за палкой
 * бегут, когда банка лежит или пекарь далеко, и уворачиваются от пекаря; пекарем — бегут к банке, несут её в кружок,
 * потом догоняют того, кто в поле. Слабый бот медлит и рискует невпопад. */
import type { Rng } from '../../core/types';
import {
  canHome,
  catchable,
  CATCH_R,
  CATCH_Z,
  stickFlight,
  clamp,
  dist2,
  flyStick,
  inField,
  kicker,
  lineOf,
  pekarSpot,
  REACH,
  throwFrom,
  VP,
  VR,
  waitSpot,
  whoThrows,
  yawTo,
  type In,
  type State,
  type Style,
} from './engine';

/** Дрожь руки (направление, сила), перебор, осторожность (запас по времени до пекаря, с), задержка броска (с). */
const LV = [
  { yaw: 0.075, pow: 0.1, tries: 12, safe: 0.1, wait: 0.95, lead: 0 },
  { yaw: 0.05, pow: 0.07, tries: 30, safe: 0.5, wait: 0.75, lead: 0.3 },
  { yaw: 0.035, pow: 0.05, tries: 50, safe: 0.8, wait: 0.6, lead: 0.4 },
];

const gauss = (rng: Rng) => {
  let u = 0;
  for (let k = 0; k < 4; k++) u += rng.next();
  return (u - 2) * 1.7;
};

/** Направление к точке (у цели — тише). */
function toward(x: number, y: number, tx: number, ty: number, slow = 0.4): { mx: number; my: number } {
  const dx = tx - x;
  const dy = ty - y;
  const d = Math.hypot(dx, dy);
  if (d < 0.08) return { mx: 0, my: 0 };
  const k = d < slow ? d / slow : 1;
  return { mx: (dx / d) * k, my: (dy / d) * k };
}

/** Лучший бросок с места: доля попаданий в окрестности (рука дрожит). */
function bestThrow(s: State, i: number, lv: (typeof LV)[number], rng: Rng): { pow: number; yaw: number; style: Style } {
  const c = s.cfg;
  const m = s.men[i];
  const home = canHome(c);
  const base = yawTo(c, m.x, m.y);
  let best = { pow: 0.6, yaw: 0, style: 'flat' as Style, r: -1 };
  for (let k = 0; k < lv.tries; k++) {
    const style: Style = rng.next() < 0.75 ? 'flat' : 'lob';
    const pow = rng.next();
    const yaw = -0.05 + rng.next() * 0.1;
    let hits = 0;
    for (const dy of [-1, 0, 1])
      for (const dp of [-1, 0, 1]) {
        const b = throwFrom(c, m.x, m.y, clamp(pow + dp * lv.pow * 0.8, 0, 1), base + yaw + dy * lv.yaw * 0.8, style);
        if (flyStick(b, style, home, 0, true).hit) hits++;
      }
    const r = hits / 9;
    if (r > best.r) best = { pow, yaw, style, r };
  }
  return { pow: clamp(best.pow + gauss(rng) * lv.pow, 0, 1), yaw: best.yaw + gauss(rng) * lv.yaw, style: best.style };
}

export function botInput(s: State, seat: number, level: number, mem: Record<string, any>, rng: Rng): In {
  const lv = LV[clamp(level, 0, 2)];
  const i = s.seats.indexOf(seat);
  const out: In = { mx: 0, my: 0 };
  if (i < 0 || s.over) return out;
  mem.th ??= 0;
  mem.k ??= 0;
  mem.a ??= 0;
  mem.d ??= 0;
  if (mem.thIn) out.th = mem.thIn;
  if (mem.kIn) out.k = mem.kIn;
  out.a = mem.a;
  out.d = mem.d;
  if (s.phase === 'pause') return out;
  // расход по местам и «приготовились»: кто идёт на место — ждёт; отсчёт «подумать» начнётся после
  if (s.settle?.to[i] || (s.t < (s.readyT ?? 0) && !s.settle)) {
    mem.tWait = undefined;
    if (s.settle?.to[i]) return out;
  }
  const c = s.cfg;
  const m = s.men[i];

  if (s.phase === 'kick') {
    if (kicker(s) !== i) {
      mem.kWait = undefined;
      return out;
    }
    mem.kWait ??= s.t + 0.9 * s.speed;
    if (s.t >= mem.kWait) {
      mem.kIn = { n: ++mem.k, pow: clamp(0.74 + gauss(rng) * (0.04 + lv.pow), 0.3, 1) };
      out.k = mem.kIn;
      mem.kWait = undefined;
    }
    return out;
  }

  // ---------------- пекарь
  if (i === s.pekar) {
    const home = canHome(c);
    let g: [number, number];
    if (s.can.mode === 'down' || s.can.mode === 'fly') g = [s.can.x, s.can.y];
    else if (s.can.mode === 'held') g = home;
    else if (s.fly >= 0 && s.cfg.catch && level > 0 && (mem.tryCatch ??= rng.next() < (level === 2 ? 0.9 : 0.5)) && catchPoint(s, m)) {
      // палка летит мимо — встать на её пути за банкой и поймать
      const cp = catchPoint(s, m)!;
      g = cp;
      const now = catchable(s);
      if (now && Math.hypot(now.x - m.x, now.y - m.y) < CATCH_R * 0.9) out.a = ++mem.a;
    } else {
      if (s.fly < 0) mem.tryCatch = undefined;
      // кого догнать: того, до кого успеть раньше, чем он уйдёт за черту
      let best = -1;
      let bt = Infinity;
      for (let k = 0; k < c.n; k++) {
        if (!inField(s, k)) continue;
        const q = s.men[k];
        const d = dist2([m.x, m.y], [q.x, q.y]);
        const tRun = Math.max(0, q.y - lineOf(s, k)) / VR;
        const tMe = Math.max(0, d - REACH) / VP;
        const sc = level >= 1 ? tMe - tRun : d;
        if (sc < bt) (bt = sc), (best = k);
      }
      if (best >= 0 && (level === 0 ? bt < 6 : bt < 0.6)) {
        const q = s.men[best];
        g = [q.x + q.vx * lv.lead, q.y + q.vy * lv.lead];
        if (dist2([m.x, m.y], [q.x, q.y]) < REACH * 0.95) out.a = ++mem.a;
      } else g = pekarSpot(c);
    }
    Object.assign(out, toward(m.x, m.y, g[0], g[1], 0.3));
    return out;
  }

  // ---------------- бросающий
  const st = s.sticks[i];
  const [hx, hy] = waitSpot(c, i, m.rank);
  const line = lineOf(s, i);
  const pk = s.pekar >= 0 ? s.men[s.pekar] : null;
  if (whoThrows(s) === i) {
    mem.tWait ??= s.t + lv.wait * s.speed * (0.7 + rng.next() * 0.6);
    // бросает с места, где стоит за чертой (только шаг назад, если вылез за неё)
    if (m.y > line - 0.1) Object.assign(out, toward(m.x, m.y, m.x, line - 0.3, 0.2));
    if (s.t >= mem.tWait) {
      mem.thIn = { n: ++mem.th, ...bestThrow(s, i, lv, rng) };
      out.th = mem.thIn;
      mem.tWait = undefined;
    }
    return out;
  }
  mem.tWait = undefined;

  const danger = (x: number, y: number) => (pk ? dist2([pk.x, pk.y], [x, y]) : 99);
  if (st.at === 'ground') {
    const dMe = dist2([m.x, m.y], [st.x, st.y]);
    const back = Math.max(0, st.y - line) + 0.5;
    // успею туда и обратно, пока пекарь возится с банкой или пока он далеко?
    const busy = s.can.mode !== 'up';
    const fix = busy && pk ? dist2([pk.x, pk.y], [s.can.x, s.can.y]) / VP + dist2([s.can.x, s.can.y], canHome(c)) / VP + 0.3 : 0;
    const pkT = pk ? fix + Math.max(0, danger(st.x, st.y) - REACH) / VP : 99;
    const myT = (dMe + back) / VR;
    // бросать некому (все палки в поле) — идут все разом: пекарь осалит кого-то одного
    const stall = s.can.mode === 'up' && s.fly < 0 && whoThrows(s) < 0;
    if (stall) mem.stall ??= s.t + (0.6 + rng.next() * 0.8) * s.speed;
    else mem.stall = undefined;
    if (stall && s.t >= mem.stall) mem.commit = true;
    if (mem.commit) {
      // идут все разом: напролом, своим краем поля, от пекаря — рывком
      const side = i % 2 ? 1 : -1;
      const lane = m.y < st.y - 2 ? [st.x + side * 3, (m.y + st.y) / 2 + 2] : [st.x, st.y];
      Object.assign(out, toward(m.x, m.y, lane[0], lane[1], 0.1));
      if (danger(m.x, m.y) < 2) out.d = ++mem.d;
      return out;
    }
    if (mem.going || st.y <= line || myT + lv.safe < pkT) {
      mem.going = true;
      Object.assign(out, toward(m.x, m.y, st.x, st.y, 0.1));
      // пекарь рядом, а банка стоит — назад, за черту
      if (!busy && danger(m.x, m.y) < 2.2 && m.y > line) {
        mem.going = false;
        Object.assign(out, toward(m.x, m.y, m.x, line - 0.6, 0.2));
        if (danger(m.x, m.y) < 1.6) out.d = ++mem.d;
      }
      return out;
    }
    Object.assign(out, toward(m.x, m.y, hx, hy, 0.4));
    return out;
  }
  mem.going = false;
  mem.commit = false;
  // с палкой в поле — домой, от пекаря вбок и рывком
  if (m.y > line) {
    const tx = pk && danger(m.x, m.y) < 4 ? m.x + Math.sign(m.x - pk.x || 1) * 1.5 : hx;
    Object.assign(out, toward(m.x, m.y, tx, line - 0.6, 0.2));
    if (pk && s.can.mode === 'up' && danger(m.x, m.y) < 1.8) out.d = ++mem.d;
    return out;
  }
  Object.assign(out, toward(m.x, m.y, hx, hy, 0.5));
  return out;
}

/** Куда встать, чтобы поймать палку, летящую мимо банки: первая точка её пути за банкой (невысоко), куда пекарь успеет. */
function catchPoint(s: State, m: { x: number; y: number }): [number, number] | null {
  const st = s.sticks[s.fly];
  if (!st?.b0 || !st.aim || s.can.mode !== 'up') return null;
  const c = s.cfg;
  const f = stickFlight(st.b0, st.style!, canHome(c));
  if (f.hit) return null;
  const t0 = s.t - st.t0!;
  for (const [t, x, y, z] of f.frames) {
    if (t < t0 || z > CATCH_Z || y < c.dist - 0.1) continue;
    const need = Math.max(0, Math.hypot(x - m.x, y - m.y) - CATCH_R * 0.8) / VP;
    if (need <= t - t0) return [x, y];
  }
  return null;
}
