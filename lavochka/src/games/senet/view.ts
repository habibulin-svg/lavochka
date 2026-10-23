/* Сенет — отрисовка. Доска 3×10 в коде: синий фаянс с чёрной сеткой (ящик Аменхотепа III) или слоновая кость с утопленными
 * клетками (ящик Тутанхамона); на домах 15, 26–30 — знаки чёрной краской: анх, нефер, вода, три и две черты, солнце.
 * Фишки — конусы и катушки, вышедшие — в выдвинутом ящике справа. Бросок — четыре палочки в боковой панели.
 * Ход человека: бросок, затем касание фишки и подсвеченной клетки. */
import { Sound } from '../../core/audio';
import { h, sleep, touchScreen } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { cell, legal, OFF, WATER, type Action, type Event, type State } from './engine';
import './senet.css';

const G = 100;
const M = 36;
const BW = 10 * G + 2 * M;
const BH = 3 * G + 2 * M;
const FACE = 54;
const DX = BW + 22;
const DW = 190;
const W = DX + DW + 6;
const H = BH + FACE + 8;

type Pt = [number, number];
type Look = { glaze: boolean; ink: string };

/** Центр клетки 1–30. */
function xy(p: number): Pt {
  const [c, r] = cell(p);
  return [M + c * G + G / 2, M + r * G + G / 2];
}

/** Место вышедшей фишки в ящике: сторона 0 — верхняя половина, 1 — нижняя. */
function drawerXY(side: number, k: number): Pt {
  return [DX + 42 + (k % 3) * 53, (side === 0 ? 46 : BH / 2 + 34) + Math.floor(k / 3) * 44];
}

/** Знаки на домах (чёрной краской по глазури или по кости). */
function sign(p: number, ink: string): string {
  const [x, y] = xy(p);
  const st = `fill="none" stroke="${ink}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"`;
  switch (p) {
    case 15: // анх
      return `<g ${st}><ellipse cx="${x}" cy="${y - 18}" rx="11" ry="15"/><path d="M${x - 22} ${y + 2}H${x + 22}M${x} ${y - 3}V${y + 34}"/></g>`;
    case 26: // нефер — «красота»
      return `<g ${st}><path d="M${x} ${y - 34}V${y - 8}M${x - 9} ${y - 24}H${x + 9}"/><path d="M${x - 16} ${y - 6}Q${x - 22} ${y + 26} ${x} ${y + 32}Q${x + 22} ${y + 26} ${x + 16} ${y - 6}Z"/></g>`;
    case WATER: // вода — три волны
      return `<g ${st} stroke-width="4">${[-16, 0, 16].map((d) => `<path d="M${x - 30} ${y + d}l7.5 -7 7.5 7 7.5 -7 7.5 7 7.5 -7 7.5 7 7.5 -7"/>`).join('')}</g>`;
    case 28:
      return `<g ${st}>${[-18, 0, 18].map((d) => `<path d="M${x + d} ${y - 24}V${y + 24}"/>`).join('')}</g>`;
    case 29:
      return `<g ${st}>${[-10, 10].map((d) => `<path d="M${x + d} ${y - 24}V${y + 24}"/>`).join('')}</g>`;
    case 30: // солнце Ра
      return `<g ${st}><circle cx="${x}" cy="${y}" r="20"/><circle cx="${x}" cy="${y}" r="4" fill="${ink}"/></g>`;
  }
  return '';
}

