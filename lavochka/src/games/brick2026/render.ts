/* Brick Game 2026 — отрисовка: глянцевые яркие кирпичики (цвета меняются с уровнем, как на старой приставке, — десять палитр по кругу),
 * тёмный фон с бегущей перспективной сеткой и звёздами, поле со светящейся рамкой, тень фигуры, мини-поля соперников. Без состояния игры. */
import { cellsOf, dropY, H, HIDDEN, type Piece, type Tet, W } from './tetris';

/** Десять палитр по уровню: [основной, второй, третий] — I/O/T, J/S, L/Z (как раскладка цветов у приставки). */
const PALETTES: [string, string, string][] = [
  ['#3ab8ff', '#2a5aff', '#ff5a8a'],
  ['#3aff8a', '#2ac04a', '#c8ff3a'],
  ['#ff4aff', '#b02aff', '#ff8ad8'],
  ['#3a8aff', '#3affb8', '#2a4aff'],
  ['#ff3a8a', '#3aff6a', '#ff6ab8'],
  ['#3affd8', '#ff5a3a', '#2ad0a0'],
  ['#ff3a3a', '#7a8aff', '#ff8a3a'],
  ['#b03aff', '#ff3a6a', '#7a2aff'],
  ['#3a6aff', '#ff3a2a', '#3ab0ff'],
  ['#ff8a2a', '#ff3a2a', '#ffd23a'],
];
const GARBAGE = '#8a90a8';

export function colorOf(k: number, level: number): string {
  if (k === 8) return GARBAGE;
  const p = PALETTES[((level % 10) + 10) % 10];
  return k === 1 || k === 2 || k === 3 ? p[0] : k === 6 || k === 4 ? p[1] : p[2];
}

/** Цвет рамок и подсветки уровня — главный цвет его палитры. */
export function accentOf(level: number): string {
  return PALETTES[((level % 10) + 10) % 10][0];
}

const shade = (hex: string, f: number) => {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(f > 0 ? v + (255 - v) * f : v * (1 + f))));
  return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
};

const blockCache = new Map<string, HTMLCanvasElement>();
/** Фактура кирпичика (studio/jobs/brick2026/06-kirpich.yaml); пока грузится — рисованный запасной. */
const tile = typeof Image === 'undefined' ? ({ complete: false, naturalWidth: 0 } as HTMLImageElement) : new Image();
if (typeof Image !== 'undefined') {
  tile.onload = () => blockCache.clear();
  tile.src = '/brick2026/kirpich.webp';
}

/** Кирпичик размера c: глянец, светлая грань сверху, тёмная снизу. Рисуется один раз на цвет и размер. */
function block(col: string, c: number): HTMLCanvasElement {
  const key = `${col}:${c}`;
  let cv = blockCache.get(key);
  if (cv) return cv;
  cv = document.createElement('canvas');
  cv.width = cv.height = Math.max(2, Math.ceil(c));
  const g = cv.getContext('2d')!;
  if (tile.complete && tile.naturalWidth) {
    // плитка из конвейера (серая, середина ~50%) кладётся на цвет: светлое — блик, тёмное — грань
    g.fillStyle = col;
    g.fillRect(0, 0, cv.width, cv.height);
    g.globalCompositeOperation = 'hard-light';
    g.drawImage(tile, 0, 0, cv.width, cv.height);
    g.globalCompositeOperation = 'source-over';
    blockCache.set(key, cv);
    if (blockCache.size > 400) blockCache.delete(blockCache.keys().next().value!);
    return cv;
  }
  const b = Math.max(1, c * 0.12);
  g.fillStyle = shade(col, -0.45);
  g.fillRect(0, 0, c, c);
  g.fillStyle = shade(col, 0.45);
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(c, 0);
  g.lineTo(c - b, b);
  g.lineTo(b, b);
  g.lineTo(b, c - b);
  g.lineTo(0, c);
  g.closePath();
  g.fill();
  const gr = g.createLinearGradient(0, b, 0, c - b);
  gr.addColorStop(0, shade(col, 0.15));
  gr.addColorStop(1, shade(col, -0.15));
  g.fillStyle = gr;
  g.fillRect(b, b, c - 2 * b, c - 2 * b);
  g.fillStyle = 'rgba(255,255,255,0.35)';
  g.fillRect(b * 1.6, b * 1.6, c * 0.28, c * 0.12);
  blockCache.set(key, cv);
  if (blockCache.size > 400) blockCache.delete(blockCache.keys().next().value!);
  return cv;
}

