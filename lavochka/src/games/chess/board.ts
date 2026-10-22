/* Шахматы — доска для кружка, задач и разборов: та же резная доска и точёные фигуры, что за столом,
 * но без партии — позицию задаёт хозяин. Ход мышью/тапом (фигура → поле), превращение, стрелки, подсветка полей,
 * поворот доски, плавный переезд фигур. */
import { Sound } from '../../core/audio';
import { h } from '../../core/util';
import { woodTexture, WOODS } from '../../core/wood';
import { colorOf, fileOf, inCheck, kingSq, legalMoves, rankOf, type Move, type Promo, type State } from './engine';
import { position, toFen } from './notation';
import { pieceDefs, pieceRef } from './pieces';
import './chess.css';

const NS = 'http://www.w3.org/2000/svg';
const SQ = 80;
const F = 44;
const W = F * 2 + SQ * 8;

export interface Arrow {
  from: number;
  to: number;
  /** good — зелёная (лучший ход), bad — красная (ошибка), info — синяя (идея), hint — жёлтая. */
  kind?: 'good' | 'bad' | 'info' | 'hint';
}

export interface Mark {
  sq: number;
  /** star — звёздочка на поле (упражнение «собери звёздочки»). */
  kind: 'good' | 'bad' | 'info' | 'hint' | 'star';
}

export interface BoardOpts {
  flipped?: boolean;
  /** Подписи вертикалей и горизонталей на рамке (по умолчанию есть). */
  coords?: boolean;
}

let uid = 0;

export class Board {
  readonly el: HTMLElement;
  private svg: SVGSVGElement;
  private g: Record<'coords' | 'marks' | 'arrows' | 'targets' | 'pieces', SVGGElement>;
  private promo: HTMLElement;
  private s: State = position();
  private flippedV = false;
  private side: 0 | 1 | null = null;
  private moves: Move[] = [];
  private onMove: ((m: Move) => void) | null = null;
  private selected: number | null = null;
  private arrows: Arrow[] = [];
  private marks: Mark[] = [];
  private last: { from: number; to: number } | null = null;
  private id = `b${++uid}`;

  constructor(host: HTMLElement, o: BoardOpts = {}) {
    this.flippedV = !!o.flipped;
    this.el = h(`<div class="ch-wrap kb-wrap"><svg class="ch-board" xmlns="${NS}" viewBox="0 0 ${W} ${W}"></svg><div class="kb-promo" hidden></div></div>`);
    host.appendChild(this.el);
    this.svg = this.el.querySelector('svg') as SVGSVGElement;
    this.promo = this.el.querySelector('.kb-promo') as HTMLElement;
    this.build(o.coords !== false);
    this.g = {
      coords: this.svg.querySelector('.kb-coords') as SVGGElement,
      marks: this.svg.querySelector('.kb-marks') as SVGGElement,
      arrows: this.svg.querySelector('.kb-arrows') as SVGGElement,
      targets: this.svg.querySelector('.kb-targets') as SVGGElement,
      pieces: this.svg.querySelector('.kb-pieces') as SVGGElement,
    };
    this.svg.addEventListener('click', (e) => this.click(e));
    this.render();
  }

  // ---------------------------------------------------------------- снаружи

  get state(): State {
    return this.s;
  }

  get fen(): string {
    return toFen(this.s);
  }

  get flipped() {
    return this.flippedV;
  }

  /** Поставить позицию. last — подсветить последний ход. */
  set(pos: State | string, last: { from: number; to: number } | null = null) {
    this.s = typeof pos === 'string' ? position(pos) : pos;
    this.last = last ?? (typeof pos === 'string' ? null : pos.last);
    this.selected = null;
    this.hidePromo();
    if (this.side != null) this.moves = this.s.turn === this.side ? legalMoves(this.s) : [];
    this.render();
  }

  /** Ждать хода стороны side (null — доска только для показа). */
  input(side: 0 | 1 | null, onMove?: (m: Move) => void) {
    this.side = side;
    this.onMove = onMove ?? null;
    this.moves = side != null && this.s.turn === side ? legalMoves(this.s) : [];
    this.selected = null;
    this.el.classList.toggle('kb-live', side != null);
    this.renderTargets();
  }

  flip(on = !this.flippedV) {
    this.flippedV = on;
    this.render();
  }

  /** Стрелки и подсветка полей (поверх последнего хода). */
  draw(arrows: Arrow[] = [], marks: Mark[] = []) {
    this.arrows = arrows;
    this.marks = marks;
    this.renderMarks();
    this.renderArrows();
  }

  destroy() {
    this.el.remove();
  }

  // ---------------------------------------------------------------- рисунок

