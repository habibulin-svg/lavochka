/* Рисунки настольного футбола «Kopana» на canvas — по фото пользователя: зелёная жесть в мелкий тёмный рубчик,
 * белая разметка, вырезы под рычаги вратарей, надпись по борту подноса, сетка ворот, мяч. */
import { CORNER, LX, LZ, TX, TZ } from './engine';

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

/** Рубчик: шаг штрихов вдоль поля и между рядами, длина и ширина штриха (м). */
export const DASH = { x: 0.0038, z: 0.0082, l: 0.0062, w: 0.0017 };

export const FIELD_PX = 3072;
export const FIELD_PY = Math.round((FIELD_PX * TZ) / TX);
/** Вырез под рычаг вратаря (в координатах поля): x от и до (у красных ворот; у синих — зеркально), полуширина по z. */
export const HOLE = { x0: LX - 0.052, x1: LX - 0.03, z: 0.036 };

/** Поле: ярко-зелёная краска, ряды коротких тёмных штрихов-выемок, белые линии, вырезы у ворот. */
export function fieldCanvas(): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = FIELD_PX;
  cv.height = FIELD_PY;
  const c = cv.getContext('2d')!;
  const k = FIELD_PX / (TX * 2);
  const X = (x: number) => (x + TX) * k;
  const Z = (z: number) => (z + TZ) * k;
  const r = rnd(1979);
  c.fillStyle = '#1f9a2e';
  c.fillRect(0, 0, FIELD_PX, FIELD_PY);
  // лёгкая неровность краски
  for (let i = 0; i < 300; i++) {
    c.fillStyle = `rgba(${r() < 0.5 ? '10,60,15' : '120,220,120'},${0.02 + r() * 0.04})`;
    c.beginPath();
    c.arc(r() * FIELD_PX, r() * FIELD_PY, 20 + r() * 120, 0, Math.PI * 2);
    c.fill();
  }
  // рубчик: ряды коротких поперечных штрихов (выштампованные выемки), со сдвигом через ряд
  const stepX = DASH.x * k;
  const stepZ = DASH.z * k;
  const dashL = DASH.l * k;
  const dashW = DASH.w * k;
  let row = 0;
  for (let y = stepZ / 2; y < FIELD_PY; y += stepZ, row++) {
    const off = row % 2 ? stepX / 2 : 0;
    for (let x = off; x < FIELD_PX; x += stepX) {
      c.fillStyle = 'rgba(4,36,10,0.92)';
      c.fillRect(x - dashW / 2, y - dashL / 2, dashW, dashL);
      c.fillStyle = 'rgba(160,240,160,0.18)';
      c.fillRect(x + dashW / 2, y - dashL / 2, dashW * 0.35, dashL);
    }
  }
  // белая разметка
  c.strokeStyle = '#f4f6f2';
  c.lineWidth = 0.0024 * k;
  c.lineJoin = 'miter';
  const rect = (x0: number, z0: number, x1: number, z1: number) => c.strokeRect(X(x0), Z(z0), X(x1) - X(x0), Z(z1) - Z(z0));
  rect(-LX, -LZ, LX, LZ);
  c.beginPath();
  c.moveTo(X(0), Z(-LZ));
  c.lineTo(X(0), Z(LZ));
  c.stroke();
  c.beginPath();
  c.arc(X(0), Z(0), 0.046 * k, 0, Math.PI * 2);
  c.stroke();
  const dot = (x: number, z: number, rr: number) => {
    c.fillStyle = '#f4f6f2';
    c.beginPath();
    c.arc(X(x), Z(z), rr * k, 0, Math.PI * 2);
    c.fill();
  };
  dot(0, 0, 0.0035);
  for (const s of [1, -1]) {
    // штрафная, вратарская, точка и дуга
    const gx = s * LX;
    rect(Math.min(gx, gx - s * 0.08), -0.098, Math.max(gx, gx - s * 0.08), 0.098);
    rect(Math.min(gx, gx - s * 0.03), -0.055, Math.max(gx, gx - s * 0.03), 0.055);
    dot(gx - s * 0.058, 0, 0.003);
    c.beginPath();
    const a = Math.acos(0.022 / 0.04);
    c.arc(X(gx - s * 0.058), Z(0), 0.04 * k, s > 0 ? Math.PI - a : -a, s > 0 ? Math.PI + a : a);
    c.stroke();
    // угловые дуги
    for (const zs of [1, -1]) {
      c.beginPath();
      const cx = X(gx);
      const cz = Z(zs * LZ);
      const a0 = s > 0 ? (zs > 0 ? Math.PI : Math.PI / 2) : zs > 0 ? -Math.PI / 2 : 0;
      c.arc(cx, cz, 0.012 * k, a0, a0 + Math.PI / 2);
      c.stroke();
    }
    // вырез под рычаг вратаря: тёмная дыра с ржавой кромкой
    const x0 = s > 0 ? HOLE.x0 : -HOLE.x1;
    const x1 = s > 0 ? HOLE.x1 : -HOLE.x0;
    c.fillStyle = '#3a2618';
    c.fillRect(X(x0), Z(-HOLE.z), X(x1) - X(x0), Z(HOLE.z) - Z(-HOLE.z));
    const g = c.createLinearGradient(X(x0), 0, X(x1), 0);
    g.addColorStop(0, 'rgba(0,0,0,0.6)');
    g.addColorStop(1, 'rgba(90,60,40,0.2)');
    c.fillStyle = g;
    c.fillRect(X(x0), Z(-HOLE.z), X(x1) - X(x0), Z(HOLE.z) - Z(-HOLE.z));
    c.strokeStyle = 'rgba(150,120,90,0.9)';
    c.lineWidth = 0.0012 * k;
    c.strokeRect(X(x0), Z(-HOLE.z), X(x1) - X(x0), Z(HOLE.z) - Z(-HOLE.z));
    c.strokeStyle = '#f4f6f2';
    c.lineWidth = 0.0024 * k;
  }
  // скругление углов — за ним поднос (прозрачно)
  c.globalCompositeOperation = 'destination-in';
  c.fillStyle = '#000';
  c.beginPath();
  const rr = CORNER * k;
  c.roundRect(0, 0, FIELD_PX, FIELD_PY, rr);
  c.fill();
  c.globalCompositeOperation = 'source-over';
  return cv;
}

