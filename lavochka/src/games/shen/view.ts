/* Шен — отрисовка: доска-щит (картинка tools/shen), лунки, пальма, змейки и иероглифы «нефер» — SVG поверх неё, колышки с головами
 * собак и шакалов стоят в лунках. Фишки в руке стоят рядом с доской. Ход — касание подсвеченной фишки, затем лунки, куда её поставить. */
import { Sound } from '../../core/audio';
import { h, sleep, touchScreen } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { LINES, NEFER, SHEN, alive, legalMoves, type Event, type Move, type State } from './engine';
import './shen.css';

const TEX = `${import.meta.env.BASE_URL}tex/shen/`;
const NS = 'http://www.w3.org/2000/svg';
/** Доска во весь кадр: 660 × 1200, макушка — полукруг радиуса 330. */
const BW = 660;
const BH = 1200;
const CX = 330;
/** Края: средняя колонна, наружная колонна, верх прямой части. */
const IN = 88;
const OUT = 262;
const YC = 362;
/** Колышек: высота на доске, размеры спрайта. */
const PH = 190;
const SPR = { dog: [66, 300], jackal: [71, 300] } as const;

type Pt = [number, number];

/** Центр лунки h на дорожке места (0 — собаки слева, 1 — шакалы справа). 0 — рука, SHEN — шен. */
function holeXY(seat: number, hh: number): Pt {
  const side = seat === 0 ? -1 : 1;
  if (hh === SHEN) return [CX, YC - OUT];
  if (hh <= 10) return [CX + side * IN, 418 + (hh - 1) * 74];
  if (hh <= 25) return [CX + side * OUT, 1112 - (hh - 11) * ((1112 - YC) / 14)];
  const a = ((180 - 18 * (hh - 25)) * Math.PI) / 180;
  return [CX - side * Math.cos(a) * OUT, YC - Math.sin(a) * OUT];
}

/** Место фишки в руке: колышки стоят у нижнего угла доски снаружи. */
function handXY(seat: number, i: number): Pt {
  const side = seat === 0 ? -1 : 1;
  return [CX + side * (BW / 2 + 40 + (i % 3) * 30), BH - 12 - Math.floor(i / 3) * 70];
}

/** Фишки в шене («Картер»): по сторонам финиша. */
function homeXY(seat: number, i: number): Pt {
  const side = seat === 0 ? -1 : 1;
  const [x, y] = holeXY(seat, SHEN);
  return [x + side * (26 + i * 16), y + 20 + i * 4];
}

/** Иероглиф «нефер» (сердце с трахеей) — вырезан рядом с лункой. */
function nefer(x: number, y: number): string {
  return `<g transform="translate(${x},${y})">
    <path d="M0,-28 V-6 M-6,-21 H6" class="sh-cut"/>
    <path d="M0,-6 C-12,-6 -14,10 0,20 C14,10 12,-6 0,-6 Z" class="sh-cut"/></g>`;
}

/** Пальма между средними колоннами: ствол из ромбиков и веер листьев. */
function palm(): string {
  const parts: string[] = [];
  const top = 318;
  for (let y = 1090; y > top + 10; y -= 26) parts.push(`M${CX - 9},${y} L${CX},${y - 13} L${CX + 9},${y} M${CX - 9},${y} L${CX},${y + 13} L${CX + 9},${y}`);
  const fronds: string[] = [];
  for (const [ang, len] of [
    [-172, 150],
    [-148, 170],
    [-122, 150],
    [-90, 110],
    [-58, 150],
    [-32, 170],
    [-8, 150],
  ] as const) {
    const a = (ang * Math.PI) / 180;
    const ex = CX + Math.cos(a) * len;
    const ey = top + Math.sin(a) * len * 0.75 + (Math.abs(Math.cos(a)) > 0.8 ? 40 : 0);
    const mx = CX + Math.cos(a) * len * 0.55;
    const my = top + Math.sin(a) * len * 0.75 - 26;
    fronds.push(`M${CX},${top} Q${mx},${my} ${ex},${ey}`);
    // листочки вдоль ветви
    for (let k = 1; k <= 7; k++) {
      const t = k / 8;
      const px = (1 - t) * (1 - t) * CX + 2 * (1 - t) * t * mx + t * t * ex;
      const py = (1 - t) * (1 - t) * top + 2 * (1 - t) * t * my + t * t * ey;
      fronds.push(`M${px},${py} l${Math.cos(a + 1.1) * 22},${Math.sin(a + 1.1) * 22 + 12} M${px},${py} l${Math.cos(a - 1.1) * 22},${Math.sin(a - 1.1) * 22 + 12}`);
    }
  }
  return `<path d="${parts.join(' ')}" class="sh-cut thin"/><path d="${fronds.join(' ')}" class="sh-cut"/>`;
}

