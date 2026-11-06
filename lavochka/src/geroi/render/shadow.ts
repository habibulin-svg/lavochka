/* Мягкая тень-эллипс под спрайтом без «своего клочка земли» (декор карты, препятствия боя). Одна текстура на всех. */
import { Sprite, Texture } from 'pixi.js';

let tex: Texture | null = null;

function shadowTexture(): Texture {
  if (tex) return tex;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.translate(64, 32);
  g.scale(1, 0.5);
  const r = g.createRadialGradient(0, 0, 0, 0, 0, 62);
  r.addColorStop(0, 'rgba(10,14,6,0.55)');
  r.addColorStop(0.55, 'rgba(10,14,6,0.32)');
  r.addColorStop(1, 'rgba(10,14,6,0)');
  g.fillStyle = r;
  g.beginPath();
  g.arc(0, 0, 62, 0, Math.PI * 2);
  g.fill();
  tex = Texture.from(c);
  return tex;
}

/** Тень шириной w (в пикселях сцены) с центром в (x, y); чуть сдвинута вправо-вниз — свет слева сверху. */
export function shadowSprite(x: number, y: number, w: number): Sprite {
  const s = new Sprite(shadowTexture());
  s.anchor.set(0.5);
  s.width = w;
  s.height = w * 0.42;
  s.position.set(x + w * 0.08, y + w * 0.02);
  return s;
}
