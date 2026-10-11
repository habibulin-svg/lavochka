/* Настольный футбол «Kopana» (Caleto) — клон Chad Valley Soccer Stadium: без DOM (его гоняет комната — сервер, хост P2P или браузер).
 * Белый жестяной поднос, зелёное поле в рубчик. Фигурки стоят на пружинах в люверсах: оттянул пальцем, отпустил —
 * фигурка качнулась, и шарик-подставка под ней ударил по мячу. Мяч летит по линии «середина подставки → мяч».
 * У каждой фигурки в поле выемка: медленный мяч скатывается к её ногам. Вратарь — на рычаге: ездит поперёк ворот.
 * Координаты (метры): x — вдоль поля (красные защищают ворота у −x), z — поперёк (+z — к сидящим), всё в плане. */
import { applySpeed, cleanSpeed } from '../../core/realtime';
import type { Rng } from '../../core/types';

/** Внутренние стенки подноса (поле до бортов), скругление углов; разметка (линии ворот и боковые). */
export const TX = 0.305;
export const TZ = 0.182;
export const CORNER = 0.045;
export const LX = 0.27;
export const LZ = 0.162;
/** Ворота: полуширина створа, глубина за линией, штанги. */
export const GOAL_W = 0.046;
export const GOAL_D = 0.03;
const POST = 0.0025;
export const BALL_R = 0.0075;
/** Шарик-подставка фигурки (в плане), насколько её можно оттянуть, вратарь (полуширина и толщина). */
export const FIG_R = 0.0085;
export const PULL_MAX = 0.019;
export const KEEPER_X = LX - 0.024;
export const KEEPER_HALF = 0.006;
export const KEEPER_R = 0.0075;
export const KEEPER_RANGE = GOAL_W - 0.008;
/** Пружина: собственная частота, затухание. */
const W0 = 56;
const ZETA = 0.11;
/** Мяч: трение качения, вязкое, упругость о борт, о подставку, о вратаря; предел скорости. */
const ROLL = 0.42;
const DRAG = 0.5;
const E_WALL = 0.55;
const E_FIG = 0.62;
const E_KEEP = 0.45;
const BALL_MAX = 2.6;
/** Выемки у фигурок: докуда тянут и уклон (больше трения качения — мяч трогается сам). */
const DIP_R = 0.08;
const DIP_K = 0.075;
const G = 9.8;
const SUB = 8;

export const TICK_MS = 1000 / 60;

export type Team = 0 | 1;

/** Где стоят фигурки красных (как на поле «Kopana»: защитники по бокам от ворот, полузащита вразбежку, нападающий напротив створа);
 * у синих — то же, повёрнутое на 180°. */
const RED: [number, number][] = [
  [-0.215, -0.095],
  [-0.215, 0.095],
  [-0.145, -0.14],
  [-0.145, 0.14],
  [-0.12, -0.035],
  [-0.04, 0.09],
  [-0.035, -0.1],
  [0.0, 0.04],
  [0.135, -0.075],
  [0.205, 0.012],
];

/** Фигурки по командам: SPOTS[team][k] — точка люверса (k = 0…9). */
export const SPOTS: [number, number][][] = [RED, RED.map(([x, z]) => [-x, -z] as [number, number])];

export interface Fig {
  /** Отклонение подставки от люверса (м) и его скорость. */
  ox: number;
  oz: number;
  vx: number;
  vz: number;
  /** Держат ли сейчас (оттягивают) и сколько. */
  held: boolean;
  ht: number;
}

export interface Ball {
  x: number;
  z: number;
  vx: number;
  vz: number;
}

export interface FbState {
  /** 20 полевых: figs[team * 10 + k]. */
  figs: Fig[];
  /** Вратари: положение поперёк ворот (z) и скорость. */
  keep: [number, number];
  keepV: [number, number];
  ball: Ball;
  score: [number, number];
  t: number;
  limit: number;
  goals: number;
  /** Пауза после гола и «мяч на центр». */
  goalT: number;
  faceoff: number;
  lastGoal: -1 | 0 | 1;
  /** Чью фигурку подсвечивать каждой команде (ближняя к мячу). */
  auto: [number, number];
  still: number;
  knock: [number, number];
  knockCd: [number, number];
  touch: number;
  speed: number;
  spSeen?: number[];
  over: boolean;
}

