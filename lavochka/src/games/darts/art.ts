/* Дартс: картинки — сгенерированы Z-Image (studio/jobs/darts/01-art.yaml), детали вырезаны BiRefNet, подогнаны
 * studio/jobs/darts/export_art.py → public/darts/art/. Мишень собрана тем же скриптом по точной геометрии (board.ts) из фактур
 * сизаля и проволоки, нарисованных моделью. Код только раскладывает картинки. */

const DIR = '/darts/art/';
const FILES = ['bg', 'cabinet', 'board', 'dart-0', 'dart-1', 'dart-2', 'dart-3'];

/** Разметка картинок (export_art.py печатает её — числа отсюда).
 * cabinet: где в картинке шкафчика круг мишени (центр и радиус края мишени, px картинки) и доски на створках.
 * board: радиус края мишени в картинке мишени (px) — R.board.
 * dart: у каждой расцветки — где остриё (доли ширины/высоты) и отношение высоты картинки к длине дротика. */
export const META = {
  cabinet: { w: 1536, h: 1024, cx: 791, cy: 484, r: 227, box: { x0: 180, y0: 112, x1: 1360, y1: 878 }, left: { x: 240, y: 190, w: 228, h: 650 }, right: { x: 1100, y: 190, w: 196, h: 650 } },
  board: { size: 1100, r: 540 },
  dart: [
    { tipU: 0, tipV: 0.684, aspect: 0.198 },
    { tipU: 0, tipV: 0.596, aspect: 0.2 },
    { tipU: 0, tipV: 0.627, aspect: 0.22 },
    { tipU: 0, tipV: 0.681, aspect: 0.216 },
  ],
};

const imgs = new Map<string, HTMLImageElement>();
let loading: Promise<void> | null = null;

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

export const art = (n: string): HTMLImageElement | null => imgs.get(n) ?? null;
