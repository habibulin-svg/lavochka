/* Царская игра Ура — отрисовка. Доска — выпрямленный снимок подлинника из Британского музея (public/tex/ur/board.webp):
 * раковина, лазурит, красный известняк. Фишки — диски из раковины с пятью лазуритовыми точками и сланцевые с белыми.
 * Сверху и снизу — лотки: фишки, которые ещё не вошли, и вышедшие. Бросок — четыре пирамидки в боковой панели.
 * Ход человека: бросок, затем касание фишки и подсвеченной клетки, куда её поставить. */
import { Sound } from '../../core/audio';
import { h, sleep, touchScreen } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { cell, HOME, legal, ROSETTES, type Action, type Event, type State } from './engine';
import './ur.css';

const TEX = `${import.meta.env.BASE_URL}tex/ur/board.webp`;
const BW = 1696;
const BH = 694;
const TRAY = 190;
const W = BW;
const H = BH + 2 * TRAY;
const COLS = [135, 345, 555, 765, 975, 1180, 1375, 1570];
const ROWS = [120, 330, 550];
const R = 62;

type Pt = [number, number];

/** Точка клетки пути стороны (1–14) на поле; 0 и 15 — места в лотке. */
function spot(side: number, p: number, k: number): Pt {
  if (p > 0 && p < HOME) {
    const [c, r] = cell(side, p);
    return [COLS[c], TRAY + ROWS[r]];
  }
  const y = side === 0 ? H - TRAY / 2 : TRAY / 2;
  // не вошедшие — слева, вышедшие — справа, с нахлёстом
  return p === 0 ? [110 + k * 150, y] : [W - 110 - k * 150, y];
}

function piece(side: number): string {
  const dots = [
    [0, 0],
    [-0.42, -0.42],
    [0.42, -0.42],
    [-0.42, 0.42],
    [0.42, 0.42],
  ]
    .map(([x, y]) => `<circle cx="${x * R}" cy="${y * R}" r="${R * 0.13}" fill="${side === 0 ? '#2440a8' : '#f2eee2'}" stroke="${side === 0 ? '#18286a' : '#9a9486'}" stroke-width="2"/>`)
    .join('');
  return `<circle cx="7" cy="11" r="${R + 4}" fill="#000" opacity="0.4" filter="url(#ur-blur)"/>
    <circle r="${R}" fill="url(#ur-p${side})" stroke="${side === 0 ? '#a89e86' : '#0c0c0e'}" stroke-width="3"/>
    <circle r="${R - 7}" fill="none" stroke="${side === 0 ? '#fff' : '#6a6a74'}" stroke-opacity="0.35" stroke-width="3"/>
    ${dots}
    <circle class="ur-ring" r="${R + 10}"/>`;
}

function defs(): string {
  return `<defs>
    <radialGradient id="ur-p0" cx="38%" cy="32%" r="75%"><stop offset="0" stop-color="#ffffff"/><stop offset="0.45" stop-color="#ece6d6"/><stop offset="0.8" stop-color="#d3cab2"/><stop offset="1" stop-color="#b6ab90"/></radialGradient>
    <radialGradient id="ur-p1" cx="38%" cy="32%" r="75%"><stop offset="0" stop-color="#6c6c76"/><stop offset="0.5" stop-color="#36363e"/><stop offset="1" stop-color="#18181c"/></radialGradient>
    <filter id="ur-blur" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="7"/></filter>
    <filter id="ur-bshadow" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="16" stdDeviation="14" flood-opacity="0.55"/></filter>
  </defs>`;
}

function trays(): string {
  const t = (y: number, side: number) =>
    `<rect x="20" y="${y + 18}" width="${W - 40}" height="${TRAY - 36}" rx="40" class="ur-tray"/>
     <text x="${W / 2}" y="${y + TRAY / 2 + 12}" class="ur-tlabel">${side === 0 ? 'белые' : 'чёрные'}: ← не вошли · вышли →</text>`;
  return t(0, 1) + t(H - TRAY, 0);
}

