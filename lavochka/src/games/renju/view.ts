/* Рэндзю — отрисовка: деревянная доска 15×15 (SVG), камни, метка последнего хода, выигрышная пятёрка, на ходу чёрных —
 * красные крестики на запрещённых пунктах (фолы) рядом с камнями. */
import { Sound } from '../../core/audio';
import { h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { BLACK, foul, isLegal, type Event, type State } from './engine';
import { ghostSvg, gobanAspect, gobanBoard, gobanBox, gobanDefs, lastMark, pointAt, preloadGoban, stoneSvg } from '../go/goban';
import './renju.css';

const NS = 'http://www.w3.org/2000/svg';
/** В рэндзю буквы идут подряд, с I. */
const COLS = 'ABCDEFGHIJKLMNOPQRS';

class RenjuView implements GameView<State, Event> {
  private ctx!: ViewCtx;
  private svg!: SVGSVGElement;
  private s: State | null = null;
  private actSeat: number | null = null;
  private hover = -1;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    preloadGoban();
    const wrap = h(`<div class="rj-wrap"><svg class="rj-board" xmlns="${NS}"></svg></div>`);
    root.appendChild(wrap);
    this.svg = wrap.querySelector('svg') as SVGSVGElement;
    ctx.controls.appendChild(h(`<div class="rj-hint">${ctx.demo ? '' : 'Поставьте камень на пересечение. Пять в ряд — победа.'}</div>`));
    this.svg.addEventListener('click', (e) => {
      const p = this.pointAt(e);
      const s = this.s;
      if (p < 0 || !s || this.actSeat == null || !isLegal(s, p)) return;
      e.preventDefault();
      const seat = this.actSeat;
      this.actSeat = null;
      Sound.unlock();
      this.ctx.act(seat, { type: 'play', p });
    });
    this.svg.addEventListener('mousemove', (e) => {
      const p = this.pointAt(e);
      if (p !== this.hover) {
        this.hover = p;
        this.draw();
      }
    });
  }

  private pointAt(e: MouseEvent): number {
    return this.s ? pointAt(this.svg, this.s.n, e) : -1;
  }

  private draw() {
    const s = this.s;
    if (!s) return;
    const n = s.n;
    const L = (i: number) => i + 1;
    this.svg.setAttribute('viewBox', gobanBox(n));
    this.svg.style.aspectRatio = gobanAspect(n);
    const c = (n - 1) / 2;
    const stars = [
      [c, c],
      [3, 3],
      [n - 4, 3],
      [3, n - 4],
      [n - 4, n - 4],
    ].map(([x, y]) => y * n + x);
    let o = gobanDefs() + gobanBoard(n, stars, COLS);
    const win = new Set(s.line);
    for (let p = 0; p < n * n; p++) {
      const v = s.board[p];
      if (!v) continue;
      o += stoneSvg(p, n, v === BLACK);
      if (win.has(p)) o += `<circle cx="${L(p % n)}" cy="${L(Math.floor(p / n))}" r="0.2" class="rj-win"/>`;
      else if (p === s.last) o += lastMark(p, n, v === BLACK);
    }
    // фолы чёрных — только на ходу человека-чёрных, рядом с камнями
    if (this.actSeat === 0 && s.cfg.variant === 'renju' && s.moves) {
      const b = s.board.slice();
      for (let p = 0; p < n * n; p++) {
        if (b[p]) continue;
        const x = p % n;
        const y = (p - x) / n;
        let near = false;
        for (let dy = -2; dy <= 2 && !near; dy++)
          for (let dx = -2; dx <= 2 && !near; dx++) if (x + dx >= 0 && x + dx < n && y + dy >= 0 && y + dy < n && b[(y + dy) * n + (x + dx)]) near = true;
        if (!near) continue;
        b[p] = BLACK;
        const f = foul(b, n, p);
        b[p] = 0;
        if (f) o += `<g class="rj-foul"><title>${f === 'overline' ? 'длинный ряд' : f === 'four-four' ? 'вилка 4×4' : 'вилка 3×3'}</title><path d="M${L(x) - 0.2} ${L(y) - 0.2}L${L(x) + 0.2} ${L(y) + 0.2}M${L(x) + 0.2} ${L(y) - 0.2}L${L(x) - 0.2} ${L(y) + 0.2}"/></g>`;
      }
    }
    if (this.actSeat != null && this.hover >= 0 && isLegal(s, this.hover)) o += ghostSvg(this.hover, n, this.actSeat === 0);
    this.svg.innerHTML = o;
  }

  setView(v: State) {
    this.s = v;
    this.draw();
  }

  async play(events: Event[], v: State) {
    for (const ev of events) {
      if (ev.type === 'play') Sound.place();
      else if (ev.type === 'end') Sound.win();
    }
    this.s = v;
    this.draw();
    await sleep(100 / this.ctx.speed());
  }

  setTurn(toAct: number[], interactive: number[]) {
    this.actSeat = this.s && !this.s.over && !this.ctx.demo ? (interactive.find((x) => toAct.includes(x)) ?? null) : null;
    this.draw();
  }

  status(v: State, toAct: number[], interactive: number[]) {
    if (v.over) return v.winner == null ? 'Ничья' : 'Партия окончена';
    return interactive.includes(toAct[0]) ? 'Ваш ход' : `Ходят ${this.ctx.name(toAct[0])}…`;
  }
}

export function createView(): GameView<State, Event> {
  return new RenjuView();
}