function defs(): string {
  return `<defs>
    <linearGradient id="sn-glaze" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3d8cf0"/><stop offset="0.5" stop-color="#1f6ad4"/><stop offset="1" stop-color="#1650b0"/></linearGradient>
    <linearGradient id="sn-glaze-face" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1a58bc"/><stop offset="1" stop-color="#0e3a86"/></linearGradient>
    <linearGradient id="sn-ivory" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f7ebcb"/><stop offset="0.6" stop-color="#ead5a4"/><stop offset="1" stop-color="#d8bd82"/></linearGradient>
    <linearGradient id="sn-ivory-face" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#dcc28c"/><stop offset="1" stop-color="#b8975a"/></linearGradient>
    <radialGradient id="sn-cone" cx="35%" cy="30%" r="80%"><stop offset="0" stop-color="#fffdf4"/><stop offset="0.55" stop-color="#eadfc0"/><stop offset="1" stop-color="#a8966a"/></radialGradient>
    <linearGradient id="sn-spool" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#121634"/><stop offset="0.35" stop-color="#4a5cc4"/><stop offset="0.6" stop-color="#26307a"/><stop offset="1" stop-color="#0c0f26"/></linearGradient>
    <linearGradient id="sn-spool-top" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6c7ee0"/><stop offset="1" stop-color="#202a70"/></linearGradient>
    <filter id="sn-blur" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="5"/></filter>
    <filter id="sn-speck" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="3" result="n"/>
      <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.85  0 0 0 0 0.92  0 0 0 0 1  0 0 0 0.5 -0.32" result="g"/>
      <feComposite in="g" in2="SourceGraphic" operator="in" result="t"/>
      <feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="t"/></feMerge>
    </filter>
    <filter id="sn-grain" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.02 0.5" numOctaves="2" seed="8" result="n"/>
      <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.45  0 0 0 0 0.3  0 0 0 0 0.1  0 0 0 0.35 -0.08" result="g"/>
      <feComposite in="g" in2="SourceGraphic" operator="in" result="t"/>
      <feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="t"/></feMerge>
    </filter>
    <filter id="sn-shadow" x="-5%" y="-10%" width="110%" height="130%"><feDropShadow dx="0" dy="12" stdDeviation="10" flood-opacity="0.5"/></filter>
  </defs>`;
}

function board(look: Look): string {
  const ink = look.ink;
  let o = defs();
  const top = look.glaze ? 'url(#sn-glaze)' : 'url(#sn-ivory)';
  const face = look.glaze ? 'url(#sn-glaze-face)' : 'url(#sn-ivory-face)';
  o += `<g filter="url(#sn-shadow)">`;
  // боковая стенка ящика с орнаментом (как на ящике Аменхотепа: картуши и столбцы)
  o += `<rect x="0" y="${BH - 20}" width="${BW}" height="${FACE + 20}" rx="10" fill="${face}" ${look.glaze ? 'filter="url(#sn-speck)"' : 'filter="url(#sn-grain)"'}/>`;
  o += `<rect x="0" y="0" width="${BW}" height="${BH}" rx="10" fill="${top}" ${look.glaze ? 'filter="url(#sn-speck)"' : 'filter="url(#sn-grain)"'}/>`;
  o += `</g>`;
  for (let i = 0; i < 10; i++) {
    const x = 20 + i * ((BW - 40) / 10);
    const w = (BW - 40) / 10 - 12;
    o += `<rect x="${x + 6}" y="${BH + 6}" width="${w}" height="${FACE - 16}" rx="${w / 3}" fill="none" stroke="${ink}" stroke-opacity="0.55" stroke-width="2.5"/>`;
    o += `<path d="M${x + 6 + w / 2} ${BH + 12}v${FACE - 28}" stroke="${ink}" stroke-opacity="0.45" stroke-width="2.5"/>`;
  }
  if (look.glaze) {
    o += `<rect x="${M - 6}" y="${M - 6}" width="${10 * G + 12}" height="${3 * G + 12}" fill="none" stroke="${ink}" stroke-width="6"/>`;
    let d = '';
    for (let i = 1; i < 10; i++) d += `M${M + i * G} ${M}V${M + 3 * G}`;
    for (let j = 1; j < 3; j++) d += `M${M} ${M + j * G}H${M + 10 * G}`;
    o += `<path d="${d}" stroke="${ink}" stroke-width="5" stroke-linecap="round" opacity="0.92"/>`;
  } else {
    // утопленные клетки в кости
    for (let p = 1; p <= 30; p++) {
      const [x, y] = xy(p);
      o += `<rect x="${x - G / 2 + 7}" y="${y - G / 2 + 7}" width="${G - 14}" height="${G - 14}" rx="4" fill="#e3c992" stroke="#8a6630" stroke-opacity="0.6" stroke-width="2"/>`;
      o += `<path d="M${x - G / 2 + 8} ${y + G / 2 - 8}V${y - G / 2 + 8}H${x + G / 2 - 8}" fill="none" stroke="#6a4a1c" stroke-opacity="0.45" stroke-width="5"/>`;
    }
  }
  // номера клеток — мелко в углу, чтобы был виден путь змейкой
  for (let p = 1; p <= 30; p++) {
    const [x, y] = xy(p);
    o += `<text x="${x - G / 2 + 12}" y="${y - G / 2 + 24}" class="sn-num" fill="${ink}">${p}</text>`;
    o += sign(p, ink);
  }
  // стрелки хода у концов рядов
  const arrow = (x: number, y: number, dir: number) => `<path d="M${x} ${y}l${dir * -12} -9v18z" fill="${ink}" opacity="0.6"/>`;
  o += arrow(M + 10 * G + 22, M + G / 2, 1) + arrow(M - 22, M + G * 1.5, -1) + arrow(M + 10 * G + 22, M + G * 2.5, 1);
  // выдвинутый ящик
  o += `<g filter="url(#sn-shadow)"><rect x="${DX}" y="10" width="${DW}" height="${BH + FACE - 14}" rx="10" fill="${face}" ${look.glaze ? 'filter="url(#sn-speck)"' : 'filter="url(#sn-grain)"'}/></g>`;
  o += `<rect x="${DX + 10}" y="20" width="${DW - 20}" height="${BH + FACE - 34}" rx="6" fill="#000" opacity="0.32"/>`;
  o += `<path d="M${DX + 14} ${BH / 2 + 8}H${DX + DW - 14}" stroke="${ink}" stroke-width="4" opacity="0.5"/>`;
  o += `<text x="${DX + DW / 2}" y="${BH + FACE - 12}" class="sn-dlabel">вышли</text>`;
  return o;
}

