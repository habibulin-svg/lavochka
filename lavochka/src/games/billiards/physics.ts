/* Бильярд — физика без DOM: столы (русский 12 футов и пул 9 футов), шары, удар кием с винтом, столкновения, борта, лузы.
 * Единицы — метры и секунды. Шаг интегрирования подстраивается под самую быструю скорость (шар за шаг проходит не больше ¼ радиуса).
 * Упрощения: качение с постоянным замедлением; накат/оттяжка — добавка к скорости битка после первого соударения;
 * боковой винт — поправка вдоль борта при отскоке. Результат удара — что куда упало, первое касание, борта и кадры для анимации. */

export interface TableSpec {
  id: 'russian' | 'pool';
  /** Игровое поле (внутри бортов). */
  w: number;
  h: number;
  /** Радиус шара. */
  r: number;
  /** Створ угловой и средней луз. */
  corner: number;
  side: number;
  /** Замедление качения, м/с². */
  roll: number;
  /** Отскок от борта и шара. */
  cushion: number;
  ball: number;
}

export const TABLES: Record<'russian' | 'pool', TableSpec> = {
  // русский бильярд: поле 3550×1775, шар 68 мм, створ угловой 73, средней 83 (по ru.wikipedia)
  russian: { id: 'russian', w: 3.55, h: 1.775, r: 0.034, corner: 0.073, side: 0.083, roll: 0.75, cushion: 0.72, ball: 0.94 },
  // пул 9 футов: поле 2540×1270, шар 57,15 мм, лузы 114 и 127
  pool: { id: 'pool', w: 2.54, h: 1.27, r: 0.028575, corner: 0.114, side: 0.127, roll: 0.8, cushion: 0.75, ball: 0.95 },
};

export interface Ball {
  id: number;
  x: number;
  y: number;
  /** На столе. */
  on: boolean;
}

export interface Pocket {
  x: number;
  y: number;
  /** Радиус «захвата»: центр шара ближе — шар в лузе. */
  cap: number;
}