/** Пирамидка-тетраэдр сверху: три грани, вершина в центре; отмеченная вершина — белая точка. */
function tetra(up: number, i: number): string {
  const x = 34 + i * 62;
  const y = 36;
  const a: Pt = [x, y - 26];
  const b: Pt = [x - 25, y + 17];
  const c: Pt = [x + 25, y + 17];
  const m: Pt = [x, y + 2];
  const f = (p: Pt[], col: string) => `<path d="M${p.map((q) => q.join(' ')).join('L')}Z" fill="${col}" stroke="#1a140c" stroke-width="1.5" stroke-linejoin="round"/>`;
  return `<g class="ur-die">${f([a, b, m], '#c9b48a')}${f([a, c, m], '#a8936a')}${f([b, c, m], '#8a7552')}
    ${up ? `<circle cx="${m[0]}" cy="${m[1]}" r="6" fill="#f6f2e6" stroke="#1a140c" stroke-width="1.2"/><circle cx="${m[0]}" cy="${m[1]}" r="2.6" fill="#2440a8"/>` : `<circle cx="${m[0]}" cy="${m[1]}" r="3" fill="#3a2c18"/>`}</g>`;
}

class UrView implements GameView<State, Event> {
  private ctx!: ViewCtx;
  private svg!: SVGSVGElement;
  private gPieces!: SVGGElement;
  private gMarks!: SVGGElement;
  private diceBox!: HTMLElement;
  private info!: HTMLElement;
  private rollBtn!: HTMLButtonElement;
  private s: State | null = null;
  private els: SVGGElement[][] = [[], []];
  private rollSeat: number | null = null;
  private moveSeat: number | null = null;
  private sel: number | null = null;
  private onKey = (e: KeyboardEvent) => {
    if (e.code !== 'Space' || this.rollBtn.disabled || !this.rollBtn.isConnected) return;
    const t = e.target as HTMLElement;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    e.preventDefault();
    this.roll();
  };

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    const wrap = h(`<div class="ur-wrap"><svg class="ur-board" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
        ${defs()}${trays()}
        <image href="${TEX}" x="0" y="${TRAY}" width="${BW}" height="${BH}" filter="url(#ur-bshadow)"/>
        <g class="ur-last"></g><g class="ur-pcs"></g><g class="ur-marks"></g>
      </svg></div>`);
    root.appendChild(wrap);
    this.svg = wrap.querySelector('svg') as SVGSVGElement;
    this.gPieces = this.svg.querySelector('.ur-pcs') as SVGGElement;
    this.gMarks = this.svg.querySelector('.ur-marks') as SVGGElement;
    const ctl = h(`<div class="sb-controls">
        <div class="ur-dice"></div>
        <div class="ur-info"></div>
        ${ctx.demo ? '' : `<button class="btn primary sb-roll" data-tap disabled>Бросить пирамидки</button><div class="hint small-hint">${touchScreen() ? 'Бросок — кнопкой или тапом по доске.' : 'Пробел — бросок.'} Потом — фишку и клетку, куда её поставить.</div>`}
      </div>`);
    ctx.controls.appendChild(ctl);
    this.diceBox = ctl.querySelector('.ur-dice') as HTMLElement;
    this.info = ctl.querySelector('.ur-info') as HTMLElement;
    this.rollBtn = (ctl.querySelector('.sb-roll') as HTMLButtonElement) || document.createElement('button');
    this.rollBtn.onclick = () => this.roll();
    this.svg.addEventListener('click', (e) => this.click(e));
    if (!ctx.demo) document.addEventListener('keydown', this.onKey);
    this.dice([], 0);
  }

  private dice(d: number[], v: number, rolling = false) {
    const n = this.s?.cfg.dice ?? 4;
    const vals = d.length ? d : Array(n).fill(0);
    this.diceBox.innerHTML = `<svg viewBox="0 0 ${n * 62 + 6} 64" class="ur-dsvg${rolling ? ' rolling' : ''}">${vals.map((u, i) => tetra(u, i)).join('')}</svg>
      <b class="ur-val">${d.length ? v : '–'}</b>`;
  }

  private text() {
    const s = this.s;
    if (!s) return;
    const home = (x: number) => s.pos[x].filter((p) => p === HOME).length;
    let t = `<div>Вышли: ${this.ctx.name(s.seats[0])} <b>${home(0)}</b> · ${this.ctx.name(s.seats[1])} <b>${home(1)}</b> из ${s.cfg.pieces}</div>`;
    if (s.cfg.stakes) t += `<div>Жетоны: <b>${s.tokens[0]}</b> · <b>${s.tokens[1]}</b>, в коне <b>${s.pool}</b></div>`;
    this.info.innerHTML = t;
  }

  /** Расставить все фишки по местам (без анимации). */
  private layout(s: State, anim = false) {
    if (this.els[0].length !== s.cfg.pieces) {
      this.gPieces.innerHTML = '';
      this.els = [0, 1].map((side) =>
        Array.from({ length: s.cfg.pieces }, () => {
          const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
          g.setAttribute('class', `ur-pc ur-s${side}`);
          g.innerHTML = piece(side);
          this.gPieces.appendChild(g);
          return g;
        })
      );
    }
    for (const side of [0, 1]) {
      const order = s.pos[side].map((p, i) => [p, i]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      let k0 = 0;
      let kh = 0;
      for (const [p, i] of order) {
        const k = p === 0 ? k0++ : p === HOME ? kh++ : 0;
        const [x, y] = spot(side, p, k);
        const el = this.els[side][i];
        el.classList.toggle('anim', anim);
        el.setAttribute('transform', `translate(${x} ${y})`);
        el.dataset.p = String(p);
      }
    }
    const lg = this.svg.querySelector('.ur-last') as SVGGElement;
    lg.innerHTML = '';
    if (s.last && s.last.to < HOME) {
      const [x, y] = spot(s.last.side, s.last.to, 0);
      lg.innerHTML = `<rect x="${x - 92}" y="${y - 92}" width="184" height="184" rx="14" class="ur-lastc"/>`;
    }
  }

  setView(v: State) {
    this.s = v;
    this.layout(v);
    this.dice(v.dice, v.value);
    this.text();
  }

  /** Путь фишки по клеткам: from → to (0 — из лотка, 15 — в лоток). */
  private async walk(side: number, from: number, to: number) {
    const s = this.s!;
    const i = s.pos[side].indexOf(from);
    const el = this.els[side][i] ?? this.els[side].find((e) => Number(e.dataset.p) === from);
    if (!el) return;
    this.gPieces.appendChild(el);
    el.classList.add('anim');
    const sp = this.ctx.speed();
    for (let p = from + 1; p <= to; p++) {
      const k = p === HOME ? s.pos[side].filter((q) => q === HOME).length : 0;
      const [x, y] = spot(side, p, k);
      el.setAttribute('transform', `translate(${x} ${y})`);
      Sound.step();
      await sleep(150 / sp);
    }
  }

  async play(events: Event[], v: State) {
    const sp = this.ctx.speed();
    for (const ev of events) {
      if (ev.type === 'roll') {
        this.dice(ev.dice, ev.value, true);
        Sound.diceRoll(0.5);
        await sleep(520 / sp);
        this.dice(ev.dice, ev.value);
        if (ev.none) {
          Sound.nomove();
          await sleep(500 / sp);
        }
      } else if (ev.type === 'move') {
        await this.walk(ev.side, ev.from, ev.to);
        if (ev.hit) {
          Sound.capture();
          await sleep(120 / sp);
        }
        if (ev.again) Sound.enter();
        if (ev.to === HOME) Sound.home();
        // применить положение (сбитая фишка — в лоток)
        const s = this.s!;
        const n: State = { ...s, pos: [s.pos[0].slice(), s.pos[1].slice()] };
        n.pos[ev.side][n.pos[ev.side].indexOf(ev.from)] = ev.to;
        if (ev.hit) n.pos[1 - ev.side][n.pos[1 - ev.side].indexOf(ev.to)] = 0;
        n.last = { side: ev.side, from: ev.from, to: ev.to };
        this.s = n;
        this.layout(n, true);
        await sleep(200 / sp);
      } else if (ev.type === 'end') Sound.win();
    }
    this.s = v;
    this.layout(v);
    this.dice(v.dice, v.value);
    this.text();
  }

  private clearTurn() {
    this.rollBtn.disabled = true;
    this.rollBtn.classList.remove('pulse');
    this.rollSeat = null;
    this.moveSeat = null;
    this.sel = null;
    for (const side of this.els) for (const el of side) el.classList.remove('can', 'sel');
    this.gMarks.innerHTML = '';
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
    const moves = legal(s);
    this.moveSeat = seat;
    for (const m of moves) this.pieceAt(s.cur, m.from)?.classList.add('can');
    if (moves.length === 1) this.select(moves[0].from);
  }

  /** Фишка стороны на клетке p (для лотка — верхняя). */
  private pieceAt(side: number, p: number): SVGGElement | undefined {
    const els = this.els[side].filter((e) => Number(e.dataset.p) === p);
    return els[0];
  }

  private select(from: number) {
    const s = this.s!;
    const m = legal(s).find((x) => x.from === from);
    if (!m) return;
    this.sel = from;
    for (const el of this.els[s.cur]) el.classList.remove('sel');
    this.pieceAt(s.cur, from)?.classList.add('sel');
    const k = m.to === HOME ? s.pos[s.cur].filter((q) => q === HOME).length : 0;
    const [x, y] = spot(s.cur, m.to, k);
    const ros = ROSETTES.includes(m.to) ? ' ur-ros' : '';
    this.gMarks.innerHTML = `<g class="ur-target${ros}" data-to="1" transform="translate(${x} ${y})"><circle r="${R + 6}"/><circle r="22" class="ur-dot"/></g>`;
  }

  private send(from: number) {
    const seat = this.moveSeat;
    if (seat == null) return;
    this.clearTurn();
    Sound.unlock();
    this.ctx.act(seat, { type: 'move', from } as Action);
  }

  private click(e: MouseEvent) {
    const s = this.s;
    if (!s || this.moveSeat == null) return;
    const t = (e.target as Element).closest('[data-to]');
    if (t && this.sel != null) {
      e.stopPropagation();
      this.send(this.sel);
      return;
    }
    const pc = (e.target as Element).closest('.ur-pc.can') as SVGGElement | null;
    if (pc) {
      e.stopPropagation();
      Sound.unlock();
      this.select(Number(pc.dataset.p));
    }
  }

  private roll() {
    if (this.rollSeat == null) return;
    Sound.unlock();
    const seat = this.rollSeat;
    this.clearTurn();
    this.ctx.act(seat, { type: 'roll' });
  }

  status(s: State, _toAct: number[], interactive: number[]) {
    if (s.phase === 'over') return s.winner != null ? `Победа: ${this.ctx.name(s.seats[s.winner])}!` : 'Партия окончена';
    const seat = s.seats[s.cur];
    const who = this.ctx.name(seat);
    if (!interactive.includes(seat)) return s.phase === 'roll' ? `${who} бросает…` : `${who} ходит…`;
    if (s.phase === 'roll') return `${who}: бросайте пирамидки`;
    return `${who}: выпало ${s.value} — выберите фишку и поставьте её на подсвеченную клетку`;
  }

  playerStats(s: State, seat: number) {
    const side = s.seats.indexOf(seat);
    if (side < 0) return '';
    const p = s.pos[side];
    return `<span title="Вышли">🏁 ${p.filter((x) => x === HOME).length}</span><span title="Не вошли">◯ ${p.filter((x) => x === 0).length}</span>`;
  }

  destroy() {
    document.removeEventListener('keydown', this.onKey);
  }
}

export function createView(): GameView<State, Event> {
  return new UrView();
}
