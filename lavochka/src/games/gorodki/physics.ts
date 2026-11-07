/* Физика броска (без DOM): бита летит над площадкой, падает, скользит и крутится; городки (рюхи) — цилиндры 20×5 см,
 * лежачие катятся поперёк оси и тормозят вдоль неё, стоячие падают от толчка. Модель «2,5D»: столкновения — в плоскости площадки
 * (капсулы), высота — для полёта, подскоков и того, кто кого может задеть (бита над рюхами пролетает).
 * Единицы — метры и секунды. Ось y — от бросающего к городу: лицевая линия города y = 0, город — квадрат x ∈ [−1, 1], y ∈ [0, 2].
 * Расчёт детерминированный: один бросок у сервера и у всех игроков даёт одно и то же (шаг постоянный, без случайности). */

export const G = 9.81;
/** Рюха: половина длины, радиус, масса (берёза). */
export const RH = 0.1;
export const RR = 0.025;
export const RM = 0.26;
/** Бита: половина длины, радиус, масса. */
export const BH = 0.42;
export const BR = 0.032;
export const BM = 1.6;
/** Город и линии. */
export const CITY = 1;
export const CITY_D = 2;

export interface Rod {
  x: number;
  y: number;
  /** Высота центра (лежачая на земле — радиус, стоячая — 0 у основания). */
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Угол оси в плоскости площадки (от оси x) и скорость вращения. */
  a: number;
  w: number;
  /** Поворот вокруг своей оси (для показа: катится). */
  roll: number;
  /** Стоит торчком. */
  stand: boolean;
  h: number;
  r: number;
  m: number;
}

export interface Throw {
  /** Где стоит бросающий вдоль линии, м (−1,5…1,5). */
  x: number;
  /** Направление броска, рад (0 — прямо на город, плюс — вправо). */
  ang: number;
  /** Сила 0…1. */
  pow: number;
  /** Вращение −1…1 (пропеллер; знак — в какую сторону). */
  spin: number;
  /** Торцом вперёд («копьём») — иначе плашмя, поперёк полёта. */
  end?: boolean;
}

export interface Frame {
  t: number;
  /** Бита и рюхи: x, y, z, a, roll, стоит(1/0). */
  p: number[][];
}

export interface Hit {
  t: number;
  v: number;
  /** 'bat' — бита по рюхе, 'rod' — рюха о рюху, 'ground' — бита о землю. */
  k: 'bat' | 'rod' | 'ground';
}

export interface SimResult {
  bat: Rod;
  rods: Rod[];
  frames: Frame[];
  hits: Hit[];
  /** Где бита первый раз коснулась земли (null — не коснулась до остановки). */
  land: { x: number; y: number } | null;
  /** Чего бита коснулась раньше: земли или рюхи. */
  firstTouch: 'ground' | 'rod' | null;
  /** Касания за бросок: пары номеров рюх (−1 — бита). */
  contacts: [number, number][];
  /** Рюха хоть раз целиком покидала город и пригород (вернувшаяся всё равно выбита). */
  left: boolean[];
}

const DT = 1 / 600;
const MAX_T = 7;
const FRAME_DT = 1 / 60;
const len = (x: number, y: number) => Math.sqrt(x * x + y * y);

export const speedOf = (pow: number) => 6 + Math.max(0, Math.min(1, pow)) * 12;
export const LOFT = 0.17;
export const RELEASE_Z = 1.15;

/** Бита в момент выпуска с линии lineY (отрицательная: кон −13, полукон −6,5). */
export function launch(t: Throw, lineY: number): Rod {
  const v = speedOf(t.pow);
  const c = Math.cos(LOFT);
  const sa = Math.sin(t.ang);
  const ca = Math.cos(t.ang);
  const a = t.end ? Math.PI / 2 - t.ang : -t.ang;
  return {
    x: t.x + sa * 0.4,
    y: lineY + ca * 0.4,
    z: RELEASE_Z,
    vx: v * c * sa,
    vy: v * c * ca,
    vz: v * Math.sin(LOFT),
    a,
    w: Math.max(-1, Math.min(1, t.spin)) * 13,
    roll: 0,
    stand: false,
    h: BH,
    r: BR,
    m: BM,
  };
}

