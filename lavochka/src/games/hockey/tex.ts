/* Рисунки настольного хоккея на canvas — по мотивам советской коробки «Хоккей»: поле (крашеная жесть в крапинку и царапинах,
 * тонкая разметка, центральный круг с трафаретными годами, прорези с кромкой),
 * планки счёта с контурными цифрами и рифлёный ползунок, синяя надпись «ХОККЕЙ» со снежинками. Всё процедурное. */
import { GL, H, SLOTS, W } from './engine';

export const TEAM_COL = [
  { main: '#c4282c', dark: '#8a1418', light: '#e2585a' },
  { main: '#2d9be0', dark: '#1a6aa8', light: '#7cc4f0' },
];

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

// ---------------------------------------------------------------- поле

export const ICE_PX = 3072;
export const ICE_PY = Math.round((ICE_PX * H) / W);

/** Поле: светлая серая краска в крапинку и потёртостях, тонкая разметка, центральный круг, прорези. */
export function iceCanvas(): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = ICE_PX;
  cv.height = ICE_PY;
  const c = cv.getContext('2d')!;
  const k = ICE_PX / W;
  const X = (x: number) => x * k;
  const r = rnd(1986);

  c.fillStyle = '#e3e7ea';
  c.fillRect(0, 0, ICE_PX, ICE_PY);
  // зерно и крапинки краски
  const img = c.getImageData(0, 0, ICE_PX, ICE_PY);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    let n = (r() - 0.5) * 6;
    if (r() < 0.004) n -= 25 + r() * 30;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n + 1;
  }
  c.putImageData(img, 0, 0);
  // пятна потёртостей — сероватые облачка мелких точек
  for (let i = 0; i < 70; i++) {
    const cx = r() * ICE_PX;
    const cy = r() * ICE_PY;
    const rad = 30 + r() * 140;
    const n = 80 + r() * 260;
    for (let j = 0; j < n; j++) {
      const a = r() * Math.PI * 2;
      const rr = Math.sqrt(r()) * rad;
      c.fillStyle = `rgba(${110 + r() * 40},${115 + r() * 40},${120 + r() * 40},${0.08 + r() * 0.2})`;
      c.fillRect(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 1 + r() * 2.5, 1 + r() * 2.5);
    }
  }
  // длинные дуги-царапины от шайбы и короткие царапки
  for (let i = 0; i < 90; i++) {
    const x = r() * ICE_PX;
    const y = r() * ICE_PY;
    const l = 80 + r() * 600;
    const a = (r() - 0.5) * 0.6 + (r() < 0.5 ? 0 : Math.PI);
    c.strokeStyle = `rgba(${r() < 0.5 ? '150,158,166' : '200,205,210'},${0.18 + r() * 0.3})`;
    c.lineWidth = 0.8 + r() * 1.6;
    c.beginPath();
    c.moveTo(x, y);
    c.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + (r() - 0.5) * 80, y + Math.sin(a) * l * 0.5 + (r() - 0.5) * 80, x + Math.cos(a) * l, y + Math.sin(a) * l);
    c.stroke();
  }
  for (let i = 0; i < 500; i++) {
    const x = r() * ICE_PX;
    const y = r() * ICE_PY;
    const a = r() * Math.PI;
    const l = 4 + r() * 26;
    c.strokeStyle = `rgba(120,128,136,${0.12 + r() * 0.25})`;
    c.lineWidth = 0.7 + r();
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    c.stroke();
  }
  // ржавые точки
  for (let i = 0; i < 40; i++) {
    c.fillStyle = `rgba(150,${90 + r() * 30},50,${0.2 + r() * 0.35})`;
    c.beginPath();
    c.arc(r() * ICE_PX, r() * ICE_PY, 0.8 + r() * 2.2, 0, Math.PI * 2);
    c.fill();
  }

  const RED = 'rgba(206,52,52,0.95)';
  const BLUE = 'rgba(52,84,140,0.9)';
  const lw = (m: number) => (c.lineWidth = X(m));
  const seg = (x1: number, y1: number, x2: number, y2: number) => {
    c.beginPath();
    c.moveTo(X(x1), X(y1));
    c.lineTo(X(x2), X(y2));
    c.stroke();
  };
  // синие линии зон — тонкие
  c.strokeStyle = BLUE;
  lw(0.0017);
  seg(W / 3, 0, W / 3, H);
  seg((2 * W) / 3, 0, (2 * W) / 3, H);
  // красные линии ворот и вратарские — прямоугольник
  c.strokeStyle = RED;
  lw(0.0013);
  seg(GL, 0.02, GL, H - 0.02);
  seg(W - GL, 0.02, W - GL, H - 0.02);
  for (const side of [0, 1]) {
    const gx = side === 0 ? GL : W - GL;
    const dx = side === 0 ? 0.066 : -0.066;
    c.beginPath();
    c.moveTo(X(gx), X(H / 2 - 0.07));
    c.lineTo(X(gx + dx), X(H / 2 - 0.07));
    c.lineTo(X(gx + dx), X(H / 2 + 0.07));
    c.lineTo(X(gx), X(H / 2 + 0.07));
    c.stroke();
  }
  // двойная красная в центре — прерывается у круга
  const CR = 0.064;
  for (const dx of [-0.0021, 0.0021]) {
    seg(W / 2 + dx, 0, W / 2 + dx, H / 2 - CR - 0.004);
    seg(W / 2 + dx, H / 2 + CR + 0.004, W / 2 + dx, H);
  }
  lw(0.0013);
  c.beginPath();
  c.arc(X(W / 2), X(H / 2), X(CR), 0, Math.PI * 2);
  c.stroke();
  // эмблема как на коробке: красный ромб с белой «С», годы трафаретом
  const cx = X(W / 2);
  const cy = X(H / 2);
  c.save();
  c.translate(cx, cy);
  c.fillStyle = RED;
  c.beginPath();
  c.moveTo(-X(0.0215), 0);
  c.lineTo(0, -X(0.0155));
  c.lineTo(X(0.0215), 0);
  c.lineTo(0, X(0.0155));
  c.closePath();
  c.fill();
  // «С»: белая дуга, внутри красная, разрыв справа
  c.lineCap = 'butt';
  c.strokeStyle = '#eef0f1';
  c.lineWidth = X(0.0046);
  c.beginPath();
  c.arc(0, 0, X(0.0072), Math.PI * 0.3, Math.PI * 1.75);
  c.stroke();
  c.strokeStyle = RED;
  c.lineWidth = X(0.0013);
  c.beginPath();
  c.arc(0, 0, X(0.0072), Math.PI * 0.36, Math.PI * 1.69);
  c.stroke();
  // хвостик-стрела вверх вправо
  c.strokeStyle = '#eef0f1';
  c.lineWidth = X(0.0022);
  c.beginPath();
  c.moveTo(X(0.0042), -X(0.0058));
  c.lineTo(X(0.0098), -X(0.0058));
  c.lineTo(X(0.0098), -X(0.0005));
  c.stroke();
  c.restore();
  stencil(c, '1935г.', cx, cy - X(0.035), X(0.0135), RED);
  stencil(c, '1985г.', cx, cy + X(0.037), X(0.0135), RED);

  // круги вбрасывания в зонах — тонкие синие, внутри «|●|»
  for (const [fx, fy] of [
    [0.16, 0.26],
    [0.16, 0.74],
    [0.84, 0.26],
    [0.84, 0.74],
  ]) {
    const x = X(fx * W);
    const y = X(fy * H);
    c.strokeStyle = BLUE;
    lw(0.0012);
    c.beginPath();
    c.arc(x, y, X(0.045), 0, Math.PI * 2);
    c.stroke();
    c.fillStyle = BLUE;
    c.beginPath();
    c.arc(x, y, X(0.0045), 0, Math.PI * 2);
    c.fill();
    for (const sx of [-1, 1]) c.fillRect(x + sx * X(0.0095) - X(0.0007), y - X(0.006), X(0.0014), X(0.012));
    // засечки «Г» у круга
    for (const sx of [-1, 1])
      for (const sy of [-1, 1]) {
        c.fillRect(x + sx * X(0.016) - X(0.0006), y + sy * X(0.003), X(0.0012), sy * X(0.006));
        c.fillRect(x + sx * X(0.016), y + sy * X(0.003) - X(0.0006), sx * X(0.006), X(0.0012));
      }
  }

  // прорези: тёмная щель, скруглённые концы, светлая кромка вокруг (выдавленная жесть) и тень с одной стороны
  c.lineCap = 'round';
  c.lineJoin = 'round';
  const path = (sl: (typeof SLOTS)[number], ext: number, oy = 0) => {
    const p = sl.pts;
    const n = p.length - 1;
    c.beginPath();
    c.moveTo(X(p[0][0] - (p[1][0] - p[0][0]) * ext), X(p[0][1] - (p[1][1] - p[0][1]) * ext) + oy);
    for (const q of p) c.lineTo(X(q[0]), X(q[1]) + oy);
    c.lineTo(X(p[n][0] + (p[n][0] - p[n - 1][0]) * ext), X(p[n][1] + (p[n][1] - p[n - 1][1]) * ext) + oy);
  };
  for (const sl of SLOTS) {
    path(sl, 0.35);
    c.strokeStyle = 'rgba(150,156,162,0.55)';
    lw(0.0118);
    c.stroke();
    path(sl, 0.35);
    c.strokeStyle = '#f1f3f4';
    lw(0.0104);
    c.stroke();
    path(sl, 0.35, X(0.0008));
    c.strokeStyle = 'rgba(80,70,60,0.45)';
    lw(0.0086);
    c.stroke();
    path(sl, 0.35);
    c.strokeStyle = '#4a3a2c';
    lw(0.0076);
    c.stroke();
    path(sl, 0.35);
    c.strokeStyle = '#1a140f';
    lw(0.0058);
    c.stroke();
  }
  return cv;
}