export function drawBlock(g: CanvasRenderingContext2D, x: number, y: number, c: number, k: number, level: number, alpha = 1) {
  g.globalAlpha = alpha;
  g.drawImage(block(colorOf(k, level), Math.round(c)), x, y, c, c);
  g.globalAlpha = 1;
}

/** Фоны за стаканом — по одному на каждую из десяти палитр (studio/jobs/brick2026/05-fony.yaml, Z-Image). */
const BG = ['l0-dvor', 'l1-bereza', 'l2-zakat', 'l3-zima', 'l4-sad', 'l5-orbita', 'l6-salyut', 'l7-tumannost', 'l8-metro', 'l9-osen'];
interface Bg {
  img: HTMLImageElement;
  /** Размытая уменьшенная копия — «матовое стекло» под стаканом и панелями. */
  blur: HTMLCanvasElement | null;
}
const bgs = new Map<number, Bg>();
function bgOf(i: number): Bg {
  let b = bgs.get(i);
  if (b) return b;
  const img = new Image();
  b = { img, blur: null };
  const bb = b;
  img.onload = () => {
    const cv = document.createElement('canvas');
    cv.width = 336;
    cv.height = 192;
    const g = cv.getContext('2d')!;
    g.filter = 'blur(6px)';
    g.drawImage(img, -12, -12, cv.width + 24, cv.height + 24);
    bb.blur = cv;
  };
  img.src = `/brick2026/fon/${BG[i]}.webp`;
  bgs.set(i, b);
  return b;
}
const ready = (b: Bg) => b.img.complete && b.img.naturalWidth > 0;

/** Где фон лёг на холст в последний кадр (в пикселях холста) — по нему «матовое стекло» совпадает с фоном. */
let cover = { x: 0, y: 0, w: 0, h: 0 };
let curBg = -1;
let prevBg = -1;
let fade0 = 0;

/** Фон по уровню: картинка «по размеру» с медленным дрейфом, при смене уровня — плавная смена, по краям — виньетка. */
export function drawBackdrop(g: CanvasRenderingContext2D, w: number, h: number, time: number, level: number) {
  const i = ((level % 10) + 10) % 10;
  if (i !== curBg) {
    prevBg = curBg;
    curBg = i;
    fade0 = time;
  }
  if (time < fade0) fade0 = time;
  bgOf((i + 1) % 10);
  const bg = g.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#05061a');
  bg.addColorStop(1, shade(accentOf(level), -0.7));
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  const ar = 1344 / 768;
  const z = 1.08 + 0.02 * Math.sin(time * 0.07);
  const cw = Math.max(w, h * ar) * z;
  const ch = cw / ar;
  cover = { x: (w - cw) / 2 + Math.sin(time * 0.05) * (cw - w) * 0.3, y: (h - ch) / 2 + Math.cos(time * 0.04) * (ch - h) * 0.25, w: cw, h: ch };
  const k = Math.min(1, (time - fade0) / 1.5);
  const p = prevBg >= 0 ? bgOf(prevBg) : null;
  if (p && k < 1 && ready(p)) g.drawImage(p.img, cover.x, cover.y, cover.w, cover.h);
  const c = bgOf(i);
  if (ready(c)) {
    g.globalAlpha = p && ready(p) ? k : Math.min(1, k * 2 + 0.2);
    g.drawImage(c.img, cover.x, cover.y, cover.w, cover.h);
    g.globalAlpha = 1;
  }
  // приглушить: фон — настроение, а не картинка, на которую смотрят
  g.fillStyle = 'rgba(4,5,18,0.12)';
  g.fillRect(0, 0, w, h);
  const v = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75);
  v.addColorStop(0, 'rgba(0,0,0,0.1)');
  v.addColorStop(1, 'rgba(0,0,0,0.55)');
  g.fillStyle = v;
  g.fillRect(0, 0, w, h);
}

/** «Матовое стекло»: в рамке (x, y, w, h) текущей системы координат — размытый тот же фон, затемнённый tint. */
export function frost(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, tint: string) {
  g.save();
  g.beginPath();
  g.roundRect(x, y, w, h, r);
  g.clip();
  const b = curBg >= 0 ? bgs.get(curBg) : undefined;
  if (b?.blur) {
    const m = g.getTransform();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(b.blur, cover.x, cover.y, cover.w, cover.h);
    g.setTransform(m);
  }
  g.fillStyle = tint;
  g.fillRect(x, y, w, h);
  g.restore();
}

