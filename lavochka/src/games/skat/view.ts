/* Скат — отрисовка на общем взяточном столе (втроём): торги кнопками («18!», «да», «пас»), скат — взять или играть с руки,
 * снос двух карт касанием, объявление игры (масти, гранд, нуль; с руки — шнайдер, шварц, открытая). Ход — касание карты. */
import { Sound } from '../../core/audio';
import { h } from '../../core/util';
import type { GameView } from '../../core/view';
import { sameCard, SUIT_NAME, SUIT_SYM, SUITS, type Card, type Suit } from '../../cards/deck';
import { TrickView, type TrickModel } from '../../cards/trickview';
import { BASE, countOf, legal, nextBid, type Contract, type Event, type GameKind, type View } from './engine';
import { SEATS, GAME_RU } from './def';
import './skat.css';

/** Рука по-скатовски: масти, козырная правее, вальты — справа; в нуле вальты на своих местах. */
function skatSort(hand: Card[], k?: GameKind): Card[] {
  const ORDER = k === 'null' ? [7, 8, 9, 10, 11, 12, 13, 14] : [7, 8, 9, 12, 13, 10, 14];
  const JACK = { D: 0, H: 1, S: 2, C: 3 } as Record<Suit, number>;
  const key = (c: Card) => (c.r === 11 && k !== 'null' ? 1000 + JACK[c.s] : (c.s === k ? 500 : SUITS.indexOf(c.s) * 100) + ORDER.indexOf(c.r));
  return hand.slice().sort((a, b) => key(a) - key(b));
}

const sym = (s: Suit) => `<span class="${s === 'H' || s === 'D' ? 'red' : ''}">${SUIT_SYM[s]}</span>`;

class SkatView extends TrickView<View, Event> {
  private extras: { schneider: boolean; schwarz: boolean; ouvert: boolean } = { schneider: false, schwarz: false, ouvert: false };

  constructor() {
    super('sk', 'sk-cloth', SEATS);
  }

  protected model(v: View): TrickModel {
    const act = this.actSeat;
    const ok = act != null && v.phase === 'play' ? legal(v, act) : act != null && v.phase === 'discard' ? v.hands[act] : [];
    const k = v.contract?.kind;
    const center = k
      ? `${GAME_RU(k)}${v.contract!.hand ? ' с руки' : ''}<small>играет ${this.plain(v.declarer!)} · заявка ${v.bid} · сдача ${v.deal} из ${v.cfg.deals}</small>`
      : `Торги${v.bid ? `: ${v.bid}` : ''}<small>сдача ${v.deal} из ${v.cfg.deals}</small>`;
    return {
      seats: v.seats,
      hand: (p) => v.hands[p],
      count: (p) => countOf(v, p),
      trick: v.trick,
      turn: v.over ? null : v.turn,
      canPlay: (c) => ok.some((x) => sameCard(x, c)),
      plate: (p) => `<i>${v.score[p]}</i>${v.declarer === p ? ' <b>★</b>' : ''}${v.phase === 'bid' && v.passed.includes(p) ? ' пас' : ''}`,
      tricks: (p) => v.tricks[p],
      trump: k && k !== 'grand' && k !== 'null' ? k : undefined,
      sort: (cs) => skatSort(cs, k),
      center,
      open: (p) => !!v.contract?.ouvert && p === v.declarer,
    };
  }

  protected playAction(card: Card) {
    return { type: 'play', card };
  }

  protected override onCard(card: Card) {
    if (this.v!.phase === 'discard') return this.toggle(card, 2);
    this.send({ type: 'play', card });
  }

  protected override clearTurn() {
    super.clearTurn();
    this.extras = { schneider: false, schwarz: false, ouvert: false };
  }

