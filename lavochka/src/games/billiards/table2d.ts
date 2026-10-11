/* Бильярд — стол сверху (статичный слой): деревянная рама с фасками и прицельными метками, сукно с фактурой и светом ламп,
 * резина бортов с тенью на сукне, лузы (тёмные провалы по створу; у русского и снукера — сетки), разметка («дом», точки; снукер — линия, «D» и точки цветных).
 * Рисуется в осях стола (метры): холст уже повёрнут и отмасштабирован. Фактуры — фотографии (Poly Haven / ambientCG, CC0). */
import type { Geometry, Pocket } from './physics';
import type { Lamp } from './balls';
import { kindOf, snookerMarks, type Variant } from './engine';

const BASE = `${import.meta.env.BASE_URL}tex/`;
const imgs = new Map<string, HTMLImageElement>();
let onLoad: () => void = () => {};
export function onTableArt(f: () => void) {
  onLoad = f;
}
function img(file: string): HTMLImageElement | null {
  let im = imgs.get(file);
  if (!im) {
    im = new Image();
    im.onload = () => onLoad();
    im.src = BASE + file;
    imgs.set(file, im);
  }
  return im.complete && im.naturalWidth ? im : null;
}

export interface Style {
  cloth: string;
  /** Накладки на углах рамы и у средних луз. */
  caps: 'cream' | 'brass' | 'leather';
  /** Оттенок дерева поверх фото ореха. */
  woodTint: string;
  woodTintAlpha: number;
  sights: 'diamond' | 'dot' | null;
  nets: boolean;
}

export function styleOf(v: Variant): Style {
  const k = kindOf(v);
  if (k === 'pool') return { cloth: '#1f7a3a', woodTint: '#9a3416', woodTintAlpha: 0.55, caps: 'cream', sights: 'diamond', nets: false };
  if (k === 'snooker') return { cloth: '#1d6630', woodTint: '#6a2410', woodTintAlpha: 0.45, caps: 'leather', sights: null, nets: true };
  return { cloth: '#2a7d3c', woodTint: '#4a2a10', woodTintAlpha: 0.15, caps: 'brass', sights: 'dot', nets: true };
}

/** Лампы над столом (для света на сукне и бликов на шарах). */
export function lampsOf(geo: Geometry): Lamp[] {
  const { w, h, kind } = geo.spec;
  // снукер — один большой короб над всем столом; пул и русский — плафоны в ряд
  if (kind === 'snooker') return [{ x: w / 2, y: h / 2, z: 1.0, hx: w * 0.36, hy: h * 0.3 }];
  const xs = kind === 'pool' ? [0.25, 0.5, 0.75] : [0.2, 0.5, 0.8];
  return xs.map((f) => ({ x: w * f, y: h / 2, z: kind === 'pool' ? 0.9 : 1.0, hx: 0.17, hy: 0.17 }));
}

/** Внешний край рамы (от носа борта). */
export const frameOf = (geo: Geometry) => geo.spec.cushion + geo.spec.rail;

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

/** Полочка лузы между губками (сукно): от линии носов до центра провала. */
function shelfPath(g: CanvasRenderingContext2D, p: Pocket, jaw: number) {
  const lx = -p.ay;
  const ly = p.ax;
  // по губкам: от кончиков до концов губок, дальше — к провалу
  const ex = p.x + p.ax * jaw;
  const ey = p.y + p.ay * jaw;
  const pts: [number, number][] = [
    [p.x + lx * p.mouth / 2, p.y + ly * p.mouth / 2],
    [ex + lx * p.throat / 2, ey + ly * p.throat / 2],
    [p.cx + lx * p.hole, p.cy + ly * p.hole],
    [p.cx - lx * p.hole, p.cy - ly * p.hole],
    [ex - lx * p.throat / 2, ey - ly * p.throat / 2],
    [p.x - lx * p.mouth / 2, p.y - ly * p.mouth / 2],
  ];
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[(i + 1) % pts.length];
    area += ax * by - bx * ay;
  }
  if (area < 0) pts.reverse();
  g.moveTo(pts[0][0], pts[0][1]);
  for (const q of pts.slice(1)) g.lineTo(q[0], q[1]);
  g.closePath();
}

