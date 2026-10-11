/* Настольный хоккей «на штырьках», как советский: без DOM (его гоняет комната — сервер, хост P2P или браузер).
 * Площадка сверху: x — вдоль (0…W), y — поперёк (0 — дальний борт, H — ближний). Красные (место 0) защищают левые ворота, синие — правые.
 * В команде шесть плоских жестяных фигурок на прорезях: вратарь (прорезь поперёк перед воротами), два защитника
 * в своей половине и три нападающих — в чужой. Каждой фигуркой правит своя штанга из торца: вперёд-назад — фигурка едет
 * по прорези, поворот штанги — фигурка крутится вокруг оси. Клюшка — часть жестянки: удар — это крутящаяся клюшка, встретившая шайбу.
 * Единицы — метры, секунды, радианы. Состояние меняется на месте (шаг комнаты — 60 раз в секунду). */
import { applySpeed, cleanSpeed } from '../../core/realtime';
import type { Rng } from '../../core/types';

export const W = 0.66;
export const H = 0.4;
export const CORNER = 0.075;
/** Створ ворот, линия ворот от торца, глубина «домика» ворот. */
export const GOAL = 0.1;
export const GL = 0.045;
export const GD = 0.032;
export const PUCK_R = 0.011;
/** Фигурка в плане — отрезок по плоскости жестянки: назад от оси BACK, вперёд (крюк клюшки) — STICK. Вратарь — такая же жестянка. Мерки сняты с рисунка фигурки. */
export const BACK = 0.0155;
export const STICK = 0.0365;
export const G_BACK = BACK;
export const G_STICK = STICK;
/** Полутолщина жестянки с клюшкой (для столкновений). */
const PLATE = 0.003;
const POST = 0.004;

/** Скорость фигурки по прорези, разгон; вращение — предельная скорость, разгон, торможение. */
const VMAX = 1.0;
const ACC = 12;
const WMAX = 42;
const SPIN_ACC = 650;
const SPIN_DEC = 900;
/** Мышью крутят «как рукой»: угол догоняется почти сразу. */
const WMAX_HAND = 70;
const HAND_ACC = 4000;
/** Трение шайбы: постоянное (м/с²) и вязкое (1/с); упругость бортов, клюшки, ворот; предел скорости. */
const FRICTION = 0.22;
const DRAG = 0.12;
const E_WALL = 0.72;
const E_STICK = 0.55;
const E_POST = 0.5;
const PUCK_MAX = 3.6;
const SUB = 16;

export const TICK_MS = 1000 / 60;

export type Team = 0 | 1;
export type Role = 'G' | 'D' | 'F';

export interface Slot {
  role: Role;
  team: Team;
  /** Точки прорези по равным долям длины (s = i / (N − 1)). */
  pts: [number, number][];
  len: number;
}

export interface Fig {
  /** Положение на прорези 0…1 (0 — ближе к своему торцу; у вратаря — к дальнему борту у красных). */
  s: number;
  /** Скорость вдоль прорези, м/с. */
  v: number;
  /** Угол плоскости жестянки (направление на крюк клюшки) и угловая скорость. Угол не сворачивается — ради плавности. */
  a: number;
  w: number;
}

