/* Очко — отрисовка: банкир (дилер) с банком сверху, понтёры дугой внизу. Карты понтёров в очке — втёмную, свои видно;
 * под рукой — ставка, сумма и чем кончилось. Кнопки: ставка (− / + / фишки / «на весь банк»), «Ещё» / «Хватит»,
 * в блэкджеке — «Удвоить», «Разделить», «Сдаться», страховка. */
import { Sound } from '../../core/audio';
import { esc, h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { preloadDeck, deckStyle } from '../../cards/render';
import { CardStage, cardKey, type Point, type StageItem } from '../../cards/stage';
import type { Card } from '../../cards/deck';
import { BJ_MIN, betRange, canDo, total, type Event, type Hand, type View } from './engine';
import { RES_TEXT, SEATS, rub } from './def';
import './ochko.css';

class OchkoView implements GameView<View, Event> {
  private ctx!: ViewCtx;
  private cs!: CardStage;
  private plates!: HTMLElement;
  private banner!: HTMLElement;
  private btns!: HTMLElement;
  private v: View | null = null;
  private viewer = 0;
  private mine: number[] = [];
  private betN = 0;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    preloadDeck(deckStyle());
    this.cs = new CardStage(root, 1000, 720, 'ok-wrap', '<div class="ok-cloth"><div class="ok-arc">ДВАДЦАТЬ ОДНО · ВЕЧЕРОМ НА ЛАВОЧКЕ</div></div>', { portrait: { W: 540, H: 900 } });
    this.cs.onMode = () => this.draw();
    this.cs.over.innerHTML = '<div class="ok-plates"></div><div class="cs-banner" hidden></div>';
    this.plates = this.cs.over.querySelector('.ok-plates') as HTMLElement;
    this.banner = this.cs.over.querySelector('.cs-banner') as HTMLElement;
    if (ctx.demo) return;
    const ctl = h(`<div class="ok-controls"><div class="ok-btns"></div></div>`);
    ctx.controls.appendChild(ctl);
    this.btns = ctl.querySelector('.ok-btns') as HTMLElement;
  }

  // ---------------------------------------------------------------- места

  private get port() {
    return this.cs.portrait;
  }

  private get W() {
    return this.port ? 540 : 1000;
  }

  private get dealerPt(): Point {
    return this.port ? { x: 270, y: 150 } : { x: 500, y: 130 };
  }

  private get shoe(): Point {
    return this.port ? { x: 470, y: 90 } : { x: 860, y: 110 };
  }

  private get bin(): Point {
    return this.port ? { x: 70, y: 90 } : { x: 140, y: 110 };
  }

  /** Понтёры: все, кроме банкира, по кругу слева от него (в блэкджеке — по порядку мест). */
  private punters(v: View): number[] {
    const b = v.banker == null ? -1 : v.seats.indexOf(v.banker);
    const list = v.seats.map((_, k) => v.seats[(b + 1 + k) % v.seats.length]).filter((p) => p !== v.banker);
    // свои карты — посередине дуги
    const me = list.indexOf(this.viewer);
    if (me < 0 || !this.ctx.mySeats.includes(this.viewer)) return list;
    const shift = (me - Math.floor((list.length - 1) / 2) + list.length) % list.length;
    return [...list.slice(shift), ...list.slice(0, shift)];
  }

  private spot(v: View, seat: number): { p: Point; s: number } {
    const list = this.punters(v);
    const n = list.length;
    const k = list.indexOf(seat);
    if (this.port) {
      if (seat === this.viewer && this.ctx.mySeats.includes(seat)) return { p: { x: 270, y: 730 }, s: 0.85 };
      const others = list.filter((p) => !(p === this.viewer && this.ctx.mySeats.includes(p)));
      const j = others.indexOf(seat);
      const m = others.length;
      const two = m > 3;
      const row = two && j >= Math.ceil(m / 2) ? 1 : 0;
      const inRow = two ? (row ? m - Math.ceil(m / 2) : Math.ceil(m / 2)) : m;
      const jj = row ? j - Math.ceil(m / 2) : j;
      const x = inRow === 1 ? 270 : 95 + (350 * jj) / (inRow - 1);
      return { p: { x, y: two ? 380 + row * 170 : 470 }, s: 0.66 };
    }
    const t = n === 1 ? 0.5 : k / (n - 1);
    const span = Math.min(760, 230 * (n - 1));
    const x = 500 - span / 2 + span * t;
    const y = 545 - Math.pow(2 * t - 1, 2) * (n > 2 ? 120 : 40);
    return { p: { x, y }, s: seat === this.viewer && this.ctx.mySeats.includes(seat) ? 0.9 : 0.76 };
  }

  private handItems(cards: Card[], key: string, p: Point, s: number, z: number, items: StageItem[], from: Point) {
    const step = 44 * s;
    cards.forEach((c, i) => {
      const x = p.x + (i - (cards.length - 1) / 2) * step;
      const y = p.y + (i % 2) * 2;
      items.push(c.r ? { key: cardKey(c), card: c, x, y, r: (i - (cards.length - 1) / 2) * 2, s, z: z + i, fromPt: from } : { key: `${key}:${i}`, card: null, x, y, r: 0, s, z: z + i, fromPt: from });
    });
  }

  private layout(v: View): StageItem[] {
    const items: StageItem[] = [];
    const d = this.dealerPt;
    this.handItems(v.dealer, 'd', d, this.port ? 0.78 : 0.82, 10, items, this.shoe);
    for (const seat of this.punters(v)) {
      const { p, s } = this.spot(v, seat);
      const hs = v.hands[seat];
      hs.forEach((hd, k) => {
        const off = hs.length > 1 ? (k - 0.5) * (this.port ? 120 : 130) * s : 0;
        this.handItems(hd.cards, `h:${seat}:${k}`, { x: p.x + off, y: p.y }, s, 30 + k * 10, items, this.shoe);
      });
    }
    // колода-шуз
    for (let k = 0; k < 3; k++) items.push({ key: `shoe:${k}`, card: null, x: this.shoe.x - k * 1.5, y: this.shoe.y - k * 2.5, r: 0, s: 0.55, z: 2 + k });
    return items;
  }

  private label(v: View, hd: Hand): string {
    if (hd.res) return `<i class="ok-res ok-${hd.res}">${RES_TEXT[hd.res]}</i>`;
    if (!hd.cards.length || hd.cards.some((c) => !c.r)) return '';
    const t = total(v.cfg, hd.cards);
    return `<i>${t.soft && t.n < 21 && v.cfg.bj ? `${t.n - 10}/${t.n}` : t.n}</i>`;
  }

  private draw(exit: Point | null = null) {
    const v = this.v;
    if (!v) return;
    this.cs.render(this.layout(v), this.ctx.speed(), null, exit);
    const d = this.dealerPt;
    let html = '';
    // банкир / дилер
    const dealerTot = v.dealer.length && v.dealer.every((c) => c.r) ? total(v.cfg, v.dealer).n : null;
    const dt = dealerTot != null ? ` <i>${dealerTot > 21 && !(v.dealer.length === 2 && v.dealer.every((c) => c.r === 14) && !v.cfg.bj) ? 'перебор' : dealerTot}</i>` : '';
    const bOn = v.phase === 'dealer' && v.banker != null && !v.over;
    if (v.banker != null) {
      html += `<div class="cs-plate ok-banker${bOn ? ' on' : ''}" style="--c:${SEATS[v.banker].color};left:${d.x}px;top:${d.y + (this.port ? 70 : 72)}px">🏦 ${esc(this.plain(v.banker))} <b>${v.money[v.banker]}</b>${dt}</div>`;
      html += `<div class="ok-bank" style="left:${d.x}px;top:${d.y + (this.port ? 128 : 130)}px"><span class="ok-chip"></span>Банк <b>${v.bank}</b>${v.stuk ? ' · <em>стук</em>' : ''}</div>`;
    } else html += `<div class="cs-plate ok-banker" style="--c:#333;left:${d.x}px;top:${d.y + 72}px">Дилер${dt}</div>`;
    for (const seat of this.punters(v)) {
      const { p, s } = this.spot(v, seat);
      const hs = v.hands[seat];
      const on = v.turn === seat && !v.over;
      const broke = v.broke.includes(seat);
      html += `<div class="cs-plate${on ? ' on' : ''}${broke ? ' ok-broke' : ''}" style="--c:${SEATS[seat].color};left:${Math.max(70, Math.min(this.W - 70, p.x))}px;top:${p.y + 78 * s + 8}px">${esc(this.plain(seat))} <b>${v.money[seat]}</b></div>`;
      hs.forEach((hd, k) => {
        const off = hs.length > 1 ? (k - 0.5) * (this.port ? 120 : 130) * s : 0;
        const bet = hd.bet ? `<span class="ok-chip"></span>${hd.bet}${hd.doubled ? '×2' : ''}` : '';
        const lab = this.label(v, hd);
        if (bet || lab) html += `<div class="ok-tag${on && v.hi === k && hs.length > 1 ? ' ok-cur' : ''}" style="left:${p.x + off}px;top:${p.y - 78 * s - 30}px">${bet} ${lab}</div>`;
      });
    }
    html += `<div class="ok-deal" style="left:${this.shoe.x}px;top:${this.shoe.y + 52}px">сдача ${v.deal}${v.cfg.bj ? ' из ' + v.cfg.length : ''}</div>`;
    this.plates.innerHTML = html;
  }

  private plain(seat: number) {
    return this.ctx.name(seat).replace(/<[^>]+>/g, '');
  }

  // ---------------------------------------------------------------- ход

  private send(seat: number, a: Parameters<ViewCtx['act']>[1]) {
    Sound.unlock();
    this.mine = [];
    if (this.btns) this.btns.innerHTML = '';
    this.ctx.act(seat, a);
  }

  private button(text: string, cls: string, fn: () => void, disabled = false) {
    const b = h<HTMLButtonElement>(`<button class="btn ${cls}">${text}</button>`);
    b.disabled = disabled;
    b.onclick = fn;
    this.btns.appendChild(b);
    return b;
  }

  private betUI(v: View, seat: number) {
    const { min, max } = betRange(v, seat);
    const step = v.cfg.bj ? BJ_MIN : 1;
    if (!this.betN) this.betN = v.cfg.bj ? 10 : Math.max(1, Math.round(max / 4));
    this.betN = Math.max(min, Math.min(max, this.betN));
    const box = h(`<div class="ok-bet">
      <div class="ok-bet-row"><button class="btn small" data-d="-1">−</button><b class="ok-bet-n"></b><button class="btn small" data-d="1">+</button></div>
      <div class="ok-bet-row ok-chips"></div></div>`);
    const nEl = box.querySelector('.ok-bet-n') as HTMLElement;
    const upd = () => (nEl.textContent = rub(this.betN));
    upd();
    box.querySelectorAll<HTMLButtonElement>('[data-d]').forEach((b) => {
      b.onclick = () => {
        this.betN = Math.max(min, Math.min(max, this.betN + Number(b.dataset.d) * step));
        upd();
      };
    });
    const chips = box.querySelector('.ok-chips') as HTMLElement;
    const quick = v.cfg.bj ? [5, 10, 25, 50] : [1, 5, 10, 20];
    for (const q of quick.filter((x) => x <= max)) {
      const c = h<HTMLButtonElement>(`<button class="btn small ok-q">${q}</button>`);
      c.onclick = () => {
        this.betN = q;
        upd();
      };
      chips.appendChild(c);
    }
    this.btns.appendChild(box);
    this.button('Ставлю', 'primary', () => this.send(seat, { type: 'bet', n: this.betN }));
    this.button(v.cfg.bj ? `Всё — ${max}` : `На весь банк — ${max}`, '', () => this.send(seat, { type: 'bet', n: max }));
  }

  setTurn(toAct: number[], interactive: number[]) {
    const v = this.v;
    this.mine = v && !v.over && !this.ctx.demo ? interactive.slice() : [];
    const my = this.ctx.mySeats.filter((x) => v?.seats.includes(x));
    if (my.length && !my.includes(this.viewer)) this.viewer = my[0];
    if (this.mine.length && v?.banker !== this.mine[0]) this.viewer = this.mine[0];
    if (!this.btns) return this.draw();
    this.btns.innerHTML = '';
    const seat = this.mine[0];
    if (v && seat != null) {
      if (v.phase === 'bet') this.betUI(v, seat);
      else if (v.phase === 'insure') {
        this.button('Застраховаться', '', () => this.send(seat, { type: 'insure', yes: true }), v.money[seat] < 1);
        this.button('Без страховки', 'primary', () => this.send(seat, { type: 'insure', yes: false }));
      } else if (v.phase === 'play' || v.phase === 'dealer') {
        this.button('Ещё', 'primary', () => this.send(seat, { type: 'hit' }));
        this.button('Хватит', '', () => this.send(seat, { type: 'stand' }));
        if (v.cfg.bj && v.phase === 'play') {
          const can = canDo(v, seat);
          if (can.double) this.button('Удвоить', '', () => this.send(seat, { type: 'double' }));
          if (can.split) this.button('Разделить пару', '', () => this.send(seat, { type: 'split' }));
          if (can.surrender) this.button('Сдаться (½)', '', () => this.send(seat, { type: 'surrender' }));
        }
      }
    }
    this.draw();
  }

  setView(v: View) {
    this.v = v;
    const my = this.ctx.mySeats.filter((x) => v.seats.includes(x));
    if (my.length && !my.includes(this.viewer)) this.viewer = my[0];
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

  private patchHand(seat: number, k: number, f: (h: Hand) => Hand) {
    const cur = this.v!;
    const hs = cur.hands[seat].slice();
    hs[k] = f(hs[k] ?? { cards: [], bet: 0, done: false, open: true });
    this.v = { ...cur, hands: cur.hands.map((x, i) => (i === seat ? hs : x)) };
  }

  async play(events: Event[], v: View) {
    const sp = this.ctx.speed();
    const wait = (ms: number) => sleep(ms / sp);
    for (const ev of events) {
      const cur = this.v!;
      switch (ev.type) {
        case 'deal': {
          // дать разглядеть итог прошлой сдачи
          if (cur.dealer.length) await wait(1500);
          this.v = { ...cur, hands: cur.hands.map(() => []), dealer: [], dealerOpen: false, banker: ev.banker, stuk: ev.stuk, deal: ev.n, phase: 'bet', turn: null };
          this.draw(this.bin);
          await wait(350);
          for (let i = 0; i < ev.seats.length; i++) {
            this.patchHand(ev.seats[i], 0, (x) => ({ ...x, cards: ev.cards[i] ? [ev.cards[i]] : [], open: cur.cfg.bj }));
            if (ev.cards[i]) {
              this.draw();
              Sound.card();
              await wait(180);
            }
          }
          if (ev.dealer.length) {
            this.v = { ...this.v!, dealer: ev.dealer.slice() };
            this.draw();
            Sound.card();
            await wait(250);
          }
          break;
        }
        case 'bet':
          this.patchHand(ev.seat, 0, (x) => ({ ...x, bet: ev.n }));
          this.v = { ...this.v!, money: this.v!.money.map((m, i) => (i === ev.seat ? m - ev.n : m)) };
          this.draw();
          Sound.ui();
          await wait(250);
          break;
        case 'double':
          this.patchHand(ev.seat, ev.hand, (x) => ({ ...x, bet: x.bet * 2, doubled: true }));
          this.draw();
          await wait(200);
          break;
        case 'split': {
          const hd = cur.hands[ev.seat][0];
          const two: Hand[] = [
            { ...hd, cards: [hd.cards[0]] },
            { ...hd, cards: [hd.cards[1]] },
          ];
          this.v = { ...cur, hands: cur.hands.map((x, i) => (i === ev.seat ? two : x)), money: cur.money.map((m, i) => (i === ev.seat ? m - hd.bet : m)) };
          this.draw();
          await wait(350);
          break;
        }
        case 'card':
          this.patchHand(ev.seat, ev.hand, (x) => ({ ...x, cards: [...x.cards, ev.card] }));
          this.draw();
          Sound.card();
          await wait(300);
          break;
        case 'dcard':
          this.v = { ...cur, dealer: [...cur.dealer, ev.card] };
          this.draw();
          Sound.card();
          await wait(380);
          break;
        case 'reveal':
          this.patchHand(ev.seat, ev.hand, (x) => ({ ...x, cards: ev.cards.slice(), open: true }));
          this.draw();
          await wait(300);
          break;
        case 'dreveal':
          this.v = { ...cur, dealer: ev.cards.slice(), dealerOpen: true, phase: 'dealer', turn: null };
          this.draw();
          Sound.card();
          await wait(450);
          break;
        case 'settle': {
          if (ev.res === 'skip') break;
          this.patchHand(ev.seat, ev.hand, (x) => ({ ...x, res: ev.res, paid: ev.paid, open: true, done: true }));
          const bank = cur.cfg.bj ? cur.bank : cur.bank + ev.bet - ev.paid;
          this.v = { ...this.v!, bank, money: this.v!.money.map((m, i) => (i === ev.seat ? m + ev.paid : m)) };
          this.draw();
          if (ev.res === 'golden' || ev.res === 'bj') {
            Sound.win();
            await this.showBanner(ev.res === 'golden' ? `${this.plain(ev.seat)}: золотое очко!` : `${this.plain(ev.seat)}: блэкджек!`, 1100 / sp);
          } else {
            if (ev.paid > ev.bet) Sound.step();
            await wait(ev.res === 'bust' ? 600 : 350);
          }
          break;
        }
        case 'dtotal':
          if (ev.golden || ev.bj) await this.showBanner(ev.golden ? 'У банкира два туза!' : 'У дилера блэкджек!', 1100 / sp);
          else await wait(300);
          break;
        case 'stuk':
          this.v = { ...cur, stuk: true };
          this.draw();
          Sound.ui();
          await this.showBanner(`${this.plain(ev.seat)}: «Стук!»`, 1000 / sp);
          break;
        case 'banker':
          await wait(700);
          this.v = {
            ...cur,
            banker: ev.seat,
            bank: ev.bank,
            stuk: false,
            money: cur.money.map((m, i) => m + (i === ev.prev ? ev.took : 0) - (i === ev.seat ? ev.bank : 0)),
          };
          this.draw();
          await this.showBanner(`Банкует ${this.plain(ev.seat)}`, 1100 / sp);
          break;
        case 'broke':
          this.v = { ...cur, broke: [...cur.broke, ev.seat] };
          this.draw();
          await this.showBanner(`${this.plain(ev.seat)} проигрался`, 900 / sp);
          break;
        case 'end':
          await wait(600);
          Sound.win();
          this.v = v;
          this.draw();
          await this.showBanner(`Победил ${this.plain(ev.winner)} — ${rub(ev.money[ev.winner])}`, 0);
          break;
      }
    }
    this.v = v;
    this.draw();
  }

  status(v: View, toAct: number[], interactive: number[]) {
    if (v.over) return v.winner != null ? `Победил ${this.ctx.name(v.winner)}` : 'Партия окончена';
    const who = toAct[0];
    if (who == null) return '';
    const mine = interactive.includes(who);
    if (v.phase === 'dealer') return mine ? 'Вы банкир: ещё или хватит?' : `Банкир ${this.ctx.name(who)} добирает`;
    if (v.phase === 'bet') return mine ? (v.cfg.bj ? 'Сделайте ставку' : 'Посмотрите карту и сделайте ставку') : `${this.ctx.name(who)} ставит`;
    if (v.phase === 'insure') return mine ? 'У дилера туз: страховаться?' : `${this.ctx.name(who)} думает о страховке`;
    return mine ? 'Ещё или хватит?' : `${this.ctx.name(who)} берёт карты`;
  }

  playerStats(v: View, seat: number) {
    if (v.broke.includes(seat)) return 'проигрался';
    return `${rub(v.money[seat])}${v.banker === seat ? ` · банк ${v.bank}` : ''}`;
  }

  destroy() {
    this.cs.destroy();
  }
}

export function createView(): GameView<View, Event> {
  return new OchkoView();
}
