/* Го — отрисовка: деревянный гобан (SVG), линии и звёзды, камни с бликом, метка последнего хода, подсказка-тень под курсором.
 * После конца партии — территория квадратиками, мёртвые камни полупрозрачные, счёт. Панель: пас, сдаться, пленные. */
import { Sound } from '../../core/audio';
import { h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { BLACK, hoshi, isLegal, WHITE, type Event, type State } from './engine';
import './go.css';

const NS = 'http://www.w3.org/2000/svg';
const COLS = 'ABCDEFGHJKLMNOPQRST';

class GoView implements GameView<State, Event> {
  private ctx!: ViewCtx;
  private svg!: SVGSVGElement;
  private panel!: HTMLElement;
  private s: State | null = null;
  private actSeat: number | null = null;
  private hover = -1;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    const wrap = h(`<div class="go-wrap"><svg class="go-board" xmlns="${NS}"></svg></div>`);
    root.appendChild(wrap);
    this.svg = wrap.querySelector('svg') as SVGSVGElement;
    this.panel = h('<div class="go-panel"></div>');
    ctx.controls.appendChild(this.panel);
    this.svg.addEventListener('click', (e) => {
      const p = this.pointAt(e);
      const s = this.s;
      if (p < 0 || !s || this.actSeat == null || !isLegal(s, p)) return;
      e.preventDefault();
      this.send({ type: 'play', p });
    });
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
    this.panel.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('[data-do]') as HTMLElement | null;
      if (!b) return;
      if (b.dataset.do === 'pass') this.send({ type: 'pass' });
      if (b.dataset.do === 'resign' && confirm('Сдаться?')) this.send({ type: 'resign' });
    });
  }

  private pointAt(e: MouseEvent): number {
    const s = this.s;
    if (!s) return -1;
    const r = this.svg.getBoundingClientRect();
    const n = s.n;
    const size = n + 1;
    const x = Math.round(((e.clientX - r.left) / r.width) * size - 1);
    const y = Math.round(((e.clientY - r.top) / r.height) * size - 1);
    return x >= 0 && y >= 0 && x < n && y < n ? y * n + x : -1;
  }

  private send(a: unknown) {
    const seat = this.actSeat;
    if (seat == null) return;
    Sound.unlock();
    this.actSeat = null;
    this.drawPanel();
    this.ctx.act(seat, a);
  }

  private draw() {
    const s = this.s;
    if (!s) return;
    const n = s.n;
    const V = n + 1;
    this.svg.setAttribute('viewBox', `0 0 ${V} ${V}`);
    const L = (i: number) => i + 1;
    let o = `<defs>
      <radialGradient id="go-b" cx="35%" cy="30%" r="70%"><stop offset="0" stop-color="#6a6a6a"/><stop offset="0.35" stop-color="#2a2a2a"/><stop offset="1" stop-color="#050505"/></radialGradient>
      <radialGradient id="go-w" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="#ffffff"/><stop offset="0.6" stop-color="#ece8dc"/><stop offset="1" stop-color="#bdb8aa"/></radialGradient>
    </defs><rect x="0" y="0" width="${V}" height="${V}" class="go-wood"/>`;
    const sw = n === 19 ? 0.045 : 0.05;
    for (let i = 0; i < n; i++) {
      o += `<line x1="${L(0)}" y1="${L(i)}" x2="${L(n - 1)}" y2="${L(i)}" stroke-width="${sw}" class="go-line"/>`;
      o += `<line x1="${L(i)}" y1="${L(0)}" x2="${L(i)}" y2="${L(n - 1)}" stroke-width="${sw}" class="go-line"/>`;
      o += `<text x="${L(i)}" y="${V - 0.25}" class="go-lbl">${COLS[i]}</text><text x="0.35" y="${L(i) + 0.12}" class="go-lbl">${n - i}</text>`;
    }
    for (const p of hoshi(n)) o += `<circle cx="${L(p % n)}" cy="${L(Math.floor(p / n))}" r="${n === 19 ? 0.12 : 0.1}" class="go-star"/>`;
    const dead = new Set(s.final?.dead ?? []);
    for (let p = 0; p < n * n; p++) {
      const c = s.board[p];
      if (!c) continue;
      const x = L(p % n);
      const y = L(Math.floor(p / n));
      o += `<circle cx="${x + 0.04}" cy="${y + 0.06}" r="0.47" class="go-shadow"/>`;
      o += `<circle cx="${x}" cy="${y}" r="0.47" fill="url(#go-${c === BLACK ? 'b' : 'w'})" class="go-stone${dead.has(p) ? ' dead' : ''}"/>`;
      if (p === s.last && !s.over) o += `<circle cx="${x}" cy="${y}" r="0.18" class="go-last ${c === BLACK ? 'on-b' : 'on-w'}"/>`;
    }
    // территория после конца партии
    if (s.final && !s.final.resign) {
      for (let p = 0; p < n * n; p++) {
        const ow = s.final.owner[p];
        if (!ow || (s.board[p] && !dead.has(p))) continue;
        const x = L(p % n);
        const y = L(Math.floor(p / n));
        o += `<rect x="${x - 0.17}" y="${y - 0.17}" width="0.34" height="0.34" class="go-terr ${ow === BLACK ? 'b' : 'w'}"/>`;
      }
    }
    // тень будущего хода
    if (this.actSeat != null && this.hover >= 0 && isLegal(s, this.hover)) {
      const c = this.actSeat === 0 ? BLACK : WHITE;
      o += `<circle cx="${L(this.hover % n)}" cy="${L(Math.floor(this.hover / n))}" r="0.45" fill="url(#go-${c === BLACK ? 'b' : 'w'})" class="go-ghost"/>`;
    }
    this.svg.innerHTML = o;
    this.drawPanel();
  }

  private drawPanel() {
    const s = this.s;
    if (!s) return;
    let t = `<div class="go-caps">Пленные: ● ${s.caps[0]} · ○ ${s.caps[1]} · коми ${String(s.komi).replace('.', ',')}</div>`;
    if (s.final) t += `<div class="go-score">${s.final.resign != null ? `${s.final.resign === 0 ? 'Чёрные' : 'Белые'} сдались` : `Чёрные ${String(s.final.score[0]).replace('.', ',')} — белые ${String(s.final.score[1]).replace('.', ',')}`}</div>`;
    else if (this.actSeat != null && !this.ctx.demo) {
      t += `<div class="go-ask">${s.passes ? 'Соперник спасовал: пас — и партия окончена.' : 'Ваш ход: поставьте камень.'}</div><div class="go-row"><button class="btn" data-do="pass">Пас</button><button class="btn" data-do="resign">Сдаться</button></div>`;
    }
    this.panel.innerHTML = t;
  }

  setView(v: State) {
    this.s = v;
    this.draw();
  }

  async play(events: Event[], v: State) {
    for (const ev of events) {
      if (ev.type === 'play') {
        Sound.place();
        if (ev.captured.length) Sound.capture();
      } else if (ev.type === 'pass') Sound.ui();
      else if (ev.type === 'end') Sound.win();
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

  playerStats(v: State, seat: number) {
    return `пленных: ${v.caps[seat]}`;
  }
}

export function createView(): GameView<State, Event> {
  return new GoView();
}
