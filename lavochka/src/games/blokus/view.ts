/* Блоки — отрисовка: серое пластиковое поле с углублениями, фигурки — полупрозрачный цветной пластик с бликом.
 * Ход: выбрать фигурку в запасе (панель), повернуть/отразить (кнопки, R / F, колесо мыши), навести на поле — призрак показывает,
 * куда ляжет (подгоняется так, чтобы клетка под курсором была в фигурке и ход был по правилам); щелчок — поставить.
 * На телефоне: касание — призрак, второе касание той же клетки (или кнопка «Поставить») — поставить. */
import { Sound } from '../../core/audio';
import { h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { anchors, cellsAt, color, colorsOf, fits, legal, ORIENTS, ownerOf, PIECE_SIZE, type Action, type Event, type State } from './engine';
import './blokus.css';

export const COLORS = ['#1f6fe0', '#f2bf1d', '#e2362b', '#27a347'];
export const COLOR_RU = ['синий', 'жёлтый', 'красный', 'зелёный'];
const LIGHT = ['#8ec0ff', '#fff0a0', '#ff9a8e', '#8fe6a0'];
const DARK = ['#0b3c8a', '#9a7208', '#8a1610', '#0f5e24'];

const M = 0.5; // рамка поля

/** Одна пластиковая клетка. */
export function cellSvg(x: number, y: number, col: number, extra = ''): string {
  return `<g class="bk-c${extra}"><rect x="${x + 0.03}" y="${y + 0.03}" width="0.94" height="0.94" rx="0.08" fill="url(#bk-g${col})" stroke="${DARK[col]}" stroke-width="0.04"/>
    <rect x="${x + 0.12}" y="${y + 0.1}" width="0.5" height="0.16" rx="0.08" fill="#fff" opacity="0.35"/>
    <rect x="${x + 0.3}" y="${y + 0.3}" width="0.4" height="0.4" rx="0.06" fill="${LIGHT[col]}" opacity="0.28"/></g>`;
}

export const DEFS = `<defs>${COLORS.map(
  (c, i) =>
    `<linearGradient id="bk-g${i}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${LIGHT[i]}" stop-opacity="0.95"/><stop offset="0.45" stop-color="${c}" stop-opacity="0.88"/><stop offset="1" stop-color="${DARK[i]}" stop-opacity="0.92"/></linearGradient>`,
).join('')}
  <linearGradient id="bk-board" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d9dcdf"/><stop offset="1" stop-color="#a9adb2"/></linearGradient>
  <linearGradient id="bk-hole" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#a3a7ad"/><stop offset="1" stop-color="#cfd2d6"/></linearGradient></defs>`;

/** Фигурка из клеток [строка, столбец] (дробные — можно): клетки + перемычки. */
function shapeSvg(cells: [number, number][], col: number): string {
  const has = (r: number, c: number) => cells.some(([a, b]) => a === r && b === c);
  let o = '';
  let top = '';
  for (const [r, c] of cells) {
    if (has(r, c + 1)) (o += `<rect x="${c + 0.85}" y="${r + 0.03}" width="0.3" height="0.94" fill="${DARK[col]}"/>`), (top += `<rect x="${c + 0.9}" y="${r + 0.12}" width="0.2" height="0.76" fill="${COLORS[col]}" opacity="0.55"/>`);
    if (has(r + 1, c)) (o += `<rect x="${c + 0.03}" y="${r + 0.85}" width="0.94" height="0.3" fill="${DARK[col]}"/>`), (top += `<rect x="${c + 0.12}" y="${r + 0.9}" width="0.76" height="0.2" fill="${COLORS[col]}" opacity="0.55"/>`);
  }
  return o + cells.map(([r, c]) => cellSvg(c, r, col)).join('') + top;
}

/** Перемычки между соседними клетками одного цвета — фигурка выглядит цельной (соседи одного цвета — всегда одна фигурка).
 * top — поверх клеток: закрыть швы обводки. */
function joins(board: number[], n: number, top = false): string {
  let o = '';
  for (let c = 0; c < n * n; c++) {
    const col = board[c];
    if (col < 0) continue;
    const x = M + (c % n);
    const y = M + Math.floor(c / n);
    const fill = top ? COLORS[col] : DARK[col];
    const op = top ? ' opacity="0.55"' : '';
    if (c % n < n - 1 && board[c + 1] === col) o += `<rect x="${x + (top ? 0.9 : 0.85)}" y="${y + (top ? 0.12 : 0.03)}" width="${top ? 0.2 : 0.3}" height="${top ? 0.76 : 0.94}" fill="${fill}"${op}/>`;
    if (Math.floor(c / n) < n - 1 && board[c + n] === col) o += `<rect x="${x + (top ? 0.12 : 0.03)}" y="${y + (top ? 0.9 : 0.85)}" width="${top ? 0.76 : 0.94}" height="${top ? 0.2 : 0.3}" fill="${fill}"${op}/>`;
  }
  return o;
}

/** Маленькая картинка фигурки (для запаса). */
function pieceIcon(p: number, o: number, col: number): string {
  const sh = ORIENTS[p][o];
  const w = Math.max(...sh.map((c) => c[1])) + 1;
  const hh = Math.max(...sh.map((c) => c[0])) + 1;
  const side = Math.max(w, hh, 3);
  const ox = (side - w) / 2;
  const oy = (side - hh) / 2;
  return `<svg viewBox="-0.1 -0.1 ${side + 0.2} ${side + 0.2}">${shapeSvg(sh.map(([r, c]) => [r + oy, c + ox]), col)}</svg>`;
}

function rotate(p: number, o: number, flip: boolean): number {
  const sh = ORIENTS[p][o].map(([r, c]) => (flip ? [r, -c] : [c, -r]) as [number, number]);
  const r0 = Math.min(...sh.map((x) => x[0]));
  const c0 = Math.min(...sh.map((x) => x[1]));
  const key = sh
    .map(([r, c]) => [r - r0, c - c0])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
    .join(';');
  const i = ORIENTS[p].findIndex((x) => x.join(';') === key);
  return i < 0 ? o : i;
}

class BlokusView implements GameView<State, Event> {
  private ctx!: ViewCtx;
  private svg!: SVGSVGElement;
  private panel!: HTMLElement;
  private s: State | null = null;
  private act: number | null = null;
  private piece: number | null = null;
  private orient = 0;
  private hover: number | null = null;
  private ghost: number[] | null = null;
  private touch = false;
  private onKey = (e: KeyboardEvent) => this.key(e);

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    const wrap = h('<div class="bk-wrap"><svg class="bk-svg"></svg></div>');
    root.appendChild(wrap);
    this.svg = wrap.querySelector('svg') as SVGSVGElement;
    this.panel = h('<div class="bk-panel"></div>');
    ctx.controls.appendChild(this.panel);
    this.svg.addEventListener('pointermove', (e) => this.move(e));
    this.svg.addEventListener('pointerleave', () => {
      if (!this.touch) (this.hover = null), (this.ghost = null), this.draw();
    });
    this.svg.addEventListener('pointerdown', (e) => (this.touch = e.pointerType !== 'mouse'));
    this.svg.addEventListener('click', (e) => this.click(e));
    this.svg.addEventListener('wheel', (e) => {
      if (this.piece == null) return;
      e.preventDefault();
      this.turn(false);
    });
    this.panel.addEventListener('click', (e) => this.panelClick(e));
    if (!ctx.demo) window.addEventListener('keydown', this.onKey);
  }

  destroy() {
    window.removeEventListener('keydown', this.onKey);
  }

  private get n() {
    return this.s?.cfg.n ?? 20;
  }

  // ---------------------------------------------------------------- призрак

  /** Где ляжет выбранная фигурка, если навести на клетку at: сначала — чтобы ход был по правилам. */
  private place(at: number): { cells: number[]; ok: boolean } | null {
    const s = this.s;
    if (!s || this.piece == null) return null;
    const p = this.piece;
    const sh = ORIENTS[p][this.orient];
    const col = color(s);
    let first: number[] | null = null;
    // клетка под курсором — ближе к центру фигурки в первую очередь
    const cy = sh.reduce((a, c) => a + c[0], 0) / sh.length;
    const cx = sh.reduce((a, c) => a + c[1], 0) / sh.length;
    const order = sh.map((_, k) => k).sort((a, b) => Math.hypot(sh[a][0] - cy, sh[a][1] - cx) - Math.hypot(sh[b][0] - cy, sh[b][1] - cx));
    for (const k of order) {
      const cells = cellsAt(this.n, p, this.orient, k, at);
      if (!cells) continue;
      if (!first) first = cells;
      if (fits(s, col, cells)) return { cells, ok: true };
    }
    return first ? { cells: first, ok: false } : null;
  }

  private cellAt(e: MouseEvent): number | null {
    const pt = this.svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const m = this.svg.getScreenCTM();
    if (!m) return null;
    const p = pt.matrixTransform(m.inverse());
    const x = Math.floor(p.x - M);
    const y = Math.floor(p.y - M);
    return x < 0 || y < 0 || x >= this.n || y >= this.n ? null : y * this.n + x;
  }

  private move(e: PointerEvent) {
    if (this.act == null || this.piece == null || e.pointerType !== 'mouse') return;
    const c = this.cellAt(e);
    if (c === this.hover) return;
    this.hover = c;
    const pl = c == null ? null : this.place(c);
    this.ghost = pl?.cells ?? null;
    this.draw();
  }

  private click(e: MouseEvent) {
    const s = this.s;
    if (!s || this.act == null || this.piece == null) return;
    const c = this.cellAt(e);
    if (c == null) return;
    const pl = this.place(c);
    if (!pl) return;
    // на телефоне: первое касание — призрак, второе (по призраку) — поставить
    if (this.touch && !(this.ghost && this.ghost.includes(c) && pl.ok && this.same(pl.cells))) {
      this.hover = c;
      this.ghost = pl.cells;
      Sound.ui();
      this.draw();
      this.renderPanel();
      return;
    }
    if (!pl.ok) return Sound.nomove();
    this.send({ type: 'place', piece: this.piece, cells: pl.cells });
  }

  private same(cells: number[]) {
    return !!this.ghost && this.ghost.length === cells.length && cells.every((c) => this.ghost!.includes(c));
  }

  private turn(flip: boolean) {
    if (this.piece == null) return;
    this.orient = rotate(this.piece, this.orient, flip);
    Sound.ui();
    if (this.hover != null) this.ghost = this.place(this.hover)?.cells ?? null;
    this.draw();
    this.renderPanel();
  }

  private key(e: KeyboardEvent) {
    if (this.act == null || this.piece == null) return;
    const t = e.target as HTMLElement;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    if (e.key === 'r' || e.key === 'R' || e.key === 'к' || e.key === 'К') this.turn(false);
    else if (e.key === 'f' || e.key === 'F' || e.key === 'а' || e.key === 'А') this.turn(true);
    else if (e.key === 'Escape') this.pick(null);
  }

  // ---------------------------------------------------------------- рисунок

  private draw() {
    const s = this.s;
    if (!s) return;
    const n = this.n;
    const W = n + 2 * M;
    this.svg.setAttribute('viewBox', `0 0 ${W} ${W}`);
    let o = DEFS;
    o += `<rect x="0" y="0" width="${W}" height="${W}" rx="0.5" fill="url(#bk-board)" class="bk-frame"/>`;
    // углубления
    let holes = '';
    for (let c = 0; c < n * n; c++) holes += `<rect x="${M + (c % n) + 0.06}" y="${M + Math.floor(c / n) + 0.06}" width="0.88" height="0.88" rx="0.06"/>`;
    o += `<g class="bk-holes" fill="url(#bk-hole)">${holes}</g>`;
    // начальные клетки
    for (const col of s.cfg.colors) {
      const st = s.cfg.start[col];
      if (s.board[st] === -1) o += `<circle cx="${M + (st % n) + 0.5}" cy="${M + Math.floor(st / n) + 0.5}" r="0.28" fill="${COLORS[col]}" opacity="0.75"/>`;
    }
    const last = new Set(s.last?.cells ?? []);
    o += joins(s.board, n);
    for (let c = 0; c < n * n; c++) if (s.board[c] >= 0) o += cellSvg(M + (c % n), M + Math.floor(c / n), s.board[c], last.has(c) ? ' last' : '');
    o += joins(s.board, n, true);
    // уголки, от которых можно расти (своему цвету)
    if (this.act != null && !s.over) {
      const col = color(s);
      for (const a of anchors(s, col)) o += `<circle cx="${M + (a % n) + 0.5}" cy="${M + Math.floor(a / n) + 0.5}" r="0.12" class="bk-an"/>`;
      if (this.ghost) {
        const ok = fits(s, col, this.ghost);
        o += `<g class="bk-ghost${ok ? '' : ' bad'}">${shapeSvg(this.ghost.map((c) => [M + Math.floor(c / n), M + (c % n)] as [number, number]), col)}</g>`;
      }
    }
    this.svg.innerHTML = o;
  }

  private renderPanel() {
    const s = this.s;
    if (!s) return;
    const col = color(s);
    const mine = this.act != null && !s.over;
    // счёт: оставшиеся клетки по цветам
    let score = '<div class="bk-score" title="Сколько клеток осталось на руках"><b>На руках:</b>';
    for (const c of s.cfg.colors) {
      const left = s.hand[c].reduce((a, p) => a + PIECE_SIZE[p], 0);
      score += `<span class="${c === col && !s.over ? 'now' : ''}${s.out[c] ? ' out' : ''}"><i style="background:${COLORS[c]}"></i>${left}</span>`;
    }
    score += '</div>';
    let o = score;
    const showCol = mine ? col : this.ctx.mySeats.length ? (colorsOf(s, this.ctx.mySeats[0])[0] ?? col) : col;
    o += `<div class="bk-who">${mine ? `Ваш ход: <b style="color:${DARK[col]}">${COLOR_RU[col]}</b>` : s.over ? 'Партия окончена' : `Ходит ${COLOR_RU[col]} — ${this.ctx.name(ownerOf(s, col))}`}</div>`;
    o += '<div class="bk-hand">';
    for (const p of s.hand[showCol]) {
      const orient = p === this.piece ? this.orient : 0;
      o += `<button class="bk-p${p === this.piece ? ' sel' : ''}" data-p="${p}"${mine ? '' : ' disabled'}>${pieceIcon(p, orient, showCol)}</button>`;
    }
    o += '</div>';
    if (mine) {
      o += '<div class="bk-btns">';
      if (this.piece != null) {
        o += '<button class="btn" data-a="rot" title="R">⟳ Повернуть</button><button class="btn" data-a="flip" title="F">⇋ Отразить</button>';
        if (this.touch && this.ghost && fits(s, col, this.ghost)) o += '<button class="btn primary" data-a="put">Поставить</button>';
      }
      const ms = legal(s);
      if (ms.length === 1 && ms[0].type === 'pass') o += '<button class="btn primary" data-a="pass">Ходов нет — выбыть</button>';
      o += '</div>';
      o += `<div class="bk-tip">${this.piece == null ? 'Выберите фигурку. Первая — на начальную клетку, дальше — уголком к своим, но не стороной.' : this.touch ? 'Коснитесь поля — появится призрак, коснитесь его ещё раз (или «Поставить»).' : 'Наведите на поле и щёлкните. R — повернуть, F — отразить, колесо мыши — поворот.'}</div>`;
    }
    this.panel.innerHTML = o;
  }

  private panelClick(e: MouseEvent) {
    const el = (e.target as HTMLElement).closest('[data-p],[data-a]') as HTMLElement | null;
    if (!el || this.act == null) return;
    if (el.dataset.p != null) return this.pick(Number(el.dataset.p));
    const a = el.dataset.a;
    if (a === 'rot') this.turn(false);
    else if (a === 'flip') this.turn(true);
    else if (a === 'put' && this.ghost && this.piece != null) this.send({ type: 'place', piece: this.piece, cells: this.ghost });
    else if (a === 'pass') this.send({ type: 'pass' });
  }

  private pick(p: number | null) {
    this.piece = this.piece === p ? null : p;
    this.orient = 0;
    this.ghost = null;
    if (this.piece != null && this.hover != null) this.ghost = this.place(this.hover)?.cells ?? null;
    Sound.ui();
    this.draw();
    this.renderPanel();
  }

  private send(a: Action) {
    const seat = this.act;
    if (seat == null) return;
    Sound.unlock();
    this.act = null;
    this.piece = null;
    this.ghost = null;
    this.ctx.act(seat, a);
  }

  async play(events: Event[], v: State) {
    this.act = null;
    this.s = v;
    this.draw();
    this.renderPanel();
    for (const ev of events) {
      if (ev.type === 'place') {
        Sound.place();
        const els = this.svg.querySelectorAll('.bk-c.last');
        els.forEach((el) => el.classList.add('drop'));
      } else if (ev.type === 'end') Sound.win();
    }
    await sleep(300 / this.ctx.speed());
  }

  setView(v: State) {
    this.s = v;
    this.draw();
    this.renderPanel();
  }

  setTurn(toAct: number[], interactive: number[]) {
    const s = this.s;
    this.act = s && !s.over && !this.ctx.demo ? (interactive.find((x) => toAct.includes(x)) ?? null) : null;
    if (this.piece != null && s && !s.hand[color(s)].includes(this.piece)) this.piece = null;
    this.ghost = null;
    this.draw();
    this.renderPanel();
  }

  status(v: State, toAct: number[], interactive: number[]) {
    if (v.over) {
      const sc = v.scores ?? [];
      const best = Math.max(...sc);
      const win = sc.map((x, i) => (x === best ? i : -1)).filter((i) => i >= 0);
      return win.length > 1 ? `Ничья: ${best}` : `Победа: ${this.ctx.name(win[0])} (${best})`;
    }
    return interactive.includes(toAct[0]) ? 'Ваш ход' : `Ходят ${this.ctx.name(toAct[0])}…`;
  }
}

export function createView(): GameView<State, Event> {
  return new BlokusView();
}