/** Ввод места: f — фигурка (0…9, −1 — ближняя к мячу), h — держит ли; px/pz — куда оттянута (мышь; без них — от мяча, тем сильнее, чем дольше держишь);
 * g — вратарь (−1…1), gs — куда поставить вратаря (мышь, −1…1 поперёк ворот); knock — счётчик стука по борту; sp — скорость игры. */
export interface FbIn {
  f: number;
  h: number;
  px?: number;
  pz?: number;
  g: number;
  gs?: number;
  knock: number;
  sp?: number;
  /** Оттяжка клавишами: махнуть вскользь (−1…1 — до ~60° левее/правее линии на мяч). */
  a?: number;
}

export type FbEvent =
  | { k: 'kick'; st: number; team: Team }
  | { k: 'wall'; st: number }
  | { k: 'post'; st: number }
  | { k: 'keeper'; st: number }
  | { k: 'twang'; st: number }
  | { k: 'goal'; team: Team; score: [number, number]; own: boolean }
  | { k: 'drop' }
  | { k: 'knock'; seat: number }
  | { k: 'end' };

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

export const spot = (i: number): [number, number] => SPOTS[i < 10 ? 0 : 1][i % 10];
export const teamOf = (i: number): Team => (i < 10 ? 0 : 1);
/** Где сейчас подставка фигурки. */
export const figPos = (st: FbState, i: number): [number, number] => {
  const [x, z] = spot(i);
  return [x + st.figs[i].ox, z + st.figs[i].oz];
};
export const keeperX = (team: Team) => (team === 0 ? -KEEPER_X : KEEPER_X);
/** Центр чужих ворот. */
export const oppGoal = (team: Team): [number, number] => [team === 0 ? LX : -LX, 0];

// ---------------------------------------------------------------- поле

/** Высота поля и уклон: к ногам ближней фигурки поле чуть понижается (выемка-воронка), ближе к бортам — загибается вверх. */
export function fieldAt(x: number, z: number): [number, number, number] {
  let h = 0;
  let gx = 0;
  let gz = 0;
  let bd = Infinity;
  let bx = 0;
  let bz = 0;
  for (const team of [0, 1] as const)
    for (const [sx, sz] of SPOTS[team]) {
      const d = Math.hypot(x - sx, z - sz);
      if (d < bd) {
        bd = d;
        bx = sx;
        bz = sz;
      }
    }
  if (bd < DIP_R && bd > 1e-6) {
    h = -DIP_K * (DIP_R - bd);
    gx = (DIP_K * (x - bx)) / bd;
    gz = (DIP_K * (z - bz)) / bd;
  }
  // жесть у бортов загибается вверх, к бортику: мяч у борта скатывается обратно в поле
  const band = 0.022;
  const ex = Math.abs(x) - (TX - band);
  if (ex > 0) {
    h += EDGE * ex * ex;
    gx += 2 * EDGE * ex * Math.sign(x);
  }
  const ez = Math.abs(z) - (TZ - band);
  if (ez > 0) {
    h += EDGE * ez * ez;
    gz += 2 * EDGE * ez * Math.sign(z);
  }
  return [h, gx, gz];
}
const EDGE = 9;

// ---------------------------------------------------------------- партия

export function newGame(goals: number, minutes: number, rng: Rng, speed = 1): FbState {
  const st: FbState = {
    figs: Array.from({ length: 20 }, () => ({ ox: 0, oz: 0, vx: 0, vz: 0, held: false, ht: 0 })),
    keep: [0, 0],
    keepV: [0, 0],
    ball: { x: 0, z: 0, vx: 0, vz: 0 },
    score: [0, 0],
    t: 0,
    limit: minutes * 60,
    goals,
    goalT: 0,
    faceoff: 1.2,
    lastGoal: -1,
    auto: [0, 0],
    still: 0,
    knock: [0, 0],
    knockCd: [0, 0],
    touch: -1,
    speed,
    over: false,
  };
  st.auto = [autoPick(st, 0), autoPick(st, 1)];
  void rng;
  return st;
}

export const idleInput = (): FbIn => ({ f: -1, h: 0, g: 0, knock: 0 });

const num = (v: unknown, a: number, b: number, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, a, b) : d);

