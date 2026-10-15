/* Бридж — отрисовка на общем взяточном столе: свой веер внизу, партнёр напротив; болван после первого хода лежит открыто и
 * крупно — когда разыгрываете вы, его карты касаются, как свои. Торговля — коробка заявок в панели (только допустимые),
 * под ней протокол торговли (З С В Ю) и запись «мы / они». */
import { Sound } from '../../core/audio';
import { esc, h } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { sameCard, type Card } from '../../cards/deck';
import { TrickView, type TrickModel } from '../../cards/trickview';
import { controller, countOf, legal, legalCall, side, STRAINS, trumpOf, vulnerable, type Call, type Event, type Strain, type View } from './engine';
import { callText, contractText, DIR, SEATS, STRAIN_SYM } from './def';
import './bridge.css';

class BridgeView extends TrickView<View, Event> {
  private sheet!: HTMLElement;

  constructor() {
    super('br', 'br-cloth', SEATS);
  }

  override mount(root: HTMLElement, ctx: ViewCtx) {
    super.mount(root, ctx);
    this.sheet = h('<div class="bg-sheet"></div>');
    ctx.controls.appendChild(this.sheet);
  }

  protected override draw() {
    super.draw();
    if (this.v && this.sheet) this.sheet.innerHTML = this.sheetHTML(this.v);
  }

  private sheetHTML(v: View): string {
    // протокол торговли: столбцы З С В Ю, первая строка — со сдающего
    const order = [1, 2, 3, 0];
    const cells: string[] = [];
    for (let i = 0; i < order.indexOf(v.dealer); i++) cells.push('');
    for (const c of v.calls) cells.push(`<span title="${esc(c.note ?? '')}">${callText(c.call)}</span>`);
    if (v.phase === 'auction') cells.push('<i>?</i>');
    let rows = '';
    for (let i = 0; i < cells.length; i += 4) rows += `<tr>${[0, 1, 2, 3].map((k) => `<td>${cells[i + k] ?? ''}</td>`).join('')}</tr>`;
    const head = order.map((p) => `<th style="color:${SEATS[p].color}">${DIR[p][0]}</th>`).join('');
    const auction = v.calls.length || v.phase === 'auction' ? `<table class="bg-auction"><tr>${head}</tr>${rows}</table>` : '';
    // запись
    let rec = '';
    if (v.cfg.format === 'rubber') {
      rec = `<table class="bg-rubber"><tr><th>мы</th><th>они</th></tr>
        <tr class="above"><td>${v.above[0]}</td><td>${v.above[1]}</td></tr>
        <tr class="below"><td>${v.below[0]}${v.games[0] ? ` <small>гейм×${v.games[0]}</small>` : ''}</td><td>${v.below[1]}${v.games[1] ? ` <small>гейм×${v.games[1]}</small>` : ''}</td></tr>
        <tr class="tot"><td>${v.total[0]}</td><td>${v.total[1]}</td></tr></table>`;
    } else {
      const unit = v.cfg.format === 'duplicate' ? 'IMP' : '';
      rec = `<table class="bg-rubber"><tr><th>№</th><th>контракт</th><th>мы</th><th>они</th></tr>${v.results
        .map((r) => {
          const val = r.imp ?? r.score;
          return `<tr><td>${r.board + 1}</td><td>${contractText(r.contract)}${r.contract ? ` ${DIR[r.contract.declarer][0]}` : ''}</td><td>${val > 0 ? val : ''}</td><td>${val < 0 ? -val : ''}</td></tr>`;
        })
        .join('')}<tr class="tot"><td></td><td>итого ${unit}</td><td>${v.total[0]}</td><td>${v.total[1]}</td></tr></table>`;
    }
    return `${auction}${rec}`;
  }

