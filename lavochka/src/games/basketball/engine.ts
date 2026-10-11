/* Настольный баскетбол, как советский кнопочный: без DOM (его гоняет комната — сервер, хост P2P или браузер).
 * Жёлтое поле из ямок-пирамид, на дне каждой — лунка с катапультой. Мяч скатывается по граням в одну из лунок.
 * У лунки два номера — красный и синий; у каждого игрока на своём торце ряд клавиш 1…9, 0. Кто первым нажал клавишу
 * с номером лунки, где лежит мяч, — того катапульта и бросает: в кольцо на дальнем конце. Нажал не ту — рука «залипает».
 * Сверху поле накрыто прозрачным колпаком: мяч от него отскакивает и вылететь не может.
 * Координаты (метры): x — вдоль поля (красные сидят у −x и бросают в кольцо у +x), z — поперёк, y — вверх (0 — гребни ямок). */
import { applySpeed, cleanSpeed } from '../../core/realtime';
import type { Rng } from '../../core/types';

export const L = 0.3;
export const WD = 0.17;
export const BALL_R = 0.0095;
/** Глубина ямок, отверстие лунки (полуширина). */
export const DEPTH = 0.013;
/** Щель лунки: полуширина вдоль поля и поперёк. */
export const HOLE = 0.0062;
export const HOLE_X = 0.0085;
const G = 6;
/** Колпак: основание чуть шире поля, высота, насколько сходятся бока и торцы к верху, скругление рёбер. */
export const DOME = { x: 0.153, z: 0.088, h: 0.16, inZ: 0.032, inX: 0.008, k: 0.009 };
/** Щит (плоскость x = ±BOARD.x), кольцо (центр ±RIM.x, высота RIM.y, радиус RIM.r) и корзинка-усечённый конус под ним. */
export const BOARD = { x: 0.141, y0: 0.07, y1: 0.13, z: 0.028, t: 0.004 };
export const RIM = { x: 0.112, y: 0.096, r: 0.025, tube: 0.0018 };
export const NET = { r: 0.016, h: 0.038 };
const E_FLOOR = 0.32;
const E_DOME = 0.55;
const E_BOARD = 0.5;
const E_RIM = 0.45;
const SUB = 8;

export const TICK_MS = 1000 / 60;

export type Team = 0 | 1;

/** Ямка: границы по x и z, лунка внутри (не обязательно в середине). */
export interface Cell {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  hx: number;
  hz: number;
}

/** Три ряда (как на коробке): спереди 4 лунки, в середине 3, сзади 3. Раскладка зеркальна по x — красным и синим поровну. */
function cells(): Cell[] {
  const rz = [-WD / 2, -WD / 6, WD / 6, WD / 2];
  const out: Cell[] = [];
  const row = (r: number, xs: number[], holes: number[]) => {
    for (let i = 0; i < holes.length; i++) out.push({ x0: xs[i], x1: xs[i + 1], z0: rz[r], z1: rz[r + 1], hx: holes[i], hz: (rz[r] + rz[r + 1]) / 2 });
  };
  // ряд 0 — дальний (−z), ряд 2 — ближний к сидящим (+z)
  row(0, [-L / 2, -0.045, 0.045, L / 2], [-0.088, 0, 0.088]);
  row(1, [-L / 2, -0.04, 0.04, L / 2], [-0.056, 0, 0.056]);
  row(2, [-L / 2, -0.075, 0, 0.075, L / 2], [-0.106, -0.036, 0.036, 0.106]);
  return out;
}

export const CELLS = cells();

/** Номера лунок у красных и у синих (как напечатаны на поле). Клавиши слева направо: 1 2 … 9 0. */
export const NUMS: [number[], number[]] = [
  [9, 7, 3, 5, 6, 2, 0, 8, 4, 1],
  [8, 1, 4, 3, 9, 7, 6, 0, 2, 5],
];
export const keyLabel = (k: number) => (k + 1) % 10;
export const holeOf = (team: Team, label: number) => NUMS[team].indexOf(label);
export const labelOf = (team: Team, hole: number) => NUMS[team][hole];