/** Ближайшие точки двух отрезков P1Q1 и P2Q2: параметры s, t ∈ [0, 1]. */
function closest(px: number, py: number, dx1: number, dy1: number, qx: number, qy: number, dx2: number, dy2: number): [number, number] {
  const rx = px - qx;
  const ry = py - qy;
  const a = dx1 * dx1 + dy1 * dy1;
  const e = dx2 * dx2 + dy2 * dy2;
  const f = dx2 * rx + dy2 * ry;
  const clamp = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
  if (a <= 1e-12 && e <= 1e-12) return [0, 0];
  if (a <= 1e-12) return [0, clamp(f / e)];
  const c = dx1 * rx + dy1 * ry;
  if (e <= 1e-12) return [clamp(-c / a), 0];
  const b = dx1 * dx2 + dy1 * dy2;
  const den = a * e - b * b;
  let s = den > 1e-12 ? clamp((b * f - c * e) / den) : 0;
  let t = (b * s + f) / e;
  if (t < 0) {
    t = 0;
    s = clamp(-c / a);
  } else if (t > 1) {
    t = 1;
    s = clamp((b - c) / a);
  }
  return [s, t];
}

/** Отрезок оси (концы) в плоскости: стоячая — точка. */
function seg(b: Rod): [number, number, number, number] {
  if (b.stand) return [b.x, b.y, 0, 0];
  const ux = Math.cos(b.a) * (b.h - b.r);
  const uy = Math.sin(b.a) * (b.h - b.r);
  return [b.x - ux, b.y - uy, 2 * ux, 2 * uy];
}

/** Высота по вертикали: [низ, верх]. */
function span(b: Rod): [number, number] {
  return b.stand ? [b.z, b.z + 2 * b.h] : [b.z - b.r, b.z + b.r];
}

const inertia = (b: Rod) => (b.stand ? Infinity : (b.m * (4 * b.h * b.h)) / 12 + (b.m * b.r * b.r) / 4);

function onGround(b: Rod) {
  return b.stand ? b.z <= 1e-4 : b.z <= b.r + 0.002;
}

/** Опрокинуть стоячую рюху в сторону толчка. */
function topple(b: Rod) {
  const v = len(b.vx, b.vy);
  const dx = v > 1e-6 ? b.vx / v : 0;
  const dy = v > 1e-6 ? b.vy / v : 1;
  b.stand = false;
  b.a = Math.atan2(dy, dx);
  b.x += dx * b.h * 0.9;
  b.y += dy * b.h * 0.9;
  b.z = b.r + 0.12;
  b.vz = Math.max(b.vz, 0.6);
  b.w += (dx >= 0 ? 1 : -1) * 2;
}

/** Столкнуть два тела, если касаются. Возвращает силу удара (0 — не касались). */
function collide(A: Rod, B: Rod, e: number): number {
  const [la, ha] = span(A);
  const [lb, hb] = span(B);
  if (la > hb || lb > ha) return 0;
  const [ax, ay, adx, ady] = seg(A);
  const [bx, by, bdx, bdy] = seg(B);
  const [s, t] = closest(ax, ay, adx, ady, bx, by, bdx, bdy);
  const pax = ax + adx * s;
  const pay = ay + ady * s;
  const pbx = bx + bdx * t;
  const pby = by + bdy * t;
  let nx = pbx - pax;
  let ny = pby - pay;
  let d = len(nx, ny);
  const R = A.r + B.r;
  if (d >= R) return 0;
  if (d < 1e-6) {
    nx = B.x - A.x;
    ny = B.y - A.y;
    d = len(nx, ny);
    if (d < 1e-6) (nx = 0), (ny = 1), (d = 1);
    nx /= d;
    ny /= d;
    d = 0;
  } else {
    nx /= d;
    ny /= d;
  }
  // точка касания и плечи
  const cx = pax + nx * A.r;
  const cy = pay + ny * A.r;
  const rax = cx - A.x;
  const ray = cy - A.y;
  const rbx = cx - B.x;
  const rby = cy - B.y;
  const IA = inertia(A);
  const IB = inertia(B);
  const vax = A.vx - A.w * ray;
  const vay = A.vy + A.w * rax;
  const vbx = B.vx - B.w * rby;
  const vby = B.vy + B.w * rbx;
  const vn = (vbx - vax) * nx + (vby - vay) * ny;
  // раздвинуть
  const pen = R - d;
  const ima = 1 / A.m;
  const imb = 1 / B.m;
  const k = (pen * 0.85) / (ima + imb);
  A.x -= nx * k * ima;
  A.y -= ny * k * ima;
  B.x += nx * k * imb;
  B.y += ny * k * imb;
  if (vn >= 0) return 0;
  const ca = rax * ny - ray * nx;
  const cb = rbx * ny - rby * nx;
  const den = ima + imb + (IA === Infinity ? 0 : (ca * ca) / IA) + (IB === Infinity ? 0 : (cb * cb) / IB);
  const j = (-(1 + e) * vn) / den;
  A.vx -= nx * j * ima;
  A.vy -= ny * j * ima;
  B.vx += nx * j * imb;
  B.vy += ny * j * imb;
  if (IA !== Infinity) A.w -= (ca * j) / IA;
  if (IB !== Infinity) B.w += (cb * j) / IB;
  // трение по касательной — немного «закручивает»
  const tx = -ny;
  const ty = nx;
  const vt = (vbx - vax) * tx + (vby - vay) * ty;
  const jt = Math.max(-0.25 * j, Math.min(0.25 * j, -vt / den));
  A.vx -= tx * jt * ima;
  A.vy -= ty * jt * ima;
  B.vx += tx * jt * imb;
  B.vy += ty * jt * imb;
  // сильный удар подбрасывает рюху
  const dv = -vn;
  if (!B.stand && B.m < 1 && dv > 2) B.vz = Math.max(B.vz, Math.min(2.6, dv * 0.18));
  if (!A.stand && A.m < 1 && dv > 2) A.vz = Math.max(A.vz, Math.min(2.6, dv * 0.18));
  // стоячая от толчка падает
  if (A.stand && len(A.vx, A.vy) > 0.25) topple(A);
  if (B.stand && len(B.vx, B.vy) > 0.25) topple(B);
  if (A.stand) (A.vx = 0), (A.vy = 0);
  if (B.stand) (B.vx = 0), (B.vy = 0);
  return dv;
}

