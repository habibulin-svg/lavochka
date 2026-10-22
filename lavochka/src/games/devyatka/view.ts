/* Девятка — отрисовка: четыре ряда мастей посередине (каждая карта на своём месте по старшинству), рука веером внизу,
 * соперники — рубашками сверху. Карты, которые можно положить, подсвечены — коснитесь, и карта ляжет в ряд. Пас — сам. */
import { Sound } from '../../core/audio';
import { esc, h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { preloadDeck, deckStyle } from '../../cards/render';
import { sameCard, sortHand, SUIT_SYM, type Card, type Suit } from '../../cards/deck';
import { CardStage, cardKey, fan, type Point, type StageItem } from '../../cards/stage';
import { canPlay, countOf, lowRank, type Event, type View } from './engine';
import { SEATS } from './def';
import './devyatka.css';

const ROWS: Suit[] = ['S', 'H', 'C', 'D'];
const LAND = { port: false, W: 1000, hand: { x: 500, y: 616 }, hs: 1.0, rows: { x0: 250, x1: 860, y0: 196, dy: 82 }, rs: 0.5, os: 0.45 };
const PORT = { port: true, W: 540, hand: { x: 270, y: 800 }, hs: 0.95, rows: { x0: 70, x1: 500, y0: 250, dy: 100 }, rs: 0.5, os: 0.4 };
type Geo = typeof LAND;

class DevyatkaView implements GameView<View, Event> {
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

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    preloadDeck(deckStyle());
    this.cs = new CardStage(root, 1000, 720, 'dv-wrap', '<div class="dv-cloth"></div>', { portrait: { W: 540, H: 900 } });
    this.cs.onMode = () => this.draw();
    this.cs.over.innerHTML = '<div class="dv-plates"></div><div class="cs-banner" hidden></div>';
    this.plates = this.cs.over.querySelector('.dv-plates') as HTMLElement;
    this.banner = this.cs.over.querySelector('.cs-banner') as HTMLElement;
    this.cover = h('<div class="cs-cover" hidden><div class="cs-cover-box"><div class="dv-cover-t"></div><button class="btn primary">Показать карты</button></div></div>');
    this.cs.stage.appendChild(this.cover);
    (this.cover.querySelector('button') as HTMLButtonElement).onclick = () => {
      Sound.unlock();
      this.hidden = false;
      this.cover.hidden = true;
      this.draw();
      this.renderButtons();
    };
    const ctl = h('<div class="dv-controls"><div class="dv-btns"></div></div>');
    ctx.controls.appendChild(ctl);
    this.btns = ctl.querySelector('.dv-btns') as HTMLElement;
    this.cs.stage.addEventListener('click', (e) => this.onClick(e));
  }

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
    return { x: W * 0.16 + t * W * 0.68, y: this.g.port ? 100 : 82 };
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

  /** Место карты в ряду. */
  private slot(v: View, s: Suit, r: number): Point {
    const g = this.g.rows;
    const lo = lowRank(v.cfg);
    const cols = 14 - lo;
    return { x: g.x0 + ((r - lo) / cols) * (g.x1 - g.x0), y: g.y0 + ROWS.indexOf(s) * g.dy };
  }

  private layout(v: View): StageItem[] {
    const g = this.g;
    const items: StageItem[] = [];
    for (const s of ROWS) {
      const row = v.rows[s];
      if (!row) continue;
      for (let r = row.lo; r <= row.hi; r++) {
        const p = this.slot(v, s, r);
        items.push({ key: cardKey({ s, r }), card: { s, r }, x: p.x, y: p.y, r: 0, s: g.rs, z: 10 + r });
      }
    }
    for (const seat of v.seats) {
      const cnt = countOf(v, seat);
      const a = this.anchor(v, seat);
      const me = seat === this.viewer;
      const up = this.faceUp(v, seat);
      const list = up ? sortHand(v.hands[seat]) : [];
      for (let k = 0; k < cnt; k++) {
        if (me) {
          const p = fan(cnt, k, a.x, a.y, g.port ? 480 : 760, g.port ? 52 : 70, 14, 8);
          const c = list[k];
          if (!up || !c) {
            items.push({ key: `b:${seat}:${k}`, card: null, ...p, s: g.hs, z: 100 + k });
            continue;
          }
          const ok = this.actSeat != null && canPlay(v, c);
          items.push({ key: cardKey(c), card: c, x: p.x, y: p.y - (ok ? 14 : 0), r: p.r, s: g.hs, z: 100 + k, cls: this.actSeat != null ? (ok ? 'cs-can' : 'dv-no') : '', data: ok ? { hand: c.s + c.r } : undefined });
        } else {
          const p = fan(cnt, k, a.x, a.y, g.port ? 80 : 120, 9, 6, 10);
          items.push({ key: `b:${seat}:${k}`, card: null, ...p, s: g.os, z: 50 + k });
        }
      }
    }
    return items;
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
      const y = me ? a.y - 78 * g.hs - 34 : a.y + (g.port ? 40 : 40);
      const on = v.turn === seat && !v.over;
      const x = Math.max(g.port ? 80 : 90, Math.min(g.W - (g.port ? 80 : 90), a.x));
      const sc = v.cfg.scoring === 'bank' ? `<i title="Фишки">● ${v.score[seat]}</i>` : `<i title="Штраф">${v.score[seat]}</i>`;
      s += `<div class="cs-plate${on ? ' on' : ''}" style="--c:${SEATS[seat].color};left:${x}px;top:${y}px">${esc(this.plain(seat))} <b>${countOf(v, seat)}</b> ${sc}</div>`;
    }
    for (const su of ROWS) {
      const p = this.slot(v, su, lowRank(v.cfg));
      const red = su === 'H' || su === 'D';
      s += `<div class="dv-suit${red ? ' red' : ''}" style="left:${p.x - (g.port ? 46 : 60)}px;top:${p.y}px">${SUIT_SYM[su]}</div>`;
    }
    if (v.cfg.scoring === 'bank') s += `<div class="dv-bank" style="left:${g.port ? 270 : 110}px;top:${g.port ? 650 : 330}px">банк<b>${v.bank}</b></div>`;
    this.plates.innerHTML = s;
  }

  private plain(seat: number) {
    return this.ctx.name(seat).replace(/<[^>]+>/g, '');
  }

  private onClick(e: MouseEvent) {
    const v = this.v;
    if (!v || this.actSeat == null || this.hidden) return;
    const el = (e.target as Element).closest('[data-hand]') as HTMLElement | null;
    if (!el) return;
    const card = v.hands[this.actSeat].find((c) => c.s + c.r === el.dataset.hand);
    if (!card) return;
    const seat = this.actSeat;
    Sound.unlock();
    this.clearTurn();
    this.ctx.act(seat, { type: 'play', card });
  }

  private clearTurn() {
    this.actSeat = null;
    this.btns.innerHTML = '';
  }

  private renderButtons() {
    this.btns.innerHTML = '';
    if (this.actSeat == null || this.ctx.demo || this.hidden) return;
    this.btns.appendChild(h('<div class="dv-ask">Ваш ход: коснитесь подсвеченной карты.</div>'));
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
        const row = cur.rows[ev.card.s];
        this.v = {
          ...cur,
          rows: { ...cur.rows, [ev.card.s]: row ? { lo: Math.min(row.lo, ev.card.r), hi: Math.max(row.hi, ev.card.r) } : { lo: ev.card.r, hi: ev.card.r } },
          hands: cur.hands.map((hh, i) => (i === ev.seat ? hh.filter((c) => !sameCard(c, ev.card as Card)) : hh)),
          counts: cur.counts.map((c, i) => (i === ev.seat ? c - 1 : c)),
          turn: ev.seat,
        };
        this.draw();
        Sound.card();
        await sleep(380 / speed);
      } else if (ev.type === 'pass') {
        this.v = { ...cur, turn: ev.seat };
        this.draw();
        Sound.step();
        await this.showBanner(`${this.plain(ev.seat)}: «Пас»`, 600 / speed);
      } else if (ev.type === 'round') {
        Sound.win();
        await this.showBanner(`Кон за ${this.plain(ev.winner)}`, 1400 / speed);
      } else if (ev.type === 'deal') {
        Sound.shuffle();
        this.v = { ...v, rows: { S: null, C: null, D: null, H: null } };
        this.draw();
        await sleep(300 / speed);
      } else if (ev.type === 'end') {
        this.v = v;
        this.draw();
        await this.showBanner(`Победил ${ev.winners.map((p) => this.plain(p)).join(', ')}`, 0);
      }
    }
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
      (this.cover.querySelector('.dv-cover-t') as HTMLElement).innerHTML = `Ход: ${this.ctx.name(this.viewer)}.<br><small>Передайте устройство — остальным не подглядывать!</small>`;
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
    if (v.over) return 'Партия окончена';
    const who = toAct[0];
    return interactive.includes(who) ? 'Ваш ход' : `Ходит ${this.ctx.name(who)}…`;
  }

  playerStats(v: View, seat: number) {
    return v.cfg.scoring === 'bank' ? `фишек: ${v.score[seat]}` : `штраф: ${v.score[seat]}`;
  }

  destroy() {
    this.cs.destroy();
  }
}

export function createView(): GameView<View, Event> {
  return new DevyatkaView();
}
