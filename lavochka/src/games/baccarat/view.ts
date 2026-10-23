/* Баккара — отрисовка: сукно с полями «Игрок» и «Банкир», шуз в углу, карты раздаются по одной (третья — поперёк, как в казино);
 * сидящие — дугой внизу, у каждого деньги и ставка. Кнопки: ставка (сторона, сумма), «Банко!», карта/хватит, держать банк. */
import { Sound } from '../../core/audio';
import { esc, h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { preloadDeck, deckStyle } from '../../cards/render';
import { CardStage, type Point, type StageItem } from '../../cards/stage';
import type { Card } from '../../cards/deck';
import { bankChoices, betRange, MIN_BET, total, uncovered, type Event, type Side, type View } from './engine';
import { SEATS, SIDE, SIDE_ON } from './def';
import './baccarat.css';

class BaccaratView implements GameView<View, Event> {
  private ctx!: ViewCtx;
  private cs!: CardStage;
  private plates!: HTMLElement;
  private banner!: HTMLElement;
  private btns!: HTMLElement;
  private v: View | null = null;
  private actSeat: number | null = null;
  private side: Side = 'B';
  private amount = 0;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    preloadDeck(deckStyle());
    this.cs = new CardStage(
      root,
      1000,
      720,
      'bc-wrap',
      `<div class="bc-cloth"><div class="bc-box bc-p"><span>ИГРОК</span></div><div class="bc-box bc-b"><span>БАНКИР</span></div><div class="bc-arc"></div></div>`,
      { portrait: { W: 540, H: 900 } }
    );
    this.cs.onMode = () => this.draw();
    this.cs.over.innerHTML = '<div class="bc-plates"></div><div class="cs-banner" hidden></div>';
    this.plates = this.cs.over.querySelector('.bc-plates') as HTMLElement;
    this.banner = this.cs.over.querySelector('.cs-banner') as HTMLElement;
    if (ctx.demo) return;
    const ctl = h('<div class="bc-controls"><div class="bc-btns"></div></div>');
    ctx.controls.appendChild(ctl);
    this.btns = ctl.querySelector('.bc-btns') as HTMLElement;
  }

  // ---------------------------------------------------------------- места

  private get port() {
    return this.cs.portrait;
  }

  private handPt(hand: 'P' | 'B'): Point {
    if (this.port) return { x: hand === 'P' ? 140 : 400, y: 300 };
    return { x: hand === 'P' ? 320 : 680, y: 270 };
  }

  private get shoe(): Point {
    return this.port ? { x: 470, y: 90 } : { x: 900, y: 100 };
  }

  private seatPt(v: View, seat: number): Point {
    const list = v.seats;
    const n = list.length;
    const k = list.indexOf(seat);
    if (this.port) {
      const cols = Math.min(3, n);
      const row = Math.floor(k / cols);
      const inRow = row === Math.floor((n - 1) / cols) ? n - row * cols : cols;
      const j = k - row * cols;
      return { x: inRow === 1 ? 270 : 90 + (360 * j) / (inRow - 1), y: 560 + row * 130 };
    }
    const t = n === 1 ? 0.5 : k / (n - 1);
    const span = Math.min(780, 200 * (n - 1));
    return { x: 500 - span / 2 + span * t, y: 600 - Math.pow(2 * t - 1, 2) * (n > 2 ? 70 : 20) };
  }

  private layout(v: View): StageItem[] {
    const items: StageItem[] = [];
    const s = this.port ? 0.62 : 0.78;
    const put = (cards: Card[], hand: 'P' | 'B') => {
      const p = this.handPt(hand);
      const step = (this.port ? 48 : 64) * (s / 0.78);
      cards.forEach((c, i) => {
        const third = i === 2;
        const x = third ? p.x + (hand === 'P' ? -1 : 1) * (this.port ? 30 : 40) : p.x + (i - 0.5) * step;
        const y = third ? p.y + (this.port ? 112 : 128) : p.y;
        items.push({ key: `${hand}:${i}`, card: c, x, y, r: third ? 90 : 0, s, z: 10 + i, fromPt: this.shoe });
      });
    };
    put(v.player, 'P');
    put(v.banker, 'B');
    for (let k = 0; k < 4; k++) items.push({ key: `shoe:${k}`, card: null, x: this.shoe.x - k * 1.5, y: this.shoe.y - k * 2.5, r: 0, s: 0.5, z: 2 + k });
    return items;
  }

  private draw() {
    const v = this.v;
    if (!v) return;
    this.cs.render(this.layout(v), this.ctx.speed(), null, this.port ? { x: 270, y: -80 } : { x: 120, y: -80 });
    let html = '';
    for (const hand of ['P', 'B'] as const) {
      const cards = hand === 'P' ? v.player : v.banker;
      const p = this.handPt(hand);
      if (cards.length) html += `<div class="bc-total" style="left:${p.x}px;top:${p.y - (this.port ? 88 : 104)}px">${total(cards)}</div>`;
    }
    if (v.cfg.mode === 'pb') html += `<div class="bc-note" style="left:${this.port ? 270 : 500}px;top:${this.port ? 430 : 440}px">НИЧЬЯ ПЛАТИТ ${v.cfg.tie} К 1 · БАНКИР — КОМИССИЯ ${v.cfg.vig}%</div>`;
    else if (v.bankSeat != null) html += `<div class="bc-bank" style="left:${this.port ? 270 : 500}px;top:${this.port ? 440 : 440}px"><span class="bc-chip"></span>Банк <b>${v.bank}</b> · держит ${esc(this.plain(v.bankSeat))}</div>`;
    html += `<div class="bc-coup" style="left:${this.port ? 80 : 110}px;top:${this.port ? 24 : 34}px">Сдача ${v.coup} из ${v.cfg.coups}<small>в шузе ${v.shoeLeft}</small></div>`;
    for (const seat of v.seats) {
      const p = this.seatPt(v, seat);
      const bets = v.bets.filter((b) => b.seat === seat);
      const on = v.turn === seat;
      const role = v.bankSeat === seat ? '🏦 ' : v.punter === seat ? '🂠 ' : '';
      const bet = bets.map((b) => `<em class="bc-bet bc-${b.side}">${b.n} · ${SIDE[b.side]}</em>`).join('');
      const pay = v.last && !v.player.length ? v.last.pay[seat] : 0;
      html += `<div class="cs-plate bc-plate${on ? ' on' : ''}${v.money[seat] < MIN_BET && v.bankSeat !== seat ? ' bc-broke' : ''}" style="--c:${SEATS[seat].color};left:${p.x}px;top:${p.y}px">${role}${esc(this.plain(seat))} <b>${v.money[seat]}</b>${pay ? ` <i class="${pay > 0 ? 'up' : 'down'}">${pay > 0 ? '+' : ''}${pay}</i>` : ''}${bet ? `<br>${bet}` : ''}</div>`;
    }
    this.plates.innerHTML = html;
  }

  private plain(seat: number) {
    return this.ctx.name(seat).replace(/<[^>]+>/g, '');
  }

  // ---------------------------------------------------------------- ход

  private send(a: unknown) {
    const seat = this.actSeat;
    if (seat == null) return;
    Sound.unlock();
    this.actSeat = null;
    this.btns.innerHTML = '';
    this.ctx.act(seat, a);
  }

  private button(text: string, cls: string, on: () => void, into: HTMLElement = this.btns, disabled = false) {
    const b = h<HTMLButtonElement>(`<button class="btn ${cls}"${disabled ? ' disabled' : ''}>${text}</button>`);
    b.onclick = () => {
      Sound.unlock();
      on();
    };
    into.appendChild(b);
    return b;
  }

  private renderButtons() {
    if (!this.btns) return;
    this.btns.innerHTML = '';
    const v = this.v;
    const seat = this.actSeat;
    if (!v || seat == null) return;
    const pb = v.cfg.mode === 'pb';
    if (v.phase === 'open') {
      this.btns.appendChild(h('<div class="bc-ask">Ваш банк. Сколько кладёте?</div>'));
      for (const n of bankChoices(v, seat)) this.button(`Банк ${n}`, n === 100 ? 'primary' : '', () => this.send({ type: 'bank', n }));
      return;
    }
    if (v.phase === 'bet') {
      const [lo, hi] = betRange(v, seat);
      this.amount = Math.max(lo, Math.min(hi, this.amount || Math.min(hi, 50)));
      if (pb) {
        const row = h('<div class="bc-row"></div>');
        for (const sd of ['P', 'B', 'T'] as const) {
          const odds = sd === 'P' ? '1:1' : sd === 'B' ? `1:1 −${v.cfg.vig}%` : `${v.cfg.tie}:1`;
          this.button(`${SIDE[sd]} <small>${odds}</small>`, `bc-side bc-${sd}${this.side === sd ? ' on' : ''}`, () => {
            this.side = sd;
            Sound.ui();
            this.renderButtons();
          }, row);
        }
        this.btns.appendChild(row);
      } else {
        this.btns.appendChild(h(`<div class="bc-ask">Против банка ${v.bank} (не покрыто ${uncovered(v)}).</div>`));
        if (v.money[seat] >= uncovered(v)) this.button(`Банко! (${uncovered(v)})`, 'primary', () => this.send({ type: 'banco' }));
      }
      const amt = h('<div class="bc-row bc-amount"></div>');
      const set = (n: number) => {
        this.amount = Math.max(lo, Math.min(hi, n));
        Sound.ui();
        this.renderButtons();
      };
      this.button('−', 'bc-q', () => set(this.amount - (this.amount > 100 ? 50 : 10)), amt);
      amt.appendChild(h(`<div class="bc-n"><span class="bc-chip"></span>${this.amount}</div>`));
      this.button('+', 'bc-q', () => set(this.amount + (this.amount >= 100 ? 50 : 10)), amt);
      for (const q of [10, 100, 500]) if (q <= hi) this.button(String(q), 'bc-q', () => set(q), amt);
      this.button('Всё', 'bc-q', () => set(hi), amt);
      this.btns.appendChild(amt);
      this.button(pb ? `Поставить ${this.amount} на ${SIDE_ON[this.side]}` : `Ставлю ${this.amount}`, pb ? 'primary' : '', () => this.send({ type: 'bet', side: pb ? this.side : 'P', n: this.amount }));
      this.button(pb ? 'Пропустить сдачу' : 'Пас', '', () => this.send({ type: 'skip' }));
      return;
    }
    if (v.phase === 'punter') {
      this.btns.appendChild(h(`<div class="bc-ask">У вас ${total(v.player)}: брать третью карту — на ваше усмотрение.</div>`));
      this.button('Карту!', 'primary', () => this.send({ type: 'draw' }));
      this.button('Хватит', '', () => this.send({ type: 'stand' }));
      return;
    }
    if (v.phase === 'banker') {
      this.btns.appendChild(h(`<div class="bc-ask">У банка ${total(v.banker)}${v.player.length === 3 ? ', у понтёра третья карта открыта' : ', понтёр стоит'}: решайте.</div>`));
      this.button('Тяну', 'primary', () => this.send({ type: 'draw' }));
      this.button('Стою', '', () => this.send({ type: 'stand' }));
      return;
    }
    if (v.phase === 'keep') {
      this.btns.appendChild(h(`<div class="bc-ask">Банк выиграл: в нём ${v.bank}. Держать дальше?</div>`));
      this.button(`Держу банк (${v.bank})`, 'primary', () => this.send({ type: 'keep' }));
      this.button('Забираю и передаю', '', () => this.send({ type: 'pass' }));
    }
  }

  // ---------------------------------------------------------------- события

  async play(events: Event[], v: View) {
    this.actSeat = null;
    if (this.btns) this.btns.innerHTML = '';
    const speed = this.ctx.speed();
    for (const ev of events) {
      const cur = this.v!;
      if (ev.type === 'coup') {
        this.v = { ...cur, player: [], banker: [], bets: [], punter: null, coup: ev.coup, bankSeat: ev.banker, bank: ev.bank || cur.bank };
        this.draw();
      } else if (ev.type === 'shuffle') {
        Sound.shuffle();
        await this.banner_(`Новый шуз`, 700);
      } else if (ev.type === 'bank') {
        this.v = { ...cur, bank: ev.n, bankStart: ev.n, money: cur.money.map((m, i) => (i === ev.seat ? m - ev.n : m)) };
        this.draw();
        Sound.place();
        await sleep(300 / speed);
      } else if (ev.type === 'bet') {
        this.v = { ...cur, bets: [...cur.bets, { seat: ev.seat, side: ev.side, n: ev.n }], money: cur.money.map((m, i) => (i === ev.seat ? m - ev.n : m)) };
        this.draw();
        Sound.place();
        if (ev.banco) await this.banner_(`${this.plain(ev.seat)}: «Банко!»`, 800);
        else await sleep(220 / speed);
      } else if (ev.type === 'card') {
        if (ev.hand === 'P') this.v = { ...cur, player: [...cur.player, ev.card] };
        else this.v = { ...cur, banker: [...cur.banker, ev.card] };
        this.draw();
        Sound.card();
        await sleep((ev.third ? 650 : 420) / speed);
      } else if (ev.type === 'choice') {
        await this.banner_(`${this.plain(ev.seat)}: ${ev.draw ? '«Карту!»' : '«Хватит»'}`, 700);
      } else if (ev.type === 'result') {
        const who = ev.win === 'T' ? `Ничья, ${ev.p}:${ev.b}` : `${ev.win === 'P' ? 'Игрок' : 'Банкир'} — ${Math.max(ev.p, ev.b)} против ${Math.min(ev.p, ev.b)}`;
        if (ev.natural) Sound.win();
        else Sound.step();
        this.v = { ...cur, last: { p: ev.p, b: ev.b, win: ev.win, pay: ev.pay } };
        await this.banner_(`${ev.natural ? 'Натуральная! ' : ''}${who}`, 1500);
      } else if (ev.type === 'keep') {
        await this.banner_(ev.keep ? `${this.plain(ev.seat)} держит банк` : `${this.plain(ev.seat)} передаёт банк`, 800);
      } else if (ev.type === 'end') {
        this.v = v;
        this.draw();
        Sound.win();
        await this.banner_(`Партия: больше всех у ${this.plain(ev.winner)} — ${ev.money[ev.winner]}`, 0);
      }
    }
    this.v = v;
    this.draw();
  }

  private async banner_(text: string, ms: number) {
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

  setTurn(_toAct: number[], interactive: number[]) {
    const v = this.v;
    this.actSeat = v && v.turn != null && interactive.includes(v.turn) ? v.turn : null;
    this.draw();
    this.renderButtons();
  }

  status(v: View, toAct: number[], interactive: number[]) {
    if (v.over) return 'Партия окончена';
    const who = toAct[0];
    if (who == null) return 'Крупье раздаёт…';
    const what = v.phase === 'open' ? 'кладёт банк' : v.phase === 'bet' ? 'ставит' : v.phase === 'keep' ? 'решает про банк' : 'решает про карту';
    return interactive.includes(who) ? 'Ваш ход' : `${this.ctx.name(who)} ${what}…`;
  }

  playerStats(v: View, seat: number) {
    return `деньги: ${v.money[seat]}${v.bankSeat === seat ? `, банк ${v.bank}` : ''}`;
  }

  destroy() {
    this.cs.destroy();
  }
}

export function createView(): GameView<View, Event> {
  return new BaccaratView();
}
