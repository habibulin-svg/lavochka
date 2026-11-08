/* «Стрелки» — отрисовка: асфальт, на нём цветным мелом стрелки-змейки. Нажали — стрелка ползёт вперёд по своему телу
 * (хвост повторяет изгибы) и улетает за край; упёрлась — доползает до соседки, та вздрагивает, стрелка возвращается.
 * Сверху — сердца, сколько стрелок осталось, время. Подсказка мигает над свободной стрелкой. */
import { Sound } from '../../core/audio';
import { gameNow } from '../../core/clock';
import { h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { boardOf, DX, DY, left, type Action, type Arrow, type Board, type Event, type State } from './engine';
import './strelki.css';

const NS = 'http://www.w3.org/2000/svg';
const S = 100;
const PAD = 26;

const cx = (w: number, i: number) => (i % w) * S + S / 2;
const cy = (w: number, i: number) => Math.floor(i / w) * S + S / 2;

/** Наконечник для стрелки, смотрящей вправо, с остриём в (tip, 0). */
const HEAD = 'M-30 -34 L34 0 L-30 34 Q-18 0 -30 -34 Z';
const ANG = [-90, 0, 90, 180];

function bodyPath(w: number, a: Arrow, extra = 0): string {
  const pts = a.cells.map((i) => [cx(w, i), cy(w, i)]);
  if (extra) {
    const [x, y] = pts[pts.length - 1];
    pts.push([x + DX[a.dir] * extra, y + DY[a.dir] * extra]);
  }
  return 'M' + pts.map((p) => p.join(' ')).join(' L');
}

interface Live {
  g: SVGGElement;
  body: SVGPathElement;
  head: SVGGElement;
  len: number;
  busy: boolean;
}

class StrelkiView implements GameView<State, Event> {
  private ctx!: ViewCtx<Action>;
  private svg!: SVGSVGElement;
  private layer!: SVGGElement;
  private hud!: HTMLElement;
  private btns!: HTMLElement;
  private s: State | null = null;
  private key = '';
  private els: (Live | null)[] = [];
  private actSeat: number | null = null;
  private timer = 0;

  mount(root: HTMLElement, ctx: ViewCtx<Action>) {
    this.ctx = ctx;
    const wrap = h(`<div class="st-wrap">
      <div class="st-hud"><span class="st-hearts"></span><span class="st-left"></span><span class="st-time"></span></div>
      <svg class="st-board" xmlns="${NS}"></svg>
    </div>`);
    root.appendChild(wrap);
    this.hud = wrap.querySelector('.st-hud') as HTMLElement;
    this.svg = wrap.querySelector('svg') as SVGSVGElement;
    this.btns = h(`<div class="st-btns"></div>`);
    if (!ctx.demo) {
      ctx.controls.appendChild(this.btns);
      ctx.controls.appendChild(h(`<div class="hint small-hint">Нажмите на стрелку — она улетит, если впереди до края пусто. Упёрлась — минус сердце.</div>`));
      this.timer = window.setInterval(() => this.drawHud(), 1000);
    }
    this.svg.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || this.actSeat == null) return;
      const t = (e.target as Element).closest('[data-a]') as SVGElement | null;
      if (!t) return;
      const k = Number(t.dataset.a);
      const b = this.board();
      const el = this.els[k];
      if (!b || b.gone[k] || b.done || b.failed || !el || el.busy) return;
      Sound.unlock();
      this.ctx.act(this.actSeat, { type: 'tap', a: k });
    });
  }

  destroy() {
    clearInterval(this.timer);
  }

  private bi(s: State) {
    const me = this.ctx.mySeats.find((x) => s.seats.includes(x));
    return me != null ? boardOf(s, me) : 0;
  }

  private board(): Board | null {
    return this.s ? this.s.boards[this.bi(this.s)] : null;
  }

  // ------------------------------------------------------------ поле

  private build(s: State) {
    const c = s.cfg;
    const key = `${c.w}:${c.level}:${c.shape}:${s.arrows.length}:${s.arrows[0]?.cells.join(',')}`;
    if (key === this.key) return;
    this.key = key;
    const W = c.w * S;
    const H = c.h * S;
    this.svg.setAttribute('viewBox', `${-PAD} ${-PAD} ${W + PAD * 2} ${H + PAD * 2}`);
    let dots = '';
    for (let i = 0; i < c.w * c.h; i++) dots += `<circle cx="${cx(c.w, i)}" cy="${cy(c.w, i)}" r="5"/>`;
    this.svg.innerHTML = `<defs>
        <filter id="st-chalk" x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves="2" seed="3" result="n"/>
          <feDisplacementMap in="SourceGraphic" in2="n" scale="9" xChannelSelector="R" yChannelSelector="G" result="d"/>
          <feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="1" seed="8" result="g"/>
          <feColorMatrix in="g" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.6 1.25" result="m"/>
          <feComposite in="d" in2="m" operator="in"/>
        </filter>
        <filter id="st-asphalt" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves="3" seed="11"/>
          <feColorMatrix type="matrix" values="0 0 0 0 0.16  0 0 0 0 0.16  0 0 0 0 0.17  0 0 0 -2.2 1.3"/>
        </filter>
        <clipPath id="st-clip"><rect x="${-PAD}" y="${-PAD}" width="${W + PAD * 2}" height="${H + PAD * 2}" rx="18"/></clipPath>
      </defs>
      <rect x="${-PAD}" y="${-PAD}" width="${W + PAD * 2}" height="${H + PAD * 2}" rx="18" class="st-ground"/>
      <rect x="${-PAD}" y="${-PAD}" width="${W + PAD * 2}" height="${H + PAD * 2}" rx="18" filter="url(#st-asphalt)" opacity="0.9"/>
      <rect x="-8" y="-8" width="${W + 16}" height="${H + 16}" rx="10" class="st-frame" filter="url(#st-chalk)"/>
      <g class="st-dots">${dots}</g>
      <g clip-path="url(#st-clip)"><g class="st-arrows" filter="url(#st-chalk)"></g></g>`;
    this.layer = this.svg.querySelector('.st-arrows') as SVGGElement;
    this.els = s.arrows.map((a, k) => this.arrowEl(s, a, k));
  }

  private arrowEl(s: State, a: Arrow, k: number): Live {
    const w = s.cfg.w;
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('class', `st-arrow t${a.tone}`);
    g.dataset.a = String(k);
    const d = bodyPath(w, a);
    const head = a.cells[a.cells.length - 1];
    g.innerHTML = `<path d="${d}" class="st-hit"/><path d="${d}" class="st-body"/>
      <g class="st-head" transform="translate(${cx(w, head)} ${cy(w, head)})"><path d="${HEAD}" transform="rotate(${ANG[a.dir]}) translate(8 0)"/></g>`;
    this.layer.appendChild(g);
    return { g, body: g.querySelector('.st-body') as SVGPathElement, head: g.querySelector('.st-head') as SVGGElement, len: (a.cells.length - 1) * S, busy: false };
  }

  private draw() {
    const s = this.s;
    const b = this.board();
    if (!s || !b) return;
    this.build(s);
    s.arrows.forEach((_, k) => {
      const el = this.els[k];
      if (!el) return;
      if (b.gone[k] && !el.busy) {
        el.g.remove();
        this.els[k] = null;
        return;
      }
      el.g.classList.toggle('hint', b.hint === k);
    });
    this.svg.classList.toggle('can', this.actSeat != null && !b.done && !b.failed);
    this.drawHud();
  }

  private drawHud() {
    const s = this.s;
    const b = this.board();
    if (!s || !b) return;
    const hearts = this.hud.querySelector('.st-hearts') as HTMLElement;
    hearts.innerHTML = s.cfg.lives
      ? Array.from({ length: s.cfg.lives }, (_, k) => `<i class="${k < b.lives ? 'on' : ''}">❤</i>`).join('')
      : `<span class="st-err">ошибок: ${b.mistakes}</span>`;
    (this.hud.querySelector('.st-left') as HTMLElement).textContent = `стрелок: ${left(b)} из ${s.arrows.length}`;
    const ms = (b.done || b.failed ? b.t1 : gameNow()) - b.t0;
    const sec = Math.max(0, Math.floor(ms / 1000));
    (this.hud.querySelector('.st-time') as HTMLElement).textContent = this.ctx.demo ? `уровень ${s.cfg.level}` : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  }

  private drawBtns() {
    this.btns.innerHTML = '';
    const s = this.s;
    const b = this.board();
    if (!s || !b || this.ctx.demo || this.actSeat == null || !s.cfg.hints || s.done || b.done || b.failed) return;
    const u = h<HTMLButtonElement>(`<button class="btn small">💡 Подсказка${b.hints ? ` (${b.hints})` : ''}</button>`);
    u.onclick = () => this.actSeat != null && this.ctx.act(this.actSeat, { type: 'hint' });
    this.btns.appendChild(u);
  }

  // ------------------------------------------------------------ полёт

  private anim(dur: number, f: (p: number) => void): Promise<void> {
    return new Promise((res) => {
      const t0 = performance.now();
      const tick = (t: number) => {
        const p = Math.min(1, (t - t0) / dur);
        f(p);
        if (p < 1) requestAnimationFrame(tick);
        else res();
      };
      requestAnimationFrame(tick);
    });
  }

  /** Сдвинуть стрелку вперёд на t (в единицах поля): тело — окном по продлённому пути, наконечник — по лучу. */
  private shift(s: State, k: number, el: Live, t: number) {
    const a = s.arrows[k];
    el.body.style.strokeDashoffset = String(-t);
    const head = a.cells[a.cells.length - 1];
    el.head.setAttribute('transform', `translate(${cx(s.cfg.w, head) + DX[a.dir] * t} ${cy(s.cfg.w, head) + DY[a.dir] * t})`);
  }

  private prep(s: State, k: number, el: Live, extra: number) {
    el.body.setAttribute('d', bodyPath(s.cfg.w, s.arrows[k], extra));
    el.body.style.strokeDasharray = `${el.len} 100000`;
    el.busy = true;
    // летящая — поверх остальных
    this.layer.appendChild(el.g);
  }

  private async fly(s: State, k: number) {
    const el = this.els[k];
    if (!el || el.busy) return;
    const extra = (s.cfg.w + s.cfg.h + 2) * S + el.len;
    this.prep(s, k, el, extra);
    el.g.classList.add('flying');
    el.g.classList.remove('hint');
    const a = s.arrows[k];
    const head = a.cells[a.cells.length - 1];
    const toEdge = a.dir === 1 ? (s.cfg.w - (head % s.cfg.w)) : a.dir === 3 ? (head % s.cfg.w) + 1 : a.dir === 2 ? s.cfg.h - Math.floor(head / s.cfg.w) : Math.floor(head / s.cfg.w) + 1;
    const dist = (toEdge + 1) * S + el.len + PAD;
    const speed = this.ctx.demo ? 1 / this.ctx.speed() : 1;
    await this.anim(Math.min(900, 160 + dist * 0.55) * speed, (p) => this.shift(s, k, el, dist * (p * p * 0.55 + p * 0.45)));
    el.g.remove();
    if (this.els[k] === el) this.els[k] = null;
  }

  private async bump(s: State, k: number, steps: number, by: number) {
    const el = this.els[k];
    if (!el || el.busy) return;
    this.prep(s, k, el, (steps + 1) * S);
    el.g.classList.add('bad');
    const t = steps * S + 14;
    const speed = this.ctx.demo ? 1 / this.ctx.speed() : 1;
    await this.anim((90 + t * 0.9) * speed, (p) => this.shift(s, k, el, t * p * p));
    const other = this.els[by];
    other?.g.classList.remove('shake');
    void other?.g.getBoundingClientRect();
    other?.g.classList.add('shake');
    await this.anim((120 + t * 0.8) * speed, (p) => this.shift(s, k, el, t * (1 - p) * (1 - p)));
    this.shift(s, k, el, 0);
    el.body.setAttribute('d', bodyPath(s.cfg.w, s.arrows[k]));
    el.body.style.strokeDasharray = '';
    el.busy = false;
    setTimeout(() => el.g.classList.remove('bad'), 350);
    setTimeout(() => other?.g.classList.remove('shake'), 400);
  }

  // ------------------------------------------------------------ GameView

  setView(s: State) {
    this.s = s;
    this.draw();
    this.drawBtns();
  }

  async play(events: Event[], s: State) {
    const mine = this.bi(s);
    const prev = this.s;
    this.s = s;
    this.build(s);
    const jobs: Promise<void>[] = [];
    for (const ev of events) {
      if (!('b' in ev) || ev.b !== mine) continue;
      if (ev.type === 'fly') {
        Sound.jump();
        jobs.push(this.fly(prev && prev.arrows === s.arrows ? prev : s, ev.a));
      } else if (ev.type === 'bump') {
        Sound.nomove();
        navigator.vibrate?.(60);
        jobs.push(this.bump(s, ev.a, ev.steps, ev.by));
        this.hud.classList.remove('hurt');
        void this.hud.offsetWidth;
        this.hud.classList.add('hurt');
      } else if (ev.type === 'hint') Sound.ui();
      else if (ev.type === 'clear') setTimeout(() => Sound.win(), 300);
    }
    this.draw();
    this.drawBtns();
    // в показе правил — дождаться полёта; в игре — не задерживать следующие нажатия
    if (this.ctx.demo) {
      await Promise.all(jobs);
      await sleep(350 / this.ctx.speed());
    }
  }

  setTurn(toAct: number[], interactive: number[]) {
    this.actSeat = this.ctx.demo ? null : (interactive.find((x) => toAct.includes(x)) ?? null);
    this.draw();
    this.drawBtns();
  }

  saveTitle(s: State) {
    return `Уровень ${s.cfg.level}, ${s.cfg.w} × ${s.cfg.h}`;
  }

  status(s: State) {
    if (s.done) return '';
    const b = s.boards[this.bi(s)];
    if (b.failed) return 'Сердца кончились — ждём остальных';
    if (b.done) return 'Поле чистое!';
    return `Уровень ${s.cfg.level} · ${s.cfg.w} × ${s.cfg.h}${s.cfg.mode === 'race' ? ' · наперегонки' : ''}`;
  }

  playerStats(s: State, seat: number) {
    if (s.cfg.mode === 'race') {
      const b = s.boards[boardOf(s, seat)];
      return `<span>осталось ${left(b)}${s.cfg.lives ? ` · ❤ ${b.lives}` : ''}${b.failed ? ' · выбыл' : ''}</span>`;
    }
    return s.seats.length > 1 ? `<span>выпустил: ${s.credit[seat]}</span>` : '';
  }
}

export function createView(): GameView<State, Event> {
  return new StrelkiView();
}
