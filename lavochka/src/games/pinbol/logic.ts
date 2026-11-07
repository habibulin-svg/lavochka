/* Пинбол — логика и физика без DOM (её гоняют тесты). Стол в плане: x — вправо (0…600), y — вниз (0 — верх, 1100 — низ),
 * единица ≈ полмиллиметра. Шар катится под наклоном (сила тяжести вдоль стола), отскакивает от бортов, грибков, рогаток;
 * флипперы — вращающиеся «капсулы»: шар получает скорость их поверхности в точке удара. Всё — мелкими подшагами,
 * чтобы быстрый шар не пролетал сквозь борт (приём из «Ten Minute Physics», без сторонних библиотек).
 * Очки: грибки, рогатки, буквы дорожек сверху (все четыре — множитель бонуса), сбиваемые мишени (все — горит джекпот
 * в лунке), лунка (третья — мультибол), орбита; в конце шара — бонус × множитель. Три шара. */
export const TW = 600;
export const TH = 1100;
export const BALL_R = 11;
const G = 1500;
const SUB = 10;
const VMAX = 3200;
const E_WALL = 0.42;
const E_FLIP = 0.18;

export type Vec = [number, number];

export interface Wall {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  /** Рогатка: сила толчка от лица. */
  kick?: number;
  /** Односторонняя дверца: n — сторона, где она «закрыта» (шар с другой стороны проходит). */
  n?: Vec;
  /** Номер сбиваемой мишени. */
  target?: number;
  /** Номер рогатки (для огня). */
  sling?: number;
}

export interface Bumper {
  x: number;
  y: number;
  r: number;
}

export interface FlipperDef {
  x: number;
  y: number;
  len: number;
  /** Угол покоя и поднятый угол (рад, экранные: 0 — вправо, плюс — вниз). */
  rest: number;
  up: number;
  side: 'L' | 'R';
}

export interface TableDef {
  id: string;
  title: string;
  /** Буквы дорожек сверху. */
  word: string;
  walls: number[][];
  /** Круглые столбики [x, y, r]. */
  posts: [number, number, number][];
  bumpers: [number, number][];
  /** Сбиваемые мишени [ax, ay, bx, by]. */
  targets: [number, number, number, number][];
  saucer: { x: number; y: number; out: Vec };
  /** Орбита: датчик [x, y] — шар прошёл вверх. Лунка: out — скорость, с которой выплёвывает. */
  orbit?: Vec;
  flippers: FlipperDef[];
  /** Дорожки сверху: центры датчиков. */
  lanes: Vec[];
}

export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Держит лунка (с). */
  held: number;
}

export interface FlipperState {
  a: number;
  w: number;
}

export interface PbState {
  table: string;
  balls: Ball[];
  flips: FlipperState[];
  score: number;
  /** Номер шара (1…3 + призовые) и сколько осталось в запасе. */
  ball: number;
  left: number;
  bonus: number;
  mult: number;
  lanes: boolean[];
  targets: boolean[];
  jackpot: boolean;
  saucerCount: number;
  orbits: number;
  /** Шар в стартовом жёлобе ждёт пуска; сила натяжения 0…1. */
  plunger: number;
  inLane: boolean;
  /** Сколько ещё спасает шар (с); удар-мастерство: какая дорожка мигает при пуске. */
  save: number;
  /** Спасение ещё не тратилось на этом шаре. */
  saveArmed: boolean;
  skill: number;
  /** Подталкивания: счётчик предупреждений, когда последнее; TILT — шар пропал. */
  nudges: number;
  nudgeT: number;
  tilt: boolean;
  /** Огни: время вспышки грибков, рогаток. */
  bumpLit: number[];
  slingLit: number[];
  extra: boolean;
  t: number;
  /** Пауза между шарами (подсчёт бонуса). */
  wait: number;
  over: boolean;
  /** Сообщение на табло и сколько ему гореть. */
  msg: string;
  msgT: number;
}

