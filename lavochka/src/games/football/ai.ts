/* Бот настольного футбола: тот же ввод, что у человека. Мяч у его фигурки — смотрит, куда полетит
 * (по линии «подставка → мяч»): к чужим воротам — оттягивает и отпускает; к своим — ждёт, вдруг соперник
 * пнёт первым, а у своих ворот выбивает что угодно, лишь бы не в свои. Вратарь встаёт на линию удара. */
import type { Rng } from '../../core/types';
import { canReach, idleInput, keeperX, KEEPER_RANGE, LX, oppGoal, PULL_MAX, SPOTS, step, type FbIn, type FbState, type Team } from './engine';

interface Level {
  /** Реакция, с; с какой «выгоды» бьёт (косинус к чужим воротам); сколько готов ждать; сколько держит (сила); вратарь. */
  react: number;
  thr: number;
  patience: number;
  pull: number;
  keeper: number;
  /** Как часто вратарь пересматривает, куда встать, с. */
  look: number;
}

export const LEVELS: Level[] = [
  { react: 0.5, thr: -0.5, patience: 0.6, pull: 0.3, keeper: 0.4, look: 0.35 },
  { react: 0.3, thr: -0.05, patience: 1.0, pull: 0.42, keeper: 0.55, look: 0.25 },
  { react: 0.16, thr: 0.25, patience: 1.4, pull: 0.5, keeper: 0.7, look: 0.18 },
];

interface Mem {
  t?: number;
  /** Фигурка, у которой мяч, и с какого времени; бьём: до какого момента держим. */
  k?: number;
  since?: number;
  hold?: number;
  rest?: number;
  /** Куда оттягивать (вскользь), если не прямо от мяча. */
  px?: number;
  pz?: number;
  /** Куда встаёт вратарь и когда пересмотрит. */
  kz?: number;
  kNext?: number;
}

/** Прикинуть удар: копия поля, держим фигурку k с оттяжкой (px, pz), отпускаем — куда покатится мяч. Больше — лучше. */
function tryKick(st: FbState, team: Team, k: number, px: number, pz: number, hold: number): number {
  const s: FbState = JSON.parse(JSON.stringify(st));
  s.limit = 0;
  s.goals = 999;
  const rng = { next: () => 0.5, int: () => 0, getState: () => 0 };
  const dir = team === 0 ? 1 : -1;
  const me: FbIn = { f: k, h: 1, px, pz, g: 0, knock: 0 };
  const idle = idleInput();
  const n = Math.ceil((hold * 60) / (s.speed || 1));
  for (let t = 0; t < n + 100; t++) {
    const inp = t < n ? me : { ...me, h: 0 };
    const ev = step(s, team === 0 ? [inp, idle] : [idle, inp], rng);
    for (const e of ev) if (e.k === 'goal') return e.team === team ? 100 : -100;
    if (t > n + 10 && Math.hypot(s.ball.vx, s.ball.vz) < 0.03) break;
  }
  return dir * s.ball.x * 6 - Math.abs(s.ball.z) * 2;
}

