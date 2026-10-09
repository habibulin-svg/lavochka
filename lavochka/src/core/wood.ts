/* Процедурная текстура дерева (canvas → data URL). Общая для досок и фигур: нарды, шахматы, шашки. */

export interface WoodKind {
  /** Светлый тон, тёмный тон волокна, цвет самых тёмных колец и сучков. */
  light: [number, number, number];
  dark: [number, number, number];
  deep: [number, number, number];
  /** Частота годовых колец (больше — чаще полосы). */
  rings?: number;
  /** Насколько волокно вытянуто вдоль (больше — длиннее). */
  stretch?: number;
  /** Сила волокон-ниточек. */
  fiber?: number;
}

export const WOODS = {
  /** Липа / сосна — поле ручных нард. */
  linden: { light: [238, 206, 150], dark: [206, 160, 98], deep: [160, 108, 52], rings: 0.03, stretch: 0.018, fiber: 0.3 },
  /** Орех под лаком — рамка. */
  walnut: { light: [128, 70, 34], dark: [86, 42, 18], deep: [52, 22, 8], rings: 0.04, stretch: 0.02, fiber: 0.35 },
  /** Клён — светлые шашки. */
  maple: { light: [246, 228, 196], dark: [222, 196, 152], deep: [190, 156, 108], rings: 0.05, stretch: 0.03, fiber: 0.25 },
  /** Венге / морёный дуб — тёмные шашки. */
  wenge: { light: [128, 84, 54], dark: [78, 46, 28], deep: [38, 20, 11], rings: 0.06, stretch: 0.03, fiber: 0.4 },
} satisfies Record<string, WoodKind>;

function mulberry32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeNoise(seed: number) {
  const rnd = mulberry32(seed);
  const G = 256;
  const v = new Float32Array(G * G);
  for (let i = 0; i < v.length; i++) v[i] = rnd();
  const sm = (t: number) => t * t * (3 - 2 * t);
  return (x: number, y: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = sm(x - xi);
    const yf = sm(y - yi);
    const x0 = xi & 255;
    const y0 = yi & 255;
    const x1 = (x0 + 1) & 255;
    const y1 = (y0 + 1) & 255;
    const a = v[y0 * G + x0];
    const b = v[y0 * G + x1];
    const c = v[y1 * G + x0];
    const d = v[y1 * G + x1];
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  };
}

const cache = new Map<string, string>();

/**
 * Квадратная текстура дерева size×size. Волокно идёт вдоль оси Y (vertical) или X.
 * Результат кэшируется: одинаковые параметры — одна картинка на всю страницу.
 */
export function woodTexture(kind: WoodKind, size = 512, seed = 7, vertical = true): string {
  const key = JSON.stringify([kind, size, seed, vertical]);
  const hit = cache.get(key);
  if (hit) return hit;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const n = makeNoise(seed);
  const fbm = (x: number, y: number) => 0.5 * n(x, y) + 0.25 * n(x * 2.03, y * 2.03) + 0.125 * n(x * 4.1, y * 4.1) + 0.0625 * n(x * 8.3, y * 8.3);
  const rings = kind.rings ?? 0.035;
  const stretch = kind.stretch ?? 0.02;
  const fib = kind.fiber ?? 0.28;
  const sc = 930 / size;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      // волокно вдоль Y: «поперечная» координата — X
      const X = (vertical ? py : px) * sc;
      const Y = (vertical ? px : py) * sc;
      const warp = fbm(X * 0.0035, Y * stretch) * 5 + fbm(X * 0.001, Y * 0.004) * 6;
      const r = Y * rings + warp;
      let ring = r - Math.floor(r);
      ring = Math.pow(Math.sin(ring * Math.PI), 6);
      const fiber = n(X * 0.9, Y * 0.06);
      const blot = fbm(X * 0.006, Y * 0.006);
      let t = 0.42 * ring + fib * fiber + (0.58 - fib) * blot;
      t = Math.min(1, Math.max(0, t));
      let c0 = kind.light;
      let c1 = kind.dark;
      if (t > 0.72) {
        c0 = kind.dark;
        c1 = kind.deep;
        t = (t - 0.72) / 0.28;
      } else t = t / 0.72;
      const i = (py * size + px) * 4;
      img.data[i] = c0[0] + (c1[0] - c0[0]) * t;
      img.data[i + 1] = c0[1] + (c1[1] - c0[1]) * t;
      img.data[i + 2] = c0[2] + (c1[2] - c0[2]) * t;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const url = cv.toDataURL('image/jpeg', 0.9);
  cache.set(key, url);
  return url;
}
