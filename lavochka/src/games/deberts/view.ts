/* Деберц, клабор и белот — отрисовка на общем взяточном столе. Пока торгуются — открытая карта у колоды и кнопки «Играю» / «Пас»
 * (второй круг — масти на выбор); потом — обмен козырной семёрки, ход касанием карты. Комбинации и белла — короткими табличками. */
import { Sound } from '../../core/audio';
import { h } from '../../core/util';
import type { GameView } from '../../core/view';
import { sameCard, SUIT_NAME, SUIT_SYM, SUITS, type Card, type Suit } from '../../cards/deck';
import { TrickView, type TrickModel } from '../../cards/trickview';
import { canSwap, countOf, legal, pairs, teamOf, type Event, type View } from './engine';
import { SEATS } from './def';
import './deberts.css';

const red = (s: Suit) => s === 'H' || s === 'D';
const sym = (s: Suit) => `<span class="${red(s) ? 'red' : ''}">${SUIT_SYM[s]}</span>`;

class DebertsView extends TrickView<View, Event> {
  constructor() {
    super('db', 'db-cloth', SEATS);
  }

  protected model(v: View): TrickModel {
    const act = this.actSeat;
    const ok = act != null && v.phase === 'play' ? legal(v, act) : [];
    const teamPts = (p: number) => v.pts[teamOf(v, p)];
    const label = v.cfg.rules === 'belote' ? 'Белот' : v.cfg.rules === 'klabor' ? 'Клабор' : 'Деберц';
    const center = v.trump
      ? `${label}: козырь ${sym(v.trump)} ${SUIT_NAME[v.trump]}<small>играет ${this.plain(v.taker!)} · очки ${v.score.join(' : ')} · до ${v.cfg.target}${v.hanging ? ` · висят ${v.hanging}` : ''}</small>`
      : `${label}: торги<small>${v.phase === 'bid2' ? 'второй круг — любая другая масть' : `открыта ${sym(v.up!.s)}`} · очки ${v.score.join(' : ')}</small>`;
    return {
      seats: v.seats,
      hand: (p) => v.hands[p],
      count: (p) => countOf(v, p),
      trick: v.trick,
      turn: v.over ? null : v.turn,
      canPlay: (c) => ok.some((x) => sameCard(x, c)),
      plate: (p) => (v.trump ? `<i>${teamPts(p)}</i>${v.taker === p ? ' <b title="Играет">★</b>' : ''}` : ''),
      tricks: (p) => v.tricks[p],
      trump: v.trump ?? undefined,
      trumpCard: v.up,
      center,
    };
  }

  protected playAction(card: Card) {
    return { type: 'play', card };
  }

  protected override buttons(v: View, seat: number): boolean {
    if (v.phase === 'bid1') {
      this.btns.appendChild(h(`<div class="tv-ask">Козырь — ${sym(v.up!.s)}? Ваше слово.</div>`));
      this.button(`Играю ${sym(v.up!.s)}`, 'primary', () => this.send({ type: 'bid', play: true }));
      this.button('Пас', '', () => this.send({ type: 'bid', play: false }));
      return true;
    }
    if (v.phase === 'bid2') {
      const forced = v.cfg.rules === 'klabor' && seat === v.dealer;
      this.btns.appendChild(h(`<div class="tv-ask">${forced ? 'Обязон: назовите козырь.' : 'Назовите другой козырь или пас.'}</div>`));
      for (const s of SUITS) if (s !== v.up!.s) this.button(`${sym(s)} ${SUIT_NAME[s]}`, '', () => this.send({ type: 'bid', play: true, suit: s }));
      if (!forced) this.button('Пас', '', () => this.send({ type: 'bid', play: false }));
      return true;
    }
    if (canSwap(v, seat)) {
      const row = h('<div class="db-row"></div>');
      this.button(`Обменять семёрку на ${sym(v.up!.s)}`, '', () => this.send({ type: 'swap' }), false, row);
      this.btns.appendChild(row);
    }
    return false;
  }

  async play(events: Event[], v: View) {
    this.clearTurn();
    for (const ev of events) {
      const cur = this.v!;
      if (ev.type === 'play') {
        this.show({ ...cur, trick: [...cur.trick, { seat: ev.seat, card: ev.card }], hands: cur.hands.map((hh, i) => (i === ev.seat ? hh.filter((c) => !sameCard(c, ev.card)) : hh)), counts: cur.counts.map((c, i) => (i === ev.seat ? c - 1 : c)), turn: ev.seat });
        Sound.card();
        if (ev.bella) await this.showBanner(`${this.plain(ev.seat)}: ${v.cfg.rules === 'belote' ? 'белот' : 'белла'}!`, 700);
        else await this.pause(330);
      } else if (ev.type === 'trick') {
        await this.pause(600);
        const next = { ...cur, trick: [], tricks: cur.tricks.map((t, i) => (i === ev.seat ? t + 1 : t)) };
        this.flyTo(next, ev.seat);
        this.show(next);
        Sound.step();
        await this.pause(280);
      } else if (ev.type === 'bid') {
        Sound.ui();
        await this.showBanner(`${this.plain(ev.seat)}: ${ev.play ? (ev.suit ? `козырь ${SUIT_SYM[ev.suit]}` : 'играю') : 'пас'}`, 600);
      } else if (ev.type === 'trump') {
        this.show({ ...v, trick: [] });
        Sound.shuffle();
        await this.showBanner(`Играет ${this.plain(ev.taker)}, козырь ${SUIT_SYM[ev.suit]}`, 1000);
      } else if (ev.type === 'decl') {
        Sound.win();
        await this.showBanner(`${this.plain(ev.seat)}: ${ev.what}${ev.pts ? ` +${ev.pts}` : ''}`, 900);
      } else if (ev.type === 'swap') {
        await this.showBanner(`${this.plain(ev.seat)} меняет семёрку на открытый козырь`, 800);
      } else if (ev.type === 'redeal') {
        await this.showBanner('Все спасовали — пересдача', 900);
      } else if (ev.type === 'hand') {
        Sound.win();
        await this.showBanner(`Сдача: ${ev.add.map((x) => (x > 0 ? '+' : '') + x).join(' : ')}${ev.lines.length ? ` (${ev.lines.join(', ')})` : ''}`, 1800);
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
    return v.phase === 'play' ? 'Ваш ход' : 'Торги: ваше слово';
  }

  playerStats(v: View, seat: number) {
    return `очки: ${v.score[teamOf(v, seat)]}`;
  }
}

export function createView(): GameView<View, Event> {
  return new DebertsView();
}
