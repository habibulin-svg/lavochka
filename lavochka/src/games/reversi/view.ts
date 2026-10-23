/* Реверси — отрисовка (SVG). Советская доска «Электронмаш»: чёрный пластиковый корпус с рамкой, синий войлок с чёрными
 * линиями и четырьмя точками, по бокам — прозрачные трубки с фишками (сколько осталось у игрока). Вариант — зелёное сукно
 * в ореховой рамке. Фишки переворачиваются по очереди, точки — куда можно пойти. */
import { Sound } from '../../core/audio';
import { h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { woodTexture, WOODS } from '../../core/wood';
import { BLACK, count, isLegal, movesFor, colorOf, type Event, type State } from './engine';
import './reversi.css';

const NS = 'http://www.w3.org/2000/svg';
/** Рамка вокруг поля и место под трубку с каждой стороны (в клетках). */
const FRAME = 0.55;
const TUBE = 1.5;

let walnut = '';

class ReversiView implements GameView<State, Event> {
  private ctx!: ViewCtx;
  private svg!: SVGSVGElement;
  private score!: HTMLElement;
  private s: State | null = null;
  private actSeat: number | null = null;
  private hover = -1;
  /** Что анимировать при следующей отрисовке. */
  private fresh = -1;
  private flips: number[] = [];

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    const wrap = h(`<div class="rv-wrap"><svg class="rv-board" xmlns="${NS}"></svg></div>`);
    root.appendChild(wrap);
    this.svg = wrap.querySelector('svg') as SVGSVGElement;
    this.score = h(`<div class="rv-score"></div>`);
    ctx.controls.appendChild(this.score);
    if (!ctx.demo) ctx.controls.appendChild(h(`<div class="rv-hint">Ставьте фишку на клетку с точкой: чужие фишки между вашими переворачиваются.</div>`));
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

  private side(s: State) {
    return s.cfg.look === 'soviet' ? TUBE : 0;
  }

  private cellAt(e: MouseEvent): number {
    const s = this.s;
    if (!s) return -1;
    const ctm = this.svg.getScreenCTM();
    if (!ctm) return -1;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    const x = Math.floor(pt.x - FRAME - this.side(s));
    const y = Math.floor(pt.y - FRAME);
    return x >= 0 && y >= 0 && x < s.n && y < s.n ? y * s.n + x : -1;
  }

  private defs(): string {
    return `<defs>
      <radialGradient id="rv-b" cx="38%" cy="32%" r="70%"><stop offset="0" stop-color="#4a4a4e"/><stop offset="0.55" stop-color="#161618"/><stop offset="1" stop-color="#050505"/></radialGradient>
      <radialGradient id="rv-w" cx="38%" cy="32%" r="70%"><stop offset="0" stop-color="#ffffff"/><stop offset="0.6" stop-color="#eeebe2"/><stop offset="1" stop-color="#c9c4b6"/></radialGradient>
      <radialGradient id="rv-sh" cx="50%" cy="50%" r="50%"><stop offset="0.6" stop-color="#000" stop-opacity="0.5"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
      <linearGradient id="rv-body" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2c2c30"/><stop offset="1" stop-color="#121214"/></linearGradient>
      <linearGradient id="rv-tube" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0.32"/><stop offset="0.3" stop-color="#fff" stop-opacity="0.06"/><stop offset="0.75" stop-color="#fff" stop-opacity="0.02"/><stop offset="1" stop-color="#fff" stop-opacity="0.26"/></linearGradient>
      <filter id="rv-felt" x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="9" numOctaves="2" seed="3" result="n"/>
        <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0.05  0 0 0 0 0.12  0 0 0 0.9 -0.15" result="g"/>
        <feComposite in="g" in2="SourceGraphic" operator="in" result="t"/>
        <feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="t"/></feMerge>
      </filter>
      <filter id="rv-cloth" x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="7" numOctaves="2" seed="5" result="n"/>
        <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0.1  0 0 0 0 0.03  0 0 0 0.7 -0.12" result="g"/>
        <feComposite in="g" in2="SourceGraphic" operator="in" result="t"/>
        <feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="t"/></feMerge>
      </filter>
      ${walnut ? `<pattern id="rv-wood" patternUnits="userSpaceOnUse" width="6" height="6"><image href="${walnut}" width="6" height="6" preserveAspectRatio="none"/></pattern>` : ''}
    </defs>`;
  }

  /** Корпус, поле и сетка. */
  private boardSvg(s: State): string {
    const n = s.n;
    const side = this.side(s);
    const W = n + 2 * FRAME + 2 * side;
    const H = n + 2 * FRAME;
    const x0 = FRAME + side;
    const y0 = FRAME;
    let o = '';
    if (s.cfg.look === 'soviet') {
      o += `<rect x="0.04" y="0.04" width="${W - 0.08}" height="${H - 0.08}" rx="0.35" fill="url(#rv-body)" stroke="#000" stroke-width="0.04"/>`;
      o += `<rect x="0.1" y="0.08" width="${W - 0.2}" height="0.06" rx="0.03" fill="#fff" opacity="0.08"/>`;
      // рамка-багет вокруг войлока
      o += `<rect x="${x0 - 0.3}" y="${y0 - 0.3}" width="${n + 0.6}" height="${n + 0.6}" rx="0.06" fill="#0c0c0d" stroke="#3a3a3e" stroke-width="0.04"/>`;
      o += `<rect x="${x0 - 0.17}" y="${y0 - 0.17}" width="${n + 0.34}" height="${n + 0.34}" fill="none" stroke="#2a2a2d" stroke-width="0.05"/>`;
      o += `<rect x="${x0}" y="${y0}" width="${n}" height="${n}" fill="#1d5f9e" filter="url(#rv-felt)"/>`;
      // выдавленные кружки-эмблемы в свободных углах корпуса (как на коробке: слева внизу и справа вверху)
      for (const [ex, ey] of [
        [side / 2 + 0.03, H - 0.95],
        [W - side / 2 - 0.03, 0.95],
      ])
        o += `<circle cx="${ex}" cy="${ey}" r="0.5" fill="none" stroke="#38383c" stroke-width="0.05"/><circle cx="${ex}" cy="${ey}" r="0.4" fill="#18181a" stroke="#0a0a0a" stroke-width="0.03"/>
          <text x="${ex}" y="${ey + 0.08}" class="rv-emb" text-anchor="middle">РЕВЕРСИ</text>`;
    } else {
      o += `<rect x="0" y="0" width="${W}" height="${H}" rx="0.18" fill="${walnut ? 'url(#rv-wood)' : '#5a3218'}" stroke="#2a1608" stroke-width="0.05"/>`;
      o += `<rect x="${x0 - 0.06}" y="${y0 - 0.06}" width="${n + 0.12}" height="${n + 0.12}" fill="#1a0d04"/>`;
      o += `<rect x="${x0}" y="${y0}" width="${n}" height="${n}" fill="#1f7a43" filter="url(#rv-cloth)"/>`;
    }
    const line = s.cfg.look === 'soviet' ? '#06121f' : '#0b2e17';
    let grid = '';
    for (let i = 0; i <= n; i++) {
      grid += `M${x0 + i} ${y0}V${y0 + n}M${x0} ${y0 + i}H${x0 + n}`;
    }
    o += `<path d="${grid}" stroke="${line}" stroke-width="0.04" fill="none"/>`;
    for (const [dx, dy] of [
      [2, 2],
      [n - 2, 2],
      [2, n - 2],
      [n - 2, n - 2],
    ])
      o += `<circle cx="${x0 + dx}" cy="${y0 + dy}" r="0.07" fill="${line}"/>`;
    return o;
  }

  /** Трубка с фишками сбоку (советская коробка): фишки стоят на ребре — видны полоски. */
  private tubeSvg(s: State, seat: number): string {
    const n = s.n;
    const cap = (n * n) / 2;
    const left = Math.max(0, cap - s.placed[seat]);
    const x = seat === 0 ? 0.32 : n + 2 * FRAME + TUBE + 0.32;
    const w = TUBE - 0.64;
    // трубки короче поля: у чёрных — сверху, у белых — снизу, в углах остаются эмблемы
    const len = n - 1.3;
    const y = seat === 0 ? FRAME + 0.15 : FRAME + n - 0.15 - len;
    const step = (len - 0.2) / cap;
    let o = `<rect x="${x - 0.05}" y="${y - 0.05}" width="${w + 0.1}" height="${len + 0.1}" rx="${w / 2}" fill="#070708"/>`;
    for (let i = 0; i < left; i++) {
      const yy = y + len - 0.1 - (i + 1) * step;
      o += `<rect x="${x + 0.06}" y="${yy}" width="${w - 0.12}" height="${step * 0.92}" rx="0.02" fill="#efece4"/><rect x="${x + 0.06}" y="${yy + step * 0.3}" width="${w - 0.12}" height="${step * 0.34}" fill="#111"/>`;
    }
    o += `<rect x="${x}" y="${y}" width="${w}" height="${len}" rx="${w / 2}" fill="url(#rv-tube)" stroke="#d8dce0" stroke-opacity="0.45" stroke-width="0.03"/>`;
    o += `<rect x="${x - 0.08}" y="${y + len - 0.25}" width="${w + 0.16}" height="0.2" rx="0.05" fill="#2a2a2e" stroke="#000" stroke-width="0.02"/>`;
    return o;
  }

  private disc(s: State, p: number, cls = ''): string {
    const n = s.n;
    const cx = FRAME + this.side(s) + (p % n) + 0.5;
    const cy = FRAME + Math.floor(p / n) + 0.5;
    const black = s.board[p] === BLACK;
    const delay = cls === 'rv-flip' ? this.flips.indexOf(p) * 70 : 0;
    return `<g class="rv-disc ${cls}" style="transform-origin:${cx}px ${cy}px;animation-delay:${delay}ms">
      <circle cx="${cx + 0.05}" cy="${cy + 0.07}" r="0.44" fill="url(#rv-sh)"/>
      <circle cx="${cx}" cy="${cy}" r="0.4" fill="${black ? '#d8d4c8' : '#111'}"/>
      <circle cx="${cx}" cy="${cy - 0.03}" r="0.4" fill="url(#${black ? 'rv-b' : 'rv-w'})" stroke="${black ? '#000' : '#a9a496'}" stroke-width="0.02"/>
    </g>`;
  }

  private draw() {
    const s = this.s;
    if (!s) return;
    const n = s.n;
    const side = this.side(s);
    const W = n + 2 * FRAME + 2 * side;
    const H = n + 2 * FRAME;
    this.svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    this.svg.style.aspectRatio = `${W} / ${H}`;
    let o = this.defs() + this.boardSvg(s);
    if (side) o += this.tubeSvg(s, 0) + this.tubeSvg(s, 1);
    const x0 = FRAME + side;
    for (let p = 0; p < n * n; p++) {
      if (!s.board[p]) continue;
      o += this.disc(s, p, p === this.fresh ? 'rv-new' : this.flips.includes(p) ? 'rv-flip' : '');
    }
    if (s.last >= 0 && s.board[s.last]) {
      const cx = x0 + (s.last % n) + 0.5;
      const cy = FRAME + Math.floor(s.last / n) + 0.5;
      o += `<circle cx="${cx}" cy="${cy - 0.03}" r="0.09" class="rv-last ${s.board[s.last] === BLACK ? 'on-b' : 'on-w'}"/>`;
    }
    if (this.actSeat != null) {
      const c = colorOf(this.actSeat);
      for (const p of movesFor(s, c)) {
        const cx = x0 + (p % n) + 0.5;
        const cy = FRAME + Math.floor(p / n) + 0.5;
        if (p === this.hover) o += `<circle cx="${cx}" cy="${cy}" r="0.4" class="rv-ghost" fill="${c === BLACK ? '#111' : '#f4f1e8'}"/>`;
        else o += `<circle cx="${cx}" cy="${cy}" r="0.09" class="rv-dot"/>`;
      }
    }
    this.svg.innerHTML = o;
    this.fresh = -1;
    const [b, w] = count(s.board);
    this.score.innerHTML = `<span class="rv-cnt"><i class="rv-ico b"></i>${b}</span><span class="rv-sep">:</span><span class="rv-cnt"><i class="rv-ico w"></i>${w}</span>${s.cfg.anti ? '<small>анти — выигрывает меньший счёт</small>' : ''}`;
  }

  setView(v: State) {
    this.s = v;
    this.flips = [];
    if (!walnut && v.cfg.look === 'green') walnut = woodTexture(WOODS.walnut, 512, 11, false);
    this.draw();
  }

  async play(events: Event[], v: State) {
    for (const ev of events) {
      if (ev.type === 'play') {
        this.s = v;
        this.fresh = ev.p;
        this.flips = ev.flips;
        this.draw();
        Sound.place();
        const k = Math.min(ev.flips.length, 6);
        for (let i = 0; i < k; i++) setTimeout(() => Sound.step(), 120 + i * 70);
        await sleep((260 + ev.flips.length * 70) / this.ctx.speed());
      } else if (ev.type === 'pass') {
        Sound.nomove();
        await sleep(300 / this.ctx.speed());
      } else if (ev.type === 'end') Sound.win();
    }
    this.s = v;
    this.flips = [];
    this.draw();
  }

  setTurn(toAct: number[], interactive: number[]) {
    this.actSeat = this.s && !this.s.over && !this.ctx.demo ? (interactive.find((x) => toAct.includes(x)) ?? null) : null;
    this.draw();
  }

  status(v: State, toAct: number[], interactive: number[]) {
    if (v.over) {
      const [b, w] = count(v.board);
      return v.winner == null ? `Ничья, ${b}:${w}` : `Партия окончена, ${b}:${w}`;
    }
    return interactive.includes(toAct[0]) ? 'Ваш ход' : `Ходят ${this.ctx.name(toAct[0])}…`;
  }
}

export function createView(): GameView<State, Event> {
  return new ReversiView();
}
