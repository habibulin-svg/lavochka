/* Сундучок — отрисовка: базар рубашками посередине, рука веером внизу, соперники — рубашками сверху; сундучки — раскрытые четвёрки
 * у каждого. Коснитесь своей карты (это ранг, который просите), потом нажмите «Попросить у …»; в варианте с мастью — ещё и масть. */
import { Sound } from '../../core/audio';
import { esc, h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { preloadDeck, deckStyle } from '../../cards/render';
import { sameCard, sortHand, SUIT_SYM, SUITS, type Suit } from '../../cards/deck';
import { CardStage, cardKey, fan, type Point, type StageItem } from '../../cards/stage';
import { bazaarLeft, canAsk, countOf, type Event, type View } from './engine';
import { askText, chestText, SEATS } from './def';
import './sunduchok.css';

const LAND = { port: false, W: 1000, hand: { x: 470, y: 610 }, hs: 1.05, bazaar: { x: 500, y: 330 }, os: 0.48, mine: { x: 880, y: 470 } };
const PORT = { port: true, W: 540, hand: { x: 270, y: 790 }, hs: 1.0, bazaar: { x: 270, y: 420 }, os: 0.42, mine: { x: 270, y: 600 } };
type Geo = typeof LAND;

class SunduchokView implements GameView<View, Event> {
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
  private rank: number | null = null;
  private suit: Suit | null = null;
  /** Откуда летят новые карты (просьба удалась — от отдавшего; базар — из колоды). */
  private flowFrom: Point | null = null;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    preloadDeck(deckStyle());
    this.cs = new CardStage(root, 1000, 720, 'sd-wrap', '<div class="sd-cloth"></div>', { portrait: { W: 540, H: 900 } });
    this.cs.onMode = () => this.draw();
    this.cs.over.innerHTML = '<div class="sd-plates"></div><div class="cs-banner" hidden></div>';
    this.plates = this.cs.over.querySelector('.sd-plates') as HTMLElement;
    this.banner = this.cs.over.querySelector('.cs-banner') as HTMLElement;
    this.cover = h('<div class="cs-cover" hidden><div class="cs-cover-box"><div class="sd-cover-t"></div><button class="btn primary">Показать карты</button></div></div>');
    this.cs.stage.appendChild(this.cover);
    (this.cover.querySelector('button') as HTMLButtonElement).onclick = () => {
      Sound.unlock();
      this.hidden = false;
      this.cover.hidden = true;
      this.draw();
      this.renderButtons();
    };
    const ctl = h(`<div class="sd-controls"><div class="sd-btns"></div>${ctx.demo ? '' : '<div class="hint small-hint">Коснитесь своей карты — это ранг, который просите, — и выберите, у кого.</div>'}</div>`);
    ctx.controls.appendChild(ctl);
    this.btns = ctl.querySelector('.sd-btns') as HTMLElement;
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
    const W = this.g.W;
    const t = n === 2 ? 0.5 : (k - 1) / (n - 2);
    return { x: W * 0.14 + t * W * 0.72, y: this.g.port ? 110 : 96 };
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

  private layout(v: View): StageItem[] {
    const g = this.g;
    const items: StageItem[] = [];
    const bl = bazaarLeft(v);
    const thick = Math.min(5, Math.ceil(bl / 5));
    for (let k = 0; k < thick; k++) items.push({ key: `bz:${k}`, card: null, x: g.bazaar.x - k * 1.5, y: g.bazaar.y - k * 2.5, r: -4, s: 0.8, z: 2 + k });
    const fromPt = this.flowFrom ?? undefined;
    for (const seat of v.seats) {
      const cnt = countOf(v, seat);
      const a = this.anchor(v, seat);
      const me = seat === this.viewer;
      const up = this.faceUp(v, seat);
      const list = up ? sortHand(v.hands[seat]) : [];
      for (let k = 0; k < cnt; k++) {
        if (me) {
          const p = fan(cnt, k, a.x, a.y, g.port ? 470 : 700, g.port ? 64 : 82, 16, 10);
          // карты, которых ещё не видно (стопка только летит в руку), — рубашкой
          if (!up || !list[k]) {
            items.push({ key: `b:${seat}:${k}`, card: null, ...p, s: g.hs, z: 100 + k, fromPt });
            continue;
          }
          const c = list[k];
          const sel = this.rank === c.r;
          const cls = this.actSeat != null ? (sel ? 'cs-sel' : 'cs-can') : '';
          items.push({ key: cardKey(c), card: c, x: p.x, y: p.y - (sel ? 24 : 0), r: p.r, s: g.hs, z: 100 + k, cls, data: { hand: c.s + c.r }, fromPt });
        } else {
          const p = fan(cnt, k, a.x, a.y, g.port ? 80 : 120, 10, 6, 12);
          items.push({ key: `b:${seat}:${k}`, card: null, ...p, s: g.os, z: 50 + k, fromPt });
        }
      }
      // сундучки — раскрытыми четвёрками
      const chests = v.chests[seat];
      chests.forEach((r, i) => {
        const base = me ? this.myChest(i, chests.length) : { x: a.x - ((chests.length - 1) / 2) * 46 + i * 46, y: a.y + (g.port ? 92 : 96) };
        SUITS.forEach((s, j) => {
          const c = { s, r };
          items.push({ key: cardKey(c), card: c, x: base.x + j * (me ? 9 : 5), y: base.y + j * 2, r: -6 + j * 4, s: me ? 0.42 : 0.34, z: 30 + i * 4 + j });
        });
      });
    }
    return items;
  }

  /** Свои сундучки: справа от руки (на телефоне — рядом над рукой). */
  private myChest(i: number, n: number): Point {
    const g = this.g;
    if (g.port) return { x: g.mine.x - ((n - 1) / 2) * 50 + i * 50, y: g.mine.y };
    const col = i % 3;
    const row = Math.floor(i / 3);
    return { x: g.mine.x + col * 46 - 46, y: g.mine.y - row * 74 };
  }

  private draw() {
    const v = this.v;
    if (!v) return;
    this.cs.render(this.layout(v), this.ctx.speed());
    const g = this.g;
    let s = '';
    for (const seat of v.seats) {
      const a = this.anchor(v, seat);
      const me = seat === this.viewer;
      const y = me ? a.y - 78 * g.hs - 40 : a.y - (g.port ? 72 : 70);
      const on = v.turn === seat && !v.over;
      const x = Math.max(g.port ? 80 : 90, Math.min(g.W - (g.port ? 80 : 90), a.x));
      s += `<div class="cs-plate${on ? ' on' : ''}" style="--c:${SEATS[seat].color};left:${x}px;top:${y}px">${esc(this.plain(seat))} <b>${countOf(v, seat)}</b>${v.chests[seat].length ? ` <i title="Сундучки">▣ ${v.chests[seat].length}</i>` : ''}</div>`;
    }
    s += `<div class="sd-bz" style="left:${g.bazaar.x}px;top:${g.bazaar.y + (g.port ? 72 : 76)}px">${bazaarLeft(v) ? `базар ${bazaarLeft(v)}` : 'базар пуст'}</div>`;
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
    this.rank = this.rank === card.r ? null : card.r;
    this.suit = null;
    Sound.ui();
    this.draw();
    this.renderButtons();
  }

  private send(target: number) {
    const seat = this.actSeat;
    if (seat == null || this.rank == null) return;
    Sound.unlock();
    const a = { type: 'ask', target, rank: this.rank, suit: this.suit ?? undefined };
    this.clearTurn();
    this.ctx.act(seat, a);
  }

  private clearTurn() {
    this.actSeat = null;
    this.rank = null;
    this.suit = null;
    this.btns.innerHTML = '';
  }

  private renderButtons() {
    this.btns.innerHTML = '';
    const v = this.v;
    const seat = this.actSeat;
    if (!v || seat == null || this.ctx.demo || this.hidden) return;
    if (this.rank == null) {
      this.btns.appendChild(h('<div class="sd-ask">Коснитесь карты: какой ранг просите?</div>'));
      return;
    }
    const r = this.rank;
    if (v.cfg.suit) {
      const row = h('<div class="sd-suits"></div>');
      for (const s of SUITS) {
        const have = v.hands[seat].some((c) => c.r === r && c.s === s);
        const b = h<HTMLButtonElement>(`<button class="btn${this.suit === s ? ' primary' : ''}${s === 'H' || s === 'D' ? ' red' : ''}"${have ? ' disabled' : ''}>${SUIT_SYM[s]}</button>`);
        b.onclick = () => {
          this.suit = s;
          this.renderButtons();
        };
        row.appendChild(b);
      }
      this.btns.appendChild(h('<div class="sd-ask">Какую масть?</div>'));
      this.btns.appendChild(row);
      if (!this.suit) return;
    }
    const what = askText(r, this.suit ?? undefined);
    for (const t of v.seats) {
      if (!canAsk(v, seat, t)) continue;
      const b = h<HTMLButtonElement>(`<button class="btn primary">${esc(this.plain(t))}, дай ${esc(what)}!</button>`);
      b.onclick = () => this.send(t);
      this.btns.appendChild(b);
    }
  }

  // ---------------------------------------------------------------- состояние

  setView(v: View) {
    this.v = v;
    this.banner.hidden = true;
    this.flowFrom = null;
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
      if (ev.type === 'ask') {
        Sound.ui();
        await this.showBanner(`«${this.plain(ev.target)}, дай ${askText(ev.rank, ev.suit)}!»`, 800 / speed);
        if (ev.cards.length) {
          this.flowFrom = this.anchor(cur, ev.target);
          const n = ev.cards.length;
          this.v = {
            ...cur,
            hands: cur.hands.map((hh, i) => (i === ev.target ? hh.filter((c) => !ev.cards.some((x) => sameCard(x, c))) : i === ev.seat && (hh.length || cur.counts[i] === 0) ? [...hh, ...ev.cards] : hh)),
            counts: cur.counts.map((c, i) => (i === ev.target ? c - n : i === ev.seat ? c + n : c)),
          };
          this.draw();
          Sound.card();
          await sleep(500 / speed);
        } else await this.showBanner('«Иди на базар!»', 700 / speed);
      } else if (ev.type === 'fish' || ev.type === 'refill') {
        const n = ev.type === 'fish' ? 1 : ev.n;
        const got = ev.type === 'fish' ? (ev.card ? [ev.card] : []) : (ev.cards ?? []);
        this.flowFrom = this.g.bazaar;
        this.v = {
          ...cur,
          hands: cur.hands.map((hh, i) => (i === ev.seat && got.length ? [...hh, ...got] : hh)),
          counts: cur.counts.map((c, i) => (i === ev.seat ? c + n : c)),
          bazaarCount: cur.bazaarCount - n,
        };
        this.draw();
        Sound.card();
        await sleep(400 / speed);
        if (ev.type === 'fish' && ev.lucky) await this.showBanner('С базара — та самая!', 900 / speed);
      } else if (ev.type === 'chest') {
        this.flowFrom = null;
        this.v = {
          ...cur,
          hands: cur.hands.map((hh, i) => (i === ev.seat ? hh.filter((c) => c.r !== ev.rank) : hh)),
          counts: cur.counts.map((c, i) => (i === ev.seat ? c - 4 : c)),
          chests: cur.chests.map((c, i) => (i === ev.seat ? [...c, ev.rank] : c)),
        };
        this.draw();
        Sound.win();
        await this.showBanner(`«Сундучок!» — ${chestText(ev.rank)}`, 1000 / speed);
      } else if (ev.type === 'end') {
        this.v = v;
        this.draw();
        const best = Math.max(...ev.chests);
        await this.showBanner(`Больше всех сундучков: ${best}`, 0);
      }
    }
    this.flowFrom = null;
    this.v = v;
    this.draw();
  }

  setTurn(toAct: number[], interactive: number[]) {
    this.clearTurn();
    const v = this.v;
    if (!v || v.over || this.ctx.demo) return;
    this.chooseViewer(v, toAct);
    const seat = interactive.find((x) => x === this.viewer) ?? null;
    if (this.hidden && interactive.length && this.ctx.mySeats.length > 1) {
      (this.cover.querySelector('.sd-cover-t') as HTMLElement).innerHTML = `Ход: ${this.ctx.name(this.viewer)}.<br><small>Передайте устройство — остальным не подглядывать!</small>`;
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
    if (v.over) return 'Все сундучки собраны';
    const who = toAct[0];
    return interactive.includes(who) ? 'Ваш ход: просите карты' : `Просит ${this.ctx.name(who)}…`;
  }

  playerStats(v: View, seat: number) {
    return `сундучков: ${v.chests[seat].length}`;
  }

  destroy() {
    this.cs.destroy();
  }
}

export function createView(): GameView<View, Event> {
  return new SunduchokView();
}
