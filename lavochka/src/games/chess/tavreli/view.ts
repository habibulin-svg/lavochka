/* Таврели — отрисовка: та же складная доска, что у шахмат, а фигуры — точёные шайбы-таврели (картинки конвейера,
 * studio/jobs/tavreli/01-pieces.yaml → public/chess/tavreli/), знак выжжен на верхней грани (рисуется кодом, как надпись).
 * Башня — стопка шайб; выбрал башню — сбоку список её таврелей: нажмите, до какой поднять (по умолчанию — всю). */
import { Sound } from '../../../core/audio';
import { h, sleep } from '../../../core/util';
import type { GameView, ViewCtx } from '../../../core/view';
import { woodTexture, WOODS } from '../../../core/wood';
import { fileOf, inCheck, legalMoves, NAME, rankOf, sqName, top, volkhvSq, type Kind, type Stack, type TAction, type TEvent, type TMove, type TState } from './engine';
import '../chess.css';
import './tavreli.css';

const NS = 'http://www.w3.org/2000/svg';
const SQ = 80;
const F = 44;
const W = F * 2 + SQ * 8;

/** Картинки шайб и где на них верхняя грань (доли картинки) — подогнано под вырезку конвейера. */
const ART = '/chess/tavreli/';
export const SPR = {
  /** ширина шайбы на доске и пропорция картинки (высота / ширина) */
  w: SQ * 0.84,
  aspect: 228 / 256,
  /** верхняя грань: центр и полуоси (доли ширины картинки) */
  cx: 0.49,
  cy: 0.31,
  rx: 0.44,
  ry: 0.28,
  /** высота стенки (передней грани восьмигранника) — на столько поднимается следующая шайба (доля ширины) */
  wall: 0.27,
  /** нижний край стенки над низом картинки (скругление) и середина передней грани по горизонтали — доли ширины */
  foot: 0.02,
  wx: 0.47,
};
/** Башня выше этого (px) — шайбы сжимаются плотнее. */
const MAX_RISE = SQ * 0.95;

/** Знаки таврелей (единичный круг): по схеме федерации; у хелги — звезда князя с перекладинами всадника. */
const ASTER = 'M0 -.82V.82M-.82 0H.82M-.58 -.58L.58 .58M-.58 .58L.58 -.58';
const BARS = 'M-.26 -.82H.26M-.26 .82H.26M-.82 -.26V.26M.82 -.26V.26';
const SIGN: Record<Kind, string> = {
  R: 'M0 -.8V.8M-.8 0H.8',
  N: 'M0 -.8V.8M-.8 0H.8' + BARS,
  B: 'M-.66 .66L.66 -.66M-.66 -.66L.66 .66M.66 -.66H.22M.66 -.66V-.22',
  K: ASTER,
  V: ASTER + 'M.86 0A.86 .86 0 1 1 -.86 0A.86 .86 0 1 1 .86 0',
  H: ASTER + BARS,
  P: 'M-.5 -.55L0 .55L.5 -.55',
};

