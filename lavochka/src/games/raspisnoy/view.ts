/* Расписной покер — отрисовка на общем взяточном столе. Табличка сверху — вид сдачи, сколько карт, козырь, сумма заказов;
 * козырь открыт у колоды. Заказ — кнопками (запрещённый сдающему погашен); касание джокера открывает его объявления.
 * На табличках — очки за партию и «взял/заказ». В лобовой чужие карты лежат открыто, своя — рубашкой. */
import { Sound } from '../../core/audio';
import { h } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { sameCard, SUIT_SYM, SUITS, type Card } from '../../cards/deck';
import { TrickView, type TrickModel } from '../../cards/trickview';
import { bidOptions, countOf, cur, isJoker, jokerChoices, KIND_NAME, legal, noBid, trumpOf, type Event, type JokerPlay, type View } from './engine';
import { jokerLabel, jokerSay, SEATS, trumpName } from './def';
import { rospisHTML } from './rospis';
import './raspisnoy.css';

class RaspisnoyView extends TrickView<View, Event> {
  /** Касание джокера: ждём объявления. */
  private joker: Card | null = null;
  private sheet!: HTMLElement;

  constructor() {
    super('rp', 'rp-cloth', SEATS);
  }

  override mount(root: HTMLElement, ctx: ViewCtx) {
    super.mount(root, ctx);
    this.sheet = h('<div class="rp-sheet"></div>');
    ctx.controls.appendChild(this.sheet);
  }

  protected override draw() {
    super.draw();
    const v = this.v;
    if (!v || !this.sheet) return;
    const i0 = Math.max(0, v.seats.indexOf(this.viewer));
    const order = v.seats.map((_, k) => v.seats[(i0 + k) % v.seats.length]);
    const keep = (this.sheet.querySelector('.rs-wrap') as HTMLElement | null)?.scrollTop;
    this.sheet.innerHTML = '<div class="rp-sheet-t">Роспись</div>' + rospisHTML(v, order.map((p) => ({ seat: p, name: this.plain(p).replace(/\s*\(.*\)\s*$/, '').slice(0, 7), color: SEATS[p].ink ?? SEATS[p].color })));
    const wrap = this.sheet.querySelector('.rs-wrap') as HTMLElement;
    const cur = (wrap.querySelector('tr.cur') ?? wrap.querySelector('tr.done:last-of-type')) as HTMLElement | null;
    if (cur) wrap.scrollTop = Math.max(0, cur.offsetTop - wrap.clientHeight / 2);
    else if (keep) wrap.scrollTop = keep;
  }

  protected model(v: View): TrickModel {
    const act = this.actSeat;
    const ok = act != null && v.phase === 'play' ? legal(v, act) : [];
    const d = cur(v);
    const sum = v.seats.reduce((a, p) => a + (v.bids[p] ?? 0), 0);
    const tr = v.cfg.circular ? (v.trick.length ? trumpOf(v, v.trick) : null) : v.trump;
    const trumpTxt = v.cfg.circular ? (tr ? `козырь взятки — ${SUIT_SYM[tr]}` : 'круговые козыри') : trumpName(v.trump);
    const lob = v.blind && d.kind === 'lob';
    return {
      seats: v.seats,
      hand: (p) => (v.blind && p === this.viewer ? [] : v.hands[p]),
      count: (p) => countOf(v, p),
      trick: v.trick,
      turn: v.phase === 'over' ? null : v.turn,
      canPlay: (c) => ok.some((x) => sameCard(x, c)),
      plate: (p) => {
        const b = v.bids[p];
        const tk = noBid(d.kind) ? `${v.tricks[p]}` : b == null ? '' : `${v.tricks[p]}/${b || 'пас'}`;
        return `<i title="Очки за партию">${v.score[p]}</i>${tk ? ` <em title="Взял / заказ">${tk}</em>` : ''}`;
      },
      tricks: (p) => v.tricks[p],
      trump: tr,
      trumpCard: v.trumpCard,
      open: (p) => lob && v.hands[p].length > 0,
      center: `${KIND_NAME[d.kind]} · по ${d.cards}<small>сдача ${Math.min(v.deal + 1, v.plan.length)} из ${v.plan.length} · ${trumpTxt}${noBid(d.kind) ? '' : ` · заказано ${sum} из ${d.cards}`}</small>`,
    };
  }

  protected playAction(card: Card) {
    return { type: 'play', card };
  }

  protected override onCard(card: Card) {
    const v = this.v;
    if (v && isJoker(v.cfg, card)) {
      this.joker = card;
      this.selected = [card];
      Sound.ui();
      this.draw();
      this.renderButtons();
      return;
    }
    this.send({ type: 'play', card });
  }

  protected override clearTurn() {
    this.joker = null;
    super.clearTurn();
  }

