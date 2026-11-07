/* Аэрохоккей — отрисовка стола на canvas 2D. Всё рисуется в координатах стола (метры) через матрицу вида:
 * неподвижное (поле, разметка, дырочки, борта) — один раз в запасной холст на каждый размер и тему, по кадру — шайба, биты, искры.
 * Темы — яркие, «по двору»: каток, дискотека, пионерлагерь, космос. */
import { CORNER, GOAL, L, MAL_R, PUCK_R, W, type AhState } from './engine';

/** Ориентация: 0 — место 0 внизу, 1 — место 1 внизу, 2 — поперёк (место 0 слева). */
export type Orient = 0 | 1 | 2;

interface Theme {
  bg: (g: CanvasRenderingContext2D, w: number, h: number) => void;
  surf: [string, string];
  holes: string;
  line: string;
  center: string;
  glow: number;
  rail: [string, string, string];
  railTrim: string;
  puck: [string, string];
  puckGlow: string;
  deco: (g: CanvasRenderingContext2D) => void;
  spark: string[];
}

const RAIL = 0.07;

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Детерминированный «случайный» ряд — чтобы звёзды и снег не прыгали при перерисовке. */
function rnd(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function star(g: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string) {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.42 : r;
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath();
  g.fillStyle = fill;
  g.fill();
}

const THEMES: Record<string, Theme> = {
  katok: {
    bg(g, w, h) {
      const gr = g.createRadialGradient(w * 0.5, h * 0.1, 10, w * 0.5, h * 0.5, Math.max(w, h) * 0.8);
      gr.addColorStop(0, '#5a7fb8');
      gr.addColorStop(0.5, '#25406e');
      gr.addColorStop(1, '#101c36');
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
      const r = rnd(7);
      g.fillStyle = 'rgba(255,255,255,0.75)';
      for (let i = 0; i < 160; i++) {
        g.beginPath();
        g.arc(r() * w, r() * h, 0.6 + r() * 1.6, 0, Math.PI * 2);
        g.fill();
      }
    },
    surf: ['#f4fbff', '#c9e6f8'],
    holes: 'rgba(40,90,140,0.22)',
    line: '#2a6ae8',
    center: '#e8322a',
    glow: 0,
    rail: ['#ffffff', '#d8e6f0', '#8aa4bc'],
    railTrim: '#e8322a',
    puck: ['#2a2f38', '#0b0d12'],
    puckGlow: 'rgba(0,0,0,0)',
    deco(g) {
      // царапины коньков и снежинка в центре
      const r = rnd(3);
      g.strokeStyle = 'rgba(120,170,210,0.35)';
      g.lineWidth = 0.003;
      for (let i = 0; i < 40; i++) {
        const x = (r() - 0.5) * W * 0.9;
        const y = r() * L;
        const a = r() * Math.PI;
        const d = 0.05 + r() * 0.18;
        g.beginPath();
        g.moveTo(x, y);
        g.quadraticCurveTo(x + Math.cos(a) * d * 0.5 + 0.02, y + Math.sin(a) * d * 0.5, x + Math.cos(a) * d, y + Math.sin(a) * d);
        g.stroke();
      }
      g.save();
      g.translate(0, L / 2);
      g.strokeStyle = 'rgba(42,106,232,0.55)';
      g.lineWidth = 0.01;
      g.lineCap = 'round';
      for (let i = 0; i < 6; i++) {
        g.rotate(Math.PI / 3);
        g.beginPath();
        g.moveTo(0, 0);
        g.lineTo(0, 0.09);
        g.moveTo(0, 0.055);
        g.lineTo(0.025, 0.08);
        g.moveTo(0, 0.055);
        g.lineTo(-0.025, 0.08);
        g.stroke();
      }
      g.restore();
    },
    spark: ['#ffffff', '#bfe4ff', '#7ab8ff'],
  },
  disco: {
    bg(g, w, h) {
      g.fillStyle = '#0c0418';
      g.fillRect(0, 0, w, h);
      const spots: [number, number, string][] = [
        [0.15, 0.2, 'rgba(255,40,200,0.45)'],
        [0.85, 0.25, 'rgba(40,220,255,0.4)'],
        [0.2, 0.85, 'rgba(255,220,40,0.3)'],
        [0.8, 0.8, 'rgba(120,60,255,0.45)'],
      ];
      for (const [x, y, c] of spots) {
        const gr = g.createRadialGradient(x * w, y * h, 0, x * w, y * h, Math.max(w, h) * 0.45);
        gr.addColorStop(0, c);
        gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr;
        g.fillRect(0, 0, w, h);
      }
    },
    surf: ['#2a0f5a', '#140630'],
    holes: 'rgba(200,140,255,0.22)',
    line: '#2ef9ff',
    center: '#ff3df2',
    glow: 1,
    rail: ['#3a3a48', '#16161e', '#000000'],
    railTrim: '#ff3df2',
    puck: ['#fff36a', '#ffb800'],
    puckGlow: 'rgba(255,230,60,0.85)',
    deco(g) {
      // перспективная «сетка танцпола» по половинам
      g.strokeStyle = 'rgba(46,249,255,0.12)';
      g.lineWidth = 0.004;
      for (let i = -5; i <= 5; i++) {
        g.beginPath();
        g.moveTo((i / 5) * (W / 2), 0);
        g.lineTo((i / 5) * (W / 2), L);
        g.stroke();
      }
      for (let j = 1; j < 20; j++) {
        g.beginPath();
        g.moveTo(-W / 2, (j / 20) * L);
        g.lineTo(W / 2, (j / 20) * L);
        g.stroke();
      }
      // зеркальный шар в центре
      g.save();
      g.translate(0, L / 2);
      const gr = g.createRadialGradient(-0.02, -0.02, 0.005, 0, 0, 0.085);
      gr.addColorStop(0, '#ffffff');
      gr.addColorStop(0.5, '#b9b0d8');
      gr.addColorStop(1, '#4a3d78');
      g.fillStyle = gr;
      g.beginPath();
      g.arc(0, 0, 0.08, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = 'rgba(30,20,60,0.55)';
      g.lineWidth = 0.002;
      for (let i = -3; i <= 3; i++) {
        g.beginPath();
        g.ellipse(0, 0, Math.abs(i) < 3 ? 0.08 * Math.cos((i * Math.PI) / 7) : 0.001, 0.08, 0, 0, Math.PI * 2);
        g.stroke();
        g.beginPath();
        g.moveTo(-0.08 * Math.cos((i * Math.PI) / 7), (i / 3.5) * 0.08);
        g.lineTo(0.08 * Math.cos((i * Math.PI) / 7), (i / 3.5) * 0.08);
        g.stroke();
      }
      g.restore();
    },
    spark: ['#ff3df2', '#2ef9ff', '#fff36a', '#ffffff'],
  },
  lager: {
    bg(g, w, h) {
      // вагонка: доски стены вожатской
      g.fillStyle = '#8a5a2e';
      g.fillRect(0, 0, w, h);
      const r = rnd(11);
      const bw = Math.max(26, w / 22);
      for (let x = 0; x < w; x += bw) {
        const c = 120 + Math.floor(r() * 40);
        g.fillStyle = `rgb(${c + 40},${c - 10},${c - 60})`;
        g.fillRect(x, 0, bw - 2, h);
        g.fillStyle = 'rgba(60,30,10,0.18)';
        for (let k = 0; k < 6; k++) g.fillRect(x + r() * bw, 0, 1, h);
      }
      const gr = g.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, Math.max(w, h) * 0.75);
      gr.addColorStop(0, 'rgba(255,220,150,0.25)');
      gr.addColorStop(1, 'rgba(40,20,5,0.6)');
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
    },
    surf: ['#3fc488', '#1f9a62'],
    holes: 'rgba(10,60,30,0.28)',
    line: '#ffffff',
    center: '#ffd23a',
    glow: 0,
    rail: ['#ff5a3a', '#d8261a', '#7a0f08'],
    railTrim: '#ffd23a',
    puck: ['#ffffff', '#cfd6dc'],
    puckGlow: 'rgba(0,0,0,0)',
    deco(g) {
      // костёр-звезда в центре и горны у ворот
      star(g, 0, L / 2, 0.085, '#ffd23a');
      star(g, 0, L / 2, 0.05, '#ff5a3a');
      g.save();
      g.globalAlpha = 0.18;
      for (const y of [L * 0.25, L * 0.75]) star(g, 0, y, 0.12, '#ffffff');
      g.restore();
    },
    spark: ['#ffd23a', '#ffffff', '#ff8a3a'],
  },
  kosmos: {
    bg(g, w, h) {
      const gr = g.createLinearGradient(0, 0, w, h);
      gr.addColorStop(0, '#05081e');
      gr.addColorStop(1, '#170a33');
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
      const r = rnd(5);
      for (let i = 0; i < 260; i++) {
        g.fillStyle = `rgba(255,255,255,${0.3 + r() * 0.7})`;
        g.fillRect(r() * w, r() * h, r() < 0.1 ? 2 : 1, r() < 0.1 ? 2 : 1);
      }
    },
    surf: ['#123a8a', '#071a4a'],
    holes: 'rgba(140,200,255,0.25)',
    line: '#7af0ff',
    center: '#ff8a2a',
    glow: 0.7,
    rail: ['#ffb36a', '#e06a1a', '#6a2a08'],
    railTrim: '#e8eef8',
    puck: ['#ffffff', '#b9d4ff'],
    puckGlow: 'rgba(160,220,255,0.8)',
    deco(g) {
      // туманность и звёзды по полю, планета в центре, орбита
      const r = rnd(9);
      for (const [x, y, c] of [
        [-0.2, L * 0.28, 'rgba(255,60,180,0.25)'],
        [0.22, L * 0.72, 'rgba(60,255,220,0.2)'],
      ] as [number, number, string][]) {
        const gr = g.createRadialGradient(x, y, 0, x, y, 0.45);
        gr.addColorStop(0, c);
        gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr;
        g.fillRect(-W / 2, 0, W, L);
      }
      for (let i = 0; i < 140; i++) {
        g.fillStyle = `rgba(255,255,255,${0.25 + r() * 0.6})`;
        g.beginPath();
        g.arc((r() - 0.5) * W, r() * L, 0.002 + r() * 0.004, 0, Math.PI * 2);
        g.fill();
      }
      g.save();
      g.translate(0, L / 2);
      const pg = g.createRadialGradient(-0.025, -0.025, 0.005, 0, 0, 0.08);
      pg.addColorStop(0, '#9fe0ff');
      pg.addColorStop(0.6, '#2a7ad8');
      pg.addColorStop(1, '#0a2a6a');
      g.fillStyle = pg;
      g.beginPath();
      g.arc(0, 0, 0.075, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(80,200,110,0.8)';
      g.beginPath();
      g.ellipse(-0.02, 0.01, 0.03, 0.018, 0.5, 0, Math.PI * 2);
      g.ellipse(0.03, -0.025, 0.018, 0.012, -0.3, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = 'rgba(255,200,120,0.7)';
      g.lineWidth = 0.004;
      g.beginPath();
      g.ellipse(0, 0, 0.12, 0.035, -0.35, 0, Math.PI * 2);
      g.stroke();
      g.restore();
    },
    spark: ['#ffffff', '#9fe0ff', '#ffb36a'],
  },
};

export const themeOf = (id: string | undefined) => THEMES[id ?? ''] ?? THEMES.katok;

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  t: number;
  c: string;
}

export class TableCanvas {
  readonly canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private stat: HTMLCanvasElement;
  private statKey = '';
  private m = new DOMMatrix();
  private dpr = 1;
  private trail: [number, number][] = [];
  private sparks: Spark[] = [];
  private flash: { seat: number; t: number } | null = null;
  private shake = 0;
  orient: Orient = 0;
  theme = 'katok';

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    parent.appendChild(this.canvas);
    this.g = this.canvas.getContext('2d')!;
    this.stat = document.createElement('canvas');
  }

  /** Матрица «стол → экран» (пиксели холста). */
  private layout() {
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const across = this.orient === 2;
    const tw = (across ? L : W) + RAIL * 2;
    const th = (across ? W : L) + RAIL * 2;
    const s = Math.min(cw / (tw * 1.06), ch / (th * 1.04));
    const m = new DOMMatrix().translate(cw / 2, ch / 2).scale(s, s);
    if (this.orient === 0) m.scaleSelf(1, -1);
    else if (this.orient === 1) m.scaleSelf(-1, 1);
    else m.rotateSelf(90).scaleSelf(1, -1);
    m.translateSelf(0, -L / 2);
    this.m = m;
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(50, Math.round(r.width * this.dpr));
    const h = Math.max(50, Math.round(r.height * this.dpr));
    if (w !== this.canvas.width || h !== this.canvas.height) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  /** Точка экрана (clientX/Y) → стол. */
  toTable(cx: number, cy: number): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    const p = this.m.inverse().transformPoint(new DOMPoint((cx - r.left) * this.dpr, (cy - r.top) * this.dpr));
    return [p.x, p.y];
  }

  /** Направление экрана (вправо, вверх) → направление на столе. */
  screenToTableDir(dx: number, dy: number): [number, number] {
    const a = this.m.inverse().transformPoint(new DOMPoint(0, 0));
    const b = this.m.inverse().transformPoint(new DOMPoint(dx, -dy));
    const x = b.x - a.x;
    const y = b.y - a.y;
    const d = Math.hypot(x, y) || 1;
    return [x / d, y / d];
  }

  private drawStatic() {
    const key = `${this.canvas.width}x${this.canvas.height}:${this.orient}:${this.theme}`;
    if (key === this.statKey) return;
    this.statKey = key;
    this.layout();
    const c = this.stat;
    c.width = this.canvas.width;
    c.height = this.canvas.height;
    const g = c.getContext('2d')!;
    const th = themeOf(this.theme);
    th.bg(g, c.width, c.height);
    g.setTransform(this.m);
    // тень стола
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.55)';
    g.shadowBlur = 40 * this.dpr;
    g.shadowOffsetY = 0;
    roundRect(g, -W / 2 - RAIL, -RAIL, W + RAIL * 2, L + RAIL * 2, CORNER + RAIL);
    g.fillStyle = th.rail[2];
    g.fill();
    g.restore();
    // борт: объёмная рамка
    const rg = g.createLinearGradient(-W / 2 - RAIL, 0, W / 2 + RAIL, 0);
    rg.addColorStop(0, th.rail[1]);
    rg.addColorStop(0.5, th.rail[0]);
    rg.addColorStop(1, th.rail[1]);
    roundRect(g, -W / 2 - RAIL, -RAIL, W + RAIL * 2, L + RAIL * 2, CORNER + RAIL);
    g.fillStyle = rg;
    g.fill();
    g.strokeStyle = th.railTrim;
    g.lineWidth = 0.012;
    roundRect(g, -W / 2 - RAIL * 0.5, -RAIL * 0.5, W + RAIL, L + RAIL, CORNER + RAIL * 0.5);
    g.stroke();
    // поле
    g.save();
    roundRect(g, -W / 2, 0, W, L, CORNER);
    g.clip();
    const sg = g.createRadialGradient(0, L / 2, 0.05, 0, L / 2, L * 0.7);
    sg.addColorStop(0, th.surf[0]);
    sg.addColorStop(1, th.surf[1]);
    g.fillStyle = sg;
    g.fillRect(-W / 2, 0, W, L);
    th.deco(g);
    // дырочки воздушной подушки
    g.fillStyle = th.holes;
    const step = 0.036;
    for (let y = step / 2; y < L; y += step)
      for (let x = -W / 2 + step / 2; x < W / 2; x += step) {
        g.beginPath();
        g.arc(x, y, 0.0035, 0, Math.PI * 2);
        g.fill();
      }
    // разметка: центральная линия и круг, «вратарские» полукруги, линии у ворот
    const glow = (col: string) => {
      g.strokeStyle = col;
      if (th.glow) {
        g.shadowColor = col;
        g.shadowBlur = 14 * this.dpr * th.glow;
      }
    };
    g.lineCap = 'round';
    glow(th.center);
    g.lineWidth = 0.014;
    g.beginPath();
    g.moveTo(-W / 2, L / 2);
    g.lineTo(W / 2, L / 2);
    g.stroke();
    g.beginPath();
    g.arc(0, L / 2, 0.15, 0, Math.PI * 2);
    g.stroke();
    glow(th.line);
    g.lineWidth = 0.01;
    for (const y of [0, L]) {
      g.beginPath();
      g.arc(0, y, 0.24, 0, Math.PI * 2);
      g.stroke();
    }
    for (const y of [L * 0.25, L * 0.75]) {
      g.setLineDash([0.04, 0.03]);
      g.beginPath();
      g.moveTo(-W / 2, y);
      g.lineTo(W / 2, y);
      g.stroke();
      g.setLineDash([]);
    }
    g.shadowBlur = 0;
    // внутренняя тень борта
    g.strokeStyle = 'rgba(0,0,0,0.28)';
    g.lineWidth = 0.03;
    roundRect(g, -W / 2, 0, W, L, CORNER);
    g.stroke();
    g.restore();
    // ворота: щели в торцах
    for (const y of [0, L]) {
      const dy = y === 0 ? -1 : 1;
      g.fillStyle = '#05060a';
      roundRect(g, -GOAL / 2, y === 0 ? -RAIL * 0.75 : L, GOAL, RAIL * 0.75, 0.012);
      g.fill();
      g.fillStyle = th.railTrim;
      for (const sx of [-1, 1]) {
        g.beginPath();
        g.arc((sx * GOAL) / 2, y, 0.012, 0, Math.PI * 2);
        g.fill();
      }
      void dy;
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
  }

  hit(x: number, y: number, power: number) {
    const th = themeOf(this.theme);
    const n = Math.min(18, 4 + Math.round(power * 3));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 0.3 + Math.random() * (0.4 + power * 0.25);
      this.sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0.35 + Math.random() * 0.25, c: th.spark[i % th.spark.length] });
    }
    if (power > 3) this.shake = Math.min(1, power / 8);
  }

  goal(seat: number) {
    this.flash = { seat, t: 1 };
    const y = seat === 0 ? L : 0;
    const th = themeOf(this.theme);
    for (let i = 0; i < 40; i++) {
      const a = (seat === 0 ? -1 : 1) * (Math.PI * 0.5) + (Math.random() - 0.5) * 2.2;
      const v = 0.5 + Math.random() * 1.4;
      this.sparks.push({ x: (Math.random() - 0.5) * GOAL, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0.6 + Math.random() * 0.5, c: th.spark[i % th.spark.length] });
    }
    this.shake = 0.8;
  }

  render(st: AhState, dt: number, seatColors: string[][]) {
    this.resize();
    this.drawStatic();
    const g = this.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    let ox = 0;
    let oy = 0;
    if (this.shake > 0) {
      ox = (Math.random() - 0.5) * this.shake * 10 * this.dpr;
      oy = (Math.random() - 0.5) * this.shake * 10 * this.dpr;
      this.shake = Math.max(0, this.shake - dt * 3);
    }
    g.drawImage(this.stat, ox, oy);
    g.setTransform(new DOMMatrix().translate(ox, oy).multiply(this.m));
    const th = themeOf(this.theme);
    // вспышка у ворот, куда забили
    if (this.flash) {
      const y = this.flash.seat === 0 ? L : 0;
      const gr = g.createRadialGradient(0, y, 0, 0, y, 0.6);
      const col = seatColors[this.flash.seat][0];
      gr.addColorStop(0, col + 'cc');
      gr.addColorStop(1, col + '00');
      g.globalAlpha = this.flash.t;
      g.fillStyle = gr;
      g.fillRect(-W / 2, y - 0.6, W, 1.2);
      g.globalAlpha = 1;
      this.flash.t -= dt * 0.9;
      if (this.flash.t <= 0) this.flash = null;
    }
    const p = st.puck;
    const onTable = p.y > -PUCK_R && p.y < L + PUCK_R;
    // след шайбы
    this.trail.push([p.x, p.y]);
    if (this.trail.length > 10) this.trail.shift();
    const sp = Math.hypot(p.vx, p.vy);
    if (onTable && sp > 1.2 && this.trail.length > 2) {
      g.lineCap = 'round';
      for (let i = 1; i < this.trail.length; i++) {
        const [x0, y0] = this.trail[i - 1];
        const [x1, y1] = this.trail[i];
        if (Math.hypot(x1 - x0, y1 - y0) > 0.3) continue;
        g.strokeStyle = th.glow || th.puckGlow !== 'rgba(0,0,0,0)' ? th.puckGlow : 'rgba(255,255,255,0.5)';
        g.globalAlpha = (i / this.trail.length) * Math.min(1, (sp - 1.2) / 3) * 0.6;
        g.lineWidth = PUCK_R * 2 * (i / this.trail.length);
        g.beginPath();
        g.moveTo(x0, y0);
        g.lineTo(x1, y1);
        g.stroke();
      }
      g.globalAlpha = 1;
    }
    // шайба
    if (onTable) {
      g.fillStyle = 'rgba(0,0,0,0.3)';
      g.beginPath();
      g.arc(p.x + 0.008, p.y - 0.01, PUCK_R, 0, Math.PI * 2);
      g.fill();
      if (th.puckGlow !== 'rgba(0,0,0,0)') {
        g.shadowColor = th.puckGlow;
        g.shadowBlur = 18 * this.dpr;
      }
      const pg = g.createRadialGradient(p.x - PUCK_R * 0.3, p.y + PUCK_R * 0.3, PUCK_R * 0.1, p.x, p.y, PUCK_R);
      pg.addColorStop(0, th.puck[0]);
      pg.addColorStop(1, th.puck[1]);
      g.fillStyle = pg;
      g.beginPath();
      g.arc(p.x, p.y, PUCK_R, 0, Math.PI * 2);
      g.fill();
      g.shadowBlur = 0;
      g.strokeStyle = 'rgba(255,255,255,0.35)';
      g.lineWidth = 0.004;
      g.beginPath();
      g.arc(p.x, p.y, PUCK_R * 0.62, 0, Math.PI * 2);
      g.stroke();
    }
    // биты
    for (const s of [0, 1]) {
      const m = st.mal[s];
      const [c, light, dark] = seatColors[s];
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.beginPath();
      g.arc(m.x + 0.012, m.y - 0.016, MAL_R * 1.02, 0, Math.PI * 2);
      g.fill();
      if (th.glow) {
        g.shadowColor = c;
        g.shadowBlur = 20 * this.dpr * th.glow;
      }
      const mg = g.createRadialGradient(m.x - MAL_R * 0.35, m.y + MAL_R * 0.35, MAL_R * 0.1, m.x, m.y, MAL_R);
      mg.addColorStop(0, light);
      mg.addColorStop(0.7, c);
      mg.addColorStop(1, dark);
      g.fillStyle = mg;
      g.beginPath();
      g.arc(m.x, m.y, MAL_R, 0, Math.PI * 2);
      g.fill();
      g.shadowBlur = 0;
      // ободок и ручка-грибок
      g.strokeStyle = 'rgba(255,255,255,0.35)';
      g.lineWidth = 0.004;
      g.beginPath();
      g.arc(m.x, m.y, MAL_R * 0.78, 0, Math.PI * 2);
      g.stroke();
      const hg = g.createRadialGradient(m.x - MAL_R * 0.15, m.y + MAL_R * 0.15, 0, m.x, m.y, MAL_R * 0.45);
      hg.addColorStop(0, '#ffffff');
      hg.addColorStop(0.35, light);
      hg.addColorStop(1, dark);
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.beginPath();
      g.arc(m.x + 0.006, m.y - 0.008, MAL_R * 0.44, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = hg;
      g.beginPath();
      g.arc(m.x, m.y, MAL_R * 0.42, 0, Math.PI * 2);
      g.fill();
    }
    // искры
    for (const k of this.sparks) {
      k.t -= dt;
      k.x += k.vx * dt;
      k.y += k.vy * dt;
      k.vx *= 0.92;
      k.vy *= 0.92;
      if (k.t <= 0) continue;
      g.globalAlpha = Math.min(1, k.t * 3);
      g.fillStyle = k.c;
      g.beginPath();
      g.arc(k.x, k.y, 0.006, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
    this.sparks = this.sparks.filter((k) => k.t > 0);
    g.setTransform(1, 0, 0, 1, 0, 0);
  }
}
