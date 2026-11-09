/* Дворовый спорт — простая физика тел (без DOM: её гоняют сервер, боты и тесты). Мяч, чиж, палка, камешек — точка
 * с радиусом: полёт с гравитацией и сопротивлением воздуха, отскок от земли с потерей скорости, катание с трением,
 * отскок от стенок двора (по желанию). Оси игры: x — вбок, y — вглубь поля, z — вверх; метры и секунды.
 * Расчёт детерминированный: постоянный шаг, без случайности — один удар у сервера и у всех игроков даёт одно и то же.
 * Городки считают биту и рюхи своей физикой (капсулы, games/gorodki/physics.ts) — здесь только общее для мяча и чижа. */

export const G = 9.81;

export interface Body {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Радиус, м (мяч для лапты ~0,035, теннисный ~0,033, чиж — половина толщины ~0,015). */
  r: number;
  /** Угол поворота для показа (рад) и скорость вращения (рад/с): чиж и палка крутятся в полёте. */
  a: number;
  w: number;
}

/** Материал тела и земли. */
export interface BodyMat {
  /** Отскок по вертикали (0 — шлёп, 0,7 — резиновый мяч). */
  bounce: number;
  /** Потеря горизонтальной скорости при ударе о землю (доля). */
  scrub: number;
  /** Трение качения/скольжения по земле, м/с² (≈ μ·g). */
  roll: number;
  /** Сопротивление воздуха: dv/dt = −k·|v|·v. */
  drag: number;
  /** Затухание вращения на земле (доля в секунду). */
  spinDamp: number;
}

export const MAT = {
  /** Резиновый мяч лапты по утоптанной земле. */
  ball: { bounce: 0.55, scrub: 0.25, roll: 1.6, drag: 0.012, spinDamp: 3 },
  /** Чиж — короткая палочка с заточенными концами: почти не прыгает, быстро встаёт. */
  chizh: { bounce: 0.25, scrub: 0.5, roll: 4.5, drag: 0.02, spinDamp: 6 },
  /** Палка (бита пекаря) — тяжёлая, скользит. */
  stick: { bounce: 0.2, scrub: 0.45, roll: 3.5, drag: 0.004, spinDamp: 4 },
} satisfies Record<string, BodyMat>;

/** Стенки двора (прямоугольник по x, y; отскок с потерей wall). */
export interface Walls {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  wall: number;
}

export interface FlyOpts {
  mat: BodyMat;
  walls?: Walls;
  /** Предел по времени, с. */
  maxT?: number;
  /** Шаг кадров для показа, с (0 — без кадров: боты и сервер). */
  frameDt?: number;
  /** Остановить раньше: true — хватит (например, мяч пойман). Зовётся на каждом шаге. */
  stop?: (b: Body, t: number) => boolean;
}

/** Кадр полёта для показа: t, x, y, z, a. */
export type BodyFrame = [number, number, number, number, number];

export interface BodyHit {
  t: number;
  /** Скорость удара, м/с (для громкости). */
  v: number;
  k: 'ground' | 'wall';
  x: number;
  y: number;
}

export interface FlyResult {
  body: Body;
  frames: BodyFrame[];
  hits: BodyHit[];
  /** Где первый раз коснулся земли (null — не коснулся). */
  land: { x: number; y: number; t: number } | null;
  /** Время, когда остановился (или maxT / stop). */
  t: number;
  /** Остановился сам (лежит). */
  rest: boolean;
}

export const DT = 1 / 600;

export const body = (x: number, y: number, z: number, r: number): Body => ({ x, y, z, vx: 0, vy: 0, vz: 0, r, a: 0, w: 0 });

/** Скорость по силе удара, направлению в плоскости (yaw: 0 — вглубь поля +y, плюс — вправо +x) и углу вверх (pitch). */
export function kick(b: Body, speed: number, yaw: number, pitch: number, spin = 0): Body {
  const c = Math.cos(pitch);
  return { ...b, vx: speed * c * Math.sin(yaw), vy: speed * c * Math.cos(yaw), vz: speed * Math.sin(pitch), w: spin };
}

/** Один шаг (меняет тело на месте). Возвращает удар, если был. */
export function step(b: Body, dt: number, mat: BodyMat, walls?: Walls): BodyHit | null {
  let hit: BodyHit | null = null;
  const onGround = b.z <= b.r + 1e-4 && Math.abs(b.vz) < 0.05;
  if (onGround) {
    b.z = b.r;
    b.vz = 0;
    const v = Math.hypot(b.vx, b.vy);
    const dv = mat.roll * dt;
    if (v <= dv) b.vx = b.vy = 0;
    else {
      b.vx -= (b.vx / v) * dv;
      b.vy -= (b.vy / v) * dv;
    }
    b.w *= Math.max(0, 1 - mat.spinDamp * dt);
  } else {
    const v = Math.hypot(b.vx, b.vy, b.vz);
    const k = mat.drag * v * dt;
    b.vx -= b.vx * k;
    b.vy -= b.vy * k;
    b.vz -= b.vz * k + G * dt;
  }
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  b.z += b.vz * dt;
  b.a += b.w * dt;
  if (b.z < b.r) {
    const v = -b.vz;
    b.z = b.r;
    b.vz = v * mat.bounce;
    // маленький подскок гасим — тело ложится и катится
    if (b.vz < 0.4) b.vz = 0;
    b.vx *= 1 - mat.scrub;
    b.vy *= 1 - mat.scrub;
    b.w *= 1 - mat.scrub;
    if (v > 0.3) hit = { t: 0, v, k: 'ground', x: b.x, y: b.y };
  }
  if (walls) {
    const e = walls.wall;
    const wall = (v: number): BodyHit => ({ t: 0, v: Math.abs(v), k: 'wall', x: b.x, y: b.y });
    if (b.x < walls.x0 + b.r && b.vx < 0) (hit = wall(b.vx)), (b.x = walls.x0 + b.r), (b.vx = -b.vx * e);
    if (b.x > walls.x1 - b.r && b.vx > 0) (hit = wall(b.vx)), (b.x = walls.x1 - b.r), (b.vx = -b.vx * e);
    if (b.y < walls.y0 + b.r && b.vy < 0) (hit = wall(b.vy)), (b.y = walls.y0 + b.r), (b.vy = -b.vy * e);
    if (b.y > walls.y1 - b.r && b.vy > 0) (hit = wall(b.vy)), (b.y = walls.y1 - b.r), (b.vy = -b.vy * e);
  }
  return hit;
}

