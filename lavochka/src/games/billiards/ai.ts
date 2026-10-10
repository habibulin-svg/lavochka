/* Бильярд — боты. Варианты удара: биток → «шар-призрак» у прицельного → луза; линии должны быть свободны, срез — не больше 75°.
 * Сила — по расстояниям. Лёгкий целится с заметной ошибкой и берёт первый попавшийся хороший вариант;
 * средний — точнее и проверяет физикой два лучших; сложный — ещё точнее, проверяет шесть и смотрит, не упадёт ли биток.
 * С руки ставит биток на продолжение линии «шар — луза». Нет вариантов — тихий удар в ближайший разрешённый шар. */
import type { Rng } from '../../core/types';
import { cueBalls, geoOf, legalTargets, placeOk, tableOf, type Action, type State } from './engine';
import { MAX_SPEED, simulate, type Ball } from './physics';

interface Cand {
  cue: number;
  target: number;
  pocket: number;
  angle: number;
  power: number;
  score: number;
}

/** Свободен ли путь шара радиуса r от A до B (не задевая шары, кроме исключённых). */
function clear(balls: Ball[], ax: number, ay: number, bx: number, by: number, r: number, skip: number[]): boolean {
  const ex = bx - ax;
  const ey = by - ay;
  const len2 = ex * ex + ey * ey || 1e-9;
  for (const b of balls) {
    if (!b.on || skip.includes(b.id)) continue;
    let u = ((b.x - ax) * ex + (b.y - ay) * ey) / len2;
    u = Math.max(0, Math.min(1, u));
    const dx = b.x - (ax + ex * u);
    const dy = b.y - (ay + ey * u);
    if (dx * dx + dy * dy < (2 * r) ** 2 * 0.98) return false;
  }
  return true;
}