export function cleanInput(raw: unknown): FbIn | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const out: FbIn = { f: Math.round(num(o.f, -1, 9, -1)), h: o.h ? 1 : 0, g: num(o.g, -1, 1), knock: Math.round(num(o.knock, 0, 1e9)) };
  if (typeof o.px === 'number' && typeof o.pz === 'number' && Number.isFinite(o.px) && Number.isFinite(o.pz)) {
    out.px = clamp(o.px, -0.05, 0.05);
    out.pz = clamp(o.pz, -0.05, 0.05);
  }
  if (typeof o.gs === 'number' && Number.isFinite(o.gs)) out.gs = clamp(o.gs, -1, 1);
  if (typeof o.a === 'number' && Number.isFinite(o.a) && o.a !== 0) out.a = clamp(o.a, -1, 1);
  const sp = cleanSpeed(o.sp);
  if (sp != null) out.sp = sp;
  return out;
}

/** Ближняя к мячу фигурка команды (с запасом, чтобы выбор не дёргался). */
export function autoPick(st: FbState, team: Team): number {
  const cur = st.auto[team];
  let best = cur;
  let bd = Infinity;
  for (let k = 0; k < 10; k++) {
    const [x, z] = SPOTS[team][k];
    const d = Math.hypot(st.ball.x - x, st.ball.z - z) - (k === cur ? 0.01 : 0);
    if (d < bd) {
      bd = d;
      best = k;
    }
  }
  return best;
}

/** Достаёт ли подставка фигурки до мяча (с размахом). */
export function canReach(st: FbState, i: number, extra = 0): boolean {
  const [x, z] = spot(i);
  return Math.hypot(st.ball.x - x, st.ball.z - z) < FIG_R + BALL_R + PULL_MAX * 0.8 + extra;
}

/** Пружина фигурки: держат — подставка идёт к цели; отпустили — качается к люверсу с затуханием. */
function moveFig(st: FbState, i: number, cmd: { h: boolean; px?: number; pz?: number; a?: number }, dt: number) {
  const f = st.figs[i];
  if (cmd.h) {
    f.ht += dt;
    let tx: number;
    let tz: number;
    if (cmd.px != null && cmd.pz != null) {
      tx = cmd.px;
      tz = cmd.pz;
    } else {
      // оттягиваем от мяча — тем дальше, чем дольше держишь (полная сила за полсекунды)
      const [sx, sz] = spot(i);
      const dx = st.ball.x - sx;
      const dz = st.ball.z - sz;
      const d = Math.hypot(dx, dz) || 1;
      const p = PULL_MAX * Math.min(1, f.ht / 0.5);
      const a = (cmd.a ?? 0) * 1.05;
      const c = Math.cos(a);
      const s = Math.sin(a);
      tx = (-(dx * c - dz * s) / d) * p;
      tz = (-(dx * s + dz * c) / d) * p;
    }
    const l = Math.hypot(tx, tz);
    if (l > PULL_MAX) {
      tx *= PULL_MAX / l;
      tz *= PULL_MAX / l;
    }
    // палец ведёт подставку плавно (не быстрее 0,4 м/с)
    let wx = (tx - f.ox) * 30;
    let wz = (tz - f.oz) * 30;
    const wl = Math.hypot(wx, wz);
    if (wl > 0.4) {
      wx *= 0.4 / wl;
      wz *= 0.4 / wl;
    }
    f.vx = wx;
    f.vz = wz;
    f.held = true;
  } else {
    f.held = false;
    f.ht = 0;
    f.vx += (-W0 * W0 * f.ox - 2 * ZETA * W0 * f.vx) * dt;
    f.vz += (-W0 * W0 * f.oz - 2 * ZETA * W0 * f.vz) * dt;
  }
  f.ox += f.vx * dt;
  f.oz += f.vz * dt;
  if (!cmd.h && Math.abs(f.ox) < 1e-5 && Math.abs(f.oz) < 1e-5 && Math.abs(f.vx) < 1e-3 && Math.abs(f.vz) < 1e-3) f.ox = f.oz = f.vx = f.vz = 0;
}