  protected model(v: View): TrickModel {
    const act = this.actSeat;
    const ctrl = v.phase === 'play' ? controller(v, v.turn) : -1;
    const ok = act != null && act === ctrl ? legal(v, v.turn) : [];
    const ct = v.contract;
    const vul = vulnerable(v);
    const tr = trumpOf(v);
    let center: string;
    if (v.phase === 'auction') center = `Торговля<small>сдача ${v.board + 1} · зона: ${vul[0] && vul[1] ? 'обе' : vul[0] ? 'мы' : vul[1] ? 'они' : 'никто'}</small>`;
    else if (v.phase === 'mini') center = `Мини-бридж<small>очки: мы ${v.hcp[0] + v.hcp[2]} — они ${v.hcp[1] + v.hcp[3]} · выбирает ${esc(this.plain(controller(v, v.turn)))}</small>`;
    else if (ct) {
      const red = ct.strain === 'H' || ct.strain === 'D';
      center = `<span class="${red ? 'red' : ''}">${contractText(ct)}</span> · ${DIR[ct.declarer]}<small>взяток: мы ${v.tricks[0]} — они ${v.tricks[1]} · нужно ${ct.level + 6}</small>`;
    } else center = 'Сдача окончена';
    return {
      seats: v.seats,
      hand: (p) => v.hands[p],
      count: (p) => countOf(v, p),
      trick: v.trick,
      turn: v.phase === 'over' ? null : v.turn,
      canPlay: (c) => ok.some((x) => sameCard(x, c)),
      plate: (p) => {
        const tags = [DIR[p]];
        if (ct && ct.declarer === p) tags.push('разыгрывает');
        if (v.dummy === p && v.phase !== 'auction') tags.push('болван');
        if (v.cfg.format === 'mini' && v.phase !== 'auction') tags.push(`${v.hcp[p]} оч.`);
        return `<em>${tags.join(' · ')}</em>`;
      },
      // стопки взяток: у разыгрывающего — взятки его пары, у его соседа слева — взятки защиты
      tricks: (p) => (v.phase === 'play' && ct && (p === ct.declarer || p === (ct.declarer + 1) % 4) ? v.tricks[side(p)] : 0),
      trump: tr,
      center,
      open: (p) => p === v.dummy && v.dummyUp,
      openBig: true,
      playFrom: (p) => p === v.dummy && v.phase === 'play' && v.turn === v.dummy && act === ctrl,
    };
  }

  protected playAction(card: Card) {
    return { type: 'play', card };
  }

  protected override buttons(v: View, seat: number): boolean {
    if (v.phase === 'auction') {
      this.btns.appendChild(h(`<div class="tv-ask">Ваша заявка:</div>`));
      const grid = h('<div class="bg-box"></div>');
      for (let lv = 1; lv <= 7; lv++)
        for (const st of STRAINS) {
          const c: Call = { type: 'bid', level: lv, strain: st };
          if (!legalCall(v, seat, c)) continue;
          this.button(`${lv}${STRAIN_SYM[st]}`, st === 'H' || st === 'D' ? 'red' : '', () => this.send(c), false, grid);
        }
      this.btns.appendChild(grid);
      const row = h('<div class="bg-row"></div>');
      this.button('Пас', 'primary', () => this.send({ type: 'pass' }), false, row);
      if (legalCall(v, seat, { type: 'double' })) this.button('Контра', '', () => this.send({ type: 'double' }), false, row);
      if (legalCall(v, seat, { type: 'redouble' })) this.button('Реконтра', '', () => this.send({ type: 'redouble' }), false, row);
      this.btns.appendChild(row);
      return true;
    }
    if (v.phase === 'mini') {
      this.btns.appendChild(h(`<div class="tv-ask">Вы разыгрываете: выберите козырь и цель.</div>`));
      const grid = h('<div class="bg-box mini"></div>');
      for (const st of STRAINS as Strain[]) {
        const game = st === 'N' ? 3 : st === 'H' || st === 'S' ? 4 : 5;
        this.button(`${game}${STRAIN_SYM[st]} гейм`, st === 'H' || st === 'D' ? 'red' : '', () => this.send({ type: 'mini', level: 3, strain: st }), false, grid);
        this.button(`1${STRAIN_SYM[st]} частичка`, st === 'H' || st === 'D' ? 'red' : '', () => this.send({ type: 'mini', level: 1, strain: st }), false, grid);
      }
      this.btns.appendChild(grid);
      return true;
    }
    if (v.phase === 'play' && v.turn === v.dummy) {
      this.btns.appendChild(h('<div class="tv-ask">Ход за болвана: коснитесь его карты.</div>'));
      return true;
    }
    return false;
  }

