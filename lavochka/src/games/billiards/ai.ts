/* Бильярд — боты. Варианты удара: биток → «шар-призрак» у прицельного → луза; линии должны быть свободны, срез — не больше 75°.
 * Сила — по расстояниям и сопротивлению сукна (с запасом). Лёгкий целится с заметной ошибкой и берёт один из первых вариантов;
 * средний — точнее и примеряет три лучших физикой (итог оценивается по правилам партии); сложный — ещё точнее, примеряет шесть
 * с накатом и оттяжкой и думает о выходе битка на следующий удар. С руки ставит биток на продолжение линии «шар — луза».
 * Нет вариантов — тихий удар в ближайший разрешённый шар. */
import type { Rng } from '../../core/types';
import { apply, cueBalls, geoOf, legalTargets, ownBalls, placeOk, snookerMarks, tableOf, type Action, type State } from './engine';
import { speedFor, speedToPower, type Ball } from './physics';

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

export function candidates(s: State): Cand[] {
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
        // точка прицела — середина створа, чуть вглубь
        const px = p.x + p.ax * r * 0.6;
        const py = p.y + p.ay * r * 0.6;
        const dpx = px - tb.x;
        const dpy = py - tb.y;
        const d2 = Math.hypot(dpx, dpy);
        if (d2 < 1e-6) return;
        // в лузу под острым углом к створу не заходит
        const into = (dpx * p.ax + dpy * p.ay) / d2;
        if (into < (k === 1 || k === 4 ? 0.55 : 0.35)) return;
        const gx = tb.x - (dpx / d2) * 2 * r;
        const gy = tb.y - (dpy / d2) * 2 * r;
        const d1 = Math.hypot(gx - c.x, gy - c.y);
        if (d1 < r) return;
        const cos = ((gx - c.x) * dpx + (gy - c.y) * dpy) / (d1 * d2);
        if (cos < Math.cos((75 * Math.PI) / 180)) return;
        if (!clear(s.balls, c.x, c.y, gx, gy, r, [cueId, tid])) return;
        if (!clear(s.balls, tb.x, tb.y, px, py, r, [cueId, tid])) return;
        // скорость: прицельный должен дойти до лузы живым, биток — до прицельного
        const vObj = speedFor(t, d2, 0.35 + d2 * 0.12);
        const vCue = speedFor(t, d1, vObj / Math.max(0.25, cos * 0.975));
        const power = Math.max(0.12, Math.min(1, speedToPower(vCue)));
        // тонкий створ: чем точнее надо попасть, тем хуже
        const tight = (p.throat - 2 * r) / r + 0.4;
        out.push({ cue: cueId, target: tid, pocket: k, angle: Math.atan2(gy - c.y, gx - c.x), power, score: (cos * cos * into * Math.min(1, tight)) / (0.3 + d1 * 0.6 + d2 * 1.4) });
      });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

function gauss(rng: Rng) {
  return (rng.next() + rng.next() + rng.next() - 1.5) * 1.15;
}

const other = (s: State, seat: number) => (s.seats.length === 1 ? seat : s.seats[(s.seats.indexOf(seat) + 1) % s.seats.length]);

/** Как хорош итог удара для бьющего. */
function evaluate(s0: State, s1: State, seat: number, position: boolean): number {
  if (s1.phase === 'over') return s1.winners?.includes(seat) ? 1000 : -1000;
  const opp = other(s0, seat);
  let v = 0;
  if (s1.turn === seat) v += 30;
  if (opp !== seat) v += (s1.score[seat] - s0.score[seat]) * 4 - (s1.score[opp] - s0.score[opp]) * 4;
  else v += (s1.score[seat] - s0.score[seat]) * 4;
  if (s0.cfg.variant === 'pool8') {
    const mine = (st: State) => (st.groups[seat] ? ownBalls(st, seat).length : 7);
    v += (mine(s0) - mine(s1)) * 8;
    if (opp !== seat) v -= (ownBalls(s0, opp).length - ownBalls(s1, opp).length) * 3;
  }
  if (s1.turn !== seat && s1.phase === 'place') v -= 20;
  if (position && s1.turn === seat && s1.phase === 'shot') {
    const next = candidates(s1);
    if (next.length) v += 10 + Math.min(10, next[0].score * 25) + Math.min(3, next.length);
  }
  return v;
}

