/* Бильярд — физика без DOM: столы (пул, русский, снукер — по настоящим размерам), шары, удар кием, столкновения, борта, лузы.
 * Единицы — метры, секунды, рад/с. Оси: x — вправо, y — вниз (как на экране), z — в стол; «вверх» — (0, 0, −1).
 * Модель (по Лекки–Гринспену / Алчиторе): шар скользит по сукну с трением μs, пока точка касания не перестанет проскальзывать,
 * дальше катится с сопротивлением μr; вращение вокруг вертикали гасится отдельно. Удар кием — импульс в точку битка:
 * накат, оттяжка и боковой винт — это просто начальная угловая скорость, дальше всё делает трение (оттяжка «сама» тянет биток назад).
 * Соударения шаров и с бортом — импульсы в точке касания с трением (отсюда «отбрасывание» прицельного и работа винта о борт);
 * борт касается шара выше центра. Лузы — створ с губками (у русского и снукера скруглёнными), шар падает, пройдя вглубь створа.
 * Шаг по времени подстраивается под самую быструю скорость, касание уточняется откатом к моменту соударения.
 * Результат удара — что куда упало, первое касание, борта, кадры для анимации и удары (для звука). */

export type TableKind = 'pool' | 'russian' | 'snooker';

export interface TableSpec {
  kind: TableKind;
  /** Игровое поле (между носами бортов). */
  w: number;
  h: number;
  /** Радиус шара. */
  r: number;
  /** Ширина створа в глубине губок (у угловой — самое узкое место; у средней пула губки расходятся, створ — по носам). */
  corner: number;
  side: number;
  /** Губки: длина вглубь, сужение угловой и средней (рад), скругление носа. */
  jaw: number;
  jawCorner: number;
  jawSide: number;
  fillet: number;
  /** Сопротивление качению (доля g). */
  muR: number;
  /** Ширина резины борта и деревянной рамы (для рисования). */
  cushion: number;
  rail: number;
}

const FT = (w: number, h: number) => ({ w, h });

/** Размеры столов (поле, мм → м). Пул: 7 футов — «барный», как в клубах и онлайн-пуле; 9 — турнирный. */
const SIZES = {
  pool: { small: FT(1.981, 0.991), mid: FT(2.235, 1.118), big: FT(2.54, 1.27) },
  russian: { small: FT(2.54, 1.27), mid: FT(2.84, 1.42), big: FT(3.55, 1.775) },
  snooker: { small: FT(3.048, 1.524), mid: FT(3.048, 1.524), big: FT(3.569, 1.778) },
};
export type TableSize = 'small' | 'mid' | 'big';
export const SIZE_FT: Record<TableKind, Record<TableSize, number>> = {
  pool: { small: 7, mid: 8, big: 9 },
  russian: { small: 9, mid: 10, big: 12 },
  snooker: { small: 10, mid: 10, big: 12 },
};

export function tableSpec(kind: TableKind, size: TableSize, wide = false): TableSpec {
  const { w, h } = SIZES[kind][size];
  let t: TableSpec;
  if (kind === 'pool')
    // шар 57,15 мм; створ угловой 4½″ (WPA), средней 4½″ — на глаз не больше угловой; губки угловой сходятся (142°), средней — расходятся внутрь (104°)
    t = { kind, w, h, r: 0.028575, corner: 0.103, side: 0.137, jaw: 0.045, jawCorner: 0.13, jawSide: -0.24, fillet: 0.006, muR: 0.012, cushion: 0.05, rail: 0.11 };
  else if (kind === 'russian')
    // шар 68 мм (на 9 футах — 60); створ угловой 74, средней 83 мм (регламент Минспорта); губки скруглены
    t = size === 'small'
      ? { kind, w, h, r: 0.03, corner: 0.0655, side: 0.0735, jaw: 0.04, jawCorner: 0.02, jawSide: 0.0, fillet: 0.016, muR: 0.013, cushion: 0.05, rail: 0.12 }
      : { kind, w, h, r: 0.034, corner: 0.074, side: 0.083, jaw: 0.045, jawCorner: 0.02, jawSide: 0.0, fillet: 0.018, muR: 0.013, cushion: 0.055, rail: 0.13 };
  // снукер: шар 52,5 мм, створ угловой ~86, средней ~95 мм, губки скруглены
  else t = { kind, w, h, r: 0.02625, corner: 0.086, side: 0.096, jaw: 0.04, jawCorner: 0.06, jawSide: 0.0, fillet: 0.022, muR: 0.011, cushion: 0.045, rail: 0.11 };
  if (wide) t = { ...t, corner: t.corner + t.r * 0.6, side: t.side + t.r * 0.5 };
  return t;
}

