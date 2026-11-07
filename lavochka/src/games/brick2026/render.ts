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

const shade = (hex: string, f: number) => {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(f > 0 ? v + (255 - v) * f : v * (1 + f))));
  return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
};

const blockCache = new Map<string, HTMLCanvasElement>();

/** Кирпичик размера c: глянец, светлая грань сверху, тёмная снизу. Рисуется один раз на цвет и размер. */
function block(col: string, c: number): HTMLCanvasElement {
  const key = `${col}:${c}`;
  let cv = blockCache.get(key);
  if (cv) return cv;
  cv = document.createElement('canvas');
  cv.width = cv.height = Math.max(2, Math.ceil(c));
  const g = cv.getContext('2d')!;
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

/** Фон: тёмно-синий, звёзды, перспективная сетка внизу «бежит» к зрителю. */
export function drawBackdrop(g: CanvasRenderingContext2D, w: number, h: number, time: number, tint = '#1a2a8a') {
  const bg = g.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#05061a');
  bg.addColorStop(0.6, '#0a0c2e');
  bg.addColorStop(1, tint);
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  let s = 12345;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 120; i++) {
    const x = r() * w;
    const y = r() * h * 0.6;
    const tw = 0.4 + 0.6 * Math.abs(Math.sin(time * (0.5 + r()) + i));
    g.fillStyle = `rgba(200,220,255,${0.25 + tw * 0.5})`;
    g.fillRect(x, y, 1.5, 1.5);
  }
  const hz = h * 0.62;
  g.save();
  g.strokeStyle = 'rgba(90,140,255,0.35)';
  g.lineWidth = 1;
  for (let i = -14; i <= 14; i++) {
    g.beginPath();
    g.moveTo(w / 2 + i * 8, hz);
    g.lineTo(w / 2 + i * w * 0.12, h);
    g.stroke();
  }
  const off = (time * 0.6) % 1;
  for (let j = 0; j < 12; j++) {
    const k = (j + off) / 12;
    const y = hz + (h - hz) * k * k;
    g.globalAlpha = k;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(w, y);
    g.stroke();
  }
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
  g.save();
  g.shadowColor = o.frame ?? '#3a8aff';
  g.shadowBlur = c * 0.8;
  g.fillStyle = 'rgba(4,6,20,0.88)';
  g.fillRect(x - 3, y - 3, bw + 6, bh + 6);
  g.restore();
  g.strokeStyle = o.frame ?? '#5aa0ff';
  g.lineWidth = 2;
  g.strokeRect(x - 3, y - 3, bw + 6, bh + 6);
  g.strokeStyle = 'rgba(90,140,255,0.08)';
  g.lineWidth = 1;
  for (let i = 1; i < W; i++) {
    g.beginPath();
    g.moveTo(x + i * c, y);
    g.lineTo(x + i * c, y + bh);
    g.stroke();
  }
  for (let j = 1; j < H - HIDDEN; j++) {
    g.beginPath();
    g.moveTo(x, y + j * c);
    g.lineTo(x + bw, y + j * c);
    g.stroke();
  }
  const clearing = new Set(o.clearRows ?? []);
  for (let yy = HIDDEN; yy < H; yy++) {
    if (clearing.has(yy)) {
      // снятие ряда: вспышка, гаснет от центра к краям
      const k = o.clearK ?? 0;
      const half = Math.ceil((1 - k) * (W / 2));
      for (let xx = 0; xx < W; xx++) {
        const v = t.grid[yy * W + xx];
        if (Math.abs(xx - (W - 1) / 2) < half && v) drawBlock(g, x + xx * c, y + (yy - HIDDEN) * c, c, v, t.level);
      }
      g.fillStyle = `rgba(255,255,255,${0.6 * (1 - k)})`;
      g.fillRect(x, y + (yy - HIDDEN) * c, bw, c);
      continue;
    }
    for (let xx = 0; xx < W; xx++) {
      const v = t.grid[yy * W + xx];
      if (v) drawBlock(g, x + xx * c, y + (yy - HIDDEN) * c, c, v, t.level, o.dead ? 0.35 : 1);
    }
  }
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
  g.fillStyle = out ? 'rgba(40,10,10,0.85)' : 'rgba(4,6,20,0.85)';
  g.fillRect(x, y, W * c, (H - HIDDEN) * c);
  for (let i = 0; i < s.length; i++) {
    const v = s.charCodeAt(i) - 48;
    if (!v) continue;
    g.fillStyle = out ? '#5a4a4a' : colorOf(v, level);
    g.fillRect(x + (i % W) * c, y + Math.floor(i / W) * c, c - 0.5, c - 0.5);
  }
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
