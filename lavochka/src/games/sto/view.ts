/* 101 — отрисовка: клеёнка, колода слева, сброс в центре (верхние карты веером), свои карты снизу, соперники по дуге.
 * Ход — нажать на подходящую карту; дама — спросит масть. Нечем ходить — «Взять из колоды» или «Пас». */
import { Sound } from '../../core/audio';
import { esc, h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { preloadDeck } from '../../cards/render';
import { settings } from '../../core/settings';
import { sameCard, sortHand, SUIT_NAME, SUIT_SYM, type Card, type Suit } from '../../cards/deck';
import { CardStage, cardKey, fan, portraitArc, portraitHand, type Point, type StageItem } from '../../cards/stage';
import { handCount, playable, stockLeft, top, type Event, type View } from './engine';
import { SEATS } from './def';
import './sto.css';

/** Геометрия стола: альбомная 1000×720 и вертикальная для телефона 540×900. */
const LAND = { port: false, W: 1000, hand: { x: 520, y: 606 }, pile: { x: 560, y: 318 }, stock: { x: 330, y: 318 }, ps: 1.1, os: 0.6 };
const PORT = { port: true, W: 540, hand: { x: 270, y: 792 }, pile: { x: 350, y: 440 }, stock: { x: 150, y: 440 }, ps: 1.05, os: 0.5 };
type Geo = typeof LAND;

function arc(g: Geo, n: number): Point[] {
  if (g.port) return portraitArc(n, g.W);
  if (n === 1) return [{ x: 520, y: 92 }];
  const out: Point[] = [];
  const span = Math.min(760, 230 * (n - 1));
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    out.push({ x: 520 - span / 2 + span * t, y: 88 + Math.pow(2 * t - 1, 2) * (n > 3 ? 70 : 40) });
  }
  return out;
}

