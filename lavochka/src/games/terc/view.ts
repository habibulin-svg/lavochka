/* Терц — отрисовка на общем взяточном столе. Колода с открытым козырём сбоку, ход касанием карты; на своём заходе — кнопки
 * комбинаций («Терц от дамы ♥ +20»), марьяжа и обмена семёрки; на чужое объявление — «Годится» или «Рост!». */
import { Sound } from '../../core/audio';
import { h } from '../../core/util';
import type { GameView } from '../../core/view';
import { sameCard, SUIT_NAME, SUIT_SYM, type Card, type Suit } from '../../cards/deck';
import { TrickView, type TrickModel } from '../../cards/trickview';
import { available, canDeclare, canMarriage, canSwap, countOf, fritz, legal, other, rostCombo, type Event, type View } from './engine';
import { cn, comboText, SEATS } from './def';
import './terc.css';

const red = (s: Suit) => s === 'H' || s === 'D';
const sym = (s: Suit) => `<span class="${red(s) ? 'red' : ''}">${SUIT_SYM[s]}</span>`;
const plainText = (html: string) => html.replace(/<[^>]+>/g, '');
const comboHtml = (c: Parameters<typeof comboText>[0]) => `${comboText(c).replace(/[♠♣♥♦]$/, '')}${c.suit ? sym(c.suit) : ''}`;

class TercView extends TrickView<View, Event> {
  constructor() {
    super('tc', 'tc-cloth', SEATS);
  }

  protected model(v: View): TrickModel {
    const act = this.actSeat;
    const ok = act != null && v.phase === 'play' ? legal(v, act) : [];
    const stage = fritz(v) ? 'разбор фрица — в масть и перебить' : `в колоде ${v.stockLeft}${v.broken ? '' : ' · ещё не сломана'}`;
    return {
      seats: v.seats,
      hand: (p) => v.hands[p],
      count: (p) => countOf(v, p),
      trick: v.trick,
      turn: v.over ? null : v.turn,
      canPlay: (c) => ok.some((x) => sameCard(x, c)),
      plate: (p) => {
        const said = v.decls.filter((d) => d.seat === p && !d.burned && d.pts).length + (v.marriage[p] ? 1 : 0);
        return `<i title="Очки партии">🏆${v.score[p]}</i> · <b title="Очки взяток в этой сдаче">${v.pts[p]}</b>${said ? ` <span class="tc-said" title="Записанные комбинации">✎${said}</span>` : ''}`;
      },
      tricks: (p) => v.tricks[p],
      trump: v.trump,
      trumpCard: v.trumpCard,
      center: `Терц: козырь ${sym(v.trump)} ${SUIT_NAME[v.trump]}<small>${stage} · до ${v.cfg.target}</small>`,
    };
  }

  protected playAction(card: Card) {
    return { type: 'play', card };
  }

