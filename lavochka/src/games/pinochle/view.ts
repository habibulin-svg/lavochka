/* Пинокль — отрисовка на общем взяточном столе: торги кнопками (+10, +50, пас), выбор козыря, закапывание трёх карт (втроём),
 * мелды — строкой на табличке игрока, ход касанием карты. */
import { Sound } from '../../core/audio';
import { h } from '../../core/util';
import type { GameView } from '../../core/view';
import { SUIT_NAME, SUIT_SYM, SUITS, type Card, type Suit } from '../../cards/deck';
import { TrickView, type TrickModel } from '../../cards/trickview';
import { countOf, legal, minBid, pairs, sameP, teamOf, type Event, type PCard, type View } from './engine';
import { SEATS } from './def';
import './pinochle.css';

const sym = (s: Suit) => `<span class="${s === 'H' || s === 'D' ? 'red' : ''}">${SUIT_SYM[s]}</span>`;

class PinochleView extends TrickView<View, Event> {
  private bidN = 0;

  constructor() {
    super('pn', 'pn-cloth', SEATS);
  }

  protected model(v: View): TrickModel {
    const act = this.actSeat;
    const ok = act != null && v.phase === 'play' ? legal(v, act) : act != null && v.phase === 'bury' ? v.hands[act] : [];
    const center = v.trump
      ? `Козырь ${sym(v.trump)} ${SUIT_NAME[v.trump]}<small>заказ ${v.bid} — ${this.plain(v.bidder!)} · мелды ${v.meld.join(' : ')} · счёт ${v.score.join(' : ')}</small>`
      : `Торги${v.bid ? `: ${v.bid} — ${this.plain(v.bidder!)}` : ''}<small>счёт ${v.score.join(' : ')} · до ${v.cfg.target}</small>`;
    return {
      seats: v.seats,
      hand: (p) => v.hands[p] as Card[],
      count: (p) => countOf(v, p),
      trick: v.trick,
      turn: v.over ? null : v.turn,
      canPlay: (c) => ok.some((x) => sameP(x, c as PCard)),
      plate: (p) => {
        const ml = v.meldLines[p] ?? [];
        const sum = ml.reduce((x, m) => x + m.pts, 0);
        return `${v.trump ? `<i title="${ml.map((m) => `${m.what} ${m.pts}`).join(', ')}">мелд ${sum}</i> · ${v.pts[teamOf(v, p)]}` : v.out.includes(p) ? '<i>пас</i>' : ''}${v.bidder === p ? ' <b>★</b>' : ''}`;
      },
      tricks: (p) => v.tricks[p],
      trump: v.trump ?? undefined,
      center,
    };
  }

  protected playAction(card: Card) {
    return { type: 'play', card };
  }

  protected override onCard(card: Card) {
    const v = this.v!;
    if (v.phase === 'bury') return this.toggle(card, 3);
    this.send({ type: 'play', card });
  }

  protected override buttons(v: View, seat: number): boolean {
    if (v.phase === 'bid') {
      const min = minBid(v);
      this.bidN = Math.max(this.bidN, min);
      const row = h('<div class="pn-row"></div>');
      this.button('−10', 'pn-q', () => ((this.bidN = Math.max(min, this.bidN - 10)), this.renderButtons()), this.bidN <= min, row);
      row.appendChild(h(`<div class="pn-n">${this.bidN}</div>`));
      this.button('+10', 'pn-q', () => ((this.bidN += 10), this.renderButtons()), false, row);
      this.button('+50', 'pn-q', () => ((this.bidN += 50), this.renderButtons()), false, row);
      this.btns.appendChild(row);
      this.button(`Заказать ${this.bidN}`, 'primary', () => this.send({ type: 'bid', n: this.bidN }));
      this.button('Пас', '', () => this.send({ type: 'pass' }));
      this.btns.appendChild(h('<div class="tv-ask">Сколько очков наберёте мелдами и взятками? Спасовав, в этой сдаче больше не торгуетесь.</div>'));
      return true;
    }
    if (v.phase === 'trump') {
      this.btns.appendChild(h('<div class="tv-ask">Заказ ваш — назовите козырь.</div>'));
      for (const s of SUITS) this.button(`${sym(s)} ${SUIT_NAME[s]}`, '', () => this.send({ type: 'trump', suit: s }));
      return true;
    }
    if (v.phase === 'bury') {
      this.btns.appendChild(h('<div class="tv-ask">Выберите три карты, чтобы закопать: их очки — ваши. Мелд уже посчитан.</div>'));
      this.button(`Закопать (${this.selected.length} из 3)`, 'primary', () => this.send({ type: 'bury', cards: this.selected.slice() as PCard[] }), this.selected.length !== 3);
      return true;
    }
    return false;
  }

  async play(events: Event[], v: View) {
    this.clearTurn();
    this.bidN = 0;
    for (const ev of events) {
      const cur = this.v!;
      if (ev.type === 'play') {
        this.show({ ...cur, trick: [...cur.trick, { seat: ev.seat, card: ev.card }], hands: cur.hands.map((hh, i) => (i === ev.seat ? hh.filter((c) => !sameP(c, ev.card)) : hh)), counts: cur.counts.map((c, i) => (i === ev.seat ? c - 1 : c)), turn: ev.seat });
        Sound.card();
        await this.pause(320);
      } else if (ev.type === 'trick') {
        await this.pause(560);
        const next = { ...cur, trick: [], tricks: cur.tricks.map((t, i) => (i === ev.seat ? t + 1 : t)) };
        this.flyTo(next, ev.seat);
        this.show(next);
        Sound.step();
        await this.pause(250);
      } else if (ev.type === 'bid' || ev.type === 'pass') {
        Sound.ui();
        await this.showBanner(`${this.plain(ev.seat)}: ${ev.type === 'bid' ? ev.n : 'пас'}`, 500);
      } else if (ev.type === 'won') {
        await this.showBanner(`Заказ — ${this.plain(ev.seat)}, ${ev.bid}`, 900);
      } else if (ev.type === 'trump') {
        this.show({ ...v, trick: [] });
        Sound.win();
        await this.showBanner(`Козырь ${SUIT_SYM[ev.suit]} · мелды ${ev.meld.join(' : ')}`, 1300);
      } else if (ev.type === 'hand') {
        Sound.win();
        await this.showBanner(`Сдача: ${ev.add.map((x) => (x > 0 ? '+' : '') + x).join(' : ')}${ev.lines.length ? ` — ${ev.lines.join(', ')}` : ''}`, 1800);
      } else if (ev.type === 'deal') {
        Sound.shuffle();
        this.show({ ...v, trick: [] });
      } else if (ev.type === 'end') {
        this.show(v);
        await this.showBanner(pairs(v) ? `Партия — пара ${ev.winner + 1}` : `Партия — ${this.plain(v.seats[ev.winner])}`, 0);
      }
    }
    this.show(v);
  }

  status(v: View, toAct: number[], interactive: number[]) {
    if (v.over) return 'Партия окончена';
    const who = toAct[0];
    if (!interactive.includes(who)) return `Ходит ${this.ctx.name(who)}…`;
    return v.phase === 'bid' ? 'Торги' : v.phase === 'trump' ? 'Назовите козырь' : v.phase === 'bury' ? 'Закопайте три карты' : 'Ваш ход';
  }

  playerStats(v: View, seat: number) {
    return `очки: ${v.score[teamOf(v, seat)]}`;
  }
}

export function createView(): GameView<View, Event> {
  return new PinochleView();
}
