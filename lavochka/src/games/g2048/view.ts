/* «2048» — отрисовка: чистая доска с ровными плитками, счёт и рекорд; плитки едут, сложенные «прыгают», новые проявляются.
 * Управление — стрелки / WASD или проведение пальцем по доске. Наперегонки — свои доски маленькими рядом. */
import { Sound } from '../../core/audio';
import { store } from '../../core/settings';
import { h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { boardOf, race, type Action, type Board, type Dir, type Event, type State } from './engine';
import './g2048.css';

const KEYS: Record<string, Dir> = { ArrowUp: 0, KeyW: 0, ArrowRight: 1, KeyD: 1, ArrowDown: 2, KeyS: 2, ArrowLeft: 3, KeyA: 3 };

const tileClass = (v: number) => (v === -1 ? 'stone' : v > 2048 ? 'super' : 'v' + v);
const digits = (v: number) => String(v).length;

class G2048View implements GameView<State, Event> {
  private ctx!: ViewCtx<Action>;
  private root!: HTMLElement;
  private wrap!: HTMLElement;
  private boardEl!: HTMLElement;
  private bg!: HTMLElement;
  private layer!: HTMLElement;
  private scoreEl!: HTMLElement;
  private bestEl!: HTMLElement;
  private others!: HTMLElement;
  private btns!: HTMLElement;
  private tiles = new Map<number, HTMLElement>();
  private s: State | null = null;
  private n = 0;
  private actSeat: number | null = null;
  private ro: ResizeObserver | null = null;
  private onKey = (e: KeyboardEvent) => this.key(e);
  private swipe: { x: number; y: number; id: number } | null = null;

  mount(root: HTMLElement, ctx: ViewCtx<Action>) {
    this.ctx = ctx;
    this.root = root;
    const wrap = h(`<div class="g2-wrap">
      <div class="g2-main">
        <div class="g2-head"><div class="g2-logo">2048<small>подметай и складывай</small></div><div class="g2-box"><small>счёт</small><b data-x="score">0</b></div><div class="g2-box"><small>рекорд</small><b data-x="best">0</b></div></div>
        <div class="g2-board"><div class="g2-bg"></div><div class="g2-tiles"></div><div class="g2-over" hidden></div></div>
      </div>
      <div class="g2-others"></div>
    </div>`);
    root.appendChild(wrap);
    this.wrap = wrap;
    this.boardEl = wrap.querySelector('.g2-board') as HTMLElement;
    this.bg = wrap.querySelector('.g2-bg') as HTMLElement;
    this.layer = wrap.querySelector('.g2-tiles') as HTMLElement;
    this.scoreEl = wrap.querySelector('[data-x=score]') as HTMLElement;
    this.bestEl = wrap.querySelector('[data-x=best]') as HTMLElement;
    this.others = wrap.querySelector('.g2-others') as HTMLElement;
    this.btns = h(`<div class="g2-btns"></div>`);
    if (!ctx.demo) {
      ctx.controls.appendChild(this.btns);
      ctx.controls.appendChild(h(`<div class="hint small-hint">Стрелки или W A S D; на телефоне — проведите пальцем по доске.</div>`));
      window.addEventListener('keydown', this.onKey);
    }
    this.boardEl.addEventListener('pointerdown', (e) => {
      this.swipe = { x: e.clientX, y: e.clientY, id: e.pointerId };
    });
    this.boardEl.addEventListener('pointerup', (e) => {
      const sw = this.swipe;
      this.swipe = null;
      if (!sw || sw.id !== e.pointerId) return;
      const dx = e.clientX - sw.x;
      const dy = e.clientY - sw.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
      this.move(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : dy > 0 ? 2 : 0);
    });
    this.ro = new ResizeObserver(() => this.fit());
    this.ro.observe(root);
  }

  destroy() {
    window.removeEventListener('keydown', this.onKey);
    this.ro?.disconnect();
  }

  private key(e: KeyboardEvent) {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const d = KEYS[e.code];
    if (d == null) return;
    e.preventDefault();
    this.move(d);
  }

  private move(dir: Dir) {
    const b = this.board();
    if (this.actSeat == null || !b || b.over || this.s?.done) return;
    Sound.unlock();
    this.ctx.act(this.actSeat, { type: 'move', dir });
  }

  private boardIndex(s: State) {
    const me = this.ctx.mySeats.find((x) => s.seats.includes(x));
    return me != null ? boardOf(s, me) : 0;
  }

  private board(): Board | null {
    return this.s ? this.s.boards[this.boardIndex(this.s)] : null;
  }

  // ------------------------------------------------------------ раскладка

  private fit() {
    const s = this.s;
    if (!s) return;
    const W = this.root.clientWidth || 500;
    const H = this.root.clientHeight || 500;
    const side = Math.max(200, Math.min(560, W - 32, H - 110 - (race(s) ? 40 : 0)));
    const n = s.cfg.n;
    const gap = Math.round(side * (n > 4 ? 0.022 : 0.03));
    const cell = (side - gap * (n + 1)) / n;
    this.wrap.style.setProperty('--side', side + 'px');
    this.wrap.style.setProperty('--gap', gap + 'px');
    this.wrap.style.setProperty('--cell', cell + 'px');
    this.place();
  }

  private pos(i: number) {
    const n = this.s!.cfg.n;
    return `translate(calc(var(--gap) + ${i % n} * (var(--cell) + var(--gap))), calc(var(--gap) + ${Math.floor(i / n)} * (var(--cell) + var(--gap))))`;
  }

  private build() {
    const n = this.s!.cfg.n;
    if (n === this.n) return;
    this.n = n;
    this.bg.innerHTML = '';
    for (let i = 0; i < n * n; i++) {
      const d = document.createElement('div');
      d.className = 'g2-cell';
      d.style.transform = this.pos(i);
      this.bg.appendChild(d);
    }
    this.layer.innerHTML = '';
    this.tiles.clear();
    this.fit();
  }

  private tileEl(v: number): HTMLElement {
    const d = document.createElement('div');
    d.className = `g2-tile ${tileClass(v)} d${Math.min(5, digits(v))}`;
    d.textContent = v > 0 ? String(v) : '';
    return d;
  }

  /** Привести плитки к доске: новые — создать (с проявлением или «прыжком»), исчезнувшие — убрать. */
  private place(fresh?: { spawn: number; merges: number[] }) {
    const b = this.board();
    if (!b) return;
    const seen = new Set<number>();
    b.cells.forEach((v, i) => {
      const id = v === -1 ? -(i + 1) : b.ids[i];
      if (!v || !id) return;
      seen.add(id);
      let el = this.tiles.get(id);
      if (!el) {
        el = this.tileEl(v);
        if (fresh?.merges.includes(i)) el.classList.add('merged');
        else if (fresh && fresh.spawn === i) el.classList.add('new');
        this.tiles.set(id, el);
        this.layer.appendChild(el);
      }
      el.style.transform = this.pos(i);
    });
    for (const [id, el] of this.tiles)
      if (!seen.has(id)) {
        el.remove();
        this.tiles.delete(id);
      }
    this.drawHead();
  }

  private drawHead() {
    const s = this.s!;
    const b = this.board()!;
    this.scoreEl.textContent = String(b.score);
    const key = `g2048.best.${s.cfg.n}.${s.cfg.stones}`;
    let best = this.ctx.demo ? b.score : Number(store.get(key, 0)) || 0;
    if (b.score > best && !this.ctx.demo) {
      best = b.score;
      store.set(key, best);
    }
    this.bestEl.textContent = String(Math.max(best, b.score));
    const over = this.boardEl.querySelector('.g2-over') as HTMLElement;
    const msg = b.won ? `${s.cfg.target}!` : b.over ? 'Ходов нет' : '';
    over.hidden = !msg;
    over.textContent = msg;
    over.classList.toggle('won', b.won);
    this.drawOthers();
  }

  private drawOthers() {
    const s = this.s!;
    const mine = this.boardIndex(s);
    if (!race(s)) {
      this.others.innerHTML = '';
      return;
    }
    const n = s.cfg.n;
    this.others.innerHTML = s.boards
      .map((b, k) =>
        k === mine
          ? ''
          : `<div class="g2-mini" style="--n:${n}"><div class="g">${b.cells.map((v) => `<i class="${v ? tileClass(v) : ''}"></i>`).join('')}</div><span>${this.ctx.name(s.seats[k])} · ${b.score}${b.over ? (b.won ? ' 🏆' : ' · всё') : ''}</span></div>`,
      )
      .join('');
  }

  private drawBtns() {
    this.btns.innerHTML = '';
    const s = this.s;
    const b = this.board();
    if (!s || !b || this.ctx.demo || this.actSeat == null || !s.cfg.undo || race(s) || s.done) return;
    const u = h<HTMLButtonElement>(`<button class="btn small"${b.undo ? '' : ' disabled'}>↶ Отменить ход</button>`);
    u.onclick = () => this.actSeat != null && this.ctx.act(this.actSeat, { type: 'undo' });
    this.btns.appendChild(u);
  }

  // ------------------------------------------------------------ GameView

  setView(s: State) {
    this.s = s;
    this.build();
    this.place();
    this.drawBtns();
  }

  async play(events: Event[], s: State) {
    const mine = this.boardIndex(s);
    let fresh: { spawn: number; merges: number[] } | undefined;
    let gain = 0;
    for (const ev of events) {
      if (ev.type === 'move' && ev.b === mine) {
        // сначала доехать старыми плитками, потом показать сложенные и новую
        for (const sl of ev.slides) {
          const el = this.tiles.get(sl.id);
          if (el) el.style.transform = this.pos(sl.to);
        }
        fresh = { spawn: ev.spawn, merges: ev.merges };
        gain += ev.gain;
      }
      if (ev.type === 'undo' && ev.b === mine) {
        // отмена: плитки вернулись — перерисовать с нуля
        this.layer.innerHTML = '';
        this.tiles.clear();
      }
    }
    if (fresh) {
      Sound.step();
      await sleep(this.ctx.demo ? 260 / this.ctx.speed() : 105);
    }
    this.s = s;
    this.build();
    this.place(fresh);
    this.drawBtns();
    if (gain) Sound.place();
    if (events.some((e) => e.type === 'target' && e.b === mine)) Sound.win();
    else if (events.some((e) => e.type === 'stuck' && e.b === mine)) Sound.nomove();
    if (this.ctx.demo && fresh) await sleep(500 / this.ctx.speed());
  }

  setTurn(toAct: number[], interactive: number[]) {
    this.actSeat = this.ctx.demo ? null : (interactive.find((x) => toAct.includes(x)) ?? null);
    this.drawBtns();
  }

  status(s: State) {
    if (s.done) return '';
    const b = s.boards[this.boardIndex(s)];
    if (b.over) return 'Ходов больше нет — ждём остальных';
    const goal = s.cfg.target ? `цель — ${s.cfg.target}` : 'без конца';
    return race(s) ? `Наперегонки, ${goal}` : `Лучшая плитка: ${b.top} · ${goal}`;
  }

  playerStats(s: State, seat: number) {
    const b = s.boards[boardOf(s, seat)];
    return b ? `<span>очков: <b>${b.score}</b> · плитка ${b.top}</span>` : '';
  }
}

export function createView(): GameView<State, Event> {
  return new G2048View();
}