/** Надпись «трафаретом»: моноширинный шрифт с перемычками. */
function stencil(c: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, col: string) {
  const cv = document.createElement('canvas');
  const w = Math.ceil(size * text.length * 0.75 + size);
  const hh = Math.ceil(size * 1.4);
  cv.width = w;
  cv.height = hh;
  const t = cv.getContext('2d')!;
  t.fillStyle = col;
  t.font = `bold ${size}px "PT Mono", "Courier New", monospace`;
  t.textAlign = 'center';
  t.textBaseline = 'middle';
  t.fillText(text, w / 2, hh / 2);
  t.globalCompositeOperation = 'destination-out';
  // перемычки трафарета: тонкие горизонтальные разрывы
  t.fillRect(0, hh / 2 - size * 0.04, w, size * 0.07);
  c.drawImage(cv, x - w / 2, y - hh / 2);
}

// ---------------------------------------------------------------- хоккеисты

/** Высота жестянки, м. Рисунки — public/hockey/{red,blue}.webp: пластина-«матрёшка», крюк справа. */
export const FIG_H = 0.064;
/** Ширина рисунка к высоте и где на нём ось фигурки (доля ширины от левого края). */
export const FIG_ASPECT = 528 / 640;
export const FIG_AXIS = 133.5 / 453;
export const figureUrl = (team: 0 | 1) => `${import.meta.env.BASE_URL}hockey/${team === 0 ? 'red' : 'blue'}.webp`;