export function choose(s: State, seat: number, level: number, rng: Rng): Action | null {
  if (s.phase === 'over' || s.turn !== seat) return null;
  if (s.phase === 'place') return place(s, level, rng);
  if (s.breakShot) return breakShot(s, rng);
  const noise = [0.012, 0.004, 0.0016][level] ?? 0.004;
  const cands = candidates(s);
  if (!cands.length) return safety(s, rng);
  let pick = level === 0 ? cands[Math.min(cands.length - 1, rng.int(Math.min(3, cands.length)))] : cands[0];
  let spinY = 0;
  let powerK = 1;
  if (level > 0) {
    const tries: [Cand, number, number][] = [];
    const top = cands.slice(0, level === 1 ? 3 : 6);
    for (const c of top) {
      tries.push([c, 0, 1]);
      if (level === 2) {
        tries.push([c, 0.5, 1.1]);
        tries.push([c, -0.6, 1.25]);
      }
    }
    let best = -Infinity;
    for (const [c, sy, pk] of tries) {
      const a = shotAction(s, c, sy, Math.min(1, c.power * pk));
      const res = apply(s, seat, a, false);
      if (!res) continue;
      const v = evaluate(s, res.state, seat, level === 2) + c.score * 5;
      if (v > best) {
        best = v;
        pick = c;
        spinY = sy;
        powerK = pk;
      }
    }
    // ничего не выходит — безопасный удар лучше
    if (best < 0 && level === 2) {
      const sa = safety(s, rng);
      const res = apply(s, seat, sa, false);
      if (res && evaluate(s, res.state, seat, false) > best) return sa;
    }
  }
  const a = shotAction(s, pick, spinY, Math.min(1, pick.power * powerK * (1 + gauss(rng) * 0.04)));
  return { ...a, angle: a.angle + gauss(rng) * noise };
}

function shotAction(s: State, c: Cand, spinY: number, power: number): Action & { type: 'shot' } {
  const call = s.cfg.variant === 'classic' || (s.cfg.variant === 'pool8' && c.target === 8) ? { ball: c.target, pocket: c.pocket } : undefined;
  return { type: 'shot', cue: c.cue, angle: c.angle, power, spinX: 0, spinY, call };
}

