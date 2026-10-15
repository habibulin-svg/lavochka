/* Рэндзю — отрисовка: деревянная доска 15×15 (SVG), камни, метка последнего хода, выигрышная пятёрка, на ходу чёрных —
 * красные крестики на запрещённых пунктах (фолы) рядом с камнями. */
import { Sound } from '../../core/audio';
import { h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { BLACK, foul, isLegal, type Event, type State } from './engine';
import './renju.css';

const NS = 'http://www.w3.org/2000/svg';
const COLS = 'ABCDEFGHJKLMNOPQRST';

class RenjuView implements GameView<State, Event> {
  private ctx!: ViewCtx;
  private svg!: SVGSVGElement;
  private s: State | null = null;
  private actSeat: number | null = null;
  private hover = -1;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
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
    const s = this.s;
    if (!s) return -1;
    const r = this.svg.getBoundingClientRect();
    const V = s.n + 1;
    const x = Math.round(((e.clientX - r.left) / r.width) * V - 1);
    const y = Math.round(((e.clientY - r.top) / r.height) * V - 1);
    return x >= 0 && y >= 0 && x < s.n && y < s.n ? y * s.n + x : -1;
  }

  private draw() {
    const s = this.s;
    if (!s) return;
    const n = s.n;
    const V = n + 1;
    const L = (i: number) => i + 1;
    this.svg.setAttribute('viewBox', `0 0 ${V} ${V}`);
    let o = `<defs>
      <radialGradient id="rj-b" cx="35%" cy="30%" r="70%"><stop offset="0" stop-color="#6a6a6a"/><stop offset="0.35" stop-color="#2a2a2a"/><stop offset="1" stop-color="#050505"/></radialGradient>
      <radialGradient id="rj-w" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="#ffffff"/><stop offset="0.6" stop-color="#ece8dc"/><stop offset="1" stop-color="#bdb8aa"/></radialGradient>
    </defs><rect width="${V}" height="${V}" class="rj-wood"/>`;
    for (let i = 0; i < n; i++) {
      o += `<line x1="1" y1="${L(i)}" x2="${n}" y2="${L(i)}" class="rj-line"/><line x1="${L(i)}" y1="1" x2="${L(i)}" y2="${n}" class="rj-line"/>`;
      o += `<text x="${L(i)}" y="${V - 0.25}" class="rj-lbl">${COLS[i]}</text><text x="0.35" y="${L(i) + 0.12}" class="rj-lbl">${n - i}</text>`;
    }
    const c = (n - 1) / 2;
    for (const [x, y] of [
      [c, c],
      [3, 3],
      [n - 4, 3],
      [3, n - 4],
      [n - 4, n - 4],
    ])
      o += `<circle cx="${L(x)}" cy="${L(y)}" r="0.1" class="rj-star"/>`;
    const win = new Set(s.line);
    for (let p = 0; p < n * n; p++) {
      const v = s.board[p];
      if (!v) continue;
      const x = L(p % n);
      const y = L(Math.floor(p / n));
      o += `<circle cx="${x + 0.04}" cy="${y + 0.06}" r="0.46" class="rj-shadow"/><circle cx="${x}" cy="${y}" r="0.46" fill="url(#rj-${v === BLACK ? 'b' : 'w'})"/>`;
      if (win.has(p)) o += `<circle cx="${x}" cy="${y}" r="0.2" class="rj-win"/>`;
      else if (p === s.last) o += `<circle cx="${x}" cy="${y}" r="0.16" class="rj-last ${v === BLACK ? 'on-b' : 'on-w'}"/>`;
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
    if (this.actSeat != null && this.hover >= 0 && isLegal(s, this.hover)) o += `<circle cx="${L(this.hover % n)}" cy="${L(Math.floor(this.hover / n))}" r="0.44" fill="url(#rj-${this.actSeat === 0 ? 'b' : 'w'})" class="rj-ghost"/>`;
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