function cone(): string {
  return `<ellipse cx="6" cy="34" rx="34" ry="12" fill="#000" opacity="0.45" filter="url(#sn-blur)"/>
    <path d="M-30 28Q-28 -6 -8 -26Q0 -34 8 -26Q28 -6 30 28Q0 40 -30 28Z" fill="url(#sn-cone)" stroke="#6e5a30" stroke-width="2"/>
    <circle cx="0" cy="-30" r="10" fill="url(#sn-cone)" stroke="#6e5a30" stroke-width="2"/>
    <circle class="sn-ring" r="44"/>`;
}

function spool(): string {
  return `<ellipse cx="6" cy="34" rx="34" ry="12" fill="#000" opacity="0.45" filter="url(#sn-blur)"/>
    <path d="M-28 28Q-26 16 -14 6Q-10 0 -14 -8Q-26 -16 -30 -22L30 -22Q26 -16 14 -8Q10 0 14 6Q26 16 28 28Q0 38 -28 28Z" fill="url(#sn-spool)" stroke="#070818" stroke-width="2"/>
    <ellipse cx="0" cy="-22" rx="31" ry="11" fill="url(#sn-spool-top)" stroke="#070818" stroke-width="2"/>
    <ellipse cx="-8" cy="-24" rx="12" ry="3.5" fill="#fff" opacity="0.3"/>
    <circle class="sn-ring" r="44"/>`;
}

/** Палочка: светлая сторона — кость с закруглённым концом, тёмная — чёрное дерево. */
function stick(light: number, i: number): string {
  const y = 8 + i * 22;
  return `<g class="sn-stick"><rect x="6" y="${y}" width="150" height="15" rx="7.5" fill="${light ? '#f1e6c8' : '#3a2412'}" stroke="#1a1006" stroke-width="1.5"/>
    ${light ? `<path d="M128 ${y + 2}v11M134 ${y + 2}v11" stroke="#a0886a" stroke-width="1.5"/>` : `<path d="M14 ${y + 5}H120" stroke="#5a3a1e" stroke-width="2"/>`}</g>`;
}