  async play(events: Event[], v: View) {
    this.clearTurn();
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      const cur = this.v!;
      if (ev.type === 'call') {
        this.show({ ...cur, calls: [...cur.calls, { seat: ev.seat, call: ev.call, note: ev.note }], turn: (ev.seat + 1) % 4 });
        Sound.ui();
        await this.pause(380);
      } else if (ev.type === 'contract') {
        await this.showBanner(ev.contract ? `Контракт ${contractText(ev.contract)} · ${DIR[ev.contract.declarer]}` : 'Пас — пересдача', 1300);
      } else if (ev.type === 'play') {
        const hands = cur.hands.map((hh, i) => (i === ev.seat ? hh.filter((c) => !sameCard(c, ev.card)) : hh));
        this.show({ ...cur, trick: [...cur.trick, { seat: ev.seat, card: ev.card }], hands, counts: cur.counts.map((c, i) => (i === ev.seat ? c - 1 : c)), turn: ev.seat });
        Sound.card();
        await this.pause(300);
        // после первого хода болван открывается: его рука — как в итоге плюс карты, которые он сыграет дальше в этой пачке
        if (!cur.dummyUp && v.dummy >= 0) {
          const later = events.slice(i + 1).flatMap((e) => (e.type === 'play' && e.seat === v.dummy ? [e.card] : []));
          const hands2 = this.v!.hands.map((hh, k) => (k === v.dummy ? [...v.hands[k], ...later] : hh));
          this.show({ ...this.v!, dummyUp: true, dummy: v.dummy, hands: hands2 });
        }
      } else if (ev.type === 'trick') {
        await this.pause(600);
        const t = [...cur.tricks] as [number, number];
        t[side(ev.seat)]++;
        const nx = { ...cur, trick: [], tricks: t };
        this.flyTo(nx, ev.seat);
        this.show(nx);
        Sound.step();
        await this.pause(260);
      } else if (ev.type === 'result') {
        Sound.win();
        const r = ev.result;
        const need = r.contract ? r.contract.level + 6 : 0;
        const txt = r.contract ? `${contractText(r.contract)}: ${r.tricks >= need ? (r.tricks > need ? `+${r.tricks - need}` : 'сыгран') : `без ${need - r.tricks}`}` : 'Пересдача';
        await this.showBanner(r.imp != null ? `${txt} · IMP ${r.imp >= 0 ? '+' : ''}${r.imp}` : txt, 1600);
      } else if (ev.type === 'rubber') {
        await this.showBanner(`Роббер: ${ev.winner === 0 ? 'наш' : 'их'}! +${ev.bonus}`, 1600);
      } else if (ev.type === 'deal') {
        Sound.shuffle();
      } else if (ev.type === 'end') {
        this.show(v);
        await this.showBanner(`Итог: мы ${ev.total[0]} — они ${ev.total[1]}`, 0);
      }
    }
    this.show(v);
  }

  status(v: View, toAct: number[], interactive: number[]) {
    if (v.phase === 'over') return 'Партия окончена';
    const who = toAct[0];
    const what = v.phase === 'auction' ? 'торгуется' : v.phase === 'mini' ? 'выбирает контракт' : v.turn === v.dummy ? 'ходит за болвана' : 'ходит';
    return interactive.includes(who) ? (v.phase === 'play' && v.turn === v.dummy ? 'Ход за болвана' : 'Ваш ход') : `${this.ctx.name(who)} ${what}…`;
  }

  playerStats(v: View, seat: number) {
    return `${DIR[seat]} · «${side(seat) === 0 ? 'мы' : 'они'}»: ${v.total[side(seat)]}`;
  }
}

export function createView(): GameView<View, Event> {
  return new BridgeView();
}
