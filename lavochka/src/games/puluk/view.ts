/* Пулук — отрисовка: на циновке ряд палочек (поля — промежутки между ними), по концам — корзинки-дома, воины — глиняные
 * и каменные фигурки, пленные стоят позади своего захватчика. На узком экране дорожка встаёт вертикально, свой дом — снизу.
 * Ход — касание подсвеченного воина (или своего дома), затем поля, куда его поставить. */
import { Sound } from '../../core/audio';
import { h, sleep, touchScreen } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { fwd, legalMoves, side, type Event, type Move, type Stack, type State } from './engine';
import './puluk.css';

const TEX = `${import.meta.env.BASE_URL}tex/puluk/`;
const NS = 'http://www.w3.org/2000/svg';
/** Поле, дом, высота полосы — в единицах картинки (дорожка лежит слева направо, дом стороны 0 — слева). */
const FW = 112;
const HW = 180;
const BH = 340;
const MID = BH / 2;
/** Расстояние между рядами загнутой дорожки. */
const RG = 330;
/** Высота воина и пленного. */
const WH = 160;
const PH = 80;
/** Спрайты воинов: [ширина, высота]. */
const SPR: Record<string, [number, number]> = { w0: [130, 200], w1: [121, 200] };

type Pt = [number, number];

export class PulukView implements GameView<State, Event> {
  private ctx!: ViewCtx;
  private wrap!: HTMLElement;
  private svg!: SVGSVGElement;
  private gBoard!: SVGGElement;
  private gHomes!: SVGGElement;
  private gPieces!: SVGGElement;
  private gTargets!: SVGGElement;
  private kernEls: HTMLImageElement[] = [];
  private trayVal!: HTMLElement;
  private rollBtn!: HTMLButtonElement;
  private s: State | null = null;
  private key = '';
  private rows = 2;
  private flip = false;
  private els = new Map<number, SVGGElement>();
  private moves: Move[] = [];
  private rollSeat: number | null = null;
  private autoTimer: ReturnType<typeof setTimeout> | undefined;
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
    this.wrap = h(`<div class="pl-wrap"><svg class="pl-board" xmlns="${NS}" preserveAspectRatio="xMidYMid meet"><g class="pl-g"></g><g class="pl-h"></g><g class="pl-p"></g><g class="pl-t"></g></svg></div>`);
    root.appendChild(this.wrap);
    this.svg = this.wrap.querySelector('svg') as SVGSVGElement;
    this.gBoard = this.svg.querySelector('.pl-g') as SVGGElement;
    this.gHomes = this.svg.querySelector('.pl-h') as SVGGElement;
    this.gPieces = this.svg.querySelector('.pl-p') as SVGGElement;
    this.gTargets = this.svg.querySelector('.pl-t') as SVGGElement;
    const ctl = h(`<div class="pl-controls">
        <div class="pl-tray blank">${[0, 1, 2, 3].map(() => `<img class="pl-kern" src="${TEX}kernel.webp" alt="">`).join('')}</div>
        <div class="pl-val"></div>
        ${ctx.demo ? '' : `<button class="btn primary pl-roll" data-tap disabled>Бросить зёрна</button><div class="hint small-hint">${touchScreen() ? 'Бросок — кнопкой или тапом по доске.' : 'Пробел — бросок.'} Нажмите на подсвеченного воина или свой дом, затем на поле.</div>`}
      </div>`);
    ctx.controls.appendChild(ctl);
    this.kernEls = [...ctl.querySelectorAll<HTMLImageElement>('.pl-kern')];
    this.trayVal = ctl.querySelector('.pl-val') as HTMLElement;
    this.rollBtn = (ctl.querySelector('.pl-roll') as HTMLButtonElement) || document.createElement('button');
    this.rollBtn.onclick = () => this.roll();
    const onPick = (e: MouseEvent) => {
      const el = (e.target as Element).closest('[data-c]') as SVGGElement | null;
      if (!el || !this.moves.length) return;
      e.stopPropagation();
      this.pick(Number(el.dataset.c));
    };
    this.gPieces.addEventListener('click', onPick);
    this.gHomes.addEventListener('click', onPick);
    this.gTargets.addEventListener('click', (e) => {
      const el = (e.target as Element).closest('[data-f]') as SVGGElement | null;
      if (!el || !this.s) return;
      e.stopPropagation();
      const from = Number(el.dataset.f);
      const seat = this.s.turn;
      this.clearTurn();
      Sound.unlock();
      this.ctx.act(seat, { type: 'move', from });
    });
    if (!ctx.demo) document.addEventListener('keydown', this.onKey);
    this.ro = new ResizeObserver(() => {
      if (!this.s) return;
      if (this.pickRows() !== this.rows) this.setView(this.s);
    });
    this.ro.observe(this.wrap);
    new Image().src = `${TEX}kernelm.webp`;
  }

  // ---------------------------------------------------------------- геометрия

  /** Два ряда (дорожка загнута у дальнего конца), пока экран не слишком широкий. */
  private pickRows() {
    const r = this.wrap.getBoundingClientRect();
    return r.width > r.height * 2.4 ? 1 : 2;
  }

  private cols(s: State) {
    return this.rows === 2 ? Math.ceil(s.cfg.len / 2) : s.cfg.len;
  }

  private width(s: State) {
    return this.rows === 2 ? HW + this.cols(s) * FW + 100 : HW * 2 + s.cfg.len * FW;
  }

  private height() {
    return this.rows === 2 ? BH + RG : BH;
  }

  /** Точка картинки → экран: у чёрных поле развёрнуто, свой дом — внизу слева. */
  private T(s: State, [x, y]: Pt): Pt {
    return this.flip ? [this.width(s) - x, this.height() - y] : [x, y];
  }

  /** Центр поля c (−1 и len — за концами дорожки). Нижний ряд — слева направо, верхний — обратно. */
  private field(s: State, c: number): Pt {
    if (this.rows === 1) return [HW + FW * (c + 0.5), MID];
    const k = this.cols(s);
    if (c < k) return [HW + FW * (c + 0.5), MID + RG];
    return [HW + FW * (2 * k - 1 - c + 0.5), MID];
  }

  private homeAt(s: State, sd: number): Pt {
    if (sd === 0) return [HW / 2, this.rows === 2 ? MID + RG : MID];
    if (this.rows === 1) return [this.width(s) - HW / 2, MID];
    const [x, y] = this.field(s, s.cfg.len - 1);
    return [x - FW / 2 - HW / 2, y];
  }

  private build(s: State) {
    const W = this.width(s);
    const H = this.height();
    this.svg.setAttribute('viewBox', this.rows === 2 ? `-10 -80 ${W + 20} ${H + 160}` : `-10 -70 ${W + 20} ${BH + 90}`);
    const parts: string[] = [`<g transform="${this.flip ? `matrix(-1,0,0,-1,${W},${H})` : ''}">`];
    // палочки поперёк дорожки: промежутки между ними — поля; чуть неровно, как выложены руками
    const stick = (x: number, y: number, i: number) =>
      `<image href="${TEX}stick.webp" x="-135" y="-11" width="270" height="22" transform="translate(${x},${y + Math.cos(i * 1.9) * 8}) rotate(${90 + Math.sin(i * 2.7) * 2.5})" class="pl-stick"/>`;
    const k = this.cols(s);
    for (let i = 0; i <= k; i++) parts.push(stick(HW + FW * i, this.rows === 2 ? MID + RG : MID, i));
    if (this.rows === 2) {
      const top = s.cfg.len - k;
      for (let i = k - top; i <= k; i++) parts.push(stick(HW + FW * i, MID, i + 7));
      // поворот дорожки — дугой из зёрен
      const x = HW + FW * k + 10;
      parts.push(`<path class="pl-turn" d="M${x - 40} ${MID + RG} C ${x + 90} ${MID + RG}, ${x + 90} ${MID}, ${x - 40} ${MID}"/>`);
    }
    parts.push('</g>');
    this.gBoard.innerHTML = parts.join('');
  }

  /** Картинка воина места: красные — глина, чёрные — камень; у напарников — те же фигурки другого оттенка. */
  private img(seat: number, hh: number, y = -hh * 0.92) {
    const name = `w${side(seat)}`;
    const [w0, h0] = SPR[name];
    const w = (w0 / h0) * hh;
    return `<image href="${TEX}${name}.webp" class="pl-tone${seat}" x="${-w / 2}" y="${y}" width="${w}" height="${hh}"/>`;
  }

  private stackHtml(s: State, st: Stack, c: number) {
    const parts: string[] = [];
    // пленные лежат под захватчиком, он стоит на них (стопка)
    const n = st.pris.length;
    const shown = st.pris.slice(0, 4);
    const LAY = 24;
    parts.push(`<ellipse class="pl-ring" cx="0" cy="2" rx="56" ry="20"/>`);
    shown.forEach((p, i) => {
      // фигурка на боку: длиннее основания захватчика, чтобы было видно из-под него
      parts.push(`<g transform="translate(${i % 2 ? 4 : -4},${-i * LAY - 10}) rotate(${i % 2 ? -90 : 90}) scale(0.5,1)" class="pl-pris">${this.img(p, PH * 1.45, -PH * 0.72)}</g>`);
    });
    const up = shown.length ? shown.length * LAY + 8 : 0;
    parts.push(`<g transform="translate(0,${-up})">${this.img(st.seat, WH)}</g>`);
    if (n) parts.push(`<g class="pl-badge"><circle cx="36" cy="${-up - 118}" r="15"/><text x="36" y="${-up - 112}">${n}</text></g>`);
    if (st.dir !== fwd(st.seat)) {
      // развернулся к своему дому — стрелка по ходу
      const [ax, ay] = this.T(s, this.field(s, c));
      const [bx, by] = this.T(s, this.field(s, c + st.dir));
      const ang = (Math.atan2(by - ay, bx - ax) * 180) / Math.PI;
      parts.push(`<g transform="translate(0,26) rotate(${ang})"><path class="pl-arrow" d="M-18 0 H16 M6 -9 L17 0 L6 9"/></g>`);
    }
    return parts.join('');
  }

  private renderPieces(s: State) {
    this.gPieces.innerHTML = '';
    this.els.clear();
    s.track.forEach((st, c) => {
      if (!st) return;
      const el = document.createElementNS(NS, 'g') as SVGGElement;
      el.setAttribute('class', `pl-pc pl-s${st.seat}`);
      el.dataset.c = String(c);
      el.innerHTML = this.stackHtml(s, st, c);
      this.place(el, this.T(s, this.field(s, c)));
      this.els.set(c, el);
    });
    this.order();
    this.renderHomes(s);
  }

  private place(el: SVGGElement, [x, y]: Pt) {
    el.style.transform = `translate(${x}px, ${y}px)`;
    el.dataset.y = String(y);
  }

  private order() {
    [...this.els.values()].sort((a, b) => Number(a.dataset.y) - Number(b.dataset.y)).forEach((el) => this.gPieces.appendChild(el));
  }

  /** Корзинки-дома: воины, ждущие выхода, и под ними — счёт убитых. */
  private renderHomes(s: State) {
    const parts: string[] = [];
    for (const sd of [0, 1]) {
      const [x, y] = this.T(s, this.homeAt(s, sd));
      const seats = Array.from({ length: s.n }, (_, i) => i).filter((i) => side(i) === sd);
      const list: number[] = [];
      for (const i of seats) for (let k = 0; k < s.home[i]; k++) list.push(i);
      const dead = seats.reduce((a, i) => a + s.dead[i], 0);
      parts.push(`<g class="pl-home" data-c="-1" data-side="${sd}" transform="translate(${x},${y})">`);
      parts.push(`<ellipse class="pl-ring" cx="0" cy="3" rx="96" ry="96"/><image href="${TEX}home.webp" x="-86" y="-86" width="172" height="172"/>`);
      // воины в корзинке: два-три ряда
      const per = list.length > 8 ? 4 : 3;
      const rows = Math.ceil(list.length / per);
      list.forEach((seat, i) => {
        const r = Math.floor(i / per);
        const inRow = Math.min(per, list.length - r * per);
        const dx = ((i % per) - (inRow - 1) / 2) * (per === 4 ? 32 : 40);
        const dy = (r - (rows - 1) / 2) * 34 + 28;
        parts.push(`<g transform="translate(${dx},${dy})">${this.img(seat, 64)}</g>`);
      });
      if (dead) parts.push(`<text class="pl-dead" x="0" y="112">убито: ${dead}</text>`);
      parts.push('</g>');
    }
    this.gHomes.innerHTML = parts.join('');
  }

  setView(s: State) {
    this.rows = this.pickRows();
    const mine = this.ctx.mySeats;
    this.flip = mine.length > 0 && mine.every((i) => side(i) === 1);
    const key = `${s.cfg.len}:${this.rows}:${this.flip}`;
    if (key !== this.key) {
      this.key = key;
      this.build(s);
    }
    this.s = s;
    this.renderPieces(s);
    this.showKernels(s.kernels.length ? s.kernels : null, s.value);
  }

  // ---------------------------------------------------------------- зёрна

  private showKernels(k: number[] | null, value: number) {
    this.wrapTray().classList.toggle('blank', !k);
    this.kernEls.forEach((el, i) => {
      const src = `${TEX}${k?.[i] ? 'kernelm' : 'kernel'}.webp`;
      if (el.getAttribute('src') !== src) el.setAttribute('src', src);
    });
    this.trayVal.textContent = k ? (value === 5 ? 'ни одной метки — 5' : `меток: ${value}`) : '';
  }

  private wrapTray() {
    return this.kernEls[0].parentElement as HTMLElement;
  }

  private async rollAnim(k: number[], value: number, sp: number) {
    const dur = Math.round(850 / Math.max(0.5, sp));
    Sound.diceRoll(dur / 1000);
    this.kernEls.forEach((el, i) => {
      const dx = (Math.random() * 30 - 15) * (i % 2 ? 1 : -1);
      el.animate(
        [
          { transform: `translate(${-60 + dx}px, -50px) rotate(${-200 + i * 70}deg)`, offset: 0 },
          { transform: `translate(${dx / 2}px, 4px) rotate(${-30 + i * 10}deg)`, offset: 0.6 },
          { transform: `translate(0, -3px) rotate(${i * 4 - 6}deg)`, offset: 0.82 },
          { transform: `rotate(${(i * 37) % 20 - 10}deg)`, offset: 1 },
        ],
        { duration: dur, easing: 'cubic-bezier(.25,.7,.35,1)', fill: 'forwards' },
      );
    });
    const t0 = performance.now();
    while (performance.now() - t0 < dur * 0.65) {
      this.showKernels([0, 1, 2, 3].map(() => (Math.random() < 0.5 ? 1 : 0)), 0);
      this.trayVal.textContent = '';
      await sleep(90);
    }
    await sleep(dur * 0.35);
    this.showKernels(k, value);
  }

  // ---------------------------------------------------------------- ходы

  async play(events: Event[], v: State) {
    const sp = this.ctx.speed();
    this.clearTurn();
    for (const ev of events) {
      if (ev.type === 'roll') {
        await this.rollAnim(ev.kernels, ev.value, sp);
        if (ev.none) {
          Sound.nomove();
          await sleep(800 / sp);
        }
      } else if (ev.type === 'move' && this.s) {
        const s = this.s;
        let el = this.els.get(ev.from);
        if (ev.from < 0) {
          // новый воин выходит из корзинки
          el = document.createElementNS(NS, 'g') as SVGGElement;
          el.setAttribute('class', `pl-pc pl-s${ev.seat}`);
          el.innerHTML = this.stackHtml(s, { seat: ev.seat, dir: fwd(ev.seat), pris: [] }, 0);
          this.place(el, this.T(s, this.homeAt(s, side(ev.seat))));
          this.gPieces.appendChild(el);
          Sound.enter();
          await sleep(60);
        }
        if (el) {
          el.classList.add('anim');
          this.gPieces.appendChild(el);
          for (const c of ev.path) {
            this.place(el, this.T(s, this.field(s, c)));
            Sound.step();
            await sleep(Math.max(70, 170 / sp));
          }
          if (ev.to < 0) {
            // ушёл с дорожки — к дому соперника (или к своему, если развернулся)
            const st = s.track[ev.from];
            const dir = st ? st.dir : fwd(ev.seat);
            const end = this.field(s, dir === 1 ? s.cfg.len : -1);
            this.place(el, this.T(s, end));
            await sleep(Math.max(90, 200 / sp));
            if (ev.killed) Sound.capture();
            el.classList.add('gone');
            await sleep(380 / sp);
          }
          el.classList.remove('anim');
        }
        if (ev.took) {
          Sound.capture();
          await sleep(300 / sp);
        }
        this.s = { ...s };
      } else if (ev.type === 'end' && ev.winner != null) Sound.win();
    }
    this.s = v;
    this.renderPieces(v);
    this.showKernels(v.kernels.length ? v.kernels : null, v.value);
  }

  private clearTurn() {
    clearTimeout(this.autoTimer);
    this.rollBtn.disabled = true;
    this.rollBtn.classList.remove('pulse');
    this.rollSeat = null;
    this.moves = [];
    this.gTargets.innerHTML = '';
    for (const el of this.els.values()) el.classList.remove('can', 'sel');
    this.gHomes.querySelectorAll('.pl-home').forEach((el) => el.classList.remove('can', 'sel'));
  }

  private homeEl(s: State) {
    return this.gHomes.querySelector(`.pl-home[data-side="${side(s.turn)}"]`);
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
    for (const m of this.moves) (m.from < 0 ? this.homeEl(s) : this.els.get(m.from))?.classList.add('can');
    if (this.moves.length === 1) this.pick(this.moves[0].from);
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

  /** Выбрали воина (или дом) — показываем поле, куда он встанет. */
  private pick(from: number) {
    const s = this.s!;
    const m = this.moves.find((x) => x.from === from);
    if (!m) return;
    for (const el of this.els.values()) el.classList.remove('sel');
    this.homeEl(s)?.classList.remove('sel');
    (from < 0 ? this.homeEl(s) : this.els.get(from))?.classList.add('sel');
    let at: Pt;
    let label = '';
    if (m.to >= 0) at = this.field(s, m.to);
    else {
      const dir = s.track[from]!.dir;
      at = this.field(s, dir === 1 ? s.cfg.len : -1);
      label = 'домой';
    }
    const [x, y] = this.T(s, at);
    const hit = m.took || m.killed;
    this.gTargets.innerHTML = `<g class="pl-target${hit ? ' hit' : ''}" data-f="${from}"><circle cx="${x}" cy="${y - 30}" r="42"/>${label ? `<text x="${x}" y="${y - 22}">${label}</text>` : ''}</g>`;
  }

  private roll() {
    if (this.rollSeat == null) return;
    Sound.unlock();
    const seat = this.rollSeat;
    this.clearTurn();
    this.ctx.act(seat, { type: 'roll' });
  }

  status(s: State, _toAct: number[], interactive: number[]) {
    if (s.phase === 'over') {
      if (s.winner == null) return 'Ничья';
      const w = Array.from({ length: s.n }, (_, i) => i).filter((i) => side(i) === s.winner);
      return `Победа: ${w.map((i) => this.ctx.name(i)).join(' и ')}!`;
    }
    const who = this.ctx.name(s.turn);
    if (!interactive.includes(s.turn)) return s.phase === 'roll' ? `${who} бросает…` : `${who} ходит…`;
    if (s.phase === 'roll') return `Ход: ${who} — бросайте зёрна`;
    return `${who}: ходите на ${s.value}`;
  }

  playerStats(s: State, seat: number) {
    let out = 0;
    for (const st of s.track) if (st && st.seat === seat) out++;
    let caught = 0;
    for (const st of s.track) if (st) caught += st.pris.filter((p) => p === seat).length;
    return `<span title="Дома">⌂ ${s.home[seat]}</span><span title="На дорожке">⚑ ${out}</span><span title="В плену">⛓ ${caught}</span><span title="Убито">✝ ${s.dead[seat]}</span>`;
  }

  destroy() {
    clearTimeout(this.autoTimer);
    this.ro?.disconnect();
    document.removeEventListener('keydown', this.onKey);
  }
}

export const createView = () => new PulukView();
