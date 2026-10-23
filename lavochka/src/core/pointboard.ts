/* Общая доска «точки и линии» для абстрактных игр (Баг-Чал, мельница, крест, тафл): SVG, выбор фишки и клетки,
 * подсветка ходов, перелёт фишки и исчезновение взятых. Сама доска и фишки рисуются игрой (строки SVG).
 *
 * Действие игры описывается «местом» (spot): from → to — переставить фишку, только to — поставить/снять/выбрать точку.
 * Действия без места (null) становятся кнопками в боковой панели («Хватит прыгать»). */
import { Sound } from './audio';
import { h } from './util';
import type { ViewCtx } from './view';
import './pointboard.css';

const NS = 'http://www.w3.org/2000/svg';

export interface Spot {
  from?: number;
  to: number;
}

export interface PieceAt {
  p: number;
  kind: string;
}

export interface PointBoardSpec<S, A> {
  /** Размер в единицах viewBox. */
  size(s: S): [number, number];
  /** Сколько точек на доске. */
  count(s: S): number;
  /** Координаты точки. */
  xy(s: S, p: number): [number, number];
  /** Доска (вместе с <defs>). */
  board(s: S): string;
  pieces(s: S): PieceAt[];
  /** Фишка с центром в (x, y); p — точка, на которой она стоит. */
  piece(s: S, kind: string, x: number, y: number, p: number): string;
  /** Допустимые действия места. */
  legal(s: S, seat: number): A[];
  spot(a: A): Spot | null;
  /** Подпись кнопки для действия без места. */
  label?(a: A): string;
  /** Радиус попадания по точке. */
  hit: number;
  /** Радиус подсветки. */
  ring?: number;
}

export interface Move {
  from: number;
  to: number;
  kind: string;
}

export class PointBoard<S, A> {
  readonly svg: SVGSVGElement;
  private s: S | null = null;
  private seat: number | null = null;
  private sel = -1;
  private hover = -1;
  private anim: Move | null = null;
  private gone: PieceAt[] = [];
  private fresh = -1;
  private last: number[] = [];
  private buttons: HTMLElement;
  /** Свои метки поверх доски (подсказки игры). */
  extra: (s: S) => string = () => '';

