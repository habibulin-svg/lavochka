/* Го — отрисовка: деревянный гобан (SVG), линии и звёзды, камни с бликом, метка последнего хода, подсказка-тень под курсором.
 * После конца партии — территория квадратиками, мёртвые камни полупрозрачные, счёт. Панель: пас, сдаться, пленные. */
import { Sound } from '../../core/audio';
import { h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { BLACK, hoshi, isLegal, TIBET_CENTER_BONUS, WHITE, type Event, type State } from './engine';
import { ghostSvg, gobanAspect, gobanBoard, gobanBox, gobanDefs, lastMark, pointAt, preloadGoban, stoneSvg } from './goban';
import './go.css';

const NS = 'http://www.w3.org/2000/svg';

class GoView implements GameView<State, Event> {
  private ctx!: ViewCtx;
  private svg!: SVGSVGElement;
  private panel!: HTMLElement;
  private s: State | null = null;
  private actSeat: number | null = null;
  private hover = -1;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    preloadGoban();
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
    return this.s ? pointAt(this.svg, this.s.n, e) : -1;
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
    this.svg.setAttribute('viewBox', gobanBox(n));
    this.svg.style.aspectRatio = gobanAspect(n);
    const L = (i: number) => i + 1;
    let o = gobanDefs() + gobanBoard(n, hoshi(n));
    const dead = new Set(s.final?.dead ?? []);
    for (let p = 0; p < n * n; p++) {
      const c = s.board[p];
      if (!c) continue;
      o += stoneSvg(p, n, c === BLACK, dead.has(p) ? ' opacity="0.42"' : '');
      if (p === s.last && !s.over) o += lastMark(p, n, c === BLACK);
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
    // тибетское го: куда можно ходить (не дальше пункта от своего камня, не в только что снятые)
    if (s.cfg.rules === 'tibetan' && this.actSeat != null && !s.over) {
      for (let p = 0; p < n * n; p++) {
        if (s.board[p] || p === this.hover || !isLegal(s, p)) continue;
        o += `<circle cx="${L(p % n)}" cy="${L(Math.floor(p / n))}" r="0.09" class="go-ok"/>`;
      }
    }
    // тень будущего хода
    if (this.actSeat != null && this.hover >= 0 && isLegal(s, this.hover)) {
      const c = this.actSeat === 0 ? BLACK : WHITE;
      o += ghostSvg(this.hover, n, c === BLACK);
    }
    this.svg.innerHTML = o;
    this.drawPanel();
  }

  private drawPanel() {
    const s = this.s;
    if (!s) return;
    const tibet = s.cfg.rules === 'tibetan';
    let t = tibet
      ? `<div class="go-caps">Пленные: ● ${s.caps[0]} · ○ ${s.caps[1]} · центр: ${s.center < 0 ? 'свободен' : `${s.center === 0 ? 'чёрные' : 'белые'} +${TIBET_CENTER_BONUS}`}</div>`
      : `<div class="go-caps">Пленные: ● ${s.caps[0]} · ○ ${s.caps[1]} · коми ${String(s.komi).replace('.', ',')}</div>`;
    if (s.final) t += `<div class="go-score">${s.final.resign != null ? `${s.final.resign === 0 ? 'Чёрные' : 'Белые'} сдались` : `Чёрные ${String(s.final.score[0]).replace('.', ',')} — белые ${String(s.final.score[1]).replace('.', ',')}${s.final.winner < 0 ? ', ничья' : ''}`}</div>`;
    else if (this.actSeat != null && !this.ctx.demo) {
      t += `<div class="go-ask">${s.passes ? 'Соперник спасовал: пас — и партия окончена.' : tibet ? 'Ваш ход: камень — на пункт с точкой.' : 'Ваш ход: поставьте камень.'}</div><div class="go-row"><button class="btn" data-do="pass">Пас</button><button class="btn" data-do="resign">Сдаться</button></div>`;
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
