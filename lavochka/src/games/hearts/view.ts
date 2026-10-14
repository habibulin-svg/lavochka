/* Черви — отрисовка на общем взяточном столе: перед коном выберите три карты и отдайте; дальше — касание подсвеченной карты.
 * На табличках — штраф за партию и очки, набранные в этом коне. */
import { Sound } from '../../core/audio';
import { h } from '../../core/util';
import type { GameView } from '../../core/view';
import { sameCard, type Card } from '../../cards/deck';
import { TrickView, type TrickModel } from '../../cards/trickview';
import { cardPts, countOf, isJD, legal, passShift, type Event, type View } from './engine';
import { SEATS, SHIFT_NAME } from './def';
import './hearts.css';

class HeartsView extends TrickView<View, Event> {
  constructor() {
    super('hr', 'hr-cloth', SEATS);
  }

  protected model(v: View): TrickModel {
    const act = this.actSeat;
    const ok = act != null ? (v.phase === 'pass' ? v.hands[act] : legal(v, act)) : [];
    const pts = (p: number) => v.taken[p].reduce((x, c) => x + cardPts(c) - (v.cfg.omnibus && isJD(c) ? 10 : 0), 0);
    return {
      seats: v.seats,
      hand: (p) => v.hands[p],
      count: (p) => countOf(v, p),
      trick: v.trick,
      turn: v.phase === 'play' ? v.turn : null,
      canPlay: (c) => ok.some((x) => sameCard(x, c)),
      plate: (p) => `<i title="Штраф за партию">${v.score[p]}</i>${pts(p) ? ` <em>+${pts(p)}</em>` : ''}`,
      tricks: (p) => v.tricks[p],
      center: v.phase === 'pass' ? `Обмен: три карты ${SHIFT_NAME[passShift(v.cfg, v.round)]}<small>кон ${v.round}</small>` : `кон ${v.round}${v.broken ? ' · черви вскрыты' : ''}`,
    };
  }

  protected playAction(card: Card) {
    return { type: 'play', card };
  }

  protected override onCard(card: Card) {
    if (this.v?.phase === 'pass') this.toggle(card, 3);
    else super.onCard(card);
  }

  protected override buttons(v: View, _seat: number): boolean {
    if (v.phase !== 'pass') return false;
    const k = this.selected.length;
    this.btns.appendChild(h(`<div class="tv-ask">Выберите три карты — отдать ${SHIFT_NAME[passShift(v.cfg, v.round)]}.</div>`));
    this.button(k === 3 ? 'Отдать три карты' : `Выбрано ${k} из 3`, 'primary', () => this.send({ type: 'pass', cards: this.selected.slice() }), k !== 3);
    return true;
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
        const next = { ...cur, trick: [], taken: cur.taken.map((t, i) => (i === ev.seat ? [...t, ...ev.cards] : t)), tricks: cur.tricks.map((t, i) => (i === ev.seat ? t + 1 : t)) };
        this.flyTo(next, ev.seat);
        this.show(next);
        Sound.step();
        await this.pause(300);
      } else if (ev.type === 'swap') {
        Sound.shuffle();
        await this.showBanner('Обмен картами', 700);
        this.show(v);
      } else if (ev.type === 'round') {
        Sound.win();
        await this.showBanner(ev.moon != null ? `${this.plain(ev.moon)} выстрелил в луну!` : 'Кон окончен', 1300);
      } else if (ev.type === 'deal') {
        Sound.shuffle();
      } else if (ev.type === 'end') {
        this.show(v);
        await this.showBanner(`Победил ${ev.winners.map((p) => this.plain(p)).join(', ')}`, 0);
      }
    }
    this.show(v);
  }

  status(v: View, toAct: number[], interactive: number[]) {
    if (v.phase === 'over') return 'Партия окончена';
    if (v.phase === 'pass') return interactive.length ? 'Выберите три карты для обмена' : 'Обмен картами…';
    const who = toAct[0];
    return interactive.includes(who) ? 'Ваш ход' : `Ходит ${this.ctx.name(who)}…`;
  }

  playerStats(v: View, seat: number) {
    return `штраф: ${v.score[seat]}`;
  }
}

export function createView(): GameView<View, Event> {
  return new HeartsView();
}
