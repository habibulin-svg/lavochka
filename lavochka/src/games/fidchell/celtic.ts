/* Кельтский орнамент кодом (SVG-строки): ленты с переплетением «над — под», плетёнка вдоль кромки, узел-трикветр,
 * трискель из трёх спиралей и «кольцо с точкой» — как режут по дереву и кости.
 *
 * Переплетение: кривые — ломаные; находим все пересечения (и самопересечения), вдоль каждой кривой проходы
 * чередуются «над/под», чётность каждой кривой подбирается перебором так, чтобы каждый перекрёсток был один раз
 * над и один раз под. Рисуем все ленты целиком, а у перекрёстков поверх ещё раз — кусок верхней ленты с её обводкой. */

export type Pt = [number, number];

export interface Curve {
  pts: Pt[];
  closed?: boolean;
}

export interface Ribbon {
  /** Ширина ленты. */
  w: number;
  /** Ширина обводки (по каждой стороне). */
  edge: number;
  fill: string;
  stroke: string;
  /** Желобок по середине ленты. */
  groove?: string;
  /** Блик — тонкая светлая линия вдоль ленты (смещение вверх-влево). */
  shine?: string;
  /** Тень под лентой. */
  shadow?: string;
}

const f = (v: number) => Math.round(v * 1000) / 1000;
const d = (pts: Pt[], closed = false) => pts.map((p, i) => `${i ? 'L' : 'M'}${f(p[0])} ${f(p[1])}`).join('') + (closed ? 'Z' : '');

interface Visit {
  curve: number;
  /** Длина по кривой до перекрёстка. */
  at: number;
  cross: number;
}