export interface Ball {
  id: number;
  x: number;
  y: number;
  /** На столе. */
  on: boolean;
}

export interface Pocket {
  /** Середина створа на линии носов бортов. */
  x: number;
  y: number;
  /** Ось лузы наружу (единичный вектор). */
  ax: number;
  ay: number;
  /** Ширина створа по носам бортов и в самом узком месте. */
  mouth: number;
  throat: number;
  /** Глубина (от линии носов), пройдя которую шар падает. */
  fall: number;
  /** Центр «дырки» (для рисования и прицела). */
  cx: number;
  cy: number;
  hole: number;
}

interface Seg {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}
interface Circ {
  x: number;
  y: number;
  r: number;
}

export interface Geometry {
  spec: TableSpec;
  pockets: Pocket[];
  segs: Seg[];
  circs: Circ[];
  /** Контуры резины бортов (для рисования): ломаные от губки до губки. */
  cushions: [number, number][][];
}

/** Лузы: 0 — левая верхняя, 1 — средняя верхняя, 2 — правая верхняя, 3 — правая нижняя, 4 — средняя нижняя, 5 — левая нижняя (верх — y = 0). */
export function geometry(spec: TableSpec): Geometry {
  const { w, h, jaw } = spec;
  const S2 = Math.SQRT1_2;
  const pockets: Pocket[] = [];
  const mk = (mx: number, my: number, ax: number, ay: number, throat: number, ang: number, corner: boolean): Pocket => {
    const mouth = throat + 2 * jaw * Math.tan(ang);
    const depth = corner ? jaw * 0.85 : jaw * 0.75;
    // провал — по ширине самого узкого места, сидит за губками: дуга проходит между ними, на поле не выходит (это и линия падения)
    // у средней провал чуть уже створа — на глаз не больше угловой
    const hole = (Math.min(mouth, throat) / 2) * (corner ? 1 : 0.9);
    const dd = jaw + hole * 0.25;
    return { x: mx, y: my, ax, ay, mouth, throat, fall: depth, cx: mx + ax * dd, cy: my + ay * dd, hole };
  };
  // угловые: середина створа на расстоянии mouth/2 от угла по диагонали
  const cm = spec.corner + 2 * jaw * Math.tan(spec.jawCorner);
  const cd = cm / 2;
  pockets.push(mk(cd * S2, cd * S2, -S2, -S2, spec.corner, spec.jawCorner, true));
  pockets.push(mk(w / 2, 0, 0, -1, spec.side, spec.jawSide, false));
  pockets.push(mk(w - cd * S2, cd * S2, S2, -S2, spec.corner, spec.jawCorner, true));
  pockets.push(mk(w - cd * S2, h - cd * S2, S2, S2, spec.corner, spec.jawCorner, true));
  pockets.push(mk(w / 2, h, 0, 1, spec.side, spec.jawSide, false));
  pockets.push(mk(cd * S2, h - cd * S2, -S2, S2, spec.corner, spec.jawCorner, true));
  // точки губок: нос (на линии борта) и конец губки (в глубине)
  const nose = (p: Pocket, side: 1 | -1): [number, number] => [p.x + -p.ay * side * (p.mouth / 2), p.y + p.ax * side * (p.mouth / 2)];
  const end = (p: Pocket, side: 1 | -1): [number, number] => [p.x + p.ax * jaw + -p.ay * side * (p.throat / 2), p.y + p.ay * jaw + p.ax * side * (p.throat / 2)];
  // борта между лузами: [из какой лузы, сторона] → [в какую, сторона]; сторона: +1 — по оси (−ay, ax) от середины створа
  const pieces: [number, 1 | -1, number, 1 | -1][] = [
    [0, 1, 1, -1], // верх слева: от угловой до средней
    [1, 1, 2, -1], // верх справа
    [2, 1, 3, -1], // правый короткий
    [3, 1, 4, -1], // низ справа
    [4, 1, 5, -1], // низ слева
    [5, 1, 0, -1], // левый короткий
  ];
  const segs: Seg[] = [];
  const circs: Circ[] = [];
  const cushions: [number, number][][] = [];
  for (const [pa, sa, pb, sb] of pieces) {
    const poly: [number, number][] = [end(pockets[pa], sa), nose(pockets[pa], sa), nose(pockets[pb], sb), end(pockets[pb], sb)];
    // проверка направления: нос борта должен идти вдоль борта — если перепутали стороны, меняем
    cushions.push(poly);
    // скругление носов губок
    const pts: [number, number][] = [poly[0]];
    for (let i = 1; i < poly.length - 1; i++) {
      const [vx, vy] = poly[i];
      const [px, py] = poly[i - 1];
      const [nx, ny] = poly[i + 1];
      let d1x = px - vx;
      let d1y = py - vy;
      let d2x = nx - vx;
      let d2y = ny - vy;
      const l1 = Math.hypot(d1x, d1y);
      const l2 = Math.hypot(d2x, d2y);
      d1x /= l1;
      d1y /= l1;
      d2x /= l2;
      d2y /= l2;
      const alpha = Math.acos(Math.max(-1, Math.min(1, d1x * d2x + d1y * d2y)));
      const f = Math.min(spec.fillet, Math.tan(alpha / 2) * Math.min(l1, l2) * 0.45);
      if (f < 1e-4) {
        pts.push([vx, vy]);
        continue;
      }
      const tl = f / Math.tan(alpha / 2);
      let bx = d1x + d2x;
      let by = d1y + d2y;
      const bl = Math.hypot(bx, by) || 1;
      bx /= bl;
      by /= bl;
      const dc = f / Math.sin(alpha / 2);
      circs.push({ x: vx + bx * dc, y: vy + by * dc, r: f });
      pts.push([vx + d1x * tl, vy + d1y * tl]);
      pts.push([vx + d2x * tl, vy + d2y * tl]);
    }
    pts.push(poly[poly.length - 1]);
    // отрезки: между точками, кроме дуг (пары «касательных» у одной вершины)
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[i + 1];
      if (Math.hypot(bx - ax, by - ay) < 1e-5) continue;
      segs.push({ ax, ay, bx, by });
    }
  }
  // дуги лежат между касательными: отрезок между касательными одной вершины — хорда дуги, его убираем
  const chord = (s: Seg) => circs.some((c) => Math.abs(Math.hypot(s.ax - c.x, s.ay - c.y) - c.r) < 1e-6 && Math.abs(Math.hypot(s.bx - c.x, s.by - c.y) - c.r) < 1e-6);
  return { spec, pockets, segs: segs.filter((s) => !chord(s)), circs, cushions };
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

