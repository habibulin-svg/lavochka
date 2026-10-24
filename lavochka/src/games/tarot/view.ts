/* Французское таро — отрисовка на общем взяточном столе (3–5 мест) колодой Уэйта — Смит с индексами в углу
 * (public/tarot/rws/game): торги кнопками, впятером — вызов короля, открытый прикуп посередине, снос касанием карт,
 * пуанье — кнопкой перед первой картой. Ход — касание карты. */
import { Sound } from '../../core/audio';
import { h } from '../../core/util';
import type { GameView } from '../../core/view';
import type { Card } from '../../cards/deck';
import { TrickView, type TrickModel } from '../../cards/trickview';
import { isMajor, rankOf, suitOf, tarotFile, tarotName } from '../../cards/tarot';
import { TARO_BACK, taroFromStage, taroToStage } from '../gadanie/faces';
import { canCall, canDiscard, chienSize, CONTRACT_RU, CONTRACTS, countOf, deals, EXCUSE, legal, poigneeMax, POIGNEE, asksPoignee, topBid, type Event, type View } from './engine';
import { SEATS, cardRu } from './def';
import './tarot.css';

const BASE = import.meta.env.BASE_URL;
const gameUrl = (c: number) => `${BASE}tarot/rws/game/${tarotFile(c)}.webp`;
const toC = taroToStage;
const fromC = taroFromStage;
const ORDER = { W: 0, C: 1, S: 2, P: 3 } as Record<string, number>;
/** Рука: масти по порядку, козыри справа по возрастанию, Эскюз — с краю. */
const sortKey = (c: number) => (c === EXCUSE ? 999 : isMajor(c) ? 500 + c : ORDER[suitOf(c)!] * 20 + rankOf(c));

class TarotView extends TrickView<View, Event> {
  constructor() {
    super('ta', 'ta-cloth', SEATS, {
      card: { w: 100, h: 171 },
      faces: { url: (c) => (c ? gameUrl(fromC(c)) : TARO_BACK), alt: (c) => (c ? tarotName(fromC(c)) : 'рубашка') },
    });
  }

  protected model(v: View): TrickModel {
    const act = this.actSeat;
    const k = chienSize(v.seats.length);
    const ok: number[] =
      act == null ? [] : v.phase === 'play' && !asksPoignee(v, act) ? legal(v, act) : v.phase === 'discard' ? v.hands[act].filter((c) => canDiscard(v.hands[act], c, k)) : [];
    const center = v.contract
      ? `${CONTRACT_RU[v.contract]}<small>играет ${this.plain(v.taker!)}${v.called != null ? ` · зовёт ${cardRu(v.called)}` : ''}${v.partner != null && v.partnerShown ? ` с ${this.plain(v.partner)}` : ''} · сдача ${v.deal} из ${deals(v)}</small>`
      : `Торги<small>сдача ${v.deal} из ${deals(v)}</small>`;
    return {
      seats: v.seats,
      hand: (p) => v.hands[p].map(toC),
      count: (p) => countOf(v, p),
      trick: v.trick.map((t) => ({ seat: t.seat, card: toC(t.card) })),
      turn: v.over ? null : v.turn,
      canPlay: (c) => ok.includes(fromC(c)),
      plate: (p) =>
        `<i>${v.score[p]}</i>${v.taker === p ? ' <b>★</b>' : ''}${v.partner === p && v.partnerShown ? ' <b>☆</b>' : ''}${v.phase === 'bid' && v.bids[p] != null ? ` ${v.bids[p] ? CONTRACT_RU[v.bids[p] as 1] : 'пас'}` : ''}${v.poignee[p] ? ' ✋' : ''}`,
      tricks: (p) => v.tricks[p],
      sort: (cs) => cs.slice().sort((a, b) => sortKey(fromC(a)) - sortKey(fromC(b))),
      center,
      twoRows: true,
    };
  }

  protected playAction(card: Card) {
    return { type: 'play', card: fromC(card) };
  }

  protected override onCard(card: Card) {
    if (this.v!.phase === 'discard') return this.toggle(card, chienSize(this.v!.seats.length));
    this.send({ type: 'play', card: fromC(card) });
  }

