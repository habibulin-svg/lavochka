/* Санторин — отрисовка в изометрии: остров с каменной плитой (public/santorini/island.webp, картинка 1024×768),
 * сетка 5×5 — по углам плиты на снимке; постройки и строители — спрайты «три четверти» (l1, l2, l3, l3d, w0, w1).
 * Рисуем от дальних клеток к ближним. Ход: коснуться своего строителя, потом подсвеченной клетки; потом — где строить. */
import { Sound } from '../../core/audio';
import { h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { legal, N, stepsFrom, type Action, type Event, type State } from './engine';
import './santorini.css';

const BASE = `${import.meta.env.BASE_URL}santorini/`;
const IMG_W = 1024;
const IMG_H = 768;
/** Углы верхней грани плиты на снимке: верх (клетка a5), справа (e5), низ (e1), слева (a1). */
const SLAB = { T: [518, 235], R: [770, 365], B: [513, 485], L: [255, 367] } as const;
/** Рамка вида: плита крупно, сверху — место для высоких башен. */
const VIEW = [238, 128, 550, 382];

/** Размеры спрайтов (360 px в ширину): высота / ширина. */
const SPRITE: Record<string, number> = { l1: 314 / 360, l2: 422 / 360, l3: 487 / 360, l3d: 463 / 360, w0: 685 / 360, w1: 719 / 360 };
/** Высота верха постройки над клеткой — в долях ширины клетки (подобрано по спрайтам). */
const ELEV = [0, 0.34, 0.71, 0.9];
const BLD_W = 0.92; // ширина постройки — доля ширины клетки
const WRK_H = 0.82; // рост строителя — доля ширины клетки

/** Точка плиты: u — вдоль a→e (столбцы), v — вдоль 5→1 (строки), обе от 0 до 1. */
function at(u: number, v: number): [number, number] {
  const { T, R, B, L } = SLAB;
  const x = T[0] * (1 - u) * (1 - v) + R[0] * u * (1 - v) + L[0] * (1 - u) * v + B[0] * u * v;
  const y = T[1] * (1 - u) * (1 - v) + R[1] * u * (1 - v) + L[1] * (1 - u) * v + B[1] * u * v;
  return [x, y];
}
/** Клетка c (строка r сверху = 5-я горизонталь): строки идут от T к L, столбцы — от T к R. */
const cellUV = (c: number): [number, number] => [(c % N) / N, Math.floor(c / N) / N];
function center(c: number): [number, number] {
  const [u, v] = cellUV(c);
  return at(u + 0.5 / N, v + 0.5 / N);
}
function diamond(c: number, lift: number, k = 1): string {
  const [u, v] = cellUV(c);
  const d = (1 - k) / 2 / N;
  return [at(u + d, v + d), at(u + 1 / N - d, v + d), at(u + 1 / N - d, v + 1 / N - d), at(u + d, v + 1 / N - d)]
    .map(([x, y]) => `${x.toFixed(1)},${(y - lift).toFixed(1)}`)
    .join(' ');
}
const CELL_W = (SLAB.R[0] - SLAB.L[0]) / N;
const CELL_H = (SLAB.B[1] - SLAB.T[1]) / N;

function building(hgt: number, dome: boolean, x: number, y: number): string {
  if (!hgt) return '';
  const name = dome ? 'l3d' : `l${hgt}`;
  const w = CELL_W * BLD_W;
  const hh = w * SPRITE[name];
  const bottom = y + CELL_H * 0.5 * BLD_W;
  // мягкая тень на плиту — вправо-вниз (свет слева сверху)
  const sh = `<ellipse cx="${(x + w * 0.12).toFixed(1)}" cy="${(y + CELL_H * 0.12).toFixed(1)}" rx="${(w * 0.55).toFixed(1)}" ry="${(CELL_H * 0.5).toFixed(1)}" class="sn-sh"/>`;
  return `${sh}<image href="${BASE}${name}.webp" x="${(x - w / 2).toFixed(1)}" y="${(bottom - hh).toFixed(1)}" width="${w.toFixed(1)}" height="${hh.toFixed(1)}" class="sn-b"/>`;
}

function worker(seat: number, x: number, y: number, lift: number, cls = ''): string {
  const name = `w${seat}`;
  const hh = CELL_W * WRK_H;
  const w = hh / SPRITE[name];
  const bottom = y - lift + CELL_W * 0.1;
  const r = CELL_W * 0.24;
  return `<g class="sn-w${cls}"><ellipse cx="${x.toFixed(1)}" cy="${(y - lift).toFixed(1)}" rx="${r.toFixed(1)}" ry="${(r * 0.5).toFixed(1)}" class="sn-ws"/>
    <image href="${BASE}${name}.webp" x="${(x - w / 2).toFixed(1)}" y="${(bottom - hh).toFixed(1)}" width="${w.toFixed(1)}" height="${hh.toFixed(1)}"/></g>`;
}

class SantoriniView implements GameView<State, Event> {
  private ctx!: ViewCtx;
  private svg!: SVGSVGElement;
  private info!: HTMLElement;
  private s: State | null = null;
  private act: number | null = null;
  private sel: number | null = null; // выбранный строитель (номер)

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    const wrap = h('<div class="sn-wrap"><svg class="sn-svg" preserveAspectRatio="xMidYMid meet"></svg></div>');
    root.appendChild(wrap);
    this.svg = wrap.querySelector('svg') as SVGSVGElement;
    this.fit();
    new ResizeObserver(() => this.fit()).observe(wrap);
    this.info = h('<div class="sn-info"></div>');
    if (!ctx.demo) ctx.controls.appendChild(this.info);
    this.svg.addEventListener('click', (e) => this.onClick(e));
  }

  /** Рамка вида: плита (VIEW) целиком, лишнее по ширине или высоте — остров и море вокруг. */
  private fit() {
    const r = this.svg.getBoundingClientRect();
    const ar = r.width > 0 && r.height > 0 ? r.width / r.height : VIEW[2] / VIEW[3];
    let [x, y, w, hh] = VIEW;
    if (w / hh < ar) {
      const nw = hh * ar;
      x -= (nw - w) / 2;
      w = nw;
    } else {
      const nh = w / ar;
      y -= (nh - hh) / 2;
      hh = nh;
    }
    this.svg.setAttribute('viewBox', `${x.toFixed(1)} ${y.toFixed(1)} ${w.toFixed(1)} ${hh.toFixed(1)}`);
  }

  private targets(): Map<number, Action> {
    const out = new Map<number, Action>();
    const s = this.s;
    if (!s || this.act == null) return out;
    for (const a of legal(s)) {
      if (a.type === 'place') out.set(a.at, a);
      else if (a.type === 'move' && a.w === this.sel) out.set(a.to, a);
      else if (a.type === 'build') out.set(a.at, a);
    }
    return out;
  }

  private draw() {
    const s = this.s;
    if (!s) return;
    const tg = this.targets();
    let o = `<image href="${BASE}island.webp" x="0" y="0" width="${IMG_W}" height="${IMG_H}" preserveAspectRatio="none"/>`;
    // сетка: швы плиты
    let grid = '';
    for (let k = 0; k <= N; k++) {
      const [x1, y1] = at(k / N, 0);
      const [x2, y2] = at(k / N, 1);
      const [x3, y3] = at(0, k / N);
      const [x4, y4] = at(1, k / N);
      grid += `M${x1.toFixed(1)} ${y1.toFixed(1)}L${x2.toFixed(1)} ${y2.toFixed(1)}M${x3.toFixed(1)} ${y3.toFixed(1)}L${x4.toFixed(1)} ${y4.toFixed(1)}`;
    }
    o += `<path d="${grid}" class="sn-grid"/><path d="${grid}" class="sn-grid2"/>`;
    // последний ход — на полу
    if (s.last?.from != null) o += `<polygon points="${diamond(s.last.from, 0, 0.86)}" class="sn-was"/>`;
    // от дальних к ближним: по сумме строки и столбца
    const order = Array.from({ length: N * N }, (_, c) => c).sort((a, b) => center(a)[1] - center(b)[1] || center(a)[0] - center(b)[0]);
    for (const c of order) {
      const [x, y] = center(c);
      const lift = ELEV[s.h[c]] * CELL_W;
      o += `<g data-c="${c}">`;
      o += `<polygon points="${diamond(c, 0)}" class="sn-hit"/>`;
      o += building(s.h[c], s.dome[c], x, y);
      if (s.last?.built === c) o += `<polygon points="${diamond(c, s.dome[c] ? ELEV[3] * CELL_W : lift, 0.7)}" class="sn-new"/>`;
      if (tg.has(c)) o += `<polygon points="${diamond(c, s.dome[c] ? 0 : lift, 0.82)}" class="sn-tgt${s.phase === 'build' ? ' build' : ''}"/>`;
      for (const seat of [0, 1]) {
        const w = s.workers[seat].indexOf(c);
        if (w < 0) continue;
        const mine = this.act === seat && s.phase === 'move';
        const cls = (mine ? ' can' : '') + (mine && this.sel === w ? ' sel' : '') + (s.phase === 'build' && seat === s.turn && s.active === w ? ' sel' : '');
        o += worker(seat, x, y, lift, cls);
      }
      o += '</g>';
    }
    this.svg.innerHTML = o;
    this.text();
  }

  private text() {
    const s = this.s!;
    if (this.act == null) {
      this.info.innerHTML = '';
      return;
    }
    let t: string;
    if (s.phase === 'place') t = `Поставьте ${s.workers[this.act][0] < 0 ? 'первого' : 'второго'} строителя на свободную клетку.`;
    else if (s.phase === 'build') t = 'Коснитесь подсвеченной клетки — где <b>построить</b> (на третьем ярусе — купол).';
    else if (this.sel == null) t = 'Коснитесь своего строителя — подсветятся клетки, куда он может шагнуть.';
    else t = 'Коснитесь подсвеченной клетки — куда шагнуть (вверх — не больше чем на ярус).';
    this.info.innerHTML = t;
  }

  private onClick(e: MouseEvent) {
    const s = this.s;
    if (!s || this.act == null) return;
    const el = (e.target as Element).closest('[data-c]');
    if (!el) return;
    const c = Number(el.getAttribute('data-c'));
    const a = this.targets().get(c);
    if (a) return this.send(a);
    if (s.phase === 'move') {
      const w = s.workers[this.act].indexOf(c);
      if (w >= 0 && stepsFrom(s, c).length) {
        this.sel = this.sel === w ? null : w;
        Sound.ui();
        this.draw();
        return;
      }
    }
    Sound.nomove();
  }

  private send(a: Action) {
    const seat = this.act;
    if (seat == null) return;
    Sound.unlock();
    this.act = null;
    this.sel = null;
    this.ctx.act(seat, a);
  }

  async play(events: Event[], v: State) {
    this.act = null;
    const prev = this.s;
    this.s = v;
    this.draw();
    for (const ev of events) {
      if (ev.type === 'place') Sound.place();
      else if (ev.type === 'move') {
        Sound.step();
        if (prev) await this.slide(ev.from, ev.to, prev);
      } else if (ev.type === 'build') {
        Sound.place();
        await this.rise(ev.at);
      } else if (ev.type === 'end') Sound.win();
    }
    await sleep(180 / this.ctx.speed());
  }

  /** Строитель переезжает: новая позиция нарисована, сдвигаем его от старой клетки (с подскоком). */
  private async slide(from: number, to: number, prev: State) {
    const g = this.svg.querySelector(`[data-c="${to}"] .sn-w`) as SVGGElement | null;
    if (!g) return;
    const [x0, y0] = center(from);
    const [x1, y1] = center(to);
    const dx = x0 - x1;
    const dy = y0 - ELEV[prev.h[from]] * CELL_W - (y1 - ELEV[this.s!.h[to]] * CELL_W);
    const ms = 380 / this.ctx.speed();
    g.style.transition = 'none';
    g.style.transform = `translate(${dx}px, ${dy}px)`;
    g.getBoundingClientRect();
    g.style.transition = `transform ${ms}ms cubic-bezier(.3,.7,.3,1)`;
    g.style.transform = 'translate(0px, 0px)';
    await sleep(ms);
  }

  /** Новый ярус опускается сверху. */
  private async rise(c: number) {
    const img = this.svg.querySelector(`[data-c="${c}"] .sn-b`) as SVGImageElement | null;
    if (!img) return;
    const ms = 320 / this.ctx.speed();
    img.style.transition = 'none';
    img.style.transform = 'translate(0px, -40px)';
    img.style.opacity = '0';
    img.getBoundingClientRect();
    img.style.transition = `transform ${ms}ms cubic-bezier(.5,0,.6,1.3), opacity ${ms * 0.6}ms`;
    img.style.transform = 'translate(0px, 0px)';
    img.style.opacity = '1';
    await sleep(ms);
  }

  setView(v: State) {
    this.s = v;
    this.draw();
  }

  setTurn(toAct: number[], interactive: number[]) {
    const s = this.s;
    this.sel = null;
    this.act = s && !s.over && !this.ctx.demo ? (interactive.find((x) => toAct.includes(x)) ?? null) : null;
    // один строитель может ходить — выбираем его сразу
    if (s && this.act != null && s.phase === 'move') {
      const ws = s.workers[this.act].map((c, w) => (stepsFrom(s, c).length ? w : -1)).filter((w) => w >= 0);
      if (ws.length === 1) this.sel = ws[0];
    }
    this.draw();
  }

  status(v: State, toAct: number[], interactive: number[]) {
    if (v.over) return `Победа: ${this.ctx.name(v.winner!)}${v.how === 'climb' ? ' — на третьем ярусе!' : ' — соперник заперт'}`;
    if (!interactive.includes(toAct[0])) return `Ходят ${this.ctx.name(toAct[0])}…`;
    return v.phase === 'build' ? 'Стройте' : v.phase === 'place' ? 'Расставьте строителей' : 'Ваш ход';
  }
}

export function createView(): GameView<State, Event> {
  return new SantoriniView();
}
