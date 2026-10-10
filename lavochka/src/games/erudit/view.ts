/* Эрудит — отрисовка по советской коробке «Эрудит Э-3»: шоколадное пластиковое поле с рёбрами сетки,
 * цветные клетки (красная — слово ×3 с кружком, синяя — слово ×2, жёлтая — буква ×3, зелёная — буква ×2),
 * чёрные глянцевые фишки с белой буквой и ценой в углу, звёздочка — белый цветок.
 * Ход: выбрать фишку на руке (или тащить её) → нажать клетку; звёздочке назначить букву; нажать фишку на поле — вернуть.
 * Чужую звёздочку на поле можно выкупить нажатием (если есть её буква). Хот-сит — шторка перед рукой. */
import { Sound } from '../../core/audio';
import { esc, h, plural, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { ALPHABET } from '../../words/dict';
import { evaluate, JOKER, N, premiumOf, tileSet, valueOf, type Action, type Event, type Place, type View } from './engine';
import './erudit.css';

const NS = 'http://www.w3.org/2000/svg';
const C = 40;
const M = 26;
const BW = M * 2 + N * C;
const RY = BW + 14;
const T = 50;
const W = BW;
const H = RY + T + 34;
const KEYS = ['йцукенгшщзхъ', 'фывапролджэ', 'ячсмитьбю'];

const PREM_FILL: Record<string, string> = { W3: 'url(#erRed)', W2: 'url(#erBlue)', L3: 'url(#erYellow)', L2: 'url(#erGreen)' };

let boards = 0;

class EruditView implements GameView<View, Event> {
  private ctx!: ViewCtx<Action>;
  private svg!: SVGSVGElement;
  private gBoard!: SVGGElement;
  private gTiles!: SVGGElement;
  private gRack!: SVGGElement;
  private gDrag!: SVGGElement;
  private ctl!: HTMLElement;
  private say!: HTMLElement;
  private cover!: HTMLElement;
  private uid = `er${++boards}`;
  private s: View | null = null;
  private actSeat: number | null = null;
  private hidden = false;
  private shownSeat: number | null = null;
  // черновик хода
  private draft: Place[] = [];
  private take: number | null = null;
  private order: number[] = [];
  private sel: number | null = null;
  private asking: number | null = null;
  private swapMode = false;
  private swapSel = new Set<number>();
  private fresh = new Set<number>();
  private drag: { idx: number; x: number; y: number; moved: boolean } | null = null;

  mount(root: HTMLElement, ctx: ViewCtx<Action>) {
    this.ctx = ctx;
    const u = this.uid;
    const grad = (id: string, a: string, b: string) => `<linearGradient id="${u}${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;
    const wrap = h(`<div class="er-wrap">
        <svg class="er-board" xmlns="${NS}" viewBox="0 0 ${W} ${H}">
          <defs>
            ${grad('Red', '#e0392c', '#a8160f')}${grad('Blue', '#2f62a8', '#173a72')}${grad('Yellow', '#ffe04a', '#d9a90c')}${grad('Green', '#3fa04a', '#1f6a2a')}
            ${grad('Frame', '#5a3426', '#2c160e')}${grad('Cell', '#5b3324', '#4a281b')}${grad('Tile', '#2a2724', '#0b0a09')}${grad('Rack', '#6a3c2a', '#3a2016')}
            ${grad('Center', '#efe8d4', '#cfc4a8')}
          </defs>
          <g class="er-g-board"></g><g class="er-g-tiles"></g><g class="er-g-rack"></g><g class="er-g-drag"></g>
        </svg>
        <div class="er-cover" hidden><div class="er-cover-box"><div class="er-cover-t"></div><button class="btn primary">Показать фишки</button></div></div>
      </div>`);
    root.appendChild(wrap);
    this.svg = wrap.querySelector('svg') as SVGSVGElement;
    this.gBoard = this.svg.querySelector('.er-g-board') as SVGGElement;
    this.gTiles = this.svg.querySelector('.er-g-tiles') as SVGGElement;
    this.gRack = this.svg.querySelector('.er-g-rack') as SVGGElement;
    this.gDrag = this.svg.querySelector('.er-g-drag') as SVGGElement;
    this.cover = wrap.querySelector('.er-cover') as HTMLElement;
    (this.cover.querySelector('button') as HTMLButtonElement).onclick = () => {
      Sound.unlock();
      this.hidden = false;
      this.cover.hidden = true;
      this.shownSeat = this.actSeat;
      this.render();
    };
    this.ctl = h(`<div class="er-controls"><div class="er-say"></div><div class="er-ctl"></div></div>`);
    ctx.controls.appendChild(this.ctl);
    this.say = this.ctl.querySelector('.er-say') as HTMLElement;
    this.drawBoard();
    this.svg.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('keydown', this.onKey);
  }

  destroy() {
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('keydown', this.onKey);
  }

  // ---------------------------------------------------------------- рисунок поля (один раз)

  private cx(c: number) {
    return M + (c % N) * C;
  }
  private cy(c: number) {
    return M + Math.floor(c / N) * C;
  }

  private drawBoard() {
    const u = this.uid;
    let s = `<rect x="0" y="0" width="${BW}" height="${BW}" rx="10" fill="url(#${u}Frame)"/>
      <rect x="6" y="6" width="${BW - 12}" height="${BW - 12}" rx="7" fill="none" stroke="rgba(255,220,190,.12)" stroke-width="2"/>
      <rect x="${M - 3}" y="${M - 3}" width="${N * C + 6}" height="${N * C + 6}" fill="#2a140c"/>`;
    for (let c = 0; c < N * N; c++) {
      const x = this.cx(c);
      const y = this.cy(c);
      const p = premiumOf({ set: this.s?.cfg.set ?? 'erudit' }, c);
      const fill = p ? PREM_FILL[p].replace('#er', `#${u}`) : `url(#${u}Cell)`;
      s += `<rect x="${x + 2.5}" y="${y + 2.5}" width="${C - 5}" height="${C - 5}" fill="${fill}"/>`;
      // рёбра сетки: свет снизу-справа, тень сверху-слева — ячейка утоплена
      s += `<path d="M${x + 2.5} ${y + C - 2.5}V${y + 2.5}H${x + C - 2.5}" fill="none" stroke="rgba(0,0,0,.45)" stroke-width="1.6"/>`;
      s += `<path d="M${x + C - 2.5} ${y + 2.5}V${y + C - 2.5}H${x + 2.5}" fill="none" stroke="rgba(255,210,170,.16)" stroke-width="1.2"/>`;
      if (p === 'W3') s += `<circle cx="${x + C / 2}" cy="${y + C / 2}" r="${C * 0.26}" fill="none" stroke="rgba(90,0,0,.55)" stroke-width="2"/><circle cx="${x + C / 2}" cy="${y + C / 2}" r="${C * 0.26 - 1.6}" fill="none" stroke="rgba(255,190,170,.35)" stroke-width="1"/>`;
      if (p) s += `<rect x="${x + 3.5}" y="${y + 3.5}" width="${C - 7}" height="${(C - 7) * 0.4}" fill="rgba(255,255,255,.14)"/>`;
      if (c === 7 * N + 7 && !p) s += `<rect x="${x + 2.5}" y="${y + 2.5}" width="${C - 5}" height="${C - 5}" fill="url(#${u}Center)"/><text class="er-star" x="${x + C / 2}" y="${y + C / 2 + 7}">✱</text>`;
    }
    // подставка для руки
    s += `<rect x="${W / 2 - 4 * (T + 6) - 8}" y="${RY - 6}" width="${8 * (T + 6) + 16}" height="${T + 18}" rx="8" fill="url(#${u}Rack)"/>
      <rect x="${W / 2 - 4 * (T + 6) - 8}" y="${RY + T + 4}" width="${8 * (T + 6) + 16}" height="8" rx="3" fill="rgba(0,0,0,.35)"/>`;
    this.gBoard.innerHTML = s;
  }

  private tileSvg(x: number, y: number, size: number, letter: string, opts: { joker?: boolean; as?: string; cls?: string; value?: number } = {}) {
    const u = this.uid;
    const r = size * 0.12;
    const face = opts.joker
      ? `<text class="er-flower" x="${x + size / 2}" y="${y + size * 0.7}" font-size="${size * 0.62}">✽</text>${opts.as ? `<text class="er-as" x="${x + size * 0.2}" y="${y + size * 0.3}" font-size="${size * 0.26}">${opts.as.toUpperCase()}</text>` : ''}`
      : `<text class="er-letter" x="${x + size * 0.45}" y="${y + size * 0.68}" font-size="${size * 0.58}">${letter.toUpperCase()}</text>
         <text class="er-val" x="${x + size * 0.86}" y="${y + size * 0.88}" font-size="${size * 0.26}">${opts.value ?? ''}</text>`;
    return `<g class="er-tile ${opts.cls ?? ''}">
      <rect x="${x + 1.5}" y="${y + 3}" width="${size - 2}" height="${size - 2}" rx="${r}" fill="rgba(0,0,0,.45)"/>
      <rect x="${x}" y="${y}" width="${size - 2}" height="${size - 2}" rx="${r}" fill="url(#${u}Tile)"/>
      <rect x="${x + 2}" y="${y + 1.5}" width="${size - 6}" height="${size * 0.32}" rx="${r * 0.8}" fill="rgba(255,255,255,.07)"/>
      ${face}</g>`;
  }

  // ---------------------------------------------------------------- состояние руки

  private myIndex(): number | null {
    const s = this.s;
    if (!s) return null;
    const seat = this.viewerSeat();
    if (seat == null) return null;
    const i = s.seats.indexOf(seat);
    return i >= 0 && s.racks[i]?.length ? i : null;
  }

  private viewerSeat(): number | null {
    if (this.hidden) return null;
    if (this.actSeat != null) return this.actSeat;
    const mine = this.ctx.mySeats;
    if (this.ctx.demo) return this.s ? this.s.seats[this.s.cur] : null;
    return mine.length === 1 ? mine[0] : this.shownSeat;
  }

  /** Рука с учётом черновика: какие фишки ещё не на поле. */
  private rackNow(): { letter: string; idx: number }[] {
    const i = this.myIndex();
    if (i == null) return [];
    const rack = this.s!.racks[i].slice();
    if (this.take != null) {
      const t = this.s!.board[this.take]!;
      rack[rack.indexOf(t.ch)] = JOKER;
    }
    if (this.order.length !== rack.length) this.order = rack.map((_, k) => k);
    const used = new Set<number>();
    for (const p of this.draft) used.add((p as Place & { idx: number }).idx);
    return this.order.filter((k) => !used.has(k)).map((k) => ({ letter: rack[k], idx: k }));
  }

  private rackLetters(): string[] {
    const i = this.myIndex();
    return i == null ? [] : this.s!.racks[i];
  }

  private canAct() {
    return this.actSeat != null && !this.hidden && !!this.s && !this.s.over && !this.ctx.demo;
  }

  private verdict() {
    if (!this.draft.length) return null;
    return evaluate(this.s!, this.draft.map(({ cell, letter, as }) => ({ cell, letter, as })), this.rackLetters(), this.take ?? undefined);
  }

  // ---------------------------------------------------------------- отрисовка

  private render() {
    const s = this.s;
    if (!s) return;
    let t = '';
    const last = new Set(s.last?.cells ?? []);
    const draftAt = new Map(this.draft.map((p) => [p.cell, p]));
    for (let c = 0; c < N * N; c++) {
      const b = s.board[c];
      const x = this.cx(c) + 2;
      const y = this.cy(c) + 2;
      if (b && !(this.take === c)) {
        const cls = [last.has(c) ? 'last' : '', this.fresh.has(c) ? 'fresh' : '', b.joker && this.canAct() && s.cfg.swapJoker ? 'takeable' : ''].join(' ');
        t += `<g data-cell="${c}">${this.tileSvg(x, y, C - 2, b.ch, { joker: b.joker, as: b.ch, cls, value: valueOf(s.cfg, b.ch) })}</g>`;
      } else if (this.take === c && b) {
        t += `<g data-cell="${c}">${this.tileSvg(x, y, C - 2, b.ch, { cls: 'draft', value: valueOf(s.cfg, b.ch) })}</g>`;
      } else if (draftAt.has(c)) {
        const p = draftAt.get(c)!;
        t += `<g data-cell="${c}">${this.tileSvg(x, y, C - 2, p.letter, { joker: p.letter === JOKER, as: p.as, cls: 'draft' + (this.asking === c ? ' asking' : ''), value: valueOf(s.cfg, p.letter) })}</g>`;
      }
    }
    this.gTiles.innerHTML = t;
    this.renderRack();
    this.renderControls();
  }

  private renderRack() {
    const s = this.s!;
    const rack = this.rackNow();
    const n = rack.length;
    const x0 = W / 2 - (n * (T + 6)) / 2;
    let r = '';
    rack.forEach((t, k) => {
      const lifted = this.sel === t.idx || this.swapSel.has(t.idx);
      const cls = [this.sel === t.idx ? 'sel' : '', this.swapSel.has(t.idx) ? 'swap' : '', this.drag?.idx === t.idx && this.drag.moved ? 'ghost' : ''].join(' ');
      r += `<g data-rack="${t.idx}">${this.tileSvg(x0 + k * (T + 6), RY + (lifted ? -8 : 0), T, t.letter, { joker: t.letter === JOKER, cls, value: valueOf(s.cfg, t.letter) })}</g>`;
    });
    const i = this.myIndex();
    const who = this.viewerSeat();
    const info = `в мешке: ${s.bagCount}` + (i == null && who == null && !s.over ? '' : '');
    r += `<text class="er-bag" x="${M}" y="${H - 8}">${info}</text>`;
    if (s.over) r += `<text class="er-bag end" x="${W - M}" y="${H - 8}">партия окончена</text>`;
    this.gRack.innerHTML = r;
  }

  private renderControls() {
    const box = this.ctl.querySelector('.er-ctl') as HTMLElement;
    box.innerHTML = '';
    const s = this.s!;
    if (!this.canAct()) {
      this.say.innerHTML = s.last ? `<span>Последний ход: ${s.last.words.map((w) => `<b>${esc(w.toUpperCase())}</b>`).join(', ')} — ${s.last.points}</span>` : '';
      return;
    }
    if (this.swapMode) {
      this.say.innerHTML = `<span>Отметьте фишки, которые сдать в мешок.</span>`;
      const el = h(`<div class="er-ctl-in">
          <button class="btn primary er-doswap"${this.swapSel.size ? '' : ' disabled'}>Поменять ${this.swapSel.size || ''}</button>
          <button class="btn er-cancel">Отмена</button></div>`);
      (el.querySelector('.er-doswap') as HTMLButtonElement).onclick = () => {
        const rack = this.rackLetters();
        const letters = [...this.swapSel].map((k) => rack[k]);
        this.send({ type: 'swap', letters });
      };
      (el.querySelector('.er-cancel') as HTMLButtonElement).onclick = () => {
        this.swapMode = false;
        this.swapSel.clear();
        this.render();
      };
      box.appendChild(el);
      return;
    }
    const v = this.verdict();
    if (this.asking != null) this.say.innerHTML = '<span>Какую букву изображает звёздочка?</span>';
    else if (!v) this.say.innerHTML = '<span>Выберите фишку на руке и нажмите клетку (или перетащите).</span>';
    else if (v.ok) this.say.innerHTML = `<b class="ok">${v.score.words.map((w) => esc(w.word.toUpperCase())).join(', ')}</b> — ${v.score.points} ${plural(v.score.points, 'очко', 'очка', 'очков')}${v.score.bonus ? ' (все фишки!)' : ''}`;
    else this.say.innerHTML = `<span class="bad">${esc(v.why)}</span>`;
    const kb = this.asking != null
      ? `<div class="er-kb">${KEYS.map((row) => `<div>${[...row].map((k) => `<button class="er-key" data-k="${k}">${k.toUpperCase()}</button>`).join('')}</div>`).join('')}</div>`
      : '';
    const bagOk = s.bagCount >= tileSet(s.cfg).rack;
    const el = h(`<div class="er-ctl-in">${kb}
        <button class="btn primary er-go"${v?.ok ? '' : ' disabled'}>Ход!</button>
        <div class="er-row"><button class="btn er-back"${this.draft.length || this.take != null ? '' : ' disabled'}>Вернуть</button><button class="btn er-mix">Перемешать</button></div>
        <div class="er-row"><button class="btn er-swap"${bagOk ? '' : ' disabled title="В мешке мало фишек"'}>Поменять</button><button class="btn er-pass">Пропустить</button></div>
        <button class="btn er-resign">Сдаться</button>
      </div>`);
    el.querySelectorAll<HTMLButtonElement>('.er-key').forEach((b) => (b.onclick = () => this.setAs(b.dataset.k!)));
    (el.querySelector('.er-go') as HTMLButtonElement).onclick = () => this.submit();
    (el.querySelector('.er-back') as HTMLButtonElement).onclick = () => this.clearDraft();
    (el.querySelector('.er-mix') as HTMLButtonElement).onclick = () => {
      for (let k = this.order.length - 1; k > 0; k--) {
        const j = Math.floor(Math.random() * (k + 1));
        [this.order[k], this.order[j]] = [this.order[j], this.order[k]];
      }
      Sound.shuffle();
      this.render();
    };
    (el.querySelector('.er-swap') as HTMLButtonElement).onclick = () => {
      this.clearDraft();
      this.swapMode = true;
      this.render();
    };
    (el.querySelector('.er-pass') as HTMLButtonElement).onclick = () => this.send({ type: 'pass' });
    (el.querySelector('.er-resign') as HTMLButtonElement).onclick = () => {
      if (confirm('Сдаться?')) this.send({ type: 'resign' });
    };
    box.appendChild(el);
  }

  // ---------------------------------------------------------------- ввод

  private pt(e: { clientX: number; clientY: number }) {
    const p = this.svg.createSVGPoint();
    p.x = e.clientX;
    p.y = e.clientY;
    const m = this.svg.getScreenCTM();
    return m ? p.matrixTransform(m.inverse()) : { x: -1, y: -1 };
  }

  private cellAt(x: number, y: number): number | null {
    const f = Math.floor((x - M) / C);
    const r = Math.floor((y - M) / C);
    return f >= 0 && f < N && r >= 0 && r < N ? r * N + f : null;
  }

  private onDown = (e: PointerEvent) => {
    if (!this.canAct()) return;
    Sound.unlock();
    const g = (e.target as Element).closest('[data-rack],[data-cell]') as SVGGElement | null;
    const p = this.pt(e);
    if (g?.dataset.rack != null) {
      const idx = Number(g.dataset.rack);
      e.preventDefault();
      if (this.swapMode) {
        if (this.swapSel.has(idx)) this.swapSel.delete(idx);
        else this.swapSel.add(idx);
        this.render();
        return;
      }
      this.sel = this.sel === idx ? null : idx;
      this.drag = { idx, x: p.x, y: p.y, moved: false };
      this.render();
      return;
    }
    if (this.swapMode) return;
    const c = this.cellAt(p.x, p.y);
    if (c == null) return;
    const s = this.s!;
    const d = this.draft.findIndex((x) => x.cell === c);
    if (d >= 0) {
      // вернуть фишку на руку
      this.draft.splice(d, 1);
      if (this.asking === c) this.asking = null;
      Sound.ui();
      this.render();
      return;
    }
    if (this.take === c) {
      this.take = null;
      this.draft = this.draft.filter((x) => x.letter !== JOKER || this.rackLetters().includes(JOKER));
      this.render();
      return;
    }
    const b = s.board[c];
    if (b?.joker && s.cfg.swapJoker && this.take == null && this.rackLetters().includes(b.ch)) {
      this.take = c;
      this.order = [];
      Sound.place();
      this.render();
      return;
    }
    if (!b && this.sel != null) this.placeAt(c, this.sel);
  };

  private onMove = (e: PointerEvent) => {
    if (!this.drag) return;
    const p = this.pt(e);
    if (!this.drag.moved && Math.hypot(p.x - this.drag.x, p.y - this.drag.y) < 6) return;
    this.drag.moved = true;
    const rack = this.rackLetters();
    const letter = this.take != null && this.drag.idx === rack.indexOf(this.s!.board[this.take]!.ch) ? JOKER : rack[this.drag.idx];
    this.gDrag.innerHTML = this.tileSvg(p.x - T / 2, p.y - T / 2, T, letter, { joker: letter === JOKER, cls: 'dragging', value: valueOf(this.s!.cfg, letter) });
    this.renderRack();
  };

  private onUp = (e: PointerEvent) => {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    this.gDrag.innerHTML = '';
    if (!d.moved) {
      this.renderRack();
      return;
    }
    const p = this.pt(e);
    const c = this.cellAt(p.x, p.y);
    if (c != null && !this.s!.board[c] && !this.draft.some((x) => x.cell === c)) this.placeAt(c, d.idx);
    else this.render();
  };

  private placeAt(c: number, idx: number) {
    const rack = this.rackNow();
    const t = rack.find((x) => x.idx === idx);
    if (!t) return;
    this.draft.push({ cell: c, letter: t.letter, idx } as Place & { idx: number });
    this.sel = null;
    if (t.letter === JOKER) this.asking = c;
    Sound.place();
    this.render();
  }

  private setAs(k: string) {
    const p = this.draft.find((x) => x.cell === this.asking);
    if (p) p.as = k;
    this.asking = null;
    this.render();
  }

  private onKey = (e: KeyboardEvent) => {
    if (!this.canAct() || e.ctrlKey || e.metaKey || e.altKey) return;
    if ((e.target as HTMLElement)?.closest?.('input, textarea')) return;
    const k = e.key.toLowerCase().replace('ё', 'е');
    if (this.asking != null && k.length === 1 && ALPHABET.includes(k)) {
      this.setAs(k);
      e.preventDefault();
    } else if (e.key === 'Enter') {
      this.submit();
      e.preventDefault();
    } else if (e.key === 'Escape') this.clearDraft();
  };

  private clearDraft() {
    this.draft = [];
    this.take = null;
    this.sel = null;
    this.asking = null;
    this.order = [];
    this.render();
  }

  private submit() {
    const v = this.verdict();
    if (!v?.ok || this.asking != null) return;
    this.send({ type: 'play', tiles: this.draft.map(({ cell, letter, as }) => (letter === JOKER ? { cell, letter, as } : { cell, letter })), ...(this.take != null ? { take: this.take } : {}) });
  }

  private send(a: Action) {
    const seat = this.actSeat;
    if (seat == null) return;
    this.actSeat = null;
    this.draft = [];
    this.take = null;
    this.sel = null;
    this.asking = null;
    this.swapMode = false;
    this.swapSel.clear();
    this.ctx.act(seat, a);
  }

  // ---------------------------------------------------------------- GameView

  setView(v: View) {
    const set = this.s?.cfg.set;
    this.s = v;
    if (set !== v.cfg.set) this.drawBoard();
    this.order = [];
    this.render();
  }

  async play(events: Event[], v: View) {
    const speed = this.ctx.speed();
    for (const ev of events) {
      if (ev.type !== 'play' || !this.s) continue;
      const s: View = { ...this.s, board: this.s.board.slice(), last: null };
      if (ev.take != null) s.board[ev.take] = { ch: s.board[ev.take]!.ch };
      this.s = s;
      this.fresh.clear();
      for (const p of ev.tiles) {
        s.board[p.cell] = p.letter === JOKER ? { ch: p.as!, joker: true } : { ch: p.letter };
        this.fresh.add(p.cell);
        this.render();
        Sound.place();
        await sleep(160 / speed);
      }
      await sleep(400 / speed);
      this.fresh.clear();
    }
    this.s = v;
    this.order = [];
    this.render();
  }

  setTurn(toAct: number[], interactive: number[]) {
    const seat = interactive.find((x) => toAct.includes(x)) ?? null;
    if (seat !== this.actSeat) {
      this.draft = [];
      this.take = null;
      this.sel = null;
      this.asking = null;
      this.swapMode = false;
      this.swapSel.clear();
      this.order = [];
    }
    this.actSeat = seat;
    // хот-сит: несколько людей за одним экраном — шторка, чтобы не подсмотрели чужие фишки
    const many = this.ctx.mySeats.length > 1 && !this.ctx.demo;
    if (many && seat != null && seat !== this.shownSeat) {
      this.hidden = true;
      this.cover.hidden = false;
      (this.cover.querySelector('.er-cover-t') as HTMLElement).innerHTML = `Ход: ${this.ctx.name(seat)}. Остальные — отвернитесь.`;
    } else if (seat == null && many) {
      this.shownSeat = null;
    }
    if (seat != null && !this.hidden) Sound.turn();
    this.render();
  }

  status(s: View, toAct: number[], interactive: number[]) {
    if (s.over) return 'Партия окончена';
    const who = toAct[0];
    return interactive.includes(who) ? `Ваш ход: ${this.ctx.name(who)}` : `Думает ${this.ctx.name(who)}…`;
  }

  playerStats(s: View, seat: number) {
    const i = s.seats.indexOf(seat);
    return i >= 0 ? `<span title="Очки и фишки на руке">очков: ${s.scores[i]}, фишек: ${s.counts[i]}</span>` : '';
  }
}

export function createView(): GameView<View, Event> {
  return new EruditView();
}
