/* «Шарики» — общая отрисовка для одиночной игры и сетевого стола: двор, канавка, люк, шарики (серый — падлянка), лягушка, прицел. */
import { cover, Sprites } from '../../core/arcade-fx';
import { D, FH, FW, GRAY } from './logic';

export const COLORS = [
  ['#e8302a', '#ff9a8a'],
  ['#f0c020', '#fff0a0'],
  ['#2a9a3a', '#9af0a0'],
  ['#2a5ad8', '#a0c0ff'],
  ['#9a3ac8', '#e0a8ff'],
  ['#f4f4f0', '#ffffff'],
];
export const GRAY_COLOR = ['#7a7670', '#c8c4bc'];
export const colorOf = (c: number) => (c === GRAY ? GRAY_COLOR : COLORS[c % COLORS.length]);

export const BALL = ['ball0', 'ball1', 'ball2', 'ball3', 'ball4', 'ball5'] as const;
export const BG = ['bg1', 'bg2', 'bg3'] as const;
export const ART = new Sprites('shariki', [...BG, ...BALL, 'frog', 'hole', 'map'] as const);

/** Шарик: картинка (крутится — rot), пока не загрузилась — градиент; серый — всегда булыжник. */
export function drawBall(g: CanvasRenderingContext2D, x: number, y: number, color: number, r = D / 2, rot = 0) {
  const im = color === GRAY ? null : ART.get(BALL[color % BALL.length]);
  if (im) {
    g.save();
    g.translate(x, y);
    g.rotate(rot);
    g.drawImage(im, -r * 1.1, -r * 1.1, r * 2.2, r * 2.2);
    g.restore();
    return;
  }
  const [c, l] = colorOf(color);
  const gr = g.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
  gr.addColorStop(0, l);
  gr.addColorStop(0.5, c);
  gr.addColorStop(1, 'rgba(0,0,0,0.6)');
  g.fillStyle = gr;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
  if (color === GRAY) {
    // щербинки на камне
    g.fillStyle = 'rgba(40,36,30,0.45)';
    for (const [dx, dy, rr] of [
      [-0.3, 0.1, 0.13],
      [0.25, -0.25, 0.1],
      [0.15, 0.35, 0.08],
    ]) {
      g.beginPath();
      g.arc(x + Math.cos(rot) * dx * r - Math.sin(rot) * dy * r, y + Math.sin(rot) * dx * r + Math.cos(rot) * dy * r, rr * r, 0, Math.PI * 2);
      g.fill();
    }
  }
}

export function drawYard(g: CanvasRenderingContext2D, bg: number) {
  const bgi = ART.get(BG[bg % BG.length]);
  if (bgi) cover(g, bgi, -8, -8, FW + 16, FH + 16);
  else {
    const grd = g.createRadialGradient(FW / 2, FH / 2, 50, FW / 2, FH / 2, FW * 0.7);
    grd.addColorStop(0, '#b8a070');
    grd.addColorStop(1, '#7a6a3a');
    g.fillStyle = grd;
    g.fillRect(0, 0, FW, FH);
  }
}

/** Канавка: светлый край сверху-слева, тёмная выемка, тень внутри. */
export function drawGroove(g: CanvasRenderingContext2D, pts: [number, number][]) {
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.save();
  g.translate(-1.5, -1.5);
  g.strokeStyle = 'rgba(255,240,210,0.35)';
  g.lineWidth = D + 12;
  g.stroke();
  g.restore();
  g.strokeStyle = 'rgba(35,25,15,0.7)';
  g.lineWidth = D + 10;
  g.stroke();
  g.strokeStyle = 'rgba(70,55,35,0.85)';
  g.lineWidth = D + 2;
  g.stroke();
  g.save();
  g.translate(2, 3);
  g.strokeStyle = 'rgba(0,0,0,0.25)';
  g.lineWidth = D - 6;
  g.stroke();
  g.restore();
}

/** Люк в конце пути; pulse — голова близко, вокруг красное свечение. */
export function drawHole(g: CanvasRenderingContext2D, pts: [number, number][], pulse: number) {
  const [hx, hy] = pts[pts.length - 1];
  if (pulse) {
    const glow = g.createRadialGradient(hx, hy, 10, hx, hy, 70);
    glow.addColorStop(0, `rgba(255,40,20,${0.55 * pulse})`);
    glow.addColorStop(1, 'rgba(255,40,20,0)');
    g.fillStyle = glow;
    g.fillRect(hx - 70, hy - 70, 140, 140);
  }
  const hole = ART.get('hole');
  if (hole) g.drawImage(hole, hx - 62, hy - 62, 124, 124);
  else {
    const hg = g.createRadialGradient(hx, hy, 4, hx, hy, 34);
    hg.addColorStop(0, '#000');
    hg.addColorStop(1, 'rgba(30,20,10,0.5)');
    g.fillStyle = hg;
    g.beginPath();
    g.arc(hx, hy, 34, 0, Math.PI * 2);
    g.fill();
  }
}

/** Точки прицела цвета шара во рту. */
export function drawAimDots(g: CanvasRenderingContext2D, x: number, y: number, aim: number, color: number) {
  const ca = Math.cos(aim);
  const sa = Math.sin(aim);
  g.fillStyle = colorOf(color)[1];
  for (let d = 70; d < 300; d += 18) {
    g.globalAlpha = 0.6 * (1 - (d - 70) / 230);
    g.beginPath();
    g.arc(x + ca * d, y + sa * d, 2.6, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
}

/** Лягушка (рот смотрит по прицелу), kick — отдача после выстрела; шар во рту (cur < 0 — нет) и следующий на спине. */
export function drawFrog(g: CanvasRenderingContext2D, x: number, y: number, aim: number, kick: number, cur: number, next: number) {
  const ca = Math.cos(aim);
  const sa = Math.sin(aim);
  const fx = x - ca * kick * 7;
  const fy = y - sa * kick * 7;
  g.save();
  g.translate(fx, fy);
  g.rotate(aim + Math.PI / 2);
  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.beginPath();
  g.ellipse(5, 10, 50, 56, 0, 0, Math.PI * 2);
  g.fill();
  const frog = ART.get('frog');
  if (frog) g.drawImage(frog, -76, -76, 152, 152);
  else {
    const body = g.createRadialGradient(-10, -10, 5, 0, 0, 46);
    body.addColorStop(0, '#8ad860');
    body.addColorStop(1, '#2a7a1a');
    g.fillStyle = body;
    g.beginPath();
    g.ellipse(0, 0, 38, 44, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
  if (cur >= 0) drawBall(g, fx + ca * 54, fy + sa * 54, cur);
  if (next >= 0) drawBall(g, fx - ca * 30, fy - sa * 30, next, 9);
}

/** Опасно: края поля краснеют. */
export function drawDanger(g: CanvasRenderingContext2D, pulse: number) {
  if (!pulse) return;
  const v = g.createRadialGradient(FW / 2, FH / 2, FH * 0.45, FW / 2, FH / 2, FW * 0.65);
  v.addColorStop(0, 'rgba(200,0,0,0)');
  v.addColorStop(1, `rgba(200,0,0,${0.35 * pulse})`);
  g.fillStyle = v;
  g.fillRect(0, 0, FW, FH);
}
