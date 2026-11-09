/* Лапта — ИИ: напарники человека и вся команда бота. Видит то же поле, что игроки (снимок комнаты), и выдаёт «куда
 * бежать» каждому пацану: нападение решает, когда выбежать (полевой с мячом далеко от дорожки — бежим), бежит к своей
 * линии и уворачивается рывком от летящего мяча; защита посылает к мячу ближнего, остальные перекрывают дорожки
 * бегущих, полевой с мячом кидает в бегущего с упреждением или отдаёт пас ближе к нему. Бьёт — перебором ударов по
 * физике: в «дыру» между полевыми и не свечой в руки. Слабее уровень — грубее рука и решения. */
import type { Rng } from '../../core/types';
import { ballPos, chasePoint, defT, lead, mayLeave, type In, type State } from './engine';
import { flight, formation, homeSpot, intercept, judge, lane, strike, catchChance, yKon, type Style } from './field';

export interface Want {
  mx: number;
  my: number;
  dash?: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const toward = (fx: number, fy: number, tx: number, ty: number, slow = 0.6): Want => {
  const dx = tx - fx;
  const dy = ty - fy;
  const d = Math.hypot(dx, dy);
  if (d < 0.25) return { mx: 0, my: 0 };
  const k = d < slow ? d / slow : 1;
  return { mx: (dx / d) * k, my: (dy / d) * k };
};

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const k = l2 > 0 ? clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1) : 0;
  return Math.hypot(px - (ax + dx * k), py - (ay + dy * k));
}

/** Откуда грозит мяч: полевой с мячом или точка, где мяч подберут. */
function threat(s: State): [number, number] {
  const b = s.ball;
  if (b.mode === 'held') {
    const m = s.men[defT(s)][b.holder];
    return [m.x, m.y];
  }
  if (b.mode === 'free' && b.b0) return chasePoint(s);
  return [0, 0];
}

/** Нападение: куда бежать каждому. */
export function aiAttack(s: State, lv: number, rng: Rng): Want[] {
  const c = s.cfg;
  const out: Want[] = [];
  const [tx, ty] = threat(s);
  const [bx, by, bz] = ballPos(s);
  const stuck = s.queue.length === 0;
  s.men[s.atk].forEach((m, i) => {
    if (m.st === 'run') {
      const dest = m.from === 'dom' ? c.L + 1.2 : -1.2;
      const w = toward(m.x, m.y, lane(c, i), dest, 0.01);
      // летит брошенный мяч — увернуться вбок рывком
      if (s.ball.thrown && lv > 0 && bz < 2.2) {
        const d = Math.hypot(bx - m.x, by - m.y);
        if (d < 4.5) {
          const sx = bx > m.x ? -1 : 1;
          return out.push({ mx: sx * 0.9, my: w.my * 0.4, dash: d < 3.2 });
        }
      }
      return out.push(w);
    }
    if (mayLeave(s, i)) {
      if (!s.go.includes(i)) {
        // решаем раз в полсекунды игрового времени
        const tick = Math.floor((s.t - s.since) * 2) !== Math.floor((s.t - s.since - 1 / 60) * 2);
        if (tick || s.t - s.since < 0.05) {
          const from = m.st === 'kon' ? yKon(c) : 0;
          const to = m.st === 'kon' ? 0 : yKon(c);
          const d = segDist(tx, ty, lane(c, i), from, lane(c, i), to);
          const noise = ((rng.int(1001) - 500) / 500) * [4, 2, 1][lv];
          const thr = c.L * 0.24 * (stuck ? 0.6 : 1) + noise;
          if (d > thr) s.go.push(i);
        }
      }
      if (s.go.includes(i)) {
        const dest = m.st === 'kon' ? -1.2 : c.L + 1.2;
        return out.push(toward(m.x, m.y, lane(c, i), dest, 0.01));
      }
    }
    const [hx, hy] = homeSpot(c, i, m.st === 'kon' ? 'kon' : 'dom');
    out.push(toward(m.x, m.y, hx, hy));
  });
  return out;
}

