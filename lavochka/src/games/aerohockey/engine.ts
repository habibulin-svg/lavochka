/* Аэрохоккей: стол на воздушной подушке, шайба почти без трения, у каждого — бита. Без DOM (комната крутит шаги физики).
 * Стол в плане: x — поперёк (−W/2…W/2), y — вдоль (0 — ворота места 0, L — ворота места 1). Своя бита не заходит за центральную линию.
 * Единицы — метры, секунды. Состояние меняется на месте (шаг комнаты — 60 раз в секунду). */
import { applySpeed, cleanSpeed } from '../../core/realtime';
import type { Rng } from '../../core/types';

export const W = 1.0;
export const L = 2.0;
/** Скругление углов стола, створ ворот, радиусы шайбы и биты. */
export const CORNER = 0.14;
export const GOAL = 0.3;
export const PUCK_R = 0.04;
export const MAL_R = 0.055;

/** Бита: предельная скорость и разгон «рукой». */
const MAL_V = 7;
const MAL_ACC = 120;
/** Шайба: вязкое и постоянное торможение (воздух держит — тормозит слабо), упругость бортов и биты, предел скорости. */
const DRAG = 0.12;
const FRICTION = 0.02;
const E_WALL = 0.86;
const E_MAL = 0.82;
const PUCK_MAX = 9;
const SUB = 8;

export const TICK_MS = 1000 / 60;

export type Seat = 0 | 1;

export interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface AhState {
  puck: Body;
  mal: [Body, Body];
  score: [number, number];
  /** Сыграно секунд; лимит (0 — без времени) и до скольких шайб. */
  t: number;
  limit: number;
  goals: number;
  /** Пауза после гола; кто подаёт (шайба кладётся на его половину). */
  goalT: number;
  serve: Seat;
  lastGoal: -1 | Seat;
  /** Сколько шайба почти не движется (стол сам «поддувает»). */
  still: number;
  /** Кто последним коснулся шайбы. */
  touch: -1 | Seat;
  speed: number;
  spSeen?: number[];
  /** Оформление стола (на физику не влияет). */
  table?: string;
  over: boolean;
}

/** Ввод места: x/y — куда тянется рука (мышь, палец), или kx/ky — направление клавишами (−1…1). */
export interface AhIn {
  x?: number;
  y?: number;
  kx: number;
  ky: number;
  sp?: number;
}

export type AhEvent =
  | { k: 'hit'; st: number; seat: Seat }
  | { k: 'wall'; st: number }
  | { k: 'post'; st: number }
  | { k: 'goal'; seat: Seat; score: [number, number]; own: boolean }
  | { k: 'serve'; seat: Seat }
  | { k: 'end' };

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const num = (v: unknown, a: number, b: number, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, a, b) : d);

/** Где может стоять бита места: своя половина, не залезая на борт и за центр. */
export function malBounds(seat: Seat) {
  const xm = W / 2 - MAL_R;
  return seat === 0 ? { x0: -xm, x1: xm, y0: MAL_R, y1: L / 2 - MAL_R * 0.25 } : { x0: -xm, x1: xm, y0: L / 2 + MAL_R * 0.25, y1: L - MAL_R };
}

export const homeOf = (seat: Seat): [number, number] => [0, seat === 0 ? 0.22 : L - 0.22];

export function newGame(goals: number, minutes: number, rng: Rng, speed = 0.7): AhState {
  const serve: Seat = rng.next() < 0.5 ? 0 : 1;
  const st: AhState = {
    puck: { x: 0, y: L / 2, vx: 0, vy: 0 },
    mal: [
      { x: 0, y: homeOf(0)[1], vx: 0, vy: 0 },
      { x: 0, y: homeOf(1)[1], vx: 0, vy: 0 },
    ],
    score: [0, 0],
    t: 0,
    limit: minutes * 60,
    goals,
    goalT: 0,
    serve,
    lastGoal: -1,
    still: 0,
    touch: -1,
    speed,
    over: false,
  };
  place(st, serve);
  return st;
}

