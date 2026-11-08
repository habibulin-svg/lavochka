/* Викторина: картинки студии — сгенерированы Z-Image (studio/jobs/viktorina/01-art.yaml), детали вырезаны BiRefNet,
 * барабан собран по точной геометрии секторов из лаковых фактур модели (studio/jobs/viktorina/export_art.py) → public/viktorina/art/.
 * Код только раскладывает картинки (CSS-фоны). */

const DIR = '/viktorina/art/';
export const ART = {
  bg: `${DIR}bg.webp`,
  bgTall: `${DIR}bg-tall.webp`,
  wheel: `${DIR}wheel.webp`,
  pointer: `${DIR}pointer.webp`,
  buzzer: `${DIR}buzzer.webp`,
  buzzerLit: `${DIR}buzzer-lit.webp`,
  podium: `${DIR}podium.webp`,
  plate: `${DIR}plate.webp`,
  tile: `${DIR}tile.webp`,
  panel: `${DIR}panel.webp`,
};

/** Доля радиуса диска секторов от стороны картинки барабана (export_art.py печатает её). */
export const WHEEL_DISK = 0.385;

/** Подгрузить заранее (без мигания при смене режима). */
export function preloadArt() {
  for (const src of Object.values(ART)) {
    const im = new Image();
    im.decoding = 'async';
    im.src = src;
  }
}

export const MUSIC = ['/viktorina/music/studio.ogg', '/viktorina/music/think.ogg'];
