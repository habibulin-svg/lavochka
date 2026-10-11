/* Холдем 3D — текстуры, нарисованные на canvas: печать на сукне, тюль, шёлк абажура, фишки, баттон.
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
/** plain — без разметки (только сукно). */
export function feltTexture(plain = false): THREE.Texture {
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
    if (plain) return;
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

/** Тюль: тонкая белая сетка — почти прозрачная, плотнее в нитях, с лёгкой неровностью плетения (без рисунка). */
export function tulleTex(): THREE.CanvasTexture {
  return canvasTex(
    256,
    256,
    (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.fillStyle = 'rgba(255,255,255,0.22)';
      g.fillRect(0, 0, w, h);
      const r = rnd(41);
      // нити основы и утка
      for (let x = 0; x < w; x += 4) {
        g.fillStyle = `rgba(255,255,255,${0.1 + r() * 0.08})`;
        g.fillRect(x, 0, 1, h);
      }
      for (let y = 0; y < h; y += 4) {
        g.fillStyle = `rgba(255,255,255,${0.08 + r() * 0.06})`;
        g.fillRect(0, y, w, 1);
      }
      // неровная плотность — как у настоящей ткани
      for (let i = 0; i < 40; i++) {
        g.fillStyle = `rgba(255,255,255,${r() * 0.05})`;
        g.fillRect(r() * w, 0, 2 + r() * 10, h);
      }
    },
    [10, 10]
  );
}

/** Шёлк абажура: складки сборкой (светлее на гребнях), тонкая фактура ткани; внизу — ярче, там к ткани ближе лампочка. */
export function silkTex(): THREE.CanvasTexture {
  return canvasTex(1024, 256, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#9a4a1c');
    grad.addColorStop(0.55, '#d67a32');
    grad.addColorStop(1, '#e89848');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    const folds = 48;
    for (let i = 0; i < folds; i++) {
      const x = (i / folds) * w;
      const fw = w / folds;
      const fg = g.createLinearGradient(x, 0, x + fw, 0);
      fg.addColorStop(0, 'rgba(60,20,0,0.28)');
      fg.addColorStop(0.45, 'rgba(255,220,160,0.18)');
      fg.addColorStop(1, 'rgba(60,20,0,0.28)');
      g.fillStyle = fg;
      g.fillRect(x, 0, fw, h);
    }
    speckle(g, w, h, 0.05, 20000, 77, 1);
  });
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

const SUIT: Record<string, [string, string]> = { S: ['♠', '#1b1b1b'], C: ['♣', '#1b1b1b'], D: ['♦', '#c0161d'], H: ['♥', '#c0161d'] };
const RANK: Record<number, string> = { 11: 'В', 12: 'Д', 13: 'К', 14: 'Т' };

/** Карта-заместитель, пока картинка колоды не пришла (медленная сеть): тот же размер, что у картинки (320×496),
 * углы прозрачные. Без неё текстура пустая, и alphaTest выкидывает лицо целиком — карта прозрачная. */
export function cardStandIn(c: { s: string; r: number } | null): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  const w = (cv.width = 320);
  const h = (cv.height = 496);
  const g = cv.getContext('2d')!;
  g.beginPath();
  g.roundRect(4, 4, w - 8, h - 8, 22);
  g.fillStyle = c ? '#f3efe4' : '#8e2a26';
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = 'rgba(0,0,0,0.25)';
  g.stroke();
  if (!c) {
    // рубашка: рамка и косая сетка
    g.save();
    g.beginPath();
    g.roundRect(24, 24, w - 48, h - 48, 12);
    g.clip();
    g.strokeStyle = 'rgba(255,225,190,0.55)';
    g.lineWidth = 4;
    for (let x = -h; x < w + h; x += 26) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x + h, h);
      g.moveTo(x + h, 0);
      g.lineTo(x, h);
      g.stroke();
    }
    g.restore();
    return cv;
  }
  const [sym, col] = SUIT[c.s] ?? ['?', '#1b1b1b'];
  const rank = RANK[c.r] ?? String(c.r);
  const rf = `700 ${rank.length > 1 ? 52 : 62}px 'PT Sans', Arial, sans-serif`;
  g.fillStyle = col;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = rf;
  g.fillText(rank, 48, 56);
  g.font = `56px serif`;
  g.fillText(sym, 48, 112);
  g.save();
  g.translate(w, h);
  g.rotate(Math.PI);
  g.font = rf;
  g.fillText(rank, 48, 56);
  g.font = `56px serif`;
  g.fillText(sym, 48, 112);
  g.restore();
  g.font = `170px serif`;
  g.fillText(sym, w / 2, h / 2 + 6);
  return cv;
}