/** Мяч о круг (подставку) с центром c, радиусом r и скоростью (vx, vz); mu — сколько касательной скорости передаётся (удар вскользь). Возвращает силу удара. */
function hitCircle(b: Ball, cx: number, cz: number, r: number, vx: number, vz: number, e: number, mu = 0): number {
  const dx = b.x - cx;
  const dz = b.z - cz;
  const d = Math.hypot(dx, dz);
  const min = r + BALL_R;
  if (d >= min || d < 1e-9) return 0;
  const nx = dx / d;
  const nz = dz / d;
  b.x = cx + nx * min;
  b.z = cz + nz * min;
  const vn = (b.vx - vx) * nx + (b.vz - vz) * nz;
  if (vn >= 0) return 0;
  const tx = b.vx - vx - vn * nx;
  const tz = b.vz - vz - vn * nz;
  b.vx -= (1 + e) * vn * nx + mu * tx;
  b.vz -= (1 + e) * vn * nz + mu * tz;
  return -vn;
}

/** Борта подноса со скруглёнными углами; у ворот проём — туда мяч заходит в «коробку» ворот. */
function walls(b: Ball): number {
  let hit = 0;
  const r = BALL_R;
  const inMouth = Math.abs(b.z) < GOAL_W - POST;
  // ворота: коробка за линией (бока и задник)
  for (const s of [1, -1]) {
    if (s * b.x > LX) {
      if (inMouth || Math.abs(b.z) < GOAL_W) {
        const back = LX + GOAL_D;
        if (s * b.x > back - r) {
          b.x = s * (back - r);
          if (s * b.vx > 0) (hit = Math.max(hit, Math.abs(b.vx))), (b.vx = -b.vx * 0.3);
        }
        for (const zs of [1, -1])
          if (zs * b.z > GOAL_W - r - POST) {
            b.z = zs * (GOAL_W - r - POST);
            if (zs * b.vz > 0) (hit = Math.max(hit, Math.abs(b.vz))), (b.vz = -b.vz * 0.3);
          }
      }
    }
  }
  for (const [cx, cz] of [
    [TX - CORNER, TZ - CORNER],
    [-(TX - CORNER), TZ - CORNER],
    [TX - CORNER, -(TZ - CORNER)],
    [-(TX - CORNER), -(TZ - CORNER)],
  ]) {
    if (Math.sign(b.x) !== Math.sign(cx) || Math.sign(b.z) !== Math.sign(cz)) continue;
    if (Math.abs(b.x) < Math.abs(cx) || Math.abs(b.z) < Math.abs(cz)) continue;
    const dx = b.x - cx;
    const dz = b.z - cz;
    const d = Math.hypot(dx, dz);
    if (d > CORNER - r) {
      const nx = dx / d;
      const nz = dz / d;
      b.x = cx + nx * (CORNER - r);
      b.z = cz + nz * (CORNER - r);
      const vn = b.vx * nx + b.vz * nz;
      if (vn > 0) {
        b.vx -= (1 + E_WALL) * vn * nx;
        b.vz -= (1 + E_WALL) * vn * nz;
        hit = Math.max(hit, vn);
      }
    }
  }
  if (Math.abs(b.x) > TX - r) {
    b.x = Math.sign(b.x) * (TX - r);
    if (b.x * b.vx > 0) (hit = Math.max(hit, Math.abs(b.vx))), (b.vx = -b.vx * E_WALL);
  }
  if (Math.abs(b.z) > TZ - r) {
    b.z = Math.sign(b.z) * (TZ - r);
    if (b.z * b.vz > 0) (hit = Math.max(hit, Math.abs(b.vz))), (b.vz = -b.vz * E_WALL);
  }
  return hit;
}

/** Штанги и боковые сетки ворот снаружи (мяч, прилетевший сбоку, отскакивает). */
function posts(b: Ball): number {
  let hit = 0;
  for (const s of [1, -1])
    for (const zs of [1, -1]) {
      hit = Math.max(hit, hitCircle(b, s * LX, zs * GOAL_W, POST, 0, 0, 0.5));
      // боковая стенка ворот — от штанги назад
      const z = zs * GOAL_W;
      if (s * b.x > LX && s * b.x < LX + GOAL_D && Math.abs(b.z - z) < BALL_R + POST && Math.abs(b.z) > GOAL_W - 0.001) {
        b.z = z + zs * (BALL_R + POST);
        if (zs * b.vz < 0) (hit = Math.max(hit, Math.abs(b.vz))), (b.vz = -b.vz * 0.4);
      }
    }
  return hit;
}

/** Вратарь — капсула поперёк ворот. */
function keeper(st: FbState, team: Team): number {
  const b = st.ball;
  const kx = keeperX(team);
  const kz = st.keep[team];
  const cz = clamp(b.z, kz - KEEPER_HALF, kz + KEEPER_HALF);
  return hitCircle(b, kx, cz, KEEPER_R, 0, st.keepV[team], E_KEEP);
}