/** Положить шайбу на половину подающего. */
function place(st: AhState, seat: Seat) {
  st.puck = { x: 0, y: seat === 0 ? L * 0.3 : L * 0.7, vx: 0, vy: 0 };
  st.serve = seat;
  st.touch = -1;
}

export const idleInput = (): AhIn => ({ kx: 0, ky: 0 });

/** Ввод из сети — числа в своих пределах, лишнее отбрасывается. */
export function cleanInput(raw: unknown): AhIn | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const out: AhIn = { kx: num(o.kx, -1, 1), ky: num(o.ky, -1, 1) };
  if (typeof o.x === 'number' && Number.isFinite(o.x) && typeof o.y === 'number' && Number.isFinite(o.y)) {
    out.x = clamp(o.x, -W, W);
    out.y = clamp(o.y, -L, 2 * L);
  }
  const sp = cleanSpeed(o.sp);
  if (sp != null) out.sp = sp;
  return out;
}

/** Бита тянется к руке: скорость к цели, разгон ограничен; на краях своей половины — упирается. */
function moveMallet(m: Body, seat: Seat, cmd: AhIn, h: number, sp: number) {
  const vmax = MAL_V * sp;
  let tx: number;
  let ty: number;
  if (cmd.x != null && cmd.y != null) {
    const b = malBounds(seat);
    const gx = clamp(cmd.x, b.x0, b.x1);
    const gy = clamp(cmd.y, b.y0, b.y1);
    // рука ведёт биту «пружиной»: дальше — быстрее, у цели — останавливается
    tx = (gx - m.x) * 30 * sp;
    ty = (gy - m.y) * 30 * sp;
    const d = Math.hypot(tx, ty);
    if (d > vmax) {
      tx *= vmax / d;
      ty *= vmax / d;
    }
  } else {
    const d = Math.hypot(cmd.kx, cmd.ky);
    const k = d > 1 ? 1 / d : 1;
    tx = cmd.kx * k * vmax * 0.6;
    ty = cmd.ky * k * vmax * 0.6;
  }
  const acc = MAL_ACC * sp * sp * h;
  const dvx = tx - m.vx;
  const dvy = ty - m.vy;
  const dv = Math.hypot(dvx, dvy);
  const f = dv > acc ? acc / dv : 1;
  m.vx += dvx * f;
  m.vy += dvy * f;
  m.x += m.vx * h;
  m.y += m.vy * h;
  const b = malBounds(seat);
  if (m.x < b.x0) [m.x, m.vx] = [b.x0, Math.max(0, m.vx)];
  if (m.x > b.x1) [m.x, m.vx] = [b.x1, Math.min(0, m.vx)];
  if (m.y < b.y0) [m.y, m.vy] = [b.y0, Math.max(0, m.vy)];
  if (m.y > b.y1) [m.y, m.vy] = [b.y1, Math.min(0, m.vy)];
}

/** Отражение тела по нормали (n — от препятствия к телу). */
function bounceOff(p: Body, nx: number, ny: number, e: number): number {
  const vn = p.vx * nx + p.vy * ny;
  if (vn >= 0) return 0;
  p.vx -= (1 + e) * vn * nx;
  p.vy -= (1 + e) * vn * ny;
  return -vn;
}