  protected override buttons(v: View, seat: number): boolean {
    if (v.phase === 'bid') {
      const top = topBid(v);
      this.btns.appendChild(h(`<div class="tv-ask">${top ? `Старшая заявка: ${CONTRACT_RU[top as 1]}.` : 'Заявок пока нет.'} Ваше слово?</div>`));
      for (const c of CONTRACTS) if (c > top) this.button(`${CONTRACT_RU[c][0].toUpperCase() + CONTRACT_RU[c].slice(1)} · ×${c}`, c === CONTRACTS.find((x) => x > top) ? 'primary' : '', () => this.send({ type: 'bid', c }));
      this.button('Пас', '', () => this.send({ type: 'pass' }));
      return true;
    }
    if (v.phase === 'call') {
      this.btns.appendChild(h('<div class="tv-ask">Назовите короля — у кого он, тот ваш тайный напарник (свой король — играете один против всех).</div>'));
      for (const c of canCall(v, seat)) this.button(cardRu(c), '', () => this.send({ type: 'call', card: c }));
      return true;
    }
    if (v.phase === 'discard') {
      const k = chienSize(v.seats.length);
      this.btns.appendChild(h(`<div class="tv-ask">Прикуп у вас. Выберите ${k} карт в снос — их очки ваши (королей и удлеров нельзя).</div>`));
      this.button(`Снести (${this.selected.length} из ${k})`, 'primary', () => this.send({ type: 'discard', cards: this.selected.map(fromC) }), this.selected.length !== k);
      return true;
    }
    if (v.phase === 'play' && asksPoignee(v, seat)) {
      const max = poigneeMax(v, seat);
      const need = POIGNEE[v.seats.length] ?? POIGNEE[4];
      this.btns.appendChild(h(`<div class="tv-ask">У вас много козырей — можно объявить пуанье (премия стороне, что выиграет заявку; козыри покажут всем).</div>`));
      for (let lv = max; lv >= 1; lv--) this.button(`${['', 'Одинарная', 'Двойная', 'Тройная'][lv]} — ${need[lv - 1]} козырей`, lv === max ? 'primary' : '', () => this.send({ type: 'poignee', level: lv }));
      this.button('Не объявлять', '', () => this.send({ type: 'poignee', level: 0 }));
      return true;
    }
    return false;
  }

  async play(events: Event[], v: View) {
    this.clearTurn();
    for (const ev of events) {
      const cur = this.v!;
      if (ev.type === 'play') {
        this.show({ ...cur, trick: [...cur.trick, { seat: ev.seat, card: ev.card }], hands: cur.hands.map((hh, i) => (i === ev.seat ? hh.filter((c) => c !== ev.card) : hh)), counts: cur.counts.map((c, i) => (i === ev.seat ? c - 1 : c)), turn: ev.seat });
        Sound.card();
        await this.pause(300);
      } else if (ev.type === 'trick') {
        await this.pause(560);
        const next = { ...cur, trick: [], tricks: cur.tricks.map((t, i) => (i === ev.seat ? t + 1 : t)) };
        this.flyTo(next, ev.seat);
        this.show(next);
        Sound.step();
        await this.pause(240);
      } else if (ev.type === 'bid' || ev.type === 'pass') {
        Sound.ui();
        await this.showBanner(`${this.plain(ev.seat)}: ${ev.type === 'bid' ? CONTRACT_RU[ev.c] : 'пас'}`, 500);
      } else if (ev.type === 'won') {
        await this.showBanner(`Играет ${this.plain(ev.seat)} — ${CONTRACT_RU[ev.c]}`, 900);
      } else if (ev.type === 'call') {
        await this.showBanner(`${this.plain(ev.seat)} зовёт: ${cardRu(ev.card)}`, 1000);
      } else if (ev.type === 'chien') {
        if (ev.cards) {
          // прикуп открывают всем — полежит посередине
          this.cs.over.querySelector('.ta-chien')?.remove();
          this.show({ ...cur, trick: [] });
          await this.showChien(ev.cards);
        } else await this.showBanner(ev.to === 'taker' ? 'Прикуп — взявшему, не глядя' : 'Прикуп — защите', 900);
      } else if (ev.type === 'discard') {
        if (ev.trumps.length) await this.showBanner(`В сносе козыри: ${ev.trumps.map(cardRu).join(', ')}`, 1200);
      } else if (ev.type === 'poignee') {
        Sound.win();
        await this.showBanner(`${this.plain(ev.seat)}: пуанье — ${ev.cards.length} козырей`, 1200);
      } else if (ev.type === 'partner') {
        await this.showBanner(`Напарник — ${this.plain(ev.seat)}!`, 1000);
      } else if (ev.type === 'redeal') {
        await this.showBanner('Все спасовали — пересдача', 800);
      } else if (ev.type === 'petitSec') {
        await this.showBanner(`У ${this.plain(ev.seat)} пти сек — пересдача`, 900);
      } else if (ev.type === 'hand') {
        Sound.win();
        const r = ev.res;
        await this.showBanner(`${this.plain(r.taker)}: ${r.won ? 'выиграл' : 'проиграл'} — ${r.pts} из ${r.need} · ${r.add[r.taker] > 0 ? '+' : ''}${r.add[r.taker]}`, 2200);
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

  /** Открытый прикуп: ряд карт посередине на пару секунд. */
  private async showChien(cards: number[]) {
    const box = h(`<div class="ta-chien">${cards.map((c) => `<img src="${gameUrl(c)}" alt="${tarotName(c)}">`).join('')}<small>прикуп</small></div>`);
    this.cs.over.appendChild(box);
    await this.pause(2200);
    box.remove();
  }

  status(v: View, toAct: number[], interactive: number[]) {
    if (v.over) return 'Партия окончена';
    const who = toAct[0];
    if (!interactive.includes(who)) return `Ходит ${this.ctx.name(who)}…`;
    return v.phase === 'play' ? (asksPoignee(v, who) ? 'Пуанье?' : 'Ваш ход') : v.phase === 'bid' ? 'Торги' : v.phase === 'discard' ? 'Снесите прикуп' : 'Назовите короля';
  }

  playerStats(v: View, seat: number) {
    return `очки: ${v.score[seat]}`;
  }
}

export function createView(): GameView<View, Event> {
  return new TarotView();
}
