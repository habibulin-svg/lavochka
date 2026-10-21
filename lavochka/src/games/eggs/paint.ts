/* «Яйца динозавров» — общая отрисовка для одиночной игры и сетевого стола: картинки, яйцо, фон, каменный потолок, черта, динозаврик. */
import { cover, Sprites } from '../../core/arcade-fx';
import { DEAD_ROW, FIELD_W, ROW_H, SHOOTER_Y } from './logic';

export const EGG = [
  ['#7ac850', '#2a6a1a'],
  ['#5aa0e8', '#1a4a90'],
  ['#e85a4a', '#8a1a10'],
  ['#f0d040', '#9a7a08'],
  ['#b070e0', '#5a2a8a'],
  ['#f09a40', '#9a4a08'],
];

/** Картинки (tools/arcade-art): яйца по цвету — как EGG, фоны по уровню, динозаврик-игрушка, каменный потолок, карта. */
export const EGGS = ['egg0', 'egg1', 'egg2', 'egg3', 'egg4', 'egg5'] as const;
export const BG = ['bg1', 'bg2', 'bg3'] as const;
export const ART = new Sprites('eggs', [...EGGS, ...BG, 'dino', 'ceiling', 'map'] as const);

/** Высота поля в диаметрах (снизу место под динозаврика-игрушку). */
export const FIELD_H = SHOOTER_Y + 1.9;

