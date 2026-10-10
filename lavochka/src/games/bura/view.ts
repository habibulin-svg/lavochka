/* Бура — отрисовка: клеёнка, колода с козырем поперёк, заход и ответы в центре (скинутое — рубашкой), взятки — стопкой у игрока.
 * Выбираете карты нажатием (заход — одной масти), потом кнопка «Зайти», «Побить» или «Скинуть». На своём заходе — «Вскрываюсь!». */
import { Sound } from '../../core/audio';
import { esc, h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { preloadDeck } from '../../cards/render';
import { settings } from '../../core/settings';
import { sameCard, sortHand, SUIT_SYM, type Card } from '../../cards/deck';
import { CardStage, cardKey, fan, type Point, type StageItem } from '../../cards/stage';
import { covers, deckLeft, handCount, isBura, isMoscow, type Event, type View } from './engine';
import { SEATS } from './def';
import './bura.css';

/** Геометрия стола: альбомная 1000×720 и вертикальная для телефона 540×900. */
const LAND = { port: false, W: 1000, hand: { x: 520, y: 606 }, hs: 1.1, center: { x: 520, y: 318 }, cs: 1.1, deck: { x: 116, y: 330 }, ds: 1.1, os: 0.62, skip: { x: 790, y: 290 } };
const PORT = { port: true, W: 540, hand: { x: 270, y: 790 }, hs: 1.1, center: { x: 280, y: 480 }, cs: 1.1, deck: { x: 92, y: 268 }, ds: 1.1, os: 0.55, skip: { x: 440, y: 268 } };
type Geo = typeof LAND;

class BuraView implements GameView<View, Event> {
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

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    preloadDeck(settings.deck);
    this.cs = new CardStage(root, 1000, 720, 'br-wrap', '<div class="br-cloth"></div>', { portrait: { W: 540, H: 900 } });
    this.cs.onMode = () => this.draw();
    this.cs.over.innerHTML = '<div class="br-plates"></div><div class="cs-banner" hidden></div>';
    this.plates = this.cs.over.querySelector('.br-plates') as HTMLElement;
    this.banner = this.cs.over.querySelector('.cs-banner') as HTMLElement;
    this.cover = h('<div class="cs-cover" hidden><div class="cs-cover-box"><div class="br-cover-t"></div><button class="btn primary">Показать карты</button></div></div>');
    this.cs.stage.appendChild(this.cover);
    (this.cover.querySelector('button') as HTMLButtonElement).onclick = () => {
      Sound.unlock();
      this.hidden = false;
      this.cover.hidden = true;
      this.draw();
      this.renderButtons();
    };
    const ctl = h(`<div class="br-controls"><div class="br-btns"></div>${ctx.demo ? '' : '<div class="hint small-hint">Выберите карты (заход — одной масти), потом нажмите кнопку.</div>'}</div>`);
    ctx.controls.appendChild(ctl);
    this.btns = ctl.querySelector('.br-btns') as HTMLElement;
    this.cs.stage.addEventListener('click', (e) => this.onClick(e));
  }

  // ---------------------------------------------------------------- места

  private order(v: View): number[] {
    const i0 = Math.max(0, v.seats.indexOf(this.viewer));
    return v.seats.map((_, k) => v.seats[(i0 + k) % v.seats.length]);
  }

  private get g(): Geo {
    return this.cs.portrait ? PORT : LAND;
  }

  private anchor(v: View, seat: number): Point {
    const k = this.order(v).indexOf(seat);
    const n = v.seats.length;
    if (k === 0) return this.g.hand;
    if (this.g.port) {
      if (n === 2) return { x: 270, y: 82 };
      if (n === 3) return k === 1 ? { x: 140, y: 82 } : { x: 400, y: 82 };
      return k === 1 ? { x: 92, y: 96 } : k === 2 ? { x: 270, y: 76 } : { x: 448, y: 96 };
    }
    if (n === 2) return { x: 520, y: 92 };
    if (n === 3) return k === 1 ? { x: 300, y: 100 } : { x: 740, y: 100 };
    return k === 1 ? { x: 230, y: 120 } : k === 2 ? { x: 520, y: 92 } : { x: 810, y: 120 };
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
    if (this.ctx.demo) return v.hands[seat].length > 0 || handCount(v, seat) === 0;
    return seat === this.viewer && !this.hidden && this.ctx.mySeats.includes(seat);
  }

  // ---------------------------------------------------------------- раскладка

  private layout(v: View): StageItem[] {
    const g = this.g;
    const CENTER = g.center;
    const DECK = g.deck;
    const items: StageItem[] = [];
    const dl = deckLeft(v);
    if (dl > 0) items.push({ key: cardKey(v.trumpCard), card: v.trumpCard, x: DECK.x + 40 * g.ds, y: DECK.y, r: 90, s: g.ds, z: 1 });
    if (dl > 1) items.push({ key: 'deck', card: null, x: DECK.x, y: DECK.y - Math.min(8, dl / 4), r: 0, s: g.ds, z: 2, cls: 'br-deck' });
    // заход и ответы
    if (v.lead) {
      const k = v.lead.cards.length;
      const row = (cs: Card[], dy: number, z: number, dx = 0) =>
        cs.forEach((c, i) => items.push({ key: cardKey(c), card: c, x: CENTER.x + (i - (k - 1) / 2) * 98 * g.cs + dx, y: CENTER.y + dy, r: (i - (k - 1) / 2) * 3, s: g.cs, z: z + i }));
      row(v.lead.cards, -22, 20);
      v.answers.forEach((a, j) => {
        if (a.beat) row(a.cards, 18 + j * 16, 30 + j * 4, 14 + j * 6);
        else
          for (let i = 0; i < k; i++) {
            const c = a.cards[i];
            items.push({ key: c ? `sk:${cardKey(c)}` : `sk:${a.seat}:${i}`, card: null, x: g.skip.x + i * 14, y: g.skip.y + j * 30, r: 12 + i * 4, s: g.cs, z: 15 + i });
          }
      });
    }
    // руки
    for (const seat of v.seats) {
      const n = handCount(v, seat);
      const a = this.anchor(v, seat);
      const me = seat === this.viewer;
      const up = this.faceUp(v, seat);
      const list = up ? sortHand(v.hands[seat], v.trump) : [];
      for (let k = 0; k < n; k++) {
        if (me) {
          const p = fan(n, k, a.x, a.y, g.port ? 300 : 300, g.port ? 104 : 110, 20, 12);
          if (!up) {
            items.push({ key: `b:${seat}:${k}`, card: null, ...p, s: g.hs, z: 100 + k });
            continue;
          }
          const c = list[k];
          const sel = this.selected.some((x) => sameCard(x, c));
          const cls = this.actSeat != null ? (sel ? 'cs-sel' : 'cs-can') : '';
          items.push({ key: cardKey(c), card: c, x: p.x, y: p.y - (sel ? 30 : 0), r: p.r, s: g.hs, z: 100 + k, cls, data: { hand: c.s + c.r } });
        } else {
          const p = fan(n, k, a.x, a.y, 70, 30, 6, 16);
          items.push(up ? { key: cardKey(list[k]), card: list[k], ...p, s: g.os, z: 50 + k } : { key: `b:${seat}:${k}`, card: null, ...p, s: g.os, z: 50 + k });
        }
      }
      // взятки стопкой
      if (v.tricks[seat]) {
        const px = g.port ? (me ? 478 : Math.min(g.W - 40, a.x + 80)) : me ? a.x + 250 : a.x + 110;
        const py = g.port ? (me ? a.y - 150 : a.y + 6) : me ? a.y - 10 : a.y;
        items.push({ key: `pile:${seat}`, card: null, x: px, y: py, r: 80, s: 0.5, z: 40, cls: 'br-pile' });
      }
    }
    return items;
  }

  private draw(enter: Point | null = null, exit: Point | null = null) {
    const v = this.v;
    if (!v) return;
    this.cs.render(this.layout(v), this.ctx.speed(), enter, exit);
    const g = this.g;
    let s = '';
    for (const seat of v.seats) {
      const a = this.anchor(v, seat);
      const me = seat === this.viewer;
      const y = me ? a.y - 78 * g.hs - 46 : a.y + (g.port ? 48 : 62);
      const marks: string[] = [];
      if (v.palki[seat]) marks.push(`<i title="Палки">${'|'.repeat(Math.min(v.palki[seat], 16))} ${v.palki[seat]}</i>`);
      if (v.tricks[seat]) marks.push(`<em>взяток ${v.tricks[seat]}</em>`);
      if (v.pts[seat] >= 0) marks.push(`<b title="Очки во взятках">${v.pts[seat]}</b>`);
      const on = v.turn === seat && v.phase !== 'over';
      const x = g.port && !me ? Math.max(80, Math.min(g.W - 80, a.x)) : a.x;
      s += `<div class="cs-plate${on ? ' on' : ''}" style="--c:${SEATS[seat].color};left:${x}px;top:${y}px">${esc(this.plain(seat))} ${marks.join(' ')}</div>`;
    }
    s += `<div class="br-trump" style="left:${g.deck.x - 40}px;top:${g.deck.y + 110 * g.ds}px" title="Козырь"><span class="${v.trump === 'H' || v.trump === 'D' ? 'red' : ''}">${SUIT_SYM[v.trump]}</span><small>${deckLeft(v) ? `в колоде ${deckLeft(v)}` : 'козырь'}</small></div>`;
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
      if (v.phase === 'lead' && this.selected.length && this.selected[0].s !== card.s) this.selected = [];
      const k = v.phase === 'answer' ? v.lead!.cards.length : 3;
      if (this.selected.length >= k) this.selected.shift();
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

  private button(text: string, primary: boolean, on: () => void, disabled = false) {
    const b = h<HTMLButtonElement>(`<button class="btn ${primary ? 'primary' : ''}"${disabled ? ' disabled' : ''}>${text}</button>`);
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
    if (v.phase === 'lead') {
      if (isBura(hand, v.trump)) this.button('Бура! Показать', true, () => this.send({ type: 'show', kind: 'bura' }));
      if (v.cfg.moscow && isMoscow(hand)) this.button('Москва! Показать', true, () => this.send({ type: 'show', kind: 'moscow' }));
      this.button(this.selected.length ? `Зайти (${this.selected.length})` : 'Выберите карты для захода', !!this.selected.length, () => this.send({ type: 'lead', cards: this.selected }), !this.selected.length);
      this.button('«Вскрываюсь!» — у меня 31', false, () => this.send({ type: 'declare' }));
      return;
    }
    const k = v.lead!.cards.length;
    const ready = this.selected.length === k;
    this.btns.appendChild(h(`<div class="br-ask">Нужно ${k} ${k === 1 ? 'карта' : 'карты'}: выбрано ${this.selected.length}</div>`));
    const canBeat = ready && covers(this.selected, v.best!.cards, v.trump);
    this.button('Побить', true, () => this.send({ type: 'beat', cards: this.selected }), !canBeat);
    this.button('Скинуть втёмную', false, () => this.send({ type: 'skip', cards: this.selected }), !ready);
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
      if (ev.type === 'lead') {
        this.v = { ...cur, lead: { seat: ev.seat, cards: ev.cards }, best: { seat: ev.seat, cards: ev.cards }, answers: [], hands: drop(cur.hands, ev.seat, ev.cards), counts: dec(cur.counts, ev.seat, ev.cards.length) };
        this.draw();
        Sound.card();
        await sleep(350 / speed);
      } else if (ev.type === 'beat' || ev.type === 'skip') {
        const cards = ev.type === 'beat' ? ev.cards : (ev.cards ?? []);
        const n = ev.type === 'beat' ? ev.cards.length : ev.count;
        this.v = {
          ...cur,
          answers: [...cur.answers, { seat: ev.seat, beat: ev.type === 'beat', cards }],
          best: ev.type === 'beat' ? { seat: ev.seat, cards: ev.cards } : cur.best,
          hands: drop(cur.hands, ev.seat, cards),
          counts: dec(cur.counts, ev.seat, n),
        };
        this.draw();
        Sound.card();
        await sleep(350 / speed);
      } else if (ev.type === 'take') {
        await sleep(450 / speed);
        this.v = { ...cur, lead: null, best: null, answers: [], tricks: cur.tricks.map((t, i) => (i === ev.seat ? t + 1 : t)) };
        this.draw(null, this.anchor(cur, ev.seat));
        Sound.step();
        await sleep(250 / speed);
      } else if (ev.type === 'declare') {
        Sound.ui();
        await this.showBanner(ev.ok ? `«Вскрываюсь!» — ${ev.pts}` : `Ошибка: всего ${ev.pts}`, 1300 / speed);
      } else if (ev.type === 'show') {
        Sound.win();
        await this.showBanner(ev.kind === 'bura' ? 'Бура!' : 'Москва!', 1300 / speed);
      } else if (ev.type === 'round') {
        await this.showBanner(ev.winner != null ? `Кон за ${this.plain(ev.winner)}` : 'Кон окончен', 1200 / speed);
      } else if (ev.type === 'deal') Sound.shuffle();
      else if (ev.type === 'end') {
        Sound.win();
        this.v = v;
        this.draw();
        await this.showBanner(`Проиграл: ${this.plain(ev.loser)}`, 0);
      }
    }
    this.v = v;
    this.draw(this.g.deck);
  }

  setTurn(toAct: number[], interactive: number[]) {
    this.clearTurn();
    const v = this.v;
    if (!v || v.phase === 'over' || this.ctx.demo) return;
    this.chooseViewer(v, toAct);
    const seat = interactive.find((x) => x === this.viewer) ?? null;
    if (this.hidden && interactive.length && this.ctx.mySeats.length > 1) {
      (this.cover.querySelector('.br-cover-t') as HTMLElement).innerHTML = `Ход: ${this.ctx.name(this.viewer)}.<br><small>Передайте устройство — остальным не подглядывать!</small>`;
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
    if (v.phase === 'over') return v.loser != null ? `Проиграл ${name(v.loser)}` : 'Партия окончена';
    const who = toAct[0];
    const mine = interactive.includes(who);
    if (v.phase === 'lead') return mine ? 'Ваш заход' : `Заходит ${name(who)}…`;
    return mine ? 'Бейте или скидывайте' : `Отвечает ${name(who)}…`;
  }

  playerStats(v: View, seat: number) {
    return `палки: ${v.palki[seat]}`;
  }

  destroy() {
    this.cs.destroy();
  }
}

const drop = (hands: Card[][], seat: number, cs: Card[]) => hands.map((hh, i) => (i === seat ? hh.filter((c) => !cs.some((x) => sameCard(x, c))) : hh));
const dec = (counts: number[], seat: number, n: number) => counts.map((c, i) => (i === seat ? c - n : c));

export function createView(): GameView<View, Event> {
  return new BuraView();
}
