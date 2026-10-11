/* Холдем 3D — текстуры, нарисованные на canvas: печать на сукне, рисунок обоев, ночной двор за окном, тюль, фишки, баттон.
 * Фактуры материалов (кожа, дерево, паркет, ткань) — фотографии, см. pbr.ts. */
import * as THREE from 'three';

type Paint = (g: CanvasRenderingContext2D, w: number, h: number) => void;

export function canvasTex(w: number, h: number, paint: Paint, repeat: [number, number] | number = 1, color = true): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  paint(c.getContext('2d')!, w, h);
  const t = new THREE.CanvasTexture(c);
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  const [rx, ry] = typeof repeat === 'number' ? [repeat, repeat] : repeat;
  if (rx !== 1 || ry !== 1) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rx, ry);
  }
  t.anisotropy = 8;
  return t;
}

/** Предсказуемый шум: одинаковые текстуры при каждом запуске. */
function rnd(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/** Крапинки поверх заливки. */
function speckle(g: CanvasRenderingContext2D, w: number, h: number, amount: number, n: number, seed: number, size = 1.5) {
  const r = rnd(seed);
  for (let i = 0; i < n; i++) {
    const v = r() < 0.5 ? 0 : 255;
    g.fillStyle = `rgba(${v},${v},${v},${r() * amount})`;
    g.fillRect(r() * w, r() * h, 1 + r() * size, 1 + r() * size);
  }
}

// ---------------------------------------------------------------- сукно

/** Сукно: ровный зелёный с ворсом, напечатанная линия ставок, рамка для общих карт и надпись. UV — эллипс стола в квадрат. */
export function feltTexture(): THREE.Texture {
  const W = 2048;
  const H = 1272;
  const map = canvasTex(W, H, (g) => {
    const gr = g.createRadialGradient(W / 2, H * 0.46, 60, W / 2, H / 2, W * 0.62);
    gr.addColorStop(0, '#2c8a52');
    gr.addColorStop(0.55, '#1d6a3c');
    gr.addColorStop(1, '#114628');
    g.fillStyle = gr;
    g.fillRect(0, 0, W, H);
    speckle(g, W, H, 0.07, 160000, 7, 1.2);
    // линия ставок — овал внутри стола
    g.strokeStyle = 'rgba(255, 226, 150, 0.28)';
    g.lineWidth = 6;
    g.beginPath();
    g.ellipse(W / 2, H / 2, W * 0.36, H * 0.33, 0, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 2;
    g.beginPath();
    g.ellipse(W / 2, H / 2, W * 0.36 - 14, H * 0.33 - 14, 0, 0, Math.PI * 2);
    g.stroke();
    // рамка для пяти общих карт
    g.strokeStyle = 'rgba(255, 226, 150, 0.22)';
    g.lineWidth = 4;
    g.beginPath();
    g.roundRect(W / 2 - 580, 396, 1160, 352, 44);
    g.stroke();
    // надпись и масти
    g.fillStyle = 'rgba(255, 226, 150, 0.2)';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = 'italic 64px Georgia, "Times New Roman", serif';
    g.fillText('Вечером на лавочке', W / 2, H / 2 + 345);
    g.font = '40px Georgia, serif';
    g.fillText('♠  ♥  ♣  ♦', W / 2, H / 2 + 405);
    g.font = 'bold 30px Georgia, serif';
    g.fillText('ТЕХАССКИЙ  ХОЛДЕМ', W / 2, 360);
  });
  return map;
}

// ---------------------------------------------------------------- комната

/** Обои: бежевые с выцветшим узором — полосы и цветочки. */
export function wallpaperTex(repeat: [number, number]): THREE.CanvasTexture {
  return canvasTex(
    512,
    512,
    (g, w, h) => {
      g.fillStyle = '#c9b48a';
      g.fillRect(0, 0, w, h);
      for (let x = 0; x < w; x += 128) {
        g.fillStyle = 'rgba(120, 90, 50, 0.12)';
        g.fillRect(x + 54, 0, 20, h);
        g.fillStyle = 'rgba(255, 245, 220, 0.15)';
        g.fillRect(x + 50, 0, 3, h);
        g.fillRect(x + 75, 0, 3, h);
      }
      const flower = (cx: number, cy: number) => {
        g.save();
        g.translate(cx, cy);
        g.fillStyle = 'rgba(140, 70, 50, 0.32)';
        for (let i = 0; i < 6; i++) {
          g.rotate(Math.PI / 3);
          g.beginPath();
          g.ellipse(0, 9, 4.5, 9, 0, 0, Math.PI * 2);
          g.fill();
        }
        g.fillStyle = 'rgba(200, 160, 60, 0.5)';
        g.beginPath();
        g.arc(0, 0, 4, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = 'rgba(80, 100, 50, 0.35)';
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(0, 18);
        g.quadraticCurveTo(10, 34, 0, 50);
        g.stroke();
        g.restore();
      };
      for (let y = 0; y < h; y += 128)
        for (let x = 0; x < w; x += 128) {
          flower(x, y + 20);
          flower(x + 64, y + 84);
        }
      speckle(g, w, h, 0.06, 12000, 13);
    },
    repeat
  );
}

/** Ночной двор за окном: небо, пятиэтажки с горящими окнами, фонарь, деревья. */
export function nightTex(): THREE.CanvasTexture {
  return canvasTex(512, 512, (g, w, h) => {
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#0a1430');
    sky.addColorStop(0.6, '#1c2a52');
    sky.addColorStop(1, '#2a2a3a');
    g.fillStyle = sky;
    g.fillRect(0, 0, w, h);
    const r = rnd(29);
    g.fillStyle = 'rgba(255,255,255,0.8)';
    for (let i = 0; i < 60; i++) g.fillRect(r() * w, r() * h * 0.4, 1, 1);
    // луна
    g.fillStyle = '#f4ecc8';
    g.beginPath();
    g.arc(410, 80, 26, 0, Math.PI * 2);
    g.fill();
    const house = (x: number, y: number, ww: number, floors: number, cols: number) => {
      g.fillStyle = '#141824';
      g.fillRect(x, y, ww, h - y);
      const fh = (h - y) / floors;
      const cw = ww / cols;
      for (let f = 0; f < floors; f++)
        for (let c = 0; c < cols; c++) {
          const lit = r() < 0.38;
          g.fillStyle = lit ? (r() < 0.3 ? '#9fc4ff' : '#ffd27a') : '#1e2433';
          g.fillRect(x + c * cw + cw * 0.25, y + f * fh + fh * 0.25, cw * 0.5, fh * 0.45);
        }
    };
    house(-20, 230, 260, 5, 10);
    house(280, 260, 260, 5, 9);
    // деревья
    g.fillStyle = '#0a0e14';
    for (let i = 0; i < 9; i++) {
      g.beginPath();
      g.arc(i * 64 + r() * 20, 440 + r() * 20, 40 + r() * 20, 0, Math.PI * 2);
      g.fill();
    }
    // фонарь
    g.fillStyle = '#222';
    g.fillRect(250, 330, 5, 182);
    const glow = g.createRadialGradient(252, 330, 2, 252, 330, 60);
    glow.addColorStop(0, 'rgba(255, 220, 140, 0.95)');
    glow.addColorStop(1, 'rgba(255, 220, 140, 0)');
    g.fillStyle = glow;
    g.fillRect(180, 260, 150, 150);
  });
}

/** Тюль: полупрозрачный белый с узором. */
export function tulleTex(): THREE.CanvasTexture {
  return canvasTex(
    256,
    256,
    (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(255,255,255,0.7)';
      g.lineWidth = 2;
      for (let y = 0; y < h; y += 64)
        for (let x = 0; x < w; x += 64) {
          g.beginPath();
          g.arc(x + 32, y + 32, 18, 0, Math.PI * 2);
          g.stroke();
          g.beginPath();
          g.arc(x + 32, y + 32, 6, 0, Math.PI * 2);
          g.stroke();
        }
      for (let x = 0; x < w; x += 8) {
        g.fillStyle = 'rgba(255,255,255,0.18)';
        g.fillRect(x, 0, 2, h);
      }
    },
    [3, 4]
  );
}

// ---------------------------------------------------------------- фишки

export interface ChipKind {
  v: number;
  color: string;
  edge: string;
  ink: string;
}

export const CHIP_KINDS: ChipKind[] = [
  { v: 500, color: '#5b2a8a', edge: '#f1e6ff', ink: '#f1e6ff' },
  { v: 100, color: '#161616', edge: '#f1f1f1', ink: '#f6e2a0' },
  { v: 25, color: '#1f7a3a', edge: '#f4fff0', ink: '#ffffff' },
  { v: 5, color: '#b5221a', edge: '#fff2ee', ink: '#ffffff' },
  { v: 1, color: '#e8e4da', edge: '#2a5aa8', ink: '#2a5aa8' },
];

/** Бок фишки: шесть вставок-«кирпичиков» и тонкие полоски. */
export function chipSideTex(k: ChipKind): THREE.CanvasTexture {
  return canvasTex(512, 32, (g, w, h) => {
    g.fillStyle = k.color;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 6; i++) {
      const x = (i / 6) * w + 18;
      g.fillStyle = k.edge;
      g.fillRect(x, 0, 48, h);
      g.fillStyle = k.color;
      g.fillRect(x + 14, 0, 4, h);
      g.fillRect(x + 30, 0, 4, h);
    }
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(0, 0, w, 2);
    g.fillRect(0, h - 2, w, 2);
  });
}

/** Верх фишки: вставки по краю (продолжают бок), внутреннее кольцо, номинал. */
export function chipTopTex(k: ChipKind): THREE.CanvasTexture {
  return canvasTex(256, 256, (g, w) => {
    const c = w / 2;
    g.fillStyle = k.color;
    g.beginPath();
    g.arc(c, c, c, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = k.edge;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      g.beginPath();
      g.arc(c, c, c, a, a + 0.6);
      g.arc(c, c, c - 26, a + 0.6, a, true);
      g.closePath();
      g.fill();
    }
    // вкладыш
    g.fillStyle = 'rgba(255,255,255,0.1)';
    g.beginPath();
    g.arc(c, c, c - 40, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = k.edge;
    g.lineWidth = 3;
    g.setLineDash([6, 6]);
    g.beginPath();
    g.arc(c, c, c - 44, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = k.ink;
    g.font = `bold ${k.v >= 100 ? 60 : 70}px Georgia, serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(k.v), c, c + 4);
  });
}

/** Баттон дилера. */
export function buttonTex(): THREE.CanvasTexture {
  return canvasTex(256, 256, (g, w) => {
    const c = w / 2;
    g.fillStyle = '#f6f1e2';
    g.beginPath();
    g.arc(c, c, c, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#2a1a0a';
    g.lineWidth = 6;
    g.beginPath();
    g.arc(c, c, c - 18, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = '#2a1a0a';
    g.font = 'bold 120px Georgia, serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('D', c, c + 8);
    g.font = 'bold 22px Georgia, serif';
    g.fillText('ДИЛЕР', c, c + 84);
  });
}
