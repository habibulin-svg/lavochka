/* Рисунки настольного баскетбола на canvas — по фото советской коробки: жёлтое пластмассовое поле с щелями лунок
 * и номерами (красный слева от щели, синий справа, читаются спереди), кремовые планки с цифрами у клавиш,
 * корзинка-решётка, надпись на корпусе. */
import { CELLS, HOLE, HOLE_X, L, NUMS, WD } from './engine';

export const RED = '#c8261c';
export const BLUE = '#2348b8';

function rnd(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Зерно пластмассы: мелкий шум по цвету. */
function grain(c: CanvasRenderingContext2D, w: number, h: number, amp: number, seed: number) {
  const r = rnd(seed);
  const img = c.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * amp;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n * 0.7;
  }
  c.putImageData(img, 0, 0);
}

export const FIELD_PX = 2048;
export const FIELD_PY = Math.round((FIELD_PX * WD) / L);

/** Поле: жёлтая пластмасса, литьевые швы по гребням, щели лунок с бордовым рычагом, номера. */
export function fieldCanvas(): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = FIELD_PX;
  cv.height = FIELD_PY;
  const c = cv.getContext('2d')!;
  const k = FIELD_PX / L;
  const X = (x: number) => (x + L / 2) * k;
  const Z = (z: number) => (z + WD / 2) * k;
  const r = rnd(77);
  c.fillStyle = '#f2cf1e';
  c.fillRect(0, 0, FIELD_PX, FIELD_PY);
  grain(c, FIELD_PX, FIELD_PY, 6, 3);
  // следы пальцев и мелкие царапины на глянце
  for (let i = 0; i < 220; i++) {
    const x = r() * FIELD_PX;
    const y = r() * FIELD_PY;
    const a = r() * Math.PI;
    const l = 5 + r() * 30;
    c.strokeStyle = `rgba(${r() < 0.5 ? '160,120,10' : '255,245,190'},${0.08 + r() * 0.14})`;
    c.lineWidth = 0.7 + r();
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    c.stroke();
  }
  // гребни: тонкий светлый блик по стыку ямок
  for (const cl of CELLS) {
    c.strokeStyle = 'rgba(255,246,190,0.75)';
    c.lineWidth = 2.5;
    c.strokeRect(X(cl.x0) + 1, Z(cl.z0) + 1, X(cl.x1) - X(cl.x0) - 2, Z(cl.z1) - Z(cl.z0) - 2);
  }
  const hx = HOLE_X * k;
  const hz = HOLE * k;
  CELLS.forEach((cl, i) => {
    const x = X(cl.hx);
    const y = Z(cl.hz);
    // щель: тёмная глубина, по краю — тень от стенки, внутри бордовый рычаг катапульты
    c.fillStyle = '#1c0705';
    c.fillRect(x - hx, y - hz, hx * 2, hz * 2);
    const g = c.createLinearGradient(0, y - hz, 0, y + hz);
    g.addColorStop(0, 'rgba(110,26,16,0.2)');
    g.addColorStop(0.55, 'rgba(150,40,26,0.95)');
    g.addColorStop(1, 'rgba(90,20,12,0.6)');
    c.fillStyle = g;
    c.fillRect(x - hx * 0.78, y - hz * 0.35, hx * 1.56, hz * 1.1);
    c.strokeStyle = 'rgba(130,90,5,0.85)';
    c.lineWidth = 4;
    c.strokeRect(x - hx - 2, y - hz - 2, hx * 2 + 4, hz * 2 + 4);
    // номера: красный — слева, синий — справа; крупные, жирные, «напечатаны» с лёгким смазом
    digit(c, String(NUMS[0][i]), x - hx - 0.0092 * k, y, 0.0165 * k, RED);
    digit(c, String(NUMS[1][i]), x + hx + 0.0092 * k, y, 0.0165 * k, BLUE);
  });
  return cv;
}

function digit(c: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, col: string) {
  c.save();
  c.translate(x, y);
  c.font = `bold ${size}px "PT Sans", Arial, sans-serif`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.globalAlpha = 0.25;
  c.fillStyle = col;
  c.fillText(s, 1.5, 1.5);
  c.globalAlpha = 0.92;
  c.fillText(s, 0, 0);
  c.restore();
}

/** Кремовая планка клавиш: цифры 1…0 напротив клавиш, по краю — выдавленная рамка. order[i] — цифра в позиции i (сзади вперёд). */
export function panelCanvas(order: number[], col: string): HTMLCanvasElement {
  const W = 256;
  const H = 1536;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#ebe5d2';
  c.fillRect(0, 0, W, H);
  grain(c, W, H, 8, 9);
  c.strokeStyle = 'rgba(150,140,115,0.6)';
  c.lineWidth = 6;
  c.strokeRect(8, 8, W - 16, H - 16);
  const cell = H / 10;
  for (let i = 0; i < 10; i++) {
    const y = i * cell + cell / 2;
    c.font = 'bold 128px "PT Sans", Arial, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = col;
    c.fillText(String(order[i]), W / 2, y + 4);
  }
  return cv;
}

/** Буква клавиатуры на клавише (маленькая, светлая, фон прозрачный). */
export function capCanvas(letter: string): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = 128;
  cv.height = 64;
  const c = cv.getContext('2d')!;
  c.font = 'bold 40px "PT Mono", "Courier New", monospace';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillStyle = 'rgba(255,225,210,0.8)';
  c.fillText(letter, 64, 34);
  return cv;
}

/** Корзинка: белые рёбра и три обруча, между ними дырки (альфа). */
export function netCanvas(): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 128;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#f7f4ea';
  for (let i = 0; i < 10; i++) c.fillRect((i * 512) / 10, 0, 16, 128);
  c.fillRect(0, 0, 512, 12);
  c.fillRect(0, 56, 512, 10);
  c.fillRect(0, 114, 512, 14);
  return cv;
}

/** Щит: голубая полупрозрачная пластмасса, выдавленная белая рамка над кольцом. */
export function boardCanvas(): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 288;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#5f73d8';
  c.fillRect(0, 0, 256, 288);
  grain(c, 256, 288, 10, 5);
  c.strokeStyle = 'rgba(40,52,140,0.8)';
  c.lineWidth = 10;
  c.strokeRect(10, 10, 236, 268);
  c.strokeStyle = 'rgba(235,240,255,0.85)';
  c.lineWidth = 9;
  c.strokeRect(78, 150, 100, 84);
  return cv;
}

/** Надпись на корпусе спереди. */
export function brandCanvas(): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = 1024;
  cv.height = 128;
  const c = cv.getContext('2d')!;
  c.save();
  c.translate(512, 68);
  c.scale(1.3, 1);
  c.font = '900 72px "Arial Black", "PT Sans", Arial, sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillStyle = 'rgba(0,0,30,0.35)';
  c.fillText('БАСКЕТБОЛ', 2, 4);
  c.fillStyle = '#efe8d2';
  c.fillText('БАСКЕТБОЛ', 0, 0);
  c.restore();
  return cv;
}