export interface Puck {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface HkState {
  figs: Fig[];
  puck: Puck;
  score: [number, number];
  /** Сыграно секунд; лимит (0 — без времени) и до скольких шайб. */
  t: number;
  limit: number;
  goals: number;
  /** Пауза после гола (шайба в воротах), затем вбрасывание: шайба лежит в центре. */
  goalT: number;
  faceoff: number;
  lastGoal: -1 | 0 | 1;
  /** Активная полевая фигурка каждой команды (1…5 внутри команды) и та, что выбрал бы автомат. */
  active: [number, number];
  auto: [number, number];
  /** Сколько шайба лежит без движения; последний «стук» от каждого места (счётчик ввода) и перезарядка стука. */
  still: number;
  knock: [number, number];
  knockCd: [number, number];
  /** Кто последним коснулся шайбы (номер фигурки, −1 — никто). */
  touch: number;
  /** Скорость физики (доля от жизни): часы и паузы идут как обычно. */
  speed: number;
  /** Последняя скорость, присланная каждым местом (смена скорости за столом). */
  spSeen?: number[];
  over: boolean;
}

/** Ввод одной штанги: m — вперёд-назад (−1…1), r — вращение (−1…1); s/a — цели мыши (положение и угол), если ведёт мышь. */
export interface RodIn {
  m: number;
  r: number;
  s?: number;
  a?: number;
}

/** Ввод места: полевая штанга, вратарь, выбор полевой фигурки (1…5, −1 — автомат), счётчик «стука по борту». */
export interface HkIn {
  f: RodIn;
  g: RodIn;
  pick: number;
  knock: number;
  /** Смена скорости игры за столом. */
  sp?: number;
}

export type HkEvent =
  | { k: 'hit'; st: number }
  | { k: 'wall'; st: number }
  | { k: 'post'; st: number }
  | { k: 'goal'; team: Team; score: [number, number]; own: boolean }
  | { k: 'drop' }
  | { k: 'knock'; seat: number }
  | { k: 'end' };

// ---------------------------------------------------------------- прорези

const N = 41;

function bezier(p0: [number, number], c: [number, number], p2: [number, number], role: Role, team: Team): Slot {
  const raw: [number, number][] = [];
  const M = 200;
  for (let i = 0; i <= M; i++) {
    const t = i / M;
    const u = 1 - t;
    raw.push([u * u * p0[0] + 2 * u * t * c[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * c[1] + t * t * p2[1]]);
  }
  const cum = [0];
  for (let i = 1; i <= M; i++) cum.push(cum[i - 1] + Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]));
  const len = cum[M];
  const pts: [number, number][] = [];
  let j = 0;
  for (let i = 0; i < N; i++) {
    const target = (i / (N - 1)) * len;
    while (j < M - 1 && cum[j + 1] < target) j++;
    const f = (target - cum[j]) / (cum[j + 1] - cum[j] || 1);
    pts.push([raw[j][0] + (raw[j + 1][0] - raw[j][0]) * f, raw[j][1] + (raw[j + 1][1] - raw[j][1]) * f]);
  }
  return { role, team, pts, len };
}

/** Шесть прорезей команды: вратарь, два защитника, центр, два крайних. У синих — поворот поля на 180°. */
function teamSlots(team: Team): Slot[] {
  const m = (x: number, y: number): [number, number] => (team === 0 ? [x, y] : [W - x, H - y]);
  const L1 = 0.115 * H;
  const L2 = 0.3 * H;
  const L3 = 0.5 * H;
  const L4 = 0.7 * H;
  const L5 = 0.885 * H;
  const B = (a: [number, number], c: [number, number], b: [number, number], role: Role) => bezier(m(...a), m(...c), m(...b), role, team);
  return [
    B([GL + 0.024, H / 2 - 0.07], [GL + 0.046, H / 2], [GL + 0.024, H / 2 + 0.07], 'G'),
    B([0.1 * W, L2 - 0.008], [0.28 * W, L2 + 0.03], [0.46 * W, L2 - 0.004], 'D'),
    B([0.1 * W, L4 + 0.008], [0.28 * W, L4 - 0.03], [0.46 * W, L4 + 0.004], 'D'),
    B([0.53 * W, L3 + 0.004], [0.69 * W, L3 - 0.016], [0.86 * W, L3 + 0.004], 'F'),
    B([0.53 * W, L1 - 0.004], [0.71 * W, L1 + 0.03], [0.9 * W, L1], 'F'),
    B([0.53 * W, L5 + 0.004], [0.71 * W, L5 - 0.03], [0.9 * W, L5], 'F'),
  ];
}

export const SLOTS: Slot[] = [...teamSlots(0), ...teamSlots(1)];

/** Точка прорези при s ∈ [0, 1]. */
export function slotAt(sl: Slot, s: number): [number, number] {
  const f = Math.max(0, Math.min(1, s)) * (N - 1);
  const i = Math.min(N - 2, Math.floor(f));
  const k = f - i;
  const a = sl.pts[i];
  const b = sl.pts[i + 1];
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
}

/** Единичное направление прорези (рост s) в точке s. */
export function slotDir(sl: Slot, s: number): [number, number] {
  const f = Math.max(0, Math.min(1, s)) * (N - 1);
  const i = Math.min(N - 2, Math.floor(f));
  const a = sl.pts[i];
  const b = sl.pts[i + 1];
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return [(b[0] - a[0]) / d, (b[1] - a[1]) / d];
}

