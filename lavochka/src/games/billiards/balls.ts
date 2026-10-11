/* Бильярд — шары: текстура на сфере (равнопромежуточная развёртка 256×128) и отрисовка «по пикселям» — шар честно поворачивается при качении
 * (номер, полоса, точки на битке уходят под шар), освещён лампами над столом (свой блик от каждой лампы, смещённый к ней),
 * по краю — отражение сукна. Пул: сплошные, полосатые, номера в белом круге; русский: слоновая кость (классика — с номерами), цветной биток;
 * снукер: красные и цветные. Цвета — в линейном пространстве, на выходе обратно в sRGB. */
import type { Variant } from './engine';

const TW = 256;
const TH = 128;

type RGB = [number, number, number];
const hex = (s: string): RGB => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
const lin = (c: RGB): RGB => [(c[0] / 255) ** 2.2, (c[1] / 255) ** 2.2, (c[2] / 255) ** 2.2];

const POOL = ['#f6f3ea', '#f3b905', '#1440a8', '#cf1b1b', '#3e1a73', '#ee5d0d', '#0d6e35', '#6e0f16', '#121212'];
const SNOOKER: Record<number, string> = { 16: '#f0bd0c', 17: '#14703a', 18: '#5c2f16', 19: '#1a3fb0', 20: '#ef7f9f', 21: '#121212' };
const RED_SNOOKER = '#a30d16';
const IVORY = '#efe5cc';
const COLOR_CUE = '#c2401c';

interface Look {
  base: string;
  stripe?: string;
  num?: string;
  /** Номер в белом круге (пул) или прямо по шару (русская классика). */
  circle?: boolean;
  /** Красные точки (биток). */
  dots?: boolean;
  /** Чуть неровный цвет слоновой кости. */
  mottle?: boolean;
}

function lookOf(variant: Variant, id: number): Look {
  if (variant === 'pool8') {
    if (id === 0) return { base: POOL[0], dots: true };
    if (id <= 8) return { base: POOL[id], num: String(id), circle: true };
    return { base: POOL[0], stripe: POOL[id - 8], num: String(id), circle: true };
  }
  if (variant === 'snooker') {
    if (id === 0) return { base: '#f7f5ee' };
    return { base: id <= 15 ? RED_SNOOKER : SNOOKER[id] };
  }
  if (id === 0) return variant === 'classic' ? { base: '#f7f4ea', dots: true } : { base: COLOR_CUE };
  return variant === 'classic' ? { base: IVORY, num: String(id), mottle: true } : { base: IVORY, mottle: true };
}

let glyphCanvas: HTMLCanvasElement | null = null;
function glyph(num: string): Uint8ClampedArray {
  const N = 64;
  if (!glyphCanvas) {
    glyphCanvas = document.createElement('canvas');
    glyphCanvas.width = glyphCanvas.height = N;
  }
  const g = glyphCanvas.getContext('2d', { willReadFrequently: true })!;
  g.clearRect(0, 0, N, N);
  g.fillStyle = '#000';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `bold ${num.length > 1 ? 30 : 36}px Arial, Helvetica, sans-serif`;
  g.fillText(num, N / 2, N / 2 + 2);
  // 6 и 9 подчёркнуты, как на настоящих шарах
  if (num === '6' || num === '9') g.fillRect(N / 2 - 8, N / 2 + 17, 16, 3);
  return g.getImageData(0, 0, N, N).data;
}

const texCache = new Map<string, Float32Array>();