/** Защита: куда бежать каждому полевому. */
export function aiDefense(s: State): Want[] {
  const c = s.cfg;
  const def = s.men[defT(s)];
  const form = formation(c);
  const runners = s.men[s.atk].map((m, i) => ({ m, i })).filter((r) => r.m.st === 'run');
  const out: Want[] = def.map(() => ({ mx: 0, my: 0 }));
  const b = s.ball;
  const [bx, by] = ballPos(s);
  if (b.mode === 'free' && b.b0) {
    // к мячу — тот, кто раньше успеет (пересматриваем раз в 0,3 с)
    const [cx, cy] = chasePoint(s);
    if (s.chase < 0 || s.t - s.chaseT > 0.3) {
      let best = 0;
      let bd = Infinity;
      def.forEach((m, i) => {
        const d = Math.hypot(m.x - cx, m.y - cy);
        if (d < bd) (bd = d), (best = i);
      });
      s.chase = best;
      s.chaseT = s.t;
    }
    def.forEach((m, i) => {
      if (i === s.chase) out[i] = toward(m.x, m.y, cx, cy, 0.3);
      else {
        const [fx, fy] = form[i];
        out[i] = toward(m.x, m.y, fx + (bx - fx) * 0.2, fy + (by - fy) * 0.2);
      }
    });
  } else {
    // мяч у своего: остальные перекрывают дорожки бегущих
    const used = new Set<number>([b.holder]);
    for (const r of runners) {
      const ahead = r.m.from === 'dom' ? 7 : -7;
      const px = r.m.x;
      const py = clamp(r.m.y + ahead, 1, c.L - 1);
      let best = -1;
      let bd = Infinity;
      def.forEach((m, i) => {
        if (used.has(i)) return;
        const d = Math.hypot(m.x - px, m.y - py);
        if (d < bd) (bd = d), (best = i);
      });
      if (best >= 0) {
        used.add(best);
        out[best] = toward(def[best].x, def[best].y, px, py);
      }
    }
    def.forEach((m, i) => {
      if (used.has(i)) return;
      out[i] = toward(m.x, m.y, form[i][0], form[i][1]);
    });
    // с мячом — шаг к ближнему бегущему (бросок короче)
    if (b.mode === 'held' && runners.length) {
      const h = def[b.holder];
      const near = runners.reduce((a, r) => (Math.hypot(r.m.x - h.x, r.m.y - h.y) < Math.hypot(a.m.x - h.x, a.m.y - h.y) ? r : a));
      const w = toward(h.x, h.y, near.m.x, near.m.y);
      out[b.holder] = { mx: w.mx * 0.7, my: w.my * 0.7 };
    }
  }
  return out;
}

/** Полевой с мячом (ИИ): куда кинуть сейчас, null — ещё держит. */
export function aiThrow(s: State, lv: number): { tx: number; ty: number } | null {
  const def = s.men[defT(s)];
  const h = s.ball.holder;
  const m = def[h];
  const react = [0.8, 0.5, 0.3][lv] ?? 0.5;
  if (s.t - s.holdT < react) return null;
  const runners = s.men[s.atk].filter((r) => r.st === 'run');
  if (!runners.length) return null;
  let best: { tx: number; ty: number; sc: number } | null = null;
  for (const r of runners) {
    const [tx, ty] = lead([m.x, m.y], r);
    const sc = 1 - Math.hypot(tx - m.x, ty - m.y) / 22;
    if (!best || sc > best.sc) best = { tx, ty, sc };
  }
  if (lv > 0 && (!best || best.sc < 0.55))
    for (let i = 0; i < def.length; i++) {
      if (i === h) continue;
      for (const r of runners) {
        const dOwn = Math.hypot(r.x - m.x, r.y - m.y);
        const dMate = Math.hypot(r.x - def[i].x, r.y - def[i].y);
        if (dMate < dOwn - 8) return { tx: def[i].x, ty: def[i].y };
      }
    }
  if (best && (best.sc > 0.35 || s.t - s.holdT > 2.5)) return { tx: best.tx, ty: best.ty };
  return null;
}

/** Удар бота: перебор вариантов по физике. */
export function aiHit(s: State, lv: number, rng: Rng): NonNullable<In['hit']> {
  const c = s.cfg;
  const tries = [8, 24, 50][lv] ?? 24;
  const fpos = s.men[defT(s)].map((m) => [m.x, m.y] as [number, number]);
  let best = { pow: 0.7, yaw: 0, style: 'far' as Style, sc: -Infinity };
  const styles: Style[] = ['far', 'low', 'candle'];
  for (let k = 0; k < tries; k++) {
    const style = styles[k % 3 === 2 && rng.next() < 0.35 ? 2 : k % 2];
    const pow = 0.45 + rng.next() * 0.47;
    const yaw = (rng.next() - 0.5) * 0.9;
    const b0 = strike(c, pow, yaw, style);
    const fl = flight(b0);
    if (judge(c, fl.land) !== 'ok') continue;
    let t = Infinity;
    let air = 0;
    for (const f of fpos) {
      const ic = intercept(b0, f);
      t = Math.min(t, ic.t);
      if (ic.air) air = Math.max(air, catchChance(ic.margin));
    }
    const sc = t - air * (c.candle === 'swap' ? 8 : 3) + (fl.land!.y / c.L) * 0.6;
    if (sc > best.sc) best = { pow, yaw, style, sc };
  }
  const sh = [0.1, 0.06, 0.03][lv] ?? 0.06;
  const g = () => (rng.next() + rng.next() + rng.next() - 1.5) * 1.4;
  return { n: 0, style: best.style, pow: clamp(best.pow + g() * sh, 0.2, 0.95), yaw: clamp(best.yaw + g() * sh * 1.5, -0.7, 0.7) };
}

/** Бот за столом: всю команду ведёт ИИ его уровня. */
export function botInput(_v: State, _seat: number, level: number): In {
  return { mx: 0, my: 0, k: -1, ai: clamp(level, 0, 2) };
}
