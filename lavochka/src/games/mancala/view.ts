/* Манкала — отрисовка: деревянная доска, два ряда лунок (свой — снизу), дома по краям (калах) или кучки взятого (оваре).
 * Камешки — цветные бусины (до 18 видно россыпью, дальше число). Ход — касание своей лунки; раскладка показывается по камню. */
import { Sound } from '../../core/audio';
import { h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { legal, type Event, type State } from './engine';
import { SEATS } from './def';
import './mancala.css';

const COLORS = ['#c8432f', '#2f7ac8', '#e0b02a', '#3a9a52', '#8a4ac0', '#e07a2a', '#d8d0c0'];

/** Россыпь бусин в лунке (детерминированно от номера лунки и количества). */
function beads(n: number, seed: number): string {
  let out = '';
  const k = Math.min(n, 18);
  for (let i = 0; i < k; i++) {
    const a = (i * 2.399 + seed) % (Math.PI * 2);
    const r = 8 + ((i * 7 + seed * 3) % 24);
    const x = 50 + Math.cos(a) * r * (i < 1 ? 0 : 1);
    const y = 50 + Math.sin(a) * r * (i < 1 ? 0 : 1);
    out += `<i style="left:${x}%;top:${y}%;--b:${COLORS[(i + seed) % COLORS.length]}"></i>`;
  }
  return out;
}

class MancalaView implements GameView<State, Event> {
  private ctx!: ViewCtx;
  private board!: HTMLElement;
  private hint!: HTMLElement;
  private s: State | null = null;
  private actSeat: number | null = null;
  private me = 0;
  private hot = -1;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    const wrap = h('<div class="mc-wrap"><div class="mc-board"></div></div>');
    root.appendChild(wrap);
    this.board = wrap.querySelector('.mc-board') as HTMLElement;
    this.hint = h('<div class="mc-hint"></div>');
    ctx.controls.appendChild(this.hint);
    this.board.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest('[data-pit]') as HTMLElement | null;
      const s = this.s;
      if (!el || !s || this.actSeat == null) return;
      const pit = Number(el.dataset.pit);
      if (!legal(s, this.actSeat).includes(pit)) return;
      e.preventDefault();
      const seat = this.actSeat;
      this.actSeat = null;
      Sound.unlock();
      this.ctx.act(seat, { type: 'sow', pit });
    });
  }

  private draw() {
    const s = this.s;
    if (!s) return;
    const me = this.me;
    // свой ряд снизу слева направо, чужой — сверху справа налево (по ходу раскладки)
    const bottom = me === 0 ? [0, 1, 2, 3, 4, 5] : [6, 7, 8, 9, 10, 11];
    const top = me === 0 ? [11, 10, 9, 8, 7, 6] : [5, 4, 3, 2, 1, 0];
    const ok = this.actSeat != null ? legal(s, this.actSeat) : [];
    const pit = (p: number) => `<div class="mc-pit${ok.includes(p) ? ' can' : ''}${p === this.hot ? ' hot' : ''}${s.last && (s.last.captured.includes(p)) ? ' took' : ''}" data-pit="${p}"><div class="mc-beads">${beads(s.pits[p], p)}</div><b>${s.pits[p]}</b></div>`;
    const store = (seat: number) => `<div class="mc-store" style="--c:${SEATS[seat].color}"><div class="mc-beads">${beads(s.store[seat], seat + 20)}</div><b>${s.store[seat]}</b><small>${esc2(this.ctx.name(seat))}</small></div>`;
    this.board.innerHTML = `${store(1 - me)}<div class="mc-rows"><div class="mc-row">${top.map(pit).join('')}</div><div class="mc-row">${bottom.map(pit).join('')}</div></div>${store(me)}`;
    this.board.classList.toggle('oware', s.cfg.variant === 'oware');
    if (!this.ctx.demo) this.hint.textContent = this.actSeat != null ? 'Ваш ход: коснитесь своей лунки (нижний ряд).' : s.over ? 'Партия окончена.' : '';
  }

  setView(v: State) {
    this.s = v;
    this.draw();
  }

  async play(events: Event[], v: State) {
    const sp = this.ctx.speed();
    for (const ev of events) {
      if (ev.type !== 'sow' || !this.s) continue;
      // по камню: из лунки — по пути
      const cur: State = { ...this.s, pits: this.s.pits.slice(), store: [...this.s.store] as [number, number], last: null };
      cur.pits[ev.pit] = 0;
      this.s = cur;
      this.hot = ev.pit;
      this.draw();
      for (const q of ev.path) {
        await sleep(Math.max(40, 160 / sp));
        if (q === -1) cur.store[0]++;
        else if (q === -2) cur.store[1]++;
        else cur.pits[q]++;
        this.hot = q < 0 ? -1 : q;
        Sound.step();
        this.draw();
      }
      if (ev.captured.length) {
        await sleep(300 / sp);
        Sound.capture();
      }
      this.hot = -1;
    }
    this.s = v;
    this.draw();
    if (v.over) Sound.win();
  }

  setTurn(toAct: number[], interactive: number[]) {
    const s = this.s;
    const mine = this.ctx.mySeats.filter((x) => x === 0 || x === 1);
    const who = interactive.find((x) => toAct.includes(x));
    if (who != null) this.me = who;
    else if (mine.length === 1) this.me = mine[0];
    this.actSeat = s && !s.over && !this.ctx.demo ? (who ?? null) : null;
    this.draw();
  }

  status(v: State, toAct: number[], interactive: number[]) {
    if (v.over) return v.winner == null ? 'Ничья' : 'Партия окончена';
    return interactive.includes(toAct[0]) ? 'Ваш ход' : `Ходит ${this.ctx.name(toAct[0])}…`;
  }

  playerStats(v: State, seat: number) {
    return `${v.cfg.variant === 'kalah' ? 'в доме' : 'взято'}: ${v.store[seat]}`;
  }
}

const esc2 = (s: string) => s.replace(/<[^>]+>/g, '');

export function createView(): GameView<State, Event> {
  return new MancalaView();
}