function segs(c: Curve): [Pt, Pt, number][] {
  const out: [Pt, Pt, number][] = [];
  let len = 0;
  const n = c.pts.length;
  for (let i = 0; i < (c.closed ? n : n - 1); i++) {
    const a = c.pts[i];
    const b = c.pts[(i + 1) % n];
    out.push([a, b, len]);
    len += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return out;
}

function hitSeg(a: Pt, b: Pt, c: Pt, e: Pt): [number, number] | null {
  const rx = b[0] - a[0];
  const ry = b[1] - a[1];
  const sx = e[0] - c[0];
  const sy = e[1] - c[1];
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / den;
  const u = ((c[0] - a[0]) * ry - (c[1] - a[1]) * rx) / den;
  if (t < 0 || t >= 1 || u < 0 || u >= 1) return null;
  return [t, u];
}

/** Кусок кривой по длине [from, to] (для замкнутой — с переходом через начало). */
function slice(c: Curve, from: number, to: number): Pt[] {
  const ss = segs(c);
  const total = ss.length ? ss[ss.length - 1][2] + Math.hypot(ss[ss.length - 1][1][0] - ss[ss.length - 1][0][0], ss[ss.length - 1][1][1] - ss[ss.length - 1][0][1]) : 0;
  const out: Pt[] = [];
  const pointAt = (L: number): Pt => {
    let x = L;
    if (c.closed) x = ((x % total) + total) % total;
    else x = Math.max(0, Math.min(total, x));
    for (const [a, b, l0] of ss) {
      const sl = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (x <= l0 + sl) {
        const t = sl ? (x - l0) / sl : 0;
        return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      }
    }
    return ss.length ? ss[ss.length - 1][1] : c.pts[0];
  };
  const steps = Math.max(4, Math.ceil((to - from) / (total / Math.max(8, ss.length))));
  for (let i = 0; i <= steps; i++) out.push(pointAt(from + ((to - from) * i) / steps));
  return out;
}

/** Ленты с переплетением. r — половина длины «верхнего» куска у перекрёстка. */
export function interlace(curves: Curve[], rib: Ribbon, r = rib.w * 1.6): string {
  const all = curves.map(segs);
  const visits: Visit[][] = curves.map(() => []);
  const crosses: [Visit, Visit][] = [];
  for (let i = 0; i < curves.length; i++)
    for (let j = i; j < curves.length; j++) {
      const A = all[i];
      const B = all[j];
      for (let p = 0; p < A.length; p++)
        for (let q = i === j ? p + 2 : 0; q < B.length; q++) {
          if (i === j && curves[i].closed && p === 0 && q === A.length - 1) continue;
          const h = hitSeg(A[p][0], A[p][1], B[q][0], B[q][1]);
          if (!h) continue;
          const la = A[p][2] + h[0] * Math.hypot(A[p][1][0] - A[p][0][0], A[p][1][1] - A[p][0][1]);
          const lb = B[q][2] + h[1] * Math.hypot(B[q][1][0] - B[q][0][0], B[q][1][1] - B[q][0][1]);
          const k = crosses.length;
          const va: Visit = { curve: i, at: la, cross: k };
          const vb: Visit = { curve: j, at: lb, cross: k };
          visits[i].push(va);
          visits[j].push(vb);
          crosses.push([va, vb]);
        }
    }
  const idx = new Map<Visit, number>();
  for (const vs of visits) {
    vs.sort((a, b) => a.at - b.at);
    vs.forEach((v, k) => idx.set(v, k));
  }
  // чётность каждой кривой — перебором (кривых немного)
  const nc = Math.min(curves.length, 12);
  let best = 0;
  let bestOk = -1;
  for (let m = 0; m < 1 << nc; m++) {
    let ok = 0;
    for (const [a, b] of crosses) {
      const oa = (idx.get(a)! + ((m >> a.curve) & 1)) % 2 === 0;
      const ob = (idx.get(b)! + ((m >> b.curve) & 1)) % 2 === 0;
      if (oa !== ob) ok++;
    }
    if (ok > bestOk) {
      bestOk = ok;
      best = m;
    }
  }
  const over = (v: Visit) => (idx.get(v)! + ((best >> v.curve) & 1)) % 2 === 0;

  const full = (pts: Pt[], closed: boolean) => {
    const p = d(pts, closed);
    let o = '';
    if (rib.shadow)
      o += `<path d="${p}" fill="none" stroke="${rib.shadow}" stroke-width="${f(rib.w + 2 * rib.edge)}" stroke-linejoin="round" transform="translate(${f(rib.w * 0.18)} ${f(rib.w * 0.28)})"/>`;
    o += `<path d="${p}" fill="none" stroke="${rib.stroke}" stroke-width="${f(rib.w + 2 * rib.edge)}" stroke-linejoin="round"/>`;
    o += `<path d="${p}" fill="none" stroke="${rib.fill}" stroke-width="${f(rib.w)}" stroke-linejoin="round"/>`;
    if (rib.shine) o += `<path d="${p}" fill="none" stroke="${rib.shine}" stroke-width="${f(rib.w * 0.22)}" stroke-linejoin="round" transform="translate(${f(-rib.w * 0.16)} ${f(-rib.w * 0.2)})"/>`;
    if (rib.groove) o += `<path d="${p}" fill="none" stroke="${rib.groove}" stroke-width="${f(rib.w * 0.16)}" stroke-linejoin="round"/>`;
    return o;
  };
  let out = '';
  curves.forEach((c, i) => (out += full(c.pts, !!c.closed && i >= 0)));
  // верхние куски у перекрёстков: без тени, обводка шире куска не выходит за концы
  const top = (pts: Pt[]) => {
    const p = d(pts);
    let o = `<path d="${p}" fill="none" stroke="${rib.stroke}" stroke-width="${f(rib.w + 2 * rib.edge)}" stroke-linecap="butt"/>`;
    o += `<path d="${p}" fill="none" stroke="${rib.fill}" stroke-width="${f(rib.w)}"/>`;
    if (rib.shine) o += `<path d="${p}" fill="none" stroke="${rib.shine}" stroke-width="${f(rib.w * 0.22)}" transform="translate(${f(-rib.w * 0.16)} ${f(-rib.w * 0.2)})"/>`;
    if (rib.groove) o += `<path d="${p}" fill="none" stroke="${rib.groove}" stroke-width="${f(rib.w * 0.16)}"/>`;
    return o;
  };
  // кусок не должен доставать до соседнего перекрёстка на той же кривой (там она может быть снизу)
  const lens = all.map((ss) => (ss.length ? ss[ss.length - 1][2] + Math.hypot(ss[ss.length - 1][1][0] - ss[ss.length - 1][0][0], ss[ss.length - 1][1][1] - ss[ss.length - 1][0][1]) : 0));
  const reach = (v: Visit, dir: 1 | -1) => {
    const vs = visits[v.curve];
    const k = idx.get(v)!;
    const c = curves[v.curve];
    const j = k + dir;
    let gap = Infinity;
    if (j >= 0 && j < vs.length) gap = Math.abs(vs[j].at - v.at);
    else if (c.closed && vs.length > 1) gap = dir > 0 ? lens[v.curve] - v.at + vs[0].at : v.at + lens[v.curve] - vs[vs.length - 1].at;
    return Math.min(r, gap * 0.45);
  };
  for (const [a, b] of crosses) {
    const v = over(a) ? a : b;
    out += top(slice(curves[v.curve], v.at - reach(v, -1), v.at + reach(v, 1)));
  }
  return out;
}

/**
 * Плетёнка вдоль отрезка (ax, ay) → (bx, by) шириной H: k лент-зигзагов со скруглёнными поворотами у кромок.
 * Концы ленты свисают за отрезок на полпериода — их закрывают угловые узлы.
 */
export function plait(ax: number, ay: number, bx: number, by: number, H: number, k = 2, margin = 0.18): Curve[] {
  const L = Math.hypot(bx - ax, by - ay);
  const ux = (bx - ax) / L;
  const uy = (by - ay) / L;
  const nx = -uy;
  const ny = ux;
  const amp = (H / 2) * (1 - 2 * margin);
  // полупериод — чтобы наклон был около 45°, и чтобы на длину ложилось целое число периодов
  const P0 = 2 * amp;
  const P = L / Math.max(1, Math.round(L / P0));
  const out: Curve[] = [];
  const ext = P;
  for (let s = 0; s < k; s++) {
    const ph = (2 * P * s) / k;
    const pts: Pt[] = [];
    const N = Math.ceil(((L + 2 * ext) / P) * 14);
    for (let i = 0; i <= N; i++) {
      const t = -ext + ((L + 2 * ext) * i) / N;
      const w = (2 / Math.PI) * Math.asin(0.93 * Math.sin((Math.PI * (t + ph)) / P)) * amp;
      pts.push([ax + ux * t + nx * w, ay + uy * t + ny * w]);
    }
    out.push({ pts });
  }
  return out;
}

/** Узел-трикветр (проекция трилистника) с переплетённым кольцом. */
export function triquetra(cx: number, cy: number, R: number, ring = true, rot = 0): Curve[] {
  const pts: Pt[] = [];
  const N = 180;
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2;
    // трилистник: петли наружу
    const x = Math.sin(t) + 2 * Math.sin(2 * t);
    const y = Math.cos(t) - 2 * Math.cos(2 * t);
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    pts.push([cx + ((x * c - y * s) * R) / 3, cy + ((x * s + y * c) * R) / 3]);
  }
  const out: Curve[] = [{ pts, closed: true }];
  if (ring) {
    const rp: Pt[] = [];
    for (let i = 0; i < 120; i++) {
      const a = (i / 120) * Math.PI * 2;
      rp.push([cx + Math.cos(a) * R * 0.64, cy + Math.sin(a) * R * 0.64]);
    }
    out.push({ pts: rp, closed: true });
  }
  return out;
}

