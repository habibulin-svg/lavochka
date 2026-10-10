/* Точки — отрисовка: тетрадный лист, точки ручками разных цветов на пересечениях клеток,
 * окружения обведены по стенке и слегка закрашены. Ход — нажать на пересечение (под курсором — бледная точка). */
import { Sound } from '../../core/audio';
import { h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { free, type Area, type Event, type State } from './engine';
import { SEATS } from './def';
import './dots.css';

const NS = 'http://www.w3.org/2000/svg';
const M = 30;
const C = 28;

class DotsView implements GameView<State, Event> {
  private ctx!: ViewCtx;
  private svg!: SVGSVGElement;
  private gPaper!: SVGGElement;
  private gAreas!: SVGGElement;
  private gDots!: SVGGElement;
  private gHover!: SVGGElement;
  private gBanner!: SVGGElement;
  private btns!: HTMLElement;
  private s: State | null = null;
  private size = '';
  private actSeat: number | null = null;
  private hover: number | null = null;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    const wrap = h(`<div class="dt-wrap"><svg class="dt-board" xmlns="${NS}"><g class="dt-paper"></g><g class="dt-areas"></g><g class="dt-dots"></g><g class="dt-hover"></g><g class="dt-banner"></g></svg></div>`);
    root.appendChild(wrap);
    this.svg = wrap.querySelector('svg') as SVGSVGElement;
    this.gPaper = this.svg.querySelector('.dt-paper') as SVGGElement;
    this.gAreas = this.svg.querySelector('.dt-areas') as SVGGElement;
    this.gDots = this.svg.querySelector('.dt-dots') as SVGGElement;
    this.gHover = this.svg.querySelector('.dt-hover') as SVGGElement;
    this.gBanner = this.svg.querySelector('.dt-banner') as SVGGElement;
    const ctl = h(`<div class="dt-controls"><div class="dt-btns"></div>${ctx.demo ? '' : '<div class="hint small-hint">Ставьте точку на пересечение линий. Замкните стенку вокруг чужих точек.</div>'}</div>`);
    ctx.controls.appendChild(ctl);
    this.btns = ctl.querySelector('.dt-btns') as HTMLElement;
    this.svg.addEventListener('click', (e) => {
      const p = this.pointAt(e);
      if (p == null || this.actSeat == null || !this.s || this.s.phase !== 'play' || !free(this.s, p)) return;
      const seat = this.actSeat;
      Sound.unlock();
      this.clearTurn();
      this.ctx.act(seat, { type: 'dot', p });
    });
    this.svg.addEventListener('pointermove', (e) => {
      const p = this.actSeat != null ? this.pointAt(e) : null;
      const q = p != null && this.s && free(this.s, p) ? p : null;
      if (q !== this.hover) {
        this.hover = q;
        this.drawHover();
      }
    });
    this.svg.addEventListener('pointerleave', () => {
      this.hover = null;
      this.drawHover();
    });
  }

  private pointAt(e: MouseEvent): number | null {
    const st = this.s;
    if (!st) return null;
    const pt = this.svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const m = this.svg.getScreenCTM();
    if (!m) return null;
    const p = pt.matrixTransform(m.inverse());
    const x = Math.round((p.x - M) / C);
    const y = Math.round((p.y - M) / C);
    if (x < 0 || y < 0 || x >= st.w || y >= st.h) return null;
    // промахнулись мимо пересечения далеко — не ставим
    if (Math.hypot(p.x - (M + x * C), p.y - (M + y * C)) > C * 0.45) return null;
    return y * st.w + x;
  }

  private xy(p: number) {
    const w = this.s!.w;
    return { x: M + (p % w) * C, y: M + Math.floor(p / w) * C };
  }

  private buildPaper(st: State) {
    const W = M * 2 + (st.w - 1) * C;
    const H = M * 2 + (st.h - 1) * C;
    this.svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    this.svg.style.aspectRatio = `${W} / ${H}`;
    let s = `<rect width="${W}" height="${H}" fill="#f6f3e8" rx="4"/>`;
    // клетки тетради: линии по пересечениям и чуть дальше за край
    for (let x = -1; x <= st.w; x++) s += `<line x1="${M + x * C}" y1="0" x2="${M + x * C}" y2="${H}" class="dt-line"/>`;
    for (let y = -1; y <= st.h; y++) s += `<line x1="0" y1="${M + y * C}" x2="${W}" y2="${M + y * C}" class="dt-line"/>`;
    s += `<line x1="${M * 0.45}" y1="0" x2="${M * 0.45}" y2="${H}" stroke="#d9605a" stroke-width="2" opacity=".6"/>`;
    this.gPaper.innerHTML = s;
    this.size = `${st.w}x${st.h}`;
  }

  /** Заливка и обводка окружения: квадратики и треугольники сетки внутри стенки; обводка — их внешние рёбра. */
  private areaSvg(st: State, a: Area): string {
    const { w, h } = st;
    const inner = new Set(a.pts);
    const S = new Set(a.pts);
    for (const p of a.pts) {
      const x = p % w;
      const y = (p - x) / w;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const X = x + dx;
          const Y = y + dy;
          if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
          const q = Y * w + X;
          if (st.dots[q] === a.owner && !inner.has(q)) S.add(q);
        }
    }
    const edges = new Map<string, number>();
    const edge = (p: number, q: number) => {
      const k = p < q ? `${p}-${q}` : `${q}-${p}`;
      edges.set(k, (edges.get(k) ?? 0) + 1);
    };
    let fill = '';
    const poly = (ps: number[]) => {
      fill += `M${ps.map((p) => `${this.xy(p).x} ${this.xy(p).y}`).join('L')}Z`;
      for (let i = 0; i < ps.length; i++) edge(ps[i], ps[(i + 1) % ps.length]);
    };
    for (let y = 0; y < h - 1; y++)
      for (let x = 0; x < w - 1; x++) {
        const c = [y * w + x, y * w + x + 1, (y + 1) * w + x + 1, (y + 1) * w + x];
        const ins = c.filter((p) => S.has(p));
        if (!c.some((p) => inner.has(p))) continue;
        if (ins.length === 4) poly(c);
        else if (ins.length === 3) poly(ins);
      }
    let line = '';
    for (const [k, n] of edges) {
      if (n !== 1) continue;
      const [p, q] = k.split('-').map(Number);
      // рёбра между двумя внутренними точками — не стенка
      if (inner.has(p) && inner.has(q)) continue;
      const A = this.xy(p);
      const B = this.xy(q);
      line += `M${A.x} ${A.y}L${B.x} ${B.y}`;
    }
    const col = SEATS[a.owner].color;
    return `<path d="${fill}" fill="${col}" opacity=".16"/><path d="${line}" stroke="${col}" stroke-width="2.4" stroke-linecap="round" fill="none"/>`;
  }

  private draw() {
    const st = this.s;
    if (!st) return;
    if (this.size !== `${st.w}x${st.h}`) this.buildPaper(st);
    this.gAreas.innerHTML = st.areas.map((a) => this.areaSvg(st, a)).join('');
    let d = '';
    for (let p = 0; p < st.dots.length; p++) {
      const c = st.dots[p];
      if (c === -1) continue;
      const { x, y } = this.xy(p);
      const col = SEATS[c].color;
      d += st.takenBy[p] !== -1 ? `<circle cx="${x}" cy="${y}" r="${C * 0.2}" fill="none" stroke="${col}" stroke-width="2" opacity=".55"/>` : `<circle cx="${x}" cy="${y}" r="${C * 0.22}" fill="${col}"/>`;
    }
    if (st.last >= 0) {
      const { x, y } = this.xy(st.last);
      d += `<circle cx="${x}" cy="${y}" r="${C * 0.38}" class="dt-last"/>`;
    }
    this.gDots.innerHTML = d;
    this.drawHover();
  }

  private drawHover() {
    if (this.hover == null || this.actSeat == null || !this.s) {
      this.gHover.innerHTML = '';
      return;
    }
    const { x, y } = this.xy(this.hover);
    this.gHover.innerHTML = `<circle cx="${x}" cy="${y}" r="${C * 0.22}" fill="${SEATS[this.actSeat].color}" opacity=".35"/>`;
  }

  private clearTurn() {
    this.actSeat = null;
    this.hover = null;
    this.btns.innerHTML = '';
    this.drawHover();
  }

  private button(text: string, primary: boolean, on: () => void) {
    const b = h<HTMLButtonElement>(`<button class="btn ${primary ? 'primary' : ''}">${text}</button>`);
    b.onclick = () => {
      Sound.unlock();
      on();
    };
    this.btns.appendChild(b);
  }

  private act(a: Parameters<ViewCtx['act']>[1]) {
    const seat = this.actSeat;
    if (seat == null) return;
    this.clearTurn();
    this.ctx.act(seat, a);
  }

  private renderButtons() {
    this.btns.innerHTML = '';
    const st = this.s;
    if (!st || this.actSeat == null || this.ctx.demo) return;
    if (st.phase === 'end') {
      this.btns.appendChild(h(`<div class="dt-ask">${this.ctx.name(st.endBy)} предлагает закончить и посчитать.</div>`));
      this.button('Согласен — считаем', true, () => this.act({ type: 'accept' }));
      this.button('Играем дальше', false, () => this.act({ type: 'decline' }));
      return;
    }
    if (st.moves >= 4) this.button('Закончить и посчитать', false, () => this.act({ type: 'finish' }));
  }

  setView(s: State) {
    this.s = s;
    this.gBanner.innerHTML = '';
    this.draw();
  }

  async play(events: Event[], s: State) {
    const speed = this.ctx.speed();
    this.clearTurn();
    for (const ev of events) {
      if (ev.type === 'dot') {
        // точка появляется до окружения
        const prev = this.s ?? s;
        const dots = prev.dots.slice();
        dots[ev.p] = ev.seat;
        this.s = { ...prev, dots, last: ev.p };
        this.draw();
        Sound.step();
        await sleep(120 / speed);
      } else if (ev.type === 'capture') {
        this.s = s;
        this.draw();
        Sound.capture();
        await this.banner(`${this.plain(ev.seat)}: +${ev.count}`, 650 / speed);
      } else if (ev.type === 'end') {
        Sound.win();
        this.s = s;
        this.draw();
        await this.banner(ev.winners.length > 1 ? 'Ничья!' : `Победа: ${this.plain(ev.winners[0])}`, 0);
      } else Sound.ui();
    }
    this.s = s;
    this.draw();
  }

  private plain(seat: number) {
    return this.ctx.name(seat).replace(/<[^>]+>/g, '');
  }

  private async banner(text: string, ms: number) {
    const st = this.s!;
    const W = M * 2 + (st.w - 1) * C;
    const H = M * 2 + (st.h - 1) * C;
    this.gBanner.innerHTML = `<g class="dt-bannerbox"><rect x="${W / 2 - 170}" y="${H / 2 - 32}" width="340" height="64" rx="6"/><text x="${W / 2}" y="${H / 2 + 2}">${text}</text></g>`;
    if (!ms) return;
    await sleep(ms);
    this.gBanner.innerHTML = '';
  }

  setTurn(toAct: number[], interactive: number[]) {
    this.clearTurn();
    const st = this.s;
    if (!st || st.phase === 'over' || this.ctx.demo) return;
    this.actSeat = interactive.find((x) => toAct.includes(x)) ?? null;
    this.renderButtons();
  }

  status(st: State, toAct: number[], interactive: number[]) {
    const name = (p: number) => this.ctx.name(p);
    if (st.phase === 'over') return st.winners.length > 1 ? 'Ничья' : `Победа: ${name(st.winners[0])}`;
    if (st.phase === 'end') return interactive.length ? 'Закончить партию?' : 'Ждём согласия…';
    const who = toAct[0];
    return interactive.includes(who) ? `Ваш ход: ${name(who)}` : `Ходит ${name(who)}…`;
  }

  playerStats(st: State, seat: number) {
    return `<span title="Окружено точек">окружил: ${st.scores[seat]}</span>`;
  }
}

export function createView(): GameView<State, Event> {
  return new DotsView();
}