/** Ближайшее к точке положение на прорези и расстояние до неё. */
export function slotNearest(sl: Slot, x: number, y: number): { s: number; d: number } {
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < N - 1; i++) {
    const a = sl.pts[i];
    const b = sl.pts[i + 1];
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const L2 = ex * ex + ey * ey || 1;
    const u = Math.max(0, Math.min(1, ((x - a[0]) * ex + (y - a[1]) * ey) / L2));
    const d = Math.hypot(a[0] + ex * u - x, a[1] + ey * u - y);
    if (d < bd) {
      bd = d;
      best = (i + u) / (N - 1);
    }
  }
  return { s: best, d: bd };
}

export const figPos = (st: HkState, i: number) => slotAt(SLOTS[i], st.figs[i].s);
export const teamOf = (i: number): Team => (i < 6 ? 0 : 1);
export const isGoalie = (i: number) => i % 6 === 0;
export const reach = (i: number) => (isGoalie(i) ? G_STICK : STICK);
export const back = (i: number) => (isGoalie(i) ? G_BACK : BACK);
/** Чужие ворота команды (точка в центре линии ворот). */
export const oppGoal = (team: Team): [number, number] => (team === 0 ? [W - GL, H / 2] : [GL, H / 2]);

// ---------------------------------------------------------------- партия

export function newGame(goals: number, minutes: number, rng: Rng, speed = 1): HkState {
  const figs: Fig[] = [];
  for (const team of [0, 1] as const)
    for (let k = 0; k < 6; k++) {
      const s = k === 0 ? 0.5 : k <= 2 ? 0.35 : k === 3 ? 0 : 0.25;
      // жестянки стоят лицом к чужим воротам: плоскость поперёк поля (лицо — слева от направления крюка)
      figs.push({ s, v: 0, a: team === 0 ? -Math.PI / 2 : Math.PI / 2, w: 0 });
    }
  const st: HkState = {
    figs,
    puck: { x: W / 2, y: H / 2, vx: 0, vy: 0 },
    score: [0, 0],
    t: 0,
    limit: minutes * 60,
    goals,
    goalT: 0,
    faceoff: 1.2,
    lastGoal: -1,
    active: [3, 3],
    auto: [3, 3],
    still: 0,
    knock: [0, 0],
    knockCd: [0, 0],
    touch: -1,
    speed,
    over: false,
  };
  void rng;
  return st;
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const num = (v: unknown, a: number, b: number, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, a, b) : d);

export const idleRod = (): RodIn => ({ m: 0, r: 0 });
export const idleInput = (): HkIn => ({ f: idleRod(), g: idleRod(), pick: -1, knock: 0 });

/** Ввод из сети — числа в своих пределах, лишнее отбрасывается. */
export function cleanInput(raw: unknown): HkIn | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const rod = (x: unknown): RodIn => {
    const r = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    const out: RodIn = { m: num(r.m, -1, 1), r: num(r.r, -1, 1) };
    if (typeof r.s === 'number' && Number.isFinite(r.s)) out.s = clamp(r.s, 0, 1);
    if (typeof r.a === 'number' && Number.isFinite(r.a)) out.a = clamp(r.a, -1e6, 1e6);
    return out;
  };
  const pick = Math.round(num(o.pick, -1, 5, -1));
  const out: HkIn = { f: rod(o.f), g: rod(o.g), pick: pick >= 1 ? pick : -1, knock: Math.round(num(o.knock, 0, 1e9)) };
  const sp = cleanSpeed(o.sp);
  if (sp != null) out.sp = sp;
  return out;
}

/** Какая полевая фигурка команды ближе всех дотянется до шайбы (с запасом, чтобы выбор не дёргался). */
function autoPick(st: HkState, team: Team): number {
  const cur = st.auto[team];
  let best = cur;
  let bd = Infinity;
  for (let k = 1; k < 6; k++) {
    const i = team * 6 + k;
    const d = slotNearest(SLOTS[i], st.puck.x, st.puck.y).d - (k === cur ? 0.012 : 0);
    if (d < bd) {
      bd = d;
      best = k;
    }
  }
  return best;
}

