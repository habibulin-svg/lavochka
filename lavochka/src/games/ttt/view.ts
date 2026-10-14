/* Крестики-нолики — отрисовка: тетрадный лист в клетку, сетка от руки, знаки «пишутся» ручкой.
 * Ультимативные: девять малых полей, куда можно ходить — подсвечено; взятое поле перечёркнуто большим знаком. */
import { Sound } from '../../core/audio';
import { h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { legal, type Event, type State } from './engine';
import { SEATS } from './def';
import './ttt.css';

const NS = 'http://www.w3.org/2000/svg';
const SIZE = 360;
const PAD = 20;

/** Чуть кривая линия «от руки» (детерминированно от координат, чтобы не дрожала при перерисовке). */
function wobble(x1: number, y1: number, x2: number, y2: number, amp: number): string {
  const k = Math.sin(x1 * 12.9898 + y1 * 78.233 + x2 * 3.1 + y2 * 1.7) * 43758.5453;
  const r = (k - Math.floor(k)) * 2 - 1;
  const mx = (x1 + x2) / 2 + (y2 - y1) * 0.02 * r * amp;
  const my = (y1 + y2) / 2 - (x2 - x1) * 0.02 * r * amp;
  return `M${x1.toFixed(1)} ${y1.toFixed(1)}Q${mx.toFixed(1)} ${my.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`;
}

/** Знак в квадрате (x, y, s): крестик — два штриха, нолик — овал с заходом. */
function mark(seat: number, x: number, y: number, s: number, cls: string, width: number): string {
  const col = SEATS[seat].color;
  const m = s * 0.2;
  if (seat === 0)
    return `<path class="${cls}" pathLength="1" d="${wobble(x + m, y + m, x + s - m, y + s - m, 1)}" stroke="${col}" stroke-width="${width}"/>` +
      `<path class="${cls} t2" pathLength="1" d="${wobble(x + s - m, y + m, x + m, y + s - m, -1)}" stroke="${col}" stroke-width="${width}"/>`;
  const cx = x + s / 2;
  const cy = y + s / 2;
  const rx = s * 0.31;
  const ry = s * 0.34;
  // овал с небольшим заходом за начало, как ручкой
  return `<path class="${cls}" pathLength="1" d="M${cx + rx * 0.2} ${cy - ry}A${rx} ${ry} 0 1 0 ${cx + rx * 0.45} ${cy - ry * 0.88}" stroke="${col}" stroke-width="${width}"/>`;
}

class TttView implements GameView<State, Event> {
  private ctx!: ViewCtx;
  private svg!: SVGSVGElement;
  private btns!: HTMLElement;
  private s: State | null = null;
  private actSeat: number | null = null;
  private fresh = -1;
  private freshBoard = -1;
  private banner = '';

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    const wrap = h(`<div class="tt-wrap"><svg class="tt-board" xmlns="${NS}" viewBox="0 0 ${SIZE} ${SIZE}"></svg></div>`);
    root.appendChild(wrap);
    this.svg = wrap.querySelector('svg') as SVGSVGElement;
    const ctl = h(`<div class="tt-controls"><div class="tt-btns"></div>${ctx.demo ? '' : '<div class="hint small-hint">Нажмите на клетку, чтобы поставить свой знак.</div>'}</div>`);
    ctx.controls.appendChild(ctl);
    this.btns = ctl.querySelector('.tt-btns') as HTMLElement;
    this.svg.addEventListener('click', (e) => {
      const st = this.s;
      if (!st || this.actSeat == null || st.phase !== 'play') return;
      const t = (e.target as Element).closest('[data-p]') as SVGElement | null;
      if (!t) return;
      const p = Number(t.dataset.p);
      if (!legal(st).includes(p)) return;
      const seat = this.actSeat;
      Sound.unlock();
      this.clearTurn();
      this.ctx.act(seat, { type: 'mark', p });
    });
  }

  /** Квадрат клетки p на листе. */
  private cell(p: number): { x: number; y: number; s: number } {
    const st = this.s!;
    const inner = SIZE - PAD * 2;
    if (st.mode === 'classic') {
      const s = inner / 3;
      return { x: PAD + (p % 3) * s, y: PAD + Math.floor(p / 3) * s, s };
    }
    const B = inner / 3;
    const b = Math.floor(p / 9);
    const c = p % 9;
    const m = B * 0.08;
    const s = (B - m * 2) / 3;
    return { x: PAD + (b % 3) * B + m + (c % 3) * s, y: PAD + Math.floor(b / 3) * B + m + Math.floor(c / 3) * s, s };
  }

  private boardBox(b: number) {
    const B = (SIZE - PAD * 2) / 3;
    return { x: PAD + (b % 3) * B, y: PAD + Math.floor(b / 3) * B, s: B };
  }

  private draw() {
    const st = this.s;
    if (!st) return;
    const n = st.mode === 'classic' ? 9 : 81;
    const moves = st.phase === 'play' ? new Set(legal(st)) : new Set<number>();
    const mine = this.actSeat != null;
    let out = '';
    // клетки листа
    out += `<rect width="${SIZE}" height="${SIZE}" class="tt-paper"/>`;
    for (let i = 0; i <= SIZE; i += 18) out += `<line x1="${i}" y1="0" x2="${i}" y2="${SIZE}" class="tt-sq"/><line x1="0" y1="${i}" x2="${SIZE}" y2="${i}" class="tt-sq"/>`;
    // ультимативные: подсветка полей, куда можно ходить
    if (st.mode === 'ultimate' && st.phase === 'play') {
      for (let b = 0; b < 9; b++) {
        if (st.boards[b] !== -1 || (st.next !== -1 && st.next !== b)) continue;
        const r = this.boardBox(b);
        out += `<rect x="${r.x + 3}" y="${r.y + 3}" width="${r.s - 6}" height="${r.s - 6}" rx="6" class="tt-allowed${mine ? ' mine' : ''}" style="--c:${SEATS[st.turn].color}"/>`;
      }
    }
    // сетки
    const grid = (x: number, y: number, s: number, w: number, cls: string) => {
      let g = '';
      for (let i = 1; i < 3; i++) {
        g += `<path d="${wobble(x + (s * i) / 3, y + s * 0.03, x + (s * i) / 3, y + s * 0.97, 1)}" class="${cls}" stroke-width="${w}"/>`;
        g += `<path d="${wobble(x + s * 0.03, y + (s * i) / 3, x + s * 0.97, y + (s * i) / 3, -1)}" class="${cls}" stroke-width="${w}"/>`;
      }
      return g;
    };
    if (st.mode === 'classic') out += grid(PAD, PAD, SIZE - PAD * 2, 4, 'tt-grid');
    else {
      out += grid(PAD, PAD, SIZE - PAD * 2, 4.5, 'tt-grid');
      for (let b = 0; b < 9; b++) {
        const r = this.boardBox(b);
        const m = r.s * 0.08;
        out += `<g class="${st.boards[b] !== -1 ? 'tt-done' : ''}">${grid(r.x + m, r.y + m, r.s - m * 2, 1.8, 'tt-grid thin')}</g>`;
      }
    }
    // клетки для нажатия и знаки
    for (let p = 0; p < n; p++) {
      const c = this.cell(p);
      const v = st.cells[p];
      const done = st.mode === 'ultimate' && st.boards[Math.floor(p / 9)] !== -1;
      if (v === -1) {
        if (moves.has(p) && mine) out += `<rect data-p="${p}" x="${c.x}" y="${c.y}" width="${c.s}" height="${c.s}" class="tt-hit" style="--c:${SEATS[st.turn].color}"/>`;
        continue;
      }
      const w = st.mode === 'classic' ? 7 : 3;
      out += `<g class="${done ? 'tt-done' : ''}">${mark(v, c.x, c.y, c.s, p === this.fresh ? 'tt-ink fresh' : 'tt-ink', w)}</g>`;
      if (p === st.last && p !== this.fresh && st.phase === 'play') out += `<rect x="${c.x + 2}" y="${c.y + 2}" width="${c.s - 4}" height="${c.s - 4}" rx="3" class="tt-last"/>`;
    }
    // большие знаки на взятых полях
    if (st.mode === 'ultimate')
      for (let b = 0; b < 9; b++) {
        const o = st.boards[b];
        if (o !== 0 && o !== 1) continue;
        const r = this.boardBox(b);
        out += mark(o, r.x, r.y, r.s, b === this.freshBoard ? 'tt-ink fresh big' : 'tt-ink big', 8);
      }
    // линия победы
    if (st.line) {
      const box = (i: number) => (st.mode === 'classic' ? this.cell(i) : this.boardBox(i));
      const a = box(st.line[0]);
      const z = box(st.line[2]);
      const col = SEATS[st.roundResult === 1 ? 1 : 0].color;
      out += `<path class="tt-ink fresh win" pathLength="1" d="${wobble(a.x + a.s / 2, a.y + a.s / 2, z.x + z.s / 2, z.y + z.s / 2, 0.5)}" stroke="${col}" stroke-width="6"/>`;
    }
    if (this.banner) out += `<g class="tt-banner"><rect x="${SIZE / 2 - 150}" y="${SIZE / 2 - 30}" width="300" height="60" rx="6"/><text x="${SIZE / 2}" y="${SIZE / 2 + 2}">${this.banner}</text></g>`;
    this.svg.innerHTML = out;
  }

  private clearTurn() {
    this.actSeat = null;
    this.btns.innerHTML = '';
    this.draw();
  }

  setView(s: State) {
    this.s = s;
    this.fresh = -1;
    this.freshBoard = -1;
    this.banner = s.phase === 'play' ? '' : this.resultText(s);
    this.draw();
  }

  private plain(seat: number) {
    return this.ctx.name(seat).replace(/<[^>]+>/g, '');
  }

  private resultText(s: State) {
    if (s.roundResult == null) return '';
    return s.roundResult === 2 ? 'Ничья!' : `Выиграли ${this.plain(s.roundResult)}!`;
  }

  async play(events: Event[], s: State) {
    const speed = this.ctx.speed();
    this.actSeat = null;
    this.btns.innerHTML = '';
    for (const ev of events) {
      if (ev.type === 'mark') {
        const prev = this.s ?? s;
        const cells = prev.cells.slice();
        cells[ev.p] = ev.seat;
        this.s = { ...prev, cells, last: ev.p, turn: 1 - ev.seat };
        this.fresh = ev.p;
        this.freshBoard = -1;
        this.draw();
        Sound.pen(ev.seat === 0 ? 2 : 1);
        await sleep(320 / speed);
      } else if (ev.type === 'board') {
        const boards = this.s!.boards.slice();
        boards[ev.b] = ev.owner;
        this.s = { ...this.s!, boards };
        this.freshBoard = ev.b;
        this.fresh = -1;
        this.draw();
        if (ev.owner === 2) Sound.nomove();
        else {
          Sound.pen(ev.owner === 0 ? 2 : 1);
          Sound.capture();
        }
        await sleep(450 / speed);
      } else if (ev.type === 'round') {
        this.s = { ...s, phase: s.phase, line: ev.line, roundResult: ev.result };
        this.fresh = -1;
        this.freshBoard = -1;
        this.banner = ev.result === 2 ? 'Ничья!' : `Выиграли ${this.plain(ev.result)}!`;
        this.draw();
        if (ev.result === 2) Sound.nomove();
        else Sound.home();
        await sleep(900 / speed);
      } else if (ev.type === 'newround') {
        this.banner = '';
        Sound.shuffle();
      } else if (ev.type === 'end') {
        Sound.win();
      }
    }
    this.s = s;
    this.fresh = -1;
    this.freshBoard = -1;
    this.banner = s.phase === 'play' ? '' : this.resultText(s);
    this.draw();
  }

  setTurn(toAct: number[], interactive: number[]) {
    this.actSeat = null;
    this.btns.innerHTML = '';
    const st = this.s;
    if (!st || st.phase === 'over' || this.ctx.demo) return this.draw();
    this.actSeat = interactive.find((x) => toAct.includes(x)) ?? null;
    if (st.phase === 'between' && this.actSeat != null) {
      const seat = this.actSeat;
      const b = h<HTMLButtonElement>(`<button class="btn primary" data-tap>Следующая партия</button>`);
      b.onclick = () => {
        Sound.unlock();
        this.clearTurn();
        this.ctx.act(seat, { type: 'next' });
      };
      this.btns.appendChild(b);
    }
    this.draw();
  }

  status(st: State, toAct: number[], interactive: number[]) {
    const name = (p: number) => this.ctx.name(p);
    const series = st.rounds > 1 ? ` (партия ${st.round} из ${st.rounds})` : '';
    if (st.phase === 'over') {
      const [a, b] = st.score;
      return a === b ? 'Ничья' : `Победа: ${name(a > b ? 0 : 1)}`;
    }
    if (st.phase === 'between') return `${this.resultText(st)}${series}`;
    const who = toAct[0];
    const where = st.mode === 'ultimate' ? (st.next === -1 ? ' — в любое поле' : ` — в поле ${st.next + 1}`) : '';
    return (interactive.includes(who) ? `Ваш ход: ${name(who)}` : `Ходят ${name(who)}…`) + where + series;
  }

  playerStats(st: State, seat: number) {
    const sc = st.score[seat];
    const pts = sc % 2 ? `${(sc - 1) / 2}½` : String(sc / 2);
    const boards = st.mode === 'ultimate' ? ` · полей: ${st.boards.filter((x) => x === seat).length}` : '';
    return `<span>очков: ${pts.replace(/^0½$/, '½')}${boards}</span>`;
  }
}

export function createView(): GameView<State, Event> {
  return new TttView();
}
