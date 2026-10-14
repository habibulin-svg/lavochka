/* Верю — не верю — отрисовка: стопка рубашками посередине с заявкой («семь дам»), рука веером внизу, соперники — рубашками сверху.
 * Выберите 1–4 карты; на заходе — нажмите ранг, который называете; на ответ — «Верю, докладываю» или «Не верю!».
 * При проверке открытые карты лежат на виду, потом стопка улетает к тому, кто её забрал. */
import { Sound } from '../../core/audio';
import { esc, h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { preloadDeck } from '../../cards/render';
import { settings } from '../../core/settings';
import { rankLabel, sameCard, sortHand, type Card } from '../../cards/deck';
import { CardStage, cardKey, fan, type Point, type StageItem } from '../../cards/stage';
import { claimed, countOf, pileOf, ranksOf, type Event, type View } from './engine';
import { claimText, SEATS } from './def';
import './bluff.css';

const LAND = { port: false, W: 1000, hand: { x: 500, y: 600 }, hs: 1.05, pile: { x: 470, y: 320 }, show: { x: 650, y: 320 }, bin: { x: 110, y: 330 }, os: 0.5 };
const PORT = { port: true, W: 540, hand: { x: 270, y: 780 }, hs: 1.0, pile: { x: 200, y: 450 }, show: { x: 380, y: 450 }, bin: { x: 70, y: 300 }, os: 0.45 };
type Geo = typeof LAND;

class BluffView implements GameView<View, Event> {
  private ctx!: ViewCtx;
  private cs!: CardStage;
  private plates!: HTMLElement;
  private banner!: HTMLElement;
  private cover!: HTMLElement;
  private btns!: HTMLElement;
  private v: View | null = null;
  private viewer = 0;
  private hidden = false;
  private actSeat: number | null = null;
  private selected: Card[] = [];
  /** Ключи карт стопки (свои — по карте, чтобы летели из руки). */
  private pileKeys: string[] = [];
  private seq = 0;
  /** Открытые при проверке карты. */
  private shown: Card[] = [];

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    preloadDeck(settings.deck);
    this.cs = new CardStage(root, 1000, 720, 'bl-wrap', '<div class="bl-cloth"></div>', { portrait: { W: 540, H: 900 } });
    this.cs.onMode = () => this.draw();
    this.cs.over.innerHTML = '<div class="bl-plates"></div><div class="cs-banner" hidden></div>';
    this.plates = this.cs.over.querySelector('.bl-plates') as HTMLElement;
    this.banner = this.cs.over.querySelector('.cs-banner') as HTMLElement;
    this.cover = h('<div class="cs-cover" hidden><div class="cs-cover-box"><div class="bl-cover-t"></div><button class="btn primary">Показать карты</button></div></div>');
    this.cs.stage.appendChild(this.cover);
    (this.cover.querySelector('button') as HTMLButtonElement).onclick = () => {
      Sound.unlock();
      this.hidden = false;
      this.cover.hidden = true;
      this.draw();
      this.renderButtons();
    };
    const ctl = h(`<div class="bl-controls"><div class="bl-btns"></div>${ctx.demo ? '' : '<div class="hint small-hint">Выберите от 1 до 4 карт, потом назовите ранг или ответьте.</div>'}</div>`);
    ctx.controls.appendChild(ctl);
    this.btns = ctl.querySelector('.bl-btns') as HTMLElement;
    this.cs.stage.addEventListener('click', (e) => this.onClick(e));
  }

  // ---------------------------------------------------------------- места

  private get g(): Geo {
    return this.cs.portrait ? PORT : LAND;
  }

  private order(v: View): number[] {
    const i0 = Math.max(0, v.seats.indexOf(this.viewer));
    return v.seats.map((_, k) => v.seats[(i0 + k) % v.seats.length]);
  }

  private anchor(v: View, seat: number): Point {
    const k = this.order(v).indexOf(seat);
    const n = v.seats.length;
    if (k === 0) return this.g.hand;
    // соперники — дугой по верху
    const W = this.g.W;
    const t = n === 2 ? 0.5 : (k - 1) / (n - 2);
    const x = W * 0.12 + t * W * 0.76;
    const y = (this.g.port ? 120 : 110) - Math.sin(t * Math.PI) * 30;
    return { x, y };
  }

  private chooseViewer(v: View, toAct: number[]) {
    const mine = this.ctx.mySeats.filter((x) => v.seats.includes(x));
    if (!mine.length) return;
    if (mine.length === 1) {
      this.viewer = mine[0];
      return;
    }
    const next = toAct.find((x) => mine.includes(x));
    if (next != null && next !== this.viewer) {
      this.viewer = next;
      this.hidden = true;
      this.cs.clear();
    }
  }

  private faceUp(v: View, seat: number) {
    if (this.ctx.demo) return v.hands[seat].length > 0 || countOf(v, seat) === 0;
    return seat === this.viewer && !this.hidden && this.ctx.mySeats.includes(seat);
  }

  // ---------------------------------------------------------------- раскладка

  private syncPile(v: View) {
    const n = pileOf(v);
    while (this.pileKeys.length < n) this.pileKeys.push(`p:${this.seq++}`);
    if (this.pileKeys.length > n) this.pileKeys = this.pileKeys.slice(0, n);
  }

  private layout(v: View): StageItem[] {
    const g = this.g;
    const items: StageItem[] = [];
    this.syncPile(v);
    const lastN = v.plays.length ? v.plays[v.plays.length - 1].n : 0;
    const n = this.pileKeys.length;
    this.pileKeys.forEach((key, i) => {
      const top = i >= n - lastN;
      const j = top ? i - (n - lastN) : i;
      const jx = top ? 70 + j * 22 : ((i * 37) % 23) - 11;
      const jy = top ? 10 : ((i * 53) % 19) - 9 - Math.min(i, 30) * 0.8;
      items.push({ key, card: null, x: g.pile.x + jx, y: g.pile.y + jy, r: top ? 6 + j * 4 : ((i * 29) % 30) - 15, s: 0.8, z: 10 + i, from: top && v.last ? `b:${v.last.seat}:` : undefined });
    });
    // открытые при проверке
    this.shown.forEach((c, i) => items.push({ key: `sh:${cardKey(c)}`, card: c, x: g.show.x + (i - (this.shown.length - 1) / 2) * 60, y: g.show.y, r: (i - 1) * 4, s: 0.9, z: 200 + i }));
    if (v.discard) items.push({ key: 'bin', card: null, x: g.bin.x, y: g.bin.y, r: -8, s: 0.6, z: 1, cls: 'bl-bin' });
    for (const seat of v.seats) {
      const cnt = countOf(v, seat);
      const a = this.anchor(v, seat);
      const me = seat === this.viewer;
      const up = this.faceUp(v, seat);
      const list = up ? sortHand(v.hands[seat]) : [];
      for (let k = 0; k < cnt; k++) {
        if (me) {
          const p = fan(cnt, k, a.x, a.y, g.port ? 480 : 760, g.port ? 60 : 78, 16, 10);
          if (!up) {
            items.push({ key: `b:${seat}:${k}`, card: null, ...p, s: g.hs, z: 100 + k });
            continue;
          }
          const c = list[k];
          const sel = this.selected.some((x) => sameCard(x, c));
          const cls = this.actSeat != null ? (sel ? 'cs-sel' : 'cs-can') : '';
          items.push({ key: cardKey(c), card: c, x: p.x, y: p.y - (sel ? 28 : 0), r: p.r, s: g.hs, z: 100 + k, cls, data: { hand: c.s + c.r } });
        } else {
          const p = fan(cnt, k, a.x, a.y, g.port ? 90 : 130, 12, 6, 14);
          items.push({ key: `b:${seat}:${k}`, card: null, ...p, s: g.os, z: 50 + k });
        }
      }
    }
    return items;
  }

  private draw(exit: Point | null = null) {
    const v = this.v;
    if (!v) return;
    this.cs.render(this.layout(v), this.ctx.speed(), null, exit);
    const g = this.g;
    let s = '';
    for (const seat of v.seats) {
      const a = this.anchor(v, seat);
      const me = seat === this.viewer;
      const y = me ? a.y - 78 * g.hs - 40 : a.y + (g.port ? 40 : 44);
      const done = v.done.indexOf(seat);
      const on = v.turn === seat && v.loser == null;
      const tail = done >= 0 ? `<em>${done + 1}-е место</em>` : v.loser === seat ? '<em>брехун</em>' : `<b>${countOf(v, seat)}</b>`;
      const x = Math.max(g.port ? 84 : 90, Math.min(g.W - (g.port ? 84 : 90), a.x));
      s += `<div class="cs-plate${on ? ' on' : ''}" style="--c:${SEATS[seat].color};left:${x}px;top:${y}px">${esc(this.plain(seat))} ${tail}</div>`;
    }
    if (v.rank != null) {
      const who = v.last ? this.plain(v.last.seat) : '';
      s += `<div class="bl-claim" style="left:${g.pile.x}px;top:${g.pile.y - (g.port ? 120 : 112)}px"><small>в стопке заявлено</small>${esc(claimText(claimed(v), v.rank))}<small>последним клал ${esc(who)}</small></div>`;
    }
    if (v.discard) s += `<div class="bl-bin-t" style="left:${g.bin.x}px;top:${g.bin.y + 62}px">отбой ${v.discard}${v.quads.length ? `<br>четвёрки: ${v.quads.map(rankLabel).join(' ')}` : ''}</div>`;
    this.plates.innerHTML = s;
  }

  private plain(seat: number) {
    return this.ctx.name(seat).replace(/<[^>]+>/g, '');
  }

  // ---------------------------------------------------------------- ход

  private onClick(e: MouseEvent) {
    const v = this.v;
    if (!v || this.actSeat == null || this.hidden) return;
    const el = (e.target as Element).closest('[data-hand]') as HTMLElement | null;
    if (!el) return;
    const card = v.hands[this.actSeat].find((c) => c.s + c.r === el.dataset.hand);
    if (!card) return;
    const i = this.selected.findIndex((x) => sameCard(x, card));
    if (i >= 0) this.selected.splice(i, 1);
    else {
      if (this.selected.length >= 4) this.selected.shift();
      this.selected.push(card);
    }
    Sound.ui();
    this.draw();
    this.renderButtons();
  }

  private send(a: Parameters<ViewCtx['act']>[1]) {
    const seat = this.actSeat;
    if (seat == null) return;
    Sound.unlock();
    this.clearTurn();
    this.ctx.act(seat, a);
  }

  private clearTurn() {
    this.actSeat = null;
    this.selected = [];
    this.btns.innerHTML = '';
  }

  private button(text: string, cls: string, on: () => void, disabled = false) {
    const b = h<HTMLButtonElement>(`<button class="btn ${cls}"${disabled ? ' disabled' : ''}>${text}</button>`);
    b.onclick = () => {
      Sound.unlock();
      on();
    };
    this.btns.appendChild(b);
    return b;
  }

  private renderButtons() {
    this.btns.innerHTML = '';
    const v = this.v;
    const seat = this.actSeat;
    if (!v || seat == null || this.ctx.demo || this.hidden) return;
    const k = this.selected.length;
    if (v.rank == null) {
      this.btns.appendChild(h(`<div class="bl-ask">${k ? `Выбрано ${k}. Какой ранг называете?` : 'Выберите карты для захода (1–4)'}</div>`));
      const grid = h('<div class="bl-ranks"></div>');
      for (const r of ranksOf(v.cfg)) {
        const b = h<HTMLButtonElement>(`<button class="btn"${k ? '' : ' disabled'}>${rankLabel(r)}</button>`);
        b.title = k ? claimText(k, r) : '';
        b.onclick = () => this.send({ type: 'lead', cards: this.selected, rank: r });
        grid.appendChild(b);
      }
      this.btns.appendChild(grid);
      return;
    }
    const lastN = v.plays[v.plays.length - 1]?.n ?? 0;
    this.btns.appendChild(h(`<div class="bl-ask">${esc(this.plain(v.last!.seat))}: «${esc(claimText(lastN, v.rank))}». Верите?</div>`));
    this.button('Не верю!', 'primary', () => this.send({ type: 'check' }));
    if (v.cfg.noAdd) this.button('Верю', '', () => this.send({ type: 'believe' }));
    else this.button(k ? `Верю, и ещё ${esc(claimText(k, v.rank))}` : 'Верю — выберите, что доложить', '', () => this.send({ type: 'add', cards: this.selected }), !k);
  }

  // ---------------------------------------------------------------- состояние

  setView(v: View) {
    this.v = v;
    this.shown = [];
    this.pileKeys = [];
    this.banner.hidden = true;
    this.draw();
  }

  private async showBanner(text: string, ms: number) {
    this.banner.textContent = text;
    this.banner.hidden = false;
    if (!ms) return;
    await sleep(ms);
    this.banner.hidden = true;
  }

  async play(events: Event[], v: View) {
    const speed = this.ctx.speed();
    this.clearTurn();
    for (const ev of events) {
      const cur = this.v!;
      if (ev.type === 'lead' || ev.type === 'add') {
        const keys = ev.cards ? ev.cards.map((c) => `pl:${cardKey(c)}`) : Array.from({ length: ev.n }, () => `p:${this.seq++}`);
        if (ev.type === 'lead') this.pileKeys = [];
        this.pileKeys.push(...keys);
        this.v = {
          ...cur,
          rank: ev.rank,
          plays: ev.type === 'lead' ? [{ seat: ev.seat, n: ev.n }] : [...cur.plays, { seat: ev.seat, n: ev.n }],
          last: { seat: ev.seat, cards: ev.cards ?? [] },
          pileCount: this.pileKeys.length,
          hands: ev.cards ? cur.hands.map((hh, i) => (i === ev.seat ? hh.filter((c) => !ev.cards!.some((x) => sameCard(x, c))) : hh)) : cur.hands,
          counts: cur.counts.map((c, i) => (i === ev.seat ? c - ev.n : c)),
        };
        this.draw();
        Sound.card();
        await this.showBanner(ev.type === 'lead' ? `«${claimText(ev.n, ev.rank)}»` : `«Верю, и ещё ${claimText(ev.n, ev.rank)}»`, 700 / speed);
      } else if (ev.type === 'believe') {
        await this.showBanner('«Верю»', 600 / speed);
      } else if (ev.type === 'check') {
        Sound.ui();
        await this.showBanner('«Не верю!»', 600 / speed);
        // открыть проверенные карты
        const n = this.pileKeys.length;
        this.pileKeys = this.pileKeys.slice(0, n - ev.cards.length);
        this.shown = ev.shown;
        this.v = { ...cur, pileCount: this.pileKeys.length, plays: cur.plays.slice(0, -1) };
        this.draw();
        await this.showBanner(ev.liar ? 'Враньё!' : 'Правда!', 1200 / speed);
        this.shown = [];
        this.pileKeys = [];
        this.v = { ...cur, pileCount: 0, plays: [], rank: null, last: null, counts: cur.counts.map((c, i) => (i === ev.taker ? c + ev.count : c)) };
        this.draw(this.anchor(cur, ev.taker));
        Sound.step();
        await sleep(400 / speed);
      } else if (ev.type === 'bin') {
        this.pileKeys = [];
        this.v = { ...cur, pileCount: 0, plays: [], rank: null, last: null, discard: cur.discard + ev.count };
        this.draw(this.g.bin);
        Sound.step();
        await sleep(450 / speed);
      } else if (ev.type === 'quad') {
        await this.showBanner(`${this.plain(ev.seat)}: четыре ${claimText(4, ev.rank).split(' ')[1]} — в отбой`, 900 / speed);
      } else if (ev.type === 'done') {
        Sound.win();
        await this.showBanner(`${this.plain(ev.seat)} — без карт!`, 900 / speed);
      } else if (ev.type === 'end') {
        this.v = v;
        this.draw();
        await this.showBanner(`Брехун — ${this.plain(ev.loser)}`, 0);
      }
    }
    this.v = v;
    this.draw();
  }

  setTurn(toAct: number[], interactive: number[]) {
    this.clearTurn();
    const v = this.v;
    if (!v || v.loser != null || this.ctx.demo) return;
    this.chooseViewer(v, toAct);
    const seat = interactive.find((x) => x === this.viewer) ?? null;
    if (this.hidden && interactive.length && this.ctx.mySeats.length > 1) {
      (this.cover.querySelector('.bl-cover-t') as HTMLElement).innerHTML = `Ход: ${this.ctx.name(this.viewer)}.<br><small>Передайте устройство — остальным не подглядывать!</small>`;
      this.cover.hidden = false;
    } else {
      this.hidden = false;
      this.cover.hidden = true;
    }
    this.actSeat = seat;
    this.draw();
    this.renderButtons();
  }

  status(v: View, toAct: number[], interactive: number[]) {
    if (v.loser != null) return `Проиграл ${this.ctx.name(v.loser)}`;
    const who = toAct[0];
    const mine = interactive.includes(who);
    if (v.rank == null) return mine ? 'Ваш заход: выберите карты и назовите ранг' : `Заходит ${this.ctx.name(who)}…`;
    return mine ? 'Верите или нет?' : `Думает ${this.ctx.name(who)}…`;
  }

  playerStats(v: View, seat: number) {
    const d = v.done.indexOf(seat);
    return d >= 0 ? `${d + 1}-е место` : `карт: ${countOf(v, seat)}`;
  }

  destroy() {
    this.cs.destroy();
  }
}

export function createView(): GameView<View, Event> {
  return new BluffView();
}
