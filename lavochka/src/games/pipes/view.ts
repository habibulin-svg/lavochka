/* «Водопроводчик» — отрисовка: кафельная стена, стальные трубы с муфтами на стыках, бак с водой в центре и латунные краны на концах.
 * Куда дошла вода — по трубе бежит голубая струя, у крана капает. Куски поворачиваются плавно.
 * Щелчок — по часовой, правая кнопка — против, долгое нажатие или колёсико — закрепить. */
import { Sound } from '../../core/audio';
import { h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { boardOf, deg, DIRS, rotCW, watered, type Action, type Board, type Event, type State } from './engine';
import './pipes.css';

const NS = 'http://www.w3.org/2000/svg';
const S = 100;
const ANG: Record<number, number> = { 1: 0, 2: 90, 4: 180, 8: 270 };

/** Кусок в «нулевом» повороте (форма) и сколько четвертей до нынешнего. */
function canon(m: number): { base: number; k: number; p: number } {
  const all: number[] = [];
  let t = m;
  for (let k = 0; k < 4; k++) {
    all.push(t);
    t = rotCW(t);
  }
  const base = Math.min(...all);
  // m = base повёрнутая k раз
  let k = 0;
  t = base;
  while (t !== m && k < 4) {
    t = rotCW(t);
    k++;
  }
  // сколько разных поворотов у куска: крестовина — 1, прямая — 2, остальные — 4
  return { base, k, p: new Set(all).size };
}

/** Трубу рисуем слоями: тёмная кромка, сталь, блик — так выходит объёмный цилиндр и на прямых, и на коленах. */
function tube(d: string): string {
  return `<path d="${d}" class="pp-edge"/><path d="${d}" class="pp-steel"/><path d="${d}" class="pp-shine"/><path d="${d}" class="pp-water"/>`;
}

/** Муфта у края клетки (для выхода вверх; остальные — поворотом). */
const COUPLING = `<rect x="33" y="-1" width="34" height="11" rx="2" class="pp-coupling"/><rect x="33" y="1" width="34" height="2.5" class="pp-coupling-hi"/>`;

function shape(base: number): string {
  const arms = DIRS.filter((d) => base & d);
  let out = '';
  if (arms.length === 2 && !(base === 5 || base === 10)) {
    // колено: дуга между двумя соседними выходами (рисуем для «вверх+вправо» и поворачиваем)
    const rot = base === 3 ? 0 : base === 6 ? 90 : base === 12 ? 180 : 270;
    out += `<g transform="rotate(${rot} 50 50)">${tube('M50 0V22A28 28 0 0 0 78 50H100')}</g>`;
  } else if (base === 5 || base === 10) {
    out += `<g transform="rotate(${base === 5 ? 0 : 90} 50 50)">${tube('M50 0V100')}</g>`;
  } else {
    for (const d of arms) out += `<g transform="rotate(${ANG[d]} 50 50)">${tube('M50 0V50')}</g>`;
    if (arms.length >= 3) out += `<circle cx="50" cy="50" r="18" class="pp-fitting"/><circle cx="50" cy="50" r="18" class="pp-fitting-hi"/><circle cx="50" cy="50" r="6" class="pp-bolt"/>`;
  }
  for (const d of arms) out += `<g transform="rotate(${ANG[d]} 50 50)">${COUPLING}</g>`;
  return out;
}

/** Латунный кран на конце: корпус, вентиль-«барашек», носик и капля. */
const TAP = `<g class="pp-tap"><circle cx="50" cy="50" r="17" class="pp-brass"/><circle cx="50" cy="50" r="17" class="pp-brass-hi"/>
  <path d="M38 50h-10v16h8v-8h2z" class="pp-brass"/>
  <g class="pp-wheel"><rect x="47" y="34" width="6" height="32" rx="3"/><rect x="34" y="47" width="32" height="6" rx="3"/><circle cx="50" cy="50" r="5"/></g>
  <path d="M32 70q-4 7 0 9q4-2 0-9z" class="pp-drop"/></g>`;

/** Бак: эмалированный, с заклёпками и волной. */
const TANK = `<g class="pp-tank"><circle cx="50" cy="50" r="38" class="pp-tank-rim"/><circle cx="50" cy="50" r="32" class="pp-tank-water"/>
  <path d="M22 54q7-6 14 0t14 0t14 0t14 0v22H22z" class="pp-wave"/>
  ${[0, 45, 90, 135, 180, 225, 270, 315].map((a) => `<circle cx="${50 + 35 * Math.cos((a * Math.PI) / 180)}" cy="${50 + 35 * Math.sin((a * Math.PI) / 180)}" r="2.2" class="pp-rivet"/>`).join('')}
  <circle cx="40" cy="40" r="7" fill="rgba(255,255,255,0.35)"/></g>`;

const LOCK = `<g class="pp-lock"><rect x="74" y="80" width="18" height="14" rx="2"/><path d="M78 80v-5a5 5 0 0 1 10 0v5" fill="none" stroke-width="3"/></g>`;

class PipesView implements GameView<State, Event> {
  private ctx!: ViewCtx<Action>;
  private svg!: SVGSVGElement;
  private s: State | null = null;
  private key = '';
  private cells: { g: SVGGElement; rot: SVGGElement; base: number; k: number; p: number; angle: number }[] = [];
  private actSeat: number | null = null;
  private press: { i: number; timer: number; long: boolean } | null = null;

  mount(root: HTMLElement, ctx: ViewCtx<Action>) {
    this.ctx = ctx;
    const wrap = h(`<div class="pp-wrap"><svg class="pp-board" xmlns="${NS}"></svg></div>`);
    root.appendChild(wrap);
    this.svg = wrap.querySelector('svg') as SVGSVGElement;
    if (!ctx.demo) ctx.controls.appendChild(h(`<div class="hint small-hint">Щелчок — повернуть по часовой, правая кнопка — против. Долгое нажатие или колёсико — закрепить кусок.</div>`));
    this.svg.addEventListener('contextmenu', (e) => e.preventDefault());
    this.svg.addEventListener('pointerdown', (e) => {
      const i = this.cellAt(e);
      if (i < 0 || this.actSeat == null) return;
      Sound.unlock();
      if (e.button === 1) {
        e.preventDefault();
        return this.send({ type: 'lock', i });
      }
      if (e.button === 2) return this.rotate(i, -1);
      if (e.button !== 0) return;
      const p = { i, long: false, timer: 0 };
      p.timer = window.setTimeout(() => {
        p.long = true;
        navigator.vibrate?.(30);
        this.send({ type: 'lock', i });
      }, 450);
      this.press = p;
    });
    this.svg.addEventListener('pointerup', (e) => {
      const p = this.press;
      this.press = null;
      if (!p) return;
      clearTimeout(p.timer);
      if (p.long || this.cellAt(e) !== p.i) return;
      if (e.shiftKey) this.send({ type: 'lock', i: p.i });
      else this.rotate(p.i, 1);
    });
    this.svg.addEventListener('pointerleave', () => {
      if (this.press) clearTimeout(this.press.timer);
      this.press = null;
    });
  }

  private cellAt(e: PointerEvent): number {
    const t = (e.target as Element).closest('[data-i]') as SVGElement | null;
    return t ? Number(t.dataset.i) : -1;
  }

  private board(): Board | null {
    const s = this.s;
    if (!s) return null;
    const me = this.ctx.mySeats.find((x) => s.seats.includes(x));
    return s.boards[me != null ? boardOf(s, me) : 0];
  }

  private rotate(i: number, d: 1 | -1) {
    const b = this.board();
    if (!b || b.lock[i] || b.done || i === -1) return;
    // повернуть сразу, не дожидаясь комнаты
    const c = this.cells[i];
    c.angle += d * 90;
    c.rot.style.transform = `rotate(${c.angle}deg)`;
    c.k = (c.k + d + c.p) % c.p;
    Sound.step();
    this.send({ type: 'rot', i, d });
  }

  private send(a: Action) {
    if (this.actSeat != null) this.ctx.act(this.actSeat, a);
  }

  private build(s: State, b: Board) {
    const c = s.cfg;
    const key = `${c.w}x${c.h}:${c.level}:${c.wrap}:${c.cross}`;
    if (key === this.key) return;
    this.key = key;
    const W = c.w * S;
    const H = c.h * S;
    this.svg.setAttribute('viewBox', `-14 -14 ${W + 28} ${H + 28}`);
    let bg = `<rect x="-14" y="-14" width="${W + 28}" height="${H + 28}" rx="14" class="pp-frame"/><rect x="0" y="0" width="${W}" height="${H}" class="pp-wall"/>`;
    for (let i = 0; i < c.w * c.h; i++) bg += `<rect x="${(i % c.w) * S + 2}" y="${Math.floor(i / c.w) * S + 2}" width="${S - 4}" height="${S - 4}" rx="4" class="pp-tile"/>`;
    this.svg.innerHTML = `<g>${bg}</g><g class="pp-cells"></g>`;
    const layer = this.svg.querySelector('.pp-cells') as SVGGElement;
    this.cells = [];
    for (let i = 0; i < b.tile.length; i++) {
      const { base, k, p } = canon(b.tile[i]);
      const g = document.createElementNS(NS, 'g');
      g.setAttribute('transform', `translate(${(i % c.w) * S} ${Math.floor(i / c.w) * S})`);
      g.dataset.i = String(i);
      const hit = `<rect width="${S}" height="${S}" fill="transparent"/>`;
      const rot = document.createElementNS(NS, 'g');
      rot.setAttribute('class', 'pp-rot');
      rot.style.transform = `rotate(${k * 90}deg)`;
      rot.innerHTML = shape(base) + (i === s.src ? '' : deg(base) === 1 ? TAP : '');
      g.innerHTML = hit;
      g.appendChild(rot);
      if (i === s.src) g.insertAdjacentHTML('beforeend', TANK);
      g.insertAdjacentHTML('beforeend', LOCK);
      layer.appendChild(g);
      this.cells.push({ g, rot, base, k, p, angle: k * 90 });
    }
  }

  private draw() {
    const s = this.s;
    const b = this.board();
    if (!s || !b) return;
    this.build(s, b);
    const wet = watered(s.cfg, b.tile, s.src);
    b.tile.forEach((m, i) => {
      const c = this.cells[i];
      const { k } = canon(m);
      if (k !== c.k) {
        // к нужному повороту — кратчайшей дорогой
        let d = (k - c.k + c.p) % c.p;
        if (c.p === 4 && d === 3) d = -1;
        c.angle += d * 90;
        c.k = k;
        c.rot.style.transform = `rotate(${c.angle}deg)`;
      }
      c.g.classList.toggle('wet', wet[i]);
      c.g.classList.toggle('locked', b.lock[i]);
      c.g.classList.toggle('can', this.actSeat != null && !b.done);
    });
    this.svg.classList.toggle('solved', b.done);
  }

  setView(s: State) {
    this.s = s;
    this.draw();
  }

  async play(events: Event[], s: State) {
    const before = this.board();
    const wetBefore = before && this.s ? watered(this.s.cfg, before.tile, this.s.src).filter(Boolean).length : 0;
    this.s = s;
    this.draw();
    const b = this.board()!;
    const wetNow = watered(s.cfg, b.tile, s.src).filter(Boolean).length;
    const other = events.some((e) => e.type === 'rot' && !this.ctx.mySeats.includes(e.seat));
    if (events.some((e) => e.type === 'solved')) Sound.win();
    else if (wetNow > wetBefore) Sound.place();
    else if (other) Sound.step();
    if (this.ctx.demo && events.length) await sleep(450 / this.ctx.speed());
  }

  setTurn(toAct: number[], interactive: number[]) {
    this.actSeat = this.ctx.demo ? null : (interactive.find((x) => toAct.includes(x)) ?? null);
    this.draw();
  }

  status(s: State) {
    const b = s.boards[0];
    if (s.done) return '';
    const mine = this.board() ?? b;
    const wet = watered(s.cfg, mine.tile, s.src).filter(Boolean).length;
    return `Уровень ${s.cfg.level} · вода в ${wet} из ${mine.tile.length} клеток · поворотов ${mine.turns}`;
  }

  playerStats(s: State, seat: number) {
    if (s.cfg.mode === 'race') {
      const b = s.boards[boardOf(s, seat)];
      const wet = watered(s.cfg, b.tile, s.src).filter(Boolean).length;
      return `<span>вода: ${Math.round((wet / b.tile.length) * 100)}%</span>`;
    }
    return s.seats.length > 1 ? `<span>поворотов: ${s.credit[seat]}</span>` : '';
  }
}

export function createView(): GameView<State, Event> {
  return new PipesView();
}
