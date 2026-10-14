/* Кинг — отрисовка на общем взяточном столе. Сверху — табличка сдачи (контракт, козырь, номер сдачи); заказной контракт и козырь
 * выбираются кнопками; дальше — касание подсвеченной карты. На табличках — очки за партию и за эту сдачу. */
import { Sound } from '../../core/audio';
import { h } from '../../core/util';
import type { GameView } from '../../core/view';
import { sameCard, SUIT_SYM, SUITS, type Card } from '../../cards/deck';
import { TrickView, type TrickModel } from '../../cards/trickview';
import { CONTRACT_NAME, countOf, legal, NEGATIVE, totalDeals, type Event, type View } from './engine';
import { SEATS, trumpName } from './def';
import './king.css';

class KingView extends TrickView<View, Event> {
  constructor() {
    super('kg', 'kg-cloth', SEATS);
  }

  protected model(v: View): TrickModel {
    const act = this.actSeat;
    const ok = act != null && v.phase === 'play' ? legal(v, act) : [];
    const what = v.phase === 'order' ? 'Сдающий выбирает контракт' : v.phase === 'trump' ? 'Брать: сдающий назначает козырь' : CONTRACT_NAME[v.contract];
    const sub = `сдача ${v.deal} из ${totalDeals(v.cfg)}${v.contract === 'plus' && v.phase === 'play' ? ' · ' + trumpName(v.trump) : ''}`;
    return {
      seats: v.seats,
      hand: (p) => v.hands[p],
      count: (p) => countOf(v, p),
      trick: v.trick,
      turn: v.phase === 'over' ? null : v.turn,
      canPlay: (c) => ok.some((x) => sameCard(x, c)),
      plate: (p) => `<i title="Очки за партию">${v.score[p]}</i>${v.now[p] ? ` <em>${v.now[p] > 0 ? '+' : ''}${v.now[p]}</em>` : ''}`,
      tricks: (p) => v.tricks[p],
      trump: v.contract === 'plus' ? v.trump : null,
      center: `${what}<small>${sub}</small>`,
    };
  }

  protected playAction(card: Card) {
    return { type: 'play', card };
  }

  protected override buttons(v: View, _seat: number): boolean {
    if (v.phase === 'order') {
      this.btns.appendChild(h('<div class="tv-ask">Посмотрите карты и выберите, что играть:</div>'));
      for (const k of NEGATIVE) if (!v.used.includes(k)) this.button(CONTRACT_NAME[k], 'primary', () => this.send({ type: 'order', contract: k }));
      return true;
    }
    if (v.phase === 'trump') {
      this.btns.appendChild(h('<div class="tv-ask">Брать взятки: назначьте козырь.</div>'));
      const grid = h('<div class="tv-grid"></div>');
      for (const s of SUITS) this.button(SUIT_SYM[s], s === 'H' || s === 'D' ? 'red' : '', () => this.send({ type: 'trump', suit: s }), false, grid);
      this.btns.appendChild(grid);
      this.button('Без козыря', '', () => this.send({ type: 'trump', suit: null }));
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
        const next = { ...cur, trick: [], tricks: cur.tricks.map((t, i) => (i === ev.seat ? t + 1 : t)), now: cur.now.map((x, i) => (i === ev.seat ? x + ev.pts : x)) };
        this.flyTo(next, ev.seat);
        this.show(next);
        Sound.step();
        await this.pause(300);
      } else if (ev.type === 'contract') {
        this.show({ ...cur, contract: ev.contract, phase: 'play' });
        Sound.ui();
        await this.showBanner(CONTRACT_NAME[ev.contract], 900);
      } else if (ev.type === 'trump') {
        await this.showBanner(trumpName(ev.suit), 900);
      } else if (ev.type === 'round') {
        Sound.win();
        await this.showBanner(ev.early ? 'Всё штрафное взято' : 'Сдача окончена', 1100);
      } else if (ev.type === 'deal') {
        Sound.shuffle();
        this.show({ ...v, trick: [] });
      } else if (ev.type === 'end') {
        this.show(v);
        await this.showBanner(`Победил ${ev.winners.map((p) => this.plain(p)).join(', ')}`, 0);
      }
    }
    this.show(v);
  }

  status(v: View, toAct: number[], interactive: number[]) {
    if (v.phase === 'over') return 'Партия окончена';
    const who = toAct[0];
    const mine = interactive.includes(who);
    if (v.phase === 'order') return mine ? 'Выберите контракт' : `${this.ctx.name(who)} выбирает контракт…`;
    if (v.phase === 'trump') return mine ? 'Назначьте козырь' : `${this.ctx.name(who)} назначает козырь…`;
    return mine ? 'Ваш ход' : `Ходит ${this.ctx.name(who)}…`;
  }

  playerStats(v: View, seat: number) {
    return `очки: ${v.score[seat]}`;
  }
}

export function createView(): GameView<View, Event> {
  return new KingView();
}
