/* Пинбол: детали стола — сгенерированы Z-Image (studio/jobs/pinbol/04-parts.yaml), вырезаны BiRefNet,
 * подогнаны studio/jobs/pinbol/export_art.py → public/pinbol/art/. Код только раскладывает их, тонирует и поворачивает.
 *
 * Белые детали (столбики, мишени, стойки, лампы, рампа, резина) тонируются под цвет стола умножением;
 * текстуры (хромированная рейка, рампа, резина) кладутся полосами вдоль отрезков, пластик и дерево — заливкой-узором. */

const DIR = '/pinbol/art/';

const FILES = [
  'ball',
  'plunger',
  'flipper-park',
  'flipper-disco',
  'flipper-kosmos',
  'bumper-park',
  'bumper-disco',
  'bumper-kosmos',
  'post',
  'drop',
  'standup',
  'saucer',
  'spinner',
  'insert',
  'arrow',
  'rail',
  'ramp',
  'wood',
  'rubber',
  'plastic-park',
  'plastic-disco',
  'plastic-kosmos',
  'carousel',
  'coaster',
  'mirrorball',
  'vinyl',
  'blackhole',
  'rocket',
] as const;
export type ArtName = (typeof FILES)[number];

const imgs = new Map<string, HTMLImageElement>();
let loading: Promise<void> | null = null;

/** Загрузить всё (один раз на страницу). */
export function loadArt(): Promise<void> {
  loading ??= Promise.all(
    FILES.map(
      (f) =>
        new Promise<void>((res) => {
          const im = new Image();
          im.decoding = 'async';
          im.onload = () => {
            imgs.set(f, im);
            res();
          };
          im.onerror = () => res();
          im.src = `${DIR}${f}.webp`;
        })
    )
  ).then(() => {});
  return loading;
}

export const art = (n: ArtName): HTMLImageElement | null => imgs.get(n) ?? null;
/** Сколько картинок уже загружено (ключ кэша статичного слоя). */
export const loaded = () => imgs.size;

/** Тонированная копия: цвет умножается на картинку, прозрачность — её. */
const tints = new Map<string, HTMLCanvasElement>();
export function tinted(n: ArtName, color: string): CanvasImageSource | null {
  const im = art(n);
  if (!im) return null;
  const key = `${n}|${color}`;
  let c = tints.get(key);
  if (!c) {
    c = document.createElement('canvas');
    c.width = im.naturalWidth;
    c.height = im.naturalHeight;
    const g = c.getContext('2d')!;
    g.drawImage(im, 0, 0);
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = color;
    g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(im, 0, 0);
    tints.set(key, c);
  }
  return c;
}

/** Картинка по центру (x, y), размер w×h, поворот a. */
export function sprite(g: CanvasRenderingContext2D, im: CanvasImageSource | null, x: number, y: number, w: number, h: number, a = 0) {
  if (!im) return;
  g.save();
  g.translate(x, y);
  if (a) g.rotate(a);
  g.drawImage(im, -w / 2, -h / 2, w, h);
  g.restore();
}

/** Полоса текстуры вдоль отрезка (рейка, резина, рампа): ширина w, концы чуть заходят за края, чтобы стыки не светились. */
export function strip(g: CanvasRenderingContext2D, im: CanvasImageSource | null, ax: number, ay: number, bx: number, by: number, w: number, over = w / 2) {
  if (!im) return;
  const len = Math.hypot(bx - ax, by - ay);
  if (len < 0.5) return;
  g.save();
  g.translate(ax, ay);
  g.rotate(Math.atan2(by - ay, bx - ax));
  g.drawImage(im, -over, -w / 2, len + over * 2, w);
  g.restore();
}

/** Полосы вдоль ломаной [x0, y0, x1, y1, …]. */
export function stripLine(g: CanvasRenderingContext2D, im: CanvasImageSource | null, pts: number[], w: number) {
  for (let i = 0; i + 3 < pts.length; i += 2) strip(g, im, pts[i], pts[i + 1], pts[i + 2], pts[i + 3], w);
}

/** Узор-заливка (пластик, дерево) с масштабом: k единиц стола на пиксель картинки. */
export function pattern(g: CanvasRenderingContext2D, n: ArtName, k: number): CanvasPattern | null {
  const im = art(n);
  if (!im) return null;
  const p = g.createPattern(im, 'repeat');
  p?.setTransform(new DOMMatrix([k, 0, 0, k, 0, 0]));
  return p;
}

/** Сгладить ломаную (срезание углов Чайкина), концы на месте. */
export function smooth(pts: number[], n = 3): number[] {
  let p = pts;
  for (let k = 0; k < n; k++) {
    const out = [p[0], p[1]];
    for (let i = 0; i + 3 < p.length; i += 2) {
      const [ax, ay, bx, by] = [p[i], p[i + 1], p[i + 2], p[i + 3]];
      out.push(ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25, ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75);
    }
    out.push(p[p.length - 2], p[p.length - 1]);
    p = out;
  }
  return p;
}

/** Ломаная, сдвинутая вбок на d (нормаль — влево по ходу). */
export function offset(pts: number[], d: number): number[] {
  const out: number[] = [];
  const n = pts.length / 2;
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1);
    const b = Math.min(n - 1, i + 1);
    const dx = pts[b * 2] - pts[a * 2];
    const dy = pts[b * 2 + 1] - pts[a * 2 + 1];
    const l = Math.hypot(dx, dy) || 1;
    out.push(pts[i * 2] - (dy / l) * d, pts[i * 2 + 1] + (dx / l) * d);
  }
  return out;
}

/** Лента текстуры вдоль кривой: картинка-полоса (длина — по x) кладётся узкими срезами, повторяясь по длине. */
export function ribbon(g: CanvasRenderingContext2D, im: (CanvasImageSource & { width: number; height: number }) | null, pts: number[], w: number, step = 3) {
  if (!im) return;
  const k = im.height / w;
  let s = 0;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const ax = pts[i];
    const ay = pts[i + 1];
    const dx = pts[i + 2] - ax;
    const dy = pts[i + 3] - ay;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    const a = Math.atan2(dy, dx);
    for (let t = 0; t < len; t += step) {
      const d = Math.min(step, len - t);
      const sx = (s * k) % im.width;
      const sw = Math.min(d * k, im.width - sx);
      g.save();
      g.translate(ax + (dx * t) / len, ay + (dy * t) / len);
      g.rotate(a);
      g.drawImage(im, sx, 0, Math.max(1, sw), im.height, 0, -w / 2, d + 0.7, w);
      g.restore();
      s += d;
    }
  }
}
