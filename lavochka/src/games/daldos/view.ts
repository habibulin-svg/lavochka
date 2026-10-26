/* Далдос — отрисовка: доска-лодка (картинка tools/daldos), лунки — SVG поверх неё, фишки-спрайты стоят в лунках.
 * Недаленная фишка стоит поперёк ряда, надаленная — вдоль: у лопатки это видно сразу (ребро или широкая сторона).
 * На узком экране лодка встаёт носом вверх. Ход — касание подсвеченной фишки, затем лунки, куда её поставить. */
import { Sound } from '../../core/audio';
import { Zoom } from '../../core/zoom';
import { h, sleep, touchScreen } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { face } from './def';
import { colOf, holes, legalMoves, rowOf, tally, type Event, type Move, type Peg, type State } from './engine';
import './daldos.css';

const TEX = `${import.meta.env.BASE_URL}tex/daldos/`;
const NS = 'http://www.w3.org/2000/svg';
/** Картинка доски (board.webp) и лунки на ней: столбец 0 у кормы, ряд 0 — снизу. */
const BW = 1400;
const BH = 439;
const MID = 219;
const GEO = { dk: { x0: 240, s: 61, dy: 82, r: 15 }, no: { x0: 262, s: 80, dy: 84, r: 17 } };
/** Спрайты фишек: [ширина, высота] картинки. */
const SPR: Record<string, [number, number]> = { p0: [97, 220], p0e: [52, 220], p1: [65, 220], p1e: [61, 220] };

type Pt = [number, number];