/** Лежит неподвижно. */
export const atRest = (b: Body) => b.z <= b.r + 1e-4 && b.vz === 0 && b.vx === 0 && b.vy === 0;

/** Полёт до остановки (или maxT / stop): кадры для показа, удары для звука, место первого касания. */
export function fly(b0: Body, o: FlyOpts): FlyResult {
  const b = { ...b0 };
  const maxT = o.maxT ?? 8;
  const fdt = o.frameDt ?? 1 / 60;
  const frames: BodyFrame[] = fdt > 0 ? [[0, b.x, b.y, b.z, b.a]] : [];
  const hits: BodyHit[] = [];
  let land: FlyResult['land'] = null;
  let t = 0;
  let nextF = fdt;
  let rest = false;
  const n = Math.ceil(maxT / DT);
  for (let i = 1; i <= n; i++) {
    t = i * DT;
    const h = step(b, DT, o.mat, o.walls);
    if (h) {
      h.t = t;
      hits.push(h);
      if (h.k === 'ground' && !land) land = { x: h.x, y: h.y, t };
    }
    if (!land && b.z <= b.r + 1e-4 && b0.z > b0.r + 1e-4) land = { x: b.x, y: b.y, t };
    if (fdt > 0 && t >= nextF - 1e-9) {
      frames.push([t, b.x, b.y, b.z, b.a]);
      nextF += fdt;
    }
    if (atRest(b)) {
      rest = true;
      break;
    }
    if (o.stop?.(b, t)) break;
  }
  if (fdt > 0 && frames[frames.length - 1][0] < t) frames.push([t, b.x, b.y, b.z, b.a]);
  return { body: b, frames, hits, land, t, rest };
}

/** Положение по кадрам в момент t (линейно между кадрами) — для показа. */
export function sample(frames: BodyFrame[], t: number): BodyFrame {
  if (!frames.length) return [t, 0, 0, 0, 0];
  if (t <= frames[0][0]) return frames[0];
  let lo = 0;
  let hi = frames.length - 1;
  if (t >= frames[hi][0]) return frames[hi];
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (frames[m][0] <= t) lo = m;
    else hi = m;
  }
  const a = frames[lo];
  const c = frames[hi];
  const k = (t - a[0]) / (c[0] - a[0] || 1);
  return [t, a[1] + (c[1] - a[1]) * k, a[2] + (c[2] - a[2]) * k, a[3] + (c[3] - a[3]) * k, a[4] + (c[4] - a[4]) * k];
}

/** Без сопротивления воздуха: время и дальность до земли с высоты z0 (для прицела и ботов). */
export function carry(speed: number, pitch: number, z0: number, r = 0): { t: number; d: number } {
  const vh = speed * Math.cos(pitch);
  const vz = speed * Math.sin(pitch);
  const hgt = Math.max(0, z0 - r);
  const t = (vz + Math.sqrt(vz * vz + 2 * G * hgt)) / G;
  return { t, d: vh * t };
}

/** Какая скорость нужна, чтобы с высоты z0 под углом pitch упасть на дальности d (без воздуха; бот потом
 * поправляет точным fly). Двоичный поиск — монотонно по скорости. */
export function speedFor(d: number, pitch: number, z0: number, r = 0, vmax = 60): number {
  let lo = 0;
  let hi = vmax;
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    if (carry(m, pitch, z0, r).d < d) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}

/** Точки траектории для прицела (без воздуха): n точек от выпуска до земли. */
export function arc(b: Body, n: number): [number, number, number][] {
  const vh = Math.hypot(b.vx, b.vy);
  const { t } = carry(Math.hypot(vh, b.vz), Math.atan2(b.vz, vh), b.z, b.r);
  const out: [number, number, number][] = [];
  for (let i = 1; i <= n; i++) {
    const s = (t * i) / n;
    out.push([b.x + b.vx * s, b.y + b.vy * s, Math.max(b.r, b.z + b.vz * s - (G * s * s) / 2)]);
  }
  return out;
}

/** Ближайшая точка полёта к человеку (x, y, рост до reach): когда и на каком расстоянии — для ловли мяча. */
export function nearest(frames: BodyFrame[], x: number, y: number, reach = 2.1): { t: number; d: number; z: number } | null {
  let best: { t: number; d: number; z: number } | null = null;
  for (const [t, bx, by, bz] of frames) {
    if (bz > reach) continue;
    const d = Math.hypot(bx - x, by - y);
    if (!best || d < best.d) best = { t, d, z: bz };
  }
  return best;
}