function unreachable(st: FbState): boolean {
  for (let i = 0; i < 20; i++) if (canReach(st, i, 0.004)) return false;
  for (const team of [0, 1] as const) if (Math.abs(st.ball.x - keeperX(team)) < 0.03 && Math.abs(st.ball.z) < GOAL_W + 0.02) return false;
  return true;
}

function knock(st: FbState, rng: Rng, power: number) {
  const a = rng.next() * Math.PI * 2;
  st.ball.vx += Math.cos(a) * power;
  st.ball.vz += Math.sin(a) * power;
  st.still = 0;
}

/** Шаг партии: 1/60 с. */
export function step(st: FbState, inputs: (FbIn | null | undefined)[], rng: Rng): FbEvent[] {
  const ev: FbEvent[] = [];
  if (st.over) return ev;
  const dt = TICK_MS / 1000;
  const idle = idleInput();
  const inp: [FbIn, FbIn] = [inputs[0] ?? idle, inputs[1] ?? idle];
  const sp0 = st.speed > 0 ? st.speed : 1;
  const h = (dt * sp0) / SUB;

  for (const team of [0, 1] as const) {
    applySpeed(st, team, inp[team].sp);
    st.auto[team] = autoPick(st, team);
    st.knockCd[team] = Math.max(0, st.knockCd[team] - dt);
    if (inp[team].knock !== st.knock[team]) {
      st.knock[team] = inp[team].knock;
      if (st.knockCd[team] <= 0 && st.goalT <= 0 && st.faceoff <= 0) {
        st.knockCd[team] = 1.5;
        knock(st, rng, 0.3);
        ev.push({ k: 'knock', seat: team });
      }
    }
  }

  if (st.goalT > 0) {
    st.goalT -= dt;
    if (st.goalT <= 0) {
      if (st.score[0] >= st.goals || st.score[1] >= st.goals) return end(st, ev);
      st.ball = { x: 0, z: 0, vx: 0, vz: 0 };
      st.faceoff = 0.9;
      st.touch = -1;
      ev.push({ k: 'drop' });
    }
  } else st.t += dt;
  if (st.limit > 0 && st.t >= st.limit && st.goalT <= 0) {
    st.t = st.limit;
    return end(st, ev);
  }
  const frozen = st.goalT > 0 || st.faceoff > 0;
  if (st.faceoff > 0) {
    st.faceoff -= dt;
    if (st.faceoff <= 0) {
      const a = rng.next() * Math.PI * 2;
      st.ball.vx = Math.cos(a) * 0.05;
      st.ball.vz = Math.sin(a) * 0.05;
    }
  }

  // кто чем правит
  const cmds = st.figs.map(() => ({ h: false }) as { h: boolean; px?: number; pz?: number; a?: number });
  for (const team of [0, 1] as const) {
    const ip = inp[team];
    const k = ip.f >= 0 ? ip.f : st.auto[team];
    if (ip.h) cmds[team * 10 + k] = { h: true, px: ip.px, pz: ip.pz, a: ip.a };
  }

  let kick = 0;
  let kickTeam: Team = 0;
  let wall = 0;
  let post = 0;
  let keep = 0;
  let twang = 0;
  for (let s = 0; s < SUB; s++) {
    for (let i = 0; i < 20; i++) {
      const was = st.figs[i].held;
      moveFig(st, i, cmds[i], h);
      if (was && !st.figs[i].held) twang = Math.max(twang, Math.hypot(st.figs[i].ox, st.figs[i].oz) / PULL_MAX);
    }
    for (const team of [0, 1] as const) {
      const ip = inp[team];
      const target = ip.gs != null ? ip.gs * KEEPER_RANGE : null;
      const vt = target != null ? clamp((target - st.keep[team]) * 25, -0.5, 0.5) : ip.g * 0.2;
      st.keepV[team] += clamp(vt - st.keepV[team], -6 * h, 6 * h);
      st.keep[team] += st.keepV[team] * h;
      if (Math.abs(st.keep[team]) > KEEPER_RANGE) {
        st.keep[team] = Math.sign(st.keep[team]) * KEEPER_RANGE;
        st.keepV[team] = 0;
      }
    }
    if (frozen) continue;
    const b = st.ball;
    // выемки: катится к ногам ближней фигурки (качение — 5/7 g по уклону)
    const [, gx, gz] = fieldAt(b.x, b.z);
    b.vx -= (5 / 7) * G * gx * h;
    b.vz -= (5 / 7) * G * gz * h;
    b.x += b.vx * h;
    b.z += b.vz * h;
    const sp = Math.hypot(b.vx, b.vz);
    if (sp > 0) {
      const ns = Math.max(0, sp - (ROLL + DRAG * sp) * h);
      b.vx *= ns / sp;
      b.vz *= ns / sp;
    }
    // гол: мяч целиком за линией в створе
    if (Math.abs(b.z) < GOAL_W - POST && Math.abs(b.x) > LX + BALL_R * 0.9) {
      const team: Team = b.x < 0 ? 1 : 0;
      st.score[team]++;
      st.lastGoal = team;
      st.goalT = 1.6;
      b.vx = b.vz = 0;
      ev.push({ k: 'goal', team, score: [st.score[0], st.score[1]], own: st.touch >= 0 && teamOf(st.touch) !== team });
      break;
    }
    for (let i = 0; i < 20; i++) {
      const f = st.figs[i];
      const [x, z] = spot(i);
      const k = hitCircle(b, x + f.ox, z + f.oz, FIG_R, f.vx, f.vz, E_FIG, 0.35);
      if (k > 0) {
        st.touch = i;
        if (k > kick) {
          kick = k;
          kickTeam = teamOf(i);
        }
      }
    }
    keep = Math.max(keep, keeper(st, 0), keeper(st, 1));
    wall = Math.max(wall, walls(b));
    post = Math.max(post, posts(b));
    const s2 = Math.hypot(b.vx, b.vz);
    if (s2 > BALL_MAX) {
      b.vx *= BALL_MAX / s2;
      b.vz *= BALL_MAX / s2;
    }
  }
  // сила звука — как если бы шло в жизнь
  kick /= sp0;
  wall /= sp0;
  post /= sp0;
  keep /= sp0;
  if (kick > 0.06) ev.push({ k: 'kick', st: Math.round(kick * 100) / 100, team: kickTeam });
  if (wall > 0.08) ev.push({ k: 'wall', st: Math.round(wall * 100) / 100 });
  if (post > 0.08) ev.push({ k: 'post', st: Math.round(post * 100) / 100 });
  if (keep > 0.08) ev.push({ k: 'keeper', st: Math.round(keep * 100) / 100 });
  if (twang > 0.3) ev.push({ k: 'twang', st: Math.round(twang * 100) / 100 });

  if (!frozen) {
    const sp = Math.hypot(st.ball.vx, st.ball.vz);
    st.still = sp < 0.02 * sp0 ? st.still + dt : 0;
    if ((st.still > 1.5 && unreachable(st)) || st.still > 4.5) {
      knock(st, rng, 0.25);
      ev.push({ k: 'knock', seat: -1 });
    }
  }
  return ev;
}