/** Рубчик для рельефа (bump): светлое — жесть, тёмное — выштампованный штрих. Плитка: шаг по x × два ряда по z. */
export function dashBumpCanvas(): HTMLCanvasElement {
  const W = 48;
  const H = Math.round((W * 2 * DASH.z) / DASH.x);
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#fff';
  c.fillRect(0, 0, W, H);
  const k = W / DASH.x;
  const dw = DASH.w * k;
  const dl = DASH.l * k;
  const g = (x: number, y: number) => {
    const gr = c.createLinearGradient(x - dw, 0, x + dw, 0);
    gr.addColorStop(0, '#fff');
    gr.addColorStop(0.3, '#222');
    gr.addColorStop(0.7, '#222');
    gr.addColorStop(1, '#fff');
    c.fillStyle = gr;
    c.fillRect(x - dw, y - dl / 2, dw * 2, dl);
  };
  // ряд со сдвигом на полшага: штрих режем по краю плитки, чтобы стыковался
  g(0, H / 4);
  g(W, H / 4);
  g(W / 2, (3 * H) / 4);
  return cv;
}

/** Надпись по переднему борту: «Caleto | герб | Football | ФУТБОЛ | KOPANA | Спорт | значок» — зелёные и красные плашки, как на подносе. */
export function brandCanvas(): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = 4096;
  cv.height = 192;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#f2f0e8';
  c.fillRect(0, 0, 4096, 192);
  const GREEN = '#1c8c2c';
  const RED = '#d0202a';
  const box = (x: number, w: number, col: string) => {
    c.strokeStyle = col;
    c.lineWidth = 7;
    c.strokeRect(x, 40, w, 112);
  };
  const text = (s: string, x: number, col: string, font: string, sx = 1) => {
    c.save();
    c.translate(x, 98);
    c.scale(sx, 1);
    c.font = font;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = col;
    c.fillText(s, 0, 0);
    c.restore();
  };
  box(420, 520, GREEN);
  text('Caleto', 680, GREEN, 'italic bold 84px "PT Serif", Georgia, serif');
  box(1000, 220, RED);
  // герб-грифон: условно — красная клякса с завитками
  c.fillStyle = RED;
  c.beginPath();
  c.ellipse(1110, 96, 70, 34, -0.2, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#f2f0e8';
  c.beginPath();
  c.ellipse(1095, 92, 40, 16, -0.2, 0, Math.PI * 2);
  c.fill();
  text('Football', 1600, GREEN, '900 118px "Arial Black", "PT Sans", Arial, sans-serif', 0.92);
  box(2000, 640, RED);
  text('ФУТБОЛ', 2320, RED, 'bold 92px "PT Sans", Arial, sans-serif', 1.15);
  text('KOPANA', 2980, GREEN, '900 112px "Arial Black", "PT Sans", Arial, sans-serif', 1.05);
  box(3300, 480, RED);
  text('Спорт', 3540, RED, 'italic bold 96px "PT Serif", Georgia, serif');
  box(3840, 150, GREEN);
  // значок: бегущий футболист
  c.fillStyle = GREEN;
  c.beginPath();
  c.arc(3925, 70, 13, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = GREEN;
  c.lineWidth = 12;
  c.lineCap = 'round';
  c.beginPath();
  c.moveTo(3918, 85);
  c.lineTo(3905, 120);
  c.lineTo(3885, 140);
  c.moveTo(3905, 120);
  c.lineTo(3935, 135);
  c.moveTo(3915, 95);
  c.lineTo(3940, 105);
  c.stroke();
  return cv;
}

/** Сетка ворот: белые нити в клетку, остальное прозрачно. */
export function netCanvas(): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 256;
  const c = cv.getContext('2d')!;
  c.strokeStyle = 'rgba(248,248,244,0.95)';
  c.lineWidth = 5;
  for (let i = 0; i <= 256; i += 32) {
    c.beginPath();
    c.moveTo(i, 0);
    c.lineTo(i, 256);
    c.moveTo(0, i);
    c.lineTo(256, i);
    c.stroke();
  }
  return cv;
}

/** Мяч: белый с чёрными пятнами-пятиугольниками (развёртка для сферы). */
export function ballCanvas(): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 128;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#f6f5ef';
  c.fillRect(0, 0, 256, 128);
  c.fillStyle = '#151515';
  const spot = (x: number, y: number, r: number) => {
    c.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
      c.lineTo(x + Math.cos(a) * r * 1.4, y + Math.sin(a) * r);
    }
    c.fill();
  };
  for (const [x, y] of [
    [32, 30],
    [96, 64],
    [160, 30],
    [224, 64],
    [32, 100],
    [160, 100],
  ])
    spot(x, y, 13);
  c.fillRect(0, 0, 256, 6);
  c.fillRect(0, 122, 256, 6);
  return cv;
}