/** Шаг одного тела: полёт, земля, трение. */
function move(b: Rod, bat: boolean, onLand?: (v: number) => void) {
  if (b.stand) return;
  const ground = onGround(b);
  if (!ground || b.vz > 0) {
    b.vz -= G * DT;
    b.z += b.vz * DT;
    if (b.z <= b.r) {
      b.z = b.r;
      if (b.vz < 0) {
        const hitV = -b.vz;
        onLand?.(hitV);
        b.vz = hitV > 0.6 ? hitV * (bat ? 0.22 : 0.3) : 0;
        // удар о землю гасит часть скорости
        const keep = bat ? 0.72 : 0.9;
        b.vx *= keep;
        b.vy *= keep;
        b.w *= bat ? 0.85 : 0.9;
      }
    }
  }
  if (onGround(b) && b.vz <= 0) {
    // вдоль оси — скольжение, поперёк — качение
    const ux = Math.cos(b.a);
    const uy = Math.sin(b.a);
    let along = b.vx * ux + b.vy * uy;
    let across = -b.vx * uy + b.vy * ux;
    const fa = (bat ? 5.5 : 4.2) * DT;
    const fc = (bat ? 4.5 : 1.4) * DT;
    along = Math.abs(along) <= fa ? 0 : along - Math.sign(along) * fa;
    const prevAcross = across;
    across = Math.abs(across) <= fc ? 0 : across - Math.sign(across) * fc;
    b.vx = along * ux - across * uy;
    b.vy = along * uy + across * ux;
    b.roll += (prevAcross / b.r) * DT;
    const fw = (bat ? 7 : 14) * DT;
    b.w = Math.abs(b.w) <= fw ? 0 : b.w - Math.sign(b.w) * fw;
  }
  b.x += b.vx * DT;
  b.y += b.vy * DT;
  b.a += b.w * DT;
  // отбойник за городом и низкие борта по бокам (доски — по пояс, через них не перелетают низом)
  if (b.z < 0.9) {
    if (b.y > WALL_Y - b.r && b.vy > 0) {
      b.y = WALL_Y - b.r;
      b.vy = -b.vy * 0.3;
      b.w *= 0.6;
    }
    if (b.y > SIDE_Y0 && b.z < 0.5 && Math.abs(b.x) > SIDE_X - b.r && b.x * b.vx > 0) {
      b.x = Math.sign(b.x) * (SIDE_X - b.r);
      b.vx = -b.vx * 0.3;
    }
  }
}

/** Отбойник за городом и боковые борта (как на 3D-площадке). */
export const WALL_Y = 5.14;
export const SIDE_X = 3.44;
export const SIDE_Y0 = -0.6;

const still = (b: Rod) => b.stand || (onGround(b) && b.vz <= 0 && len(b.vx, b.vy) < 0.01 && Math.abs(b.w) < 0.05);