function end(st: FbState, ev: FbEvent[]): FbEvent[] {
  st.over = true;
  ev.push({ k: 'end' });
  return ev;
}

/** Снимок для сети: числа округлены. */
export function snapshot(st: FbState): FbState {
  const r = (v: number, k: number) => Math.round(v * k) / k;
  return {
    ...st,
    figs: st.figs.map((f) => ({ ox: r(f.ox, 1e5), oz: r(f.oz, 1e5), vx: r(f.vx, 1e3), vz: r(f.vz, 1e3), held: f.held, ht: r(f.ht, 100) })),
    keep: [r(st.keep[0], 1e4), r(st.keep[1], 1e4)],
    keepV: [r(st.keepV[0], 1e3), r(st.keepV[1], 1e3)],
    ball: { x: r(st.ball.x, 1e5), z: r(st.ball.z, 1e5), vx: r(st.ball.vx, 1e3), vz: r(st.ball.vz, 1e3) },
    score: [st.score[0], st.score[1]],
    auto: [st.auto[0], st.auto[1]],
    knock: [st.knock[0], st.knock[1]],
    knockCd: [r(st.knockCd[0], 100), r(st.knockCd[1], 100)],
    t: r(st.t, 100),
    goalT: r(st.goalT, 100),
    faceoff: r(st.faceoff, 100),
    still: r(st.still, 100),
  };
}