/** Квадратный узел «Соломонов»: две переплетённые петли-кольца, вытянутые в квадрат. */
export function solomon(cx: number, cy: number, R: number): Curve[] {
  const loop = (rot: number): Curve => {
    const pts: Pt[] = [];
    for (let i = 0; i < 160; i++) {
      const a = (i / 160) * Math.PI * 2;
      // овал-«стадион», повёрнутый
      const x = Math.cos(a) * R * 0.95;
      const y = Math.sin(a) * R * 0.38;
      pts.push([cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)]);
    }
    return { pts, closed: true };
  };
  return [loop(Math.PI / 4), loop(-Math.PI / 4)];
}

/** Трискель: три спирали из центра (путь для обводки). */
export function triskele(cx: number, cy: number, R: number, rot = 0, turns = 1.6): string {
  let o = '';
  for (let k = 0; k < 3; k++) {
    const th = rot + (k * 2 * Math.PI) / 3;
    const c = Math.cos(th);
    const s = Math.sin(th);
    const C: Pt = [R * 0.5, 0];
    const r0 = R * 0.5;
    const Phi = turns * 2 * Math.PI;
    const pts: Pt[] = [];
    const N = 70;
    for (let i = 0; i <= N; i++) {
      const phi = (i / N) * Phi;
      const rr = r0 * (1 - (phi / Phi) * 0.92);
      const a = Math.PI + phi;
      const x = C[0] + Math.cos(a) * rr;
      const y = C[1] - Math.sin(a) * rr;
      pts.push([cx + x * c - y * s, cy + x * s + y * c]);
    }
    o += d(pts);
  }
  return o;
}

/** «Кольцо с точкой» — резной глазок на кости. */
export function ringDot(x: number, y: number, r: number, ink: string, w: number): string {
  return `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="none" stroke="${ink}" stroke-width="${f(w)}"/><circle cx="${f(x)}" cy="${f(y)}" r="${f(r * 0.3)}" fill="${ink}"/>`;
}