  private build(coords: boolean) {
    const light = woodTexture(WOODS.maple, 256, 31);
    const dark = woodTexture(WOODS.walnut, 256, 17);
    const frame = woodTexture(WOODS.stained, 512, 5, false);
    const id = this.id;
    let s = `<defs>
      <pattern id="${id}L" patternUnits="userSpaceOnUse" width="${SQ * 2}" height="${SQ * 2}"><image href="${light}" width="${SQ * 2}" height="${SQ * 2}" preserveAspectRatio="none"/></pattern>
      <pattern id="${id}D" patternUnits="userSpaceOnUse" width="${SQ * 2}" height="${SQ * 2}"><image href="${dark}" width="${SQ * 2}" height="${SQ * 2}" preserveAspectRatio="none"/></pattern>
      <linearGradient id="${id}Lac" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".14"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".16"/></linearGradient>
      <radialGradient id="${id}Check"><stop offset="0" stop-color="#ff2a1a" stop-opacity=".9"/><stop offset=".55" stop-color="#ff2a1a" stop-opacity=".35"/><stop offset="1" stop-color="#ff2a1a" stop-opacity="0"/></radialGradient>
      <filter id="${id}Shadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="2" dy="3" stdDeviation="2" flood-color="#1a0a02" flood-opacity=".55"/></filter>
      <clipPath id="${id}Round"><rect width="${W}" height="${W}" rx="14"/></clipPath>
      ${['good', 'bad', 'info', 'hint'].map((k) => `<marker id="${id}A${k}" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="3.2" markerHeight="3.2" orient="auto"><path d="M0 0 L10 5 L0 10 z" class="kb-head kb-${k}"/></marker>`).join('')}
      ${pieceDefs()}
    </defs>`;
    s += `<rect width="${W}" height="${W}" rx="14" fill="#2a1408"/><image href="${frame}" width="${W}" height="${W}" preserveAspectRatio="none" opacity=".95" clip-path="url(#${id}Round)"/>`;
    s += `<rect x="${F - 6}" y="${F - 6}" width="${SQ * 8 + 12}" height="${SQ * 8 + 12}" rx="3" fill="#1a0c04"/>`;
    for (let r = 0; r < 8; r++)
      for (let f = 0; f < 8; f++) s += `<rect x="${F + f * SQ}" y="${F + r * SQ}" width="${SQ}" height="${SQ}" fill="url(#${id}${(r + f) % 2 ? 'D' : 'L'})"/>`;
    s += `<rect x="${F}" y="${F}" width="${SQ * 8}" height="${SQ * 8}" fill="url(#${id}Lac)" pointer-events="none"/>`;
    s += `<g class="kb-coords"${coords ? '' : ' hidden'}></g><g class="kb-marks"></g><g class="kb-targets"></g><g class="kb-pieces"></g><g class="kb-arrows" pointer-events="none"></g>`;
    s += `<rect x="${W / 2 - 3}" y="${F - 6}" width="6" height="${SQ * 8 + 12}" fill="#0d0502" opacity=".35" pointer-events="none"/>`;
    this.svg.innerHTML = s;
  }

  private xy(sq: number) {
    const f = this.flippedV ? 7 - fileOf(sq) : fileOf(sq);
    const r = this.flippedV ? rankOf(sq) : 7 - rankOf(sq);
    return { x: F + f * SQ + SQ / 2, y: F + r * SQ + SQ / 2 };
  }

  private render() {
    let c = '';
    for (let i = 0; i < 8; i++) {
      const file = 'abcdefgh'[this.flippedV ? 7 - i : i];
      const rank = String(this.flippedV ? i + 1 : 8 - i);
      const x = F + i * SQ + SQ / 2;
      c += `<text class="ch-coord" x="${x}" y="${W - F / 2 + 1}">${file}</text><text class="ch-coord" x="${x}" y="${F / 2 + 1}">${file}</text>`;
      c += `<text class="ch-coord" x="${F / 2}" y="${x}">${rank}</text><text class="ch-coord" x="${W - F / 2}" y="${x}">${rank}</text>`;
    }
    this.g.coords.innerHTML = c;
    let p = '';
    for (let sq = 0; sq < 64; sq++) {
      const pc = this.s.board[sq];
      if (!pc) continue;
      const { x, y } = this.xy(sq);
      p += `<g class="ch-pc" data-sq="${sq}" transform="translate(${x - SQ / 2},${y - SQ / 2})"><use href="${pieceRef(pc)}" x="${-SQ * 0.06}" y="${-SQ * 0.1}" width="${SQ * 1.12}" height="${SQ * 1.12}" filter="url(#${this.id}Shadow)"/></g>`;
    }
    this.g.pieces.innerHTML = p;
    this.renderMarks();
    this.renderArrows();
    this.renderTargets();
  }

  private rect(sq: number, cls: string) {
    const { x, y } = this.xy(sq);
    return `<rect x="${x - SQ / 2}" y="${y - SQ / 2}" width="${SQ}" height="${SQ}" class="${cls}"/>`;
  }