// ---------------------------------------------------------------- табло и надписи

/** Планка счёта: цветная пластмасса, цифры 0…9 рельефным контуром, рамки между ними. */
export function stripCanvas(team: 0 | 1): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = 2048;
  cv.height = 150;
  const c = cv.getContext('2d')!;
  const base = team === 0 ? '#d6403a' : '#3a9ad8';
  const deep = team === 0 ? '#9a2420' : '#1f6aa6';
  c.fillStyle = base;
  c.fillRect(0, 0, 2048, 150);
  // рамка-жёлоб
  c.fillStyle = deep;
  c.fillRect(0, 0, 2048, 14);
  c.fillRect(0, 136, 2048, 14);
  const cell = 2048 / 10;
  for (let i = 0; i < 10; i++) {
    const x = i * cell;
    c.fillStyle = deep;
    c.fillRect(x, 0, 10, 150);
    // контурная цифра, чуть наклонная — как отлитая
    c.save();
    c.translate(x + cell / 2, 78);
    c.transform(1, 0, -0.18, 1, 0, 0);
    c.font = 'bold 104px "PT Sans Narrow", "Arial Narrow", Arial, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.lineWidth = 12;
    c.strokeStyle = deep;
    c.strokeText(String(i), 0, 0);
    c.fillStyle = base;
    c.fillText(String(i), 0, 0);
    c.lineWidth = 3;
    c.strokeStyle = 'rgba(255,255,255,0.55)';
    c.strokeText(String(i), -2, -2);
    c.restore();
  }
  return cv;
}