/** Борта, скругления углов и штанги ворот. Возвращает [удар о борт, удар о штангу]. */
function walls(p: Body): [number, number] {
  let wall = 0;
  let post = 0;
  const r = PUCK_R;
  const inGoalZone = p.y < 0 || p.y > L;
  const xm = (inGoalZone ? GOAL / 2 : W / 2) - r;
  if (p.x < -xm) {
    p.x = -xm;
    wall = Math.max(wall, bounceOff(p, 1, 0, inGoalZone ? 0.3 : E_WALL));
  } else if (p.x > xm) {
    p.x = xm;
    wall = Math.max(wall, bounceOff(p, -1, 0, inGoalZone ? 0.3 : E_WALL));
  }
  for (const end of [0, 1] as const) {
    const yw = end === 0 ? r : L - r;
    const ny = end === 0 ? 1 : -1;
    const past = end === 0 ? p.y < yw : p.y > yw;
    if (past && Math.abs(p.x) > GOAL / 2 && !inGoalZone) {
      p.y = yw;
      wall = Math.max(wall, bounceOff(p, 0, ny, E_WALL));
    }
    // штанги — концы створа
    const yp = end === 0 ? 0 : L;
    for (const sx of [-1, 1]) {
      const px = (sx * GOAL) / 2;
      const dx = p.x - px;
      const dy = p.y - yp;
      const d = Math.hypot(dx, dy);
      if (d < r && d > 1e-9) {
        p.x = px + (dx / d) * r;
        p.y = yp + (dy / d) * r;
        post = Math.max(post, bounceOff(p, dx / d, dy / d, E_WALL * 0.9));
      }
    }
  }
  // скругления углов: центр дуги внутри стола
  const cr = CORNER;
  for (const cx of [-W / 2 + cr, W / 2 - cr])
    for (const cy of [cr, L - cr]) {
      const inX = cx < 0 ? p.x < cx : p.x > cx;
      const inY = cy < L / 2 ? p.y < cy : p.y > cy;
      if (!inX || !inY) continue;
      const dx = p.x - cx;
      const dy = p.y - cy;
      const d = Math.hypot(dx, dy);
      if (d > cr - r) {
        p.x = cx + (dx / d) * (cr - r);
        p.y = cy + (dy / d) * (cr - r);
        wall = Math.max(wall, bounceOff(p, -dx / d, -dy / d, E_WALL));
      }
    }
  return [wall, post];
}

/** Шайба о биту: бита тяжёлая (рука держит), шайба отскакивает с её скоростью. */
function hitMallet(p: Body, m: Body): number {
  const dx = p.x - m.x;
  const dy = p.y - m.y;
  const d = Math.hypot(dx, dy);
  const R = PUCK_R + MAL_R;
  if (d >= R || d < 1e-9) return 0;
  const nx = dx / d;
  const ny = dy / d;
  p.x = m.x + nx * R;
  p.y = m.y + ny * R;
  const rvx = p.vx - m.vx;
  const rvy = p.vy - m.vy;
  const vn = rvx * nx + rvy * ny;
  if (vn >= 0) return 0;
  p.vx -= (1 + E_MAL) * vn * nx;
  p.vy -= (1 + E_MAL) * vn * ny;
  return -vn;
}