export interface BoardOpts {
  ghost?: boolean;
  /** Ряды, что сейчас снимаются, и сколько осталось анимации (0…1). */
  clearRows?: number[];
  clearK?: number;
  /** Сколько мусора летит (полоска слева) и подсветка рамки. */
  incoming?: number;
  frame?: string;
  dead?: boolean;
}

/** Поле игрока: рамка, сетка, кирпичи, фигура, тень. (x, y) — левый верх видимого стакана, c — клетка. */
export function drawBoard(g: CanvasRenderingContext2D, t: Tet, x: number, y: number, c: number, o: BoardOpts = {}) {
  const bw = W * c;
  const bh = (H - HIDDEN) * c;
  const acc = o.frame ?? accentOf(t.level);
  // стакан: мягкое свечение цвета уровня, внутри — размытый и затемнённый фон
  g.save();
  g.shadowColor = acc;
  g.shadowBlur = c * 1.4;
  g.fillStyle = 'rgba(2,3,12,0.9)';
  g.beginPath();
  g.roundRect(x - 6, y - 6, bw + 12, bh + 12, 6);
  g.fill();
  g.restore();
  frost(g, x - 6, y - 6, bw + 12, bh + 12, 6, 'rgba(3,4,16,0.8)');
  // рамка: ободок цвета уровня с бликом сверху и тонкая светлая кромка внутри
  const fr = g.createLinearGradient(0, y - 6, 0, y + bh + 6);
  fr.addColorStop(0, shade(acc, 0.55));
  fr.addColorStop(0.5, acc);
  fr.addColorStop(1, shade(acc, -0.35));
  g.strokeStyle = fr;
  g.lineWidth = 3;
  g.beginPath();
  g.roundRect(x - 5, y - 5, bw + 10, bh + 10, 6);
  g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.18)';
  g.lineWidth = 1;
  g.strokeRect(x - 1.5, y - 1.5, bw + 3, bh + 3);
  // сетка — точками на пересечениях, не решёткой
  g.fillStyle = 'rgba(160,190,255,0.16)';
  for (let i = 1; i < W; i++) for (let j = 1; j < H - HIDDEN; j++) g.fillRect(x + i * c - 1, y + j * c - 1, 2, 2);
  const clearing = new Set(o.clearRows ?? []);
  const k = o.clearK ?? 0;
  for (let yy = HIDDEN; yy < H; yy++) {
    if (clearing.has(yy)) {
      // снятие ряда: кирпичи белеют и гаснут от центра к краям
      const half = Math.ceil((1 - k) * (W / 2));
      for (let xx = 0; xx < W; xx++) {
        const v = t.grid[yy * W + xx];
        if (Math.abs(xx - (W - 1) / 2) < half && v) drawBlock(g, x + xx * c, y + (yy - HIDDEN) * c, c, v, t.level);
      }
      continue;
    }
    for (let xx = 0; xx < W; xx++) {
      const v = t.grid[yy * W + xx];
      if (v) drawBlock(g, x + xx * c, y + (yy - HIDDEN) * c, c, v, t.level, o.dead ? 0.35 : 1);
    }
  }
  if (clearing.size && k < 1) clearFx(g, t, x, y, c, [...clearing], k, acc);
  const p = t.cur;
  if (p && !o.dead) {
    if (o.ghost) {
      const gy = dropY(t, p);
      g.save();
      g.strokeStyle = colorOf(p.k, t.level);
      g.lineWidth = 2;
      g.globalAlpha = 0.55;
      for (const [dx, dy] of cellsOf(p.k, p.r)) {
        const yy = gy + dy - HIDDEN;
        if (yy >= 0) g.strokeRect(x + (p.x + dx) * c + 2, y + yy * c + 2, c - 4, c - 4);
      }
      g.restore();
    }
    drawPiece(g, p, x, y, c, t.level);
  }
  if (o.incoming) {
    const n = Math.min(H - HIDDEN, o.incoming);
    g.fillStyle = '#ff3a3a';
    g.shadowColor = '#ff3a3a';
    g.shadowBlur = 10;
    g.fillRect(x - 12, y + bh - n * c, 6, n * c);
    g.shadowBlur = 0;
  }
}

