/* Так — отрисовка: деревянная доска, камни — светлый клён и тёмный орех; стопка видна слоями (верх — выше и чуть левее),
 * стенка стоит ребром, капстоун — круглая шашка с куполом. Запасы — у своих краёв. Найденная дорога подсвечивается.
 * Ход: выбрать «плоский / стенка / капстоун» и коснуться пустой клетки; или коснуться своей стопки, потом клетки по прямой —
 * если разложить камни можно по-разному, кнопки «2 + 1» и т. п. */
import { Sound } from '../../core/audio';
import { h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { legal, opening, type Action, type Event, type Kind, type Piece, type State } from './engine';
import './tak.css';

const M = 0.9; // поля вокруг доски (для запасов)

function stackSvg(st: Piece[], x: number, y: number): string {
  let o = '';
  const n = st.length;
  // слишком высокие стопки — показываем верхние 9, число — сбоку
  const from = Math.max(0, n - 9);
  for (let i = from; i < n; i++) {
    const p = st[i];
    const k = i - from;
    const dx = -k * 0.03;
    const dy = -k * 0.085;
    const fill = p.o === 0 ? 'url(#tk-w)' : 'url(#tk-b)';
    const edge = p.o === 0 ? '#8a6a3a' : '#120a04';
    const topmost = i === n - 1;
    if (topmost && p.k === 'S') o += `<rect x="${x + dx - 0.1}" y="${y + dy - 0.36}" width="0.2" height="0.6" rx="0.05" fill="${fill}" stroke="${edge}" stroke-width="0.02" transform="rotate(-35 ${x + dx} ${y + dy - 0.06})"/>`;
    else if (topmost && p.k === 'C') o += `<circle cx="${x + dx}" cy="${y + dy - 0.04}" r="0.24" fill="${fill}" stroke="${edge}" stroke-width="0.025"/><circle cx="${x + dx - 0.07}" cy="${y + dy - 0.11}" r="0.08" fill="#fff" opacity="0.35"/>`;
    else o += `<rect x="${x + dx - 0.3}" y="${y + dy - 0.17}" width="0.6" height="0.34" rx="0.06" fill="${fill}" stroke="${edge}" stroke-width="0.02"/>`;
  }
  if (n > 1) o += `<text x="${x + 0.38}" y="${y + 0.4}" class="tk-h">${n}</text>`;
  return o;
}

class TakView implements GameView<State, Event> {
  private ctx!: ViewCtx;
  private svg!: SVGSVGElement;
  private info!: HTMLElement;
  private btns!: HTMLElement;
  private s: State | null = null;
  private act: number | null = null;
  private kind: Kind = 'F';
  private from: number | null = null;
  private ask: Action[] | null = null;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    const wrap = h('<div class="tk-wrap"><svg class="tk-svg"></svg></div>');
    root.appendChild(wrap);
    this.svg = wrap.querySelector('svg') as SVGSVGElement;
    this.info = h('<div class="tk-info"></div>');
    ctx.controls.appendChild(this.info);
    this.btns = h('<div class="tk-btns"></div>');
    if (!ctx.demo) ctx.controls.appendChild(this.btns);
    this.svg.addEventListener('click', (e) => this.onClick(e));
  }

  private get n() {
    return this.s?.cfg.size ?? 5;
  }

  private draw() {
    const s = this.s;
    if (!s) return;
    const n = this.n;
    const W = n + 2 * M;
    this.svg.setAttribute('viewBox', `0 0 ${W} ${W}`);
    let o = `<defs>
      <linearGradient id="tk-w" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff2d6"/><stop offset="1" stop-color="#d8b47a"/></linearGradient>
      <linearGradient id="tk-b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6a4426"/><stop offset="1" stop-color="#2a170a"/></linearGradient>
      <linearGradient id="tk-board" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#b98a52"/><stop offset="1" stop-color="#8a5a2c"/></linearGradient></defs>`;
    o += `<rect x="${M - 0.18}" y="${M - 0.18}" width="${n + 0.36}" height="${n + 0.36}" rx="0.18" class="tk-frame"/>`;
    o += `<rect x="${M}" y="${M}" width="${n}" height="${n}" fill="url(#tk-board)"/>`;
    const targets = this.targets();
    const road = new Set(s.road ?? []);
    const last = new Set(s.last?.cells ?? []);
    for (let c = 0; c < n * n; c++) {
      const x = M + (c % n);
      const y = M + Math.floor(c / n);
      o += `<rect x="${x + 0.04}" y="${y + 0.04}" width="0.92" height="0.92" rx="0.06" class="tk-cell${(Math.floor(c / n) + c) % 2 ? ' alt' : ''}${road.has(c) ? ' road' : ''}${last.has(c) ? ' last' : ''}${this.from === c ? ' sel' : ''}${targets.has(c) ? ' tgt' : ''}"/>`;
    }
    for (let c = 0; c < n * n; c++) if (s.board[c].length) o += stackSvg(s.board[c], M + (c % n) + 0.5, M + Math.floor(c / n) + 0.56);
    // запасы: белые — снизу, чёрные — сверху
    for (const seat of [0, 1]) {
      const y = seat === 0 ? M + n + 0.48 : M - 0.48;
      o += `<text x="${M}" y="${y + 0.12}" class="tk-res">${seat === 0 ? 'Белые' : 'Чёрные'}: камней ${s.stones[seat]}${s.cfg.caps ? `, капстоунов ${s.caps[seat]}` : ''}</text>`;
    }
    this.svg.innerHTML = o;
    this.text();
  }

  /** Куда можно нести выбранную стопку. */
  private targets(): Set<number> {
    const out = new Set<number>();
    const s = this.s;
    if (!s || this.from == null || this.act == null) return out;
    for (const m of legal(s)) if (m.type === 'move' && m.from === this.from) out.add(this.dest(m));
    return out;
  }

  private dest(m: Extract<Action, { type: 'move' }>): number {
    const n = this.n;
    const dx = [0, 1, 0, -1][m.dir];
    const dy = [-1, 0, 1, 0][m.dir];
    const k = m.drops.length;
    return (Math.floor(m.from / n) + dy * k) * n + (m.from % n) + dx * k;
  }

  private text() {
    const s = this.s!;
    const f = [0, 0];
    for (const st of s.board) {
      const t = st[st.length - 1];
      if (t && t.k === 'F') f[t.o]++;
    }
    this.info.innerHTML = `Плоских сверху: белые <b>${f[0]}</b>, чёрные <b>${f[1]}</b>${s.cfg.komi ? ` (+${s.cfg.komi} коми)` : ''}<small>доска ${s.cfg.size}×${s.cfg.size}, ход ${s.ply + 1}</small>`;
  }

  private renderButtons() {
    this.btns.innerHTML = '';
    const s = this.s;
    if (!s || this.act == null) return;
    if (this.ask) {
      this.btns.appendChild(h('<div class="tk-ask">Как разложить камни по клеткам?</div>'));
      for (const m of this.ask) {
        if (m.type !== 'move') continue;
        const k = m.drops.reduce((x, y) => x + y, 0);
        const b = h<HTMLButtonElement>(`<button class="btn">Несу ${k}: ${m.drops.join(' + ')}</button>`);
        b.onclick = () => this.send(m);
        this.btns.appendChild(b);
      }
      const c = h<HTMLButtonElement>('<button class="btn">Отмена</button>');
      c.onclick = () => this.reset();
      this.btns.appendChild(c);
      return;
    }
    if (opening(s)) {
      this.btns.appendChild(h('<div class="tk-ask">Первый ход: поставьте <b>камень соперника</b> на любую пустую клетку.</div>'));
      return;
    }
    const me = this.act;
    const row = h('<div class="tk-row"></div>');
    const opts: [Kind, string, boolean][] = [
      ['F', `Плоский (${s.stones[me]})`, s.stones[me] > 0],
      ['S', 'Стенка', s.stones[me] > 0],
    ];
    if (s.cfg.caps) opts.push(['C', `Капстоун (${s.caps[me]})`, s.caps[me] > 0]);
    for (const [k, label, ok] of opts) {
      const b = h<HTMLButtonElement>(`<button class="btn${this.kind === k ? ' primary' : ''}"${ok ? '' : ' disabled'}>${label}</button>`);
      b.onclick = () => {
        this.kind = k;
        Sound.ui();
        this.renderButtons();
      };
      row.appendChild(b);
    }
    this.btns.appendChild(row);
    this.btns.appendChild(h(`<div class="tk-ask">${this.from != null ? 'Коснитесь клетки по прямой, куда нести стопку.' : 'Коснитесь пустой клетки — поставить камень, или своей стопки — переложить.'}</div>`));
  }

  private cellAt(e: MouseEvent): number {
    const pt = this.svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const m = this.svg.getScreenCTM();
    if (!m) return -1;
    const p = pt.matrixTransform(m.inverse());
    const x = Math.floor(p.x - M);
    const y = Math.floor(p.y - M);
    return x < 0 || y < 0 || x >= this.n || y >= this.n ? -1 : y * this.n + x;
  }

  private onClick(e: MouseEvent) {
    const s = this.s;
    if (!s || this.act == null) return;
    const c = this.cellAt(e);
    if (c < 0) return;
    const all = legal(s);
    if (this.from != null) {
      const ms = all.filter((m): m is Extract<Action, { type: 'move' }> => m.type === 'move' && m.from === this.from && this.dest(m) === c);
      if (ms.length === 1) return this.send(ms[0]);
      if (ms.length > 1) {
        // сначала — нести всё, что можно, по одной схеме
        this.ask = ms.sort((a, b) => b.drops.reduce((x, y) => x + y, 0) - a.drops.reduce((x, y) => x + y, 0)).slice(0, 12);
        this.renderButtons();
        return;
      }
      if (c === this.from) return this.reset();
    }
    if (!s.board[c].length) {
      const kind = opening(s) ? 'F' : this.kind;
      const m = all.find((x) => x.type === 'place' && x.at === c && x.kind === kind);
      if (m) return this.send(m);
      Sound.nomove();
      return;
    }
    if (all.some((m) => m.type === 'move' && m.from === c)) {
      this.from = c;
      this.ask = null;
      Sound.ui();
      this.draw();
      this.renderButtons();
    }
  }

  private reset() {
    this.from = null;
    this.ask = null;
    this.draw();
    this.renderButtons();
  }

  private send(a: Action) {
    const seat = this.act;
    if (seat == null) return;
    Sound.unlock();
    this.act = null;
    this.from = null;
    this.ask = null;
    this.btns.innerHTML = '';
    this.ctx.act(seat, a);
  }

  async play(events: Event[], v: State) {
    this.act = null;
    for (const ev of events) {
      if (ev.type === 'place') Sound.place();
      else if (ev.type === 'move') ev.flatten ? Sound.capture() : Sound.step();
      else if (ev.type === 'end') Sound.win();
    }
    this.s = v;
    this.draw();
    await sleep(320 / this.ctx.speed());
  }

  setView(v: State) {
    this.s = v;
    this.draw();
  }

  setTurn(toAct: number[], interactive: number[]) {
    const s = this.s;
    this.from = null;
    this.ask = null;
    this.act = s && !s.over && !this.ctx.demo ? (interactive.find((x) => toAct.includes(x)) ?? null) : null;
    if (s && this.act != null && this.kind !== 'F' && (this.kind === 'C' ? s.caps[this.act] <= 0 : s.stones[this.act] <= 0)) this.kind = 'F';
    this.draw();
    this.renderButtons();
  }

  status(v: State, toAct: number[], interactive: number[]) {
    if (v.over) return v.winner == null ? 'Ничья' : `Победа: ${this.ctx.name(v.winner)}${v.how === 'road' ? ' — дорога!' : ' по плоским'}`;
    return interactive.includes(toAct[0]) ? 'Ваш ход' : `Ходят ${this.ctx.name(toAct[0])}…`;
  }
}

export function createView(): GameView<State, Event> {
  return new TakView();
}