  constructor(
    root: HTMLElement,
    private ctx: ViewCtx,
    private spec: PointBoardSpec<S, A>,
    cls = ''
  ) {
    const wrap = h(`<div class="pb-wrap ${cls}"><svg class="pb-board" xmlns="${NS}"></svg></div>`);
    root.appendChild(wrap);
    this.svg = wrap.querySelector('svg') as SVGSVGElement;
    this.buttons = h(`<div class="pb-btns"></div>`);
    ctx.controls.appendChild(this.buttons);
    this.svg.addEventListener('click', (e) => this.click(e));
    this.svg.addEventListener('mousemove', (e) => {
      const p = this.pointAt(e);
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

  private pointAt(e: MouseEvent): number {
    const s = this.s;
    if (!s) return -1;
    const ctm = this.svg.getScreenCTM();
    if (!ctm) return -1;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    let best = -1;
    let bd = this.spec.hit * this.spec.hit;
    const n = this.spec.count(s);
    for (let p = 0; p < n; p++) {
      const [x, y] = this.spec.xy(s, p);
      const d = (x - pt.x) ** 2 + (y - pt.y) ** 2;
      if (d <= bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  private acts(): A[] {
    return this.s && this.seat != null ? this.spec.legal(this.s, this.seat) : [];
  }

  private click(e: MouseEvent) {
    const p = this.pointAt(e);
    if (p < 0 || this.seat == null) return;
    const acts = this.acts();
    const spots = acts.map((a) => this.spec.spot(a));
    let i = -1;
    if (this.sel >= 0) i = spots.findIndex((sp) => sp && sp.from === this.sel && sp.to === p);
    if (i < 0 && spots.some((sp) => sp && sp.from === p)) {
      this.sel = this.sel === p ? -1 : p;
      Sound.ui();
      this.draw();
      return;
    }
    if (i < 0) i = spots.findIndex((sp) => sp && sp.from == null && sp.to === p);
    if (i < 0) {
      if (this.sel >= 0) {
        this.sel = -1;
        this.draw();
      }
      return;
    }
    e.preventDefault();
    this.send(acts[i]);
  }

  private send(a: A) {
    const seat = this.seat;
    if (seat == null) return;
    this.seat = null;
    this.sel = -1;
    this.hover = -1;
    Sound.unlock();
    this.ctx.act(seat, a);
    this.draw();
  }

  set(s: S) {
    this.s = s;
    this.draw();
  }

  /** Кто ходит с этого экрана (null — никто). */
  turn(seat: number | null) {
    this.seat = seat;
    this.sel = -1;
    // единственная фишка, которой можно ходить, выбирается сама
    const from = new Set(
      this.acts()
        .map((a) => this.spec.spot(a))
        .filter((sp) => sp && sp.from != null)
        .map((sp) => sp!.from!)
    );
    const free = this.acts().some((a) => {
      const sp = this.spec.spot(a);
      return sp && sp.from == null;
    });
    if (from.size === 1 && !free) this.sel = [...from][0];
    this.draw();
  }

  /** Показать ход: перелёт фишки, исчезновение взятых. */
  show(s: S, move: Move | null, taken: PieceAt[] = [], placed = -1) {
    this.s = s;
    this.anim = move;
    this.gone = taken;
    this.fresh = placed;
    this.last = move ? [move.from, move.to] : placed >= 0 ? [placed] : this.last;
    this.draw();
    this.anim = null;
    this.gone = [];
    this.fresh = -1;
  }

  /** Отметить последний ход (после setView). */
  mark(points: number[]) {
    this.last = points;
  }

  draw() {
    const s = this.s;
    if (!s) return;
    const spec = this.spec;
    const [W, H] = spec.size(s);
    this.svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    this.svg.style.aspectRatio = `${W} / ${H}`;
    const R = spec.ring ?? spec.hit * 0.8;
    let o = spec.board(s);
    for (const p of this.last) {
      const [x, y] = spec.xy(s, p);
      o += `<circle cx="${x}" cy="${y}" r="${R * 1.05}" class="pb-last"/>`;
    }
    const acts = this.acts();
    const spots = acts.map((a) => spec.spot(a)).filter((x): x is Spot => !!x);
    const occupied = new Set(spec.pieces(s).map((q) => q.p));
    let moving = '';
    for (const q of spec.pieces(s)) {
      const [x, y] = spec.xy(s, q.p);
      let style = '';
      let cls = 'pb-piece';
      if (this.anim && q.p === this.anim.to) {
        const [fx, fy] = spec.xy(s, this.anim.from);
        style = `--dx:${fx - x}px;--dy:${fy - y}px`;
        cls += ' pb-move';
      } else if (q.p === this.fresh) cls += ' pb-new';
      if (q.p === this.sel) cls += ' pb-sel';
      const g = `<g class="${cls}" style="${style}">${spec.piece(s, q.kind, x, y, q.p)}</g>`;
      if (cls.includes('pb-move')) moving = g;
      else o += g;
    }
    for (const q of this.gone) {
      const [x, y] = spec.xy(s, q.p);
      o += `<g class="pb-piece pb-gone" style="transform-origin:${x}px ${y}px">${spec.piece(s, q.kind, x, y, q.p)}</g>`;
    }
    o += moving;
    // откуда можно ходить — пунктирное кольцо поверх фишки
    if (this.sel < 0)
      for (const p of new Set(spots.filter((sp) => sp.from != null).map((sp) => sp.from!))) {
        const [x, y] = spec.xy(s, p);
        o += `<circle cx="${x}" cy="${y}" r="${R}" class="pb-can"/>`;
      }
    // куда: из выбранной фишки — цели, иначе — точки для постановки/снятия
    const targets = this.sel >= 0 ? spots.filter((sp) => sp.from === this.sel).map((sp) => sp.to) : spots.filter((sp) => sp.from == null).map((sp) => sp.to);
    for (const p of new Set(targets)) {
      const [x, y] = spec.xy(s, p);
      if (occupied.has(p)) o += `<circle cx="${x}" cy="${y}" r="${R}" class="pb-take ${p === this.hover ? 'hov' : ''}"/>`;
      else o += `<circle cx="${x}" cy="${y}" r="${p === this.hover ? R * 0.55 : R * 0.3}" class="pb-dot"/>`;
    }
    o += this.extra(s);
    this.svg.innerHTML = o;
    // кнопки для действий без места
    const btns = acts.filter((a) => !spec.spot(a));
    this.buttons.innerHTML = '';
    for (const a of btns) {
      const b = h(`<button class="btn pb-btn">${spec.label ? spec.label(a) : '…'}</button>`);
      b.addEventListener('click', () => this.send(a));
      this.buttons.appendChild(b);
    }
  }
}