/** Текстура шара: линейный RGB, TW×TH. */
export function ballTexture(variant: Variant, id: number): Float32Array {
  const key = `${variant}:${id}`;
  let t = texCache.get(key);
  if (t) return t;
  const L = lookOf(variant, id);
  t = new Float32Array(TW * TH * 3);
  const base = lin(hex(L.base));
  const white = lin(hex('#f8f6ef'));
  const stripe = L.stripe ? lin(hex(L.stripe)) : null;
  const ink = lin(hex('#141414'));
  const red = lin(hex('#c8141c'));
  const gl = L.num ? glyph(L.num) : null;
  const circA = 0.37;
  const tanA = Math.tan(circA * (L.circle ? 0.78 : 1.0));
  const cosA = Math.cos(circA);
  let seed = id * 7919 + 13;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  // мягкие пятна слоновой кости
  const blobs = L.mottle ? Array.from({ length: 6 }, () => [rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1, (rnd() - 0.5) * 0.06]) : [];
  for (let v = 0; v < TH; v++) {
    const lat = Math.PI / 2 - ((v + 0.5) / TH) * Math.PI;
    const cl = Math.cos(lat);
    const z = Math.sin(lat);
    for (let u = 0; u < TW; u++) {
      const lon = ((u + 0.5) / TW) * 2 * Math.PI - Math.PI;
      const x = cl * Math.cos(lon);
      const y = cl * Math.sin(lon);
      let c: RGB = base;
      if (stripe) c = Math.abs(lat) < 0.62 ? stripe : white;
      if (L.mottle) {
        let k = 0;
        for (const [bx, by, bz, a] of blobs) {
          const d = x * bx + y * by + z * bz;
          k += a * Math.max(0, d) ** 2;
        }
        c = [c[0] * (1 + k), c[1] * (1 + k * 1.1), c[2] * (1 + k * 1.3)];
      }
      if (L.dots) {
        for (const [ax, ay, az] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]])
          if (x * ax + y * ay + z * az > 0.9935) c = red;
      }
      if (gl) {
        // номер — на «экваторе» с двух сторон
        for (const s of [1, -1]) {
          const dx = x * s;
          if (dx < cosA) continue;
          if (L.circle) c = white;
          // проекция на касательную плоскость
          const pu = ((y * s) / dx) / tanA;
          const pv = (-z / dx) / tanA;
          const gx = Math.round((pu * 0.5 + 0.5) * 63);
          const gy = Math.round((pv * 0.5 + 0.5) * 63);
          if (gx >= 0 && gx < 64 && gy >= 0 && gy < 64) {
            const a = gl[(gy * 64 + gx) * 4 + 3] / 255;
            if (a > 0) c = [c[0] * (1 - a) + ink[0] * a, c[1] * (1 - a) + ink[1] * a, c[2] * (1 - a) + ink[2] * a];
          }
        }
      }
      const o = (v * TW + u) * 3;
      t[o] = c[0];
      t[o + 1] = c[1];
      t[o + 2] = c[2];
    }
  }
  texCache.set(key, t);
  return t;
}

/** Ориентация шара — матрица 3×3 (тело → стол), строки подряд. */
export function randomOrientation(seed: number): Float64Array {
  let s = seed * 2654435761 + 1;
  const r = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  const a = r() * Math.PI * 2;
  const b = Math.acos(r() * 1.2 - 0.6);
  const c = r() * Math.PI * 2;
  const m = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  rotate(m, 0, 0, 1, a);
  rotate(m, 1, 0, 0, b - Math.PI / 2);
  rotate(m, 0, 0, 1, c);
  return m;
}

/** Повернуть ориентацию вокруг оси (в системе стола) на угол. */
export function rotate(m: Float64Array, ax: number, ay: number, az: number, th: number) {
  const c = Math.cos(th);
  const s = Math.sin(th);
  const t = 1 - c;
  const r = [
    t * ax * ax + c, t * ax * ay - s * az, t * ax * az + s * ay,
    t * ax * ay + s * az, t * ay * ay + c, t * ay * az - s * ax,
    t * ax * az - s * ay, t * ay * az + s * ax, t * az * az + c,
  ];
  const o = Array.from(m);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) m[i * 3 + j] = r[i * 3] * o[j] + r[i * 3 + 1] * o[3 + j] + r[i * 3 + 2] * o[6 + j];
}

/** Шар прокатился на (dx, dy) — повернуть (ось — поперёк движения). */
export function roll(m: Float64Array, dx: number, dy: number, r: number) {
  const d = Math.hypot(dx, dy);
  if (d < 1e-7) return;
  rotate(m, -dy / d, dx / d, 0, d / r);
}

/** Светильник над столом: центр, высота над сукном, полуразмеры светящегося плафона (м). */
export interface Lamp {
  x: number;
  y: number;
  z: number;
  hx: number;
  hy: number;
}

/** Отрисовщик одного шара в свой маленький холст. */
export class BallSprite {
  canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private img: ImageData | null = null;
  size = 0;
  /** Что нарисовано (чтобы не перерисовывать стоящий шар). */
  key = '';

  constructor() {
    this.canvas = document.createElement('canvas');
    this.g = this.canvas.getContext('2d')!;
  }