/** Прогнать бросок до остановки. Исходные тела не меняются. */
export function simulate(bat0: Rod, rods0: Rod[], withFrames = true): SimResult {
  const bat = { ...bat0 };
  const rods = rods0.map((r) => ({ ...r }));
  const all = [bat, ...rods];
  const frames: Frame[] = [];
  const hits: Hit[] = [];
  let land: SimResult['land'] = null;
  let firstTouch: SimResult['firstTouch'] = null;
  const snap = (t: number) => {
    if (withFrames) frames.push({ t, p: all.map((b) => [b.x, b.y, b.z, b.a, b.roll, b.stand ? 1 : 0]) });
  };
  snap(0);
  let nextFrame = FRAME_DT;
  let t = 0;
  let lastHit = -1;
  const contacts: [number, number][] = [];
  const seen = new Set<number>();
  const touch = (i: number, j: number) => {
    const key = (i + 1) * 64 + (j + 1);
    if (!seen.has(key)) seen.add(key), contacts.push([i, j]);
  };
  const left = rods.map(() => false);
  let step = 0;
  for (; t < MAX_T; t += DT, step++) {
    move(bat, true, (v) => {
      if (!land) land = { x: bat.x, y: bat.y };
      if (!firstTouch) firstTouch = 'ground';
      if (v > 0.8) hits.push({ t, v, k: 'ground' });
    });
    for (const r of rods) move(r, false);
    for (let i = 0; i < rods.length; i++) {
      const r = rods[i];
      const v = collide(bat, r, 0.42);
      if (v > 0) {
        touch(-1, i);
        if (!firstTouch) firstTouch = 'rod';
        if (t - lastHit > 0.03 || v > 1) hits.push({ t, v, k: 'bat' });
        lastHit = t;
      }
    }
    for (let i = 0; i < rods.length; i++)
      for (let j = i + 1; j < rods.length; j++) {
        const v = collide(rods[i], rods[j], 0.5);
        if (v > 0) touch(i, j);
        if (v > 0.4 && t - lastHit > 0.02) {
          hits.push({ t, v, k: 'rod' });
          lastHit = t;
        }
      }
    if (step % 8 === 0) for (let i = 0; i < rods.length; i++) if (!left[i] && !inZone(rods[i])) left[i] = true;
    if (t >= nextFrame) {
      snap(t);
      nextFrame += FRAME_DT;
    }
    // всё замерло (или бита улетела далеко за город)
    if (t > 0.3 && all.every((b) => still(b) || len(b.x, b.y - 1) > 14)) break;
  }
  snap(t);
  if (!land && onGround(bat)) land = { x: bat.x, y: bat.y };
  for (let i = 0; i < rods.length; i++) if (!left[i] && !inZone(rods[i])) left[i] = true;
  return { bat, rods, frames, hits, land, firstTouch, contacts, left };
}

/** Город и пригород одним многоугольником (по часовой): пригород — трапеция глубиной 1 м перед лицевой линией,
 * боковые стороны — продолжения диагоналей города, до штрафной линии y = −1. */
export const ZONE: [number, number][] = [
  [-1, 2],
  [1, 2],
  [1, 0],
  [2, -1],
  [-2, -1],
  [-1, 0],
];
export const CITY_POLY: [number, number][] = [
  [-1, 2],
  [1, 2],
  [1, 0],
  [-1, 0],
];

/** Расстояние от точки до многоугольника (0 — внутри или на краю). */
export function distPoly(poly: [number, number][], x: number, y: number): number {
  let inside = false;
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    const ex = xj - xi;
    const ey = yj - yi;
    const k = Math.max(0, Math.min(1, ((x - xi) * ex + (y - yi) * ey) / (ex * ex + ey * ey)));
    best = Math.min(best, len(x - xi - ex * k, y - yi - ey * k));
  }
  return inside ? 0 : best;
}

function touchesPoly(b: Rod, poly: [number, number][]): boolean {
  const [x0, y0, dx, dy] = seg(b);
  const n = b.stand ? 0 : 12;
  for (let i = 0; i <= n; i++) {
    const k = n ? i / n : 0;
    if (distPoly(poly, x0 + dx * k, y0 + dy * k) <= b.r) return true;
  }
  return false;
}

/** Рюха хоть краем в городе или пригороде (на линии — тоже). Целиком вышла — выбита. */
export const inZone = (b: Rod) => touchesPoly(b, ZONE);
/** Рюха хоть краем в городе (квадрате). */
export const inCity = (b: Rod) => touchesPoly(b, CITY_POLY);

/** Новая рюха: лежит (угол a) или стоит. */
export function rod(x: number, y: number, a: number, stand = false): Rod {
  return { x, y, z: stand ? 0 : RR, vx: 0, vy: 0, vz: 0, a, w: 0, roll: 0, stand, h: RH, r: RR, m: RM };
}

/** Где бита впервые коснётся земли (по полёту, без столкновений): y вдоль площадки. */
export function landY(pow: number, ang: number, lineY: number): number {
  const v = speedOf(pow);
  const vz = v * Math.sin(LOFT);
  const t = (vz + Math.sqrt(vz * vz + 2 * G * (RELEASE_Z - BR))) / G;
  return lineY + Math.cos(ang) * (0.4 + v * Math.cos(LOFT) * t);
}

/** Сила, с которой бита приземлится на y (по прямой ang). */
export function powFor(y: number, ang: number, lineY: number): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 30; i++) {
    const m = (lo + hi) / 2;
    if (landY(m, ang, lineY) < y) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}
