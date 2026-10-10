/* Кинь-двинь — отрисовка: оригинальное поле картинкой, пуговицы игроков на клетках (несколько на одной — веером),
 * кубик и кнопка «Бросить» в панели. Пуговица шагает по клеткам, потом перелетает по знаку. */
import { Sound } from '../../core/audio';
import { h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { SEATS, type Board, type Event, type State } from './core';
import { boardOf } from './def';
import './hodilki.css';

const PIPS: Record<number, number[][]> = {
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [2, 0], [0, 2], [2, 2]],
  5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
  6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
};

class HodilkiView implements GameView<State, Event> {
  private ctx!: ViewCtx;
  /** Поле партии — из состояния (настройка «Поле»). */
  private b: Board | null = null;
  private fit = () => {};
  private board!: HTMLElement;
  private tokens = new Map<number, HTMLElement>();
  private panel!: HTMLElement;
  private v: State | null = null;
  /** Где пуговица сейчас нарисована (во время анимации — не там, где в состоянии). */
  private shown: number[] = [];
  private actSeat: number | null = null;
  private ro!: ResizeObserver;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    const wrap = h(`<div class="ks-wrap"><div class="ks-board"><img alt="поле" draggable="false"></div></div>`);
    root.appendChild(wrap);
    this.board = wrap.querySelector('.ks-board') as HTMLElement;
    // поле — ровно по картинке, вписано в доступное место (проценты пуговиц — от картинки)
    this.fit = () => {
      if (!this.b) return;
      const r = wrap.getBoundingClientRect();
      const w = Math.max(0, r.width - 20);
      const hh = Math.max(0, r.height - 20);
      const k = Math.min(w / this.b.img.w, hh / this.b.img.h);
      this.board.style.width = `${this.b.img.w * k}px`;
      this.board.style.height = `${this.b.img.h * k}px`;
    };
    this.ro = new ResizeObserver(() => this.fit());
    this.ro.observe(wrap);
    this.panel = h('<div class="ks-panel"><div class="ks-die"></div><button class="btn primary ks-roll" hidden>Бросить кубик</button></div>');
    ctx.controls.appendChild(this.panel);
    (this.panel.querySelector('.ks-roll') as HTMLButtonElement).onclick = () => this.roll();
    this.board.addEventListener('click', () => this.actSeat != null && this.roll());
  }

  private roll() {
    if (this.actSeat == null) return;
    const seat = this.actSeat;
    this.actSeat = null;
    (this.panel.querySelector('.ks-roll') as HTMLButtonElement).hidden = true;
    Sound.unlock();
    this.ctx.act(seat, { type: 'roll' });
  }

  private die(n: number | null) {
    const el = this.panel.querySelector('.ks-die') as HTMLElement;
    if (!n) return void (el.innerHTML = '');
    el.innerHTML = `<div class="ks-cube">${PIPS[n].map(([x, y]) => `<i style="left:${18 + x * 32}%;top:${18 + y * 32}%"></i>`).join('')}</div>`;
  }

  private place() {
    const v = this.v;
    const b = this.b;
    if (!v || !b) return;
    // сколько пуговиц на клетке — раздвинуть веером
    const at = new Map<number, number[]>();
    for (const s of v.seats) at.set(this.shown[s], [...(at.get(this.shown[s]) ?? []), s]);
    for (const s of v.seats) {
      let el = this.tokens.get(s);
      if (!el) {
        el = h(`<div class="ks-token" style="--c:${SEATS[s].color};--d:${SEATS[s].dark}"></div>`);
        this.board.appendChild(el);
        this.tokens.set(s, el);
      }
      const cell = b.cells[this.shown[s]];
      const group = at.get(this.shown[s])!;
      const i = group.indexOf(s);
      const off = group.length > 1 ? ((i - (group.length - 1) / 2) * b.token * 70) : 0;
      el.style.left = `${(cell.x / b.img.w) * 100 + off}%`;
      el.style.top = `${(cell.y / b.img.h) * 100 + (group.length > 1 ? (i % 2) * b.token * 30 * (b.img.w / b.img.h) : 0)}%`;
      el.classList.toggle('on', v.turn === s && v.winner == null);
    }
  }

  /** Поставить картинку поля (при первом показе и если поле другое). */
  private useBoard(map: string) {
    const b = boardOf(map);
    if (this.b === b) return;
    this.b = b;
    for (const el of this.tokens.values()) el.remove();
    this.tokens.clear();
    const img = this.board.querySelector('img') as HTMLImageElement;
    img.src = b.img.url;
    img.alt = b.title;
    this.board.style.setProperty('--tk', `${b.token * 100}%`);
    this.fit();
  }

  setView(v: State) {
    this.useBoard(v.map);
    this.v = v;
    this.shown = v.pos.slice();
    this.die(v.last);
    this.place();
  }

  async play(events: Event[], v: State) {
    const speed = this.ctx.speed();
    for (const ev of events) {
      if (ev.type === 'roll') {
        Sound.shuffle();
        for (let i = 0; i < 6; i++) {
          this.die(1 + Math.floor(Math.random() * 6));
          await sleep(55 / speed);
        }
        this.die(ev.die);
        await sleep(200 / speed);
      } else if (ev.type === 'move') {
        for (const p of ev.path) {
          this.shown[ev.seat] = p;
          this.place();
          Sound.step();
          await sleep(170 / speed);
        }
      } else if (ev.type === 'sign') {
        await sleep(250 / speed);
        this.shown[ev.seat] = ev.to;
        this.place();
        if (ev.sign.k === 'again' || (ev.sign.k === 'jump' && ev.sign.good)) Sound.jump();
        else Sound.nomove();
        await sleep(450 / speed);
      } else if (ev.type === 'win') Sound.win();
    }
    this.useBoard(v.map);
    this.v = v;
    this.shown = v.pos.slice();
    this.place();
  }

  setTurn(toAct: number[], interactive: number[]) {
    const v = this.v;
    this.actSeat = v && v.winner == null ? (interactive.find((x) => x === v.turn) ?? null) : null;
    (this.panel.querySelector('.ks-roll') as HTMLButtonElement).hidden = this.actSeat == null;
    this.place();
  }

  status(v: State, toAct: number[], interactive: number[]) {
    if (v.winner != null) return `${this.ctx.name(v.winner)}: ${boardOf(v.map).winText}!`;
    return interactive.includes(toAct[0]) ? 'Бросайте кубик' : `Бросает ${this.ctx.name(toAct[0])}…`;
  }

  playerStats(v: State, seat: number) {
    return `${v.pos[seat]} / ${boardOf(v.map).cells.length - 1}${v.skip[seat] ? ' · пропуск' : ''}`;
  }

  destroy() {
    this.ro.disconnect();
  }
}

export function createView(): GameView<State, Event> {
  return new HodilkiView();
}

