/* Морской бой — отрисовка: тетрадный лист в клеточку, поля нарисованы синей ручкой, корабли заштрихованы,
 * попадания — крестиком, промахи — точкой, вокруг потопленных — мелкие точки.
 * Расстановка: выбрать корабль в списке, навести на поле (призрак: зелёный — можно, красный — нельзя), нажать; «Повернуть» — R или правая кнопка.
 * Бой: нажать на клетку поля противника; в сальво — отметить клетки и «Залп!». Хот-сит — занавеска между ходами. */
import { Sound } from '../../core/audio';
import { h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { fits, LETTERS, N, NAMES, randomFleet, shipAt, shotsPerTurn, SIZES, type Event, type Shot, type State } from './engine';
import './seabattle.css';

const NS = 'http://www.w3.org/2000/svg';
const W = 1000;
const H = 560;
const C = 36;
const GY = 126;
const GX = [72, 558];

const rnd = { next: Math.random, int: (n: number) => Math.floor(Math.random() * n), getState: () => 0 };

class SeaView implements GameView<State, Event> {
  private ctx!: ViewCtx;
  private svg!: SVGSVGElement;
  private gField!: SVGGElement;
  private gGhost!: SVGGElement;
  private gBanner!: SVGGElement;
  private btns!: HTMLElement;
  private cover!: HTMLElement;
  private s: State | null = null;
  private viewer = 0;
  private hidden = false;
  private actSeat: number | null = null;
  // расстановка
  private draft: number[][] = [];
  private pick: number | null = null;
  private vertical = false;
  private hoverCell: number | null = null;
  // сальво
  private aim: number[] = [];

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    const wrap = h(`<div class="sb-wrap">
        <svg class="sb-board" xmlns="${NS}" viewBox="0 0 ${W} ${H}">
          <defs>
            <pattern id="sbCells" width="18" height="18" patternUnits="userSpaceOnUse"><path d="M18 0H0V18" fill="none" stroke="#9cc0dc" stroke-width=".8" opacity=".75"/></pattern>
            <pattern id="sbHatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="7" stroke="#2a4ea0" stroke-width="1.6" opacity=".55"/></pattern>
          </defs>
          <rect width="${W}" height="${H}" fill="#f6f3e8"/>
          <rect width="${W}" height="${H}" fill="url(#sbCells)"/>
          <line x1="44" y1="0" x2="44" y2="${H}" stroke="#d9605a" stroke-width="2" opacity=".7"/>
          <g class="sb-field"></g><g class="sb-ghost"></g><g class="sb-banner"></g>
        </svg>
        <div class="sb-cover" hidden><div class="sb-cover-box"><div class="sb-cover-t"></div><button class="btn primary">Я готов</button></div></div>
      </div>`);
    root.appendChild(wrap);
    this.svg = wrap.querySelector('svg') as SVGSVGElement;
    this.gField = this.svg.querySelector('.sb-field') as SVGGElement;
    this.gGhost = this.svg.querySelector('.sb-ghost') as SVGGElement;
    this.gBanner = this.svg.querySelector('.sb-banner') as SVGGElement;
    this.cover = wrap.querySelector('.sb-cover') as HTMLElement;
    (this.cover.querySelector('button') as HTMLButtonElement).onclick = () => {
      Sound.unlock();
      this.hidden = false;
      this.cover.hidden = true;
      this.draw();
      this.renderButtons();
    };
    const ctl = h(`<div class="sb-controls"><div class="sb-btns"></div></div>`);
    ctx.controls.appendChild(ctl);
    this.btns = ctl.querySelector('.sb-btns') as HTMLElement;
    this.svg.addEventListener('click', (e) => this.onClick(e));
    this.svg.addEventListener('contextmenu', (e) => {
      if (this.placing()) {
        e.preventDefault();
        this.rotate();
      }
    });
    this.svg.addEventListener('pointermove', (e) => {
      const hit = this.cellAt(e);
      const c = hit && ((this.placing() && hit.g === 0) || (this.shooting() && hit.g === 1)) ? hit.c : null;
      if (c !== this.hoverCell) {
        this.hoverCell = c;
        this.drawGhost();
      }
    });
    this.svg.addEventListener('pointerleave', () => {
      this.hoverCell = null;
      this.drawGhost();
    });
    window.addEventListener('keydown', this.onKey);
  }

  private onKey = (e: KeyboardEvent) => {
    if ((e.key === 'r' || e.key === 'R' || e.key === 'к' || e.key === 'К') && this.placing()) this.rotate();
  };

  private placing() {
    return this.actSeat != null && this.s?.phase === 'place' && !this.hidden;
  }
  private shooting() {
    return this.actSeat != null && this.s?.phase === 'battle' && !this.hidden;
  }

  private cellAt(e: MouseEvent): { g: number; c: number } | null {
    const pt = this.svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const m = this.svg.getScreenCTM();
    if (!m) return null;
    const p = pt.matrixTransform(m.inverse());
    for (let g = 0; g < 2; g++) {
      const f = Math.floor((p.x - GX[g]) / C);
      const r = Math.floor((p.y - GY) / C);
      if (f >= 0 && f < N && r >= 0 && r < N) return { g, c: r * N + f };
    }
    return null;
  }

  // ---------------------------------------------------------------- рисунок

  private xy(g: number, c: number) {
    return { x: GX[g] + (c % N) * C, y: GY + Math.floor(c / N) * C };
  }

  private grid(g: number, title: string) {
    const x0 = GX[g];
    let s = `<text class="sb-title" x="${x0 + (C * N) / 2}" y="${GY - 52}">${title}</text>`;
    for (let i = 0; i < N; i++) {
      s += `<text class="sb-hand" x="${x0 + i * C + C / 2}" y="${GY - 12}">${LETTERS[i]}</text>`;
      s += `<text class="sb-hand" x="${x0 - 16}" y="${GY + i * C + C / 2 + 7}">${i + 1}</text>`;
    }
    // линии от руки: чуть неровные
    for (let i = 0; i <= N; i++) {
      const w = i === 0 || i === N ? 2.2 : 1;
      const j = (k: number) => ((i * 7 + k * 3) % 5) / 5 - 0.4;
      s += `<path class="sb-ink" stroke-width="${w}" d="M${x0 + i * C + j(1)} ${GY - 1}L${x0 + i * C + j(2)} ${GY + N * C + 1}"/>`;
      s += `<path class="sb-ink" stroke-width="${w}" d="M${x0 - 1} ${GY + i * C + j(3)}L${x0 + N * C + 1} ${GY + i * C + j(4)}"/>`;
    }
    return s;
  }

  private shipSvg(g: number, ship: number[], cls = 'sb-ship') {
    const a = this.xy(g, Math.min(...ship));
    const b = this.xy(g, Math.max(...ship));
    return `<rect class="${cls}" x="${a.x + 4}" y="${a.y + 4}" width="${b.x - a.x + C - 8}" height="${b.y - a.y + C - 8}" rx="3"/>`;
  }

  private marks(g: number, shots: Shot[]) {
    let s = '';
    shots.forEach((v, c) => {
      if (!v) return;
      const { x, y } = this.xy(g, c);
      const cx = x + C / 2;
      const cy = y + C / 2;
      if (v === 2) s += `<path class="sb-hit" d="M${cx - 11} ${cy - 11}L${cx + 11} ${cy + 11}M${cx + 11} ${cy - 11}L${cx - 11} ${cy + 11}"/>`;
      else if (v === 1) s += `<circle class="sb-miss" cx="${cx}" cy="${cy}" r="4"/>`;
      else s += `<circle class="sb-auto" cx="${cx}" cy="${cy}" r="2.2"/>`;
    });
    return s;
  }

  private draw() {
    const st = this.s;
    if (!st) return;
    const me = this.viewer;
    const op = 1 - me;
    const showMine = this.ctx.demo || !this.hidden;
    const placing = st.phase === 'place' && this.actSeat === me;
    let s = this.grid(0, this.ctx.demo ? `Флот: ${this.plain(me)}` : 'Мои корабли') + this.grid(1, this.ctx.demo ? `Флот: ${this.plain(op)}` : 'Противник');
    const mine = placing ? this.draft : showMine ? st.ships[me] : [];
    for (const sh of mine) s += this.shipSvg(0, sh);
    s += this.marks(0, st.shots[op]);
    // поле противника: известные корабли (потопленные или все — в показе и в конце)
    for (const sh of st.ships[op]) s += this.shipSvg(1, sh, st.sunk[me].some((x) => x[0] === sh[0]) ? 'sb-ship sb-sunk' : 'sb-ship sb-enemy');
    s += this.marks(1, st.shots[me]);
    for (const c of this.aim) {
      const { x, y } = this.xy(1, c);
      s += `<circle class="sb-aim" cx="${x + C / 2}" cy="${y + C / 2}" r="12"/>`;
    }
    // сколько осталось у каждого
    const left = (seat: number) => SIZES[st.cfg.fleet].length - st.sunk[1 - seat].length;
    if (st.phase !== 'place') {
      s += `<text class="sb-note" x="${GX[0]}" y="${GY + N * C + 40}">на плаву: ${left(me)}</text>`;
      s += `<text class="sb-note" x="${GX[1]}" y="${GY + N * C + 40}">на плаву: ${left(op)}</text>`;
    }
    this.gField.innerHTML = s;
    this.drawGhost();
  }

  private plain(seat: number) {
    return this.ctx.name(seat).replace(/<[^>]+>/g, '');
  }

  private drawGhost() {
    let g = '';
    const st = this.s;
    if (st && this.hoverCell != null) {
      if (this.placing() && this.pick != null) {
        const sh = shipAt(this.hoverCell, this.pick, this.vertical);
        const ok = !!sh && fits(sh, this.draft, st.cfg.touch);
        if (sh) g += this.shipSvg(0, sh, `sb-ghost ${ok ? 'ok' : 'bad'}`);
      } else if (this.shooting() && st.shots[this.viewer][this.hoverCell] === 0) {
        const { x, y } = this.xy(1, this.hoverCell);
        g += `<circle class="sb-sight" cx="${x + C / 2}" cy="${y + C / 2}" r="13"/><path class="sb-sight" d="M${x + C / 2} ${y + 2}V${y + C - 2}M${x + 2} ${y + C / 2}H${x + C - 2}"/>`;
      }
    }
    this.gGhost.innerHTML = g;
  }

  // ---------------------------------------------------------------- расстановка

  /** Какие корабли ещё не поставлены (длины). */
  private remaining(): number[] {
    const left = SIZES[this.s!.cfg.fleet].slice();
    for (const sh of this.draft) left.splice(left.indexOf(sh.length), 1);
    return left;
  }

  private rotate() {
    this.vertical = !this.vertical;
    Sound.ui();
    this.drawGhost();
    this.renderButtons();
  }

  private onClick(e: MouseEvent) {
    const st = this.s;
    if (!st || this.actSeat == null || this.hidden) return;
    const hit = this.cellAt(e);
    if (!hit) return;
    if (st.phase === 'place' && hit.g === 0) {
      // нажали на поставленный корабль — снять его
      const idx = this.draft.findIndex((sh) => sh.includes(hit.c));
      if (idx >= 0) {
        this.pick = this.draft[idx].length;
        this.draft.splice(idx, 1);
        Sound.ui();
      } else if (this.pick != null) {
        const sh = shipAt(hit.c, this.pick, this.vertical);
        if (!sh || !fits(sh, this.draft, st.cfg.touch)) {
          Sound.nomove();
          return;
        }
        this.draft.push(sh);
        Sound.place();
        const rest = this.remaining();
        this.pick = rest.length ? Math.max(...rest) : null;
      }
      this.draw();
      this.renderButtons();
      return;
    }
    if (st.phase === 'battle' && hit.g === 1 && st.shots[this.viewer][hit.c] === 0) {
      const k = Math.min(shotsPerTurn(st, this.viewer), st.shots[this.viewer].filter((x) => x === 0).length);
      if (k <= 1) return this.send({ type: 'shoot', cells: [hit.c] });
      const i = this.aim.indexOf(hit.c);
      if (i >= 0) this.aim.splice(i, 1);
      else if (this.aim.length < k) this.aim.push(hit.c);
      Sound.ui();
      this.draw();
      this.renderButtons();
    }
  }

  private send(a: Parameters<ViewCtx['act']>[1]) {
    const seat = this.actSeat;
    if (seat == null) return;
    Sound.unlock();
    this.clearTurn();
    this.ctx.act(seat, a);
  }

  private clearTurn() {
    this.actSeat = null;
    this.aim = [];
    this.hoverCell = null;
    this.btns.innerHTML = '';
  }

  private button(text: string, primary: boolean, on: () => void, disabled = false) {
    const b = h<HTMLButtonElement>(`<button class="btn ${primary ? 'primary' : ''}"${disabled ? ' disabled' : ''}>${text}</button>`);
    b.onclick = () => {
      Sound.unlock();
      on();
    };
    this.btns.appendChild(b);
  }

  private renderButtons() {
    this.btns.innerHTML = '';
    const st = this.s;
    const seat = this.actSeat;
    if (!st || seat == null || this.ctx.demo || this.hidden) return;
    if (st.phase === 'place') {
      const rest = this.remaining();
      if (rest.length) {
        const dock = h('<div class="sb-dock"></div>');
        const kinds = [...new Set(rest)].sort((a, b) => b - a);
        for (const len of kinds) {
          const n = rest.filter((x) => x === len).length;
          const b = h<HTMLButtonElement>(`<button class="btn sb-dk${this.pick === len ? ' on' : ''}"><span class="sb-cells">${'▮'.repeat(len)}</span> ×${n}</button>`);
          b.title = `${NAMES[len]}палубный`;
          b.onclick = () => {
            this.pick = len;
            this.renderButtons();
          };
          dock.appendChild(b);
        }
        this.btns.appendChild(dock);
        this.button(this.vertical ? 'Повернуть: стоят вертикально (R)' : 'Повернуть: лежат горизонтально (R)', false, () => this.rotate());
      }
      this.button('Расставить случайно', false, () => {
        this.draft = randomFleet(st.cfg, rnd);
        this.pick = null;
        this.draw();
        this.renderButtons();
      });
      if (this.draft.length) this.button('Убрать все', false, () => {
        this.draft = [];
        this.pick = Math.max(...SIZES[st.cfg.fleet]);
        this.draw();
        this.renderButtons();
      });
      this.button('Готово — к бою!', true, () => this.send({ type: 'place', ships: this.draft }), rest.length > 0);
      return;
    }
    if (st.phase === 'battle') {
      const k = Math.min(shotsPerTurn(st, seat), st.shots[seat].filter((x) => x === 0).length);
      if (k > 1) {
        this.btns.appendChild(h(`<div class="sb-ask">Залп: отмечено ${this.aim.length} из ${k}</div>`));
        this.button('Залп!', true, () => this.send({ type: 'shoot', cells: this.aim }), this.aim.length !== k);
      }
      this.button('Сдаться', false, () => this.send({ type: 'resign' }));
    }
  }

  // ---------------------------------------------------------------- состояние

  private chooseViewer(toAct: number[]) {
    const mine = this.ctx.mySeats;
    if (!mine.length) return;
    if (mine.length === 1) {
      this.viewer = mine[0];
      return;
    }
    const next = toAct.find((x) => mine.includes(x));
    if (next != null && next !== this.viewer) {
      this.viewer = next;
      this.hidden = true;
    }
  }

  setView(s: State) {
    this.s = s;
    this.gBanner.innerHTML = '';
    this.draw();
  }

  async play(events: Event[], s: State) {
    const speed = this.ctx.speed();
    this.clearTurn();
    for (const ev of events) {
      if (ev.type === 'shots') {
        // клетки появляются по одной, с плеском или треском
        const g = ev.seat === this.viewer ? 1 : 0;
        for (const r of ev.res) {
          const prev = this.s!;
          const shots = [prev.shots[0].slice(), prev.shots[1].slice()] as [Shot[], Shot[]];
          shots[ev.seat][r.cell] = r.hit ? 2 : 1;
          this.s = { ...prev, shots };
          this.draw();
          const { x, y } = this.xy(g, r.cell);
          this.gBanner.innerHTML = `<circle class="sb-splash ${r.hit ? 'hit' : ''}" cx="${x + C / 2}" cy="${y + C / 2}" r="6"/>`;
          if (r.hit) Sound.capture();
          else Sound.step();
          await sleep((ev.res.length > 1 ? 160 : 380) / speed);
        }
        this.gBanner.innerHTML = '';
        const sunk = ev.res.find((r) => r.sunk);
        if (sunk) {
          this.s = { ...s };
          this.draw();
          await this.banner(`Убит ${NAMES[sunk.sunk!.length]}палубный!`, 800 / speed);
        }
      } else if (ev.type === 'start') {
        Sound.turn();
      } else if (ev.type === 'end') {
        Sound.win();
        this.s = s;
        this.draw();
        await this.banner(ev.winner === this.viewer || this.ctx.mySeats.length !== 1 ? `Победа: ${this.plain(ev.winner)}!` : 'Наш флот потоплен…', 0);
      }
    }
    this.s = s;
    this.draw();
  }

  private async banner(text: string, ms: number) {
    this.gBanner.innerHTML = `<g class="sb-bannerbox"><rect x="${W / 2 - 230}" y="${H / 2 - 36}" width="460" height="72" rx="6"/><text x="${W / 2}" y="${H / 2 + 2}">${text}</text></g>`;
    if (!ms) return;
    await sleep(ms);
    this.gBanner.innerHTML = '';
  }

  setTurn(toAct: number[], interactive: number[]) {
    this.clearTurn();
    const st = this.s;
    if (!st || st.phase === 'over' || this.ctx.demo) {
      if (st) this.draw();
      return;
    }
    const prev = this.viewer;
    this.chooseViewer(toAct);
    const seat = interactive.find((x) => x === this.viewer) ?? null;
    if (this.hidden && interactive.length && this.ctx.mySeats.length > 1) {
      (this.cover.querySelector('.sb-cover-t') as HTMLElement).innerHTML = `${st.phase === 'place' ? 'Расстановка' : 'Стреляет'}: ${this.ctx.name(this.viewer)}.<br><small>Отвернитесь — сейчас будет видно его флот!</small>`;
      this.cover.hidden = false;
    } else {
      this.hidden = false;
      this.cover.hidden = true;
    }
    this.actSeat = seat;
    if (st.phase === 'place' && seat != null && (prev !== this.viewer || !this.draft.length)) {
      this.draft = [];
      this.pick = Math.max(...SIZES[st.cfg.fleet]);
    }
    this.draw();
    this.renderButtons();
  }

  status(st: State, toAct: number[], interactive: number[]) {
    const name = (p: number) => this.ctx.name(p);
    if (st.phase === 'over') return st.winner != null ? `Победа: ${name(st.winner)}` : 'Бой окончен';
    if (st.phase === 'place') return interactive.length ? 'Расставьте корабли' : 'Соперник расставляет корабли…';
    const who = toAct[0];
    return interactive.includes(who) ? (shotsPerTurn(st, who) > 1 ? 'Ваш залп!' : 'Ваш выстрел — куда?') : `Стреляет ${name(who)}…`;
  }

  playerStats(st: State, seat: number) {
    const left = SIZES[st.cfg.fleet].length - st.sunk[1 - seat].length;
    return st.phase === 'place' ? (st.ready[seat] ? 'готов' : 'расставляет…') : `кораблей: ${left}`;
  }

  destroy() {
    window.removeEventListener('keydown', this.onKey);
  }
}

export function createView(): GameView<State, Event> {
  return new SeaView();
}