  protected override buttons(v: View, seat: number): boolean {
    if (v.phase === 'answer' && v.pending != null) {
      const d = v.decls[v.pending];
      const c = rostCombo(v, seat);
      this.btns.appendChild(h(`<div class="tv-ask">${this.plain(d.seat)}: «${comboHtml(d.combo)}!» — ${d.combo.pts}</div>`));
      this.button('Годится', c ? '' : 'primary', () => this.send({ type: 'answer', rost: false }));
      if (c) this.button(`Рост! ${comboHtml(c)} +${c.pts}`, 'primary', () => this.send({ type: 'answer', rost: true }));
      return true;
    }
    if (v.phase !== 'play') return false;
    const row = h('<div class="tc-row"></div>');
    let any = false;
    if (canDeclare(v, seat))
      for (const c of available(v, seat)) {
        this.button(`${comboHtml(c)} +${c.pts}`, '', () => this.send({ type: 'declare', combo: c }), false, row);
        any = true;
      }
    if (canMarriage(v, seat)) {
      this.button(`Марьяж ${sym(v.trump)} +20`, '', () => this.send({ type: 'marriage' }), false, row);
      any = true;
    }
    if (canSwap(v, seat)) {
      this.button(`Семёрку — на ${cn(v.trumpCard!)}`, '', () => this.send({ type: 'swap' }), false, row);
      any = true;
    }
    if (any) {
      if (canDeclare(v, seat) && available(v, seat).length) this.btns.appendChild(h('<div class="tv-ask">Можно объявить:</div>'));
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
        await this.pause(360);
      } else if (ev.type === 'trick') {
        await this.pause(600);
        const pts = cur.pts.slice();
        pts[ev.seat] += ev.pts;
        const next = { ...cur, trick: [], pts, tricks: cur.tricks.map((t, i) => (i === ev.seat ? t + 1 : t)), turn: ev.seat };
        this.flyTo(next, ev.seat);
        this.show(next);
        Sound.step();
        await this.pause(260);
      } else if (ev.type === 'draw') {
        const hands = cur.hands.map((hh, i) => (i === ev.seat && ev.card && hh.length === cur.counts[i] ? [...hh, ev.card] : hh));
        this.show({ ...cur, hands, counts: cur.counts.map((c, i) => (i === ev.seat ? c + 1 : c)), stockLeft: Math.max(0, cur.stockLeft - 1), trumpCard: ev.open ? null : cur.trumpCard });
        Sound.card();
        await this.pause(180);
      } else if (ev.type === 'break') {
        Sound.shuffle();
        await this.showBanner(`«Ломай!» — ${this.plain(ev.seat)} подснимает колоду`, 800);
      } else if (ev.type === 'fritz') {
        await this.showBanner('Колода кончилась — разбор фрица', 1100);
      } else if (ev.type === 'declare') {
        Sound.ui();
        await this.showBanner(`${this.plain(ev.seat)}: «${plainText(comboText(ev.combo))}!»`, 900);
      } else if (ev.type === 'answer') {
        if (ev.rost) Sound.win();
        else Sound.ui();
        await this.showBanner(ev.rost ? `${this.plain(ev.seat)}: «Рост!» ${comboText(ev.combo!)} +${ev.pts}` : `«Годится» — ${this.plain(ev.to)} +${ev.pts}`, 1000);
      } else if (ev.type === 'marriage') {
        Sound.win();
        await this.showBanner(`${this.plain(ev.seat)}: марьяж ${SUIT_SYM[v.trump]} +20`, 900);
      } else if (ev.type === 'swap') {
        this.show({ ...cur, trumpCard: ev.card, hands: cur.hands.map((hh, i) => (i === ev.seat && hh.length ? [...hh.filter((c) => !sameCard(c, ev.card)), ev.took] : hh)) });
        Sound.card();
        await this.showBanner(`${this.plain(ev.seat)} меняет семёрку на открытый козырь`, 900);
      } else if (ev.type === 'hand') {
        Sound.win();
        const [a, b] = v.seats;
        await this.showBanner(`Сдача: взятки ${ev.pts[a]} : ${ev.pts[b]} → +${ev.add[a]} : +${ev.add[b]}`, 1800);
      } else if (ev.type === 'deal') {
        Sound.shuffle();
        this.show({ ...v, trick: [] });
        await this.pause(300);
      } else if (ev.type === 'end') {
        this.show(v);
        const [a, b] = v.seats;
        await this.showBanner(`Партия — ${this.plain(ev.winner)} (${ev.score[a]} : ${ev.score[b]})`, 0);
      }
    }
    this.show(v);
  }

  status(v: View, toAct: number[], interactive: number[]) {
    if (v.over) return 'Партия окончена';
    const who = toAct[0];
    if (!interactive.includes(who)) return `Ходит ${this.ctx.name(who)}…`;
    if (v.phase === 'answer') return '«Годится» или «Рост»?';
    return v.trick.length ? 'Ваш ответ' : 'Ваш заход';
  }

  playerStats(v: View, seat: number) {
    return `очки: ${v.score[seat]}, во взятках: ${v.pts[seat]} (у соперника ${v.score[other(v, seat)]})`;
  }
}

export function createView(): GameView<View, Event> {
  return new TercView();
}