function moveRod(f: Fig, sl: Slot, cmd: RodIn, dt: number) {
  const vt = cmd.s != null ? clamp((cmd.s - f.s) * sl.len * 30, -VMAX * 1.2, VMAX * 1.2) : cmd.m * VMAX;
  f.v += clamp(vt - f.v, -ACC * dt, ACC * dt);
  f.s += (f.v * dt) / sl.len;
  if (f.s < 0 || f.s > 1) {
    f.s = clamp(f.s, 0, 1);
    f.v = 0;
  }
  if (cmd.a != null) {
    const wt = clamp((cmd.a - f.a) * 60, -WMAX_HAND, WMAX_HAND);
    f.w += clamp(wt - f.w, -HAND_ACC * dt, HAND_ACC * dt);
  } else {
    const acc = cmd.r ? SPIN_ACC : SPIN_DEC;
    f.w += clamp(cmd.r * WMAX - f.w, -acc * dt, acc * dt);
  }
  f.a += f.w * dt;
}

/** Удар шайбы о отрезок (a→b) толщиной rad; vq — скорость точки касания у отрезка. Возвращает силу удара или 0. */
function collide(p: Puck, ax: number, ay: number, bx: number, by: number, rad: number, e: number, vel?: (qx: number, qy: number) => [number, number]): number {
  const ex = bx - ax;
  const ey = by - ay;
  const L2 = ex * ex + ey * ey;
  const u = L2 > 0 ? clamp(((p.x - ax) * ex + (p.y - ay) * ey) / L2, 0, 1) : 0;
  const qx = ax + ex * u;
  const qy = ay + ey * u;
  const dx = p.x - qx;
  const dy = p.y - qy;
  const d = Math.hypot(dx, dy);
  const min = PUCK_R + rad;
  if (d >= min) return 0;
  let nx: number;
  let ny: number;
  if (d > 1e-9) {
    nx = dx / d;
    ny = dy / d;
  } else {
    // шайба ровно на отрезке — выталкиваем поперёк него
    const l = Math.sqrt(L2) || 1;
    nx = -ey / l;
    ny = ex / l;
  }
  p.x = qx + nx * min;
  p.y = qy + ny * min;
  const [vx, vy] = vel ? vel(qx, qy) : [0, 0];
  const rvx = p.vx - vx;
  const rvy = p.vy - vy;
  const vn = rvx * nx + rvy * ny;
  if (vn >= 0) return 0;
  p.vx -= (1 + e) * vn * nx;
  p.vy -= (1 + e) * vn * ny;
  // немного трения вдоль поверхности
  const tvx = rvx - vn * nx;
  const tvy = rvy - vn * ny;
  p.vx -= tvx * 0.12;
  p.vy -= tvy * 0.12;
  return -vn;
}

function walls(p: Puck): number {
  let hit = 0;
  const r = PUCK_R;
  for (const [cx, cy] of [
    [CORNER, CORNER],
    [W - CORNER, CORNER],
    [W - CORNER, H - CORNER],
    [CORNER, H - CORNER],
  ]) {
    const inX = cx < W / 2 ? p.x < cx : p.x > cx;
    const inY = cy < H / 2 ? p.y < cy : p.y > cy;
    if (!inX || !inY) continue;
    const dx = p.x - cx;
    const dy = p.y - cy;
    const d = Math.hypot(dx, dy);
    if (d > CORNER - r) {
      const nx = dx / d;
      const ny = dy / d;
      p.x = cx + nx * (CORNER - r);
      p.y = cy + ny * (CORNER - r);
      const vn = p.vx * nx + p.vy * ny;
      if (vn > 0) {
        p.vx -= (1 + E_WALL) * vn * nx;
        p.vy -= (1 + E_WALL) * vn * ny;
        hit = Math.max(hit, vn);
      }
    }
  }
  if (p.x < r) {
    p.x = r;
    if (p.vx < 0) (hit = Math.max(hit, -p.vx)), (p.vx = -p.vx * E_WALL);
  }
  if (p.x > W - r) {
    p.x = W - r;
    if (p.vx > 0) (hit = Math.max(hit, p.vx)), (p.vx = -p.vx * E_WALL);
  }
  if (p.y < r) {
    p.y = r;
    if (p.vy < 0) (hit = Math.max(hit, -p.vy)), (p.vy = -p.vy * E_WALL);
  }
  if (p.y > H - r) {
    p.y = H - r;
    if (p.vy > 0) (hit = Math.max(hit, p.vy)), (p.vy = -p.vy * E_WALL);
  }
  return hit;
}

