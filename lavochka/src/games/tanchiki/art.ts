/* Танчики: картинки поля — сгенерированы Z-Image (studio/jobs/tanchiki/02-art.yaml), вырезаны BiRefNet,
 * подогнаны studio/jobs/tanchiki/export_art.py → public/tanchiki/art/. Код только раскладывает их и тонирует.
 *
 * Танки — по два кадра гусениц в ряд (стволом вверх, поворот — поворотом картинки); покрытия — бесшовные плитки на 16 единиц поля
 * (кирпич режется на куски 4×4 из той же плитки — выбитые куски просто не рисуются), вода — три кадра. */

const DIR = '/tanchiki/art/';

export const TANKS = ['tank-p1', 'tank-p2', 'enemy-0', 'enemy-1', 'enemy-2', 'enemy-3'] as const;
export const BONUS_ART = ['helmet', 'clock', 'shovel', 'star', 'grenade', 'tank'] as const;
const FILES = [
  ...TANKS,
  'brick',
  'steel',
  'water-0',
  'water-1',
  'water-2',
  'ice',
  'ground',
  'bush-0',
  'bush-1',
  'bush-2',
  'base',
  'base-ruin',
  ...BONUS_ART.map((b) => `bonus-${b}`),
  'shell',
  'boom-0',
  'boom-1',
  'boom-2',
  'spawn',
  'flag',
  'bg',
] as const;
export type ArtName = (typeof FILES)[number];

const imgs = new Map<string, HTMLImageElement>();
let loading: Promise<void> | null = null;

/** Загрузить всё (один раз на страницу); готовность — `ready()`. */
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
export const ready = () => imgs.size > 0;

/** Тонированная копия (броневик по запасу брони, мигающий носитель бонуса): цвет умножается на картинку, прозрачность — её. */
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

/** Плитка покрытия (бесшовная на 16 единиц поля): кусок w×h в точке поля (x, y) — вырезка из плитки по тем же координатам. */
export function tile(g: CanvasRenderingContext2D, im: CanvasImageSource & { width: number }, x: number, y: number, w: number, h: number, period = 16) {
  const k = im.width / period;
  const sx = ((x % period) + period) % period;
  const sy = ((y % period) + period) % period;
  g.drawImage(im, sx * k, sy * k, w * k, h * k, x, y, w, h);
}
