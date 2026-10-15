/* Людо и парчис — отрисовка: доска «печать по картону» (boards.ts), фишки-картинки (tools/boards/ludo.py) слоем поверх,
 * свой двор — снизу; один кубик в лотке. Ход — касание подсвеченной фишки; ход фишки показывается по клеткам. */
import { Sound } from '../../core/audio';
import { DiceTray } from '../../core/dice';
import { h, sleep, touchScreen } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { geoFor, type BoardGeo, type Pt } from './boards';
import { goalOf, legalMoves, type LEvent, type LState } from './engine';
import './ludo.css';

const TEX = `${import.meta.env.BASE_URL}tex/ludo/`;

export class LudoView implements GameView<LState, LEvent> {
  private ctx!: ViewCtx;
  private svg!: SVGSVGElement;
  private gBoard!: SVGGElement;
  private gPieces!: SVGGElement;
  private tray!: DiceTray;
  private rollBtn!: HTMLButtonElement;
  private s: LState | null = null;
  private geo: BoardGeo | null = null;
  private kindKey = '';
  /** Поворот доски (четверти по часовой). */
  private rot = 0;
  private els = new Map<string, SVGGElement>();
  private rollSeat: number | null = null;
  private autoTimer: ReturnType<typeof setTimeout> | undefined;
  private onKey = (e: KeyboardEvent) => {
    if (e.code !== 'Space' || this.rollBtn.disabled || !this.rollBtn.isConnected) return;
    const t = e.target as HTMLElement;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    e.preventDefault();
    this.roll();
  };

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    const wrap = h(`<div class="ld-wrap"><svg class="ld-board" xmlns="http://www.w3.org/2000/svg"><g class="ld-g"></g><g class="ld-p"></g></svg></div>`);
    root.appendChild(wrap);
    this.svg = wrap.querySelector('svg') as SVGSVGElement;
    this.gBoard = this.svg.querySelector('.ld-g') as SVGGElement;
    this.gPieces = this.svg.querySelector('.ld-p') as SVGGElement;
    const ctl = h(`<div class="sb-controls">
        <div class="sb-tray ld-tray"></div>
        ${ctx.demo ? '' : `<button class="btn primary sb-roll" data-tap disabled>Бросить кубик</button><div class="hint small-hint">${touchScreen() ? 'Бросок — кнопкой или тапом по доске.' : 'Пробел — бросок.'} Ход — касание подсвеченной фишки.</div>`}
      </div>`);
    ctx.controls.appendChild(ctl);
    this.tray = new DiceTray(ctl.querySelector('.sb-tray') as HTMLElement);
    this.tray.dice[1].wrap.style.display = 'none';
    this.rollBtn = (ctl.querySelector('.sb-roll') as HTMLButtonElement) || document.createElement('button');
    this.rollBtn.onclick = () => this.roll();
    this.gPieces.addEventListener('click', (e) => {
      const el = (e.target as Element).closest('[data-move]') as SVGGElement | null;
      const s = this.s;
      if (!el || !s) return;
      e.preventDefault();
      e.stopPropagation();
      const seat = s.seats[s.cur];
      const piece = Number(el.dataset.move); // до clearTurn — он стирает метки
      this.clearTurn();
      Sound.unlock();
      this.ctx.act(seat, { type: 'move', piece });
    });
    if (!ctx.demo) document.addEventListener('keydown', this.onKey);
    for (let i = 0; i < 4; i++) for (const f of ['pawn', 'disc']) new Image().src = `${TEX}${f}${i}.webp`;
  }

  /** Точка доски → экран (поворот вокруг центра на rot четвертей по часовой). */
  private screen(p: Pt): Pt {
    const g = this.geo!;
    const c = g.size / 2;
    let [x, y] = [p[0] - c, p[1] - c];
    for (let i = 0; i < this.rot; i++) [x, y] = [-y, x];
    return [x + c, y + c];
  }

  private bottomSeat(s: LState): number {
    const mine = this.ctx.mySeats.filter((x) => s.seats.includes(x));
    return mine.length ? mine[0] : s.seats[0];
  }

  private build(s: LState) {
    const g = geoFor(s.cfg.kind);
    this.geo = g;
    const me = this.bottomSeat(s);
    // свой двор — в квадрант myQuad: четверти по часовой — +1
    this.rot = (((g.myQuad - g.quad[me]) % 4) + 4) % 4;
    const pad = 0.6;
    this.svg.setAttribute('viewBox', `${-pad} ${-pad} ${g.size + pad * 2} ${g.size + pad * 2}`);
    const c = g.size / 2;
    this.gBoard.setAttribute('transform', `rotate(${this.rot * 90} ${c} ${c})`);
    this.gBoard.innerHTML = g.svg();
    this.gPieces.innerHTML = '';
    this.els.clear();
    for (const seat of s.seats)
      for (let i = 0; i < 4; i++) {
        const el = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        el.setAttribute('class', 'ld-pc');
        const d = g.piece * (s.cfg.kind === 'ludo' ? 1.25 : 1.2);
        el.innerHTML = `<circle class="ld-ring" r="${g.piece * 0.62}"/><image href="${TEX}${s.cfg.kind === 'ludo' ? 'pawn' : 'disc'}${seat}.webp" x="${-d / 2}" y="${-d / 2}" width="${d}" height="${d}"/>`;
        this.gPieces.appendChild(el);
        this.els.set(`${seat}:${i}`, el);
      }
  }

  private place(s: LState, anim = false) {
    const g = this.geo!;
    const k = s.cfg.kind;
    // сколько фишек на одном месте — чтобы не накрывали друг друга
    const groups = new Map<string, string[]>();
    for (const seat of s.seats)
      s.pieces[seat].forEach((p, i) => {
        if (p < 0 || p >= goalOf(k)) return;
        const key = g.spot(seat, p, 0, 0, 1).map((v) => v.toFixed(2)).join(',');
        const list = groups.get(key) ?? [];
        list.push(`${seat}:${i}`);
        groups.set(key, list);
      });
    for (const seat of s.seats)
      s.pieces[seat].forEach((p, i) => {
        const id = `${seat}:${i}`;
        const key = g.spot(seat, p, 0, 0, 1).map((v) => v.toFixed(2)).join(',');
        const grp = groups.get(key);
        const pt = this.screen(g.spot(seat, p, i, grp ? grp.indexOf(id) : 0, grp ? grp.length : 1));
        const el = this.els.get(id)!;
        el.classList.toggle('anim', anim);
        el.style.transform = `translate(${pt[0]}px, ${pt[1]}px)`;
      });
  }

  setView(s: LState) {
    const key = `${s.cfg.kind}:${s.seats.join(',')}:${this.ctx.mySeats.join(',')}`;
    if (key !== this.kindKey) {
      this.kindKey = key;
      this.build(s);
    }
    this.s = s;
    this.place(s);
    this.tray.show(s.phase === 'move' && s.die ? [s.die, 0] : null, [false, true]);
  }

  async play(events: LEvent[], v: LState) {
    const sp = this.ctx.speed();
    this.clearTurn();
    for (const ev of events) {
      if (ev.type === 'roll') {
        await this.tray.roll([ev.die, 0], sp);
        if (ev.noMoves) {
          Sound.nomove();
          await sleep(650 / sp);
          this.tray.show(null, [true, true]);
        }
        if (ev.penalty && this.s) {
          const s = { ...this.s, pieces: this.s.pieces.map((x) => x.slice()) };
          s.pieces[ev.penalty.seat][ev.penalty.piece] = -1;
          this.s = s;
          Sound.capture();
          this.place(s, true);
          await sleep(400 / sp);
        }
      } else if (this.s) {
        // по клеткам
        const s = { ...this.s, pieces: this.s.pieces.map((x) => x.slice()) };
        const path = ev.from < 0 ? [ev.to] : Array.from({ length: ev.to - ev.from }, (_, i) => ev.from + i + 1);
        for (const p of path) {
          s.pieces[ev.seat][ev.piece] = p;
          this.place(s, true);
          Sound.step();
          await sleep(Math.max(60, 150 / sp));
        }
        if (ev.captured.length) {
          await sleep(120 / sp);
          for (const c of ev.captured) s.pieces[c.seat][c.piece] = -1;
          Sound.capture();
          this.place(s, true);
          await sleep(350 / sp);
        }
        if (ev.win) Sound.win();
        this.s = s;
      }
    }
    this.s = v;
    this.place(v);
    this.tray.show(v.phase === 'move' && v.die ? [v.die, 0] : null, [false, true]);
  }

  private clearTurn() {
    clearTimeout(this.autoTimer);
    this.rollBtn.disabled = true;
    this.rollBtn.classList.remove('pulse');
    this.rollSeat = null;
    for (const el of this.els.values()) {
      el.classList.remove('can');
      delete el.dataset.move;
    }
  }

  setTurn(_toAct: number[], interactive: number[]) {
    this.clearTurn();
    const s = this.s;
    if (!s || s.phase === 'over' || this.ctx.demo) return;
    const seat = s.seats[s.cur];
    if (!interactive.includes(seat)) return;
    if (s.phase === 'roll') {
      this.rollSeat = seat;
      this.rollBtn.disabled = false;
      this.rollBtn.classList.add('pulse');
      return;
    }
    const moves = legalMoves(s);
    for (const m of moves) {
      const el = this.els.get(`${seat}:${m.piece}`);
      if (!el) continue;
      el.classList.add('can');
      el.dataset.move = String(m.piece);
    }
    // одна фишка может ходить (или все ходы одинаковы — со двора) — сам
    const same = new Set(moves.map((m) => `${m.from}>${m.to}`));
    if (this.ctx.autoSingle() && same.size === 1 && moves.length) {
      this.autoTimer = setTimeout(() => {
        if (this.s === s) {
          this.clearTurn();
          this.ctx.act(seat, { type: 'move', piece: moves[0].piece });
        }
      }, 450 / this.ctx.speed());
    }
  }

  private roll() {
    if (this.rollSeat == null) return;
    Sound.unlock();
    const seat = this.rollSeat;
    this.clearTurn();
    this.ctx.act(seat, { type: 'roll' });
  }

  status(s: LState, _toAct: number[], interactive: number[]) {
    if (s.phase === 'over') return s.winner != null ? `Победа: ${this.ctx.name(s.winner)}!` : 'Партия окончена';
    const seat = s.seats[s.cur];
    const who = this.ctx.name(seat);
    if (!interactive.includes(seat)) return s.phase === 'roll' ? `${who} бросает…` : `${who} ходит…`;
    if (s.phase === 'roll') return `Ход: ${who} — бросайте кубик`;
    return s.bonus.length ? `${who}: бонус — ${s.bonus[0]} клеток любой фишкой` : `${who}: ходите на ${s.value}`;
  }

  playerStats(s: LState, seat: number) {
    const p = s.pieces[seat];
    if (!p?.length) return '';
    const goal = goalOf(s.cfg.kind);
    return `<span title="Дошли">🏁 ${p.filter((x) => x >= goal).length}</span><span title="Во дворе">⬤ ${p.filter((x) => x < 0).length}</span>`;
  }

  destroy() {
    clearTimeout(this.autoTimer);
    document.removeEventListener('keydown', this.onKey);
  }
}