export interface PbInput {
  l: boolean;
  r: boolean;
  /** Тянут пружину. */
  pull: boolean;
  /** Подтолкнуть стол (импульс, однократно). */
  nudge?: boolean;
}

export type PbEvent =
  | { k: 'bumper'; i: number }
  | { k: 'sling'; i: number }
  | { k: 'wall'; st: number }
  | { k: 'flip'; side: 'L' | 'R'; up: boolean }
  | { k: 'flipHit'; st: number }
  | { k: 'target'; i: number; all: boolean }
  | { k: 'lane'; i: number; all: boolean }
  | { k: 'saucer'; jackpot: boolean; multiball: boolean }
  | { k: 'orbit' }
  | { k: 'launch'; st: number }
  | { k: 'skill' }
  | { k: 'drain'; saved: boolean }
  | { k: 'bonus'; total: number }
  | { k: 'tilt' }
  | { k: 'warn' }
  | { k: 'extra' }
  | { k: 'over'; score: number };

// ---------------------------------------------------------------- каркас стола (общий)

/** Дуга ломаной: центр, радиус, углы (рад), число отрезков. */
export function arc(cx: number, cy: number, r: number, a0: number, a1: number, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  return out;
}

/** Отражение по центру поля (x → 568 − x): правая сторона повторяет левую. */
const MX = 568;
export const mirror = (pts: number[]) => pts.map((v, i) => (i % 2 ? v : MX - v));

const SHELL: number[][] = [
  // наружный борт: слева вверх, дугой поверх, справа вниз (правый край — наружная стенка жёлоба)
  [20, 1140, 20, 280, ...arc(300, 280, 280, Math.PI, Math.PI * 2, 32).slice(2, -2), 580, 280, 580, 1140],
  // внутренняя стенка стартового жёлоба
  [548, 1140, 548, 340],
  // упор пружины
  [548, 1052, 580, 1052],
  // направляющие к флипперам (слева и зеркально справа)
  [62, 820, 62, 920, 201, 974],
  mirror([62, 820, 62, 920, 201, 974]),
  // рогатки: боковая и нижняя стенки (лицо — отдельно, с толчком)
  [108, 800, 108, 900, 168, 935],
  mirror([108, 800, 108, 900, 168, 935]),
];
const SLINGS: [number, number, number, number][] = [
  [108, 800, 168, 935],
  [MX - 108, 800, MX - 168, 935],
];
const FLIPPERS: FlipperDef[] = [
  { x: 195, y: 985, len: 76, rest: 0.52, up: -0.42, side: 'L' },
  { x: MX - 195, y: 985, len: 76, rest: Math.PI - 0.52, up: Math.PI + 0.42, side: 'R' },
];
/** Дорожки сверху: перегородки и датчики. */
const LANE_X = [175, 235, 295, 355, 415];
const laneWalls = LANE_X.map((x) => [x, 128, x, 178]);
const laneSensors: Vec[] = LANE_X.slice(0, -1).map((x) => [x + 30, 160]);
const lanePosts: [number, number, number][] = LANE_X.map((x) => [x, 128, 5]);
/** Столбики у входа в «аут»: шар, катящийся по борту, отскакивает внутрь (но может и проскочить). */
const OUT_POSTS: [number, number, number][] = [
  [30, 780, 6],
  [MX - 30, 780, 6],
];

// ---------------------------------------------------------------- столы