/** Эффект снятия рядов (без состояния — всё из k): луч вдоль ряда, осколки кирпичей разлетаются и падают, за четыре ряда — вспышка всего стакана. */
function clearFx(g: CanvasRenderingContext2D, t: Tet, x: number, y: number, c: number, rows: number[], k: number, acc: string) {
  const bw = W * c;
  g.save();
  g.globalCompositeOperation = 'lighter';
  if (rows.length >= 4) {
    g.fillStyle = acc;
    g.globalAlpha = 0.35 * (1 - k);
    g.fillRect(x, y, bw, (H - HIDDEN) * c);
  }
  for (const yy of rows) {
    const cy = y + (yy - HIDDEN + 0.5) * c;
    const spread = c * (0.5 + 1.5 * k);
    const beam = g.createLinearGradient(0, cy - spread, 0, cy + spread);
    beam.addColorStop(0, 'rgba(255,255,255,0)');
    beam.addColorStop(0.5, `rgba(255,255,255,${0.9 * (1 - k)})`);
    beam.addColorStop(1, 'rgba(255,255,255,0)');
    g.globalAlpha = 1;
    g.fillStyle = beam;
    g.fillRect(x - c * k * 2, cy - spread, bw + c * k * 4, spread * 2);
    for (let xx = 0; xx < W; xx++) {
      const v = t.grid[yy * W + xx];
      if (!v) continue;
      g.fillStyle = colorOf(v, t.level);
      for (let n = 0; n < 3; n++) {
        let s = (yy * 131 + xx * 17 + n * 7919) % 2147483647 || 1;
        const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
        const vx = (r() - 0.5) * 7 * c + (xx - (W - 1) / 2) * c * 0.5;
        const vy = -(0.5 + r() * 2.5) * c;
        const px = x + (xx + 0.5) * c + vx * k;
        const py = cy + vy * k + 9 * c * k * k;
        const sz = c * (0.22 + r() * 0.3) * (1 - k * 0.7);
        g.globalAlpha = 1 - k;
        g.fillRect(px - sz / 2, py - sz / 2, sz, sz);
      }
    }
  }
  g.restore();
}

export function drawPiece(g: CanvasRenderingContext2D, p: Piece, x: number, y: number, c: number, level: number) {
  for (const [dx, dy] of cellsOf(p.k, p.r)) {
    const yy = p.y + dy - HIDDEN;
    if (yy >= 0) drawBlock(g, x + (p.x + dx) * c, y + yy * c, c, p.k, level);
  }
}

/** Фигура в окошке «следующая» по центру (cx, cy). */
export function drawPreview(g: CanvasRenderingContext2D, k: number, cx: number, cy: number, c: number, level: number) {
  if (!k) return;
  const cells = cellsOf(k, 0);
  const xs = cells.map((q) => q[0]);
  const ys = cells.map((q) => q[1]);
  const w = Math.max(...xs) - Math.min(...xs) + 1;
  const hh = Math.max(...ys) - Math.min(...ys) + 1;
  for (const [dx, dy] of cells) drawBlock(g, cx + (dx - Math.min(...xs) - w / 2) * c, cy + (dy - Math.min(...ys) - hh / 2) * c, c, k, level);
}

/** Мини-поле соперника по строке снимка (200 знаков). */
export function drawMini(g: CanvasRenderingContext2D, s: string, x: number, y: number, c: number, level: number, out: boolean) {
  frost(g, x, y, W * c, (H - HIDDEN) * c, 2, out ? 'rgba(40,10,10,0.8)' : 'rgba(4,6,20,0.7)');
  for (let i = 0; i < s.length; i++) {
    const v = s.charCodeAt(i) - 48;
    if (!v) continue;
    g.fillStyle = out ? '#5a4a4a' : colorOf(v, level);
    g.fillRect(x + (i % W) * c, y + Math.floor(i / W) * c, c - 0.5, c - 0.5);
  }
}

/** Подпись панели: рубленый шрифт вразрядку, мягкая тень. */
export function labelText(g: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, col: string) {
  g.save();
  g.font = `600 ${size}px "Segoe UI", system-ui, sans-serif`;
  g.letterSpacing = `${size * 0.18}px`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = 'rgba(0,0,0,0.8)';
  g.shadowBlur = 4;
  g.fillStyle = col;
  g.fillText(text, x + size * 0.09, y);
  g.restore();
}

/** Цифры «табло»: моноширинные, светятся. */
export function glowText(g: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, col: string, align: CanvasTextAlign = 'left') {
  g.save();
  g.font = `bold ${size}px "Courier New", monospace`;
  g.textAlign = align;
  g.textBaseline = 'middle';
  g.shadowColor = col;
  g.shadowBlur = size * 0.5;
  g.fillStyle = col;
  g.fillText(text, x, y);
  g.restore();
}