/** Шаг партии: 1/60 с, внутри — 8 мелких шагов физики. */
export function step(st: AhState, inputs: (AhIn | null | undefined)[], rng: Rng): AhEvent[] {
  const ev: AhEvent[] = [];
  if (st.over) return ev;
  const dt = TICK_MS / 1000;
  const idle = idleInput();
  const inp: [AhIn, AhIn] = [inputs[0] ?? idle, inputs[1] ?? idle];
  applySpeed(st, 0, inp[0].sp);
  applySpeed(st, 1, inp[1].sp);
  const sp = st.speed > 0 ? st.speed : 1;

  if (st.goalT > 0) {
    st.goalT -= dt;
    if (st.goalT <= 0) {
      if (st.score[0] >= st.goals || st.score[1] >= st.goals) return end(st, ev);
      place(st, st.serve);
      ev.push({ k: 'serve', seat: st.serve });
    }
  } else st.t += dt;
  if (st.limit > 0 && st.t >= st.limit && st.goalT <= 0) {
    st.t = st.limit;
    return end(st, ev);
  }

  // шайба живёт в «игровом» времени (скорость игры), бита — в настоящем: рука не замедляется,
  // но её скорость при ударе пересчитывается в игровую — иначе на медленной скорости бита била бы слишком сильно
  const h = (dt * sp) / SUB;
  const hmal = dt / SUB;
  const hit: [number, number] = [0, 0];
  let wall = 0;
  let post = 0;
  const frozen = st.goalT > 0;
  for (let k = 0; k < SUB; k++) {
    for (const s of [0, 1] as const) moveMallet(st.mal[s], s, inp[s], hmal, sp);
    if (frozen) continue;
    const p = st.puck;
    p.x += p.vx * h;
    p.y += p.vy * h;
    const v = Math.hypot(p.vx, p.vy);
    if (v > 0) {
      const nv = Math.max(0, v - (FRICTION + DRAG * v) * h);
      p.vx *= nv / v;
      p.vy *= nv / v;
    }
    // гол: шайба целиком за линией ворот
    if (p.y < -PUCK_R || p.y > L + PUCK_R) {
      const seat: Seat = p.y < 0 ? 1 : 0;
      st.score[seat]++;
      st.lastGoal = seat;
      st.goalT = 1.4;
      // подаёт пропустивший
      st.serve = seat === 0 ? 1 : 0;
      p.vx = 0;
      p.vy = 0;
      p.y = seat === 1 ? -PUCK_R * 2 : L + PUCK_R * 2;
      ev.push({ k: 'goal', seat, score: [st.score[0], st.score[1]], own: st.touch >= 0 && st.touch !== seat });
      break;
    }
    const [wl, ps] = walls(p);
    wall = Math.max(wall, wl);
    post = Math.max(post, ps);
    for (const s of [0, 1] as const) {
      const m = st.mal[s];
      const hv = hitMallet(p, { x: m.x, y: m.y, vx: m.vx / sp, vy: m.vy / sp });
      if (hv > 0) {
        hit[s] = Math.max(hit[s], hv);
        st.touch = s;
        // прижатая к борту шайба не проваливается сквозь биту — выталкиваем обратно на стол
        p.x = clamp(p.x, -W / 2 + PUCK_R, W / 2 - PUCK_R);
      }
    }
    const v2 = Math.hypot(p.vx, p.vy);
    if (v2 > PUCK_MAX) {
      p.vx *= PUCK_MAX / v2;
      p.vy *= PUCK_MAX / v2;
    }
  }
  for (const s of [0, 1] as const) if (hit[s] > 0.15) ev.push({ k: 'hit', st: Math.round(hit[s] * 100) / 100, seat: s });
  if (wall > 0.2) ev.push({ k: 'wall', st: Math.round(wall * 100) / 100 });
  if (post > 0.2) ev.push({ k: 'post', st: Math.round(post * 100) / 100 });

  // шайба замерла там, где её не достать (угол, центр между битами) — стол «поддувает» её к середине половины
  if (!frozen) {
    const v = Math.hypot(st.puck.vx, st.puck.vy);
    st.still = v < 0.05 ? st.still + dt : 0;
    if (st.still > 4) {
      st.still = 0;
      const p = st.puck;
      const ty = p.y < L / 2 ? L * 0.3 : L * 0.7;
      const a = Math.atan2(ty - p.y, -p.x) + (rng.next() - 0.5) * 0.4;
      p.vx = Math.cos(a) * 0.35;
      p.vy = Math.sin(a) * 0.35;
    }
  }
  return ev;
}

function end(st: AhState, ev: AhEvent[]): AhEvent[] {
  st.over = true;
  ev.push({ k: 'end' });
  return ev;
}

/** Снимок для сети: числа округлены. */
export function snapshot(st: AhState): AhState {
  const r = (v: number, k: number) => Math.round(v * k) / k;
  const b = (o: Body): Body => ({ x: r(o.x, 1e4), y: r(o.y, 1e4), vx: r(o.vx, 1e3), vy: r(o.vy, 1e3) });
  return {
    ...st,
    puck: b(st.puck),
    mal: [b(st.mal[0]), b(st.mal[1])],
    score: [st.score[0], st.score[1]],
    t: r(st.t, 100),
    goalT: r(st.goalT, 100),
    still: r(st.still, 100),
  };
}