/** Стенки «домика» ворот: бока и задник (снаружи — препятствие, внутри — сетка). */
function goalWalls(p: Puck): number {
  let hit = 0;
  const yT = H / 2 - GOAL / 2;
  const yB = H / 2 + GOAL / 2;
  for (const side of [0, 1]) {
    const gx = side === 0 ? GL : W - GL;
    const bx = side === 0 ? GL - GD : W - GL + GD;
    hit = Math.max(hit, collide(p, gx, yT, bx, yT, POST, E_POST));
    hit = Math.max(hit, collide(p, gx, yB, bx, yB, POST, E_POST));
    hit = Math.max(hit, collide(p, bx, yT, bx, yB, POST, E_POST));
  }
  return hit;
}

/** Шайба о жестянку: отрезок по плоскости фигурки, скорость точки — движение по прорези плюс вращение. */
function hitFig(st: HkState, i: number): number {
  const f = st.figs[i];
  const sl = SLOTS[i];
  const [cx, cy] = slotAt(sl, f.s);
  const dx = Math.cos(f.a);
  const dy = Math.sin(f.a);
  const bk = back(i);
  const rc = reach(i);
  // быстрая отсечка
  if (Math.abs(st.puck.x - cx) > rc + PUCK_R + 0.01 || Math.abs(st.puck.y - cy) > rc + PUCK_R + 0.01) return 0;
  const [tx, ty] = slotDir(sl, f.s);
  return collide(st.puck, cx - dx * bk, cy - dy * bk, cx + dx * rc, cy + dy * rc, PLATE, E_STICK, (qx, qy) => [tx * f.v - f.w * (qy - cy), ty * f.v + f.w * (qx - cx)]);
}

/** Никто не дотянется до шайбы — «мёртвая зона». */
function unreachable(st: HkState): boolean {
  for (let i = 0; i < 12; i++) if (slotNearest(SLOTS[i], st.puck.x, st.puck.y).d < reach(i) + PUCK_R - 0.002) return false;
  return true;
}

function drop(st: HkState, rng: Rng, ev: HkEvent[]) {
  st.puck = { x: W / 2, y: H / 2, vx: 0, vy: 0 };
  st.faceoff = 0.9;
  st.touch = -1;
  ev.push({ k: 'drop' });
  void rng;
}

/** Стук по борту: шайба подпрыгивает и катится в случайную сторону. */
function knock(st: HkState, rng: Rng, power: number) {
  const ang = rng.next() * Math.PI * 2;
  st.puck.vx += Math.cos(ang) * power;
  st.puck.vy += Math.sin(ang) * power;
  st.still = 0;
}