class StoView implements GameView<View, Event> {
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
  private askSuit: Card | null = null;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    preloadDeck(settings.deck);
    this.cs = new CardStage(root, 1000, 720, 'st-wrap', '<div class="st-cloth"></div>', { portrait: { W: 540, H: 900 } });
    this.cs.onMode = () => this.draw();
    this.cs.over.innerHTML = '<div class="st-plates"></div><div class="cs-banner" hidden></div>';
    this.plates = this.cs.over.querySelector('.st-plates') as HTMLElement;
    this.banner = this.cs.over.querySelector('.cs-banner') as HTMLElement;
    this.cover = h('<div class="cs-cover" hidden><div class="cs-cover-box"><div class="st-cover-t"></div><button class="btn primary">Показать карты</button></div></div>');
    this.cs.stage.appendChild(this.cover);
    (this.cover.querySelector('button') as HTMLButtonElement).onclick = () => {
      Sound.unlock();
      this.hidden = false;
      this.cover.hidden = true;
      this.draw();
      this.renderButtons();
    };
    const ctl = h(`<div class="st-controls"><div class="st-btns"></div>${ctx.demo ? '' : '<div class="hint small-hint">Нажмите на карту, которую кладёте. Подходящие — светлые.</div>'}</div>`);
    ctx.controls.appendChild(ctl);
    this.btns = ctl.querySelector('.st-btns') as HTMLElement;
    this.cs.stage.addEventListener('click', (e) => this.onClick(e));
  }

  private order(v: View): number[] {
    const i0 = Math.max(0, v.seats.indexOf(this.viewer));
    return v.seats.map((_, k) => v.seats[(i0 + k) % v.seats.length]);
  }

  private get g(): Geo {
    return this.cs.portrait ? PORT : LAND;
  }

  private anchor(v: View, seat: number): Point {
    const ord = this.order(v);
    const k = ord.indexOf(seat);
    if (k === 0) return this.g.hand;
    return arc(this.g, ord.length - 1)[k - 1];
  }

  private chooseViewer(v: View, toAct: number[]) {
    const mine = this.ctx.mySeats.filter((x) => v.alive.includes(x));
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
    if (this.ctx.demo) return v.hands[seat].length > 0 || handCount(v, seat) === 0;
    return seat === this.viewer && !this.hidden && this.ctx.mySeats.includes(seat);
  }

  private layout(v: View): StageItem[] {
    const g = this.g;
    const PILE = g.pile;
    const items: StageItem[] = [];
    const sl = stockLeft(v);
    if (sl) items.push({ key: 'stock', card: null, x: g.stock.x, y: g.stock.y - Math.min(8, sl / 4), r: 0, s: g.ps, z: 2, cls: `st-stock${this.canDraw(v) ? ' cs-can' : ''}`, data: sl ? { stock: '1' } : undefined });
    // сброс: верхние пять карт веером, старые — ровно под ними (чтобы не исчезали из-под низа)
    const old = Math.max(0, v.pile.length - 5);
    v.pile.forEach((c, j) => {
      const i = j - old;
      if (i < 0) items.push({ key: cardKey(c), card: c, x: PILE.x - 56, y: PILE.y, r: 0, s: g.ps, z: 9 });
      else items.push({ key: cardKey(c), card: c, x: PILE.x + (i - (v.pile.length - old) + 1) * 14, y: PILE.y + ((i * 7) % 5) - 2, r: ((i * 37) % 24) - 12, s: g.ps, z: 10 + i });
    });
    for (const seat of v.seats) {
      if (!v.alive.includes(seat)) continue;
      const n = handCount(v, seat);
      const a = this.anchor(v, seat);
      const me = seat === this.viewer;
      const up = this.faceUp(v, seat);
      const list = up ? sortHand(v.hands[seat]) : [];
      const can = me && this.actSeat === seat ? playable(v, v.hands[seat]) : [];
      for (let k = 0; k < n; k++) {
        if (me) {
          const p = g.port ? portraitHand(n, k, a.x, a.y, 410, g.ps, false) : { ...fan(n, k, a.x, a.y, 760, 84, 40, 24), s: g.ps };
          if (!up) {
            items.push({ key: `b:${seat}:${k}`, card: null, ...p, z: 100 + k });
            continue;
          }
          const c = list[k];
          const ok = can.some((x) => sameCard(x, c));
          const sel = this.askSuit && sameCard(this.askSuit, c);
          items.push({ key: cardKey(c), card: c, x: p.x, y: p.y - (sel ? 30 : 0), r: p.r, s: p.s, z: 100 + k, cls: this.actSeat != null ? (sel ? 'cs-sel' : ok ? 'cs-can' : 'cs-dim') : '', data: { hand: c.s + c.r } });
        } else {
          const p = fan(n, k, a.x, a.y, g.port ? 90 : 120, 14, 8, 30);
          items.push(up ? { key: cardKey(list[k]), card: list[k], ...p, s: g.os, z: 50 + k } : { key: `b:${seat}:${k}`, card: null, ...p, s: g.os, z: 50 + k });
        }
      }
    }
    return items;
  }

  private canDraw(v: View) {
    if (this.actSeat == null || this.hidden) return false;
    if (playable(v, v.hands[this.actSeat]).length) return false;
    return (stockLeft(v) > 0 || v.pile.length > 1) && !(v.cfg.drawOne && v.drew && !v.cover);
  }

  private draw(enter: Point | null = null) {
    const v = this.v;
    if (!v) return;
    this.cs.render(this.layout(v), this.ctx.speed(), enter);
    const g = this.g;
    const PILE = g.pile;
    const STOCK = g.stock;
    let s = '';
    for (const seat of v.seats) {
      const a = this.anchor(v, seat);
      const me = seat === this.viewer;
      const many = me && g.port && handCount(v, seat) > 9;
      const y = me ? a.y - (g.port ? (many ? 184 : 126) : 124) : a.y + (g.port ? 44 : 58);
      const x = g.port && !me ? Math.max(80, Math.min(g.W - 80, a.x)) : a.x;
      const out = !v.alive.includes(seat);
      const on = v.turn === seat && v.phase !== 'over';
      s += `<div class="cs-plate${on ? ' on' : ''}${out ? ' st-out' : ''}" style="--c:${SEATS[seat].color};left:${x}px;top:${y}px">${esc(this.plain(seat))} <i>${v.scores[seat]}</i>${out ? ' <em>выбыл</em>' : ''}</div>`;
    }
    const t = top(v);
    const suit = v.suit ?? (t ? t.s : null);
    if (suit) s += `<div class="st-suit" style="left:${g.port ? PILE.x - 40 : PILE.x + 120}px;top:${g.port ? PILE.y - 196 : PILE.y - 40}px"><span class="${suit === 'H' || suit === 'D' ? 'red' : ''}">${SUIT_SYM[suit]}</span><small>${v.suit ? 'заказ' : 'масть'}${v.cover ? ' · крыть!' : ''}</small></div>`;
    if (stockLeft(v)) s += `<div class="st-count" style="left:${STOCK.x - 40}px;top:${STOCK.y + 90}px">колода ${stockLeft(v)}</div>`;
    if (v.alive.length > 2 && v.cfg.reverse) s += `<div class="st-dir" style="left:${PILE.x - 30}px;top:${PILE.y + 100}px">${v.dir === 1 ? '↻' : '↺'}</div>`;
    this.plates.innerHTML = s;
  }

  private plain(seat: number) {
    return this.ctx.name(seat).replace(/<[^>]+>/g, '');
  }

  private onClick(e: MouseEvent) {
    const v = this.v;
    if (!v || this.actSeat == null || this.hidden) return;
    if ((e.target as Element).closest('[data-stock]') && this.canDraw(v)) return this.send({ type: 'draw' });
    const el = (e.target as Element).closest('[data-hand]') as HTMLElement | null;
    if (!el) return;
    const card = v.hands[this.actSeat].find((c) => c.s + c.r === el.dataset.hand);
    if (!card) return;
    if (!playable(v, v.hands[this.actSeat]).some((c) => sameCard(c, card))) {
      Sound.nomove();
      return;
    }
    if (card.r === 12) {
      this.askSuit = card;
      this.draw();
      this.renderButtons();
      return;
    }
    this.send({ type: 'play', card });
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
    this.askSuit = null;
    this.btns.innerHTML = '';
  }

  private button(text: string, primary: boolean, on: () => void) {
    const b = h<HTMLButtonElement>(`<button class="btn ${primary ? 'primary' : ''}">${text}</button>`);
    b.onclick = () => {
      Sound.unlock();
      on();
    };
    this.btns.appendChild(b);
  }

  private renderButtons() {
    this.btns.innerHTML = '';
    const v = this.v;
    const seat = this.actSeat;
    if (!v || seat == null || this.ctx.demo || this.hidden) return;
    if (this.askSuit) {
      const q = this.askSuit;
      this.btns.appendChild(h('<div class="st-ask">Какую масть заказать?</div>'));
      const row = h('<div class="st-row"></div>');
      for (const s of ['S', 'C', 'D', 'H'] as Suit[]) {
        const b = h<HTMLButtonElement>(`<button class="btn st-sb ${s === 'H' || s === 'D' ? 'red' : ''}" title="${SUIT_NAME[s]}">${SUIT_SYM[s]}</button>`);
        b.onclick = () => this.send({ type: 'play', card: q, suit: s });
        row.appendChild(b);
      }
      this.btns.appendChild(row);
      this.button('Отмена', false, () => {
        this.askSuit = null;
        this.draw();
        this.renderButtons();
      });
      return;
    }
    if (playable(v, v.hands[seat]).length) {
      if (v.cover) this.btns.appendChild(h('<div class="st-ask">Покройте шестёрку!</div>'));
      return;
    }
    if (this.canDraw(v)) this.button('Взять из колоды', true, () => this.send({ type: 'draw' }));
    else this.button('Пас — ходить нечем', true, () => this.send({ type: 'pass' }));
  }

  setView(v: View) {
    this.v = v;
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
      if (ev.type === 'play') {
        this.v = {
          ...cur,
          pile: [...cur.pile, ev.card],
          suit: ev.suit ?? null,
          hands: cur.hands.map((hh, i) => (i === ev.seat ? hh.filter((c) => !sameCard(c, ev.card)) : hh)),
          counts: cur.counts.map((n, i) => (i === ev.seat ? n - 1 : n)),
          cover: ev.card.r === 6,
        };
        this.draw();
        Sound.card();
        await sleep(300 / speed);
      } else if (ev.type === 'draw') {
        this.v = {
          ...cur,
          hands: cur.hands.map((hh, i) => (i === ev.seat && ev.cards ? [...hh, ...ev.cards] : hh)),
          counts: cur.counts.map((n, i) => (i === ev.seat ? n + ev.count : n)),
          stockCount: Math.max(0, cur.stockCount - ev.count),
        };
        this.draw(this.g.stock);
        Sound.card();
        await sleep((ev.forced ? 420 : 200) / speed);
      } else if (ev.type === 'skip') {
        Sound.nomove();
        await this.showBanner(`${this.plain(ev.seat)} пропускает ход`, 650 / speed);
      } else if (ev.type === 'reverse') {
        Sound.ui();
        await this.showBanner('Разворот!', 600 / speed);
      } else if (ev.type === 'round') {
        Sound.win();
        await this.showBanner(`${this.plain(ev.winner)} выходит!${ev.bonus ? ` ${ev.bonus}` : ''}`, 1400 / speed);
      } else if (ev.type === 'deal') Sound.shuffle();
      else if (ev.type === 'end') {
        Sound.win();
        this.v = v;
        this.draw();
        await this.showBanner(`Победа: ${this.plain(ev.winner)}`, 0);
      }
    }
    this.v = v;
    this.draw(this.g.stock);
  }

  setTurn(toAct: number[], interactive: number[]) {
    this.clearTurn();
    const v = this.v;
    if (!v || v.phase === 'over' || this.ctx.demo) return;
    this.chooseViewer(v, toAct);
    const seat = interactive.find((x) => x === this.viewer) ?? null;
    if (this.hidden && interactive.length && this.ctx.mySeats.length > 1) {
      (this.cover.querySelector('.st-cover-t') as HTMLElement).innerHTML = `Ход: ${this.ctx.name(this.viewer)}.<br><small>Передайте устройство — остальным не подглядывать!</small>`;
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
    const name = (p: number) => this.ctx.name(p);
    if (v.phase === 'over') return v.winner != null ? `Победа: ${name(v.winner)}` : 'Партия окончена';
    const who = toAct[0];
    const mine = interactive.includes(who);
    if (!mine) return `Ходит ${name(who)}…`;
    if (v.cover) return 'Покройте шестёрку';
    return playable(v, v.hands[who]).length ? 'Ваш ход' : 'Нечем ходить';
  }

  playerStats(v: View, seat: number) {
    return v.alive.includes(seat) ? `очки: ${v.scores[seat]}` : 'выбыл';
  }

  destroy() {
    this.cs.destroy();
  }
}

export function createView(): GameView<View, Event> {
  return new StoView();
}