/** Ползунок: кремовая пластмасса с окошком и рифлением снизу. */
export function sliderCanvas(): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 192;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#f2ecdc';
  c.fillRect(0, 0, 256, 192);
  c.clearRect(52, 26, 152, 104);
  c.strokeStyle = 'rgba(150,140,120,0.8)';
  c.lineWidth = 4;
  c.strokeRect(50, 24, 156, 108);
  c.fillStyle = 'rgba(130,120,100,0.7)';
  for (let x = 10; x < 250; x += 9) c.fillRect(x, 146, 4, 40);
  return cv;
}

/** Надпись «ХОККЕЙ» на корпусе: крупная синяя, широкая; снежинки по бокам; знак качества над ней. */
export function brandCanvas(): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = 2048;
  cv.height = 360;
  const c = cv.getContext('2d')!;
  const blue = '#2f8fd6';
  c.save();
  c.translate(1024, 236);
  c.scale(1.55, 1);
  c.font = '900 168px "Arial Black", "PT Sans", Arial, sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillStyle = 'rgba(20,60,110,0.45)';
  c.fillText('ХОККЕЙ', 4, 7);
  c.fillStyle = blue;
  c.fillText('ХОККЕЙ', 0, 0);
  c.fillStyle = 'rgba(255,255,255,0.25)';
  c.fillText('ХОККЕЙ', -2, -3);
  c.fillStyle = blue;
  c.fillText('ХОККЕЙ', 0, 1);
  c.restore();
  for (const x of [250, 1798]) snow(c, x, 236, 70, blue);
  // знак качества — выдавлен в пластмассе
  c.save();
  c.translate(1024, 70);
  c.strokeStyle = 'rgba(150,140,115,0.85)';
  c.lineWidth = 5;
  c.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
    c.lineTo(Math.cos(a) * 52, Math.sin(a) * 52);
  }
  c.closePath();
  c.stroke();
  c.font = 'bold 22px "PT Sans", Arial, sans-serif';
  c.fillStyle = 'rgba(150,140,115,0.85)';
  c.textAlign = 'center';
  c.fillText('СССР', 0, -14);
  c.restore();
  return cv;
}

function snow(c: CanvasRenderingContext2D, x: number, y: number, r: number, col: string) {
  c.strokeStyle = col;
  c.lineWidth = 13;
  c.lineCap = 'round';
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3 + Math.PI / 6;
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    for (const s of [-1, 1]) {
      const bx = x + Math.cos(a) * r * 0.55;
      const by = y + Math.sin(a) * r * 0.55;
      c.moveTo(bx, by);
      c.lineTo(bx + Math.cos(a + s * 0.85) * r * 0.36, by + Math.sin(a + s * 0.85) * r * 0.36);
    }
    c.stroke();
  }
}