  private renderMarks() {
    let m = '';
    if (this.last) for (const sq of [this.last.from, this.last.to]) m += this.rect(sq, 'ch-last');
    for (const k of this.marks) {
      if (k.kind !== 'star') {
        m += this.rect(k.sq, `kb-mark kb-${k.kind}`);
        continue;
      }
      const { x, y } = this.xy(k.sq);
      const pts = Array.from({ length: 10 }, (_, i) => {
        const r = (i % 2 ? 0.17 : 0.38) * SQ;
        const a = (Math.PI / 5) * i - Math.PI / 2;
        return `${(x + r * Math.cos(a)).toFixed(1)},${(y + r * Math.sin(a)).toFixed(1)}`;
      });
      m += `<polygon class="kb-star" points="${pts.join(' ')}"/>`;
    }
    if (inCheck(this.s)) {
      const { x, y } = this.xy(kingSq(this.s.board, this.s.turn));
      m += `<circle cx="${x}" cy="${y}" r="${SQ * 0.48}" fill="url(#${this.id}Check)"/>`;
    }
    this.g.marks.innerHTML = m;
  }

  private renderArrows() {
    let a = '';
    for (const ar of this.arrows) {
      const p = this.xy(ar.from);
      const q = this.xy(ar.to);
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const len = Math.hypot(dx, dy) || 1;
      const k = ar.kind ?? 'good';
      // конец стрелки не доходит до центра поля — чтобы наконечник не закрывал фигуру целиком
      const ex = q.x - (dx / len) * SQ * 0.28;
      const ey = q.y - (dy / len) * SQ * 0.28;
      const sx = p.x + (dx / len) * SQ * 0.18;
      const sy = p.y + (dy / len) * SQ * 0.18;
      a += `<line x1="${sx}" y1="${sy}" x2="${ex}" y2="${ey}" class="kb-arrow kb-${k}" marker-end="url(#${this.id}A${k})"/>`;
    }
    this.g.arrows.innerHTML = a;
  }

  private renderTargets() {
    let t = '';
    const from = this.selected;
    if (from != null) {
      t += this.rect(from, 'ch-sel');
      const seen = new Set<number>();
      for (const mv of this.moves.filter((x) => x.from === from)) {
        for (const to of mv.castle ? [mv.to, mv.rook!] : [mv.to]) {
          if (seen.has(to) || to === from) continue;
          seen.add(to);
          const c = this.xy(to);
          t += mv.captured
            ? `<g class="ch-tgt" data-to="${to}"><rect x="${c.x - SQ / 2}" y="${c.y - SQ / 2}" width="${SQ}" height="${SQ}" fill="transparent"/><circle cx="${c.x}" cy="${c.y}" r="${SQ * 0.44}" class="ch-ring"/></g>`
            : `<g class="ch-tgt" data-to="${to}"><rect x="${c.x - SQ / 2}" y="${c.y - SQ / 2}" width="${SQ}" height="${SQ}" fill="transparent"/><circle cx="${c.x}" cy="${c.y}" r="${SQ * 0.15}" class="ch-dot"/></g>`;
        }
      }
    }
    this.g.targets.innerHTML = t;
  }

  // ---------------------------------------------------------------- ход

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
    return (this.flippedV ? ry : 7 - ry) * 8 + (this.flippedV ? 7 - fx : fx);
  }

  private click(e: MouseEvent) {
    if (!this.moves.length) return;
    const tgt = (e.target as Element).closest('[data-to]') as SVGElement | null;
    if (tgt && this.selected != null) return this.pick(+tgt.dataset.to!);
    const sq = this.squareAt(e);
    if (sq != null && this.selected != null && this.moves.some((m) => m.from === this.selected && (m.to === sq || m.rook === sq))) return this.pick(sq);
    this.selected = sq != null && this.moves.some((m) => m.from === sq) ? sq : null;
    if (this.selected != null) Sound.ui();
    this.hidePromo();
    this.renderTargets();
  }

  private pick(to: number) {
    const from = this.selected!;
    const opts = this.moves.filter((m) => m.from === from && (m.to === to || (m.castle && m.rook === to)));
    if (!opts.length) return;
    if (opts.some((m) => m.promo)) return this.askPromo(opts);
    this.done(opts[0]);
  }

  private askPromo(opts: Move[]) {
    const c = colorOf(opts[0].piece);
    this.promo.hidden = false;
    this.promo.innerHTML = '<b>Во что превратить пешку?</b>';
    const row = h('<div class="ch-promo-row"></div>');
    for (const p of ['Q', 'R', 'B', 'N'] as Promo[]) {
      const b = h<HTMLButtonElement>(`<button class="btn ch-pp" title="${{ Q: 'Ферзь', R: 'Ладья', B: 'Слон', N: 'Конь' }[p]}"><svg viewBox="0 0 100 100"><use href="${pieceRef(c === 0 ? p : p.toLowerCase())}"/></svg></button>`);
      b.onclick = () => this.done(opts.find((m) => m.promo === p)!);
      row.appendChild(b);
    }
    this.promo.appendChild(row);
  }

  private hidePromo() {
    this.promo.hidden = true;
    this.promo.innerHTML = '';
  }

  private done(m: Move) {
    Sound.unlock();
    this.selected = null;
    this.moves = [];
    this.hidePromo();
    this.renderTargets();
    this.onMove?.(m);
  }
}
