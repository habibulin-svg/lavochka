/* Шнапсен — отрисовка на общем взяточном столе: вдвоём, прикуп с открытым козырем в углу, посередине — заход.
 * Касание короля или дамы из марьяжа на заходе спрашивает «Марьяж?»; кнопки — обмен младшего козыря, «Закрыть», «Хватит!». */
import { Sound } from '../../core/audio';
import { h } from '../../core/util';
import type { GameView } from '../../core/view';
import { sameCard, SUIT_NAME, SUIT_SYM, type Card } from '../../cards/deck';
import { TrickView, type TrickModel } from '../../cards/trickview';
import { canClaim, canClose, canExchange, canMeld, countOf, legal, lowTrump, marriages, meldValue, score, type Event, type View } from './engine';
import { SEATS, cn } from './def';
import './schnapsen.css';

const LOW: Record<number, string> = { 9: 'девятку', 11: 'валета' };

class SchnapsenView extends TrickView<View, Event> {
  private ask: Card | null = null;

  constructor() {
    super('sn', 'sn-cloth', SEATS);
  }

  /** Очки сдачи на табличках — если не «считать в уме». */
  private seen(v: View) {
    return !v.cfg.manual;
  }

  protected model(v: View): TrickModel {
    const act = this.actSeat;
    const ok = act != null && !this.ask ? legal(v, act) : [];
    const red = v.trump === 'H' || v.trump === 'D';
    const left = v.stockLeft;
    const state = v.closed ? `прикуп закрыт (${left})` : left ? `в прикупе ${left}` : 'прикуп кончился';
    return {
      seats: v.seats,
      hand: (p) => v.hands[p],
      count: (p) => countOf(v, p),
      trick: v.lead ? [{ seat: v.lead.seat, card: v.lead.card }, ...(v.answer ? [v.answer] : [])] : [],
      turn: v.over ? null : v.turn,
      canPlay: (c) => ok.some((x) => sameCard(x, c)),
      plate: (p) => {
        const melds = v.melds.filter((m) => m.seat === p).map((m) => `<span class="${m.suit === 'H' || m.suit === 'D' ? 'red' : ''}">${SUIT_SYM[m.suit]}</span>`).join('');
        const pts = this.seen(v) ? ` · <b title="Очки в этой сдаче">${score(v, p)}</b>${v.pending[p] && !v.tricks[p] ? `<small>+${v.pending[p]}</small>` : ''}` : '';
        return `<i title="Очки партии">🏆${v.game[p]}</i>${pts}${melds ? ` <span class="sn-melds" title="Марьяжи">${melds}</span>` : ''}`;
      },
      tricks: (p) => v.tricks[p],
      trump: v.trump,
      trumpCard: v.closed ? null : v.trumpCard,
      center: `Козырь: <span class="${red ? 'red' : ''}">${SUIT_SYM[v.trump]}</span> ${SUIT_NAME[v.trump]}<small>${state} · до ${v.cfg.target}</small>`,
    };
  }

  protected playAction(card: Card) {
    return { type: 'play', card };
  }

  protected override onCard(card: Card) {
    const v = this.v!;
    const seat = this.actSeat!;
    if (canMeld(v, seat) && (card.r === 12 || card.r === 13) && marriages(v, seat).includes(card.s)) {
      this.ask = card;
      this.selected = [card];
      Sound.ui();
      this.draw();
      this.renderButtons();
      return;
    }
    this.send({ type: 'play', card });
  }

  protected override clearTurn() {
    super.clearTurn();
    this.ask = null;
  }

  protected override buttons(v: View, seat: number): boolean {
    if (this.ask) {
      const c = this.ask;
      const pts = meldValue(v, c.s);
      this.btns.appendChild(h(`<div class="tv-ask">Объявить марьяж ${SUIT_SYM[c.s]}? +${pts}${v.tricks[seat] ? '' : ' — засчитается, когда возьмёте взятку'}</div>`));
      this.button(`Марьяж! +${pts}`, 'primary', () => this.send({ type: 'play', card: c, meld: true }));
      if (canClaim(v, seat) && v.tricks[seat]) this.button(`Марьяж — и хватит!`, '', () => this.send({ type: 'claim', meld: c.s }));
      this.button('Просто сходить', '', () => this.send({ type: 'play', card: c }));
      this.button('Отмена', '', () => {
        this.ask = null;
        this.selected = [];
        this.draw();
        this.renderButtons();
      });
      return true;
    }
    if (!v.lead) {
      const row = h('<div class="sn-row"></div>');
      if (canExchange(v, seat)) this.button(`Обменять ${LOW[lowTrump(v.cfg)]} на ${cn(v.trumpCard!)}`, '', () => this.send({ type: 'exchange' }), false, row);
      if (canClose(v, seat)) this.button('Закрыть прикуп', '', () => this.send({ type: 'close' }), false, row);
      if (canClaim(v, seat)) this.button('Хватит! У меня 66', '', () => this.send({ type: 'claim' }), false, row);
      if (row.childElementCount) this.btns.appendChild(row);
    }
    this.btns.appendChild(h(`<div class="tv-ask">${v.lead ? (v.closed || !v.stockLeft ? 'Ответ: в масть и старше, нет масти — козырем.' : 'Ответ: любой картой.') : 'Ваш заход: коснитесь карты.'}</div>`));
    return true;
  }

