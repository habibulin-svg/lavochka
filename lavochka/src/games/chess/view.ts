/* Шахматы — отрисовка: складная школьная доска (клён и орех, рамка с буквами), точёные фигуры,
 * выбор фигуры → подсветка ходов → ход; часы, превращение, ничья, сдача. */
import { Sound } from '../../core/audio';
import { h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { woodTexture, WOODS } from '../../core/wood';
import { colorOf, fileOf, inCheck, kingSq, legalMoves, rankOf, type Event, type Move, type Promo, type State } from './engine';
import { pieceDefs, pieceRef } from './pieces';
import './chess.css';

const NS = 'http://www.w3.org/2000/svg';
const SQ = 80;
const F = 44; // рамка
const W = F * 2 + SQ * 8; // 728

const GLYPH: Record<string, string> = { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞', P: '♟' };
const VAL: Record<string, number> = { P: 1, N: 3, B: 3, R: 5, Q: 9, K: 0 };

class ChessView implements GameView<State, Event> {
  private ctx!: ViewCtx;
  private svg!: SVGSVGElement;
  private gMarks!: SVGGElement;
  private gPieces!: SVGGElement;
  private gTargets!: SVGGElement;
  private gBanner!: SVGGElement;
  private gCoords!: SVGGElement;
  private btns!: HTMLElement;
  private clocks!: HTMLElement;
  private promo!: HTMLElement;
  private s: State | null = null;
  private flipped = false;
  private userFlip: boolean | null = null;
  private actSeat: number | null = null;
  private moves: Move[] = [];
  private selected: number | null = null;
  private hover: number | null = null;
  private recvAt = Date.now();
  private tick: ReturnType<typeof setInterval> | undefined;
  private flagSent = 0;
  private confirmResign = false;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    const wrap = h(`<div class="ch-wrap"><svg class="ch-board" xmlns="${NS}" viewBox="0 0 ${W} ${W}"></svg></div>`);
    root.appendChild(wrap);
    this.svg = wrap.querySelector('svg') as SVGSVGElement;
    this.build();
    const ctl = h(`<div class="ch-controls">
        <div class="ch-clocks" hidden></div>
        <div class="ch-promo" hidden></div>
        <div class="ch-btns"></div>
        ${ctx.demo ? '' : '<div class="hint small-hint">Нажмите на фигуру, потом — на подсвеченное поле.</div>'}
      </div>`);
    ctx.controls.appendChild(ctl);
    this.btns = ctl.querySelector('.ch-btns') as HTMLElement;
    this.clocks = ctl.querySelector('.ch-clocks') as HTMLElement;
    this.promo = ctl.querySelector('.ch-promo') as HTMLElement;
    this.svg.addEventListener('click', (e) => this.onClick(e));
    this.svg.addEventListener('pointerover', (e) => {
      // фигура выбрана — цели уже показаны, перерисовка под курсором сорвала бы нажатие
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
    if (!ctx.demo) this.tick = setInterval(() => this.renderClocks(), 200);
  }

  // ---------------------------------------------------------------- доска

  private build() {
    const light = woodTexture(WOODS.maple, 256, 31);
    const dark = woodTexture(WOODS.walnut, 256, 17);
    const frame = woodTexture(WOODS.stained, 512, 5, false);
    let s = `<defs>
      <pattern id="chL" patternUnits="userSpaceOnUse" width="${SQ * 2}" height="${SQ * 2}"><image href="${light}" width="${SQ * 2}" height="${SQ * 2}" preserveAspectRatio="none"/></pattern>
      <pattern id="chD" patternUnits="userSpaceOnUse" width="${SQ * 2}" height="${SQ * 2}"><image href="${dark}" width="${SQ * 2}" height="${SQ * 2}" preserveAspectRatio="none"/></pattern>
      <linearGradient id="chLac" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".14"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".16"/></linearGradient>
      <radialGradient id="chCheck"><stop offset="0" stop-color="#ff2a1a" stop-opacity=".9"/><stop offset=".55" stop-color="#ff2a1a" stop-opacity=".35"/><stop offset="1" stop-color="#ff2a1a" stop-opacity="0"/></radialGradient>
      <filter id="chShadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="2" dy="3" stdDeviation="2" flood-color="#1a0a02" flood-opacity=".55"/></filter>
      <clipPath id="chRound"><rect width="${W}" height="${W}" rx="14"/></clipPath>
      ${pieceDefs()}
    </defs>`;
    s += `<rect width="${W}" height="${W}" rx="14" fill="#2a1408"/><image href="${frame}" width="${W}" height="${W}" preserveAspectRatio="none" opacity=".95" clip-path="url(#chRound)"/>`;
    s += `<rect x="${F - 6}" y="${F - 6}" width="${SQ * 8 + 12}" height="${SQ * 8 + 12}" rx="3" fill="#1a0c04"/>`;
    for (let r = 0; r < 8; r++)
      for (let f = 0; f < 8; f++) s += `<rect class="ch-sq" x="${F + f * SQ}" y="${F + r * SQ}" width="${SQ}" height="${SQ}" fill="url(#ch${(r + f) % 2 ? 'D' : 'L'})"/>`;
    s += `<rect x="${F}" y="${F}" width="${SQ * 8}" height="${SQ * 8}" fill="url(#chLac)" pointer-events="none"/>`;
    s += `<g id="chCoords"></g><g id="chMarks"></g><g id="chTargets"></g><g id="chPieces"></g><g id="chBanner"></g>`;
    // латунные петли складной доски
    s += `<rect x="${W / 2 - 3}" y="${F - 6}" width="6" height="${SQ * 8 + 12}" fill="#0d0502" opacity=".35"/>`;
    this.svg.innerHTML = s;
    this.gCoords = this.svg.querySelector('#chCoords') as SVGGElement;
    this.gMarks = this.svg.querySelector('#chMarks') as SVGGElement;
    this.gTargets = this.svg.querySelector('#chTargets') as SVGGElement;
    this.gPieces = this.svg.querySelector('#chPieces') as SVGGElement;
    this.gBanner = this.svg.querySelector('#chBanner') as SVGGElement;
  }

  /** Центр клетки на экране (с учётом поворота доски). */
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

  private pieceSvg(p: string, sq: number) {
    const { x, y } = this.xy(sq);
    return `<g class="ch-pc" data-sq="${sq}" transform="translate(${x - SQ / 2},${y - SQ / 2})"><use href="${pieceRef(p)}" x="${-SQ * 0.06}" y="${-SQ * 0.1}" width="${SQ * 1.12}" height="${SQ * 1.12}" filter="url(#chShadow)"/></g>`;
  }

  private render() {
    const st = this.s;
    if (!st) return;
    let pcs = '';
    for (let sq = 0; sq < 64; sq++) if (st.board[sq]) pcs += this.pieceSvg(st.board[sq], sq);
    this.gPieces.innerHTML = pcs;
    // подсветка: последний ход, шах
    let m = '';
    if (st.last)
      for (const sq of [st.last.from, st.last.to]) {
        const { x, y } = this.xy(sq);
        m += `<rect x="${x - SQ / 2}" y="${y - SQ / 2}" width="${SQ}" height="${SQ}" class="ch-last"/>`;
      }
    if (st.phase !== 'over' && inCheck(st)) {
      const { x, y } = this.xy(kingSq(st.board, st.turn));
      m += `<circle cx="${x}" cy="${y}" r="${SQ * 0.48}" fill="url(#chCheck)"/>`;
    }
    if (st.phase === 'over' && st.reason === 'mate') {
      const { x, y } = this.xy(kingSq(st.board, 1 - st.winner!));
      m += `<circle cx="${x}" cy="${y}" r="${SQ * 0.5}" fill="url(#chCheck)"/>`;
    }
    this.gMarks.innerHTML = m;
    this.renderTargets();
  }

  private renderTargets() {
    const from = this.selected ?? this.hover;
    let t = '';
    if (from != null && this.s) {
      const { x, y } = this.xy(from);
      t += `<rect x="${x - SQ / 2}" y="${y - SQ / 2}" width="${SQ}" height="${SQ}" class="ch-sel${this.selected != null ? '' : ' ch-preview'}"/>`;
      const live = this.selected != null;
      const seen = new Set<number>();
      for (const mv of this.moves.filter((x) => x.from === from)) {
        // рокировка: можно нажать и на поле короля, и на свою ладью
        const spots = mv.castle ? [mv.to, mv.rook!] : [mv.to];
        for (const to of spots) {
          if (seen.has(to) || to === from) continue;
          seen.add(to);
          const c = this.xy(to);
          const cap = !!mv.captured && !mv.ep ? true : mv.ep;
          const cls = `ch-tgt${live ? '' : ' ch-preview'}`;
          t += cap
            ? `<g class="${cls}" data-to="${to}"><rect x="${c.x - SQ / 2}" y="${c.y - SQ / 2}" width="${SQ}" height="${SQ}" fill="transparent"/><circle cx="${c.x}" cy="${c.y}" r="${SQ * 0.44}" class="ch-ring"/></g>`
            : `<g class="${cls}" data-to="${to}"><rect x="${c.x - SQ / 2}" y="${c.y - SQ / 2}" width="${SQ}" height="${SQ}" fill="transparent"/><circle cx="${c.x}" cy="${c.y}" r="${SQ * 0.15}" class="ch-dot"/></g>`;
        }
      }
    }
    this.gTargets.innerHTML = t;
  }

  // ---------------------------------------------------------------- ход игрока

  private onClick(e: MouseEvent) {
    if (this.actSeat == null || !this.s) return;
    const tgt = (e.target as Element).closest('[data-to]') as SVGElement | null;
    if (tgt && this.selected != null) return this.pick(+tgt.dataset.to!);
    const pc = (e.target as Element).closest('[data-sq]') as SVGElement | null;
    // нажатие по клетке: своя фигура — выбрать, иначе — сбросить выбор
    let sq: number | null = pc ? +pc.dataset.sq! : this.squareAt(e);
    if (sq != null && this.selected != null && this.moves.some((m) => m.from === this.selected && (m.to === sq || m.rook === sq))) return this.pick(sq);
    if (sq != null && !this.moves.some((m) => m.from === sq)) sq = null;
    this.selected = sq;
    if (sq != null) Sound.ui();
    this.hidePromo();
    this.renderTargets();
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

  private pick(to: number) {
    const from = this.selected;
    if (from == null) return;
    const opts = this.moves.filter((m) => m.from === from && (m.to === to || (m.castle && m.rook === to)));
    if (!opts.length) return;
    if (opts.some((m) => m.promo)) return this.askPromo(from, opts[0].to);
    this.send(from, opts[0].castle ? opts[0].rook! : to);
  }

  private askPromo(from: number, to: number) {
    const st = this.s!;
    const c = colorOf(st.board[from]);
    this.promo.hidden = false;
    this.promo.innerHTML = '<div class="ch-ask">Во что превратить пешку?</div>';
    const row = h('<div class="ch-promo-row"></div>');
    for (const p of ['Q', 'R', 'B', 'N'] as Promo[]) {
      const b = h<HTMLButtonElement>(`<button class="btn ch-pp" title="${{ Q: 'Ферзь', R: 'Ладья', B: 'Слон', N: 'Конь' }[p]}"><svg viewBox="0 0 100 100"><use href="${pieceRef(c === 0 ? p : p.toLowerCase())}"/></svg></button>`);
      b.onclick = () => this.send(from, to, p);
      row.appendChild(b);
    }
    this.promo.appendChild(row);
  }

  private hidePromo() {
    this.promo.hidden = true;
    this.promo.innerHTML = '';
  }

  private send(from: number, to: number, promo?: Promo) {
    const seat = this.actSeat;
    if (seat == null) return;
    Sound.unlock();
    this.clearTurn();
    this.ctx.act(seat, { type: 'move', from, to, promo });
  }

  private clearTurn() {
    this.actSeat = null;
    this.moves = [];
    this.selected = null;
    this.hover = null;
    this.confirmResign = false;
    this.btns.innerHTML = '';
    this.hidePromo();
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

  private act(seat: number, a: Parameters<ViewCtx['act']>[1]) {
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
    // своё время вышло — сообщаем (хозяин партии проверит по своим часам)
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
    const flip = this.userFlip ?? auto;
    if (flip !== this.flipped) this.flipped = flip;
    this.renderCoords();
    this.render();
    this.renderClocks();
  }

  setView(s: State) {
    this.s = s;
    this.recvAt = Date.now();
    this.gBanner.innerHTML = '';
    this.applyFlip();
  }

  async play(events: Event[], s: State) {
    const speed = this.ctx.speed();
    this.clearTurn();
    for (const ev of events) {
      if (ev.type === 'move') {
        await this.animate(ev.move, 260 / speed);
        if (ev.move.captured) Sound.capture();
        else Sound.place();
        if (ev.check) Sound.turn();
      } else if (ev.type === 'offer' || ev.type === 'decline') {
        Sound.ui();
        await this.banner(ev.type === 'offer' ? 'Предложена ничья' : 'Играем дальше', 900 / speed);
      } else if (ev.type === 'end') {
        Sound.win();
        const txt =
          ev.winner == null
            ? ev.reason === 'stalemate'
              ? 'Пат — ничья'
              : 'Ничья'
            : ev.reason === 'mate'
              ? `Мат! Победа ${ev.winner === 0 ? 'белых' : 'чёрных'}`
              : `Победа ${ev.winner === 0 ? 'белых' : 'чёрных'}`;
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

  private async animate(m: Move, dur: number) {
    const el = this.gPieces.querySelector(`[data-sq="${m.from}"]`) as SVGGElement | null;
    if (!el || document.hidden) return;
    const a = this.xy(m.from);
    const b = this.xy(m.to);
    // съеденная фигура тает
    const capSq = m.ep ? m.to + (colorOf(m.piece) === 0 ? -8 : 8) : m.to;
    if (m.captured) this.gPieces.querySelector(`[data-sq="${capSq}"]`)?.classList.add('ch-gone');
    this.gPieces.appendChild(el);
    const t0 = performance.now();
    const rookEl = m.castle ? (this.gPieces.querySelector(`[data-sq="${m.rook}"]`) as SVGGElement | null) : null;
    const ra = m.castle ? this.xy(m.rook!) : null;
    const rt = m.castle ? this.xy((rankOf(m.from) * 8) + (m.castle === 'K' ? 5 : 3)) : null;
    await new Promise<void>((res) => {
      const step = (now: number) => {
        const t = Math.min(1, (now - t0) / dur);
        const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        const lift = Math.sin(Math.PI * t) * 0.08;
        el.setAttribute('transform', `translate(${a.x + (b.x - a.x) * e - (SQ / 2) * (1 + lift)},${a.y + (b.y - a.y) * e - (SQ / 2) * (1 + lift)}) scale(${1 + lift})`);
        if (rookEl && ra && rt) rookEl.setAttribute('transform', `translate(${ra.x + (rt.x - ra.x) * e - SQ / 2},${ra.y + (rt.y - ra.y) * e - SQ / 2})`);
        if (t < 1) requestAnimationFrame(step);
        else res();
      };
      requestAnimationFrame(step);
      setTimeout(res, dur + 150);
    });
  }

  private async banner(text: string, ms: number) {
    this.gBanner.innerHTML = `<g class="ch-banner"><rect x="${W / 2 - 250}" y="${W / 2 - 40}" width="500" height="80" rx="14"/><text x="${W / 2}" y="${W / 2 + 2}">${text}</text></g>`;
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
    // хот-сит: доска поворачивается к тому, кто ходит, только если игрок сам не перевернул её
    if (this.ctx.mySeats.length > 1 && this.userFlip == null) {
      this.flipped = false;
      this.renderCoords();
      this.render();
    }
    if (st.phase === 'play') this.moves = legalMoves(st);
    this.renderButtons();
    this.renderTargets();
  }

  status(st: State, _toAct: number[], interactive: number[]) {
    const name = (p: number) => this.ctx.name(p);
    if (st.phase === 'over') return st.winner == null ? 'Ничья' : `Победа: ${name(st.winner)}`;
    if (st.phase === 'draw') return interactive.includes(1 - st.offer) ? 'Вам предлагают ничью' : `${name(st.offer)} предложили ничью…`;
    const who = name(st.turn);
    const check = inCheck(st) ? ' — <b>шах!</b>' : '';
    return interactive.includes(st.turn) ? `Ваш ход: ${who}${check}` : `Ходят ${who}${check}…`;
  }

  playerStats(st: State, seat: number) {
    const took = st.captured[seat].map((p) => p.toUpperCase()).sort((a, b) => VAL[b] - VAL[a]);
    const mat = (c: number) => st.board.reduce((a, p) => a + (p && colorOf(p) === c ? VAL[p.toUpperCase()] : 0), 0);
    const diff = mat(seat) - mat(1 - seat);
    return `<span class="ch-took" title="Взятые фигуры">${took.map((p) => GLYPH[p]).join('')}</span>${diff > 0 ? `<span title="Перевес">+${diff}</span>` : ''}`;
  }

  destroy() {
    clearInterval(this.tick);
  }
}

export function createView(): GameView<State, Event> {
  return new ChessView();
}
