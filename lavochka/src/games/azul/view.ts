/* Плиточник — отрисовка: стройрынок (картонные ящики с плиткой и прилавок), стена ванной у каждого: слева — ведро с раствором
 * (пять строк-ступенек), справа — стена 5×5 (на цветной — бледные метки, куда какая плитка), внизу — «бой» со штрафами.
 * Картинки — public/azul/ (кафель, мастерок, ящик, штукатурка, прилавок, пол). Ход: коснуться плитки в ящике или на прилавке
 * (выделятся все такого вида), потом — строки ведра или «боя». Серая стена: при кладке — коснуться клетки стены. */
import { Sound } from '../../core/audio';
import { h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { FLOOR, KIND_RU, kindAt, legal, TROWEL, type Action, type Board, type Event, type State } from './engine';
import './azul.css';

const BASE = `${import.meta.env.BASE_URL}azul/`;
const tileImg = (k: number) => (k === TROWEL ? `${BASE}trowel.webp` : `${BASE}t${k}.webp`);

const W = 1000;
const T = 52; // плитка на своей стене

function tile(k: number, x: number, y: number, s: number, extra = '', attrs = ''): string {
  if (k === TROWEL)
    return `<image href="${tileImg(k)}" x="${x + s * 0.22}" y="${y - s * 0.05}" width="${s * 0.56}" height="${s * 1.1}" class="az-trowel${extra}" ${attrs}/>`;
  return `<g class="az-t${extra}" ${attrs}><rect x="${x + 1}" y="${y + 2}" width="${s - 2}" height="${s - 2}" rx="${s * 0.06}" fill="rgba(0,0,0,0.35)"/>
    <image href="${tileImg(k)}" x="${x}" y="${y}" width="${s - 2}" height="${s - 2}" clip-path="inset(0 round ${s * 0.06}px)"/>
    <rect x="${x + 0.5}" y="${y + 0.5}" width="${s - 3}" height="${s - 3}" rx="${s * 0.06}" class="az-bevel"/></g>`;
}

/** Стена игрока: x, y — левый верхний угол, s — размер плитки. sel — какие строки подсветить, wallCols — какие клетки (серая кладка). */
function boardSvg(st: State, seat: number, x: number, y: number, s: number, name: string, opts: { rows?: Set<number>; cells?: Set<number>; me?: boolean; turn?: boolean } = {}): string {
  const b: Board = st.boards[seat];
  const lw = 5 * s; // ведро
  const gap = s * 0.5;
  const bw = lw + gap + 5 * s + s * 0.6;
  const bh = 5 * s + s * 1.9 + s * 0.7;
  let o = `<g class="az-board${opts.turn ? ' turn' : ''}">`;
  o += `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" rx="${s * 0.25}" fill="url(#az-wall)" class="az-bg"/>`;
  o += `<text x="${x + s * 0.3}" y="${y + s * 0.55}" class="az-name" style="font-size:${s * 0.38}px">${name} — ${b.score}</text>`;
  const top = y + s * 0.8;
  // ведро: строки-ступеньки справа налево
  for (let r = 0; r < 5; r++) {
    const L = b.lines[r];
    const hl = opts.rows?.has(r);
    for (let i = 0; i <= r; i++) {
      const cx = x + s * 0.3 + lw - (i + 1) * s;
      const cy = top + r * s;
      o += `<rect x="${cx + 2}" y="${cy + 2}" width="${s - 4}" height="${s - 4}" rx="${s * 0.08}" class="az-slot${hl ? ' hl' : ''}" ${hl ? `data-row="${r}"` : ''}/>`;
      if (i < L.n) o += tile(L.k, cx + 1, cy + 1, s - 2);
    }
    if (hl) o += `<rect x="${x + s * 0.3 + lw - (r + 1) * s}" y="${top + r * s}" width="${(r + 1) * s}" height="${s}" class="az-hit" data-row="${r}"/>`;
  }
  // стена
  const wx = x + s * 0.3 + lw + gap;
  for (let r = 0; r < 5; r++)
    for (let c = 0; c < 5; c++) {
      const cx = wx + c * s;
      const cy = top + r * s;
      const k = b.wall[r][c];
      const cellHl = opts.cells?.has(r * 5 + c);
      o += `<rect x="${cx + 1}" y="${cy + 1}" width="${s - 2}" height="${s - 2}" rx="${s * 0.06}" class="az-cell${cellHl ? ' hl' : ''}" ${cellHl ? `data-col="${c}"` : ''}/>`;
      if (k >= 0) o += tile(k, cx + 1, cy + 1, s - 2);
      else if (!st.cfg.grey) o += `<image href="${tileImg(kindAt(r, c))}" x="${cx + 3}" y="${cy + 3}" width="${s - 6}" height="${s - 6}" class="az-ghost"/>`;
    }
  // «бой»
  const fy = top + 5 * s + s * 0.35;
  const hlF = opts.rows?.has(5);
  for (let i = 0; i < 7; i++) {
    const cx = x + s * 0.3 + i * s * 1.02;
    o += `<rect x="${cx + 2}" y="${fy + 2}" width="${s - 4}" height="${s - 4}" rx="${s * 0.08}" class="az-slot floor${hlF ? ' hl' : ''}"/>`;
    o += `<text x="${cx + s / 2}" y="${fy + s + s * 0.32}" class="az-pen" style="font-size:${s * 0.3}px">${FLOOR[i]}</text>`;
    if (i < b.floor.length) o += tile(b.floor[i], cx + 1, fy + 1, s - 2);
  }
  o += `<text x="${x + s * 0.3 + 7 * s * 1.02 + s * 0.2}" y="${fy + s * 0.62}" class="az-lbl" style="font-size:${s * 0.34}px">бой</text>`;
  if (hlF) o += `<rect x="${x + s * 0.3}" y="${fy}" width="${7 * s * 1.02}" height="${s}" class="az-hit" data-row="5"/>`;
  return o + '</g>';
}

const boardSize = (s: number) => ({ w: 5 * s + s * 0.5 + 5 * s + s * 0.6, h: 5 * s + s * 1.9 + s * 0.7 });

class AzulView implements GameView<State, Event> {
  private ctx!: ViewCtx;
  private svg!: SVGSVGElement;
  private info!: HTMLElement;
  private s: State | null = null;
  private act: number | null = null;
  private pick: { src: number; kind: number } | null = null;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    const wrap = h('<div class="az-wrap"><svg class="az-svg"></svg></div>');
    root.appendChild(wrap);
    this.svg = wrap.querySelector('svg') as SVGSVGElement;
    this.info = h('<div class="az-info"></div>');
    ctx.controls.appendChild(this.info);
    this.svg.addEventListener('click', (e) => this.click(e));
  }

  /** Имя без разметки — для текста внутри SVG (ctx.name отдаёт HTML, уже экранированный). */
  private plain(seat: number): string {
    return this.ctx.name(seat).replace(/<[^>]+>/g, '');
  }

  /** Чья стена крупно: тот, кто ходит здесь, иначе своё место, иначе ходящий. */
  private main(): number {
    const s = this.s!;
    if (this.act != null) return this.act;
    if (this.ctx.mySeats.length) return this.ctx.mySeats[0];
    return s.phase === 'wall' ? s.tiling!.seat : s.turn;
  }

  private draw() {
    const s = this.s;
    if (!s) return;
    const me = this.main();
    const others = Array.from({ length: s.players }, (_, i) => i).filter((i) => i !== me);
    const ms = this.act != null ? legal(s) : [];
    // соперники сверху
    const os = others.length <= 1 ? 34 : others.length === 2 ? 30 : 24;
    const ob = boardSize(os);
    const oy = 10;
    const ow = Math.min(W / Math.max(1, others.length), ob.w + 20);
    let o = `<defs><pattern id="az-wall" patternContentUnits="objectBoundingBox" width="1" height="1"><image href="${BASE}wall.webp" width="1" height="1" preserveAspectRatio="xMidYMid slice"/></pattern>
      <pattern id="az-wood" patternContentUnits="objectBoundingBox" width="1" height="1"><image href="${BASE}counter.webp" width="1" height="1" preserveAspectRatio="xMidYMid slice"/></pattern></defs>`;
    others.forEach((p, i) => {
      const x = (W - ow * others.length) / 2 + i * ow + (ow - ob.w) / 2;
      o += boardSvg(s, p, x, oy, os, this.plain(p), { turn: s.turn === p && s.phase === 'take' });
    });
    // рынок
    const my = oy + ob.h + 16;
    const nf = s.factories.length;
    const fs = 30; // плитка в ящике
    const box = fs * 2 + 34;
    const perRow = nf <= 5 ? nf : Math.ceil(nf / 2);
    const rows = Math.ceil(nf / perRow);
    const centerW = 300;
    const fx0 = 20;
    for (let f = 0; f < nf; f++) {
      const r = Math.floor(f / perRow);
      const c = f % perRow;
      const x = fx0 + c * (box + 12);
      const y = my + r * (box + 12);
      o += `<image href="${BASE}box.webp" x="${x - 6}" y="${y - 6}" width="${box + 12}" height="${box + 12}" preserveAspectRatio="none"/>`;
      s.factories[f].forEach((k, i) => {
        const sel = this.pick && this.pick.src === f && this.pick.kind === k;
        const can = this.act != null && s.phase === 'take';
        o += tile(k, x + 17 + (i % 2) * fs, y + 17 + Math.floor(i / 2) * fs, fs, sel ? ' sel' : can ? ' can' : '', can ? `data-src="${f}" data-kind="${k}"` : '');
      });
    }
    const marketW = fx0 + perRow * (box + 12);
    const cx = Math.max(marketW + 10, W - centerW - 20);
    const ch = rows * (box + 12) - 12;
    o += `<rect x="${cx}" y="${my}" width="${centerW}" height="${Math.max(ch, 110)}" rx="10" fill="url(#az-wood)" class="az-counter"/>`;
    o += `<text x="${cx + 10}" y="${my + 18}" class="az-lbl" style="font-size:13px">прилавок</text>`;
    const cs = 30;
    let ci = 0;
    if (s.trowel) {
      o += tile(TROWEL, cx + 10, my + 26, cs + 6);
      ci = 1;
    }
    s.center.forEach((k) => {
      const i = ci++;
      const perLine = Math.floor((centerW - 20) / (cs + 2));
      const sel = this.pick && this.pick.src === -1 && this.pick.kind === k;
      const can = this.act != null && s.phase === 'take';
      o += tile(k, cx + 10 + (i % perLine) * (cs + 2), my + 26 + Math.floor(i / perLine) * (cs + 4), cs, sel ? ' sel' : can ? ' can' : '', can ? `data-src="-1" data-kind="${k}"` : '');
    });
    // своя стена
    const by = my + Math.max(ch, 110) + 18;
    const bs = boardSize(T);
    const rowsHl = new Set<number>();
    if (this.pick) for (const m of ms) if (m.type === 'take' && m.src === this.pick.src && m.kind === this.pick.kind) rowsHl.add(m.row);
    const cells = new Set<number>();
    if (s.phase === 'wall' && this.act != null) for (const m of ms) if (m.type === 'wall') cells.add(s.tiling!.row * 5 + m.col);
    o += boardSvg(s, me, (W - bs.w) / 2, by, T, this.plain(me), { rows: rowsHl, cells, me: true, turn: s.turn === me });
    const H = by + bs.h + 10;
    this.svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    this.svg.innerHTML = o;
    this.text();
  }

  private text() {
    const s = this.s!;
    if (this.act == null) {
      this.info.innerHTML = s.over ? '' : `<small>Раунд ${s.round}. В мешке ${s.bag.reduce((a, b) => a + b, 0)} плиток.</small>`;
      return;
    }
    if (s.phase === 'wall') this.info.innerHTML = `Кладка: выберите клетку стены для плитки из строки ${s.tiling!.row + 1}.`;
    else if (!this.pick) this.info.innerHTML = 'Коснитесь плитки в ящике или на прилавке — возьмёте все такого вида.';
    else this.info.innerHTML = `Взять ${KIND_RU[this.pick.kind]} — куда положить? Коснитесь строки ведра или «боя».`;
  }

  private click(e: MouseEvent) {
    const s = this.s;
    if (!s || this.act == null) return;
    const el = (e.target as Element).closest('[data-src],[data-row],[data-col]');
    if (!el) {
      if (this.pick) (this.pick = null), this.draw();
      return;
    }
    if (el.hasAttribute('data-col')) return this.send({ type: 'wall', col: Number(el.getAttribute('data-col')) });
    if (el.hasAttribute('data-row') && this.pick) return this.send({ type: 'take', src: this.pick.src, kind: this.pick.kind, row: Number(el.getAttribute('data-row')) });
    if (el.hasAttribute('data-src')) {
      const src = Number(el.getAttribute('data-src'));
      const kind = Number(el.getAttribute('data-kind'));
      this.pick = this.pick && this.pick.src === src && this.pick.kind === kind ? null : { src, kind };
      Sound.ui();
      this.draw();
    }
  }

  private send(a: Action) {
    const seat = this.act;
    if (seat == null) return;
    Sound.unlock();
    this.act = null;
    this.pick = null;
    this.ctx.act(seat, a);
  }

  async play(events: Event[], v: State) {
    this.act = null;
    this.s = v;
    this.draw();
    let tiles = 0;
    for (const ev of events) {
      if (ev.type === 'take') Sound.place();
      else if (ev.type === 'tile') tiles++;
      else if (ev.type === 'floor') Sound.nomove();
      else if (ev.type === 'end') Sound.win();
    }
    if (tiles) {
      Sound.capture();
      await sleep(500 / this.ctx.speed());
    }
    await sleep(260 / this.ctx.speed());
  }

  setView(v: State) {
    this.s = v;
    this.draw();
  }

  setTurn(toAct: number[], interactive: number[]) {
    const s = this.s;
    this.pick = null;
    this.act = s && !s.over && !this.ctx.demo ? (interactive.find((x) => toAct.includes(x)) ?? null) : null;
    this.draw();
  }

  status(v: State, toAct: number[], interactive: number[]) {
    if (v.over) return v.winners.length > 1 ? 'Ничья' : `Победа: ${this.ctx.name(v.winners[0])} — ${v.boards[v.winners[0]].score}`;
    if (!interactive.includes(toAct[0])) return `Ходят ${this.ctx.name(toAct[0])}…`;
    return v.phase === 'wall' ? 'Кладка' : 'Ваш ход';
  }

  playerStats(v: State, seat: number) {
    return `${v.boards[seat]?.score ?? 0} очк.`;
  }
}

export function createView(): GameView<State, Event> {
  return new AzulView();
}