export const TABLES: TableDef[] = [
  {
    id: 'park',
    title: 'Луна-парк',
    word: 'ПАРК',
    walls: [...SHELL, ...laneWalls, [20, 470, 34, 470], [20, 600, 34, 600]],
    posts: [...lanePosts, ...OUT_POSTS, [548, 340, 4], [300, 640, 9]],
    bumpers: [
      [225, 290],
      [365, 290],
      [295, 375],
    ],
    targets: [
      [36, 472, 36, 512],
      [36, 515, 36, 555],
      [36, 558, 36, 598],
    ],
    saucer: { x: 470, y: 480, out: [-430, 160] },
    flippers: FLIPPERS,
    lanes: laneSensors,
  },
  {
    id: 'disco',
    title: 'Дискотека',
    word: 'ДИСК',
    walls: [...SHELL, ...laneWalls],
    posts: [...lanePosts, ...OUT_POSTS, [548, 340, 4], [110, 380, 10], [460, 380, 10]],
    bumpers: [
      [210, 280],
      [380, 280],
      [295, 330],
      [295, 230],
    ],
    targets: [
      [226, 580, 262, 570],
      [264, 569, 300, 559],
      [302, 558, 338, 548],
    ],
    saucer: { x: 95, y: 520, out: [430, 160] },
    flippers: FLIPPERS,
    lanes: laneSensors,
  },
  {
    id: 'kosmos',
    title: 'Космос',
    word: 'ПУСК',
    walls: [...SHELL, ...laneWalls, [78, 760, 78, 340], [530, 470, 548, 470], [530, 600, 548, 600]],
    posts: [...lanePosts, ...OUT_POSTS, [548, 340, 4], [78, 760, 7], [78, 340, 6]],
    bumpers: [
      [235, 300],
      [370, 310],
      [300, 395],
    ],
    targets: [
      [532, 472, 532, 512],
      [532, 515, 532, 555],
      [532, 558, 532, 598],
    ],
    saucer: { x: 210, y: 540, out: [260, 260] },
    orbit: [49, 560],
    flippers: FLIPPERS,
    lanes: laneSensors,
  },
];

export const tableOf = (id: string) => TABLES.find((t) => t.id === id) ?? TABLES[0];

/** Все отрезки стола (стены, рогатки, дверца жёлоба), без мишеней. */
export function wallsOf(t: TableDef): Wall[] {
  const out: Wall[] = [];
  for (const pl of t.walls) for (let i = 0; i + 3 < pl.length; i += 2) out.push({ ax: pl[i], ay: pl[i + 1], bx: pl[i + 2], by: pl[i + 3] });
  SLINGS.forEach(([ax, ay, bx, by], i) => out.push({ ax, ay, bx, by, kick: 650, sling: i }));
  // дверца жёлоба: шар снизу проходит, сверху — скатывается на поле
  const d: Vec = [32, -30];
  const l = Math.hypot(d[0], d[1]);
  out.push({ ax: 548, ay: 340, bx: 580, by: 308, n: [d[1] / l, -d[0] / l] });
  return out;
}

const cache = new Map<string, Wall[]>();
const wallsCached = (t: TableDef) => {
  let w = cache.get(t.id);
  if (!w) cache.set(t.id, (w = wallsOf(t)));
  return w;
};

// ---------------------------------------------------------------- партия

export function newGame(table: string): PbState {
  const t = tableOf(table);
  const st: PbState = {
    table: t.id,
    balls: [],
    flips: t.flippers.map((f) => ({ a: f.rest, w: 0 })),
    score: 0,
    ball: 0,
    left: 3,
    bonus: 0,
    mult: 1,
    lanes: t.lanes.map(() => false),
    targets: t.targets.map(() => true),
    jackpot: false,
    saucerCount: 0,
    orbits: 0,
    plunger: 0,
    inLane: false,
    save: 0,
    saveArmed: true,
    skill: 0,
    nudges: 0,
    nudgeT: 0,
    tilt: false,
    bumpLit: t.bumpers.map(() => 0),
    slingLit: [0, 0],
    extra: false,
    t: 0,
    wait: 0,
    over: false,
    msg: '',
    msgT: 0,
  };
  nextBall(st);
  return st;
}

function say(st: PbState, msg: string, t = 2) {
  st.msg = msg;
  st.msgT = t;
}

