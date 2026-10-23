/* Гекс — отрисовка (SVG), по советской пластиковой доске: тёмно-коричневый поднос, серый ромб из шестиугольных лунок,
 * по углам — круглые гнёзда с запасом шестиугольных фишек. Ромб стоит «на острие», как в коробке; стороны игроков отмечены
 * полосами их цвета. Кнопка «Обмен» — в боковой панели. */
import { Sound } from '../../core/audio';
import { h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { BLACK, canSwap, isLegal, type Event, type State } from './engine';
import './hex.css';

const NS = 'http://www.w3.org/2000/svg';
const S3 = Math.sqrt(3);
const COS = 0.5;
const SIN = S3 / 2;
/** Поворот на 60°: длинная диагональ ромба — вертикально. */
const rot = (x: number, y: number): [number, number] => [x * COS - y * SIN, x * SIN + y * COS];

interface Geo {
  n: number;
  c: [number, number][];
  W: number;
  H: number;
}

const geos = new Map<number, Geo>();
function geo(n: number): Geo {
  let g = geos.get(n);
  if (g) return g;
  const raw: [number, number][] = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) raw.push(rot((x + y / 2) * S3, y * 1.5));
  const xs = raw.map((p) => p[0]);
  const ys = raw.map((p) => p[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const M = 3.4;
  g = { n, c: raw.map(([x, y]) => [x - minX + M, y - minY + M]), W: Math.max(...xs) - minX + 2 * M, H: Math.max(...ys) - minY + 2 * M };
  geos.set(n, g);
  return g;
}

/** Шестиугольник «на острие» радиуса r. */
function hexPts(cx: number, cy: number, r: number): string {
  let o = '';
  for (let k = 0; k < 6; k++) {
    const a = ((-90 + 60 * k) * Math.PI) / 180;
    o += `${(cx + r * Math.cos(a)).toFixed(3)},${(cy + r * Math.sin(a)).toFixed(3)} `;
  }
  return o;
}

function tile(cx: number, cy: number, black: boolean, r = 0.86, cls = ''): string {
  return `<g class="hx-tile ${cls}" style="transform-origin:${cx}px ${cy}px">
    <polygon points="${hexPts(cx + 0.06, cy + 0.1, r)}" fill="#000" opacity="0.35"/>
    <polygon points="${hexPts(cx, cy, r)}" fill="${black ? '#0d0d0d' : '#cfcac0'}"/>
    <polygon points="${hexPts(cx, cy - 0.05, r * 0.9)}" fill="url(#${black ? 'hx-b' : 'hx-w'})"/>
  </g>`;
}

class HexView implements GameView<State, Event> {
  private ctx!: ViewCtx;
  private svg!: SVGSVGElement;
  private swapBtn!: HTMLButtonElement;
  private s: State | null = null;
  private actSeat: number | null = null;
  private hover = -1;
  private fresh = -1;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    const wrap = h(`<div class="hx-wrap"><svg class="hx-board" xmlns="${NS}"></svg></div>`);
    root.appendChild(wrap);
    this.svg = wrap.querySelector('svg') as SVGSVGElement;
    if (!ctx.demo) ctx.controls.appendChild(h(`<div class="hx-hint">Чёрные соединяют стороны, отмеченные чёрным, белые — белым. Ставьте камень на любую пустую клетку.</div>`));
    this.swapBtn = h<HTMLButtonElement>(`<button class="btn hx-swap" hidden>⇄ Обмен — забрать ход себе</button>`);
    ctx.controls.appendChild(this.swapBtn);
    this.swapBtn.addEventListener('click', () => {
      if (this.actSeat == null || !this.s || !canSwap(this.s)) return;
      const seat = this.actSeat;
      this.actSeat = null;
      Sound.unlock();
      this.ctx.act(seat, { type: 'swap' });
    });
    this.svg.addEventListener('click', (e) => {
      const p = this.cellAt(e);
      const s = this.s;
      if (p < 0 || !s || this.actSeat == null || !isLegal(s, p)) return;
      e.preventDefault();
      const seat = this.actSeat;
      this.actSeat = null;
      this.hover = -1;
      Sound.unlock();
      this.ctx.act(seat, { type: 'play', p });
    });
    this.svg.addEventListener('mousemove', (e) => {
      const p = this.cellAt(e);
      if (p !== this.hover) {
        this.hover = p;
        this.draw();
      }
    });
    this.svg.addEventListener('mouseleave', () => {
      this.hover = -1;
      this.draw();
    });
  }

  private cellAt(e: MouseEvent): number {
    const s = this.s;
    const ctm = this.svg.getScreenCTM();
    if (!s || !ctm) return -1;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    const g = geo(s.n);
    let best = -1;
    let bd = 0.95 * 0.95;
    g.c.forEach(([x, y], p) => {
      const d = (x - pt.x) ** 2 + (y - pt.y) ** 2;
      if (d < bd) {
        bd = d;
        best = p;
      }
    });
    return best;
  }

  private defs(): string {
    return `<defs>
      <linearGradient id="hx-tray" x1="0" y1="0" x2="0.3" y2="1"><stop offset="0" stop-color="#3a2d27"/><stop offset="1" stop-color="#1e1612"/></linearGradient>
      <linearGradient id="hx-plate" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="#cfcfc9"/><stop offset="1" stop-color="#a9a9a2"/></linearGradient>
      <linearGradient id="hx-cell" x1="0" y1="0" x2="0.3" y2="1"><stop offset="0" stop-color="#dcdcd6"/><stop offset="1" stop-color="#c4c4bd"/></linearGradient>
      <linearGradient id="hx-b" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="#3c3c3e"/><stop offset="0.5" stop-color="#1a1a1b"/><stop offset="1" stop-color="#0a0a0a"/></linearGradient>
      <linearGradient id="hx-w" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="0.6" stop-color="#f1efe8"/><stop offset="1" stop-color="#dcd8cd"/></linearGradient>
      <radialGradient id="hx-well" cx="50%" cy="45%" r="55%"><stop offset="0.7" stop-color="#0e0a08"/><stop offset="1" stop-color="#2b211c"/></radialGradient>
    </defs>`;
  }

  /** Гнездо с запасом фишек в углу подноса. */
  private well(cx: number, cy: number, R: number, count: number, black: boolean | null): string {
    let o = `<circle cx="${cx}" cy="${cy}" r="${R + 0.15}" fill="#4a3a32" opacity="0.6"/><circle cx="${cx}" cy="${cy}" r="${R}" fill="url(#hx-well)" stroke="#120d0a" stroke-width="0.1"/>`;
    if (black == null) return o;
    // фишки лежат кучкой: по спирали от центра, верхние — поверх
    for (let i = 0; i < count; i++) {
      const a = i * 2.4;
      const d = Math.sqrt(i / Math.max(1, count)) * (R - 0.9);
      o += tile(cx + Math.cos(a) * d, cy + Math.sin(a) * d, black, 0.62);
    }
    return o;
  }

  private draw() {
    const s = this.s;
    if (!s) return;
    const n = s.n;
    const g = geo(n);
    this.svg.setAttribute('viewBox', `0 0 ${g.W} ${g.H}`);
    this.svg.style.aspectRatio = `${g.W} / ${g.H}`;
    let o = this.defs();
    o += `<rect x="0.1" y="0.1" width="${g.W - 0.2}" height="${g.H - 0.2}" rx="1.6" fill="url(#hx-tray)" stroke="#0c0806" stroke-width="0.15"/>`;
    // гнёзда: запас белых слева вверху, чёрных — справа внизу
    const R = Math.min(g.W, g.H) * 0.17;
    let bl = 0;
    let wh = 0;
    for (const v of s.board) {
      if (v === BLACK) bl++;
      else if (v) wh++;
    }
    const spare = Math.ceil((n * n) / 2);
    const show = (k: number) => Math.round((Math.max(0, spare - k) / spare) * 22);
    o += this.well(R + 0.9, R + 0.9, R, show(wh), false);
    o += this.well(g.W - R - 0.9, R + 0.9, R, 0, null);
    o += this.well(R + 0.9, g.H - R - 0.9, R, 0, null);
    o += this.well(g.W - R - 0.9, g.H - R - 0.9, R, show(bl), true);
    // ромб-основа
    const top = g.c[0];
    const bot = g.c[n * n - 1];
    const right = g.c[n - 1];
    const left = g.c[(n - 1) * n];
    // поле отступает от центров крайних клеток на d: в острых углах (60°) это 2d по биссектрисе, в тупых — d/sin 60°
    const d = 1.45;
    const ac = 2 * d;
    const ob = d / SIN;
    o += `<polygon points="${top[0]},${top[1] - ac} ${right[0] + ob},${right[1]} ${bot[0]},${bot[1] + ac} ${left[0] - ob},${left[1]}" fill="url(#hx-plate)" stroke="#8d8d86" stroke-width="0.08" stroke-linejoin="round"/>`;
    // стороны игроков: верх-право и низ-лево — чёрные (ряды), верх-лево и низ-право — белые (столбцы)
    const edge = (a: [number, number], b: [number, number], nx: number, ny: number, col: string) =>
      `<line x1="${a[0] + nx}" y1="${a[1] + ny}" x2="${b[0] + nx}" y2="${b[1] + ny}" stroke="${col}" stroke-width="0.32" stroke-linecap="round"/>`;
    const k = 1.08;
    o += edge(top, right, SIN * k, -COS * k, '#111');
    o += edge(left, bot, -SIN * k, COS * k, '#111');
    o += edge(top, left, -SIN * k, -COS * k, '#f4f2ec');
    o += edge(right, bot, SIN * k, COS * k, '#f4f2ec');
    const win = new Set(s.path);
    for (let p = 0; p < n * n; p++) {
      const [cx, cy] = g.c[p];
      o += `<polygon points="${hexPts(cx, cy, 0.97)}" fill="#9d9d96"/><polygon points="${hexPts(cx, cy, 0.86)}" fill="url(#hx-cell)"/>`;
      const v = s.board[p];
      if (v) o += tile(cx, cy, v === BLACK, 0.86, p === this.fresh ? 'hx-new' : '');
      if (win.has(p)) o += `<circle cx="${cx}" cy="${cy}" r="0.2" class="hx-win"/>`;
      else if (p === s.last && v) o += `<circle cx="${cx}" cy="${cy - 0.04}" r="0.17" class="hx-last"/>`;
    }
    if (this.actSeat != null && this.hover >= 0 && isLegal(s, this.hover)) {
      const [cx, cy] = g.c[this.hover];
      o += `<g class="hx-ghost">${tile(cx, cy, this.actSeat === 0)}</g>`;
    }
    this.svg.innerHTML = o;
    this.fresh = -1;
    this.swapBtn.hidden = !(this.actSeat === 1 && canSwap(s));
  }

  setView(v: State) {
    this.s = v;
    this.draw();
  }

  async play(events: Event[], v: State) {
    for (const ev of events) {
      if (ev.type === 'play') {
        this.fresh = ev.p;
        Sound.place();
      } else if (ev.type === 'swap') {
        this.fresh = ev.to;
        Sound.turn();
      } else if (ev.type === 'end') Sound.win();
    }
    this.s = v;
    this.draw();
    await sleep(120 / this.ctx.speed());
  }

  setTurn(toAct: number[], interactive: number[]) {
    this.actSeat = this.s && !this.s.over && !this.ctx.demo ? (interactive.find((x) => toAct.includes(x)) ?? null) : null;
    this.draw();
  }

  status(v: State, toAct: number[], interactive: number[]) {
    if (v.over) return 'Партия окончена';
    return interactive.includes(toAct[0]) ? 'Ваш ход' : `Ходят ${this.ctx.name(toAct[0])}…`;
  }
}

export function createView(): GameView<State, Event> {
  return new HexView();
}
