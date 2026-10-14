/* Храп — отрисовка на общем взяточном столе: козырь открыт у колоды, сверху — банк спичек и что сейчас (торговля, обмен,
 * розыгрыш). На табличках — спички (или горбы), заявка и взятки. Торговля — кнопками; обмен — выбрать до трёх карт касанием
 * и «Сменить»; ход — касание подсвеченной карты. */
import { Sound } from '../../core/audio';
import { h } from '../../core/util';
import type { GameView } from '../../core/view';
import { sameCard, SUIT_NAME, SUIT_SYM, type Card } from '../../cards/deck';
import { TrickView, type TrickModel } from '../../cards/trickview';
import { bidOptions, countOf, deckLeft, legal, widowLeft, type Bid, type Event, type View } from './engine';
import { BID_NAME, khrapWord, SEATS } from './def';
import './khrap.css';

class KhrapView extends TrickView<View, Event> {
  constructor() {
    super('kh', 'kh-cloth', SEATS);
  }

  protected model(v: View): TrickModel {
    const act = this.actSeat;
    const ok = act != null ? (v.phase === 'play' ? legal(v, act) : v.phase === 'swap' ? v.hands[act] : []) : [];
    const red = v.trump === 'H' || v.trump === 'D';
    const gorb = v.cfg.mode === 'gorb';
    const phase =
      v.phase === 'bid' ? 'торговля' : v.phase === 'swap' ? 'смена карт' : v.phase === 'play' ? (v.khrap != null ? `${khrapWord(v).toLowerCase()} — ${this.plain(v.khrap)}` : 'розыгрыш') : 'партия окончена';
    const extra = [gorb ? '' : `банк: ${v.bank} 🔥`, v.phase === 'swap' ? `в колоде ${deckLeft(v)}` : '', widowLeft(v) ? 'лапа на столе' : ''].filter(Boolean).join(' · ');
    return {
      seats: v.seats,
      hand: (p) => v.hands[p],
      count: (p) => countOf(v, p),
      trick: v.trick,
      turn: v.phase === 'over' ? null : v.turn,
      canPlay: (c) => ok.some((x) => sameCard(x, c)),
      plate: (p) => {
        const b = v.bids[p];
        const money = gorb ? `<i title="Горбы">${'⌒'.repeat(Math.min(v.gorbs[p], 7)) || '0'}</i>` : `<i title="Спички">🔥${v.chips[p]}</i>`;
        const short: Record<Bid, string> = { play: '✋', pass: 'пас', khrap: khrapWord(v).toLowerCase() + '!', widow: 'лапа' };
        const bid = !gorb && b ? ` <em title="${BID_NAME[b]}">${short[b]}</em>` : '';
        return money + bid;
      },
      tricks: (p) => v.tricks[p],
      trump: v.trump,
      trumpCard: v.phase === 'bid' || v.phase === 'swap' || deckLeft(v) ? v.trumpCard : null,
      center: `Козырь: <span class="${red ? 'red' : ''}">${SUIT_SYM[v.trump]}</span> ${SUIT_NAME[v.trump]}<small>${phase}${extra ? ' · ' + extra : ''}</small>`,
    };
  }

  protected playAction(card: Card) {
    return { type: 'play', card };
  }

  protected override onCard(card: Card) {
    const v = this.v;
    if (v?.phase === 'swap') this.toggle(card, Math.min(v.cfg.exchange, deckLeft(v)));
    else super.onCard(card);
  }

  protected override buttons(v: View, seat: number): boolean {
    if (v.phase === 'bid') {
      const opts = bidOptions(v, seat);
      this.btns.appendChild(h(`<div class="tv-ask">Играете? «Играю» — обязуетесь взять хоть одну взятку.</div>`));
      const label: Record<Bid, string> = { play: 'Играю', pass: 'Пас', khrap: `«${khrapWord(v)}!» — возьму все`, widow: 'Беру лапу' };
      for (const b of ['play', 'pass', 'widow', 'khrap'] as Bid[]) if (opts.includes(b)) this.button(label[b], b === 'play' ? 'primary' : '', () => this.send({ type: 'bid', bid: b }));
      return true;
    }
    if (v.phase === 'swap') {
      const k = this.selected.length;
      const max = Math.min(v.cfg.exchange, deckLeft(v));
      this.btns.appendChild(h(`<div class="tv-ask">Выберите до ${max} карт на смену — или оставьте как есть.</div>`));
      this.button(k ? `Сменить ${k}` : 'Не менять', 'primary', () => this.send({ type: 'swap', cards: this.selected.slice() }));
      return true;
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
        await this.pause(330);
      } else if (ev.type === 'trick') {
        await this.pause(650);
        const next = { ...cur, trick: [], tricks: cur.tricks.map((t, i) => (i === ev.seat ? t + 1 : t)) };
        this.flyTo(next, ev.seat);
        this.show(next);
        Sound.step();
        await this.pause(300);
      } else if (ev.type === 'bid') {
        Sound.ui();
        this.show({ ...cur, bids: cur.bids.map((b, i) => (i === ev.seat ? ev.bid : b)) });
        if (ev.bid === 'khrap') await this.showBanner(`${this.plain(ev.seat)}: «${khrapWord(cur)}!»`, 1200);
        else await this.pause(350);
      } else if (ev.type === 'swap') {
        Sound.card();
        await this.pause(300);
      } else if (ev.type === 'alone') {
        Sound.win();
        await this.showBanner(ev.seat != null ? `${this.plain(ev.seat)} забирает банк` : 'Все спасовали', 1300);
      } else if (ev.type === 'settle') {
        Sound.win();
        const sat = ev.sat.map((p) => this.plain(p));
        const kh = ev.khrap != null ? `${khrapWord(cur)} ${ev.khrapOk ? 'взят!' : 'не взят!'}` : '';
        await this.showBanner(kh || (sat.length ? `Сел: ${sat.join(', ')}` : 'Расчёт'), 1400);
      } else if (ev.type === 'gorb') {
        const who = ev.add.map((x, p) => (x > 0 ? this.plain(p) : '')).filter(Boolean);
        Sound.win();
        await this.showBanner(who.length ? `Горб: ${who.join(', ')}` : 'Без горбов', 1300);
      } else if (ev.type === 'deal') {
        Sound.shuffle();
      } else if (ev.type === 'end') {
        this.show(v);
        await this.showBanner(`Победа: ${ev.winners.map((p) => this.plain(p)).join(', ')}`, 0);
      }
    }
    this.show(v);
  }

  status(v: View, toAct: number[], interactive: number[]) {
    if (v.phase === 'over') return 'Партия окончена';
    const who = toAct[0];
    const what = v.phase === 'bid' ? 'торгуется' : v.phase === 'swap' ? 'меняет карты' : 'ходит';
    return interactive.includes(who) ? 'Ваш ход' : `${this.ctx.name(who)} ${what}…`;
  }

  playerStats(v: View, seat: number) {
    return v.cfg.mode === 'gorb' ? `горбов: ${v.gorbs[seat]}` : `спичек: ${v.chips[seat]}`;
  }
}

export function createView(): GameView<View, Event> {
  return new KhrapView();
}