interface Seg {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

export interface Geometry {
  spec: TableSpec;
  pockets: Pocket[];
  segs: Seg[];
}

/** Лузы: 0 — левая верхняя, 1 — средняя верхняя, 2 — правая верхняя, 3 — правая нижняя, 4 — средняя нижняя, 5 — левая нижняя (верх — y = 0). */
export function geometry(spec: TableSpec): Geometry {
  const { w, h, corner, side, r } = spec;
  // угловая луза: створ поперёк диагонали; точки на бортах — на расстоянии c от угла
  const c = corner / Math.SQRT2;
  const s = side / 2;
  const segs: Seg[] = [];
  const add = (ax: number, ay: number, bx: number, by: number) => segs.push({ ax, ay, bx, by });
  const jaw = 0.05;
  // верхний борт: от левого угла до средней, от средней до правого угла
  add(c, 0, w / 2 - s, 0);
  add(w / 2 + s, 0, w - c, 0);
  add(c, h, w / 2 - s, h);
  add(w / 2 + s, h, w - c, h);
  // короткие борта
  add(0, c, 0, h - c);
  add(w, c, w, h - c);
  // губки угловых луз — под 45° наружу
  const cj = jaw / Math.SQRT2;
  for (const [cx, cy, sx, sy] of [
    [0, 0, 1, 1],
    [w, 0, -1, 1],
    [w, h, -1, -1],
    [0, h, 1, -1],
  ]) {
    // точка на длинном борту и точка на коротком
    add(cx + sx * c, cy, cx + sx * c - sx * cj, cy - sy * cj);
    add(cx, cy + sy * c, cx - sx * cj, cy + sy * c - sy * cj);
  }
  // губки средних луз — слегка внутрь створа
  for (const y of [0, h]) {
    const out = y === 0 ? -1 : 1;
    add(w / 2 - s, y, w / 2 - s + 0.012, y + out * jaw);
    add(w / 2 + s, y, w / 2 + s - 0.012, y + out * jaw);
  }
  const pockets: Pocket[] = [
    { x: -r * 0.35, y: -r * 0.35, cap: corner / 2 },
    { x: w / 2, y: -r * 0.9, cap: side / 2 },
    { x: w + r * 0.35, y: -r * 0.35, cap: corner / 2 },
    { x: w + r * 0.35, y: h + r * 0.35, cap: corner / 2 },
    { x: w / 2, y: h + r * 0.9, cap: side / 2 },
    { x: -r * 0.35, y: h + r * 0.35, cap: corner / 2 },
  ];
  return { spec, pockets, segs };
}

export interface Shot {
  /** Каким шаром бьём. */
  cue: number;
  /** Направление, рад (0 — вправо, по часовой — вниз). */
  angle: number;
  /** Сила 0…1. */
  power: number;
  /** Точка удара по битку: x — боковой винт (−1 влево … 1 вправо), y — накат (+) / оттяжка (−). */
  spinX: number;
  spinY: number;
}

export interface ShotResult {
  balls: Ball[];
  /** id упавших шаров по порядку и лузы. */
  pocketed: { id: number; pocket: number }[];
  /** Первый шар, которого коснулся биток (−1 — ни одного). */
  first: number;
  /** Сколько раз шары касались бортов после первого соударения (и всего). */
  railsAfter: number;
  rails: number;
  /** Шары, коснувшиеся борта (после первого соударения). */
  railBalls: number[];
  /** Кадры: время (мс) и координаты (мм) шаров на столе; ушедший в лузу — [-1, -1]. */
  frames: { t: number; p: number[] }[];
  ids: number[];
  /** Время до остановки, с. */
  time: number;
}

export const MAX_SPEED = 7.5;
export const powerToSpeed = (p: number) => 0.3 + Math.max(0, Math.min(1, p)) * (MAX_SPEED - 0.3);

/** Сыграть удар до остановки всех шаров. */
export function simulate(geo: Geometry, balls0: Ball[], shot: Shot, recordFrames = true): ShotResult {
  const { spec, segs, pockets } = geo;
  const r = spec.r;
  const balls = balls0.map((b) => ({ ...b }));
  const n = balls.length;
  const vx = new Float64Array(n);
  const vy = new Float64Array(n);
  const ci = balls.findIndex((b) => b.id === shot.cue && b.on);
  const res: ShotResult = { balls, pocketed: [], first: -1, railsAfter: 0, rails: 0, railBalls: [], frames: [], ids: balls.map((b) => b.id), time: 0 };
  if (ci < 0) return res;
  const v0 = powerToSpeed(shot.power);
  vx[ci] = Math.cos(shot.angle) * v0;
  vy[ci] = Math.sin(shot.angle) * v0;
  // винт битка: остаётся до первого соударения (накат/оттяжка) и до первого борта (боковой)
  let spinY = Math.max(-1, Math.min(1, shot.spinY));
  let spinX = Math.max(-1, Math.min(1, shot.spinX));
  const dir0 = [Math.cos(shot.angle), Math.sin(shot.angle)];
  let t = 0;
  let nextFrame = 0;
  const frame = () => {
    const p: number[] = [];
    for (const b of balls) p.push(b.on ? Math.round(b.x * 1000) : -1, b.on ? Math.round(b.y * 1000) : -1);
    res.frames.push({ t: Math.round(t * 1000), p });
  };
  if (recordFrames) frame();
  const touched = new Set<number>();
  for (let iter = 0; iter < 400000; iter++) {
    let vmax = 0;
    for (let i = 0; i < n; i++) if (balls[i].on) vmax = Math.max(vmax, Math.abs(vx[i]) + Math.abs(vy[i]));
    if (vmax < 1e-3) break;
    const dt = Math.min(0.004, (r * 0.25) / vmax);
    t += dt;
    // движение и качение
    for (let i = 0; i < n; i++) {
      const b = balls[i];
      if (!b.on) continue;
      const sp = Math.hypot(vx[i], vy[i]);
      if (sp < 1e-4) {
        vx[i] = vy[i] = 0;
        continue;
      }
      b.x += vx[i] * dt;
      b.y += vy[i] * dt;
      const ns = Math.max(0, sp - spec.roll * dt);
      vx[i] *= ns / sp;
      vy[i] *= ns / sp;
    }
    // лузы
    for (let i = 0; i < n; i++) {
      const b = balls[i];
      if (!b.on) continue;
      for (let k = 0; k < pockets.length; k++) {
        const p = pockets[k];
        if ((b.x - p.x) ** 2 + (b.y - p.y) ** 2 < p.cap * p.cap) {
          b.on = false;
          vx[i] = vy[i] = 0;
          res.pocketed.push({ id: b.id, pocket: k });
          break;
        }
      }
      // вылетел за пределы (через створ) — тоже в лузу, ближайшую
      if (b.on && (b.x < -r * 2 || b.y < -r * 2 || b.x > spec.w + r * 2 || b.y > spec.h + r * 2)) {
        let best = 0;
        for (let k = 1; k < pockets.length; k++) if ((b.x - pockets[k].x) ** 2 + (b.y - pockets[k].y) ** 2 < (b.x - pockets[best].x) ** 2 + (b.y - pockets[best].y) ** 2) best = k;
        b.on = false;
        vx[i] = vy[i] = 0;
        res.pocketed.push({ id: b.id, pocket: best });
      }
    }
    // шар о шар
    for (let i = 0; i < n; i++) {
      if (!balls[i].on) continue;
      for (let j = i + 1; j < n; j++) {
        if (!balls[j].on) continue;
        const dx = balls[j].x - balls[i].x;
        const dy = balls[j].y - balls[i].y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= 4 * r * r || d2 === 0) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d;
        const ny = dy / d;
        const rel = (vx[i] - vx[j]) * nx + (vy[i] - vy[j]) * ny;
        // раздвинуть
        const push = (2 * r - d) / 2;
        balls[i].x -= nx * push;
        balls[i].y -= ny * push;
        balls[j].x += nx * push;
        balls[j].y += ny * push;
        if (rel <= 0) continue;
        const imp = (rel * (1 + spec.ball)) / 2;
        vx[i] -= imp * nx;
        vy[i] -= imp * ny;
        vx[j] += imp * nx;
        vy[j] += imp * ny;
        const cueHit = i === ci || j === ci;
        if (cueHit && res.first < 0) {
          res.first = balls[i === ci ? j : i].id;
          // накат/оттяжка: битку добавка вдоль исходного направления
          if (spinY) {
            const add = spinY * v0 * 0.35 * (spinY > 0 ? 1 : 1.2);
            vx[ci] += dir0[0] * add * (rel / Math.max(v0, 1e-3));
            vy[ci] += dir0[1] * add * (rel / Math.max(v0, 1e-3));
            spinY = 0;
          }
        }
        touched.add(balls[i].id);
        touched.add(balls[j].id);
      }
    }
    // борта
    for (let i = 0; i < n; i++) {
      const b = balls[i];
      if (!b.on) continue;
      for (const s of segs) {
        const ex = s.bx - s.ax;
        const ey = s.by - s.ay;
        const len2 = ex * ex + ey * ey;
        let u = ((b.x - s.ax) * ex + (b.y - s.ay) * ey) / len2;
        u = Math.max(0, Math.min(1, u));
        const px = s.ax + ex * u;
        const py = s.ay + ey * u;
        const dx = b.x - px;
        const dy = b.y - py;
        const d2 = dx * dx + dy * dy;
        if (d2 >= r * r || d2 === 0) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d;
        const ny = dy / d;
        b.x = px + nx * r;
        b.y = py + ny * r;
        const vn = vx[i] * nx + vy[i] * ny;
        if (vn >= 0) continue;
        vx[i] -= (1 + spec.cushion) * vn * nx;
        vy[i] -= (1 + spec.cushion) * vn * ny;
        // боковой винт: поправка вдоль борта
        if (i === ci && spinX) {
          const tx = -ny;
          const ty = nx;
          const k = spinX * Math.abs(vn) * 0.45;
          vx[i] += tx * k;
          vy[i] += ty * k;
          spinX *= 0.5;
        }
        res.rails++;
        if (res.first >= 0) {
          res.railsAfter++;
          if (!res.railBalls.includes(b.id)) res.railBalls.push(b.id);
        }
      }
    }
    if (recordFrames && t >= nextFrame) {
      frame();
      nextFrame = t + 1 / 40;
    }
    if (t > 25) break;
  }
  res.time = t;
  if (recordFrames) frame();
  for (const b of balls) {
    b.x = Math.round(b.x * 1e5) / 1e5;
    b.y = Math.round(b.y * 1e5) / 1e5;
  }
  return res;
}

/** Свободно ли место для шара (с руки). */
export function freeSpot(spec: TableSpec, balls: Ball[], x: number, y: number, ignore = -1): boolean {
  const r = spec.r;
  if (x < r || y < r || x > spec.w - r || y > spec.h - r) return false;
  return balls.every((b) => !b.on || b.id === ignore || (b.x - x) ** 2 + (b.y - y) ** 2 >= (2 * r + 0.001) ** 2);
}

/** Ближайшее свободное место к точке (для выставления шара). */
export function spotNear(spec: TableSpec, balls: Ball[], x: number, y: number, ignore = -1): [number, number] {
  if (freeSpot(spec, balls, x, y, ignore)) return [x, y];
  for (let k = 1; k < 200; k++) {
    // по линии к короткому борту, потом по спирали
    const nx = x + k * spec.r * 0.5;
    if (freeSpot(spec, balls, nx, y, ignore)) return [nx, y];
    const a = k * 0.7;
    const sx = x + Math.cos(a) * k * spec.r * 0.3;
    const sy = y + Math.sin(a) * k * spec.r * 0.3;
    if (freeSpot(spec, balls, sx, sy, ignore)) return [sx, sy];
  }
  return [x, y];
}