  async play(events: Event[], v: View) {
    this.clearTurn();
    for (const ev of events) {
      const cur = this.v!;
      if (ev.type === 'play') {
        const hands = cur.hands.map((hh, i) => (i === ev.seat ? hh.filter((c) => !sameCard(c, ev.card)) : hh));
        const counts = cur.counts.map((c, i) => (i === ev.seat ? c - 1 : c));
        if (!cur.lead) this.show({ ...cur, lead: { seat: ev.seat, card: ev.card }, hands, counts, turn: ev.seat });
        else {
          // ответ ложится рядом с заходом
          this.show({ ...cur, hands, counts, turn: ev.seat, answer: { seat: ev.seat, card: ev.card } });
        }
        Sound.card();
        await this.pause(380);
      } else if (ev.type === 'trick') {
        await this.pause(600);
        const pts = cur.pts.slice();
        pts[ev.seat] += ev.pts;
        const tricks = cur.tricks.map((t, i) => (i === ev.seat ? t + 1 : t));
        const next = { ...cur, lead: null, answer: undefined, pts, tricks, turn: ev.seat };
        this.flyTo(next, ev.seat);
        this.show(next);
        Sound.step();
        await this.pause(280);
      } else if (ev.type === 'draw') {
        const hands = cur.hands.map((hh, i) => (i === ev.seat && ev.card && hh.length === cur.counts[i] ? [...hh, ev.card] : hh));
        const counts = cur.counts.map((c, i) => (i === ev.seat ? c + 1 : c));
        this.show({ ...cur, hands, counts, stockLeft: cur.stockLeft - 1, trumpCard: ev.trump ? null : cur.trumpCard });
        Sound.card();
        await this.pause(200);
      } else if (ev.type === 'meld') {
        this.show({ ...cur, melds: [...cur.melds, { seat: ev.seat, suit: ev.suit }] });
        Sound.ui();
        await this.showBanner(`${this.plain(ev.seat)}: марьяж ${SUIT_SYM[ev.suit]} — ${ev.pts}!`, 1000);
      } else if (ev.type === 'exchange') {
        this.show({ ...cur, trumpCard: ev.card, hands: cur.hands.map((hh, i) => (i === ev.seat && hh.length ? [...hh.filter((c) => !sameCard(c, ev.card)), ev.took] : hh)) });
        Sound.card();
        await this.showBanner(`${this.plain(ev.seat)} меняет ${cnText(ev.card)} на ${cnText(ev.took)}`, 1000);
      } else if (ev.type === 'close') {
        this.show({ ...cur, closed: { seat: ev.seat, oppTricks: 0 } });
        Sound.ui();
        await this.showBanner(`${this.plain(ev.seat)} закрывает прикуп`, 1000);
      } else if (ev.type === 'claim') {
        await this.showBanner(ev.ok ? `${this.plain(ev.seat)}: «Хватит!» — ${ev.pts}` : `${this.plain(ev.seat)}: «Хватит!» — а там ${ev.pts}…`, 1200);
      } else if (ev.type === 'hand') {
        Sound.win();
        await this.showBanner(`Сдача — ${this.plain(ev.winner)}: +${ev.gp} (${ev.pts[0]} : ${ev.pts[1]})`, 1500);
      } else if (ev.type === 'deal') {
        Sound.shuffle();
        this.show({ ...v, lead: null });
        await this.pause(300);
      } else if (ev.type === 'end') {
        this.show(v);
        await this.showBanner(`Партия — ${this.plain(ev.winner)} (${ev.game[0]} : ${ev.game[1]})`, 0);
      }
    }
    this.show(v);
  }

  status(v: View, toAct: number[], interactive: number[]) {
    if (v.over) return 'Партия окончена';
    const who = toAct[0];
    return interactive.includes(who) ? (v.lead ? 'Ваш ответ' : 'Ваш заход') : `Ходит ${this.ctx.name(who)}…`;
  }

  playerStats(v: View, seat: number) {
    return `очки партии: ${v.game[seat]}${v.cfg.manual ? '' : `, в сдаче: ${score(v, seat)}`}`;
  }
}

const cnText = (c: Card) => cn(c).replace(/<[^>]+>/g, '');

export function createView(): GameView<View, Event> {
  return new SchnapsenView();
}