function breakShot(s: State, rng: Rng): Action {
  const t = tableOf(s.cfg);
  const c = s.balls.find((b) => b.id === 0)!;
  if (s.cfg.variant === 'snooker') {
    // снукер: тонко в крайний красный, чтобы биток вернулся к «дому»
    const reds = s.balls.filter((b) => b.on && b.id >= 1 && b.id <= 15);
    const corner = reds.reduce((a, b) => (b.x > a.x - 1e-6 && b.y > a.y ? b : a), reds[0]);
    const back = reds.filter((b) => Math.abs(b.x - Math.max(...reds.map((r) => r.x))) < t.r).sort((a, b) => b.y - a.y)[0] ?? corner;
    const ang = Math.atan2(back.y + t.r * 1.85 - c.y, back.x - c.x) + gauss(rng) * 0.002;
    return { type: 'shot', cue: 0, angle: ang, power: 0.42, spinX: 0, spinY: 0 };
  }
  const ang = Math.atan2(t.h / 2 - c.y, t.w * 0.75 - c.x) + gauss(rng) * 0.003;
  const firstBall = nearestTo(s, t.w * 0.75, t.h / 2);
  return { type: 'shot', cue: 0, angle: ang, power: s.cfg.variant === 'classic' ? 0.55 : 0.97, spinX: 0, spinY: 0, call: s.cfg.variant === 'classic' ? { ball: firstBall, pocket: 2 } : undefined };
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

/** Нет хорошего удара — тихо в ближайший разрешённый шар (с прямой видимостью, если есть). */
function safety(s: State, rng: Rng): Action & { type: 'shot' } {
  const t = tableOf(s.cfg);
  const cueId = cueBalls(s)[0];
  const c = s.balls.find((b) => b.id === cueId && b.on)!;
  const legal = legalTargets(s, s.turn).filter((id) => id !== cueId);
  let best: Ball | null = null;
  let bd = Infinity;
  for (const pass of [true, false]) {
    for (const id of legal) {
      const b = s.balls.find((x) => x.id === id && x.on);
      if (!b) continue;
      if (pass && !clear(s.balls, c.x, c.y, b.x, b.y, t.r, [cueId, id])) continue;
      const d = Math.hypot(b.x - c.x, b.y - c.y);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    if (best) break;
  }
  const tb = best ?? s.balls.find((b) => b.on && b.id !== cueId)!;
  const ang = Math.atan2(tb.y - c.y, tb.x - c.x) + (rng.next() - 0.5) * 0.01;
  const call = s.cfg.variant === 'classic' || (s.cfg.variant === 'pool8' && tb.id === 8) ? { ball: tb.id, pocket: nearestPocket(s, tb.x, tb.y) } : undefined;
  // дойти до шара и докатить его до борта
  const power = speedToPower(speedFor(t, bd + 0.4, 0.6) * 1.2);
  return { type: 'shot', cue: cueId, angle: ang, power: Math.min(0.7, power), spinX: 0, spinY: 0, call };
}

function nearestPocket(s: State, x: number, y: number): number {
  const geo = geoOf(s.cfg);
  let best = 0;
  geo.pockets.forEach((p, k) => {
    if ((p.x - x) ** 2 + (p.y - y) ** 2 < (geo.pockets[best].x - x) ** 2 + (geo.pockets[best].y - y) ** 2) best = k;
  });
  return best;
}

/** С руки: на продолжение линии «шар — луза» для лучшего шара, иначе — середина разрешённой зоны. */
function place(s: State, level: number, rng: Rng): Action {
  const t = tableOf(s.cfg);
  const geo = geoOf(s.cfg);
  const tries: [number, number][] = [];
  if (level > 0 && !s.breakShot) {
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
  const zone = (): [number, number] => {
    if (s.zone === 'D') {
      const { baulk, dRad } = snookerMarks(t);
      const a = Math.PI / 2 + rng.next() * Math.PI;
      const rr = dRad * Math.sqrt(rng.next()) * 0.95;
      return [baulk + Math.cos(a) * rr, t.h / 2 + Math.sin(a) * rr];
    }
    return [s.zone === 'kitchen' ? t.w * (0.08 + rng.next() * 0.14) : t.w * (0.1 + rng.next() * 0.8), t.h * (0.2 + rng.next() * 0.6)];
  };
  if (s.breakShot) tries.push(s.zone === 'D' ? [snookerMarks(t).baulk - t.r * 0.5, t.h / 2 + snookerMarks(t).dRad * 0.55] : [t.w * 0.2, t.h / 2]);
  for (let i = 0; i < 40; i++) tries.push(zone());
  for (const [x, y] of tries) if (placeOk(s, x, y)) return { type: 'place', x, y };
  // сеткой по столу
  for (let gx = t.r * 1.5; gx < t.w - t.r; gx += t.r * 2.2) for (let gy = t.r * 1.5; gy < t.h - t.r; gy += t.r * 2.2) if (placeOk(s, gx, gy)) return { type: 'place', x: gx, y: gy };
  return { type: 'place', x: t.w * 0.2, y: t.h / 2 };
}
