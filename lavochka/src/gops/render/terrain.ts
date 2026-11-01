/* Картинка ландшафта: текстура грунта темы, вырезанная по маске, кромка по верхней поверхности,
 * после взрыва — пересчёт только рамки воронки (с подпалиной по краю). Холст 1:1 с маской. */
import { Sprite, Texture } from 'pixi.js';
import type { Mask } from '../sim/mask';

/** Кромка: сколько пикселей вниз от поверхности светлее (дёрн), и тень под ней. */
const CRUST = 5;
const SHADE = 7;

export class TerrainLayer {
  readonly sprite: Sprite;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly tex: Texture;
  /** Исходная (до взрывов) картинка грунта без маски — из неё дорисовываем открытые края. */
  private base!: ImageData;

  constructor(private readonly mask: Mask, ground: HTMLImageElement | null) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = mask.w;
    this.canvas.height = mask.h;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
    this.paintBase(ground);
    this.compose();
    this.tex = Texture.from(this.canvas);
    this.sprite = new Sprite(this.tex);
  }

  private paintBase(ground: HTMLImageElement | null): void {
    const { ctx, mask } = this;
    if (ground) {
      ctx.fillStyle = ctx.createPattern(ground, 'repeat')!;
    } else {
      ctx.fillStyle = '#5b4a36';
    }
    ctx.fillRect(0, 0, mask.w, mask.h);
    this.base = ctx.getImageData(0, 0, mask.w, mask.h);
  }

  /** Полная сборка: альфа по маске, кромка по верхней поверхности. */
  private compose(): void {
    const { mask } = this;
    const img = new ImageData(new Uint8ClampedArray(this.base.data), mask.w, mask.h);
    const px = img.data, d = mask.d, w = mask.w;
    for (let x = 0; x < w; x++) {
      let depth = -1; // сколько пикселей прошли вниз от последней поверхности
      for (let y = 0; y < mask.h; y++) {
        const i = y * w + x, o = i * 4;
        if (!d[i]) {
          px[o + 3] = 0;
          depth = -1;
          continue;
        }
        depth = depth < 0 ? 0 : depth + 1;
        if (depth < CRUST) light(px, o, 1.35 - depth * 0.05);
        else if (depth < CRUST + SHADE) light(px, o, 0.7 + ((depth - CRUST) / SHADE) * 0.3);
      }
    }
    this.ctx.putImageData(img, 0, 0);
  }

  /** После изменения маски в круге: открытое — прозрачно, свежий край — подпалина. */
  carve(cx: number, cy: number, r: number, scorch = true): void {
    const { mask } = this;
    const pad = 6;
    const x0 = Math.max(0, cx - r - pad), y0 = Math.max(0, cy - r - pad);
    const x1 = Math.min(mask.w, cx + r + pad + 1), y1 = Math.min(mask.h, cy + r + pad + 1);
    if (x0 >= x1 || y0 >= y1) return;
    const img = this.ctx.getImageData(x0, y0, x1 - x0, y1 - y0);
    const px = img.data, rr = r * r, ro = (r + pad) * (r + pad);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const o = ((y - y0) * (x1 - x0) + (x - x0)) * 4;
        if (!mask.d[y * mask.w + x]) {
          px[o + 3] = 0;
          continue;
        }
        const dd = (x - cx) * (x - cx) + (y - cy) * (y - cy);
        if (scorch && dd > rr && dd <= ro && px[o + 3]) light(px, o, 0.55 + 0.45 * ((dd - rr) / (ro - rr)));
      }
    }
    this.ctx.putImageData(img, x0, y0);
    this.tex.source.update();
  }

  /** Бетонная плита по маске (капсула). */
  girder(x0: number, y0: number, x1: number, y1: number, r: number): void {
    const c = this.ctx;
    c.save();
    c.lineCap = 'round';
    c.strokeStyle = '#8f8d86';
    c.lineWidth = r * 2 + 1;
    c.beginPath();
    c.moveTo(x0, y0);
    c.lineTo(x1, y1);
    c.stroke();
    c.strokeStyle = '#b9b6ad';
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(x0, y0 - r + 1);
    c.lineTo(x1, y1 - r + 1);
    c.stroke();
    c.restore();
    this.tex.source.update();
  }

  /** Маска поменялась целиком (новая карта или правка) — собрать заново. */
  rebuild(): void {
    this.compose();
    this.tex.source.update();
  }
}

function light(px: Uint8ClampedArray, o: number, k: number): void {
  px[o] = px[o] * k;
  px[o + 1] = px[o + 1] * k;
  px[o + 2] = px[o + 2] * k;
}
