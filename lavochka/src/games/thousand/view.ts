/* Тысяча — отрисовка: стол под зелёным сукном, свой веер снизу, соперники по бокам (вчетвером — и сверху),
 * прикуп и взятка в центре. Торговля, отдача карт и подъём заказа — кнопками в панели; запись очков — «пулька» там же.
 * Ход — нажать на карту; король или дама марьяжа на своём ходу — спросит, объявить ли марьяж. */
import { Sound } from '../../core/audio';
import { esc, h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { preloadDeck } from '../../cards/render';
import { settings } from '../../core/settings';
import { sameCard, sortHand, SUIT_SYM, type Card } from '../../cards/deck';
import { CardStage, cardKey, fan, type Point, type StageItem } from '../../cards/stage';
import { handCount, legalCards, MARRIAGE, marriagesIn, maxBid, type Event, type View } from './engine';
import { SEATS } from './def';
import './thousand.css';

const W = 1000;
const H = 720;
const HAND_Y = 615;
const CENTER = { x: 500, y: 330 };

class ThousandView implements GameView<View, Event> {
  private ctx!: ViewCtx;
  private cs!: CardStage;
  private plates!: HTMLElement;
  private banner!: HTMLElement;
  private cover!: HTMLElement;
  private btns!: HTMLElement;
  private sheet!: HTMLElement;
  private v: View | null = null;
  private viewer = 0;
  private hidden = false;
  private actSeat: number | null = null;
  private selected: Card | null = null;
  private askMarriage: Card | null = null;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    preloadDeck(settings.deck);
    this.cs = new CardStage(root, W, H, 'th-wrap', '<div class="th-cloth"></div>');
    this.cs.over.innerHTML = '<div class="th-plates"></div><div class="cs-banner" hidden></div>';
    this.plates = this.cs.over.querySelector('.th-plates') as HTMLElement;
    this.banner = this.cs.over.querySelector('.cs-banner') as HTMLElement;
    this.cover = h('<div class="cs-cover" hidden><div class="cs-cover-box"><div class="th-cover-t"></div><button class="btn primary">Показать карты</button></div></div>');
    this.cs.stage.appendChild(this.cover);
    (this.cover.querySelector('button') as HTMLButtonElement).onclick = () => {
      Sound.unlock();
      this.hidden = false;
      this.cover.hidden = true;
      this.draw();
      this.renderButtons();
    };
    const ctl = h(`<div class="th-controls"><div class="th-btns"></div><div class="th-sheet"></div>${ctx.demo ? '' : '<div class="hint small-hint">Ход — нажать на карту. Чтобы отдать карту, выберите её и нажмите на имя соперника.</div>'}</div>`);
    ctx.controls.appendChild(ctl);
    this.btns = ctl.querySelector('.th-btns') as HTMLElement;
    this.sheet = ctl.querySelector('.th-sheet') as HTMLElement;
    this.cs.stage.addEventListener('click', (e) => this.onClick(e));
    this.plates.addEventListener('click', (e) => {
      const pl = (e.target as Element).closest('[data-give]') as HTMLElement | null;
      if (pl && this.selected) this.send({ type: 'give', to: +pl.dataset.give!, card: this.selected });
    });
  }

  // ---------------------------------------------------------------- места

  private order(v: View): number[] {
    const i0 = Math.max(0, v.seats.indexOf(this.viewer));
    return v.seats.map((_, k) => v.seats[(i0 + k) % v.seats.length]);
  }

  private anchor(v: View, seat: number): Point {
    const ord = this.order(v);
    const k = ord.indexOf(seat);
    if (k === 0) return { x: 500, y: HAND_Y };
    if (v.seats.length === 3) return k === 1 ? { x: 150, y: 210 } : { x: 850, y: 210 };
    return k === 1 ? { x: 130, y: 260 } : k === 2 ? { x: 500, y: 92 } : { x: 870, y: 260 };
  }

  private faceUp(v: View, seat: number) {
    if (this.ctx.demo) return v.hands[seat].length > 0 || handCount(v, seat) === 0;
    return seat === this.viewer && !this.hidden && this.ctx.mySeats.includes(seat);
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

  // ---------------------------------------------------------------- раскладка

  private playable(v: View): Card[] {
    if (this.actSeat == null || this.hidden) return [];
    if (v.phase === 'play') return legalCards(v, this.actSeat);
    if (v.phase === 'give') return v.hands[this.actSeat];
    return [];
  }

  private layout(v: View): StageItem[] {
    const items: StageItem[] = [];
    // прикуп
    if (v.phase === 'bid') for (let i = 0; i < 3; i++) items.push({ key: `p:${i}`, card: null, x: CENTER.x - 60 + i * 60, y: 250, r: (i - 1) * 6, s: 0.62, z: 5 + i });
    // взятка
    const t = v.trick;
    if (t)
      t.cards.forEach((x, i) => {
        const a = this.anchor(v, x.seat);
        const dx = (a.x - CENTER.x) * 0.22;
        const dy = (a.y - CENTER.y) * 0.22;
        items.push({ key: cardKey(x.card), card: x.card, x: CENTER.x + dx, y: CENTER.y + dy, r: ((i * 23) % 20) - 10, s: 0.8, z: 20 + i });
      });
    // руки
    for (const seat of v.seats) {
      const n = handCount(v, seat);
      if (!n) continue;
      const a = this.anchor(v, seat);
      const up = this.faceUp(v, seat);
      const me = seat === this.viewer;
      const list = up ? sortHand(v.hands[seat], v.trump) : [];
      const playable = me ? this.playable(v) : [];
      for (let k = 0; k < n; k++) {
        if (me) {
          const p = fan(n, k, a.x, a.y, 640, 70, 40, 24);
          if (!up) {
            items.push({ key: `b:${seat}:${k}`, card: null, ...p, s: 1, z: 100 + k });
            continue;
          }
          const c = list[k];
          const sel = this.selected && sameCard(this.selected, c);
          const can = playable.some((x) => sameCard(x, c));
          const cls = this.actSeat != null && (v.phase === 'play' || v.phase === 'give') ? (sel ? 'cs-sel' : can ? 'cs-can' : 'cs-dim') : '';
          items.push({ key: cardKey(c), card: c, x: p.x, y: p.y - (sel ? 30 : 0), r: p.r, s: 1, z: 100 + k, cls, data: { hand: '1', card: c.s + c.r } });
        } else {
          const p = fan(n, k, a.x, a.y, 150, 16, 8, 30);
          items.push(up ? { key: cardKey(list[k]), card: list[k], ...p, s: 0.55, z: 50 + k } : { key: `b:${seat}:${k}`, card: null, ...p, s: 0.55, z: 50 + k });
        }
      }
    }
    return items;
  }

  private draw(enter: Point | null = null, exit: Point | null = null) {
    const v = this.v;
    if (!v) return;
    this.cs.render(this.layout(v), this.ctx.speed(), enter, exit);
    this.drawPlates(v);
    this.drawSheet(v);
  }

  private drawPlates(v: View) {
    let s = '';
    const giving = this.actSeat != null && v.phase === 'give' && this.selected;
    for (const seat of v.seats) {
      const a = this.anchor(v, seat);
      const me = seat === this.viewer;
      const y = me ? a.y - 112 : a.y + 62;
      const marks: string[] = [];
      if (v.scores[seat]) marks.push(`<i>${v.scores[seat]}</i>`);
      if (v.barrel[seat]) marks.push(`<em title="На бочке">🛢${v.barrel[seat]}</em>`);
      if (v.bolts[seat]) marks.push(`<em title="Болты">${'⚬'.repeat(v.bolts[seat])}</em>`);
      if (v.seats.length === 4 && seat === v.dealer && v.phase !== 'over') marks.push('<em>сдаёт</em>');
      if (seat === v.bidder && v.phase !== 'bid') marks.push(`<b>заказ ${v.bid}</b>`);
      if (v.phase === 'bid' && seat === v.bidder) marks.push(`<b>${v.bid}</b>`);
      if (v.phase === 'bid' && v.passed.includes(seat)) marks.push('<em>пас</em>');
      if (v.phase === 'play' && v.players.includes(seat)) marks.push(`<em>${v.roundPts[seat]}</em>`);
      const pick = giving && v.players.includes(seat) && seat !== this.actSeat && !v.given.includes(seat);
      const on = v.turn === seat && v.phase !== 'over';
      s += `<div class="cs-plate${on ? ' on' : ''}${pick ? ' pick' : ''}" style="--c:${SEATS[seat].color};left:${a.x}px;top:${y}px"${pick ? ` data-give="${seat}"` : ''}>${esc(this.plain(seat))} ${marks.join(' ')}</div>`;
    }
    if (v.trump) s += `<div class="th-trump" title="Козырь"><span class="${v.trump === 'H' || v.trump === 'D' ? 'red' : ''}">${SUIT_SYM[v.trump]}</span><small>козырь</small></div>`;
    if (v.phase === 'bid') s += `<div class="th-label" style="left:${CENTER.x}px;top:330px">прикуп</div>`;
    this.plates.innerHTML = s;
  }

  /** «Пулька» — последние строки записи. */
  private drawSheet(v: View) {
    const rows = v.sheet.slice(-6);
    const head = v.seats.map((x) => `<th style="color:${SEATS[x].ink ?? SEATS[x].color}">${esc(this.plain(x)).slice(0, 7)}</th>`).join('');
    const body = rows
      .map((r) => `<tr><td>${r.round}</td>${v.seats.map((x) => `<td class="${x === r.bidder ? (r.made ? 'ok' : 'bad') : ''}">${r.deltas[x] > 0 ? '+' : ''}${r.deltas[x] || '·'}</td>`).join('')}</tr>`)
      .join('');
    const total = `<tr class="sum"><td>Σ</td>${v.seats.map((x) => `<td>${v.scores[x]}</td>`).join('')}</tr>`;
    this.sheet.innerHTML = `<table><tr><th>#</th>${head}</tr>${body}${total}</table>`;
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
    const id = el.dataset.card!;
    const card = v.hands[this.actSeat].find((c) => c.s + c.r === id);
    if (!card) return;
    if (v.phase === 'give') {
      this.selected = this.selected && sameCard(this.selected, card) ? null : card;
      Sound.ui();
      this.draw();
      this.renderButtons();
      return;
    }
    if (v.phase !== 'play' || !legalCards(v, this.actSeat).some((c) => sameCard(c, card))) {
      Sound.nomove();
      return;
    }
    const leading = !v.trick || !v.trick.cards.length;
    if (leading && v.tricksPlayed > 0 && (card.r === 13 || card.r === 12) && marriagesIn(v.hands[this.actSeat]).includes(card.s)) {
      this.askMarriage = card;
      this.selected = card;
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
    this.selected = null;
    this.askMarriage = null;
    this.btns.innerHTML = '';
  }

  private button(text: string, primary: boolean, on: () => void, cls = '') {
    const b = h<HTMLButtonElement>(`<button class="btn ${primary ? 'primary' : ''} ${cls}">${text}</button>`);
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
    const hand = v.hands[seat];
    if (v.phase === 'bid') {
      const max = maxBid(hand);
      const next = v.bid + v.cfg.step;
      this.btns.appendChild(h(`<div class="th-ask">Торговля: сейчас ${v.bid}${v.bidder >= 0 ? ` (${esc(this.plain(v.bidder))})` : ''}. Вам можно до ${max}.</div>`));
      const row = h('<div class="th-row"></div>');
      for (const add of [0, 5, 10, 20]) {
        const val = next + add;
        if (val > max) break;
        const b = h<HTMLButtonElement>(`<button class="btn ${add === 0 ? 'primary' : ''}">${val}</button>`);
        b.onclick = () => this.send({ type: 'bid', value: val });
        row.appendChild(b);
      }
      this.btns.appendChild(row);
      this.button('Пас', false, () => this.send({ type: 'pass' }));
      return;
    }
    if (v.phase === 'give') {
      const left = v.players.filter((x) => x !== seat && !v.given.includes(x));
      this.btns.appendChild(h(`<div class="th-ask">${this.selected ? 'Кому отдать карту?' : 'Выберите карту, которую отдадите'}</div>`));
      if (this.selected) for (const to of left) this.button(`Отдать — ${esc(this.plain(to))}`, true, () => this.send({ type: 'give', to, card: this.selected! }));
      return;
    }
    if (v.phase === 'raise') {
      const max = Math.max(v.bid, maxBid(hand));
      this.btns.appendChild(h(`<div class="th-ask">Заказ ${v.bid}. Поднять?</div>`));
      const row = h('<div class="th-row"></div>');
      for (const add of [0, 10, 20, 30, 50]) {
        const val = v.bid + add;
        if (val > max) break;
        const b = h<HTMLButtonElement>(`<button class="btn ${add === 0 ? 'primary' : ''}">${add ? val : `Играю ${val}`}</button>`);
        b.onclick = () => this.send({ type: 'raise', value: val });
        row.appendChild(b);
      }
      this.btns.appendChild(row);
      return;
    }
    if (v.phase === 'play' && this.askMarriage) {
      const c = this.askMarriage;
      this.btns.appendChild(h(`<div class="th-ask">Объявить марьяж ${SUIT_SYM[c.s]}? (+${MARRIAGE[c.s]}, козырь — ${SUIT_SYM[c.s]})</div>`));
      this.button(`Марьяж! +${MARRIAGE[c.s]}`, true, () => this.send({ type: 'play', card: c, marriage: true }));
      this.button('Просто сходить', false, () => this.send({ type: 'play', card: c }));
      this.button('Отмена', false, () => {
        this.askMarriage = null;
        this.selected = null;
        this.draw();
        this.renderButtons();
      });
    }
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
      if (ev.type === 'play') {
        const cur = this.v!;
        const t = cur.trick && cur.trick.cards.length < cur.players.length ? cur.trick : { leader: ev.seat, cards: [] };
        this.v = {
          ...cur,
          trick: { leader: t.leader, cards: [...t.cards, { seat: ev.seat, card: ev.card }] },
          hands: cur.hands.map((hh, i) => (i === ev.seat ? hh.filter((c) => !sameCard(c, ev.card)) : hh)),
          counts: cur.counts.map((n, i) => (i === ev.seat ? n - 1 : n)),
          trump: ev.trump,
        };
        this.draw(null);
        Sound.card();
        if (ev.marriage) await this.showBanner(`Марьяж ${SUIT_SYM[ev.marriage]}! +${MARRIAGE[ev.marriage]}`, 900 / speed);
        else await sleep(260 / speed);
      } else if (ev.type === 'trick') {
        await sleep(500 / speed);
        const cur = this.v!;
        this.v = { ...cur, trick: null };
        this.draw(null, this.anchor(cur, ev.winner));
        Sound.step();
        await sleep(300 / speed);
      } else if (ev.type === 'prikup') {
        // прикуп открывается и уходит заказчику
        const cur = this.v!;
        this.v = { ...cur, prikup: ev.cards, shown: true, phase: 'give' };
        this.cs.render(
          [...this.layout({ ...cur, phase: 'give' }), ...ev.cards.map((c, i) => ({ key: cardKey(c), card: c, x: CENTER.x - 70 + i * 70, y: 250, r: 0, s: 0.75, z: 30 + i }))],
          speed
        );
        Sound.card();
        await this.showBanner(`${this.plain(ev.seat)} берёт прикуп за ${ev.bid}`, 1200 / speed);
      } else if (ev.type === 'bid' || ev.type === 'pass') {
        Sound.ui();
      } else if (ev.type === 'score') {
        this.v = { ...v, trick: null };
        this.draw();
        await this.showBanner(ev.made ? `Заказ ${ev.bid} сыгран!` : `Заказ ${ev.bid} не сыгран`, 1400 / speed);
      } else if (ev.type === 'deal') {
        Sound.shuffle();
      } else if (ev.type === 'end') {
        Sound.win();
        this.v = v;
        this.draw();
        await this.showBanner(`Тысяча! Победа: ${this.plain(ev.winner)}`, 0);
      }
    }
    this.v = v;
    this.draw({ x: CENTER.x, y: 250 });
  }

  setTurn(toAct: number[], interactive: number[]) {
    this.clearTurn();
    const v = this.v;
    if (!v || v.phase === 'over' || this.ctx.demo) return;
    this.chooseViewer(v, toAct);
    const seat = interactive.find((x) => x === this.viewer) ?? null;
    if (this.hidden && interactive.length && this.ctx.mySeats.length > 1) {
      (this.cover.querySelector('.th-cover-t') as HTMLElement).innerHTML = `Ход: ${this.ctx.name(this.viewer)}.<br><small>Передайте устройство — остальным не подглядывать!</small>`;
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
    if (v.phase === 'over') return v.winner != null ? `Тысяча у ${name(v.winner)}!` : 'Партия окончена';
    const who = toAct[0];
    const mine = interactive.includes(who);
    switch (v.phase) {
      case 'bid':
        return mine ? 'Торгуйтесь: больше или пас?' : `Торгуется ${name(who)}…`;
      case 'give':
        return mine ? 'Отдайте по карте соперникам' : `${name(who)} отдаёт карты…`;
      case 'raise':
        return mine ? 'Поднять заказ?' : `${name(who)} думает над заказом…`;
      default:
        return mine ? 'Ваш ход' : `Ходит ${name(who)}…`;
    }
  }

  playerStats(v: View, seat: number) {
    return `<span title="Очки">${v.scores[seat]}</span>${v.barrel[seat] ? ' · на бочке' : ''}`;
  }

  destroy() {
    this.cs.destroy();
  }
}

export function createView(): GameView<View, Event> {
  return new ThousandView();
}