class SenetView implements GameView<State, Event> {
  private ctx!: ViewCtx;
  private svg!: SVGSVGElement;
  private gBoard!: SVGGElement;
  private gPieces!: SVGGElement;
  private gMarks!: SVGGElement;
  private sticksBox!: HTMLElement;
  private info!: HTMLElement;
  private rollBtn!: HTMLButtonElement;
  private s: State | null = null;
  private lookKey = '';
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
    const wrap = h(`<div class="sn-wrap"><svg class="sn-board" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
        <g class="sn-g"></g><g class="sn-last"></g><g class="sn-marks"></g><g class="sn-pcs"></g></svg></div>`);
    root.appendChild(wrap);
    this.svg = wrap.querySelector('svg') as SVGSVGElement;
    this.gBoard = this.svg.querySelector('.sn-g') as SVGGElement;
    this.gPieces = this.svg.querySelector('.sn-pcs') as SVGGElement;
    this.gMarks = this.svg.querySelector('.sn-marks') as SVGGElement;
    const ctl = h(`<div class="sb-controls">
        <div class="sn-sticks"></div>
        <div class="sn-info"></div>
        ${ctx.demo ? '' : `<button class="btn primary sb-roll" data-tap disabled>Бросить палочки</button><div class="hint small-hint">${touchScreen() ? 'Бросок — кнопкой или тапом по доске.' : 'Пробел — бросок.'} Потом — фишку и клетку, куда её поставить.</div>`}
      </div>`);
    ctx.controls.appendChild(ctl);
    this.sticksBox = ctl.querySelector('.sn-sticks') as HTMLElement;
    this.info = ctl.querySelector('.sn-info') as HTMLElement;
    this.rollBtn = (ctl.querySelector('.sb-roll') as HTMLButtonElement) || document.createElement('button');
    this.rollBtn.onclick = () => this.roll();
    this.svg.addEventListener('click', (e) => this.click(e));
    if (!ctx.demo) document.addEventListener('keydown', this.onKey);
    this.sticks([], 0);
  }

  private look(): Look {
    return this.s?.cfg.look === 'ivory' ? { glaze: false, ink: '#3a2410' } : { glaze: true, ink: '#0b1430' };
  }

  private sticks(st: number[], v: number, rolling = false) {
    const vals = st.length ? st : [0, 0, 0, 0];
    this.sticksBox.innerHTML = `<svg viewBox="0 0 162 96" class="sn-ssvg${rolling ? ' rolling' : ''}">${vals.map((u, i) => stick(u, i)).join('')}</svg>
      <b class="sn-val">${st.length ? v : '–'}</b>`;
  }

  private text() {
    const s = this.s;
    if (!s) return;
    this.info.innerHTML = `<div>Вышли: ${this.ctx.name(s.seats[0])} <b>${s.off[0]}</b> · ${this.ctx.name(s.seats[1])} <b>${s.off[1]}</b> из ${s.cfg.pieces}</div>`;
  }

  private pieceEl(side: number, x: number, y: number, p: number, scale = 1): SVGGElement {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', `sn-pc sn-s${side}`);
    g.innerHTML = side === 0 ? cone() : spool();
    g.setAttribute('transform', `translate(${x} ${y}) scale(${scale})`);
    g.dataset.p = String(p);
    g.dataset.side = String(side);
    return g;
  }

  private layout(s: State) {
    const key = s.cfg.look === 'ivory' ? 'ivory' : 'faience';
    if (key !== this.lookKey) {
      this.lookKey = key;
      this.gBoard.innerHTML = board(this.look());
    }
    this.gPieces.innerHTML = '';
    for (let p = 1; p <= 30; p++) {
      if (s.board[p] < 0) continue;
      const [x, y] = xy(p);
      this.gPieces.appendChild(this.pieceEl(s.board[p], x, y, p));
    }
    for (const side of [0, 1])
      for (let k = 0; k < s.off[side]; k++) {
        const [x, y] = drawerXY(side, k);
        this.gPieces.appendChild(this.pieceEl(side, x, y, OFF, 0.5));
      }
    const lg = this.svg.querySelector('.sn-last') as SVGGElement;
    lg.innerHTML = '';
    if (s.last && s.last.to < OFF) {
      const [x, y] = xy(s.last.to);
      lg.innerHTML = `<rect x="${x - G / 2 + 4}" y="${y - G / 2 + 4}" width="${G - 8}" height="${G - 8}" rx="8" class="sn-lastc"/>`;
    }
  }

  setView(v: State) {
    this.s = v;
    this.layout(v);
    this.sticks(v.sticks, v.value);
    this.text();
  }

  private elAt(p: number): SVGGElement | null {
    return this.gPieces.querySelector(`.sn-pc[data-p="${p}"]`);
  }

  private async slide(el: SVGGElement, path: Pt[], ms: number) {
    el.classList.add('anim');
    this.gPieces.appendChild(el);
    for (const [x, y] of path) {
      el.setAttribute('transform', `translate(${x} ${y})`);
      Sound.step();
      await sleep(ms);
    }
  }

  async play(events: Event[], v: State) {
    const sp = this.ctx.speed();
    for (const ev of events) {
      if (ev.type === 'roll') {
        this.sticks(ev.sticks, ev.value, true);
        Sound.diceRoll(0.45);
        await sleep(480 / sp);
        this.sticks(ev.sticks, ev.value);
        if (ev.none) {
          Sound.nomove();
          await sleep(500 / sp);
        }
      } else if (ev.type === 'move') {
        const s = this.s!;
        const el = this.elAt(ev.from);
        const other = ev.swap ? this.elAt(ev.to) : null;
        if (el) {
          const path: Pt[] = [];
          const dir = ev.to > ev.from ? 1 : -1;
          for (let p = ev.from + dir; dir > 0 ? p <= Math.min(ev.to, 30) : p >= ev.to; p += dir) path.push(xy(p));
          if (ev.to === OFF) path.push(drawerXY(ev.side, s.off[ev.side]));
          await this.slide(el, path, 140 / sp);
          if (other) {
            Sound.capture();
            await this.slide(other, [xy(ev.from)], 200 / sp);
          }
          if (ev.water) {
            Sound.nomove();
            await sleep(200 / sp);
            await this.slide(el, [xy(ev.water)], 380 / sp);
          }
          if (ev.to === OFF) Sound.home();
        }
        const n: State = { ...s, board: s.board.slice(), off: s.off.slice() };
        n.board[ev.from] = ev.swap ? 1 - ev.side : -1;
        if (ev.to === OFF) n.off[ev.side]++;
        else if (ev.water) n.board[ev.water] = ev.side;
        else n.board[ev.to] = ev.side;
        n.last = { side: ev.side, from: ev.from, to: ev.water || ev.to };
        this.s = n;
        this.layout(n);
        await sleep(160 / sp);
      } else if (ev.type === 'end') Sound.win();
    }
    this.s = v;
    this.layout(v);
    this.sticks(v.sticks, v.value);
    this.text();
  }

  private clearTurn() {
    this.rollBtn.disabled = true;
    this.rollBtn.classList.remove('pulse');
    this.rollSeat = null;
    this.moveSeat = null;
    this.sel = null;
    for (const el of this.gPieces.querySelectorAll('.sn-pc')) el.classList.remove('can', 'sel');
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
    for (const m of moves) this.elAt(m.from)?.classList.add('can');
    if (moves.length === 1) this.select(moves[0].from);
  }

  private select(from: number) {
    const s = this.s!;
    const m = legal(s).find((x) => x.from === from);
    if (!m) return;
    this.sel = from;
    for (const el of this.gPieces.querySelectorAll('.sn-pc')) el.classList.remove('sel');
    this.elAt(from)?.classList.add('sel');
    const [x, y] = m.to === OFF ? drawerXY(s.cur, s.off[s.cur]) : xy(m.to);
    const r = m.to === OFF ? 26 : 46;
    this.gMarks.innerHTML = `<g class="sn-target${m.back ? ' back' : ''}${m.to === WATER ? ' water' : ''}" data-to="1" transform="translate(${x} ${y})"><circle r="${r}"/><circle r="10" class="sn-dot"/></g>`;
  }

  private send(from: number) {
    const seat = this.moveSeat;
    if (seat == null) return;
    this.clearTurn();
    Sound.unlock();
    this.ctx.act(seat, { type: 'move', from } as Action);
  }

  private click(e: MouseEvent) {
    if (!this.s || this.moveSeat == null) return;
    if ((e.target as Element).closest('[data-to]') && this.sel != null) {
      e.stopPropagation();
      this.send(this.sel);
      return;
    }
    const pc = (e.target as Element).closest('.sn-pc.can') as SVGGElement | null;
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
    if (s.phase === 'roll') return `${who}: бросайте палочки`;
    const back = legal(s)[0]?.back ? ' (вперёд хода нет — назад)' : '';
    return `${who}: выпало ${s.value}${back} — выберите фишку и поставьте её на подсвеченную клетку`;
  }

  playerStats(s: State, seat: number) {
    const side = s.seats.indexOf(seat);
    return side < 0 ? '' : `<span title="Вышли">🏁 ${s.off[side]}</span>`;
  }

  destroy() {
    document.removeEventListener('keydown', this.onKey);
  }
}

export function createView(): GameView<State, Event> {
  return new SenetView();
}