export class DaldosView implements GameView<State, Event> {
  private ctx!: ViewCtx;
  private wrap!: HTMLElement;
  private svg!: SVGSVGElement;
  private gBoard!: SVGGElement;
  private gTargets!: SVGGElement;
  private gPieces!: SVGGElement;
  private dieEls: HTMLElement[] = [];
  private trayVal!: HTMLElement;
  private rollBtn!: HTMLButtonElement;
  private s: State | null = null;
  private key = '';
  private vertical = false;
  private flip = false;
  private els = new Map<number, SVGGElement>();
  private moves: Move[] = [];
  private rollSeat: number | null = null;
  private ro: ResizeObserver | null = null;
  private onKey = (e: KeyboardEvent) => {
    if (e.code !== 'Space' || this.rollBtn.disabled || !this.rollBtn.isConnected) return;
    const t = e.target as HTMLElement;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    e.preventDefault();
    this.roll();
  };

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    this.wrap = h(`<div class="dl-wrap"><svg class="dl-board" xmlns="${NS}" preserveAspectRatio="xMidYMid meet"><g class="dl-g"></g><g class="dl-p"></g><g class="dl-t"></g></svg></div>`);
    root.appendChild(this.wrap);
    this.svg = this.wrap.querySelector('svg') as SVGSVGElement;
    new Zoom(this.wrap, this.svg, { demo: ctx.demo });
    this.gBoard = this.svg.querySelector('.dl-g') as SVGGElement;
    this.gPieces = this.svg.querySelector('.dl-p') as SVGGElement;
    this.gTargets = this.svg.querySelector('.dl-t') as SVGGElement;
    const ctl = h(`<div class="dl-controls">
        <div class="dl-tray">${[0, 1].map(() => `<div class="dl-die blank"><img src="${TEX}die.webp" alt=""><span class="dl-mark"></span></div>`).join('')}</div>
        <div class="dl-val"></div>
        ${ctx.demo ? '' : `<button class="btn primary dl-roll" data-tap disabled>Бросить</button><div class="hint small-hint">${touchScreen() ? 'Бросок — кнопкой или тапом по доске.' : 'Пробел — бросок.'} Нажмите на подсвеченную фишку, затем на лунку.</div>`}
      </div>`);
    ctx.controls.appendChild(ctl);
    this.dieEls = [...ctl.querySelectorAll<HTMLElement>('.dl-die')];
    this.trayVal = ctl.querySelector('.dl-val') as HTMLElement;
    this.rollBtn = (ctl.querySelector('.dl-roll') as HTMLButtonElement) || document.createElement('button');
    this.rollBtn.onclick = () => this.roll();
    this.gPieces.addEventListener('click', (e) => {
      const el = (e.target as Element).closest('[data-c]') as SVGGElement | null;
      if (!el || !this.moves.length) return;
      e.stopPropagation();
      this.pick(Number(el.dataset.c));
    });
    this.gTargets.addEventListener('click', (e) => {
      const el = (e.target as Element).closest('[data-i]') as SVGGElement | null;
      if (!el || !this.s) return;
      e.stopPropagation();
      const m = this.moves[Number(el.dataset.i)];
      const seat = this.s.turn;
      this.clearTurn();
      Sound.unlock();
      this.ctx.act(seat, { type: 'move', from: m.from, to: m.to, use: m.use });
    });
    if (!ctx.demo) document.addEventListener('keydown', this.onKey);
    this.ro = new ResizeObserver(() => {
      if (!this.s) return;
      const v = this.isVertical();
      if (v !== this.vertical) this.setView(this.s);
    });
    this.ro.observe(this.wrap);
    for (const k of Object.keys(SPR)) new Image().src = `${TEX}${k}.webp`;
  }

  // ---------------------------------------------------------------- геометрия

  private isVertical() {
    const r = this.wrap.getBoundingClientRect();
    return r.height > r.width * 1.1;
  }

  /** Точка картинки доски → экран (поворот лодки и разворот к своему ряду). */
  private T([x, y]: Pt): Pt {
    if (!this.vertical) return this.flip ? [BW - x, BH - y] : [x, y];
    return this.flip ? [BH - y, x] : [y, BW - x];
  }

  private matrix() {
    if (!this.vertical) return this.flip ? `matrix(-1,0,0,-1,${BW},${BH})` : '';
    return this.flip ? `matrix(0,1,-1,0,${BH},0)` : `matrix(0,-1,1,0,0,${BW})`;
  }

  /** Центр лунки на картинке доски. */
  private hole(s: State, cell: number): Pt {
    const g = GEO[s.cfg.size];
    const row = rowOf(s.cfg, cell);
    return [g.x0 + colOf(s.cfg, cell) * g.s, MID + (1 - row) * g.dy];
  }

  private build(s: State) {
    const g = GEO[s.cfg.size];
    const H = holes(s.cfg);
    if (this.vertical) this.svg.setAttribute('viewBox', `-40 -70 ${BH + 80} ${BW + 90}`);
    else this.svg.setAttribute('viewBox', `-10 -40 ${BW + 20} ${BH + 60}`);
    const parts: string[] = [];
    parts.push(`<defs>
      <radialGradient id="dl-hole" cx="50%" cy="42%" r="60%"><stop offset="0" stop-color="#140904"/><stop offset="0.65" stop-color="#2b1607"/><stop offset="1" stop-color="#6a3c16"/></radialGradient>
      <filter id="dl-sh" x="-5%" y="-10%" width="110%" height="130%"><feDropShadow dx="0" dy="10" stdDeviation="9" flood-opacity="0.5"/></filter>
    </defs>`);
    parts.push(`<g transform="${this.matrix()}"><image href="${TEX}board.webp" width="${BW}" height="${BH}" filter="url(#dl-sh)"/>`);
    for (let row = 0; row < 3; row++)
      for (let col = 0; col < (row === 1 ? H + 1 : H); col++) {
        const [x, y] = [g.x0 + col * g.s, MID + (1 - row) * g.dy];
        parts.push(`<circle cx="${x}" cy="${y}" r="${g.r + 2}" fill="#f2c98a" opacity="0.35"/><circle cx="${x}" cy="${y + 1}" r="${g.r}" fill="url(#dl-hole)"/>`);
      }
    parts.push('</g>');
    this.gBoard.innerHTML = parts.join('');
  }

  /** Спрайт фишки: недаленная стоит поперёк ряда, надаленная — вдоль; камера смотрит поперёк рядов (на вертикальной доске — вдоль). */
  private sprite(p: Peg): string {
    const along = p.dal !== this.vertical; // к камере широкой стороной
    return `p${p.seat}${along ? '' : 'e'}`;
  }

  private pieceHtml(s: State, p: Peg) {
    const g = GEO[s.cfg.size];
    const name = this.sprite(p);
    const [w0, h0] = SPR[name];
    const hh = g.s * 1.8;
    // ребро обелиска почти не уже его грани — сужаем, чтобы разворот был виден
    const w = (w0 / h0) * hh * (name === 'p1e' ? 0.62 : 1);
    const ring = name.endsWith('e') ? `rx="${g.r * 0.7}" ry="${g.r * 1.05}"` : `rx="${g.r * 1.25}" ry="${g.r * 0.7}"`;
    return `<ellipse class="dl-ring" cx="0" cy="2" ${ring}/><image href="${TEX}${name}.webp" x="${-w / 2}" y="${-hh * 0.9}" width="${w}" height="${hh}" preserveAspectRatio="none"/>`;
  }

  private renderPieces(s: State) {
    this.gPieces.innerHTML = '';
    this.els.clear();
    s.board.forEach((p, cell) => {
      if (!p) return;
      const el = document.createElementNS(NS, 'g') as SVGGElement;
      el.setAttribute('class', `dl-pc dl-s${p.seat}`);
      el.dataset.c = String(cell);
      el.innerHTML = this.pieceHtml(s, p);
      this.moveEl(el, s, cell);
      this.els.set(cell, el);
    });
    this.order();
  }

  private moveEl(el: SVGGElement, s: State, cell: number) {
    const [x, y] = this.T(this.hole(s, cell));
    el.style.transform = `translate(${x}px, ${y}px)`;
    el.dataset.y = String(y);
  }

  /** Ближние фишки — поверх дальних. */
  private order() {
    [...this.els.values()].sort((a, b) => Number(a.dataset.y) - Number(b.dataset.y)).forEach((el) => this.gPieces.appendChild(el));
  }

  setView(s: State) {
    this.vertical = this.isVertical();
    this.flip = this.ctx.mySeats.includes(1) && !this.ctx.mySeats.includes(0);
    const key = `${s.cfg.size}:${this.vertical}:${this.flip}`;
    if (key !== this.key) {
      this.key = key;
      this.build(s);
    }
    this.s = s;
    this.renderPieces(s);
    this.showDice(s, s.phase === 'move' ? s.dice : null, s.used);
  }

  // ---------------------------------------------------------------- кости

  private showDice(s: State, dice: number[] | null, used: boolean[]) {
    this.dieEls.forEach((el, i) => {
      const v = dice?.[i] ?? 0;
      (el.querySelector('.dl-mark') as HTMLElement).textContent = v ? face(v, s.cfg) : '';
      el.classList.toggle('blank', !v);
      el.classList.toggle('dal', v === 1);
      el.classList.toggle('used', !!dice && !!used[i]);
    });
    this.trayVal.textContent = dice ? (dice[0] === 1 && dice[1] === 1 ? 'дал-дал — ещё бросок!' : dice.join(' + ').replace(/\b1\b/g, 'дал')) : '';
  }

  private async rollAnim(s: State, dice: number[], sp: number) {
    const dur = Math.round(900 / Math.max(0.5, sp));
    Sound.diceRoll(dur / 1000);
    this.dieEls.forEach((el, i) => {
      const dx = (Math.random() * 40 - 20) * (i ? 1 : -1);
      el.animate(
        [
          { transform: `translate(${-80 + dx}px, -40px) rotate(${-160 + i * 50}deg)`, offset: 0 },
          { transform: `translate(${-16 + dx / 2}px, 6px) rotate(-40deg)`, offset: 0.55 },
          { transform: `translate(${dx * 0.1}px, -4px) rotate(-6deg)`, offset: 0.8 },
          { transform: 'translate(0, 0) rotate(0deg)', offset: 1 },
        ],
        { duration: dur, easing: 'cubic-bezier(.25,.7,.35,1)' },
      );
    });
    const t0 = performance.now();
    while (performance.now() - t0 < dur * 0.7) {
      this.showDice(s, dice.map(() => 1 + Math.floor(Math.random() * 4)), [false, false]);
      this.trayVal.textContent = '';
      await sleep(90);
    }
    await sleep(dur * 0.3);
    this.showDice(s, dice, [false, false]);
  }

  // ---------------------------------------------------------------- ходы

  async play(events: Event[], v: State) {
    const sp = this.ctx.speed();
    this.clearTurn();
    for (const ev of events) {
      if (ev.type === 'roll') {
        if (this.s) await this.rollAnim(this.s, ev.dice, sp);
        if (ev.none) {
          Sound.nomove();
          await sleep(800 / sp);
        }
      } else if (ev.type === 'move' && this.s) {
        const s = this.s;
        const el = this.els.get(ev.from);
        if (el) {
          if (ev.dal) {
            // дал: фишку разворачивают вдоль ряда
            Sound.enter();
            el.innerHTML = this.pieceHtml(s, { seat: ev.seat, dal: true });
            await sleep(260 / sp);
          }
          el.classList.add('anim');
          this.gPieces.appendChild(el);
          for (const c of ev.path) {
            this.moveEl(el, s, c);
            Sound.step();
            await sleep(Math.max(60, 150 / sp));
          }
          el.classList.remove('anim');
          this.els.delete(ev.from);
        }
        if (ev.took.length) {
          await sleep(100 / sp);
          Sound.capture();
          for (const t of ev.took) {
            const x = this.els.get(t);
            if (x) {
              x.classList.add('gone');
              this.els.delete(t);
              setTimeout(() => x.remove(), 400);
            }
          }
          await sleep(360 / sp);
        }
        if (el) this.els.set(ev.to, el);
        this.order();
        // сыгранная кость гаснет сразу
        const used = s.used.slice();
        if (ev.dice.length === 2) used.splice(0, 2, true, true);
        else {
          const i = s.dice.findIndex((d, k) => d === ev.dice[0] && !used[k]);
          if (i >= 0) used[i] = true;
        }
        this.s = { ...s, used };
        this.showDice(s, s.dice, used);
      } else if (ev.type === 'end' && ev.winner != null) Sound.win();
    }
    this.s = v;
    this.renderPieces(v);
    this.showDice(v, v.phase === 'move' ? v.dice : null, v.used);
  }

  private clearTurn() {
    this.rollBtn.disabled = true;
    this.rollBtn.classList.remove('pulse');
    this.rollSeat = null;
    this.moves = [];
    this.gTargets.innerHTML = '';
    for (const el of this.els.values()) el.classList.remove('can', 'sel');
  }

  setTurn(_toAct: number[], interactive: number[]) {
    this.clearTurn();
    const s = this.s;
    if (!s || s.phase === 'over' || this.ctx.demo) return;
    const seat = s.turn;
    if (!interactive.includes(seat)) return;
    if (s.phase === 'roll') {
      this.rollSeat = seat;
      this.rollBtn.disabled = false;
      this.rollBtn.classList.add('pulse');
      return;
    }
    this.moves = legalMoves(s);
    const froms = new Set(this.moves.map((m) => m.from));
    for (const f of froms) this.els.get(f)?.classList.add('can');
    if (froms.size === 1) this.pick([...froms][0]);
  }

  /** Выбрали фишку — показываем лунки, куда она может встать. */
  private pick(cell: number) {
    const s = this.s!;
    const opts = this.moves.map((m, i) => [m, i] as const).filter(([m]) => m.from === cell);
    if (!opts.length) return;
    for (const el of this.els.values()) el.classList.remove('sel');
    this.els.get(cell)?.classList.add('sel');
    const g = GEO[s.cfg.size];
    const parts: string[] = [];
    const seen = new Set<number>();
    for (const [m, i] of opts) {
      if (seen.has(m.to)) continue;
      seen.add(m.to);
      const [x, y] = this.T(this.hole(s, m.to));
      const label = m.use === 2 ? `${face(s.dice[0], s.cfg)}+${face(s.dice[1], s.cfg)}` : face(s.dice[m.use], s.cfg);
      const r = g.s * 0.45;
      // подпись одной кости — над лункой, сложения — под ней: соседние лунки не слипаются
      const ty = m.use === 2 ? y + r + 26 : y - r - 8;
      parts.push(`<g class="dl-target${m.took.length ? ' hit' : ''}" data-i="${i}"><circle cx="${x}" cy="${y}" r="${r}"/><text x="${x}" y="${ty}">${label}</text></g>`);
    }
    this.gTargets.innerHTML = parts.join('');
  }

  private roll() {
    if (this.rollSeat == null) return;
    Sound.unlock();
    const seat = this.rollSeat;
    this.clearTurn();
    this.ctx.act(seat, { type: 'roll' });
  }

  status(s: State, _toAct: number[], interactive: number[]) {
    if (s.phase === 'over') return s.winner == null ? 'Ничья' : `Победа: ${this.ctx.name(s.winner)}!`;
    const who = this.ctx.name(s.turn);
    if (!interactive.includes(s.turn)) return s.phase === 'roll' ? `${who} бросает…` : `${who} ходит…`;
    if (s.phase === 'roll') return `Ход: ${who} — бросайте кости`;
    const free = s.dice.filter((_d, i) => !s.used[i]).map((d) => face(d, s.cfg));
    return `${who}: ходите (${free.join(', ')})`;
  }

  playerStats(s: State, seat: number) {
    const t = tally(s, seat);
    return `<span title="Фишек на доске">⬤ ${s.count[seat]}</span><span title="Ещё не надалены">⟂ ${t.wait}</span>`;
  }

  destroy() {
    this.ro?.disconnect();
    document.removeEventListener('keydown', this.onKey);
  }
}

export const createView = () => new DaldosView();