export class TavreliView implements GameView<TState, TEvent> {
  private ctx!: ViewCtx;
  private svg!: SVGSVGElement;
  private gMarks!: SVGGElement;
  private gPieces!: SVGGElement;
  private gTargets!: SVGGElement;
  private gBanner!: SVGGElement;
  private gCoords!: SVGGElement;
  private btns!: HTMLElement;
  private clocks!: HTMLElement;
  private tower!: HTMLElement;
  private s: TState | null = null;
  private flipped = false;
  private userFlip: boolean | null = null;
  private actSeat: number | null = null;
  private moves: TMove[] = [];
  private selected: number | null = null;
  /** Сколько верхних таврелей выбранной башни двигаем. */
  private n = 1;
  private recvAt = Date.now();
  private tick: ReturnType<typeof setInterval> | undefined;
  private flagSent = 0;
  private confirmResign = false;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    const wrap = h(`<div class="ch-wrap tv-wrap"><svg class="ch-board" xmlns="${NS}" viewBox="0 0 ${W} ${W}"></svg></div>`);
    root.appendChild(wrap);
    this.svg = wrap.querySelector('svg') as SVGSVGElement;
    this.build();
    const ctl = h(`<div class="ch-controls">
        <div class="ch-clocks" hidden></div>
        <div class="tv-tower" hidden></div>
        <div class="ch-btns"></div>
        ${ctx.demo ? '' : '<div class="hint small-hint">Нажмите на таврель или башню, потом — на подсвеченное поле.</div>'}
      </div>`);
    ctx.controls.appendChild(ctl);
    this.btns = ctl.querySelector('.ch-btns') as HTMLElement;
    this.clocks = ctl.querySelector('.ch-clocks') as HTMLElement;
    this.tower = ctl.querySelector('.tv-tower') as HTMLElement;
    this.svg.addEventListener('click', (e) => this.onClick(e));
    if (!ctx.demo) this.tick = setInterval(() => this.renderClocks(), 200);
  }

  // ---------------------------------------------------------------- доска

  private build() {
    const light = woodTexture(WOODS.maple, 256, 31);
    const dark = woodTexture(WOODS.walnut, 256, 17);
    const frame = woodTexture(WOODS.stained, 512, 5, false);
    let s = `<defs>
      <pattern id="tvL" patternUnits="userSpaceOnUse" width="${SQ * 2}" height="${SQ * 2}"><image href="${light}" width="${SQ * 2}" height="${SQ * 2}" preserveAspectRatio="none"/></pattern>
      <pattern id="tvD" patternUnits="userSpaceOnUse" width="${SQ * 2}" height="${SQ * 2}"><image href="${dark}" width="${SQ * 2}" height="${SQ * 2}" preserveAspectRatio="none"/></pattern>
      <linearGradient id="tvLac" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".14"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".16"/></linearGradient>
      <radialGradient id="tvCheck"><stop offset="0" stop-color="#ff2a1a" stop-opacity=".9"/><stop offset=".55" stop-color="#ff2a1a" stop-opacity=".35"/><stop offset="1" stop-color="#ff2a1a" stop-opacity="0"/></radialGradient>
      <radialGradient id="tvShade"><stop offset="0" stop-color="#140800" stop-opacity=".55"/><stop offset="1" stop-color="#140800" stop-opacity="0"/></radialGradient>
      <clipPath id="tvRound"><rect width="${W}" height="${W}" rx="14"/></clipPath>
    </defs>`;
    s += `<rect width="${W}" height="${W}" rx="14" fill="#2a1408"/><image href="${frame}" width="${W}" height="${W}" preserveAspectRatio="none" opacity=".95" clip-path="url(#tvRound)"/>`;
    s += `<rect x="${F - 6}" y="${F - 6}" width="${SQ * 8 + 12}" height="${SQ * 8 + 12}" rx="3" fill="#1a0c04"/>`;
    for (let r = 0; r < 8; r++)
      for (let f = 0; f < 8; f++) s += `<rect x="${F + f * SQ}" y="${F + r * SQ}" width="${SQ}" height="${SQ}" fill="url(#tv${(r + f) % 2 ? 'D' : 'L'})"/>`;
    s += `<rect x="${F}" y="${F}" width="${SQ * 8}" height="${SQ * 8}" fill="url(#tvLac)" pointer-events="none"/>`;
    s += `<g id="tvCoords"></g><g id="tvMarks"></g><g id="tvTargets"></g><g id="tvPieces" pointer-events="none"></g><g id="tvBanner"></g>`;
    s += `<rect x="${W / 2 - 3}" y="${F - 6}" width="6" height="${SQ * 8 + 12}" fill="#0d0502" opacity=".35"/>`;
    this.svg.innerHTML = s;
    this.gCoords = this.svg.querySelector('#tvCoords') as SVGGElement;
    this.gMarks = this.svg.querySelector('#tvMarks') as SVGGElement;
    this.gTargets = this.svg.querySelector('#tvTargets') as SVGGElement;
    this.gPieces = this.svg.querySelector('#tvPieces') as SVGGElement;
    this.gBanner = this.svg.querySelector('#tvBanner') as SVGGElement;
  }

  private xy(sq: number) {
    const f = this.flipped ? 7 - fileOf(sq) : fileOf(sq);
    const r = this.flipped ? rankOf(sq) : 7 - rankOf(sq);
    return { x: F + f * SQ + SQ / 2, y: F + r * SQ + SQ / 2 };
  }

  private renderCoords() {
    let s = '';
    for (let i = 0; i < 8; i++) {
      const file = 'abcdefgh'[this.flipped ? 7 - i : i];
      const rank = String(this.flipped ? i + 1 : 8 - i);
      const x = F + i * SQ + SQ / 2;
      const y = F + i * SQ + SQ / 2;
      s += `<text class="ch-coord" x="${x}" y="${W - F / 2 + 1}">${file}</text><text class="ch-coord" x="${x}" y="${F / 2 + 1}">${file}</text>`;
      s += `<text class="ch-coord" x="${F / 2}" y="${y}">${rank}</text><text class="ch-coord" x="${W - F / 2}" y="${y}">${rank}</text>`;
    }
    this.gCoords.innerHTML = s;
  }

  /** Шаг подъёма шайбы в башне из h таврелей. */
  private rise(hgt: number) {
    const wall = SPR.w * SPR.wall;
    return hgt <= 1 ? wall : Math.min(wall, MAX_RISE / (hgt - 1));
  }

  /** Одна шайба: низ картинки стоит на (x, base). Знак — на верхней грани у верхней шайбы и на стенке у каждой
   * (как у настоящих таврелей: по стенкам видно, кто в башне); band — сколько стенки видно из-под шайбы сверху. */
  private disc(t: { c: number; k: Kind }, x: number, base: number, sign: boolean, band: number) {
    const w = SPR.w;
    const hh = w * SPR.aspect;
    const left = x - w / 2;
    const topY = base - hh;
    const ink = t.c === 0 ? '#3b1a08' : '#f4dcaa';
    const glow = t.c === 0 ? '#fff4dc' : '#2a0802';
    const mark = (tr: string, sw: number) =>
      `<path d="${SIGN[t.k]}" transform="translate(0,1) ${tr}" fill="none" stroke="${glow}" stroke-opacity=".4" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>` +
      `<path d="${SIGN[t.k]}" transform="${tr}" fill="none" stroke="${ink}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`;
    let s = `<image href="${ART}${t.c === 0 ? 'light' : 'dark'}.webp" x="${left}" y="${topY}" width="${w}" height="${hh}"/>`;
    // знак на стенке: по центру видимой полосы передней грани
    const wallH = w * SPR.wall;
    const vis = Math.min(band, wallH);
    if (vis >= 7) {
      const r = Math.min(vis * 0.42, wallH * 0.42);
      s += mark(`translate(${left + w * SPR.wx},${base - w * SPR.foot - vis / 2}) scale(${r},${r})`, Math.max(1.4, r * 0.22));
    }
    if (sign) s += mark(`translate(${left + w * SPR.cx},${topY + w * SPR.cy}) scale(${w * SPR.rx * 0.66},${w * SPR.ry * 0.66})`, 3.4);
    return s;
  }

  /** Башня (или часть) на поле: base0 — сколько шайб уже стоит под ней (для части, что едет поверх). */
  private stackSvg(st: Stack, sq: number, opt: { below?: number; total?: number; lift?: number; hi?: number } = {}) {
    const { x, y } = this.xy(sq);
    const total = opt.total ?? st.length;
    const r = this.rise(total);
    const below = opt.below ?? 0;
    const base0 = y + SPR.w * SPR.aspect * 0.5;
    let s = below ? '' : `<ellipse cx="${x}" cy="${base0 - SPR.w * 0.1}" rx="${SPR.w * 0.56}" ry="${SPR.w * 0.24}" fill="url(#tvShade)"/>`;
    st.forEach((t, i) => {
      const lvl = below + i;
      const up = opt.hi != null && i >= opt.hi ? opt.lift ?? 0 : 0;
      const last = i === st.length - 1 && below + st.length === total;
      s += this.disc(t, x, base0 - lvl * r - up, i === st.length - 1, last || opt.hi != null && i === opt.hi - 1 ? SPR.w * SPR.wall : r);
    });
    if (total > 1 && !below) {
      const tp = top(st)!;
      const by = base0 - (total - 1) * r - SPR.w * SPR.aspect - 4;
      s += `<g class="tv-count"><circle cx="${x + SPR.w * 0.44}" cy="${by + 14}" r="12" class="${tp.c ? 'b' : 'w'}"/><text x="${x + SPR.w * 0.44}" y="${by + 15}">${total}</text></g>`;
    }
    return `<g data-sq="${sq}">${s}</g>`;
  }

  private render() {
    const st = this.s;
    if (!st) return;
    // ряды сверху вниз (дальние — раньше), чтобы высокие башни ложились поверх задних полей
    const order: number[] = [];
    for (let row = 0; row < 8; row++)
      for (let col = 0; col < 8; col++) {
        const f = this.flipped ? 7 - col : col;
        const r = this.flipped ? row : 7 - row;
        order.push(r * 8 + f);
      }
    let pcs = '';
    for (const sq of order) {
      const stck = st.board[sq];
      if (!stck.length) continue;
      const sel = this.selected === sq ? stck.length - this.n : undefined;
      pcs += this.stackSvg(stck, sq, sel != null ? { hi: sel, lift: 12 } : {});
    }
    this.gPieces.innerHTML = pcs;
    let m = '';
    if (st.last)
      for (const sq of [st.last.from, st.last.to]) {
        const { x, y } = this.xy(sq);
        m += `<rect x="${x - SQ / 2}" y="${y - SQ / 2}" width="${SQ}" height="${SQ}" class="ch-last"/>`;
      }
    const v = st.phase === 'over' && st.reason === 'mate' ? volkhvSq(st.board, 1 - st.winner!) : st.phase !== 'over' && inCheck(st) ? volkhvSq(st.board, st.turn) : -1;
    if (v >= 0) {
      const { x, y } = this.xy(v);
      m += `<circle cx="${x}" cy="${y}" r="${SQ * 0.5}" fill="url(#tvCheck)"/>`;
    }
    this.gMarks.innerHTML = m;
    this.renderTargets();
  }

  private renderTargets() {
    let t = '';
    const from = this.selected;
    if (from != null && this.s) {
      const { x, y } = this.xy(from);
      t += `<rect x="${x - SQ / 2}" y="${y - SQ / 2}" width="${SQ}" height="${SQ}" class="ch-sel"/>`;
      for (const mv of this.moves.filter((m) => m.from === from && m.n === this.n)) {
        const c = this.xy(mv.to);
        t += mv.capture
          ? `<g class="ch-tgt" data-to="${mv.to}"><rect x="${c.x - SQ / 2}" y="${c.y - SQ / 2}" width="${SQ}" height="${SQ}" fill="transparent"/><circle cx="${c.x}" cy="${c.y}" r="${SQ * 0.44}" class="ch-ring"/></g>`
          : this.s.board[mv.to].length
            ? `<g class="ch-tgt" data-to="${mv.to}"><rect x="${c.x - SQ / 2}" y="${c.y - SQ / 2}" width="${SQ}" height="${SQ}" fill="transparent"/><circle cx="${c.x}" cy="${c.y}" r="${SQ * 0.44}" class="tv-own"/></g>`
            : `<g class="ch-tgt" data-to="${mv.to}"><rect x="${c.x - SQ / 2}" y="${c.y - SQ / 2}" width="${SQ}" height="${SQ}" fill="transparent"/><circle cx="${c.x}" cy="${c.y}" r="${SQ * 0.15}" class="ch-dot"/></g>`;
      }
    }
    this.gTargets.innerHTML = t;
  }

  /** Состав выбранной башни: нажать на таврель — двинуть её и всё, что над ней. */
  private renderTower() {
    const st = this.s;
    const from = this.selected;
    if (!st || from == null || st.board[from].length < 2) {
      this.tower.hidden = true;
      this.tower.innerHTML = '';
      return;
    }
    const stck = st.board[from];
    this.tower.hidden = false;
    this.tower.innerHTML = `<div class="ch-ask">Башня на ${sqName(from)}: до какой таврели поднять?</div>`;
    const list = h('<div class="tv-list"></div>');
    for (let i = stck.length - 1; i >= 0; i--) {
      const t = stck[i];
      const n = stck.length - i;
      const ok = this.moves.some((m) => m.from === from && m.n === n);
      const nm = t.k === 'P' && t.s ? `ратник (${NAME[t.s]})` : NAME[t.k];
      const b = h<HTMLButtonElement>(
        `<button class="btn small tv-item${n === this.n ? ' on' : ''}" ${ok ? '' : 'disabled'}><i class="tv-chip ${t.c ? 'b' : 'w'}"></i>${nm}${t.c !== stck[stck.length - 1].c ? ' — пленник' : ''}${n > 1 ? ` <small>+${n - 1} сверху</small>` : ''}</button>`,
      );
      b.onclick = () => {
        Sound.ui();
        this.n = n;
        this.render();
        this.renderTower();
      };
      list.appendChild(b);
    }
    this.tower.appendChild(list);
  }

  // ---------------------------------------------------------------- ход игрока

  private onClick(e: MouseEvent) {
    if (this.actSeat == null || !this.s) return;
    const tgt = (e.target as Element).closest('[data-to]') as SVGElement | null;
    if (tgt && this.selected != null) return this.send(this.selected, +tgt.dataset.to!);
    let sq = this.squareAt(e);
    if (sq != null && this.selected != null && this.moves.some((m) => m.from === this.selected && m.to === sq && m.n === this.n)) return this.send(this.selected, sq);
    if (sq != null && !this.moves.some((m) => m.from === sq)) sq = null;
    this.selected = sq;
    if (sq != null) {
      Sound.ui();
      // по умолчанию — вся башня, если ей есть куда идти, иначе — сколько можно
      const hgt = this.s.board[sq].length;
      const ns = this.moves.filter((m) => m.from === sq).map((m) => m.n);
      this.n = ns.includes(hgt) ? hgt : Math.max(...ns);
    }
    this.render();
    this.renderTower();
  }

  private squareAt(e: MouseEvent): number | null {
    const pt = this.svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const m = this.svg.getScreenCTM();
    if (!m) return null;
    const p = pt.matrixTransform(m.inverse());
    const fx = Math.floor((p.x - F) / SQ);
    const ry = Math.floor((p.y - F) / SQ);
    if (fx < 0 || fx > 7 || ry < 0 || ry > 7) return null;
    const f = this.flipped ? 7 - fx : fx;
    const r = this.flipped ? ry : 7 - ry;
    return r * 8 + f;
  }

  private send(from: number, to: number) {
    const seat = this.actSeat;
    if (seat == null) return;
    const n = this.n;
    Sound.unlock();
    this.clearTurn();
    this.ctx.act(seat, { type: 'move', from, to, n } as TAction);
  }

  private clearTurn() {
    this.actSeat = null;
    this.moves = [];
    this.selected = null;
    this.confirmResign = false;
    this.btns.innerHTML = '';
    this.tower.hidden = true;
    this.tower.innerHTML = '';
    this.renderTargets();
  }

  private button(text: string, primary: boolean, on: () => void) {
    const b = h<HTMLButtonElement>(`<button class="btn ${primary ? 'primary' : ''}">${text}</button>`);
    b.onclick = () => {
      Sound.unlock();
      on();
    };
    this.btns.appendChild(b);
    return b;
  }

  private renderButtons() {
    this.btns.innerHTML = '';
    const st = this.s;
    if (!st || this.ctx.demo) return;
    const seat = this.actSeat;
    if (st.phase === 'draw' && seat != null) {
      this.btns.appendChild(h('<div class="ch-ask">Соперник предлагает ничью</div>'));
      this.button('Согласиться на ничью', true, () => this.act(seat, { type: 'accept' }));
      this.button('Играть дальше', false, () => this.act(seat, { type: 'decline' }));
      return;
    }
    if (st.phase === 'play' && seat != null) {
      if (st.moves.length >= 2) this.button('Предложить ничью', false, () => this.act(seat, { type: 'offer' }));
      const r = this.button(this.confirmResign ? 'Точно сдаться?' : 'Сдаться', this.confirmResign, () => {
        if (this.confirmResign) this.act(seat, { type: 'resign' });
        else {
          this.confirmResign = true;
          this.renderButtons();
        }
      });
      r.classList.add('ch-resign');
    }
    if (st.phase !== 'over')
      this.button('Перевернуть доску', false, () => {
        this.userFlip = !this.flipped;
        this.applyFlip();
      });
  }

  private act(seat: number, a: TAction) {
    this.clearTurn();
    this.ctx.act(seat, a);
  }

  // ---------------------------------------------------------------- часы

  private renderClocks() {
    const st = this.s;
    if (!st || !st.cfg.clock) {
      this.clocks.hidden = true;
      return;
    }
    this.clocks.hidden = false;
    const running = st.phase === 'play' && st.moves.length > 0;
    const left = (seat: number) => {
      let ms = st.clock[seat];
      if (running && st.turn === seat) ms -= Date.now() - this.recvAt;
      return Math.max(0, ms);
    };
    const fmt = (ms: number) => {
      const t = Math.ceil(ms / 1000);
      return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    };
    const order = this.flipped ? [0, 1] : [1, 0];
    this.clocks.innerHTML = order
      .map((seat) => {
        const ms = left(seat);
        const on = running && st.turn === seat;
        return `<div class="ch-clock${on ? ' on' : ''}${ms < 20000 ? ' low' : ''}"><span>${seat === 0 ? 'Белые' : 'Чёрные'}</span><b>${fmt(ms)}</b></div>`;
      })
      .join('');
    const me = this.actSeat;
    if (running && me != null && me === st.turn && left(me) <= 0 && Date.now() - this.flagSent > 1500) {
      this.flagSent = Date.now();
      this.ctx.act(me, { type: 'flag' });
    }
  }

  // ---------------------------------------------------------------- состояние

  private applyFlip() {
    const mine = this.ctx.mySeats;
    const auto = mine.length === 1 && mine[0] === 1;
    this.flipped = this.userFlip ?? auto;
    this.renderCoords();
    this.render();
    this.renderClocks();
  }

  setView(s: TState) {
    this.s = s;
    this.recvAt = Date.now();
    this.gBanner.innerHTML = '';
    this.applyFlip();
  }

  async play(events: TEvent[], s: TState) {
    const speed = this.ctx.speed();
    this.clearTurn();
    for (const ev of events) {
      if (ev.type === 'tmove') {
        await this.animate(ev.move, 300 / speed);
        if (ev.move.capture) Sound.capture();
        else Sound.place();
        if (ev.check) Sound.turn();
      } else if (ev.type === 'offer' || ev.type === 'decline') {
        Sound.ui();
        await this.banner(ev.type === 'offer' ? 'Предложена ничья' : 'Играем дальше', 900 / speed);
      } else if (ev.type === 'end') {
        Sound.win();
        const who = ev.winner === 0 ? 'белых' : 'чёрных';
        const txt = ev.winner == null ? (ev.reason === 'stalemate' ? 'Пат — ничья' : 'Ничья') : ev.reason === 'mate' ? `Волхв пленён! Победа ${who}` : `Победа ${who}`;
        this.s = s;
        this.render();
        await this.banner(txt, 0);
      }
    }
    this.s = s;
    this.recvAt = Date.now();
    this.render();
    this.renderClocks();
  }

  /** Едет верхняя часть башни: рисуем её отдельно и ведём на верх целевой башни. */
  private async animate(m: TMove, dur: number) {
    const st = this.s;
    if (!st || document.hidden) return;
    const src = st.board[m.from];
    const part = src.slice(src.length - m.n);
    const rest = src.slice(0, src.length - m.n);
    const dest = st.board[m.to].length + (m.ep != null ? 1 : 0);
    // перерисовать поле-источник без уезжающей части
    const el = this.gPieces.querySelector(`[data-sq="${m.from}"]`);
    if (el) el.outerHTML = rest.length ? this.stackSvg(rest, m.from) : '';
    const g = document.createElementNS(NS, 'g');
    g.innerHTML = this.stackSvg(part, m.from, { below: rest.length, total: src.length });
    this.gPieces.appendChild(g);
    const a = this.xy(m.from);
    const b = this.xy(m.to);
    const r0 = this.rise(src.length) * rest.length;
    const r1 = this.rise(dest + m.n) * dest;
    let rookEl: Element | null = null;
    let ra: { x: number; y: number } | null = null;
    let rb: { x: number; y: number } | null = null;
    if (m.castle) {
      rookEl = this.gPieces.querySelector(`[data-sq="${m.castle.rf}"]`);
      ra = this.xy(m.castle.rf);
      rb = this.xy(m.castle.rt);
    }
    const t0 = performance.now();
    await new Promise<void>((res) => {
      const step = (now: number) => {
        const t = Math.min(1, (now - t0) / dur);
        const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        const hop = Math.sin(Math.PI * t) * SQ * 0.3;
        g.setAttribute('transform', `translate(${(b.x - a.x) * e},${(b.y - a.y) * e - (r1 - r0) * e - hop})`);
        if (rookEl && ra && rb) rookEl.setAttribute('transform', `translate(${(rb.x - ra.x) * e},${(rb.y - ra.y) * e})`);
        if (t < 1) requestAnimationFrame(step);
        else res();
      };
      requestAnimationFrame(step);
      setTimeout(res, dur + 150);
    });
  }

  private async banner(text: string, ms: number) {
    this.gBanner.innerHTML = `<g class="ch-banner"><rect x="${W / 2 - 280}" y="${W / 2 - 40}" width="560" height="80" rx="14"/><text x="${W / 2}" y="${W / 2 + 2}">${text}</text></g>`;
    if (!ms) return;
    await sleep(ms);
    this.gBanner.innerHTML = '';
  }

  setTurn(_toAct: number[], interactive: number[]) {
    this.clearTurn();
    const st = this.s;
    if (!st || st.phase === 'over' || this.ctx.demo) {
      this.renderButtons();
      return;
    }
    const seat = st.phase === 'draw' ? 1 - st.offer : st.turn;
    if (!interactive.includes(seat)) {
      this.renderButtons();
      return;
    }
    this.actSeat = seat;
    if (this.ctx.mySeats.length > 1 && this.userFlip == null && this.flipped) {
      this.flipped = false;
      this.renderCoords();
      this.render();
    }
    if (st.phase === 'play') this.moves = legalMoves(st);
    this.renderButtons();
    this.renderTargets();
  }

  status(st: TState, _toAct: number[], interactive: number[]) {
    const name = (p: number) => this.ctx.name(p);
    if (st.phase === 'over') return st.winner == null ? 'Ничья' : `Победа: ${name(st.winner)}`;
    if (st.phase === 'draw') return interactive.includes(1 - st.offer) ? 'Вам предлагают ничью' : `${name(st.offer)} предложили ничью…`;
    const who = name(st.turn);
    const check = inCheck(st) ? ' — <b>шах!</b>' : '';
    return interactive.includes(st.turn) ? `Ваш ход: ${who}${check}` : `Ходят ${who}${check}…`;
  }

  /** Сколько чужих таврелей у стороны в плену (под её верхушками). */
  playerStats(st: TState, seat: number) {
    let held = 0;
    for (const stck of st.board) {
      const o = stck.length ? stck[stck.length - 1].c : -1;
      if (o === seat) held += stck.filter((t) => t.c !== seat).length;
    }
    return held ? `<span title="Пленных таврелей соперника в ваших башнях">⛓ ${held}</span>` : '';
  }

  destroy() {
    clearInterval(this.tick);
  }
}