/** Удар для звука: время (мс), вид (0 — кий, 1 — шар о шар, 2 — борт, 3 — луза), сила (см/с), x (см), шар, луза. */
export type Hit = number[];
export const HIT_CUE = 0;
export const HIT_BALL = 1;
export const HIT_RAIL = 2;
export const HIT_POCKET = 3;

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
  /** Кадры: время (мс) и изменившиеся шары [индекс, x, y (мм)…]; упавший — [индекс, −1, луза]. Первый кадр — все шары. */
  frames: { t: number; p: number[] }[];
  ids: number[];
  hits: Hit[];
  /** Время до остановки, с. */
  time: number;
}

export const G = 9.81;
export const MU_S = 0.2;
/** Затухание вращения вокруг вертикали, рад/с². */
const SPIN_DECEL = 10.9;
const E_BALL = 0.95;
const MU_CUSHION = 0.2;
/** Синус угла точки касания борта над центром шара (нос борта на высоте ~0,635 диаметра). */
const CUSH_SIN = 0.27;
const CUSH_COS = Math.sqrt(1 - CUSH_SIN * CUSH_SIN);
/** Самая дальняя от центра точка удара по битку — доля радиуса (дальше — кий соскальзывает). */
export const TIP_MAX = 0.5;

export const MIN_SPEED = 0.12;
export const MAX_SPEED = 10;
/** Сила (0…1) → скорость битка, м/с: квадратично — на слабых ударах тоньше. */
export const powerToSpeed = (p: number) => MIN_SPEED + (MAX_SPEED - MIN_SPEED) * Math.max(0, Math.min(1, p)) ** 2;
export const speedToPower = (v: number) => Math.sqrt(Math.max(0, Math.min(1, (v - MIN_SPEED) / (MAX_SPEED - MIN_SPEED))));