  protected override buttons(v: View, seat: number): boolean {
    if (v.phase === 'bid') {
      const d = cur(v);
      const ok = bidOptions(v, seat);
      const ask = v.blind ? (d.kind === 'lob' ? 'Своей карты не видно — смотрите на чужие. ' : 'Тёмная: заказ не глядя в карты. ') : '';
      this.btns.appendChild(h(`<div class="tv-ask">${ask}Сколько взяток возьмёте?</div>`));
      const grid = h('<div class="tv-grid"></div>');
      for (let n = 0; n <= d.cards; n++) this.button(n ? String(n) : 'Пас', '', () => this.send({ type: 'bid', n }), !ok.includes(n), grid);
      this.btns.appendChild(grid);
      if (seat === v.dealer && ok.length <= d.cards) this.btns.appendChild(h(`<div class="rp-note">Вы сдаёте: сумма заказов не должна быть равна ${d.cards}.</div>`));
      return true;
    }
    if (this.joker) {
      const card = this.joker;
      const trump = v.cfg.circular ? null : v.trump;
      this.btns.appendChild(h('<div class="tv-ask">Джокер! Что объявляете?</div>'));
      const say = (j: JokerPlay) => this.send({ type: 'play', card, joker: j });
      if (v.trick.length) {
        this.button('Забираю взятку', 'primary', () => say({ mode: 'high' }));
        this.button('Скидываю (младше всего)', '', () => say({ mode: 'low' }));
      } else {
        const ch = jokerChoices(v);
        if (trump) this.button('По старшим козырям!', 'primary', () => say({ mode: 'want', suit: trump }));
        this.btns.appendChild(h('<div class="rp-note">По старшим картам масти (берёт джокер, если не перебьют козырем):</div>'));
        const g1 = h('<div class="tv-grid"></div>');
        for (const s of SUITS) if (s !== trump && ch.some((j) => j.mode === 'want' && j.suit === s)) this.button(SUIT_SYM[s], s === 'H' || s === 'D' ? 'red' : '', () => say({ mode: 'want', suit: s }), false, g1);
        this.btns.appendChild(g1);
        this.btns.appendChild(h('<div class="rp-note">За младшую карту масти (не брать):</div>'));
        const g2 = h('<div class="tv-grid"></div>');
        for (const s of SUITS) this.button(SUIT_SYM[s], s === 'H' || s === 'D' ? 'red' : '', () => say({ mode: 'low', suit: s }), false, g2);
        this.btns.appendChild(g2);
      }
      this.button('Отмена', '', () => {
        this.joker = null;
        this.selected = [];
        this.draw();
        this.renderButtons();
      });
      return true;
    }
    return false;
  }

  async play(events: Event[], v: View) {
    this.clearTurn();
    for (const ev of events) {
      const cur0 = this.v!;
      if (ev.type === 'bid') {
        this.show({ ...cur0, bids: cur0.bids.map((b, i) => (i === ev.seat ? ev.n : b)), turn: ev.seat });
        Sound.ui();
        await this.pause(380);
      } else if (ev.type === 'play') {
        this.show({ ...cur0, trick: [...cur0.trick, { seat: ev.seat, card: ev.card, joker: ev.joker }], hands: cur0.hands.map((hh, i) => (i === ev.seat ? hh.filter((c) => !sameCard(c, ev.card)) : hh)), counts: cur0.counts.map((c, i) => (i === ev.seat ? c - 1 : c)), turn: ev.seat });
        Sound.card();
        if (ev.joker) await this.showBanner(`Джокер: ${jokerSay(ev.joker, cur0.cfg.circular ? null : cur0.trump)}`, 1000);
        else await this.pause(330);
      } else if (ev.type === 'trick') {
        await this.pause(650);
        const next = { ...cur0, trick: [], tricks: cur0.tricks.map((t, i) => (i === ev.seat ? t + 1 : t)) };
        this.flyTo(next, ev.seat);
        this.show(next);
        Sound.step();
        await this.pause(300);
      } else if (ev.type === 'round') {
        Sound.win();
        const best = Math.max(...cur0.seats.map((p) => ev.add[p]));
        const who = cur0.seats.filter((p) => ev.add[p] === best && best > 0).map((p) => this.plain(p));
        await this.showBanner(who.length ? `Сдача окончена · лучше всех ${who.join(', ')} (+${best})` : 'Сдача окончена', 1300);
      } else if (ev.type === 'deal') {
        Sound.shuffle();
        this.show({ ...v, trick: [] });
        await this.showBanner(`${KIND_NAME[ev.kind]}: по ${ev.cards}`, 800);
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
    if (v.phase === 'bid') return mine ? 'Ваш заказ' : `${this.ctx.name(who)} заказывает…`;
    return mine ? 'Ваш ход' : `Ходит ${this.ctx.name(who)}…`;
  }

  playerStats(v: View, seat: number) {
    return `очки: ${v.score[seat]} · ${jokerLabel(v.cfg)}`;
  }
}

export function createView(): GameView<View, Event> {
  return new RaspisnoyView();
}