  protected override buttons(v: View, seat: number): boolean {
    if (v.phase === 'bid') {
      if (v.bidStage === 3) {
        this.btns.appendChild(h('<div class="tv-ask">Все спасовали. Сыграете за 18?</div>'));
        this.button('Играю за 18', 'primary', () => this.send({ type: 'bid', n: 18 }));
        this.button('Пас — пересдача', '', () => this.send({ type: 'pass' }));
        return true;
      }
      if (seat === v.asker) {
        const n = nextBid(v);
        this.btns.appendChild(h(`<div class="tv-ask">Торгуйтесь с ${this.plain(v.listener!)}: назовите ${n} или пас.</div>`));
        this.button(`${n}!`, 'primary', () => this.send({ type: 'bid', n }));
      } else {
        this.btns.appendChild(h(`<div class="tv-ask">${this.plain(v.asker!)} называет ${v.bid}. Держите?</div>`));
        this.button(`Да (${v.bid})`, 'primary', () => this.send({ type: 'hold' }));
      }
      this.button('Пас', '', () => this.send({ type: 'pass' }));
      return true;
    }
    if (v.phase === 'skat') {
      this.btns.appendChild(h(`<div class="tv-ask">Заявка ваша: ${v.bid}. Берёте скат или играете с руки (+1 к множителю)?</div>`));
      this.button('Взять скат', 'primary', () => this.send({ type: 'skat', take: true }));
      this.button('С руки', '', () => this.send({ type: 'skat', take: false }));
      return true;
    }
    if (v.phase === 'discard') {
      this.btns.appendChild(h('<div class="tv-ask">Выберите две карты в снос — их очки ваши.</div>'));
      this.button(`Снести (${this.selected.length} из 2)`, 'primary', () => this.send({ type: 'discard', cards: this.selected.slice() }), this.selected.length !== 2);
      return true;
    }
    if (v.phase === 'declare') {
      const hand = v.handGame;
      this.btns.appendChild(h(`<div class="tv-ask">Объявите игру (заявка ${v.bid}).</div>`));
      const send = (kind: GameKind) => {
        const c: Contract = { kind, hand, schneider: this.extras.schneider, schwarz: this.extras.schwarz, ouvert: this.extras.ouvert };
        this.send({ type: 'declare', contract: c });
      };
      for (const s of ['C', 'S', 'H', 'D'] as Suit[]) this.button(`${sym(s)} ${SUIT_NAME[s]} · ${BASE[s]}`, '', () => send(s));
      this.button(`Гранд · ${BASE.grand}`, '', () => send('grand'));
      this.button(`Нуль · ${hand ? (this.extras.ouvert ? 59 : 35) : 23}`, '', () => send('null'));
      if (hand) {
        const row = h('<div class="sk-row"></div>');
        for (const [key, label] of [
          ['schneider', 'шнайдер'],
          ['schwarz', 'шварц'],
          ['ouvert', 'открытая'],
        ] as const)
          this.button(`${this.extras[key] ? '☑' : '☐'} ${label}`, 'sk-opt', () => {
            this.extras[key] = !this.extras[key];
            this.renderButtons();
          }, false, row);
        this.btns.appendChild(row);
      }
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
        await this.pause(320);
      } else if (ev.type === 'trick') {
        await this.pause(560);
        const next = { ...cur, trick: [], tricks: cur.tricks.map((t, i) => (i === ev.seat ? t + 1 : t)) };
        this.flyTo(next, ev.seat);
        this.show(next);
        Sound.step();
        await this.pause(250);
      } else if (ev.type === 'bid' || ev.type === 'hold' || ev.type === 'pass') {
        Sound.ui();
        await this.showBanner(`${this.plain(ev.seat)}: ${ev.type === 'bid' ? `${ev.n}!` : ev.type === 'hold' ? 'да' : 'пас'}`, 450);
      } else if (ev.type === 'won') {
        await this.showBanner(`Играет ${this.plain(ev.seat)} — ${ev.bid}`, 800);
      } else if (ev.type === 'declare') {
        Sound.win();
        await this.showBanner(`${this.plain(ev.seat)}: ${GAME_RU(ev.contract.kind)}${ev.contract.hand ? ' с руки' : ''}`, 1000);
      } else if (ev.type === 'redeal') {
        await this.showBanner('Все спасовали — пересдача', 800);
      } else if (ev.type === 'hand') {
        Sound.win();
        await this.showBanner(`${ev.won ? 'Выиграл' : 'Проиграл'}: ${ev.value}${ev.lines.length ? ` (${ev.lines.join(', ')})` : ''} · очков ${ev.pts}`, 2000);
      } else if (ev.type === 'deal') {
        Sound.shuffle();
        this.show({ ...v, trick: [] });
      } else if (ev.type === 'end') {
        this.show(v);
        await this.showBanner(`Партия — ${this.plain(ev.winner)}`, 0);
      }
    }
    this.show(v);
  }

  status(v: View, toAct: number[], interactive: number[]) {
    if (v.over) return 'Партия окончена';
    const who = toAct[0];
    if (!interactive.includes(who)) return `Ходит ${this.ctx.name(who)}…`;
    return v.phase === 'play' ? 'Ваш ход' : v.phase === 'bid' ? 'Торги' : v.phase === 'discard' ? 'Снесите две карты' : v.phase === 'declare' ? 'Объявите игру' : 'Скат';
  }

  playerStats(v: View, seat: number) {
    return `очки: ${v.score[seat]}`;
  }
}

export function createView(): GameView<View, Event> {
  return new SkatView();
}