export interface Ball {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

export interface BbState {
  ball: Ball;
  /** Лунка, где лежит мяч (−1 — катится или летит); сколько лежит; номер «поимки» (для ботов). */
  hole: number;
  rest: number;
  cap: number;
  score: [number, number];
  t: number;
  limit: number;
  points: number;
  /** Рука «залипла» после неверного нажатия, с; последний увиденный счётчик нажатий. */
  lock: [number, number];
  press: [number, number];
  /** Катапульты: сколько ещё дёргается рычаг (с) и чья клавиша (для показа). */
  flick: number[];
  flickBy: number[];
  /** Последний бросок: кто, из какой лунки; попал ли уже (чтобы не засчитать дважды). */
  shot: -1 | 0 | 1;
  shotFrom: number;
  scored: boolean;
  /** Пауза перед вбрасыванием, сколько мяч лежит без дела не в лунке, сколько раз встряхивали стол. */
  serve: number;
  still: number;
  shakes: number;
  /** Скорость физики (доля от жизни): часы, паузы и «залипание» руки идут как обычно. */
  speed: number;
  /** Последняя скорость, присланная каждым местом (смена скорости за столом). */
  spSeen?: number[];
  over: boolean;
}

/** Ввод места: k — позиция клавиши (0…9 слева направо, −1 — нет), n — счётчик нажатий. */
export interface BbIn {
  k: number;
  n: number;
  /** Смена скорости игры за столом. */
  sp?: number;
}

export type BbEvent =
  | { k: 'shot'; team: Team; hole: number }
  | { k: 'miss'; team: Team; hole: number }
  | { k: 'floor'; st: number }
  | { k: 'dome'; st: number }
  | { k: 'board'; st: number }
  | { k: 'rim'; st: number }
  | { k: 'score'; team: Team; score: [number, number] }
  | { k: 'drop' }
  | { k: 'shake' }
  | { k: 'end' };

// ---------------------------------------------------------------- поле

export function cellAt(x: number, z: number): number {
  for (let i = 0; i < CELLS.length; i++) {
    const c = CELLS[i];
    if (x >= c.x0 && x <= c.x1 && z >= c.z0 && z <= c.z1) return i;
  }
  // за краем — ближайшая
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < CELLS.length; i++) {
    const c = CELLS[i];
    const d = Math.hypot(Math.max(c.x0 - x, 0, x - c.x1), Math.max(c.z0 - z, 0, z - c.z1));
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

/** Высота поля и уклон (dh/dx, dh/dz): перевёрнутая пирамида, вершина — в лунке. */
export function floorAt(x: number, z: number): [number, number, number] {
  const c = CELLS[cellAt(x, z)];
  const sx = x >= c.hx ? c.x1 - c.hx : c.hx - c.x0;
  const sz = z >= c.hz ? c.z1 - c.hz : c.hz - c.z0;
  const ux = Math.abs(x - c.hx) / sx;
  const uz = Math.abs(z - c.hz) / sz;
  if (ux >= uz) return [-DEPTH * (1 - Math.min(1, ux)), ux < 1 ? (DEPTH * Math.sign(x - c.hx)) / sx : 0, 0];
  return [-DEPTH * (1 - Math.min(1, uz)), 0, uz < 1 ? (DEPTH * Math.sign(z - c.hz)) / sz : 0];
}

/** Мяч лежит в лунке: центр чуть ниже дна ямки (проваливается в отверстие). */
export const restY = () => -DEPTH + Math.sqrt(BALL_R * BALL_R - HOLE * HOLE) * 0.9;

// ---------------------------------------------------------------- колпак

/** Плоскости колпака (n·p ≤ d внутри): бока, торцы, верх. */
const DOME_PLANES: [number, number, number, number][] = (() => {
  const out: [number, number, number, number][] = [];
  for (const s of [1, -1]) {
    const nz = [0, DOME.inZ / DOME.h, s];
    const lz = Math.hypot(nz[1], nz[2]);
    out.push([0, nz[1] / lz, nz[2] / lz, DOME.z / lz]);
    const nx = [s, DOME.inX / DOME.h, 0];
    const lx = Math.hypot(nx[0], nx[1]);
    out.push([nx[0] / lx, nx[1] / lx, 0, DOME.x / lx]);
  }
  out.push([0, 1, 0, DOME.h]);
  return out;
})();

/** «Расстояние» до колпака (гладкий максимум по плоскостям — скруглённые рёбра) и нормаль наружу. */
export function domeDist(x: number, y: number, z: number): [number, number, number, number] {
  const k = DOME.k;
  let m = -Infinity;
  const ds = DOME_PLANES.map(([a, b, c, d]) => {
    const v = a * x + b * y + c * z - d;
    if (v > m) m = v;
    return v;
  });
  let sum = 0;
  let nx = 0;
  let ny = 0;
  let nz = 0;
  ds.forEach((v, i) => {
    const w = Math.exp((v - m) / k);
    sum += w;
    nx += w * DOME_PLANES[i][0];
    ny += w * DOME_PLANES[i][1];
    nz += w * DOME_PLANES[i][2];
  });
  const f = m + k * Math.log(sum);
  const ln = Math.hypot(nx, ny, nz) || 1;
  return [f, nx / ln, ny / ln, nz / ln];
}

// ---------------------------------------------------------------- партия

export function newGame(points: number, minutes: number, rng: Rng, speed = 1): BbState {
  const st: BbState = {
    ball: { x: 0, y: 0.1, z: 0, vx: 0, vy: 0, vz: 0 },
    hole: -1,
    rest: 0,
    cap: 0,
    score: [0, 0],
    t: 0,
    limit: minutes * 60,
    points,
    lock: [0, 0],
    press: [0, 0],
    flick: CELLS.map(() => 0),
    flickBy: CELLS.map(() => 0),
    shot: -1,
    shotFrom: -1,
    scored: false,
    serve: 1,
    still: 0,
    shakes: 0,
    speed,
    over: false,
  };
  serveBall(st, rng);
  return st;
}

/** Вбрасывание: мяч опускают над серединой, он чуть катится в случайную сторону. */
function serveBall(st: BbState, rng: Rng) {
  const a = rng.next() * Math.PI * 2;
  st.ball = { x: (rng.next() - 0.5) * 0.02, y: 0.06, z: (rng.next() - 0.5) * 0.02, vx: Math.cos(a) * 0.12, vy: 0, vz: Math.sin(a) * 0.12 };
  st.hole = -1;
  st.shot = -1;
  st.scored = false;
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

export const idleInput = (): BbIn => ({ k: -1, n: 0 });

export function cleanInput(raw: unknown): BbIn | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const k = typeof o.k === 'number' && Number.isFinite(o.k) ? Math.round(clamp(o.k, -1, 9)) : -1;
  const n = typeof o.n === 'number' && Number.isFinite(o.n) ? Math.round(clamp(o.n, 0, 1e9)) : 0;
  const out: BbIn = { k, n };
  const sp = cleanSpeed(o.sp);
  if (sp != null) out.sp = sp;
  return out;
}

/** Точка прицела: чуть выше середины кольца команды. */
export const target = (team: Team): [number, number, number] => [team === 0 ? RIM.x : -RIM.x, RIM.y + 0.004, 0];

/** Навесная траектория из лунки в кольцо: верхняя точка — под колпаком, к кольцу мяч уже падает. */
export function aimVelocity(team: Team, hole: number, ox = 0, oz = 0): [number, number, number] {
  const c = CELLS[hole];
  const [tx0, ty, tz0] = target(team);
  const tx = tx0 + ox;
  const tz = tz0 + oz;
  const y0 = restY();
  const dx = tx - c.hx;
  const dz = tz - c.hz;
  const D = Math.hypot(dx, dz);
  // высокий навес под самый колпак: из-под кольца мяч иначе бьётся о дужку снизу
  const apex = DOME.h - BALL_R - 0.01;
  const vy = Math.sqrt(2 * G * (apex - y0));
  const t1 = vy / G;
  const t2 = Math.sqrt((2 * (apex - ty)) / G);
  const vh = D / (t1 + t2);
  return [(dx / D) * vh, vy, (dz / D) * vh];
}

/** Разброс катапульты: куда на самом деле «целит» (м, вокруг кольца) и доля скорости. */
const SPREAD_T = 0.036;
const SPREAD_V = 0.05;

function launch(st: BbState, team: Team, rng: Rng, ev: BbEvent[]) {
  const h = st.hole;
  const gauss = () => (rng.next() + rng.next() + rng.next() - 1.5) * 1.15;
  const [vx, vy, vz] = aimVelocity(team, h, gauss() * SPREAD_T, gauss() * SPREAD_T);
  const kv = 1 + gauss() * SPREAD_V;
  st.ball.vx = vx * kv;
  st.ball.vz = vz * kv;
  st.ball.vy = vy * (1 + gauss() * SPREAD_V * 0.5);
  st.ball.y += 0.002;
  st.hole = -1;
  st.rest = 0;
  st.shot = team;
  st.shotFrom = h;
  st.scored = false;
  ev.push({ k: 'shot', team, hole: h });
}

/** Шаг партии: 1/60 с. */
export function step(st: BbState, inputs: (BbIn | null | undefined)[], rng: Rng): BbEvent[] {
  const ev: BbEvent[] = [];
  if (st.over) return ev;
  const dt = TICK_MS / 1000;
  st.t += dt;
  if (st.limit > 0 && st.t >= st.limit) {
    st.t = st.limit;
    return end(st, ev);
  }
  for (let i = 0; i < st.flick.length; i++) st.flick[i] = Math.max(0, st.flick[i] - dt);

  // нажатия: кто первым нажал клавишу своей лунки — тот бросает; одновременно — жребий
  const fire: Team[] = [];
  for (const team of [0, 1] as const) {
    st.lock[team] = Math.max(0, st.lock[team] - dt);
    const inp = inputs[team];
    if (inp) applySpeed(st, team, inp.sp);
    if (!inp || inp.n === st.press[team]) continue;
    st.press[team] = inp.n;
    if (inp.k < 0 || st.lock[team] > 0) continue;
    const h = holeOf(team, keyLabel(inp.k));
    if (h < 0) continue;
    st.flick[h] = 0.18;
    st.flickBy[h] = team;
    if (st.hole === h && st.serve <= 0) fire.push(team);
    else {
      st.lock[team] = 0.5;
      ev.push({ k: 'miss', team, hole: h });
    }
  }
  if (fire.length) launch(st, fire.length > 1 ? fire[rng.int(2)] : fire[0], rng, ev);

  if (st.serve > 0) {
    st.serve -= dt;
    if (st.serve <= 0) ev.push({ k: 'drop' });
    return ev;
  }
  if (st.hole >= 0) {
    st.rest += dt;
    return ev;
  }

  const b = st.ball;
  const sp0 = st.speed > 0 ? st.speed : 1;
  const h = (dt * sp0) / SUB;
  let fl = 0;
  let dm = 0;
  let bd = 0;
  let rm = 0;
  for (let s = 0; s < SUB; s++) {
    const py = b.y;
    b.vy -= G * h;
    b.x += b.vx * h;
    b.y += b.vy * h;
    b.z += b.vz * h;
    // поле: по нормали грани; катится — ускорение по склону 5/7 g, трение качения
    const [fh, gx, gz] = floorAt(b.x, b.z);
    const nl = Math.hypot(gx, 1, gz);
    const nx = -gx / nl;
    const ny = 1 / nl;
    const nz = -gz / nl;
    const dist = (b.y - fh) * ny;
    if (dist < BALL_R) {
      b.x += nx * (BALL_R - dist);
      b.y += ny * (BALL_R - dist);
      b.z += nz * (BALL_R - dist);
      const vn = b.vx * nx + b.vy * ny + b.vz * nz;
      if (vn < 0) {
        const e = vn < -0.15 ? E_FLOOR : 0;
        b.vx -= (1 + e) * vn * nx;
        b.vy -= (1 + e) * vn * ny;
        b.vz -= (1 + e) * vn * nz;
        fl = Math.max(fl, -vn);
      }
      // качение: тяга вниз по склону меньше (часть уходит на вращение), трение
      b.vx -= (2 / 7) * G * ny * nx * h;
      b.vy -= (2 / 7) * G * (ny * ny - 1) * h;
      b.vz -= (2 / 7) * G * ny * nz * h;
      const sp = Math.hypot(b.vx, b.vy, b.vz);
      if (sp > 0) {
        const ns = Math.max(0, sp - (0.12 + 1.6 * sp) * h);
        b.vx *= ns / sp;
        b.vy *= ns / sp;
        b.vz *= ns / sp;
      }
      // улёгся в лунку
      const c = CELLS[cellAt(b.x, b.z)];
      if (Math.hypot(b.x - c.hx, b.z - c.hz) < 0.0035 && Math.hypot(b.vx, b.vy, b.vz) < 0.09) {
        st.hole = CELLS.indexOf(c);
        st.rest = 0;
        st.cap++;
        st.still = 0;
        b.x = c.hx;
        b.z = c.hz;
        b.y = restY();
        b.vx = b.vy = b.vz = 0;
        break;
      }
    }
    // колпак
    const [f, dx, dy, dz] = domeDist(b.x, b.y, b.z);
    if (f > -BALL_R) {
      const pen = f + BALL_R;
      b.x -= dx * pen;
      b.y -= dy * pen;
      b.z -= dz * pen;
      const vn = b.vx * dx + b.vy * dy + b.vz * dz;
      if (vn > 0) {
        b.vx -= (1 + E_DOME) * vn * dx;
        b.vy -= (1 + E_DOME) * vn * dy;
        b.vz -= (1 + E_DOME) * vn * dz;
        dm = Math.max(dm, vn);
      }
    }
    for (const side of [1, -1]) {
      bd = Math.max(bd, board(b, side));
      rm = Math.max(rm, rimAndNet(b, side));
      // попадание: центр мяча сверху вниз прошёл плоскость кольца внутри него
      const rx = side * RIM.x;
      if (!st.scored && py >= RIM.y && b.y < RIM.y && Math.hypot(b.x - rx, b.z) < RIM.r - BALL_R * 0.2) {
        const team: Team = side > 0 ? 0 : 1;
        st.scored = true;
        st.score[team] += 2;
        ev.push({ k: 'score', team, score: [st.score[0], st.score[1]] });
      }
    }
  }
  // сила звука — как если бы шло в жизнь
  fl /= sp0;
  dm /= sp0;
  bd /= sp0;
  rm /= sp0;
  if (fl > 0.12) ev.push({ k: 'floor', st: Math.round(fl * 100) / 100 });
  if (dm > 0.1) ev.push({ k: 'dome', st: Math.round(dm * 100) / 100 });
  if (bd > 0.1) ev.push({ k: 'board', st: Math.round(bd * 100) / 100 });
  if (rm > 0.08) ev.push({ k: 'rim', st: Math.round(rm * 100) / 100 });
  if (st.hole >= 0 && (st.score[0] >= st.points || st.score[1] >= st.points)) return end(st, ev);
  if (st.hole >= 0) st.shot = -1;

  // мяч замер не в лунке (на гребне) — встряхиваем стол
  const sp = Math.hypot(b.vx, b.vy, b.vz);
  st.still = st.hole < 0 && sp < 0.02 * sp0 ? st.still + dt : 0;
  if (st.still > 1.2) {
    const a = rng.next() * Math.PI * 2;
    b.vx += Math.cos(a) * 0.15;
    b.vz += Math.sin(a) * 0.15;
    b.vy += 0.15;
    st.still = 0;
    st.shakes++;
    ev.push({ k: 'shake' });
  }
  return ev;
}

/** Щит: пластина x = ±BOARD.x, лицом к полю. */
function board(b: Ball, side: number): number {
  if (b.y < BOARD.y0 - BALL_R || b.y > BOARD.y1 + BALL_R || Math.abs(b.z) > BOARD.z + BALL_R) return 0;
  const face = side * (BOARD.x - BOARD.t / 2);
  const d = (face - b.x) * side;
  if (d >= BALL_R || d < -BOARD.t) return 0;
  // по краю щита — по ближайшей точке ребра; по лицу — по нормали
  const cy = clamp(b.y, BOARD.y0, BOARD.y1);
  const cz = clamp(b.z, -BOARD.z, BOARD.z);
  let nx = -side;
  let ny = 0;
  let nz = 0;
  let pen = BALL_R - d;
  if (cy !== b.y || cz !== b.z) {
    const ex = b.x - face;
    const ey = b.y - cy;
    const ez = b.z - cz;
    const l = Math.hypot(ex, ey, ez);
    if (l >= BALL_R || l === 0) return 0;
    nx = ex / l;
    ny = ey / l;
    nz = ez / l;
    pen = BALL_R - l;
  }
  b.x += nx * pen;
  b.y += ny * pen;
  b.z += nz * pen;
  const vn = b.vx * nx + b.vy * ny + b.vz * nz;
  if (vn >= 0) return 0;
  b.vx -= (1 + E_BOARD) * vn * nx;
  b.vy -= (1 + E_BOARD) * vn * ny;
  b.vz -= (1 + E_BOARD) * vn * nz;
  return -vn;
}

/** Дужка кольца (тор) и стенка корзинки (усечённый конус, мяч проходит насквозь). */
function rimAndNet(b: Ball, side: number): number {
  const cx = side * RIM.x;
  const qx = b.x - cx;
  const qy = b.y - RIM.y;
  const qz = b.z;
  const rho = Math.hypot(qx, qz);
  if (rho > RIM.r + 0.03 || qy > 0.03 || qy < -NET.h - 0.03) return 0;
  const ux = rho > 1e-6 ? qx / rho : 1;
  const uz = rho > 1e-6 ? qz / rho : 0;
  let hit = 0;
  // ближайшая точка дужки
  {
    const ex = qx - ux * RIM.r;
    const ey = qy;
    const ez = qz - uz * RIM.r;
    const d = Math.hypot(ex, ey, ez);
    const min = BALL_R + RIM.tube;
    if (d < min && d > 1e-9) hit = Math.max(hit, push(b, ex / d, ey / d, ez / d, min - d, E_RIM));
  }
  // корзинка: отрезок образующей от (r, 0) до (NET.r, −NET.h) в плоскости (rho, y)
  {
    const ar = RIM.r;
    const ay = 0;
    const br = NET.r;
    const by = -NET.h;
    const er = br - ar;
    const ey = by - ay;
    const u = clamp(((rho - ar) * er + (qy - ay) * ey) / (er * er + ey * ey), 0, 1);
    if (u > 0.02) {
      const pr = rho - (ar + er * u);
      const py = qy - (ay + ey * u);
      const d = Math.hypot(pr, py);
      const min = BALL_R + 0.0008;
      if (d < min && d > 1e-9) hit = Math.max(hit, push(b, (pr / d) * ux, py / d, (pr / d) * uz, min - d, 0.3));
    }
  }
  return hit;
}

function push(b: Ball, nx: number, ny: number, nz: number, pen: number, e: number): number {
  b.x += nx * pen;
  b.y += ny * pen;
  b.z += nz * pen;
  const vn = b.vx * nx + b.vy * ny + b.vz * nz;
  if (vn >= 0) return 0;
  b.vx -= (1 + e) * vn * nx;
  b.vy -= (1 + e) * vn * ny;
  b.vz -= (1 + e) * vn * nz;
  return -vn;
}

function end(st: BbState, ev: BbEvent[]): BbEvent[] {
  st.over = true;
  ev.push({ k: 'end' });
  return ev;
}

/** Снимок для сети: числа округлены. */
export function snapshot(st: BbState): BbState {
  const r = (v: number, k: number) => Math.round(v * k) / k;
  const b = st.ball;
  return {
    ...st,
    ball: { x: r(b.x, 1e5), y: r(b.y, 1e5), z: r(b.z, 1e5), vx: r(b.vx, 1e3), vy: r(b.vy, 1e3), vz: r(b.vz, 1e3) },
    score: [st.score[0], st.score[1]],
    lock: [r(st.lock[0], 100), r(st.lock[1], 100)],
    press: [st.press[0], st.press[1]],
    flick: st.flick.map((f) => r(f, 100)),
    flickBy: st.flickBy.slice(),
    t: r(st.t, 100),
    rest: r(st.rest, 100),
    serve: r(st.serve, 100),
    still: r(st.still, 100),
  };
}
