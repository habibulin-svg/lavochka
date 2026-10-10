/* Шашки — отрисовка: складная доска (клён и орех) 7×7, 8×8 или 10×10, точёные шашки, дамка — две шашки стопкой с короной,
 * в столбовых — башни (дамка внутри башни — с золотой полосой). Уголки — та же доска, дома подсвечены.
 * Выбор шашки → подсветка полей → ход; бой в несколько прыжков — по полям или сразу на конечное поле. Фук, ничья, сдача. */
import { Sound } from '../../core/audio';
import { h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { woodTexture, WOODS } from '../../core/wood';
import { arrived, cMoves, homeOf, pieceCount, type CEvent, type CState } from './corners';
import { colorOf, dark, isKing, legalMoves, properMoves, RULES, sqName, type Event, type Move, type State } from './engine';
import './checkers.css';

const NS = 'http://www.w3.org/2000/svg';
const F = 44; // рамка
const IN = 640; // игровое поле
const W = F * 2 + IN; // 728

let boards = 0;

type S = State | CState;
type E = Event | CEvent;

class CheckersView implements GameView<S, E> {
  /** Приставка id в SVG: досок на странице бывает несколько (стол и показ правил), а размер клеток у них разный. */
  private uid = `ck${++boards}`;
  private ctx!: ViewCtx;
  private svg!: SVGSVGElement;
  private gMarks!: SVGGElement;
  private gPieces!: SVGGElement;
  private gTargets!: SVGGElement;
  private gBanner!: SVGGElement;
  private gCoords!: SVGGElement;
  private btns!: HTMLElement;
  private clocks!: HTMLElement;
  private recvAt = Date.now();
  private tick: ReturnType<typeof setInterval> | undefined;
  private flagSent = 0;
  private s: S | null = null;
  private n = 0;
  private flipped = false;
  private userFlip: boolean | null = null;
  private actSeat: number | null = null;
  private moves: Move[] = [];
  /** Выбранная шашка и поля, на которые она уже прыгнула в этом ходе. */
  private selected: number | null = null;
  private pre: number[] = [];
  private hover: number | null = null;
  private confirmResign = false;

  /** Уголки: играют все поля, ходы — на конечное поле. */
  private get corners() {
    return this.s?.game === 'corners';
  }
  /** Столбовые: побитые остаются на доске в башнях. */
  private get columns() {
    return this.s?.game === 'draughts' && RULES[this.s.cfg.variant].columns;
  }

  private get SQ() {
    return IN / this.n;
  }
  private get R() {
    return this.SQ * 0.4;
  }

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    const wrap = h(`<div class="ck-wrap"><svg class="ck-board" xmlns="${NS}" viewBox="0 0 ${W} ${W}"></svg></div>`);
    root.appendChild(wrap);
    this.svg = wrap.querySelector('svg') as SVGSVGElement;
    const ctl = h(`<div class="ck-controls">
        <div class="ck-clocks" hidden></div>
        <div class="ck-btns"></div>
        ${ctx.demo ? '' : '<div class="hint small-hint">Нажмите на шашку, потом — на подсвеченное поле. Бой в несколько прыжков — по полям или сразу на последнее.</div>'}
      </div>`);
    ctx.controls.appendChild(ctl);
    this.btns = ctl.querySelector('.ck-btns') as HTMLElement;
    this.clocks = ctl.querySelector('.ck-clocks') as HTMLElement;
    if (!ctx.demo) this.tick = setInterval(() => this.renderClocks(), 200);
    this.svg.addEventListener('click', (e) => this.onClick(e));
    this.svg.addEventListener('pointerover', (e) => {
      if (e.pointerType === 'touch' || this.selected != null) return;
      const el = (e.target as Element).closest('[data-sq]') as SVGElement | null;
      const sq = el ? +el.dataset.sq! : null;
      const own = sq != null && this.moves.some((m) => m.from === sq) ? sq : null;
      if (own !== this.hover) {
        this.hover = own;
        this.renderTargets();
      }
    });
    this.svg.addEventListener('pointerleave', () => {
      if (this.hover == null) return;
      this.hover = null;
      this.renderTargets();
    });
  }

  // ---------------------------------------------------------------- доска

  private build(n: number) {
    this.n = n;
    const SQ = this.SQ;
    const light = woodTexture(WOODS.maple, 256, 31);
    const darkW = woodTexture(WOODS.walnut, 256, 17);
    const frame = woodTexture(WOODS.stained, 512, 5, false);
    const pW = woodTexture(WOODS.maple, 128, 3);
    const pB = woodTexture(WOODS.wenge, 128, 9);
    let s = `<defs>
      <pattern id="${this.uid}L" patternUnits="userSpaceOnUse" width="${SQ * 2}" height="${SQ * 2}"><image href="${light}" width="${SQ * 2}" height="${SQ * 2}" preserveAspectRatio="none"/></pattern>
      <pattern id="${this.uid}D" patternUnits="userSpaceOnUse" width="${SQ * 2}" height="${SQ * 2}"><image href="${darkW}" width="${SQ * 2}" height="${SQ * 2}" preserveAspectRatio="none"/></pattern>
      <pattern id="${this.uid}PW" patternUnits="objectBoundingBox" width="1" height="1"><image href="${pW}" width="${this.R * 2}" height="${this.R * 2}" preserveAspectRatio="none"/></pattern>
      <pattern id="${this.uid}PB" patternUnits="objectBoundingBox" width="1" height="1"><image href="${pB}" width="${this.R * 2}" height="${this.R * 2}" preserveAspectRatio="none"/></pattern>
      <linearGradient id="${this.uid}Lac" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".14"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".16"/></linearGradient>
      <radialGradient id="${this.uid}Bevel" cx="50%" cy="50%" r="50%"><stop offset=".62" stop-color="#000" stop-opacity="0"/><stop offset=".86" stop-color="#000" stop-opacity=".14"/><stop offset="1" stop-color="#000" stop-opacity=".5"/></radialGradient>
      <radialGradient id="${this.uid}Gloss" cx="34%" cy="28%" r="55%"><stop offset="0" stop-color="#fff" stop-opacity=".6"/><stop offset=".35" stop-color="#fff" stop-opacity=".12"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
      <filter id="${this.uid}Shadow" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="2" dy="3" stdDeviation="2.2" flood-color="#0d0502" flood-opacity=".65"/></filter>
      <clipPath id="${this.uid}Round"><rect width="${W}" height="${W}" rx="14"/></clipPath>
    </defs>`;
    s += `<rect width="${W}" height="${W}" rx="14" fill="#2a1408"/><image href="${frame}" width="${W}" height="${W}" preserveAspectRatio="none" opacity=".95" clip-path="url(#${this.uid}Round)"/>`;
    s += `<rect x="${F - 6}" y="${F - 6}" width="${IN + 12}" height="${IN + 12}" rx="3" fill="#1a0c04"/>`;
    for (let r = 0; r < n; r++)
      for (let f = 0; f < n; f++) s += `<rect x="${F + f * SQ}" y="${F + r * SQ}" width="${SQ}" height="${SQ}" fill="url(#${this.uid}${dark(n, (n - 1 - r) * n + f) ? 'D' : 'L'})"/>`;
    s += `<rect x="${F}" y="${F}" width="${IN}" height="${IN}" fill="url(#${this.uid}Lac)" pointer-events="none"/>`;
    s += `<g id="${this.uid}Coords"></g><g id="${this.uid}Marks"></g><g id="${this.uid}Targets"></g><g id="${this.uid}Pieces"></g><g id="${this.uid}Banner"></g>`;
    // шов складной доски — только там, где он идёт по краю клеток
    if (n % 2 === 0) s += `<rect x="${W / 2 - 3}" y="${F - 6}" width="6" height="${IN + 12}" fill="#0d0502" opacity=".35" pointer-events="none"/>`;
    this.svg.innerHTML = s;
    this.gCoords = this.svg.querySelector(`#${this.uid}Coords`) as SVGGElement;
    this.gMarks = this.svg.querySelector(`#${this.uid}Marks`) as SVGGElement;
    this.gTargets = this.svg.querySelector(`#${this.uid}Targets`) as SVGGElement;
    this.gPieces = this.svg.querySelector(`#${this.uid}Pieces`) as SVGGElement;
    this.gBanner = this.svg.querySelector(`#${this.uid}Banner`) as SVGGElement;
  }

  /** Центр поля на экране (с учётом поворота доски). */
  private xy(sq: number) {
    const n = this.n;
    const SQ = this.SQ;
    const f0 = sq % n;
    const r0 = Math.floor(sq / n);
    const f = this.flipped ? n - 1 - f0 : f0;
    const r = this.flipped ? r0 : n - 1 - r0;
    return { x: F + f * SQ + SQ / 2, y: F + r * SQ + SQ / 2 };
  }

  private renderCoords() {
    const n = this.n;
    const SQ = this.SQ;
    let s = '';
    for (let i = 0; i < n; i++) {
      const file = 'abcdefghij'[this.flipped ? n - 1 - i : i];
      const rank = String(this.flipped ? i + 1 : n - i);
      const x = F + i * SQ + SQ / 2;
      s += `<text class="ck-coord" x="${x}" y="${W - F / 2 + 1}">${file}</text><text class="ck-coord" x="${x}" y="${F / 2 + 1}">${file}</text>`;
      s += `<text class="ck-coord" x="${F / 2}" y="${x}">${rank}</text><text class="ck-coord" x="${W - F / 2}" y="${x}">${rank}</text>`;
    }
    // в международных ходы пишут номерами полей — номера мелко в углу тёмных полей
    if ((n === 10 || n === 7) && !this.corners)
      for (let sq = 0; sq < n * n; sq++) {
        if (!dark(n, sq)) continue;
        const { x, y } = this.xy(sq);
        s += `<text class="ck-num" x="${x - SQ / 2 + 4}" y="${y - SQ / 2 + 4}">${sqName(n, sq)}</text>`;
      }
    this.gCoords.innerHTML = s;
  }

  /** Точёная шашка: волокна, бороздки, фаска, лак. Дамка — две шашки стопкой. */
  private checker(p: string, sq: number, extra = '') {
    const { x, y } = this.xy(sq);
    const R = this.R;
    const rot = Math.round((sq * 47.3) % 360);
    const one = (dy: number, ch: string, stripe = false) => {
      const white = colorOf(ch) === 0;
      return `<g transform="translate(0,${dy})" filter="url(#${this.uid}Shadow)">
      <circle r="${R}" fill="${white ? '#9a7a4a' : '#050302'}"/>
      <circle r="${R - 1.5}" fill="url(#${this.uid}P${white ? 'W' : 'B'})" transform="rotate(${rot})"/>
      ${white ? '' : `<circle r="${R - 1.5}" fill="#000" opacity=".42"/>`}
      <circle r="${R - 1.5}" fill="url(#${this.uid}Bevel)"/>
      <circle r="${R * 0.7}" fill="none" stroke="${white ? '#9a7448' : '#000'}" stroke-width="1.6" opacity=".55"/>
      <circle r="${R * 0.7 + 1.2}" fill="none" stroke="${white ? '#fff6e0' : '#9a7a62'}" stroke-width="1" opacity=".5"/>
      <circle r="${R * 0.38}" fill="none" stroke="${white ? '#9a7448' : '#000'}" stroke-width="1.2" opacity=".45"/>
      <circle r="${R * 0.38 + 1}" fill="none" stroke="${white ? '#fff6e0' : '#9a7a62'}" stroke-width=".8" opacity=".4"/>
      <circle r="${R - 1.5}" fill="url(#${this.uid}Gloss)"/>
      ${stripe ? `<path d="M${-R * 0.92} ${R * 0.32}A${R} ${R} 0 0 0 ${R * 0.92} ${R * 0.32}" fill="none" stroke="#d8a940" stroke-width="${R * 0.16}" opacity=".9"/>` : ''}
    </g>`;
    };
    // корона на верхней шашке дамки: у белых — выжжена, у чёрных — золотом
    const crown = (ch: string, dy: number) => {
      const k = R * 0.5;
      const white = colorOf(ch) === 0;
      return `<path transform="translate(0,${dy})" d="M${-k} ${k * 0.45}L${-k} ${-k * 0.35}L${-k * 0.5} ${k * 0.1}L0 ${-k * 0.6}L${k * 0.5} ${k * 0.1}L${k} ${-k * 0.35}L${k} ${k * 0.45}Z" fill="${white ? '#6a3a14' : '#d8a940'}" opacity="${white ? 0.75 : 0.9}"/>`;
    };
    let body: string;
    if (this.columns) {
      // башня: верхние семь шашек стопкой, сверху — та, что ходит
      const shown = [...p].slice(0, 7);
      const k = shown.length;
      const d = k > 1 ? Math.min(R * 0.32, (R * 1.1) / (k - 1)) : 0;
      body = '';
      for (let i = k - 1; i >= 0; i--) body += one((i - (k - 1) / 2) * d, shown[i], i > 0 && isKing(shown[i]));
      const topY = -((k - 1) / 2) * d;
      if (isKing(p)) body += crown(p, topY);
      if (p.length > 1) {
        const mine = [...p].filter((c) => colorOf(c) === colorOf(p)).length;
        body += `<g class="ck-badge" transform="translate(${R * 0.78},${topY - R * 0.72})"><circle r="${R * 0.36}"/><text>${p.length}</text></g>`;
        body += `<title>Башня из ${p.length}: своих ${mine}, пленных ${p.length - mine}</title>`;
      }
    } else if (this.corners) body = one(0, p);
    else body = isKing(p) ? one(R * 0.18, p) + one(-R * 0.2, p) + crown(p, -R * 0.2) : one(0, p);
    return `<g class="ck-pc" data-sq="${sq}" transform="translate(${x},${y})" ${extra}>${body}</g>`;
  }

  private render() {
    const st = this.s;
    if (!st) return;
    if (st.n !== this.n) {
      this.build(st.n);
      this.renderCoords();
    }
    let pcs = '';
    for (let sq = 0; sq < st.board.length; sq++) if (st.board[sq]) pcs += this.checker(st.board[sq], sq);
    this.gPieces.innerHTML = pcs;
    let m = '';
    const SQ = this.SQ;
    if (st.last)
      for (const sq of [st.last.from, ...st.last.path]) {
        const { x, y } = this.xy(sq);
        m += `<rect x="${x - SQ / 2}" y="${y - SQ / 2}" width="${SQ}" height="${SQ}" class="ck-last"/>`;
      }
    // дома в уголках: белый — у a1, чёрный — у h8
    if (st.game === 'corners')
      for (const c of [0, 1])
        for (const sq of homeOf(st.cfg, c)) {
          const { x, y } = this.xy(sq);
          m += `<rect x="${x - SQ / 2}" y="${y - SQ / 2}" width="${SQ}" height="${SQ}" class="ck-home ck-home${c}"/>`;
        }
    // кого можно взять за фук
    if (this.actSeat != null)
      for (const sq of st.fuk) {
        const { x, y } = this.xy(sq);
        m += `<circle cx="${x}" cy="${y}" r="${this.R + 6}" class="ck-fuk"/>`;
      }
    this.gMarks.innerHTML = m;
    this.renderTargets();
  }

  /** Ходы выбранной шашки, которые продолжают уже сделанные прыжки. */
  private candidates(from: number): Move[] {
    const pre = this.selected === from ? this.pre : [];
    return this.moves.filter((m) => m.from === from && pre.every((x, i) => m.path[i] === x));
  }

  private renderTargets() {
    const from = this.selected ?? this.hover;
    const SQ = this.SQ;
    let t = '';
    if (from != null && this.s) {
      const live = this.selected != null;
      const at = live && this.pre.length ? this.pre[this.pre.length - 1] : from;
      const { x, y } = this.xy(from);
      t += `<rect x="${x - SQ / 2}" y="${y - SQ / 2}" width="${SQ}" height="${SQ}" class="ck-sel${live ? '' : ' ck-preview'}"/>`;
      // пройденные прыжки
      for (const sq of live ? this.pre : []) {
        const c = this.xy(sq);
        t += `<rect x="${c.x - SQ / 2}" y="${c.y - SQ / 2}" width="${SQ}" height="${SQ}" class="ck-sel"/>`;
      }
      if (at !== from) {
        const c = this.xy(at);
        t += `<circle cx="${c.x}" cy="${c.y}" r="${this.R}" class="ck-ghost"/>`;
      }
      const k = live ? this.pre.length : 0;
      const cands = this.candidates(from);
      const next = new Set(this.corners ? cands.map((m) => m.path[m.path.length - 1]) : cands.map((m) => m.path[k]));
      const finals = new Set(cands.filter((m) => m.path.length > k + 1).map((m) => m.path[m.path.length - 1]));
      const cls = `ck-tgt${live ? '' : ' ck-preview'}`;
      const box = (cx: number, cy: number) => `<rect x="${cx - SQ / 2}" y="${cy - SQ / 2}" width="${SQ}" height="${SQ}" fill="transparent"/>`;
      for (const to of next) {
        const c = this.xy(to);
        t += `<g class="${cls}" data-to="${to}">${box(c.x, c.y)}<circle cx="${c.x}" cy="${c.y}" r="${SQ * 0.16}" class="ck-dot"/></g>`;
      }
      for (const to of finals) {
        if (next.has(to)) continue;
        const c = this.xy(to);
        t += `<g class="${cls}" data-to="${to}">${box(c.x, c.y)}<circle cx="${c.x}" cy="${c.y}" r="${SQ * 0.3}" class="ck-ring"/></g>`;
      }
      // побитые по ходу шашки
      if (live && this.pre.length) {
        const m = cands[0];
        for (const v of m ? m.caps.slice(0, this.pre.length) : []) {
          const c = this.xy(v);
          t += `<circle cx="${c.x}" cy="${c.y}" r="${this.R * 0.6}" class="ck-hit"/>`;
        }
      }
    }
    this.gTargets.innerHTML = t;
  }

  // ---------------------------------------------------------------- ход игрока

  private onClick(e: MouseEvent) {
    const st = this.s;
    if (this.actSeat == null || !st) return;
    const sq = this.squareAt(e);
    // взять за фук
    if (sq != null && st.fuk.includes(sq) && this.selected == null) {
      this.act(this.actSeat, { type: 'fuk', sq });
      return;
    }
    if (sq != null && this.selected != null) {
      const k = this.pre.length;
      const cands = this.candidates(this.selected);
      if (!this.corners && cands.some((m) => m.path[k] === sq)) {
        this.pre = [...this.pre, sq];
        const done = this.candidates(this.selected).find((m) => m.path.length === this.pre.length);
        if (done) return this.send(done);
        Sound.step();
        this.renderTargets();
        return;
      }
      const end = cands.filter((m) => m.path[m.path.length - 1] === sq);
      if (end.length === 1) return this.send(end[0]);
      if (end.length > 1) {
        // разные ветки боя на одно поле — пусть выберет по прыжкам
        this.pre = [...this.pre, end[0].path[k]];
        this.renderTargets();
        return;
      }
    }
    // нажатие по полю: своя шашка с ходами — выбрать, иначе — сбросить выбор
    const pick = sq != null && this.moves.some((m) => m.from === sq) ? sq : null;
    this.selected = pick;
    this.pre = [];
    if (pick != null) Sound.ui();
    this.renderTargets();
  }

  private squareAt(e: MouseEvent): number | null {
    const pt = this.svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const m = this.svg.getScreenCTM();
    if (!m) return null;
    const p = pt.matrixTransform(m.inverse());
    const n = this.n;
    const fx = Math.floor((p.x - F) / this.SQ);
    const ry = Math.floor((p.y - F) / this.SQ);
    if (fx < 0 || fx >= n || ry < 0 || ry >= n) return null;
    const f = this.flipped ? n - 1 - fx : fx;
    const r = this.flipped ? ry : n - 1 - ry;
    return r * n + f;
  }

  private send(m: Move) {
    const seat = this.actSeat;
    if (seat == null) return;
    Sound.unlock();
    this.clearTurn();
    this.ctx.act(seat, { type: 'move', from: m.from, path: m.path });
  }

  private clearTurn() {
    this.actSeat = null;
    this.moves = [];
    this.selected = null;
    this.pre = [];
    this.hover = null;
    this.confirmResign = false;
    this.btns.innerHTML = '';
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
      this.btns.appendChild(h('<div class="ck-ask">Соперник предлагает ничью</div>'));
      this.button('Согласиться на ничью', true, () => this.act(seat, { type: 'accept' }));
      this.button('Играть дальше', false, () => this.act(seat, { type: 'decline' }));
      return;
    }
    if (st.phase === 'play' && seat != null) {
      if (st.fuk.length) this.btns.appendChild(h('<div class="ck-ask ck-fuk-ask">Соперник не побил! Можно взять за фук — нажмите на шашку в красном кольце.</div>'));
      if (st.moves.length >= 2) this.button('Предложить ничью', false, () => this.act(seat, { type: 'offer' }));
      const r = this.button(this.confirmResign ? 'Точно сдаться?' : 'Сдаться', this.confirmResign, () => {
        if (this.confirmResign) this.act(seat, { type: 'resign' });
        else {
          this.confirmResign = true;
          this.renderButtons();
        }
      });
      r.classList.add('ck-resign');
    }
    if (st.phase !== 'over')
      this.button('Перевернуть доску', false, () => {
        this.userFlip = !this.flipped;
        this.applyFlip();
      });
  }

  private act(seat: number, a: Parameters<ViewCtx['act']>[1]) {
    this.clearTurn();
    this.ctx.act(seat, a);
  }

  // ---------------------------------------------------------------- состояние

  private applyFlip() {
    const mine = this.ctx.mySeats;
    const auto = mine.length === 1 && mine[0] === 1;
    this.flipped = this.userFlip ?? auto;
    if (this.s && this.s.n !== this.n) this.build(this.s.n);
    this.renderCoords();
    this.render();
  }

  /** Часы, как у шахмат: идут у того, чей ход; своё время вышло — сообщаем (хозяин проверит). */
  private renderClocks() {
    const st = this.s;
    if (!st || st.game !== 'draughts' || !st.cfg.clock) {
      this.clocks.hidden = true;
      return;
    }
    this.clocks.hidden = false;
    const running = st.phase === 'play' && st.moves.length > 0;
    const left = (seat: number) => Math.max(0, st.clock[seat] - (running && st.turn === seat ? Date.now() - this.recvAt : 0));
    const fmt = (ms: number) => {
      const t = Math.ceil(ms / 1000);
      return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    };
    const order = this.flipped ? [0, 1] : [1, 0];
    this.clocks.innerHTML = order
      .map((seat) => {
        const ms = left(seat);
        const on = running && st.turn === seat;
        return `<div class="ck-clock${on ? ' on' : ''}${ms < 20000 ? ' low' : ''}"><span>${seat === 0 ? 'Белые' : 'Чёрные'}</span><b>${fmt(ms)}</b></div>`;
      })
      .join('');
    const me = this.actSeat;
    if (running && me != null && me === st.turn && left(me) <= 0 && Date.now() - this.flagSent > 1500) {
      this.flagSent = Date.now();
      this.ctx.act(me, { type: 'flag' });
    }
  }

  destroy() {
    clearInterval(this.tick);
  }

  setView(s: S) {
    this.s = s;
    this.recvAt = Date.now();
    if (s.n !== this.n) this.build(s.n);
    this.gBanner.innerHTML = '';
    this.applyFlip();
  }

  async play(events: E[], s: S) {
    const speed = this.ctx.speed();
    this.clearTurn();
    for (const ev of events) {
      if (ev.type === 'move') {
        await this.animate(ev.move, 230 / speed);
      } else if (ev.type === 'fuk') {
        this.gPieces.querySelector(`[data-sq="${ev.sq}"]`)?.classList.add('ck-gone');
        Sound.capture();
        await this.banner('За фук!', 700 / speed);
      } else if (ev.type === 'offer' || ev.type === 'decline') {
        Sound.ui();
        await this.banner(ev.type === 'offer' ? 'Предложена ничья' : 'Играем дальше', 900 / speed);
      } else if (ev.type === 'end') {
        Sound.win();
        this.s = s;
        this.render();
        const who = ev.winner === 0 ? 'белых' : 'чёрных';
        await this.banner(ev.winner == null ? 'Ничья' : `Победа ${who}`, 0);
      }
    }
    this.s = s;
    this.recvAt = Date.now();
    this.render();
    this.renderClocks();
  }

  private async animate(m: Move, dur: number) {
    const el = this.gPieces.querySelector(`[data-sq="${m.from}"]`) as SVGGElement | null;
    if (!el || document.hidden) return;
    this.gPieces.appendChild(el);
    let a = this.xy(m.from);
    for (let i = 0; i < m.path.length; i++) {
      const b = this.xy(m.path[i]);
      const t0 = performance.now();
      const from = a;
      await new Promise<void>((res) => {
        const step = (now: number) => {
          const t = Math.min(1, (now - t0) / dur);
          const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
          const lift = 1 + Math.sin(Math.PI * t) * (m.caps.length || m.path.length > 1 ? 0.16 : 0.06);
          el.setAttribute('transform', `translate(${from.x + (b.x - from.x) * e},${from.y + (b.y - from.y) * e}) scale(${lift})`);
          if (t < 1) requestAnimationFrame(step);
          else res();
        };
        requestAnimationFrame(step);
        setTimeout(res, dur + 150);
      });
      if (m.caps[i] != null) {
        if (!this.columns) this.gPieces.querySelector(`[data-sq="${m.caps[i]}"]`)?.classList.add('ck-hit-pc');
        Sound.capture();
      } else Sound.place();
      a = b;
    }
    // турецкий удар: побитые снимаются после хода
    if (!this.columns) for (const c of m.caps) this.gPieces.querySelector(`[data-sq="${c}"]`)?.classList.add('ck-gone');
    if (m.caps.length) await sleep(180);
  }

  private async banner(text: string, ms: number) {
    this.gBanner.innerHTML = `<g class="ck-banner"><rect x="${W / 2 - 250}" y="${W / 2 - 40}" width="500" height="80" rx="14"/><text x="${W / 2}" y="${W / 2 + 2}">${text}</text></g>`;
    if (!ms) return;
    await sleep(ms);
    this.gBanner.innerHTML = '';
  }

  setTurn(_toAct: number[], interactive: number[]) {
    this.clearTurn();
    const st = this.s;
    if (!st || st.phase === 'over' || this.ctx.demo) {
      this.renderButtons();
      this.render();
      return;
    }
    const seat = st.phase === 'draw' ? 1 - st.offer : st.turn;
    if (!interactive.includes(seat)) {
      this.renderButtons();
      this.render();
      return;
    }
    this.actSeat = seat;
    if (this.ctx.mySeats.length > 1 && this.userFlip == null) this.flipped = false;
    if (st.phase === 'play') this.moves = st.game === 'corners' ? cMoves(st) : legalMoves(st);
    this.renderButtons();
    this.renderCoords();
    this.render();
  }

  status(st: S, _toAct: number[], interactive: number[]) {
    const name = (p: number) => this.ctx.name(p);
    if (st.phase === 'over') return st.winner == null ? 'Ничья' : `Победа: ${name(st.winner)}`;
    if (st.phase === 'draw') return interactive.includes(1 - st.offer) ? 'Вам предлагают ничью' : `${name(st.offer)} предложили ничью…`;
    const who = name(st.turn);
    if (st.game === 'corners') {
      const last = st.whiteDone ? ' — <b>последний ход!</b>' : '';
      return interactive.includes(st.turn) ? `Ваш ход: ${who}${last}` : `Ходят ${who}…`;
    }
    const pm = properMoves(st);
    const must = pm.length && pm[0].caps.length ? (st.cfg.fuk ? ' — <b>есть что бить</b>' : ' — <b>бить обязательно</b>') : '';
    return interactive.includes(st.turn) ? `Ваш ход: ${who}${must}` : `Ходят ${who}…`;
  }

  playerStats(st: S, seat: number) {
    if (st.game === 'corners') return `<span title="Шашек в доме соперника">🏠 ${arrived(st, seat)} из ${pieceCount(st.cfg)}</span> · ход ${st.made[seat]}`;
    const left = st.board.filter((p) => p && colorOf(p) === seat);
    const kings = left.filter(isKing).length;
    return `<span title="На доске">⛀ ${left.length}${kings ? ` (дамок ${kings})` : ''}</span>`;
  }
}

export function createView(): GameView<S, E> {
  return new CheckersView();
}
