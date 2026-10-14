/* Акулина — отрисовка: своя рука веером внизу, соперники рубашками сверху, отбой пар — открытой кучкой сбоку.
 * В свой ход веер соседа выезжает в середину стола: коснитесь любой рубашки — эту карту и вытянете. */
import { Sound } from '../../core/audio';
import { esc, h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { preloadDeck } from '../../cards/render';
import { settings } from '../../core/settings';
import { sameCard, sortHand, type Card } from '../../cards/deck';
import { CardStage, cardKey, fan, type Point, type StageItem } from '../../cards/stage';
import { countOf, offerer, type Event, type View } from './engine';
import { loserName, SEATS } from './def';
import './akulina.css';

const LAND = { port: false, W: 1000, hand: { x: 500, y: 610 }, hs: 1.05, pick: { x: 500, y: 330 }, pairs: { x: 120, y: 340 }, os: 0.5 };
const PORT = { port: true, W: 540, hand: { x: 270, y: 790 }, hs: 1.0, pick: { x: 270, y: 450 }, pairs: { x: 80, y: 280 }, os: 0.45 };
type Geo = typeof LAND;

class AkulinaView implements GameView<View, Event> {
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
    preloadDeck(settings.deck);
    this.cs = new CardStage(root, 1000, 720, 'ak-wrap', '<div class="ak-cloth"></div>', { portrait: { W: 540, H: 900 } });
    this.cs.onMode = () => this.draw();
    this.cs.over.innerHTML = '<div class="ak-plates"></div><div class="cs-banner" hidden></div>';
    this.plates = this.cs.over.querySelector('.ak-plates') as HTMLElement;
    this.banner = this.cs.over.querySelector('.cs-banner') as HTMLElement;
    this.cover = h('<div class="cs-cover" hidden><div class="cs-cover-box"><div class="ak-cover-t"></div><button class="btn primary">Показать карты</button></div></div>');
    this.cs.stage.appendChild(this.cover);
    (this.cover.querySelector('button') as HTMLButtonElement).onclick = () => {
      Sound.unlock();
      this.hidden = false;
      this.cover.hidden = true;
      this.draw();
      this.renderButtons();
    };
    const ctl = h('<div class="ak-controls"><div class="ak-btns"></div></div>');
    ctx.controls.appendChild(ctl);
    this.btns = ctl.querySelector('.ak-btns') as HTMLElement;
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
    return { x: W * 0.14 + t * W * 0.72, y: this.g.port ? 110 : 100 };
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
    // отбой пар — кучкой
    v.pairs.forEach((p, i) =>
      p.forEach((c, j) => items.push({ key: cardKey(c), card: c, x: g.pairs.x + ((i * 17) % 23) - 11 + j * 14, y: g.pairs.y + ((i * 29) % 21) - 10 - Math.min(i, 20), r: ((i * 37) % 40) - 20 + j * 8, s: 0.5, z: 5 + i * 2 + j }))
    );
    // у кого тяну — тот веер в середине
    const pickFrom = this.actSeat != null && !this.hidden ? offerer(v, this.actSeat) : v.loser == null && v.turn === this.viewer ? offerer(v, this.viewer) : null;
    for (const seat of v.seats) {
      const cnt = countOf(v, seat);
      const a = this.anchor(v, seat);
      const me = seat === this.viewer;
      const up = this.faceUp(v, seat);
      const list = up ? sortHand(v.hands[seat]) : [];
      for (let k = 0; k < cnt; k++) {
        if (me) {
          const p = fan(cnt, k, a.x, a.y, g.port ? 470 : 700, g.port ? 70 : 90, 16, 10);
          if (!up || !list[k]) items.push({ key: `b:${seat}:${k}`, card: null, ...p, s: g.hs, z: 100 + k });
          else items.push({ key: cardKey(list[k]), card: list[k], ...p, s: g.hs, z: 100 + k });
        } else if (seat === pickFrom) {
          const p = fan(cnt, k, g.pick.x, g.pick.y, g.port ? 460 : 620, g.port ? 64 : 84, 20, 14);
          items.push({ key: `b:${seat}:${k}`, card: null, ...p, s: g.port ? 0.85 : 0.9, z: 60 + k, cls: this.actSeat != null ? 'cs-can' : '', data: { pick: String(k) } });
        } else {
          const p = fan(cnt, k, a.x, a.y, g.port ? 80 : 120, 12, 6, 12);
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
      const y = me ? a.y - 78 * g.hs - 40 : a.y - (g.port ? 72 : 74);
      const on = v.turn === seat && v.loser == null;
      const d = v.done.indexOf(seat);
      const tail = d >= 0 ? `<em>${d + 1}-е место</em>` : v.loser === seat ? `<em>${esc(loserName(v))}</em>` : `<b>${countOf(v, seat)}</b>`;
      const x = Math.max(g.port ? 80 : 90, Math.min(g.W - (g.port ? 80 : 90), a.x));
      s += `<div class="cs-plate${on ? ' on' : ''}" style="--c:${SEATS[seat].color};left:${x}px;top:${y}px">${esc(this.plain(seat))} ${tail}</div>`;
    }
    if (v.pairs.length) s += `<div class="ak-pt" style="left:${g.pairs.x}px;top:${g.pairs.y + 64}px">пар: ${v.pairs.length}</div>`;
    this.plates.innerHTML = s;
  }

  private plain(seat: number) {
    return this.ctx.name(seat).replace(/<[^>]+>/g, '');
  }

  // ---------------------------------------------------------------- ход

  private onClick(e: MouseEvent) {
    const v = this.v;
    if (!v || this.actSeat == null || this.hidden) return;
    const el = (e.target as Element).closest('[data-pick]') as HTMLElement | null;
    if (!el) return;
    const seat = this.actSeat;
    Sound.unlock();
    this.clearTurn();
    this.ctx.act(seat, { type: 'draw', index: Number(el.dataset.pick) });
  }

  private clearTurn() {
    this.actSeat = null;
    this.btns.innerHTML = '';
  }

  private renderButtons() {
    this.btns.innerHTML = '';
    const v = this.v;
    if (!v || this.actSeat == null || this.ctx.demo || this.hidden) return;
    const from = offerer(v, this.actSeat);
    this.btns.appendChild(h(`<div class="ak-ask">Тяните карту у ${esc(this.plain(from))}: коснитесь любой рубашки.</div>`));
    const b = h<HTMLButtonElement>('<button class="btn" data-tap>Наугад</button>');
    b.onclick = () => {
      const seat = this.actSeat;
      if (seat == null) return;
      Sound.unlock();
      const n = countOf(v, from);
      this.clearTurn();
      this.ctx.act(seat, { type: 'draw', index: Math.floor(Math.random() * n) });
    };
    this.btns.appendChild(b);
  }

  // ---------------------------------------------------------------- состояние

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
      if (ev.type === 'draw') {
        const vis = (p: number) => cur.hands[p].length > 0 || this.faceUp(cur, p);
        this.v = {
          ...cur,
          hands: cur.hands.map((hh, i) => (i === ev.from ? hh.filter((c) => !ev.card || !sameCard(c, ev.card)) : i === ev.seat && ev.card && vis(i) ? [...hh, ev.card] : hh)),
          counts: cur.counts.map((c, i) => (i === ev.from ? c - 1 : i === ev.seat ? c + 1 : c)),
        };
        this.draw();
        Sound.card();
        await sleep(500 / speed);
      } else if (ev.type === 'pair') {
        this.v = {
          ...cur,
          hands: cur.hands.map((hh, i) => (i === ev.seat ? hh.filter((c) => !ev.cards.some((x) => sameCard(x, c))) : hh)),
          counts: cur.counts.map((c, i) => (i === ev.seat ? c - 2 : c)),
          pairs: [...cur.pairs, ev.cards as Card[]],
        };
        this.draw();
        Sound.step();
        await sleep(450 / speed);
      } else if (ev.type === 'out') {
        Sound.win();
        await this.showBanner(`${this.plain(ev.seat)} — без карт!`, 900 / speed);
      } else if (ev.type === 'end') {
        this.v = v;
        this.draw();
        await this.showBanner(`${this.plain(ev.loser)} — ${loserName(v)}!`, 0);
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
      (this.cover.querySelector('.ak-cover-t') as HTMLElement).innerHTML = `Ход: ${this.ctx.name(this.viewer)}.<br><small>Передайте устройство — остальным не подглядывать!</small>`;
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
    if (v.loser != null) return `${this.ctx.name(v.loser)} — ${loserName(v)}`;
    const who = toAct[0];
    return interactive.includes(who) ? `Тяните карту у ${this.ctx.name(offerer(v, who))}` : `${this.ctx.name(who)} тянет у ${this.ctx.name(offerer(v, who))}…`;
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
  return new AkulinaView();
}