/** Скорость шара, которую надо дать, чтобы он, прокатившись d (сначала проскальзывая без вращения), пришёл со скоростью vEnd. */
export function speedFor(spec: TableSpec, d: number, vEnd: number): number {
  // проскальзывание без вращения «съедает» 2/7 скорости почти сразу
  return (7 / 5) * Math.sqrt(vEnd * vEnd + 2 * spec.muR * G * d);
}

/** Сыграть удар до остановки всех шаров. */
export function simulate(geo: Geometry, balls0: Ball[], shot: Shot, recordFrames = true): ShotResult {
  const { spec, segs, circs, pockets } = geo;
  const R = spec.r;
  const balls = balls0.map((b) => ({ ...b }));
  const n = balls.length;
  const X = new Float64Array(n);
  const Y = new Float64Array(n);
  const VX = new Float64Array(n);
  const VY = new Float64Array(n);
  const WX = new Float64Array(n);
  const WY = new Float64Array(n);
  const WZ = new Float64Array(n);
  /** 0 — стоит, 1 — скользит, 2 — катится. */
  const mode = new Uint8Array(n);
  const on = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    X[i] = balls[i].x;
    Y[i] = balls[i].y;
    on[i] = balls[i].on ? 1 : 0;
  }
  const res: ShotResult = { balls, pocketed: [], first: -1, railsAfter: 0, rails: 0, railBalls: [], frames: [], ids: balls.map((b) => b.id), hits: [], time: 0 };
  const ci = balls.findIndex((b) => b.id === shot.cue && b.on);
  if (ci < 0) return res;
  const muRg = spec.muR * G;
  const muSg = MU_S * G;
  const spinK = (5 * muSg) / (2 * R);
  const I_M = 0.4 * R * R; // момент инерции на единицу массы

  // удар кием
  const v0 = powerToSpeed(shot.power);
  const dx = Math.cos(shot.angle);
  const dy = Math.sin(shot.angle);
  let a = Math.max(-1, Math.min(1, shot.spinX)) * TIP_MAX;
  let b = Math.max(-1, Math.min(1, shot.spinY)) * TIP_MAX;
  const off = Math.hypot(a, b);
  if (off > TIP_MAX) {
    a *= TIP_MAX / off;
    b *= TIP_MAX / off;
  }
  VX[ci] = dx * v0;
  VY[ci] = dy * v0;
  const k = (5 * v0) / (2 * R);
  // накат/оттяжка: b·(up × d), up × d = (dy, −dx, 0); винт: a·(s × d) = a·(0, 0, −1)
  WX[ci] = k * b * dy;
  WY[ci] = -k * b * dx;
  WZ[ci] = -k * a;
  mode[ci] = 1;

  let t = 0;
  const hit = (kind: number, speed: number, x: number, ...extra: number[]) => {
    if (res.hits.length < 600 && (speed > 0.03 || kind === HIT_POCKET)) res.hits.push([Math.round(t * 1000), kind, Math.round(speed * 100), Math.round(x * 100), ...extra]);
  };
  hit(HIT_CUE, v0, X[ci], ci);

  // кадры
  const lastX = new Int32Array(n);
  const lastY = new Int32Array(n);
  const lastOn = new Uint8Array(n);
  let lastFrame = -1;
  const frame = () => {
    const p: number[] = [];
    const all = !res.frames.length;
    for (let i = 0; i < n; i++) {
      if (!on[i]) {
        if (all || lastOn[i]) {
          const pk = res.pocketed.find((q) => q.id === balls[i].id);
          p.push(i, -1, pk ? pk.pocket : -1);
        }
        lastOn[i] = 0;
        continue;
      }
      const mx = Math.round(X[i] * 1000);
      const my = Math.round(Y[i] * 1000);
      if (all || mx !== lastX[i] || my !== lastY[i] || !lastOn[i]) p.push(i, mx, my);
      lastX[i] = mx;
      lastY[i] = my;
      lastOn[i] = 1;
    }
    if (all || p.length) res.frames.push({ t: Math.round(t * 1000), p });
    lastFrame = t;
  };
  if (recordFrames) frame();

  const touched = new Uint8Array(n);
  const railed = new Set<number>();

  // ---- импульсы
  /** Шар о неподвижное препятствие: нормаль (nx, ny) от препятствия к шару. */
  const cushionHit = (i: number, nx: number, ny: number) => {
    const vn = VX[i] * nx + VY[i] * ny;
    if (vn >= 0) return 0;
    const e = Math.max(0.6, 0.9 - 0.035 * -vn);
    // точка касания относительно центра: r = −n·R·cos + up·R·sin, up = (0, 0, −1)
    const rx = -nx * R * CUSH_COS;
    const ry = -ny * R * CUSH_COS;
    const rz = -R * CUSH_SIN;
    const jn = -(1 + e) * vn; // на единицу массы
    VX[i] += jn * nx;
    VY[i] += jn * ny;
    // скорость точки касания после нормального импульса: v + ω × r
    let sx = VX[i] + (WY[i] * rz - WZ[i] * ry);
    let sy = VY[i] + (WZ[i] * rx - WX[i] * rz);
    let sz = WX[i] * ry - WY[i] * rx;
    const sn = sx * nx + sy * ny;
    sx -= sn * nx;
    sy -= sn * ny;
    const sl = Math.hypot(sx, sy, sz);
    if (sl > 1e-9) {
      const jt = Math.min(MU_CUSHION * jn, sl / 3.5);
      const jx = (-sx / sl) * jt;
      const jy = (-sy / sl) * jt;
      const jz = (-sz / sl) * jt;
      VX[i] += jx;
      VY[i] += jy;
      // Δω = r × J / I
      WX[i] += (ry * jz - rz * jy) / I_M;
      WY[i] += (rz * jx - rx * jz) / I_M;
      WZ[i] += (rx * jy - ry * jx) / I_M;
    }
    mode[i] = 1;
    return -vn;
  };

  const ballHit = (i: number, j: number, nx: number, ny: number) => {
    const rel = (VX[i] - VX[j]) * nx + (VY[i] - VY[j]) * ny;
    if (rel <= 0) return 0;
    const jn = ((1 + E_BALL) * rel) / 2;
    VX[i] -= jn * nx;
    VY[i] -= jn * ny;
    VX[j] += jn * nx;
    VY[j] += jn * ny;
    // проскальзывание в точке касания: ri = R·n, rj = −R·n
    const rix = R * nx;
    const riy = R * ny;
    let sx = VX[i] + (-WZ[i] * riy) - (VX[j] + WZ[j] * riy);
    let sy = VY[i] + WZ[i] * rix - (VY[j] - WZ[j] * rix);
    let sz = WX[i] * riy - WY[i] * rix - (-(WX[j] * riy) + WY[j] * rix);
    const sn = sx * nx + sy * ny;
    sx -= sn * nx;
    sy -= sn * ny;
    const sl = Math.hypot(sx, sy, sz);
    if (sl > 1e-9) {
      const mu = 0.00995 + 0.108 * Math.exp(-1.088 * sl);
      const jt = Math.min(mu * jn, sl / 7);
      const jx = (-sx / sl) * jt;
      const jy = (-sy / sl) * jt;
      const jz = (-sz / sl) * jt;
      VX[i] += jx;
      VY[i] += jy;
      VX[j] -= jx;
      VY[j] -= jy;
      // Δωi = ri × J / I, Δωj = rj × (−J) / I = ri × J / I
      const tx = (riy * jz) / I_M;
      const ty = (-rix * jz) / I_M;
      const tz = (rix * jy - riy * jx) / I_M;
      WX[i] += tx;
      WY[i] += ty;
      WZ[i] += tz;
      WX[j] += tx;
      WY[j] += ty;
      WZ[j] += tz;
    }
    mode[i] = mode[j] = 1;
    return rel;
  };

  const nearEdge = (i: number) => X[i] < R * 1.6 || Y[i] < R * 1.6 || X[i] > spec.w - R * 1.6 || Y[i] > spec.h - R * 1.6;

  for (let iter = 0; iter < 300000; iter++) {
    let vmax = 0;
    let moving = false;
    for (let i = 0; i < n; i++) {
      if (!on[i] || !mode[i]) continue;
      moving = true;
      const s = Math.abs(VX[i]) + Math.abs(VY[i]);
      if (s > vmax) vmax = s;
    }
    if (!moving) break;
    const dt = Math.min(0.002, (R * 0.2) / Math.max(vmax, 1e-6));
    t += dt;

    // ---- движение и трение о сукно
    for (let i = 0; i < n; i++) {
      if (!on[i] || !mode[i]) continue;
      if (mode[i] === 1) {
        // скорость точки касания с сукном: v + ω × (0, 0, R) = (vx + R·ωy, vy − R·ωx)
        const ux = VX[i] + R * WY[i];
        const uy = VY[i] - R * WX[i];
        const ul = Math.hypot(ux, uy);
        const need = 3.5 * muSg * dt;
        const f = ul > need ? 1 : ul / need;
        if (ul > 1e-12) {
          const ex = ux / ul;
          const ey = uy / ul;
          const ovx = VX[i];
          const ovy = VY[i];
          VX[i] -= muSg * ex * dt * f;
          VY[i] -= muSg * ey * dt * f;
          WX[i] += spinK * ey * dt * f;
          WY[i] -= spinK * ex * dt * f;
          X[i] += (ovx + VX[i]) * 0.5 * dt;
          Y[i] += (ovy + VY[i]) * 0.5 * dt;
        } else {
          X[i] += VX[i] * dt;
          Y[i] += VY[i] * dt;
        }
        if (f < 1) {
          // перешёл в качение
          mode[i] = 2;
          WY[i] = -VX[i] / R;
          WX[i] = VY[i] / R;
        }
      } else {
        const sp = Math.hypot(VX[i], VY[i]);
        const ns = sp - muRg * dt;
        if (ns <= 0) {
          X[i] += VX[i] * dt * 0.5;
          Y[i] += VY[i] * dt * 0.5;
          VX[i] = VY[i] = WX[i] = WY[i] = WZ[i] = 0;
          mode[i] = 0;
          continue;
        }
        X[i] += VX[i] * dt * (1 - (muRg * dt) / (2 * sp));
        Y[i] += VY[i] * dt * (1 - (muRg * dt) / (2 * sp));
        VX[i] *= ns / sp;
        VY[i] *= ns / sp;
        WY[i] = -VX[i] / R;
        WX[i] = VY[i] / R;
      }
      // вращение вокруг вертикали
      if (WZ[i] !== 0) {
        const dw = SPIN_DECEL * dt;
        WZ[i] = Math.abs(WZ[i]) <= dw ? 0 : WZ[i] - Math.sign(WZ[i]) * dw;
      }
      // скольжение без скорости — встал
      if (mode[i] === 1 && Math.abs(VX[i]) + Math.abs(VY[i]) < 1e-4 && Math.abs(WX[i]) + Math.abs(WY[i]) < 1e-2) {
        VX[i] = VY[i] = WX[i] = WY[i] = WZ[i] = 0;
        mode[i] = 0;
      }
    }

    let collided = false;
    // ---- шар о шар (несколько проходов — передача по цепочке в пирамиде)
    for (let pass = 0; pass < 4; pass++) {
      let any = false;
      for (let i = 0; i < n; i++) {
        if (!on[i]) continue;
        for (let j = i + 1; j < n; j++) {
          if (!on[j] || (!mode[i] && !mode[j])) continue;
          const px = X[j] - X[i];
          const py = Y[j] - Y[i];
          const d2 = px * px + py * py;
          if (d2 >= 4 * R * R) continue;
          const qx = VX[j] - VX[i];
          const qy = VY[j] - VY[i];
          const pq = px * qx + py * qy;
          // откат к моменту касания
          let tau = 0;
          const qq = qx * qx + qy * qy;
          if (pq < 0 && qq > 1e-12) {
            // |p − q·τ| = 2R: на сколько назад во времени было касание
            tau = (pq + Math.sqrt(Math.max(0, pq * pq - qq * (d2 - 4 * R * R)))) / qq;
            if (!(tau >= 0) || tau > dt * 2) tau = 0;
          }
          X[i] -= VX[i] * tau;
          Y[i] -= VY[i] * tau;
          X[j] -= VX[j] * tau;
          Y[j] -= VY[j] * tau;
          let ddx = X[j] - X[i];
          let ddy = Y[j] - Y[i];
          let d = Math.hypot(ddx, ddy);
          if (d < 1e-9) {
            ddx = 1;
            ddy = 0;
            d = 1;
          }
          const nx = ddx / d;
          const ny = ddy / d;
          const rel = ballHit(i, j, nx, ny);
          X[i] += VX[i] * tau;
          Y[i] += VY[i] * tau;
          X[j] += VX[j] * tau;
          Y[j] += VY[j] * tau;
          // остаток перекрытия — раздвинуть
          const ox = X[j] - X[i];
          const oy = Y[j] - Y[i];
          const od = Math.hypot(ox, oy);
          if (od < 2 * R && od > 1e-9) {
            const push = (2 * R - od) / 2 + 1e-7;
            X[i] -= (ox / od) * push;
            Y[i] -= (oy / od) * push;
            X[j] += (ox / od) * push;
            Y[j] += (oy / od) * push;
          }
          if (rel > 0) {
            any = collided = true;
            if (res.first < 0 && (i === ci || j === ci)) res.first = balls[i === ci ? j : i].id;
            touched[i] = touched[j] = 1;
            hit(HIT_BALL, rel, (X[i] + X[j]) / 2, i, j);
          }
        }
      }
      if (!any) break;
    }

    // ---- борта и губки
    for (let i = 0; i < n; i++) {
      if (!on[i] || !mode[i] || !nearEdge(i)) continue;
      for (let s = 0; s < segs.length; s++) {
        const sg = segs[s];
        const ex = sg.bx - sg.ax;
        const ey = sg.by - sg.ay;
        const len2 = ex * ex + ey * ey;
        let u = ((X[i] - sg.ax) * ex + (Y[i] - sg.ay) * ey) / len2;
        u = u < 0 ? 0 : u > 1 ? 1 : u;
        const ddx = X[i] - (sg.ax + ex * u);
        const ddy = Y[i] - (sg.ay + ey * u);
        const d2 = ddx * ddx + ddy * ddy;
        if (d2 >= R * R || d2 < 1e-14) continue;
        const d = Math.sqrt(d2);
        collided = railHit(i, ddx / d, ddy / d, R - d) || collided;
      }
      for (let c = 0; c < circs.length; c++) {
        const cc = circs[c];
        const ddx = X[i] - cc.x;
        const ddy = Y[i] - cc.y;
        const lim = R + cc.r;
        const d2 = ddx * ddx + ddy * ddy;
        if (d2 >= lim * lim || d2 < 1e-14) continue;
        const d = Math.sqrt(d2);
        collided = railHit(i, ddx / d, ddy / d, lim - d) || collided;
      }
    }

    // ---- лузы
    for (let i = 0; i < n; i++) {
      if (!on[i] || !mode[i]) continue;
      if (X[i] > R * 2.5 && Y[i] > R * 2.5 && X[i] < spec.w - R * 2.5 && Y[i] < spec.h - R * 2.5) continue;
      let pk = -1;
      for (let k2 = 0; k2 < pockets.length; k2++) {
        const p = pockets[k2];
        const dep = (X[i] - p.x) * p.ax + (Y[i] - p.y) * p.ay;
        const lat = Math.abs((X[i] - p.x) * -p.ay + (Y[i] - p.y) * p.ax);
        // центр шара перешёл линию падения (дугу провала) или ушёл вглубь створа
        if ((dep > p.fall && lat < p.mouth / 2 + R) || (X[i] - p.cx) ** 2 + (Y[i] - p.cy) ** 2 < (p.hole - R * 0.1) ** 2) {
          pk = k2;
          break;
        }
      }
      // вылетел за стол мимо створа (не должно быть) — в ближайшую лузу
      if (pk < 0 && (X[i] < -R * 2 || Y[i] < -R * 2 || X[i] > spec.w + R * 2 || Y[i] > spec.h + R * 2)) {
        let bd = Infinity;
        pockets.forEach((p, k2) => {
          const dd = (X[i] - p.x) ** 2 + (Y[i] - p.y) ** 2;
          if (dd < bd) {
            bd = dd;
            pk = k2;
          }
        });
      }
      if (pk >= 0) {
        const sp = Math.hypot(VX[i], VY[i]);
        on[i] = 0;
        mode[i] = 0;
        VX[i] = VY[i] = WX[i] = WY[i] = WZ[i] = 0;
        res.pocketed.push({ id: balls[i].id, pocket: pk });
        hit(HIT_POCKET, sp, X[i], i, pk);
        collided = true;
      }
    }

    if (recordFrames && (t - lastFrame >= 1 / 30 || (collided && t - lastFrame > 0.004))) frame();
    if (t > 60) break;
  }

  function railHit(i: number, nx: number, ny: number, depth: number): boolean {
    const vn = VX[i] * nx + VY[i] * ny;
    // откат к касанию
    let tau = vn < 0 ? depth / -vn : 0;
    if (tau > 0.004) tau = 0;
    X[i] -= VX[i] * tau;
    Y[i] -= VY[i] * tau;
    const sp = cushionHit(i, nx, ny);
    X[i] += VX[i] * tau;
    Y[i] += VY[i] * tau;
    // не дать застрять в борту
    const back = vn < 0 ? 0 : depth;
    X[i] += nx * (back + 1e-7);
    Y[i] += ny * (back + 1e-7);
    if (sp > 0) {
      res.rails++;
      if (res.first >= 0) {
        res.railsAfter++;
        railed.add(balls[i].id);
      }
      hit(HIT_RAIL, sp, X[i], i);
      return true;
    }
    return false;
  }

  res.time = t;
  // остановившиеся вплотную — раздвинуть, чтобы не перекрывались
  for (let pass = 0; pass < 6; pass++) {
    let any = false;
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        if (!on[i] || !on[j]) continue;
        const ox = X[j] - X[i];
        const oy = Y[j] - Y[i];
        const od = Math.hypot(ox, oy);
        if (od >= 2 * R || od < 1e-9) continue;
        const push = (2 * R - od) / 2 + 2e-5;
        X[i] -= (ox / od) * push;
        Y[i] -= (oy / od) * push;
        X[j] += (ox / od) * push;
        Y[j] += (oy / od) * push;
        any = true;
      }
    if (!any) break;
  }
  for (let i = 0; i < n; i++) {
    balls[i].on = !!on[i];
    balls[i].x = Math.round(X[i] * 1e5) / 1e5;
    balls[i].y = Math.round(Y[i] * 1e5) / 1e5;
  }
  if (recordFrames) frame();
  res.railBalls = [...railed];
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
