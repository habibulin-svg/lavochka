/* Козёл — отрисовка на общем взяточном столе: напарники напротив (цвета пар — красные и синие), сверху — козырь и очки пар в коне,
 * на табличках — «рога» пары. Ход — касание подсвеченной карты. */
import { Sound } from '../../core/audio';
import type { GameView } from '../../core/view';
import { sameCard, SUIT_NAME, SUIT_SYM, type Card } from '../../cards/deck';
import { TrickView, type TrickModel } from '../../cards/trickview';
import { countOf, legal, POINTS, team, type Event, type View } from './engine';
import { SEATS } from './def';
import './kozel.css';

class KozelView extends TrickView<View, Event> {
  constructor() {
    super('kz', 'kz-cloth', SEATS);
  }

  protected model(v: View): TrickModel {
    const act = this.actSeat;
    const ok = act != null ? legal(v, act) : [];
    const red = v.trump === 'H' || v.trump === 'D';
    return {
      seats: v.seats,
      hand: (p) => v.hands[p],
      count: (p) => countOf(v, p),
      trick: v.trick,
      turn: v.over ? null : v.turn,
      canPlay: (c) => ok.some((x) => sameCard(x, c)),
      plate: (p) => `<i title="Рога пары">🐐 ${v.horns[team(p)]}</i>`,
      tricks: (p) => v.tricks[p],
      trump: v.trump,
      center: `Козырь: <span class="${red ? 'red' : ''}">${SUIT_SYM[v.trump]}</span> ${SUIT_NAME[v.trump]}<small>очки пар: ${v.pts[0]} — ${v.pts[1]}${v.eggs > 1 ? ` · кон ×${v.eggs}` : ''}</small>`,
    };
  }

  protected playAction(card: Card) {
    return { type: 'play', card };
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
        const pts = [...cur.pts] as [number, number];
        pts[team(ev.seat)] += ev.cards.reduce((x, c) => x + POINTS[c.r], 0);
        const next = { ...cur, trick: [], pts, tricks: cur.tricks.map((t, i) => (i === ev.seat ? t + 1 : t)) };
        this.flyTo(next, ev.seat);
        this.show(next);
        Sound.step();
        await this.pause(300);
      } else if (ev.type === 'round') {
        Sound.win();
        await this.showBanner(ev.eggs ? `«Яйца»: ${ev.pts[0]} на ${ev.pts[1]}` : `Кон: ${ev.pts[0]} — ${ev.pts[1]}`, 1400);
      } else if (ev.type === 'deal') {
        Sound.shuffle();
        this.show({ ...v, trick: [] });
      } else if (ev.type === 'end') {
        this.show(v);
        await this.showBanner(`Козлы: ${this.plain(ev.loser)} и ${this.plain(ev.loser + 2)}`, 0);
      }
    }
    this.show(v);
  }

  status(v: View, toAct: number[], interactive: number[]) {
    if (v.over) return 'Партия окончена';
    const who = toAct[0];
    return interactive.includes(who) ? 'Ваш ход' : `Ходит ${this.ctx.name(who)}…`;
  }

  playerStats(v: View, seat: number) {
    return `рога пары: ${v.horns[team(seat)]}`;
  }
}

export function createView(): GameView<View, Event> {
  return new KozelView();
}