/** Змейка — волнистая линия между лунками a и b. */
function snakePath(seat: number, a: number, b: number): string {
  const [x1, y1] = holeXY(seat, a);
  const [x2, y2] = holeXY(seat, b);
  const side = seat === 0 ? -1 : 1;
  if (x1 === x2) {
    // обе лунки в средней колонне — дуга наружу
    const bx = x1 + side * 70;
    return `M${x1 + side * 14},${y1 + 6} C${bx},${y1 + 10} ${bx - side * 18},${(y1 + y2) / 2} ${bx},${(y1 + y2) / 2} S${bx},${y2 - 10} ${x2 + side * 14},${y2 - 6}`;
  }
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  return `M${x1 + side * 14},${y1 - 6} C${x1 + side * 40},${y1 - 50} ${mx - side * 30},${my + 40} ${mx},${my} S${x2 - side * 40},${y2 + 50} ${x2 - side * 14},${y2 + 8}`;
}

export class ShenView implements GameView<State, Event> {
  private ctx!: ViewCtx;
  private wrap!: HTMLElement;
  private svg!: SVGSVGElement;
  private gBoard!: SVGGElement;
  private gTargets!: SVGGElement;
  private gPieces!: SVGGElement;
  private tray!: HTMLElement;
  private stickEls: HTMLImageElement[] = [];
  private trayVal!: HTMLElement;
  private rollBtn!: HTMLButtonElement;
  private s: State | null = null;
  private look = '';
  /** Фишки на доске: ключ «место:лунка» (в руке — «место:h:i»). */
  private els = new Map<string, SVGGElement>();
  private moves: Move[] = [];
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
    this.wrap = h(`<div class="sh-wrap"><svg class="sh-board" xmlns="${NS}" viewBox="-150 -20 960 1250" preserveAspectRatio="xMidYMid meet"><g class="sh-g"></g><g class="sh-p"></g><g class="sh-t"></g></svg></div>`);
    root.appendChild(this.wrap);
    this.svg = this.wrap.querySelector('svg') as SVGSVGElement;
    this.gBoard = this.svg.querySelector('.sh-g') as SVGGElement;
    this.gPieces = this.svg.querySelector('.sh-p') as SVGGElement;
    this.gTargets = this.svg.querySelector('.sh-t') as SVGGElement;
    const ctl = h(`<div class="sh-controls">
        <div class="sh-tray blank">${[0, 1, 2, 3].map(() => `<img class="sh-stick" src="${TEX}stickd.webp" alt="">`).join('')}</div>
        <div class="sh-val"></div>
        ${ctx.demo ? '' : `<button class="btn primary sh-roll" data-tap disabled>Бросить палочки</button><div class="hint small-hint">${touchScreen() ? 'Бросок — кнопкой или тапом по доске.' : 'Пробел — бросок.'} Нажмите на подсвеченную фишку, затем на лунку.</div>`}
      </div>`);
    ctx.controls.appendChild(ctl);
    this.tray = ctl.querySelector('.sh-tray') as HTMLElement;
    this.stickEls = [...ctl.querySelectorAll<HTMLImageElement>('.sh-stick')];
    this.trayVal = ctl.querySelector('.sh-val') as HTMLElement;
    this.rollBtn = (ctl.querySelector('.sh-roll') as HTMLButtonElement) || document.createElement('button');
    this.rollBtn.onclick = () => this.roll();
    this.gPieces.addEventListener('click', (e) => {
      const el = (e.target as Element).closest('[data-from]') as SVGGElement | null;
      if (!el || !this.moves.length) return;
      e.stopPropagation();
      this.pick(Number(el.dataset.from));
    });
    this.gTargets.addEventListener('click', (e) => {
      const el = (e.target as Element).closest('[data-i]') as SVGGElement | null;
      if (!el || !this.s) return;
      e.stopPropagation();
      const m = this.moves[Number(el.dataset.i)];
      const seat = this.s.turn;
      this.clearTurn();
      Sound.unlock();
      this.ctx.act(seat, { type: 'move', from: m.from });
    });
    if (!ctx.demo) document.addEventListener('keydown', this.onKey);
    for (const k of ['dog', 'jackal', 'stickl', 'board', 'boardw']) new Image().src = `${TEX}${k}.webp`;
  }

  // ---------------------------------------------------------------- доска

  private build(s: State) {
    const parts: string[] = [];
    parts.push(`<defs>
      <radialGradient id="sh-hole" cx="50%" cy="40%" r="60%"><stop offset="0" stop-color="#160a03"/><stop offset="0.6" stop-color="#2e1a0a"/><stop offset="1" stop-color="#6e4a22"/></radialGradient>
      <filter id="sh-sh" x="-8%" y="-5%" width="116%" height="112%"><feDropShadow dx="0" dy="14" stdDeviation="12" flood-opacity="0.55"/></filter>
      <style>.sh-cut{fill:none;stroke:${s.cfg.look === 'wood' ? '#3a1e08' : '#6a4a26'};stroke-width:4;stroke-linecap:round;stroke-linejoin:round;opacity:.75}
        .sh-cut.thin{stroke-width:2.5}.sh-cut.hi{stroke:${s.cfg.look === 'wood' ? '#e8b878' : '#fffaf0'};opacity:.5;stroke-width:2.5}</style>
    </defs>`);
    parts.push(`<image href="${TEX}${s.cfg.look === 'wood' ? 'boardw' : 'board'}.webp" width="${BW}" height="${BH}" preserveAspectRatio="none" filter="url(#sh-sh)"/>`);
    // резьба: блик снизу-справа, сама линия поверх — кажется вырезанной
    const carve: string[] = [palm()];
    for (const seat of [0, 1]) {
      for (const [a, b] of LINES) carve.push(`<path d="${snakePath(seat, a, b)}" class="sh-cut"/>`);
      for (const n of NEFER) {
        const [x, y] = holeXY(seat, n);
        carve.push(nefer(x + (seat === 0 ? 40 : -40), y));
      }
    }
    const lines = carve.join('');
    parts.push(`<g transform="translate(1.5,2)" class="sh-hi">${lines.replace(/class="sh-cut( thin)?"/g, 'class="sh-cut hi"')}</g><g>${lines}</g>`);
    for (const seat of [0, 1])
      for (let hh = 1; hh <= 29; hh++) {
        const [x, y] = holeXY(seat, hh);
        const r = 12;
        parts.push(`<circle cx="${x}" cy="${y + 1}" r="${r + 3}" fill="#fff6dc" opacity="0.35"/><circle cx="${x}" cy="${y}" r="${r}" fill="url(#sh-hole)"/>`);
      }
    const [sx, sy] = holeXY(0, SHEN);
    parts.push(`<circle cx="${sx}" cy="${sy}" r="30" class="sh-cut"/><circle cx="${sx}" cy="${sy + 1}" r="20" fill="#fff6dc" opacity="0.35"/><circle cx="${sx}" cy="${sy}" r="17" fill="url(#sh-hole)"/>`);
    this.gBoard.innerHTML = parts.join('');
  }

  private pegHtml(seat: number) {
    const name = seat === 0 ? 'dog' : 'jackal';
    const [w0, h0] = SPR[name];
    const w = (w0 / h0) * PH;
    // собаки смотрят вправо, к середине доски; шакалы — влево
    const flip = seat === 0 ? ' transform="scale(-1,1)"' : '';
    return `<ellipse cx="14" cy="4" rx="22" ry="7" fill="#1a0c02" opacity="0.35"/><ellipse class="sh-ring" cx="0" cy="2" rx="18" ry="10"/><g${flip}><image href="${TEX}${name}.webp" x="${-w / 2}" y="${-PH * 0.97}" width="${w}" height="${PH}" preserveAspectRatio="none"/></g>`;
  }

  private addPeg(key: string, seat: number, [x, y]: Pt, from: number | null, scale = 1) {
    const el = document.createElementNS(NS, 'g') as SVGGElement;
    el.setAttribute('class', `sh-pc sh-s${seat}`);
    if (from != null) el.dataset.from = String(from);
    el.dataset.seat = String(seat);
    el.innerHTML = this.pegHtml(seat);
    this.place(el, [x, y], scale);
    this.els.set(key, el);
    return el;
  }

  private place(el: SVGGElement, [x, y]: Pt, scale = 1) {
    el.style.transform = `translate(${x}px, ${y}px)${scale !== 1 ? ` scale(${scale})` : ''}`;
    el.dataset.y = String(y);
  }

  private renderPieces(s: State) {
    this.gPieces.innerHTML = '';
    this.els.clear();
    for (const seat of [0, 1]) {
      for (const hh of s.pegs[seat]) this.addPeg(`${seat}:${hh}`, seat, holeXY(seat, hh), seat === s.turn ? hh : null);
      for (let i = 0; i < s.hand[seat]; i++) this.addPeg(`${seat}:h:${i}`, seat, handXY(seat, i), seat === s.turn && i === s.hand[seat] - 1 && s.cfg.mode === 'carter' ? 0 : null, 0.8);
      for (let i = 0; i < s.home[seat]; i++) this.addPeg(`${seat}:s:${i}`, seat, homeXY(seat, i), null, 0.7);
    }
    this.order();
  }

  /** Ближние фишки — поверх дальних. */
  private order() {
    [...this.els.values()].sort((a, b) => Number(a.dataset.y) - Number(b.dataset.y)).forEach((el) => this.gPieces.appendChild(el));
  }

  setView(s: State) {
    if (s.cfg.look !== this.look) {
      this.look = s.cfg.look;
      this.build(s);
    }
    this.s = s;
    this.renderPieces(s);
    this.showSticks(s.phase === 'move' || s.value ? s.sticks : null, s.value);
  }

  // ---------------------------------------------------------------- палочки

  private showSticks(sticks: number[] | null, value: number) {
    this.tray.classList.toggle('blank', !sticks || !sticks.length);
    this.stickEls.forEach((el, i) => {
      const light = sticks?.[i] ? 1 : 0;
      const src = `${TEX}${light ? 'stickl' : 'stickd'}.webp`;
      if (!el.src.endsWith(src)) el.src = src;
    });
    this.trayVal.textContent = sticks && sticks.length ? (value === 5 ? 'все тёмные — 5' : `светлых: ${value}`) : '';
  }

  private async rollAnim(sticks: number[], value: number, sp: number) {
    const dur = Math.round(800 / Math.max(0.5, sp));
    Sound.diceRoll(dur / 1000);
    this.stickEls.forEach((el, i) => {
      el.animate(
        [
          { transform: `translate(${(i % 2 ? 1 : -1) * 18}px, -10px) rotate(${(i % 2 ? 1 : -1) * (5 + i * 2)}deg) scaleY(0.3)`, offset: 0 },
          { transform: `translate(${(i % 2 ? -1 : 1) * 6}px, 3px) rotate(${(i % 2 ? -1 : 1) * 2}deg)`, offset: 0.6 },
          { transform: 'none', offset: 1 },
        ],
        { duration: dur, easing: 'cubic-bezier(.25,.7,.35,1)' },
      );
    });
    const t0 = performance.now();
    while (performance.now() - t0 < dur * 0.6) {
      this.showSticks([0, 1, 2, 3].map(() => (Math.random() < 0.5 ? 1 : 0)), 0);
      this.trayVal.textContent = '';
      await sleep(80);
    }
    await sleep(dur * 0.4);
    this.showSticks(sticks, value);
  }

  // ---------------------------------------------------------------- ходы

  async play(events: Event[], v: State) {
    const sp = this.ctx.speed();
    this.clearTurn();
    for (const ev of events) {
      if (ev.type === 'roll') {
        await this.rollAnim(ev.sticks, ev.value, sp);
        if (ev.none) {
          Sound.nomove();
          await sleep(800 / sp);
        }
      } else if (ev.type === 'move' && this.s) {
        const s = this.s;
        const seat = ev.seat;
        let el: SVGGElement | undefined;
        if (ev.from === 0) el = this.els.get(`${seat}:h:${s.hand[seat] - 1}`);
        else el = this.els.get(`${seat}:${ev.from}`);
        if (el) {
          el.classList.add('anim');
          this.gPieces.appendChild(el);
          for (const c of ev.path) {
            this.place(el, holeXY(seat, c));
            Sound.step();
            await sleep(Math.max(70, 160 / sp));
          }
          el.classList.remove('anim');
          if (ev.to !== ev.land) {
            // змейка: фишка скользит по линии
            await sleep(150 / sp);
            Sound.jump();
            el.classList.add('glide');
            this.place(el, holeXY(seat, ev.to));
            await sleep(520 / sp);
            el.classList.remove('glide');
          }
          if (ev.again) Sound.enter();
        }
        if (ev.land === SHEN) {
          Sound.home();
          await sleep(300 / sp);
          if (ev.took != null) {
            const x = ev.took ? this.els.get(`${1 - seat}:${ev.took}`) : this.els.get(`${1 - seat}:h:${s.hand[1 - seat] - 1}`);
            if (x) {
              Sound.capture();
              x.classList.add('gone');
              setTimeout(() => x.remove(), 450);
            }
            await sleep(450 / sp);
          }
        }
      } else if (ev.type === 'enter') {
        Sound.place();
        await sleep(200 / sp);
      } else if (ev.type === 'end' && ev.winner != null) Sound.win();
    }
    this.s = v;
    this.renderPieces(v);
    this.showSticks(v.phase === 'move' ? v.sticks : v.sticks.length ? v.sticks : null, v.value);
  }

  private clearTurn() {
    clearTimeout(this.autoTimer);
    this.rollBtn.disabled = true;
    this.rollBtn.classList.remove('pulse');
    this.rollSeat = null;
    this.moves = [];
    this.gTargets.innerHTML = '';
    for (const el of this.els.values()) el.classList.remove('can', 'sel');
  }

  private elFrom(from: number): SVGGElement | undefined {
    return [...this.els.values()].find((el) => el.dataset.from === String(from) && el.dataset.seat === String(this.s?.turn));
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
    for (const f of froms) this.elFrom(f)?.classList.add('can');
    if (froms.size === 1) this.pick([...froms][0]);
    if (this.ctx.autoSingle() && this.moves.length === 1) {
      const m = this.moves[0];
      this.autoTimer = setTimeout(() => {
        if (this.s === s) {
          this.clearTurn();
          this.ctx.act(seat, { type: 'move', from: m.from });
        }
      }, 500 / this.ctx.speed());
    }
  }

  /** Выбрали фишку — показываем лунку, куда она встанет (и куда уведёт змейка). */
  private pick(from: number) {
    const s = this.s!;
    const i = this.moves.findIndex((m) => m.from === from);
    if (i < 0) return;
    const m = this.moves[i];
    for (const el of this.els.values()) el.classList.remove('sel');
    this.elFrom(from)?.classList.add('sel');
    const [x, y] = holeXY(s.turn, m.land);
    const kind = m.land === SHEN ? ' shen' : m.to > m.land ? ' snake' : m.to < m.land ? ' back' : '';
    const r = m.land === SHEN ? 30 : 22;
    let label = m.land === SHEN ? 'шен' : String(m.land);
    if (m.to !== m.land) label += ` → ${m.to}`;
    if (m.again) label += ' ★';
    const side = s.turn === 0 ? -1 : 1;
    const tx = m.land === SHEN ? x : m.land <= 10 ? x - side * 60 : x - side * 62;
    const ty = m.land === SHEN ? y + 58 : y + 8;
    this.gTargets.innerHTML = `<g class="sh-target${kind}" data-i="${i}"><circle cx="${x}" cy="${y}" r="${r}"/><text x="${tx}" y="${ty}">${label}</text></g>`;
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
    if (!interactive.includes(s.turn)) return s.phase === 'roll' ? `${who} бросает палочки…` : `${who} ходит…`;
    if (s.phase === 'roll') return `Ход: ${who} — бросайте палочки`;
    return `${who}: ходите на ${s.value}`;
  }

  playerStats(s: State, seat: number) {
    if (s.cfg.mode === 'carter') return `<span title="Пришли в шен">⌂ ${s.home[seat]}</span><span title="На доске">● ${s.pegs[seat].length}</span>`;
    return `<span title="Фишек в игре">● ${alive(s, seat)}</span><span title="В руке">✋ ${s.hand[seat]}</span>`;
  }

  destroy() {
    clearTimeout(this.autoTimer);
    document.removeEventListener('keydown', this.onKey);
  }
}

export const createView = () => new ShenView();