function candidates(s: State): Cand[] {
  const geo = geoOf(s.cfg);
  const t = tableOf(s.cfg);
  const r = t.r;
  const out: Cand[] = [];
  const targets = legalTargets(s, s.turn);
  for (const cueId of cueBalls(s)) {
    const c = s.balls.find((b) => b.id === cueId && b.on);
    if (!c) continue;
    for (const tid of targets) {
      if (tid === cueId) continue;
      const tb = s.balls.find((b) => b.id === tid && b.on);
      if (!tb) continue;
      geo.pockets.forEach((p, k) => {
        // точка прицела в лузе — чуть внутрь стола от центра захвата
        const px = Math.min(t.w - r, Math.max(r, p.x));
        const py = Math.min(t.h - r, Math.max(r, p.y));
        const dpx = px - tb.x;
        const dpy = py - tb.y;
        const d2 = Math.hypot(dpx, dpy);
        if (d2 < 1e-6) return;
        const gx = tb.x - (dpx / d2) * 2 * r;
        const gy = tb.y - (dpy / d2) * 2 * r;
        const d1 = Math.hypot(gx - c.x, gy - c.y);
        if (d1 < r) return;
        const cut = Math.acos(Math.max(-1, Math.min(1, ((gx - c.x) * dpx + (gy - c.y) * dpy) / (d1 * d2))));
        if (cut > (75 * Math.PI) / 180) return;
        if (!clear(s.balls, c.x, c.y, gx, gy, r, [cueId, tid])) return;
        if (!clear(s.balls, tb.x, tb.y, px, py, r, [cueId, tid])) return;
        // в среднюю лузу под острым углом не заходит
        if ((k === 1 || k === 4) && Math.abs(dpy) / d2 < 0.45) return;
        const cos = Math.cos(cut);
        const need = Math.sqrt(2 * t.roll * d1 + (2 * t.roll * d2 * 1.6 + 0.35) / Math.max(0.2, cos * cos));
        const power = Math.max(0.08, Math.min(1, (need - 0.3) / (MAX_SPEED - 0.3)));
        out.push({ cue: cueId, target: tid, pocket: k, angle: Math.atan2(gy - c.y, gx - c.x), power, score: (cos * cos) / (0.3 + d1 + d2 * 1.4) });
      });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

function gauss(rng: Rng) {
  return (rng.next() + rng.next() + rng.next() - 1.5) * 1.15;
}

export function choose(s: State, seat: number, level: number, rng: Rng): Action | null {
  if (s.phase === 'over' || s.turn !== seat) return null;
  const t = tableOf(s.cfg);
  if (s.phase === 'place') return place(s, level, rng);
  // разбой — сильно в пирамиду
  if (s.breakShot) {
    const c = s.balls.find((b) => b.id === 0)!;
    const ang = Math.atan2(t.h / 2 - c.y, t.w * 0.75 - c.x) + gauss(rng) * 0.004;
    const firstBall = nearestTo(s, t.w * 0.75, t.h / 2);
    return { type: 'shot', cue: 0, angle: ang, power: s.cfg.variant === 'classic' ? 0.55 : 0.95, call: s.cfg.variant === 'classic' ? { ball: firstBall, pocket: 2 } : undefined };
  }
  const noise = [0.02, 0.007, 0.0025][level] ?? 0.007;
  let cands = candidates(s);
  if (!cands.length) return safety(s, rng);
  // проверка физикой: не падает ли биток, падает ли прицельный
  const check = [0, 2, 6][level] ?? 2;
  if (check) {
    const geo = geoOf(s.cfg);
    const scored = cands.slice(0, check).map((c) => {
      const res = simulate(geo, s.balls, { cue: c.cue, angle: c.angle, power: c.power, spinX: 0, spinY: 0 }, false);
      const ids = res.pocketed.map((p) => p.id);
      let v = c.score;
      if (ids.includes(c.target)) v += 10;
      if (s.cfg.variant !== 'american' && ids.includes(0)) v -= 20;
      if (s.cfg.variant === 'pool8' && ids.includes(8) && c.target !== 8) v -= 50;
      return { c, v };
    });
    scored.sort((a, b) => b.v - a.v);
    cands = [scored[0].c, ...cands.filter((x) => x !== scored[0].c)];
  }
  const pick = level === 0 && cands.length > 1 && rng.next() < 0.3 ? cands[1] : cands[0];
  const call = s.cfg.variant === 'classic' || (s.cfg.variant === 'pool8' && pick.target === 8) ? { ball: pick.target, pocket: pick.pocket } : undefined;
  return { type: 'shot', cue: pick.cue, angle: pick.angle + gauss(rng) * noise, power: Math.min(1, pick.power * (1 + gauss(rng) * 0.05)), spinX: 0, spinY: 0, call };
}

function nearestTo(s: State, x: number, y: number): number {
  let best = -1;
  let bd = Infinity;
  for (const b of s.balls) {
    if (!b.on || b.id === 0) continue;
    const d = (b.x - x) ** 2 + (b.y - y) ** 2;
    if (d < bd) {
      bd = d;
      best = b.id;
    }
  }
  return best;
}

/** Нет хорошего удара — тихо в ближайший разрешённый шар. */
function safety(s: State, rng: Rng): Action {
  const cueId = cueBalls(s)[0];
  const c = s.balls.find((b) => b.id === cueId && b.on)!;
  const legal = legalTargets(s, s.turn).filter((id) => id !== cueId);
  let best = legal[0] ?? -1;
  let bd = Infinity;
  for (const id of legal) {
    const b = s.balls.find((x) => x.id === id && x.on);
    if (!b) continue;
    const d = Math.hypot(b.x - c.x, b.y - c.y);
    if (d < bd) {
      bd = d;
      best = id;
    }
  }
  const tb = s.balls.find((b) => b.id === best && b.on) ?? s.balls.find((b) => b.on && b.id !== cueId)!;
  const ang = Math.atan2(tb.y - c.y, tb.x - c.x) + (rng.next() - 0.5) * 0.01;
  const call = s.cfg.variant === 'classic' || (s.cfg.variant === 'pool8' && tb.id === 8) ? { ball: tb.id, pocket: nearestPocket(s, tb.x, tb.y) } : undefined;
  return { type: 'shot', cue: cueId, angle: ang, power: Math.min(0.6, 0.18 + bd / 6), call };
}

function nearestPocket(s: State, x: number, y: number): number {
  const geo = geoOf(s.cfg);
  let best = 0;
  geo.pockets.forEach((p, k) => {
    if ((p.x - x) ** 2 + (p.y - y) ** 2 < (geo.pockets[best].x - x) ** 2 + (geo.pockets[best].y - y) ** 2) best = k;
  });
  return best;
}

/** С руки: на продолжение линии «шар — луза» для лучшего шара, иначе — середина дома. */
function place(s: State, level: number, rng: Rng): Action {
  const t = tableOf(s.cfg);
  const geo = geoOf(s.cfg);
  const tries: [number, number][] = [];
  if (level > 0) {
    for (const id of legalTargets(s, s.turn)) {
      const tb = s.balls.find((b) => b.id === id && b.on);
      if (!tb) continue;
      for (const p of geo.pockets) {
        const dx = tb.x - p.x;
        const dy = tb.y - p.y;
        const d = Math.hypot(dx, dy);
        for (const back of [0.25, 0.4, 0.6]) tries.push([tb.x + (dx / d) * back, tb.y + (dy / d) * back]);
      }
    }
  }
  for (let i = 0; i < 40; i++) tries.push([s.zone === 'kitchen' ? t.w * (0.08 + rng.next() * 0.14) : t.w * (0.1 + rng.next() * 0.8), t.h * (0.2 + rng.next() * 0.6)]);
  for (const [x, y] of tries) if (placeOk(s, x, y)) return { type: 'place', x, y };
  // сеткой по разрешённой зоне
  const maxX = s.zone === 'kitchen' ? t.w / 4 - t.r * 1.5 : t.w - t.r * 1.5;
  for (let gx = t.r * 1.5; gx < maxX; gx += t.r * 2.2) for (let gy = t.r * 1.5; gy < t.h - t.r; gy += t.r * 2.2) if (placeOk(s, gx, gy)) return { type: 'place', x: gx, y: gy };
  return { type: 'place', x: t.w * 0.2, y: t.h / 2 };
}
