/* Кость маджонга в SVG — общая для пасьянса и игры вчетвером.
 * Корпус рисуем сами, как у настоящей кости: лицо слоновой кости, под ним светлый слой и цветная «рубашка» (два слоя пластика),
 * торцы видны снизу и справа. Рисунок лица — из public/mahjong/<набор>/ (см. tools/mahjong/tiles.mjs). */
import { store } from '../../core/settings';

export const PREF_SET = 'mahjong.tiles';
export const PREF_BACK = 'mahjong.back';
export type TileSet = 'jp' | 'hk';
export const SET_CHOICES = [
  { value: 'jp', label: 'японский рисунок' },
  { value: 'hk', label: 'гонконгский рисунок' },
];
export const BACK_CHOICES = [
  { value: 'green', label: 'зелёная' },
  { value: 'blue', label: 'синяя' },
  { value: 'amber', label: 'янтарная' },
];

const BASE = import.meta.env.BASE_URL;
export const tileSet = (): TileSet => (store.get<string>(PREF_SET, 'jp') === 'hk' ? 'hk' : 'jp');
const backOf = () => {
  const b = store.get<string>(PREF_BACK, 'green');
  return b === 'blue' || b === 'amber' ? b : 'green';
};

/** Адрес рисунка: вид кости; red — красная пятёрка (ака-дора). */
export function faceUrl(kind: number, red = false, set = tileSet()): string {
  if (red && (kind === 4 || kind === 13 || kind === 22)) return `${BASE}mahjong/jp/${kind}r.svg`;
  return `${BASE}mahjong/${set}/${kind}.svg`;
}

const BACKS: Record<string, [string, string, string]> = {
  green: ['#2f8a55', '#14522f', '#0d3a20'],
  blue: ['#3a6fb0', '#1c3f72', '#112a4d'],
  amber: ['#e09a2c', '#a8610f', '#6e3c06'],
};

/** Градиенты для костей — один раз в <defs> сцены. id уникальны по префиксу p. */
export function tileDefs(p = 'mj'): string {
  const [b1, b2, b3] = BACKS[backOf()];
  return `<linearGradient id="${p}Face" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fffdf5"/><stop offset=".55" stop-color="#f6f0e0"/><stop offset="1" stop-color="#e6dcc4"/></linearGradient>
    <linearGradient id="${p}Bone" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#efe5cc"/><stop offset="1" stop-color="#cdbf9c"/></linearGradient>
    <linearGradient id="${p}Back" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${b1}"/><stop offset=".6" stop-color="${b2}"/><stop offset="1" stop-color="${b3}"/></linearGradient>
    <linearGradient id="${p}Shine" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".75"/><stop offset=".35" stop-color="#fff" stop-opacity="0"/></linearGradient>`;
}

export interface TileOpts {
  /** Толщина торца в пикселях сцены (вниз-вправо). */
  d?: number;
  cls?: string;
  attrs?: string;
  red?: boolean;
  /** Рубашкой вверх. */
  back?: boolean;
  /** Префикс градиентов. */
  p?: string;
  /** Без тени (рука в ряду — тень общая). */
  noShadow?: boolean;
}

/** Кость лицом вверх в точке (x, y) — левый верхний угол лица, размер w×h. kind < 0 — рубашка. */
export function tileSvg(kind: number, x: number, y: number, w: number, h: number, o: TileOpts = {}): string {
  const d = o.d ?? Math.round(w * 0.12);
  const p = o.p ?? 'mj';
  const r = Math.max(2, w * 0.1);
  const back = o.back || kind < 0;
  const mid = d * 0.5;
  let s = `<g class="mj-tile ${o.cls ?? ''}" transform="translate(${x.toFixed(1)},${y.toFixed(1)})" ${o.attrs ?? ''}>`;
  if (!o.noShadow) s += `<rect class="mj-shadow" x="${d + 1.5}" y="${d + 2.5}" width="${w}" height="${h}" rx="${r}" fill="rgba(0,0,0,.32)"/>`;
  s += `<rect x="${d}" y="${d}" width="${w}" height="${h}" rx="${r}" fill="url(#${p}Back)"/>`;
  s += `<rect x="${mid}" y="${mid}" width="${w}" height="${h}" rx="${r}" fill="url(#${p}Bone)"/>`;
  if (back) {
    s += `<rect class="mj-face" width="${w}" height="${h}" rx="${r}" fill="url(#${p}Back)" stroke="rgba(0,0,0,.35)" stroke-width="1"/>`;
    s += `<rect x="1.5" y="1.5" width="${w - 3}" height="${h - 3}" rx="${r}" fill="url(#${p}Shine)" opacity=".5"/>`;
  } else {
    s += `<rect class="mj-face" width="${w}" height="${h}" rx="${r}" fill="url(#${p}Face)" stroke="#a89878" stroke-width="1"/>`;
    s += `<image href="${faceUrl(kind, o.red)}" x="${(w * 0.04).toFixed(1)}" y="${(h * 0.03).toFixed(1)}" width="${(w * 0.92).toFixed(1)}" height="${(h * 0.94).toFixed(1)}" preserveAspectRatio="xMidYMid meet"/>`;
    s += `<rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="${r}" fill="url(#${p}Shine)" opacity=".55" pointer-events="none"/>`;
  }
  s += `<rect class="mj-hl" width="${w}" height="${h}" rx="${r}"/>`;
  return s + '</g>';
}