/** Провал лузы — круг по ширине створа, вырезан в раме. */
function holePath(g: CanvasRenderingContext2D, p: Pocket, grow = 0) {
  g.beginPath();
  g.arc(p.cx, p.cy, p.hole + grow, 0, Math.PI * 2);
}

/**
 * Нарисовать стол. px — сколько пикселей холста в метре (для толщины линий и размытия теней).
 */
export function drawTable(g: CanvasRenderingContext2D, geo: Geometry, variant: Variant, px: number) {
  const { w, h, cushion: cu, r } = geo.spec;
  const st = styleOf(variant);
  const F = frameOf(geo);
  const lamps = lampsOf(geo);
  const walnut = img('holdem/walnut2d.webp');
  const felt = img('holdem/felt2d.webp');
  const outerR = F * 0.45;

  // тень стола на полу
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.6)';
  g.shadowBlur = 0.12 * px;
  g.shadowOffsetY = 0.03 * px;
  g.fillStyle = '#2a160a';
  roundRect(g, -F, -F, w + 2 * F, h + 2 * F, outerR);
  g.fill();
  g.restore();

  // ---- рама: дерево, волокна вдоль бортов
  const wood = (rotate: boolean) => {
    if (!walnut) return '#5a2c12';
    const pat = g.createPattern(walnut, 'repeat')!;
    const k = 0.75 / walnut.naturalWidth;
    pat.setTransform(rotate ? new DOMMatrix([0, k, -k, 0, 0, 0]) : new DOMMatrix([k, 0, 0, k, 0, 0]));
    return pat;
  };
  g.save();
  roundRect(g, -F, -F, w + 2 * F, h + 2 * F, outerR);
  g.clip();
  // длинные борта — волокна вдоль x, короткие — вдоль y (стык под 45°)
  g.fillStyle = wood(false);
  g.fillRect(-F, -F, w + 2 * F, h + 2 * F);
  g.fillStyle = wood(true);
  for (const [x0, sgn] of [[-F, 1], [w + F, -1]] as const) {
    g.beginPath();
    g.moveTo(x0, -F);
    g.lineTo(x0 + sgn * F, 0);
    g.lineTo(x0 + sgn * F, h);
    g.lineTo(x0, h + F);
    g.closePath();
    g.fill();
  }
  // оттенок породы поверх фото ореха: «цвет» сохраняет рисунок волокон
  g.globalCompositeOperation = 'color';
  g.globalAlpha = st.woodTintAlpha;
  g.fillStyle = st.woodTint;
  g.fillRect(-F, -F, w + 2 * F, h + 2 * F);
  g.globalCompositeOperation = 'overlay';
  g.globalAlpha = 0.25;
  g.fillStyle = '#ffffff';
  g.fillRect(-F, -F, w + 2 * F, h + 2 * F);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  // лак: лёгкий общий блеск от ламп
  for (const l of lamps) {
    const gr = g.createRadialGradient(l.x, l.y, 0, l.x, l.y, w * 0.55);
    gr.addColorStop(0, 'rgba(255,230,190,0.16)');
    gr.addColorStop(1, 'rgba(255,230,190,0)');
    g.fillStyle = gr;
    g.fillRect(-F, -F, w + 2 * F, h + 2 * F);
  }
  // стыки досок в углах
  g.strokeStyle = 'rgba(20,8,2,0.55)';
  g.lineWidth = 1.2 / px;
  for (const [x0, y0, sx, sy] of [[-F, -F, 1, 1], [w + F, -F, -1, 1], [w + F, h + F, -1, -1], [-F, h + F, 1, -1]]) {
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x0 + sx * F, y0 + sy * F);
    g.stroke();
  }
  // скруглённый внешний край: тень внутрь
  g.shadowColor = 'rgba(0,0,0,0.75)';
  g.shadowBlur = F * 0.22 * px;
  g.strokeStyle = '#000';
  g.lineWidth = F * 0.4;
  roundRect(g, -F - F * 0.2, -F - F * 0.2, w + 2 * F + F * 0.4, h + 2 * F + F * 0.4, outerR + F * 0.2);
  g.stroke();
  g.shadowBlur = 0;
  g.shadowColor = 'transparent';
  // блик на скруглении
  g.strokeStyle = 'rgba(255,225,190,0.18)';
  g.lineWidth = F * 0.06;
  roundRect(g, -F + F * 0.12, -F + F * 0.12, w + 2 * F - F * 0.24, h + 2 * F - F * 0.24, outerR * 0.8);
  g.stroke();
  // внутренняя фаска у резины — вдоль бортов, от лузы до лузы
  for (const [d, col, lw] of [[0.02, 'rgba(0,0,0,0.5)', 0.05], [0.07, 'rgba(255,220,180,0.22)', 0.025]] as const) {
    g.strokeStyle = col;
    g.lineWidth = F * lw;
    for (const poly of geo.cushions) {
      const [e0, e1] = backEdge(poly, geo, F * d);
      g.beginPath();
      g.moveTo(e0[0], e0[1]);
      g.lineTo(e1[0], e1[1]);
      g.stroke();
    }
  }
  g.restore();

  // ---- сукно: поле и полочки луз (под резиной — резина)
  g.save();
  g.beginPath();
  g.rect(0, 0, w, h);
  for (const p of geo.pockets) shelfPath(g, p, geo.spec.jaw);
  g.clip();
  g.fillStyle = st.cloth;
  g.fillRect(-cu, -cu, w + 2 * cu, h + 2 * cu);
  if (felt) {
    const pat = g.createPattern(felt, 'repeat')!;
    const k = 0.35 / felt.naturalWidth;
    pat.setTransform(new DOMMatrix([k, 0, 0, k, 0, 0]));
    g.globalCompositeOperation = 'overlay';
    g.globalAlpha = 0.55;
    g.fillStyle = pat;
    g.fillRect(-cu, -cu, w + 2 * cu, h + 2 * cu);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }
  // ворс: едва заметные полосы вдоль стола
  g.globalAlpha = 0.035;
  g.fillStyle = '#000';
  for (let y = -cu; y < h + cu; y += 0.006) if ((Math.sin(y * 913) + 1) * 0.5 > 0.6) g.fillRect(-cu, y, w + 2 * cu, 0.002);
  g.globalAlpha = 1;
  // свет ламп и затемнение к краям
  for (const l of lamps) {
    const gr = g.createRadialGradient(l.x, l.y, 0, l.x, l.y, Math.max(w, h) * 0.42);
    gr.addColorStop(0, 'rgba(255,248,215,0.16)');
    gr.addColorStop(0.6, 'rgba(255,248,215,0.05)');
    gr.addColorStop(1, 'rgba(255,248,215,0)');
    g.fillStyle = gr;
    g.fillRect(-cu, -cu, w + 2 * cu, h + 2 * cu);
  }
  const vg = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.62);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.32)');
  g.fillStyle = vg;
  g.fillRect(-cu, -cu, w + 2 * cu, h + 2 * cu);

  // ---- разметка
  g.strokeStyle = 'rgba(255,255,255,0.32)';
  g.fillStyle = 'rgba(255,255,255,0.45)';
  g.lineWidth = 1.2 / px;
  const spot = (x: number, y: number, s = 0.004) => {
    g.beginPath();
    g.arc(x, y, s, 0, Math.PI * 2);
    g.fill();
  };
  const kind = kindOf(variant);
  if (kind === 'snooker') {
    const { baulk, dRad, spots } = snookerMarks(geo.spec);
    g.beginPath();
    g.moveTo(baulk, 0);
    g.lineTo(baulk, h);
    g.arc(baulk, h / 2, dRad, Math.PI / 2, Math.PI * 1.5);
    g.stroke();
    for (const k of [16, 17, 18, 19, 20, 21]) spot(spots[k][0], spots[k][1], 0.003);
  } else {
    if (kind === 'pool') {
      g.globalAlpha = 0.5;
      g.beginPath();
      g.moveTo(w / 4, 0);
      g.lineTo(w / 4, h);
      g.stroke();
      g.globalAlpha = 1;
    }
    spot(w / 4, h / 2);
    spot(w * 0.75, h / 2);
    if (kind === 'russian') spot(w / 2, h / 2);
  }
  g.restore();

  // ---- тень резины на сукне
  g.save();
  g.beginPath();
  g.rect(-cu, -cu, w + 2 * cu, h + 2 * cu);
  g.clip();
  g.shadowColor = 'rgba(0,0,0,0.55)';
  g.shadowBlur = r * 0.6 * px;
  g.fillStyle = '#000';
  for (const poly of geo.cushions) cushionPath(g, poly, geo), g.fill();
  g.restore();

  // ---- резина бортов
  for (const poly of geo.cushions) {
    g.save();
    cushionPath(g, poly, geo);
    g.clip();
    g.fillStyle = st.cloth;
    g.fill();
    if (felt) {
      const pat = g.createPattern(felt, 'repeat')!;
      const k = 0.35 / felt.naturalWidth;
      pat.setTransform(new DOMMatrix([k, 0, 0, k, 0, 0]));
      g.globalCompositeOperation = 'overlay';
      g.globalAlpha = 0.5;
      g.fillStyle = pat;
      g.fill();
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
    }
    // наклон носа: от светлой кромки к тени у рамы
    const [a, b] = [poly[1], poly[2]];
    const tx = b[0] - a[0];
    const ty = b[1] - a[1];
    const tl = Math.hypot(tx, ty);
    // нормаль наружу (к раме)
    let nx = ty / tl;
    let ny = -tx / tl;
    const midx = (a[0] + b[0]) / 2;
    const midy = (a[1] + b[1]) / 2;
    if ((midx + nx - w / 2) ** 2 + (midy + ny - h / 2) ** 2 < (midx - w / 2) ** 2 + (midy - h / 2) ** 2) {
      nx = -nx;
      ny = -ny;
    }
    const gr = g.createLinearGradient(midx, midy, midx + nx * cu, midy + ny * cu);
    gr.addColorStop(0, 'rgba(255,255,230,0.22)');
    gr.addColorStop(0.08, 'rgba(255,255,230,0.05)');
    gr.addColorStop(0.35, 'rgba(0,0,0,0.0)');
    gr.addColorStop(0.85, 'rgba(0,0,0,0.18)');
    gr.addColorStop(1, 'rgba(0,0,0,0.45)');
    g.fillStyle = gr;
    g.fillRect(-F, -F, w + 2 * F, h + 2 * F);
    g.restore();
    // кромка носа
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.lineWidth = 1 / px;
    g.beginPath();
    g.moveTo(poly[0][0], poly[0][1]);
    for (const p of poly.slice(1)) g.lineTo(p[0], p[1]);
    g.stroke();
  }

  // ---- прицельные метки
  if (st.sights) {
    const mid = cu + (F - cu) * 0.5;
    const marks: [number, number][] = [];
    for (let i = 1; i < 8; i++) if (i !== 4) for (const y of [-mid, h + mid]) marks.push([(i * w) / 8, y]);
    for (let i = 1; i < 4; i++) for (const x of [-mid, w + mid]) marks.push([x, (i * h) / 4]);
    for (const [x, y] of marks) {
      const s = st.sights === 'diamond' ? 0.011 : 0.006;
      g.save();
      g.translate(x, y);
      const gr = g.createRadialGradient(-s * 0.3, -s * 0.3, 0, 0, 0, s * 1.2);
      gr.addColorStop(0, '#ffffff');
      gr.addColorStop(0.5, st.sights === 'diamond' ? '#e8e4dc' : '#f0d890');
      gr.addColorStop(1, st.sights === 'diamond' ? '#a9b4c0' : '#9a7a30');
      g.fillStyle = gr;
      g.shadowColor = 'rgba(0,0,0,0.5)';
      g.shadowBlur = 2;
      g.beginPath();
      if (st.sights === 'diamond') {
        const vert = Math.abs(y) < 1e-9 || x < 0 || x > w;
        const a = vert ? s * 0.55 : s * 1.3;
        const b2 = vert ? s * 1.3 : s * 0.55;
        g.moveTo(-a, 0);
        g.lineTo(0, -b2);
        g.lineTo(a, 0);
        g.lineTo(0, b2);
        g.closePath();
      } else g.arc(0, 0, s, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
  }

  // ---- накладки: углы рамы и у средних луз (луза врезана в накладку)
  g.save();
  // по раме, кроме поля и резины: накладка доходит вплотную до губок и провала
  g.beginPath();
  roundRect(g, -F, -F, w + 2 * F, h + 2 * F, outerR);
  g.rect(0, 0, w, h);
  for (const poly of geo.cushions) cushionSub(g, poly, geo);
  g.clip('evenodd');
  const capFill = (x0: number, y0: number, x1: number, y1: number) => {
    if (st.caps === 'cream') {
      const gr = g.createLinearGradient(x0, y0, x1, y1);
      gr.addColorStop(0, '#f3e6c6');
      gr.addColorStop(0.5, '#e2cc9c');
      gr.addColorStop(1, '#c9ae7a');
      return gr;
    }
    if (st.caps === 'brass') {
      const gr = g.createLinearGradient(x0, y0, x1, y1);
      gr.addColorStop(0, '#f2d688');
      gr.addColorStop(0.4, '#b98d34');
      gr.addColorStop(0.7, '#e3bf62');
      gr.addColorStop(1, '#7a5718');
      return gr;
    }
    const gr = g.createLinearGradient(x0, y0, x1, y1);
    gr.addColorStop(0, '#5a3220');
    gr.addColorStop(1, '#2a140b');
    return gr;
  };
  const capEdge = st.caps === 'cream' ? 'rgba(110,80,40,0.55)' : st.caps === 'brass' ? 'rgba(70,45,10,0.7)' : 'rgba(0,0,0,0.5)';
  for (const p of geo.pockets) {
    const corner = Math.abs(p.ax) > 0.1 && Math.abs(p.ay) > 0.1;
    g.beginPath();
    if (corner) {
      // квадрат от внешнего угла рамы до чуть дальше лузы, внешний угол скруглён
      const sx = p.ax < 0 ? -F : w + F;
      const sy = p.ay < 0 ? -F : h + F;
      const ex = p.cx - p.ax * p.hole * 1.05;
      const ey = p.cy - p.ay * p.hole * 1.05;
      const x0 = Math.min(sx, ex);
      const y0 = Math.min(sy, ey);
      roundRect(g, x0, y0, Math.abs(ex - sx), Math.abs(ey - sy), [p.ax < 0 && p.ay < 0 ? outerR : 0.01, p.ax > 0 && p.ay < 0 ? outerR : 0.01, p.ax > 0 && p.ay > 0 ? outerR : 0.01, p.ax < 0 && p.ay > 0 ? outerR : 0.01] as unknown as number);
      g.fillStyle = capFill(sx, sy, ex, ey);
    } else {
      const half = p.hole * 1.3;
      const y0 = p.ay < 0 ? -F : h;
      roundRect(g, p.cx - half, y0, half * 2, F, 0.008);
      g.fillStyle = capFill(p.cx - half, y0, p.cx + half, y0 + F);
    }
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.45)';
    g.shadowBlur = 0.012 * px;
    g.fill();
    g.restore();
    g.strokeStyle = capEdge;
    g.lineWidth = 1.2 / px;
    g.stroke();
  }
  g.restore();

  // ---- полочки луз между губками — сукно поверх накладок, в тени
  g.save();
  g.beginPath();
  for (const p of geo.pockets) shelfPath(g, p, geo.spec.jaw);
  g.clip();
  g.fillStyle = st.cloth;
  g.fillRect(-F, -F, w + 2 * F, h + 2 * F);
  if (felt) {
    const pat = g.createPattern(felt, 'repeat')!;
    const k = 0.35 / felt.naturalWidth;
    pat.setTransform(new DOMMatrix([k, 0, 0, k, 0, 0]));
    g.globalCompositeOperation = 'overlay';
    g.globalAlpha = 0.5;
    g.fillStyle = pat;
    g.fillRect(-F, -F, w + 2 * F, h + 2 * F);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.fillRect(-F, -F, w + 2 * F, h + 2 * F);
  g.restore();

  // ---- лузы
  geo.pockets.forEach((p) => {
    // провал
    g.save();
    holePath(g, p, 0);
    const gr = g.createRadialGradient(p.cx + p.ax * p.hole * 0.3, p.cy + p.ay * p.hole * 0.3, p.hole * 0.1, p.cx, p.cy, p.hole * 1.4);
    gr.addColorStop(0, '#020202');
    gr.addColorStop(0.7, '#0b0807');
    gr.addColorStop(1, '#1d1510');
    g.fillStyle = gr;
    g.fill();
    g.clip();
    if (st.nets) {
      // сетка в глубине
      g.strokeStyle = 'rgba(190,170,140,0.13)';
      g.lineWidth = 1 / px;
      const s = 0.011;
      for (let d = -p.hole * 1.5; d < p.hole * 1.5; d += s) {
        g.beginPath();
        g.moveTo(p.cx + d - p.hole, p.cy - p.hole);
        g.lineTo(p.cx + d + p.hole, p.cy + p.hole);
        g.moveTo(p.cx + d + p.hole, p.cy - p.hole);
        g.lineTo(p.cx + d - p.hole, p.cy + p.hole);
        g.stroke();
      }
    }
    // кожаная кромка провала: внутренняя тень
    g.shadowColor = 'rgba(0,0,0,0.9)';
    g.shadowBlur = r * 0.8 * px;
    g.strokeStyle = '#000';
    g.lineWidth = r;
    holePath(g, p, r * 0.5);
    g.stroke();
    g.restore();
  });
}

/** Задний край резины (по раме) — от губки до губки; extra — ещё дальше в раму. */
function backEdge(poly: [number, number][], geo: Geometry, extra = 0): [[number, number], [number, number]] {
  const { w, h, cushion: cu } = geo.spec;
  // куда «наружу»: по тому, у какого края стола лежит борт
  const [a, b] = [poly[1], poly[2]];
  const horiz = Math.abs(a[1] - b[1]) < 1e-6;
  const off = cu + 0.004 + extra;
  const out = (p: [number, number]): [number, number] => {
    if (horiz) return [p[0], a[1] < h / 2 ? -off : h + off];
    return [a[0] < w / 2 ? -off : w + off, p[1]];
  };
  return [out(poly[0]), out(poly[poly.length - 1])];
}

/** Контур резины: нос (ломаная от губки до губки) и обратно по раме. */
function cushionPath(g: CanvasRenderingContext2D, poly: [number, number][], geo: Geometry) {
  g.beginPath();
  cushionSub(g, poly, geo);
}

function cushionSub(g: CanvasRenderingContext2D, poly: [number, number][], geo: Geometry) {
  const [e0, e1] = backEdge(poly, geo);
  g.moveTo(poly[0][0], poly[0][1]);
  for (const p of poly.slice(1)) g.lineTo(p[0], p[1]);
  g.lineTo(e1[0], e1[1]);
  g.lineTo(e0[0], e0[1]);
  g.closePath();
}