function nextBall(st: PbState) {
  st.ball++;
  st.left--;
  st.bonus = 0;
  st.tilt = false;
  st.nudges = 0;
  st.balls = [laneBall()];
  st.inLane = true;
  st.plunger = 0;
  st.save = 0;
  st.saveArmed = true;
  st.skill = (st.ball * 7 + st.score) % 4;
  say(st, `ШАР ${st.ball}`);
}

const laneBall = (): Ball => ({ x: 564, y: 1052 - BALL_R - 0.5, vx: 0, vy: 0, held: 0 });

function add(st: PbState, pts: number, bonus = 0) {
  if (st.tilt) return;
  st.score += pts;
  st.bonus += bonus;
}

// ---------------------------------------------------------------- геометрия

function closest(px: number, py: number, ax: number, ay: number, bx: number, by: number): [number, number, number] {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return [ax + dx * t, ay + dy * t, t];
}

/** Отскок шара по нормали n с упругостью e и трением вдоль; vs — скорость поверхности. Возвращает силу удара. */
function bounce(b: Ball, nx: number, ny: number, e: number, vsx = 0, vsy = 0): number {
  const rvx = b.vx - vsx;
  const rvy = b.vy - vsy;
  const vn = rvx * nx + rvy * ny;
  if (vn >= 0) return 0;
  // чем слабее удар, тем меньше упругость: шар не дребезжит, лёжа на флиппере
  const ee = -vn < 60 ? 0 : e;
  b.vx -= (1 + ee) * vn * nx;
  b.vy -= (1 + ee) * vn * ny;
  return -vn;
}

export function flipperTip(f: FlipperDef, a: number): Vec {
  return [f.x + Math.cos(a) * f.len, f.y + Math.sin(a) * f.len];
}
const FLIP_R0 = 12;
const FLIP_R1 = 7;

// ---------------------------------------------------------------- шаг

const FLIP_W = 26;