  /**
   * rp — радиус в пикселях холста; x, y, r — место и радиус шара на столе (для ламп); rot — стол повёрнут на экране (портрет):
   * экранные оси → оси стола. rim — цвет сукна (линейный) для отражения по краю.
   */
  paint(tex: Float32Array, m: Float64Array, rp: number, x: number, y: number, r: number, lamps: Lamp[], rot: boolean, rim: RGB) {
    const N = Math.ceil(rp * 2 + 2);
    if (N !== this.size) {
      this.size = N;
      this.canvas.width = this.canvas.height = N;
      this.img = this.g.createImageData(N, N);
    }
    const img = this.img!;
    const d = img.data;
    const c = N / 2;
    // лампы: направление от шара (для рассеянного света)
    const L: number[] = [];
    for (const l of lamps) {
      let lx = l.x - x;
      let ly = l.y - y;
      let lz = l.z - r;
      const ll = Math.hypot(lx, ly, lz);
      L.push(lx / ll, ly / ll, lz / ll);
    }
    const nl = lamps.length;
    const kd = 1.0 / nl;
    const m0 = m[0], m1 = m[1], m2 = m[2], m3 = m[3], m4 = m[4], m5 = m[5], m6 = m[6], m7 = m[7], m8 = m[8];
    const inv = 1 / rp;
    const edge = (1 + inv) * (1 + inv);
    for (let py = 0; py < N; py++) {
      const sy = (py + 0.5 - c) * inv;
      for (let px = 0; px < N; px++) {
        const o = (py * N + px) * 4;
        const sx = (px + 0.5 - c) * inv;
        let d2 = sx * sx + sy * sy;
        if (d2 >= edge) {
          d[o + 3] = 0;
          continue;
        }
        const dist = Math.sqrt(d2);
        const alpha = Math.max(0, Math.min(1, (1 - dist) * rp + 0.5));
        let ex = sx;
        let ey = sy;
        if (d2 > 0.998) {
          ex /= dist / 0.999;
          ey /= dist / 0.999;
          d2 = 0.998;
        }
        const nz = Math.sqrt(1 - d2);
        // нормаль в осях стола
        const wx = rot ? ey : ex;
        const wy = rot ? -ex : ey;
        // в осях шара: Mᵀ·n
        const bx = m0 * wx + m3 * wy + m6 * nz;
        const by = m1 * wx + m4 * wy + m7 * nz;
        const bz = m2 * wx + m5 * wy + m8 * nz;
        const lon = Math.atan2(by, bx);
        const lat = Math.asin(bz > 1 ? 1 : bz < -1 ? -1 : bz);
        let tu = Math.floor(((lon + Math.PI) / (2 * Math.PI)) * TW);
        if (tu >= TW) tu = TW - 1;
        let tv = Math.floor(((Math.PI / 2 - lat) / Math.PI) * TH);
        if (tv >= TH) tv = TH - 1;
        const ti = (tv * TW + tu) * 3;
        let diff = 0.18;
        for (let k = 0; k < nl; k++) {
          const nd = wx * L[k * 3] + wy * L[k * 3 + 1] + nz * L[k * 3 + 2];
          if (nd > 0) diff += kd * nd;
        }
        // блик — отражение плафонов: луч взгляда (сверху) отражается от шара и попадает (или нет) в светящийся прямоугольник
        let spec = 0;
        const rz = 2 * nz * nz - 1;
        if (rz > 0.08) {
          const k2 = (2 * nz) / rz;
          for (let k = 0; k < nl; k++) {
            const l = lamps[k];
            const h0 = l.z - r;
            const qx = x + wx * k2 * h0;
            const qy = y + wy * k2 * h0;
            const dx = Math.max(0, Math.abs(qx - l.x) - l.hx);
            const dy = Math.max(0, Math.abs(qy - l.y) - l.hy);
            const dd = (dx * dx + dy * dy) * 900;
            if (dd < 9) spec += Math.exp(-dd) * 1.1;
          }
        }
        // отражение сукна у края, лак — общий «глянец»
        const f = 1 - nz;
        const fr = f * f * 0.55;
        const r0 = tex[ti] * diff * (1 - fr) + rim[0] * fr + spec + 0.012 * nz;
        const g0 = tex[ti + 1] * diff * (1 - fr) + rim[1] * fr + spec + 0.012 * nz;
        const b0 = tex[ti + 2] * diff * (1 - fr) + rim[2] * fr + spec + 0.014 * nz;
        d[o] = Math.sqrt(r0 > 1 ? 1 : r0) * 255;
        d[o + 1] = Math.sqrt(g0 > 1 ? 1 : g0) * 255;
        d[o + 2] = Math.sqrt(b0 > 1 ? 1 : b0) * 255;
        d[o + 3] = alpha * 255;
      }
    }
    this.g.putImageData(img, 0, 0);
  }
}

export const linRGB = (s: string) => lin(hex(s));