/** Яйцо в точке (x, y) — в диаметрах, U — пикселей на диаметр. */
export function drawEgg(g: CanvasRenderingContext2D, U: number, x: number, y: number, color: number, a = 1, rot = 0) {
  const [c, d] = EGG[color % EGG.length];
  const px = x * U;
  const py = y * U;
  const im = ART.get(EGGS[color % EGGS.length]);
  if (im) {
    g.save();
    g.globalAlpha = a;
    g.translate(px, py);
    if (rot) g.rotate(rot);
    g.drawImage(im, -U * 0.56, -U * 0.56, U * 1.12, U * 1.12);
    g.restore();
    return;
  }
  g.globalAlpha = a;
  const gr = g.createRadialGradient(px - U * 0.15, py - U * 0.18, Math.max(1, U / 28), px, py, U * 0.5);
  gr.addColorStop(0, '#fffbe8');
  gr.addColorStop(0.45, c);
  gr.addColorStop(1, d);
  g.fillStyle = gr;
  g.beginPath();
  g.ellipse(px, py + U / 56, U * 0.4, U * 0.47, 0, 0, Math.PI * 2);
  g.fill();
  if (U >= 24) {
    g.fillStyle = 'rgba(40,20,0,0.35)';
    for (const [dx, dy, r] of [
      [-0.12, 0.05, 0.05],
      [0.14, -0.08, 0.04],
      [0.05, 0.2, 0.035],
      [-0.05, -0.2, 0.03],
    ]) {
      g.beginPath();
      g.arc(px + dx * U, py + dy * U, r * U, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.globalAlpha = 1;
}

/** Фон двора с притемнённым верхом (на нём читаются яйца). */
export function drawBack(g: CanvasRenderingContext2D, W: number, H: number, bg: number) {
  const bgi = ART.get(BG[bg % BG.length]);
  if (bgi) {
    cover(g, bgi, -8, -8, W + 16, H + 16);
    const dim = g.createLinearGradient(0, 0, 0, H);
    dim.addColorStop(0, 'rgba(10,15,5,0.45)');
    dim.addColorStop(0.75, 'rgba(10,15,5,0.15)');
    dim.addColorStop(1, 'rgba(10,15,5,0)');
    g.fillStyle = dim;
    g.fillRect(-8, -8, W + 16, H + 16);
  } else {
    const grd = g.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, '#2a4a1a');
    grd.addColorStop(1, '#5a7a2a');
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
  }
}

/** Каменный потолок: над плитой — камень, нижний край плиты — по линии top (пиксели). */
export function drawCeiling(g: CanvasRenderingContext2D, W: number, top: number) {
  const ceil = ART.get('ceiling');
  if (ceil) {
    const ch = (W * ceil.naturalHeight) / ceil.naturalWidth;
    const cy = top + (10 * W) / (FIELD_W * 56) - ch * 0.66;
    if (cy > -8) {
      g.fillStyle = '#4e4a46';
      g.fillRect(-8, -8, W + 16, cy + 20);
    }
    g.drawImage(ceil, -8, cy, W + 16, ch);
  } else {
    g.fillStyle = '#6a5a4a';
    g.fillRect(0, 0, W, top + 6);
    g.fillStyle = '#4a3a2a';
    g.fillRect(0, top, W, 6);
  }
}

/** Красная черта; near (0…1) — яйца близко, светится сильнее. */
export function drawLine(g: CanvasRenderingContext2D, U: number, W: number, near: number) {
  const lineY = (DEAD_ROW * ROW_H + 0.05) * U;
  const k = U / 56;
  g.save();
  g.shadowColor = '#ff3020';
  g.shadowBlur = (6 + near * 14) * k;
  g.setLineDash([10 * k, 8 * k]);
  g.strokeStyle = near ? `rgba(255,${80 - near * 60},40,1)` : '#e8402a';
  g.lineWidth = (2 + near * 2) * k;
  g.beginPath();
  g.moveTo(0, lineY);
  g.lineTo(W, lineY);
  g.stroke();
  g.restore();
}

/** Динозаврик-игрушка, наклонённый к прицелу; возвращает точку яйца на изготовку (в диаметрах). */
export function drawDino(g: CanvasRenderingContext2D, U: number, aim: number): [number, number] {
  const sx = (FIELD_W / 2) * U;
  const sy = SHOOTER_Y * U;
  const dino = ART.get('dino');
  if (dino) {
    // на картинке у игрушки на голове яйцо (на 0.68 высоты от ног) — туда и кладём яйцо на изготовку, оно же точка вылета
    const lean = (aim + Math.PI / 2) * 0.15;
    const s = U * 2.6;
    const feet = sy + s * 0.68;
    g.save();
    g.translate(sx, feet);
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.beginPath();
    g.ellipse(0, 0, s * 0.3, s * 0.06, 0, 0, Math.PI * 2);
    g.fill();
    g.rotate(lean);
    g.drawImage(dino, -s / 2, -s * 0.86, s, s);
    g.restore();
    return [FIELD_W / 2 + (Math.sin(lean) * s * 0.68) / U, (feet - Math.cos(lean) * s * 0.68) / U];
  }
  g.save();
  g.translate(sx, sy);
  g.rotate(aim + Math.PI / 2);
  g.fillStyle = '#4a9a3a';
  g.beginPath();
  g.ellipse(0, 0.32 * U, 0.6 * U, 0.46 * U, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#3a7a2a';
  g.beginPath();
  g.ellipse(0, -0.1 * U, 0.32 * U, 0.54 * U, 0, 0, Math.PI * 2);
  g.fill();
  g.restore();
  return [FIELD_W / 2 + Math.cos(aim) * 0.55, SHOOTER_Y + Math.sin(aim) * 0.55];
}

/** Точки прицела цвета яйца — до первого касания и после отскока, гаснут к концу. */
export function drawAim(g: CanvasRenderingContext2D, U: number, path: [number, number][], color: number) {
  const pts = path.slice(0, 3);
  g.fillStyle = EGG[color % EGG.length][0];
  let walked = 0;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const seg = Math.hypot(x1 - x0, y1 - y0);
    for (let d = (0.35 - (walked % 0.35)) % 0.35; d < seg; d += 0.35) {
      const k = d / seg;
      const fade = Math.max(0, 1 - (walked + d) / 9);
      if (fade <= 0) break;
      g.globalAlpha = 0.85 * fade;
      g.beginPath();
      g.arc((x0 + (x1 - x0) * k) * U, (y0 + (y1 - y0) * k) * U, (3 * U) / 56, 0, Math.PI * 2);
      g.fill();
    }
    walked += seg;
  }
  g.globalAlpha = 1;
}

/** Точка на ломаной path через долю t пути. */
export function along(path: [number, number][], t: number): [number, number] {
  const total = path.reduce((a, p, i) => (i ? a + Math.hypot(p[0] - path[i - 1][0], p[1] - path[i - 1][1]) : 0), 0);
  let need = total * t;
  let pos = path[0];
  for (let i = 1; i < path.length; i++) {
    const seg = Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
    if (need <= seg) {
      const k = seg ? need / seg : 0;
      return [path[i - 1][0] + (path[i][0] - path[i - 1][0]) * k, path[i - 1][1] + (path[i][1] - path[i - 1][1]) * k];
    }
    need -= seg;
    pos = path[i];
  }
  return pos;
}

export const pathLen = (path: [number, number][]) => path.reduce((a, p, i) => (i ? a + Math.hypot(p[0] - path[i - 1][0], p[1] - path[i - 1][1]) : 0), 0);