/** Шаг партии на dt секунд (обычно 1/60), внутри — подшаги. */
export function step(st: PbState, inp: PbInput, dt: number): PbEvent[] {
  const ev: PbEvent[] = [];
  if (st.over) return ev;
  const t = tableOf(st.table);
  st.t += dt;
  if (st.msgT > 0) st.msgT -= dt;
  st.bumpLit = st.bumpLit.map((v) => Math.max(0, v - dt));
  st.slingLit = st.slingLit.map((v) => Math.max(0, v - dt));
  st.nudgeT = Math.max(0, st.nudgeT - dt);
  if (st.nudgeT <= 0) st.nudges = 0;

  // подсчёт бонуса между шарами
  if (st.wait > 0) {
    st.wait -= dt;
    if (st.wait <= 0) {
      if (st.left <= 0) {
        st.over = true;
        say(st, 'КОНЕЦ ИГРЫ', 99);
        ev.push({ k: 'over', score: st.score });
      } else nextBall(st);
    }
    return ev;
  }

  // флипперы: при TILT не работают
  t.flippers.forEach((f, i) => {
    const fs = st.flips[i];
    const want = !st.tilt && (f.side === 'L' ? inp.l : inp.r);
    const target = want ? f.up : f.rest;
    const d = target - fs.a;
    const sgn = Math.sign(d);
    const w = FLIP_W * (want ? 1 : 0.7);
    fs.w = Math.abs(d) < 1e-6 ? 0 : sgn * w;
    if (want && Math.abs(fs.a - f.rest) < 0.02 && Math.abs(d) > 0.1) ev.push({ k: 'flip', side: f.side, up: true });
  });
  // пружина
  if (st.inLane) {
    if (inp.pull) st.plunger = Math.min(1, st.plunger + dt * 1.1);
    else if (st.plunger > 0) {
      const b = st.balls.find((x) => x.x > 548 && x.y > 1000);
      if (b) {
        const p = st.plunger;
        b.vy = -(1050 + 1700 * p);
        ev.push({ k: 'launch', st: p });
        if (st.saveArmed) st.save = Math.max(st.save, 8);
      }
      st.plunger = 0;
    }
  }

  // подтолкнуть
  if (inp.nudge && !st.tilt) {
    st.nudges++;
    st.nudgeT = 3;
    for (const b of st.balls) {
      b.vx += (b.x < 284 ? 1 : -1) * 90;
      b.vy -= 160;
    }
    if (st.nudges >= 3) {
      st.tilt = true;
      st.jackpot = false;
      say(st, 'TILT', 3);
      ev.push({ k: 'tilt' });
    } else if (st.nudges === 2) {
      say(st, 'ОСТОРОЖНО', 1.5);
      ev.push({ k: 'warn' });
    }
  }

  const h = dt / SUB;
  const walls = wallsCached(t);
  let wallHit = 0;
  let flipHit = 0;
  for (let k = 0; k < SUB; k++) {
    // флипперы поворачиваются
    t.flippers.forEach((f, i) => {
      const fs = st.flips[i];
      const lo = Math.min(f.rest, f.up);
      const hi = Math.max(f.rest, f.up);
      fs.a += fs.w * h;
      if (fs.a <= lo) [fs.a, fs.w] = [lo, fs.w < 0 ? 0 : fs.w];
      if (fs.a >= hi) [fs.a, fs.w] = [hi, fs.w > 0 ? 0 : fs.w];
    });
    for (const b of st.balls) {
      if (b.held > 0) continue;
      b.vy += G * h;
      b.x += b.vx * h;
      b.y += b.vy * h;
      // стены, рогатки, дверца
      for (const w of walls) {
        const [cx, cy] = closest(b.x, b.y, w.ax, w.ay, w.bx, w.by);
        let dx = b.x - cx;
        let dy = b.y - cy;
        const d = Math.hypot(dx, dy);
        if (d >= BALL_R || d < 1e-9) continue;
        if (w.n && dx * w.n[0] + dy * w.n[1] < 0) continue;
        dx /= d;
        dy /= d;
        b.x = cx + dx * BALL_R;
        b.y = cy + dy * BALL_R;
        const s = bounce(b, dx, dy, E_WALL);
        if (w.kick != null && s > 40 && w.sling != null) {
          // рогатка бьёт только лицом (наружу от треугольника)
          b.vx += dx * w.kick;
          b.vy += dy * w.kick;
          st.slingLit[w.sling] = 0.15;
          add(st, 10, 10);
          ev.push({ k: 'sling', i: w.sling });
        } else wallHit = Math.max(wallHit, s);
      }
      // сбиваемые мишени
      t.targets.forEach((tg, i) => {
        if (!st.targets[i]) return;
        const [cx, cy] = closest(b.x, b.y, tg[0], tg[1], tg[2], tg[3]);
        let dx = b.x - cx;
        let dy = b.y - cy;
        const d = Math.hypot(dx, dy);
        if (d >= BALL_R + 3 || d < 1e-9) return;
        dx /= d;
        dy /= d;
        b.x = cx + dx * (BALL_R + 3);
        b.y = cy + dy * (BALL_R + 3);
        bounce(b, dx, dy, 0.3);
        st.targets[i] = false;
        add(st, 250, 50);
        const all = st.targets.every((x) => !x);
        if (all) {
          add(st, 5000, 500);
          st.jackpot = true;
          say(st, 'ДЖЕКПОТ ГОРИТ');
          st.targets = st.targets.map(() => true);
        }
        ev.push({ k: 'target', i, all });
      });
      // столбики
      for (const [px, py, pr] of t.posts) {
        let dx = b.x - px;
        let dy = b.y - py;
        const d = Math.hypot(dx, dy);
        const R = BALL_R + pr;
        if (d >= R || d < 1e-9) continue;
        dx /= d;
        dy /= d;
        b.x = px + dx * R;
        b.y = py + dy * R;
        wallHit = Math.max(wallHit, bounce(b, dx, dy, 0.5));
      }
      // грибки: толкают шар от себя
      t.bumpers.forEach(([px, py], i) => {
        let dx = b.x - px;
        let dy = b.y - py;
        const d = Math.hypot(dx, dy);
        const R = BALL_R + 26;
        if (d >= R || d < 1e-9) return;
        dx /= d;
        dy /= d;
        b.x = px + dx * R;
        b.y = py + dy * R;
        bounce(b, dx, dy, 0.2);
        const vn = b.vx * dx + b.vy * dy;
        const kick = 850;
        if (vn < kick) {
          b.vx += dx * (kick - vn);
          b.vy += dy * (kick - vn);
        }
        if (st.bumpLit[i] < 0.08) {
          st.bumpLit[i] = 0.18;
          add(st, 100, 20);
          ev.push({ k: 'bumper', i });
        }
      });
      // флипперы: капсула от оси к концу, радиус сужается
      t.flippers.forEach((f, i) => {
        const fs = st.flips[i];
        const [tx, ty] = flipperTip(f, fs.a);
        const [cx, cy, u] = closest(b.x, b.y, f.x, f.y, tx, ty);
        const fr = FLIP_R0 + (FLIP_R1 - FLIP_R0) * u;
        let dx = b.x - cx;
        let dy = b.y - cy;
        const d = Math.hypot(dx, dy);
        if (d >= BALL_R + fr || d < 1e-9) return;
        dx /= d;
        dy /= d;
        b.x = cx + dx * (BALL_R + fr);
        b.y = cy + dy * (BALL_R + fr);
        // скорость поверхности флиппера в точке касания: ω × r
        const rx = cx + dx * fr - f.x;
        const ry = cy + dy * fr - f.y;
        const vsx = -fs.w * ry;
        const vsy = fs.w * rx;
        flipHit = Math.max(flipHit, bounce(b, dx, dy, E_FLIP, vsx, vsy));
      });
      const v = Math.hypot(b.vx, b.vy);
      if (v > VMAX) {
        b.vx *= VMAX / v;
        b.vy *= VMAX / v;
      }
    }
  }
  if (wallHit > 250) ev.push({ k: 'wall', st: Math.round(wallHit) });
  if (flipHit > 150) ev.push({ k: 'flipHit', st: Math.round(flipHit) });

  // датчики: дорожки, лунка, орбита, жёлоб, сток
  if (st.save > 0 && !st.inLane) st.save -= dt;
  for (const b of st.balls) {
    if (b.held > 0) {
      b.held -= dt;
      if (b.held <= 0) {
        b.x = t.saucer.x + Math.sign(t.saucer.out[0]) * 4;
        b.y = t.saucer.y;
        b.vx = t.saucer.out[0];
        b.vy = t.saucer.out[1];
        (b as Ball & { cool?: number }).cool = 0.6;
      }
      continue;
    }
    const bb = b as Ball & { cool?: number; lane?: number; orb?: number };
    if (bb.cool) bb.cool = Math.max(0, bb.cool - dt);
    if (bb.orb) bb.orb = Math.max(0, bb.orb - dt);
    t.lanes.forEach(([lx, ly], i) => {
      if (Math.abs(b.x - lx) < 18 && Math.abs(b.y - ly) < 14 && bb.lane !== i) {
        bb.lane = i;
        const skill = st.save > 6 && i === st.skill && st.balls.length === 1;
        if (skill) {
          add(st, 5000);
          say(st, 'МАСТЕРСКИЙ ПУСК');
          ev.push({ k: 'skill' });
        }
        if (!st.lanes[i]) {
          st.lanes[i] = true;
          add(st, 500, 100);
        } else add(st, 100, 20);
        const all = st.lanes.every(Boolean);
        if (all) {
          st.lanes = st.lanes.map(() => false);
          if (st.mult < 5) st.mult++;
          say(st, `БОНУС ×${st.mult}`);
          if (st.mult === 5 && !st.extra) {
            st.extra = true;
            st.left++;
            say(st, 'ПРИЗОВОЙ ШАР');
            ev.push({ k: 'extra' });
          }
        }
        ev.push({ k: 'lane', i, all });
      }
    });
    if (b.y > 230) bb.lane = -1;
    // лунка: ловит, держит и выплёвывает
    const sx = b.x - t.saucer.x;
    const sy = b.y - t.saucer.y;
    if (!bb.cool && sx * sx + sy * sy < 13 * 13) {
      b.held = 1.1;
      b.vx = 0;
      b.vy = 0;
      b.x = t.saucer.x;
      b.y = t.saucer.y;
      st.saucerCount++;
      const jackpot = st.jackpot;
      if (jackpot) {
        st.jackpot = false;
        add(st, 25000, 1000);
        say(st, 'ДЖЕКПОТ!');
      } else add(st, 1000, 200);
      const multiball = st.saucerCount % 3 === 0 && st.balls.length === 1 && !st.tilt;
      if (multiball) {
        say(st, 'МУЛЬТИБОЛ!');
        st.balls.push(laneBall());
        st.balls[st.balls.length - 1].vy = -2400;
        st.save = Math.max(st.save, 10);
      }
      ev.push({ k: 'saucer', jackpot, multiball });
    }
    if (t.orbit) {
      if (!bb.orb && Math.abs(b.x - t.orbit[0]) < 26 && Math.abs(b.y - t.orbit[1]) < 20 && b.vy < -300) {
        bb.orb = 1;
        st.orbits++;
        add(st, 2000 * Math.min(4, st.orbits), 300);
        say(st, `ОРБИТА ${st.orbits}`, 1.5);
        ev.push({ k: 'orbit' });
      }
    }
  }
  st.inLane = st.balls.some((b) => b.x > 548 && b.y > 980 && Math.abs(b.vy) < 30);

  // «поиск шара», как у настоящих автоматов: шар замер не в жёлобе и не на поднятом флиппере — стол его толкает
  for (const b of st.balls) {
    const bb = b as Ball & { still?: number };
    const onFlip = (inp.l || inp.r) && b.y > 900;
    if (b.held > 0 || b.x > 548 || onFlip || Math.hypot(b.vx, b.vy) > 40) bb.still = 0;
    else bb.still = (bb.still ?? 0) + dt;
    if ((bb.still ?? 0) > 4) {
      bb.still = 0;
      b.vx = b.x < 284 ? 380 : -380;
      b.vy = -520;
      ev.push({ k: 'wall', st: 400 });
    }
  }

  // сток
  const drained = st.balls.filter((b) => b.y > TH + 40);
  if (drained.length) {
    st.balls = st.balls.filter((b) => b.y <= TH + 40);
    for (let i = 0; i < drained.length; i++) {
      if (!st.balls.length && st.save > 0 && !st.tilt) {
        // спасение шара: обратно в жёлоб
        st.balls.push(laneBall());
        say(st, 'ШАР СПАСЁН');
        st.save = 0;
        st.saveArmed = false;
        ev.push({ k: 'drain', saved: true });
      } else if (!st.balls.length) {
        const total = st.tilt ? 0 : st.bonus * st.mult;
        st.score += total;
        st.lanes = st.lanes.map(() => false);
        st.mult = 1;
        st.jackpot = false;
        st.wait = 2.2;
        say(st, st.tilt ? 'TILT' : `БОНУС ${total}`, 2.2);
        ev.push({ k: 'drain', saved: false });
        ev.push({ k: 'bonus', total });
      }
    }
  }
  return ev;
}

/** Смена горящих дорожек флиппером (как на настоящих столах): сдвиг по кругу. */
export function laneShift(st: PbState, dir: -1 | 1) {
  if (st.tilt || st.over) return;
  const n = st.lanes.length;
  st.lanes = st.lanes.map((_, i) => st.lanes[(i - dir + n) % n]);
}