/** Шаг партии: 1/60 с, внутри — 16 мелких шагов физики. */
export function step(st: HkState, inputs: (HkIn | null | undefined)[], rng: Rng): HkEvent[] {
  const ev: HkEvent[] = [];
  if (st.over) return ev;
  const dt = TICK_MS / 1000;
  const idle = idleInput();
  const inp: [HkIn, HkIn] = [inputs[0] ?? idle, inputs[1] ?? idle];

  // кто ведёт: автомат или выбор игрока
  for (const team of [0, 1] as const) {
    applySpeed(st, team, inp[team].sp);
    st.auto[team] = autoPick(st, team);
    const p = inp[team].pick;
    st.active[team] = p >= 1 && p <= 5 ? p : st.auto[team];
    st.knockCd[team] = Math.max(0, st.knockCd[team] - dt);
    if (inp[team].knock !== st.knock[team]) {
      st.knock[team] = inp[team].knock;
      if (st.knockCd[team] <= 0 && st.goalT <= 0 && st.faceoff <= 0) {
        st.knockCd[team] = 1.5;
        knock(st, rng, 0.35);
        ev.push({ k: 'knock', seat: team });
      }
    }
  }

  // гол: шайба в воротах, потом вбрасывание
  if (st.goalT > 0) {
    st.goalT -= dt;
    if (st.goalT <= 0) {
      if (st.score[0] >= st.goals || st.score[1] >= st.goals) return end(st, ev);
      drop(st, rng, ev);
    }
  } else st.t += dt;
  if (st.limit > 0 && st.t >= st.limit && st.goalT <= 0) {
    st.t = st.limit;
    return end(st, ev);
  }

  const cmds: RodIn[] = [];
  for (let i = 0; i < 12; i++) {
    const team = teamOf(i);
    const k = i % 6;
    cmds.push(k === 0 ? inp[team].g : k === st.active[team] ? inp[team].f : idleRod());
  }
  const sp0 = st.speed > 0 ? st.speed : 1;
  const h = (dt * sp0) / SUB;
  let hit = 0;
  let wall = 0;
  let post = 0;
  const frozen = st.goalT > 0 || st.faceoff > 0;
  if (st.faceoff > 0) {
    st.faceoff -= dt;
    if (st.faceoff <= 0) {
      // шайбу бросили на центр: чуть катится
      const ang = rng.next() * Math.PI * 2;
      st.puck.vx = Math.cos(ang) * 0.06;
      st.puck.vy = Math.sin(ang) * 0.06;
    }
  }
  for (let k = 0; k < SUB; k++) {
    for (let i = 0; i < 12; i++) moveRod(st.figs[i], SLOTS[i], cmds[i], h);
    if (frozen) continue;
    const p = st.puck;
    p.x += p.vx * h;
    p.y += p.vy * h;
    const sp = Math.hypot(p.vx, p.vy);
    if (sp > 0) {
      const ns = Math.max(0, sp - (FRICTION + DRAG * sp) * h);
      p.vx *= ns / sp;
      p.vy *= ns / sp;
    }
    // гол — шайба целиком за линией ворот в створе
    const inMouth = Math.abs(p.y - H / 2) < GOAL / 2 - POST;
    if (inMouth && (p.x < GL - PUCK_R * 0.6 || p.x > W - GL + PUCK_R * 0.6)) {
      const team: Team = p.x < W / 2 ? 1 : 0;
      st.score[team]++;
      st.lastGoal = team;
      st.goalT = 1.6;
      p.vx = 0;
      p.vy = 0;
      p.x = team === 1 ? GL - GD / 2 : W - GL + GD / 2;
      ev.push({ k: 'goal', team, score: [st.score[0], st.score[1]], own: st.touch >= 0 && teamOf(st.touch) !== team });
      break;
    }
    wall = Math.max(wall, walls(p));
    post = Math.max(post, goalWalls(p));
    for (let i = 0; i < 12; i++) {
      const hf = hitFig(st, i);
      if (hf > 0) {
        st.touch = i;
        hit = Math.max(hit, hf);
      }
    }
    const s2 = Math.hypot(p.vx, p.vy);
    if (s2 > PUCK_MAX) {
      p.vx *= PUCK_MAX / s2;
      p.vy *= PUCK_MAX / s2;
    }
  }
  // сила звука — как если бы шло в жизнь
  hit /= sp0;
  wall /= sp0;
  post /= sp0;
  if (hit > 0.05) ev.push({ k: 'hit', st: Math.round(hit * 100) / 100 });
  if (wall > 0.08) ev.push({ k: 'wall', st: Math.round(wall * 100) / 100 });
  if (post > 0.08) ev.push({ k: 'post', st: Math.round(post * 100) / 100 });

  // шайба замерла там, где её никто не достанет (или все стоят) — «стучим по борту»
  if (!frozen) {
    const sp = Math.hypot(st.puck.vx, st.puck.vy);
    st.still = sp < 0.03 * sp0 ? st.still + dt : 0;
    if ((st.still > 1.5 && unreachable(st)) || st.still > 6) {
      knock(st, rng, 0.3);
      ev.push({ k: 'knock', seat: -1 });
    }
  }
  return ev;
}

function end(st: HkState, ev: HkEvent[]): HkEvent[] {
  st.over = true;
  ev.push({ k: 'end' });
  return ev;
}

/** Снимок для сети: числа округлены (меньше байт), остальное — как в состоянии. */
export function snapshot(st: HkState): HkState {
  const r = (v: number, k: number) => Math.round(v * k) / k;
  return {
    ...st,
    figs: st.figs.map((f) => ({ s: r(f.s, 1e4), v: r(f.v, 1e3), a: r(f.a, 1e3), w: r(f.w, 10) })),
    puck: { x: r(st.puck.x, 1e4), y: r(st.puck.y, 1e4), vx: r(st.puck.vx, 1e3), vy: r(st.puck.vy, 1e3) },
    score: [st.score[0], st.score[1]],
    active: [st.active[0], st.active[1]],
    auto: [st.auto[0], st.auto[1]],
    knock: [st.knock[0], st.knock[1]],
    knockCd: [r(st.knockCd[0], 100), r(st.knockCd[1], 100)],
    t: r(st.t, 100),
    goalT: r(st.goalT, 100),
    faceoff: r(st.faceoff, 100),
    still: r(st.still, 100),
  };
}
