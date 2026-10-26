/* Окей и руммикуб — отрисовка (SVG): зелёное сукно, своя деревянная подставка внизу, соперники по сторонам (рубашками),
 * у каждого справа — его сброс (верхняя фишка). Посередине — колода и индикатор (окей) или стол с комбинациями (руммикуб).
 * Фишки — кость с цветными номерами, ложный окей / джокер — со смайликом. Сортировка подставки — по цвету, по номеру
 * или по комбинациям. Ход окея: взять (колода или сброс соседа слева), выбрать фишку — «Сбросить» или «Сбросить и выйти».
 * Руммикуб: выбрать фишки — «Выложить» (стол перестроится сам), нечего — «Взять фишку». */
import { Sound } from '../../core/audio';
import { esc, h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { arrange, arrange101, canFinish, faceOf, leftOf, OPEN, OPEN101, rulesOf, showTile, type Action, type Event, type View } from './engine';
import { groupValue, orderGroup, partition, sameTile, type Tile } from './tiles';
import { bestCover } from './ai';
import { SEATS, TILE_COLORS, tn } from './def';
import './okey.css';

const TW = 46;
const TH = 64;

function tileSvg(t: Tile | null, x: number, y: number, opts: { sel?: boolean; can?: boolean; wild?: boolean; small?: boolean; key?: string } = {}): string {
  const s = opts.small ? 0.72 : 1;
  const w = TW * s;
  const hh = TH * s;
  const data = opts.key ? ` data-tile="${opts.key}"` : '';
  if (!t) return `<g transform="translate(${x} ${y})"><rect x="${-w / 2}" y="${-hh / 2}" width="${w}" height="${hh}" rx="${5 * s}" class="ok-back"/></g>`;
  const col = t.n === 0 ? '#c8281e' : TILE_COLORS[t.c];
  const face = t.n === 0 ? `<text y="${6 * s}" class="ok-smile" style="font-size:${26 * s}px">☺</text>` : `<text y="${8 * s}" class="ok-num" style="fill:${col};font-size:${24 * s}px">${t.n}</text><circle cy="${20 * s}" r="${3 * s}" fill="${col}"/>`;
  return `<g class="ok-tile${opts.sel ? ' sel' : ''}${opts.can ? ' can' : ''}${opts.wild ? ' wild' : ''}" transform="translate(${x} ${y - (opts.sel ? 14 : 0)})"${data}><rect x="${-w / 2}" y="${-hh / 2}" width="${w}" height="${hh}" rx="${5 * s}" class="ok-face"/>${face}</g>`;
}

const keyOf = (t: Tile) => `${t.c}.${t.n}.${t.k}`;

class OkeyView implements GameView<View, Event> {
  private ctx!: ViewCtx;
  private svg!: SVGSVGElement;
  private banner!: HTMLElement;
  private btns!: HTMLElement;
  private info!: HTMLElement;
  private v: View | null = null;
  private viewer = 0;
  private act: number | null = null;
  private sel: Tile[] = [];
  private sort: 'color' | 'num' | 'groups' = 'groups';

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    this.viewer = ctx.mySeats[0] ?? 0;
    const wrap = h('<div class="ok-wrap"><svg class="ok-svg" viewBox="0 0 1000 720"></svg><div class="cs-banner" hidden></div></div>');
    root.appendChild(wrap);
    this.svg = wrap.querySelector('svg') as SVGSVGElement;
    this.banner = wrap.querySelector('.cs-banner') as HTMLElement;
    this.info = h('<div class="ok-info"></div>');
    ctx.controls.appendChild(this.info);
    this.btns = h('<div class="ok-btns"></div>');
    if (!ctx.demo) ctx.controls.appendChild(this.btns);
    this.svg.addEventListener('click', (e) => this.onClick(e));
  }

  private others(v: View) {
    const i0 = Math.max(0, v.seats.indexOf(this.viewer));
    return v.seats.map((_, k) => v.seats[(i0 + k) % v.seats.length]).slice(1);
  }

  /** Места соперников: справа, сверху, слева (по ходу — против часовой). */
  private spot(v: View, seat: number): { x: number; y: number; dx: number; dy: number } {
    const list = this.others(v);
    const k = list.indexOf(seat);
    const n = list.length;
    const pos = n === 1 ? ['top'] : n === 2 ? ['right', 'left'] : ['right', 'top', 'left'];
    const p = pos[k];
    if (p === 'right') return { x: 930, y: 300, dx: 0, dy: 1 };
    if (p === 'left') return { x: 70, y: 300, dx: 0, dy: 1 };
    return { x: 500, y: 60, dx: 1, dy: 0 };
  }

  private sorted(v: View, rack: Tile[]): Tile[] {
    const face = faceOf(v);
    if (this.sort === 'color') return rack.slice().sort((a, b) => face(a).c - face(b).c || face(a).n - face(b).n);
    if (this.sort === 'num') return rack.slice().sort((a, b) => face(a).n - face(b).n || face(a).c - face(b).c);
    // по комбинациям: что складывается — подряд, остальное — по цвету
    const best = bestCover(rack, face, v.cfg.mode !== 'rummikub');
    const used = new Set(best.flat());
    const rest = rack.filter((t) => !used.has(t)).sort((a, b) => face(a).c - face(b).c || face(a).n - face(b).n);
    return [...best.flatMap((g) => orderGroup(g, face, rulesOf(v.cfg))), ...rest];
  }

  private draw() {
    const v = this.v;
    if (!v) return;
    const face = faceOf(v);
    let o = `<rect x="10" y="10" width="980" height="700" rx="26" class="ok-felt"/>`;
    // соперники
    for (const seat of this.others(v)) {
      const p = this.spot(v, seat);
      const n = v.counts[seat];
      for (let k = 0; k < n; k++) {
        const off = (k - (n - 1) / 2) * 20;
        o += tileSvg(null, p.x + p.dx * off, p.y + p.dy * off, { small: true });
      }
      const lx = p.dy ? (p.x < 500 ? p.x - 22 : p.x + 22) : p.x;
      const anchor = p.dy ? (p.x < 500 ? 'start' : 'end') : 'middle';
      o += `<text x="${lx}" y="${p.dy ? p.y - 200 : p.y + 58}" class="ok-name" style="fill:${SEATS[seat].color};text-anchor:${anchor}">${esc(this.plain(seat))} · ${v.score[seat]}${v.turn === seat ? ' ◀' : ''}</text>`;
    }
    // сбросы: у каждого — справа от него (у меня — справа от подставки)
    for (const seat of v.seats) {
      const d = v.discards[seat];
      if (!d?.length) continue;
      const top = d[d.length - 1];
      const me = seat === this.viewer;
      const p = this.spot(v, seat);
      const at = me ? { x: 905, y: 560 } : p.dy ? { x: p.x + (p.x > 500 ? -80 : 80), y: p.y + 150 } : { x: p.x + 230, y: p.y + 30 };
      const left = this.act != null && v.phase === 'draw' && seat === leftOf(v.seats, this.act);
      o += tileSvg(top, at.x, at.y, { can: left, wild: face(top).wild, key: left ? 'left' : undefined });
      if (d.length > 1) o += `<text x="${at.x}" y="${at.y + 48}" class="ok-small">${d.length}</text>`;
    }
    // центр
    if (v.cfg.mode !== 'rummikub') {
      // в «Окее 101» колода и индикатор — ниже, над подставкой: середина — под стол
      const [sx, sy] = v.cfg.mode === 'o101' ? [170, 440] : [430, 300];
      const canStock = this.act != null && v.phase === 'draw';
      o += `<g${canStock ? ' data-tile="stock" class="ok-stockg can"' : ' class="ok-stockg"'}>${tileSvg(null, sx, sy)}${tileSvg(null, sx + 2, sy - 4)}${tileSvg(null, sx + 4, sy - 8)}</g>`;
      o += `<text x="${sx + 2}" y="${sy + 50}" class="ok-small">${v.stockLeft}</text>`;
      if (v.indicator) {
        o += tileSvg(v.indicator, sx + 110, sy - 4);
        o += `<text x="${sx + 110}" y="${sy + 50}" class="ok-small">индикатор</text>`;
        o += `<text x="${sx + 180}" y="${sy}" class="ok-small" style="text-anchor:start">окей: ${v.okey!.n}</text>`;
        o += `<circle cx="${sx + 230}" cy="${sy - 6}" r="9" fill="${TILE_COLORS[v.okey!.c]}"/>`;
      }
    }
    if (v.cfg.mode !== 'okey') {
      // стол руммикуба: группы рядами
      let x = 150;
      let y = v.cfg.mode === 'o101' ? 130 : 160;
      for (const g of v.table) {
        const w = g.length * 34 + 16;
        if (x + w > 860) (x = 150), (y += 62);
        g.forEach((t, i) => (o += tileSvg(t, x + i * 34 + 17, y, { small: true, wild: face(t).wild })));
        x += w;
      }
      if (v.cfg.mode === 'rummikub') o += `<text x="90" y="400" class="ok-small">колода ${v.stockLeft}</text>`;
    }
    // своя подставка
    o += `<rect x="70" y="520" width="800" height="150" rx="14" class="ok-rack"/><rect x="80" y="600" width="780" height="10" rx="4" class="ok-rack-lip"/>`;
    const rack = this.sorted(v, v.racks[this.viewer] ?? []);
    const perRow = Math.min(15, Math.max(8, Math.ceil(rack.length / 1)));
    const step = Math.min(50, 760 / perRow);
    rack.forEach((t, i) => {
      const row = i >= 15 ? 1 : 0;
      const j = row ? i - 15 : i;
      const n = row ? rack.length - 15 : Math.min(15, rack.length);
      const x = 470 + (j - (n - 1) / 2) * step;
      const y = 560 + row * 70;
      const sel = this.sel.some((s) => sameTile(s, t));
      const can = this.act != null && (v.cfg.mode === 'rummikub' || v.phase === 'discard');
      o += tileSvg(t, x, y, { sel, wild: face(t).wild, key: can ? keyOf(t) : undefined });
    });
    o += `<text x="470" y="700" class="ok-name" style="fill:${SEATS[this.viewer]?.color ?? '#fff'}">${esc(this.plain(this.viewer))} · ${v.score[this.viewer]}${v.turn === this.viewer ? ' ◀' : ''}</text>`;
    this.svg.innerHTML = o;
    this.info.innerHTML = v.cfg.mode === 'okey' ? `Сдача ${v.round}. Окей — ${tn({ c: v.okey!.c, n: v.okey!.n, k: 0 })}<small>у всех по ${v.cfg.start} на старте; ${v.seats.map((x) => `${this.plain(x)} ${v.score[x]}`).join(', ')}</small>` : `Сдача ${v.round} из ${v.cfg.rounds}<small>${v.seats.map((x) => `${this.plain(x)} ${v.score[x]}${v.opened[x] ? '' : ' (не выложился)'}`).join(', ')}</small>`;
  }

  private plain(seat: number) {
    return this.ctx.name(seat).replace(/<[^>]+>/g, '');
  }

  // ---------------------------------------------------------------- ход

  private onClick(e: MouseEvent) {
    const v = this.v;
    if (!v || this.act == null) return;
    const el = (e.target as Element).closest('[data-tile]') as SVGGElement | null;
    if (!el) return;
    const k = el.getAttribute('data-tile')!;
    if (k === 'stock') return this.send({ type: 'draw', from: 'stock' });
    if (k === 'left') return this.send({ type: 'draw', from: 'left' });
    const t = v.racks[this.act].find((x) => keyOf(x) === k);
    if (!t) return;
    if (v.cfg.mode === 'okey') this.sel = this.sel.some((s) => sameTile(s, t)) ? [] : [t];
    else if (v.cfg.mode === 'o101' && v.phase !== 'discard') return;
    else {
      const i = this.sel.findIndex((s) => sameTile(s, t));
      if (i >= 0) this.sel.splice(i, 1);
      else this.sel.push(t);
    }
    Sound.ui();
    this.draw();
    this.renderButtons();
  }

  private send(a: Action) {
    const seat = this.act;
    if (seat == null) return;
    Sound.unlock();
    this.act = null;
    this.sel = [];
    this.btns.innerHTML = '';
    this.ctx.act(seat, a);
  }

  private button(text: string, cls: string, on: () => void, ok = true) {
    const b = h<HTMLButtonElement>(`<button class="btn ${cls}"${ok ? '' : ' disabled'}>${text}</button>`);
    b.onclick = () => {
      Sound.unlock();
      on();
    };
    this.btns.appendChild(b);
  }

  private renderButtons() {
    this.btns.innerHTML = '';
    const v = this.v;
    const seat = this.act;
    if (!v || seat == null) return;
    if (v.cfg.mode === 'okey' && showTile(v, seat)) this.button('Показать индикатор', 'primary', () => this.send({ type: 'show' }));
    if (v.cfg.mode === 'o101') {
      if (v.phase === 'draw') {
        this.btns.appendChild(h('<div class="ok-ask">Возьмите фишку: из колоды или сброс соседа слева.</div>'));
        this.button('Из колоды', 'primary', () => this.send({ type: 'draw', from: 'stock' }));
        this.button('Сброс соседа', '', () => this.send({ type: 'draw', from: 'left' }), !!v.discards[leftOf(v.seats, seat)]?.length);
      } else {
        const lay = this.sel.length && this.sel.length < v.racks[seat].length ? arrange101(v, seat, this.sel) : null;
        if (this.sel.length) this.button(lay ? 'Выложить' : v.opened[seat] ? 'Не ложится' : `Нужно ${OPEN101} или пять пар`, 'primary', () => this.send({ type: 'play', tiles: this.sel.slice() }), !!lay);
        if (this.sel.length === 1) {
          const t = this.sel[0];
          const last = v.racks[seat].length === 1;
          this.button(last ? 'Сбросить и выйти!' : `Сбросить ${t.n === 0 ? '☺' : t.n}`, last ? 'primary' : '', () => this.send({ type: 'discard', tile: t }), !last || v.opened[seat]);
        }
        this.btns.appendChild(h(`<div class="ok-ask">${v.opened[seat] ? (v.pairs?.[seat] ? 'Вы открылись парами — докладывайте пары.' : 'Выкладывайте и докладывайте к комбинациям на столе.') : `Первая выкладка — от ${OPEN101} очков или пятью парами.`} Потом выберите одну фишку и сбросьте.</div>`));
      }
      for (const [k, label] of [
        ['groups', 'По комбинациям'],
        ['color', 'По цвету'],
        ['num', 'По номеру'],
      ] as const)
        this.button(label, `ok-sort${this.sort === k ? ' on' : ''}`, () => {
          this.sort = k;
          this.draw();
          this.renderButtons();
        });
      return;
    }
    if (v.cfg.mode === 'okey') {
      if (v.phase === 'draw') {
        this.btns.appendChild(h('<div class="ok-ask">Возьмите фишку: из колоды или сброс соседа слева.</div>'));
        this.button('Из колоды', 'primary', () => this.send({ type: 'draw', from: 'stock' }));
        this.button('Сброс соседа', '', () => this.send({ type: 'draw', from: 'left' }), !!v.discards[leftOf(v.seats, seat)]?.length);
      } else {
        const t = this.sel[0];
        if (t) {
          this.button(`Сбросить ${t.n === 0 ? "☺" : t.n}`, '', () => this.send({ type: 'discard', tile: t }));
          const fin = canFinish(v, seat, t);
          if (fin) this.button(fin === 'pairs' ? 'Сбросить и выйти — семь пар!' : 'Сбросить и выйти!', 'primary', () => this.send({ type: 'discard', tile: t, finish: true }));
        }
        const any = v.racks[seat].find((x) => canFinish(v, seat, x));
        this.btns.appendChild(h(`<div class="ok-ask">${any ? 'Можно выйти! Выберите фишку для сброса.' : 'Выберите фишку для сброса.'}</div>`));
      }
    } else {
      const lay = this.sel.length ? arrange(v, seat, this.sel) : null;
      const face = faceOf(v);
      const own = this.sel.length ? partition(this.sel, face, rulesOf(v.cfg)) : null;
      const sum = own ? own.reduce((x, g) => x + groupValue(g, face, rulesOf(v.cfg)), 0) : 0;
      if (this.sel.length) this.button(lay ? 'Выложить' : v.opened[seat] ? 'Не ложится' : `Нужно ${OPEN} (сейчас ${sum})`, 'primary', () => this.send({ type: 'play', tiles: this.sel.slice() }), !!lay);
      this.button(v.stockLeft ? 'Взять фишку' : 'Пас', '', () => this.send({ type: 'draw', from: 'stock' }));
      this.btns.appendChild(h(`<div class="ok-ask">${v.opened[seat] ? 'Выберите фишки — стол перестроится сам, если их можно уложить.' : `Первая выкладка — от ${OPEN} очков и только своими фишками.`}</div>`));
    }
    for (const [k, label] of [
      ['groups', 'По комбинациям'],
      ['color', 'По цвету'],
      ['num', 'По номеру'],
    ] as const)
      this.button(label, `ok-sort${this.sort === k ? ' on' : ''}`, () => {
        this.sort = k;
        this.draw();
        this.renderButtons();
      });
  }

  // ---------------------------------------------------------------- события

  async play(events: Event[], v: View) {
    this.act = null;
    this.sel = [];
    this.btns.innerHTML = '';
    const sp = this.ctx.speed();
    for (const ev of events) {
      if (ev.type === 'draw' || ev.type === 'discard' || ev.type === 'play') {
        Sound.place();
        await sleep(260 / sp);
      } else if (ev.type === 'hand') {
        Sound.win();
        await this.say(ev.winner == null ? `Сдача без победителя: ${ev.text}` : `${this.plain(ev.winner)}: ${ev.text}`, 1800);
      } else if (ev.type === 'end') {
        await this.say(`Партия — ${this.plain(ev.winner)}`, 0);
      }
    }
    this.v = v;
    this.draw();
  }

  private async say(text: string, ms: number) {
    this.banner.textContent = text;
    this.banner.hidden = false;
    if (!ms) return;
    await sleep(ms / this.ctx.speed());
    this.banner.hidden = true;
  }

  setView(v: View) {
    this.v = v;
    this.banner.hidden = true;
    this.draw();
  }

  setTurn(toAct: number[], interactive: number[]) {
    const v = this.v;
    this.sel = [];
    if (!v) return;
    const mine = this.ctx.mySeats.filter((x) => v.seats.includes(x));
    const next = toAct.find((x) => mine.includes(x));
    if (next != null && mine.length > 1) this.viewer = next;
    this.act = interactive.includes(this.viewer) && toAct.includes(this.viewer) ? this.viewer : null;
    this.draw();
    this.renderButtons();
  }

  status(v: View, toAct: number[], interactive: number[]) {
    if (v.over) return 'Партия окончена';
    const who = toAct[0];
    if (!interactive.includes(who)) return `Ходит ${this.ctx.name(who)}…`;
    if (v.cfg.mode === 'rummikub') return 'Выкладывайте или берите фишку';
    if (v.cfg.mode === 'o101') return v.phase === 'draw' ? 'Возьмите фишку' : 'Выкладывайте и сбросьте фишку';
    return v.phase === 'draw' ? 'Возьмите фишку' : 'Сбросьте фишку';
  }

  playerStats(v: View, seat: number) {
    return `очки: ${v.score[seat]}`;
  }
}

export function createView(): GameView<View, Event> {
  return new OkeyView();
}