export function botInput(st: FbState, seat: number, level: number, m: Record<string, any>, rng: Rng): FbIn {
  const mem = m as Mem;
  const lv = LEVELS[Math.max(0, Math.min(2, level))];
  const team = (seat === 0 ? 0 : 1) as Team;
  const dt = (st.speed || 1) / 60;
  mem.t = (mem.t ?? 0) + dt;
  const b = st.ball;
  const out: FbIn = { f: -1, h: 0, g: 0, knock: 0 };

  // вратарь: на линию мяча (летит к нам — куда прилетит), слабый смотрит больше на сам мяч
  const kx = keeperX(team);
  let pred = b.z * 0.6;
  if ((b.x - kx) * (team === 0 ? 1 : -1) > 0 && b.vx * (team === 0 ? -1 : 1) > 0.05) pred = b.z + (b.vz * (kx - b.x)) / b.vx;
  if (mem.kNext == null || mem.t >= mem.kNext) {
    mem.kNext = mem.t + lv.look * (0.7 + rng.next() * 0.6);
    mem.kz = Math.max(-KEEPER_RANGE, Math.min(KEEPER_RANGE, b.z + (pred - b.z) * lv.keeper + (rng.next() - 0.5) * 0.02));
  }
  out.g = Math.max(-1, Math.min(1, (mem.kz! - st.keep[team]) * 40)) * (0.5 + 0.5 * lv.keeper);
  if (st.goalT > 0 || st.faceoff > 0) {
    mem.k = undefined;
    mem.hold = undefined;
    return out;
  }

  // удар в процессе: держим, потом отпускаем (ещё чуть подождём, пока пружина отыграет)
  if (mem.hold != null && mem.k != null) {
    if (mem.t < mem.hold) {
      out.f = mem.k;
      out.h = 1;
      if (mem.px != null) {
        out.px = mem.px;
        out.pz = mem.pz;
      }
      return out;
    }
    mem.hold = undefined;
    mem.rest = mem.t + 0.35;
    out.f = mem.k;
    return out;
  }
  if (mem.rest != null && mem.t < mem.rest) return out;

  // у какой своей фигурки мяч
  let best = -1;
  let bd = Infinity;
  for (let k = 0; k < 10; k++) {
    if (!canReach(st, team * 10 + k)) continue;
    const [x, z] = SPOTS[team][k];
    const d = Math.hypot(b.x - x, b.z - z);
    if (d < bd) {
      bd = d;
      best = k;
    }
  }
  if (best < 0 || Math.hypot(b.vx, b.vz) > 0.4) {
    mem.k = undefined;
    return out;
  }
  if (mem.k !== best) {
    mem.k = best;
    mem.since = mem.t + lv.react * (0.7 + rng.next() * 0.6);
  }
  if (mem.t < mem.since!) return out;
  const [sx, sz] = SPOTS[team][best];
  const nx = (b.x - sx) / (bd || 1);
  const nz = (b.z - sz) / (bd || 1);
  const [gx, gz] = oppGoal(team);
  const tl = Math.hypot(gx - b.x, gz - b.z) || 1;
  const value = (nx * (gx - b.x) + nz * (gz - b.z)) / tl;
  // у своих ворот — выбить, лишь бы не к себе
  const own = team === 0 ? -LX : LX;
  const danger = Math.abs(b.x - own) < 0.12 && nx * (team === 0 ? 1 : -1) > -0.2;
  const waited = mem.t - mem.since!;
  mem.px = mem.pz = undefined;
  if (level >= 1) {
    // средний и сильный прикидывают несколько замахов и бьют лучшим; ничего хорошего — ждут, потом бьют лучшим из плохого
    const hold = lv.pull;
    const here = (team === 0 ? 1 : -1) * b.x * 6 - Math.abs(b.z) * 2;
    let bestV = -Infinity;
    let bpx = 0;
    let bpz = 0;
    const tries = level === 2 ? [-1.1, -0.75, -0.45, -0.2, 0, 0.2, 0.45, 0.75, 1.1] : [-0.8, -0.3, 0, 0.3, 0.8];
    for (const a of tries) {
      const c = Math.cos(a);
      const s = Math.sin(a);
      const px = -(nx * c - nz * s) * PULL_MAX;
      const pz = -(nx * s + nz * c) * PULL_MAX;
      const v = tryKick(st, team, best, px, pz, hold) + (rng.next() - 0.5) * (level === 2 ? 0.2 : 0.8);
      if (v > bestV) {
        bestV = v;
        bpx = px;
        bpz = pz;
      }
    }
    if (bestV > here + 0.15 || danger || waited > lv.patience) {
      mem.px = bpx;
      mem.pz = bpz;
      mem.hold = mem.t + hold;
      out.f = best;
      out.h = 1;
      out.px = bpx;
      out.pz = bpz;
    } else mem.since = mem.t + 0.3;
    return out;
  }
  let go = value > lv.thr || danger || (waited > lv.patience && value > -0.35);
  if (!go && waited > lv.patience * 1.6) {
    // мяч «не той стороной» — бьём вскользь: махнуть под углом, мяч уйдёт вбок
    const turn = (a: number): number => {
      const c = Math.cos(a);
      const s = Math.sin(a);
      const dx = nx * c - nz * s;
      const dz = nx * s + nz * c;
      return (dx * (gx - b.x) + dz * (gz - b.z)) / tl;
    };
    const a = turn(1) > turn(-1) ? 1 : -1;
    const c = Math.cos(a * 1.05);
    const s = Math.sin(a * 1.05);
    mem.px = -(nx * c - nz * s) * PULL_MAX;
    mem.pz = -(nx * s + nz * c) * PULL_MAX;
    go = true;
  }
  if (go) {
    mem.hold = mem.t + lv.pull * (0.8 + rng.next() * 0.4);
    out.f = best;
    out.h = 1;
  }
  return out;
}
