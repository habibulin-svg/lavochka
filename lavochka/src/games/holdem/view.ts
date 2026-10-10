/* Холдем — отрисовка: овальный стол с сукном, места по кругу, свои карты крупно снизу, общие карты и банк в центре,
 * ставки фишками перед игроками, баттон «D». Вид — «3D» (стол наклонён в перспективе) или «сверху»; выбор запоминается.
 * Ход — кнопками: пас, чек/колл, рейз (ползунок и быстрые: ½ банка, банк), ва-банк. */
import { Sound } from '../../core/audio';
import { esc, h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { preloadDeck } from '../../cards/render';
import { settings } from '../../core/settings';
import type { Card } from '../../cards/deck';
import { CardStage, cardKey, type Point, type StageItem } from '../../cards/stage';
import { holding, minRaiseTo, toCall, type Event, type View } from './engine';
import { SEATS } from './def';
import './holdem.css';

const W = 1000;
const H = 720;
const C = { x: 500, y: 320 };
const KEY = 'lavochka.holdem.view';

class HoldemView implements GameView<View, Event> {
  private ctx!: ViewCtx;
  private cs!: CardStage;
  private plates!: HTMLElement;
  private banner!: HTMLElement;
  private cover!: HTMLElement;
  private btns!: HTMLElement;
  private v: View | null = null;
  private viewer = 0;
  private hidden = false;
  private actSeat: number | null = null;
  private three = true;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    preloadDeck(settings.deck);
    this.cs = new CardStage(root, W, H, 'hd-wrap', '<div class="hd-floor"></div><div class="hd-table"><div class="hd-felt"></div></div>');
    this.cs.over.innerHTML = '<div class="hd-plates"></div><div class="cs-banner" hidden></div>';
    this.plates = this.cs.over.querySelector('.hd-plates') as HTMLElement;
    this.banner = this.cs.over.querySelector('.cs-banner') as HTMLElement;
    this.cover = h('<div class="cs-cover" hidden><div class="cs-cover-box"><div class="hd-cover-t"></div><button class="btn primary">Показать карты</button></div></div>');
    this.cs.stage.appendChild(this.cover);
    (this.cover.querySelector('button') as HTMLButtonElement).onclick = () => {
      Sound.unlock();
      this.hidden = false;
      this.cover.hidden = true;
      this.draw();
      this.renderButtons();
    };
    try {
      this.three = localStorage.getItem(KEY) !== 'top';
    } catch {
      this.three = true;
    }
    if (ctx.demo) this.three = false;
    this.applyView();
    const ctl = h(`<div class="hd-controls"><div class="hd-btns"></div><button class="btn hd-vbtn"></button></div>`);
    ctx.controls.appendChild(ctl);
    this.btns = ctl.querySelector('.hd-btns') as HTMLElement;
    const vb = ctl.querySelector('.hd-vbtn') as HTMLButtonElement;
    vb.hidden = ctx.demo;
    const label = () => (vb.textContent = this.three ? 'Вид: 3D-стол → сверху' : 'Вид: сверху → 3D-стол');
    label();
    vb.onclick = () => {
      this.three = !this.three;
      try {
        localStorage.setItem(KEY, this.three ? '3d' : 'top');
      } catch {
        /* без хранилища — просто не запомним */
      }
      label();
      this.applyView();
    };
  }

  private applyView() {
    this.cs.wrap.classList.toggle('hd-3d', this.three);
    this.cs.setTilt(this.three ? 'translate(70px, 40px) scale(0.86) rotateX(24deg)' : '');
  }

  // ---------------------------------------------------------------- места

  private order(v: View): number[] {
    const i0 = Math.max(0, v.seats.indexOf(this.viewer));
    return v.seats.map((_, k) => v.seats[(i0 + k) % v.seats.length]);
  }

  /** Место на овале: зритель снизу, дальше по часовой. */
  private anchor(v: View, seat: number): Point {
    const ord = this.order(v);
    const k = ord.indexOf(seat);
    const n = ord.length;
    const a = Math.PI / 2 + (k / n) * Math.PI * 2;
    return { x: C.x + Math.cos(a) * 410, y: C.y + Math.sin(a) * 250 + (k === 0 ? 20 : 0) };
  }

  private chooseViewer(v: View, toAct: number[]) {
    const mine = this.ctx.mySeats.filter((x) => v.seats.includes(x));
    if (!mine.length) return;
    if (mine.length === 1) {
      this.viewer = mine[0];
      return;
    }
    const next = toAct.find((x) => mine.includes(x));
    if (next != null && next !== this.viewer) {
      this.viewer = next;
      this.hidden = true;
      this.cs.clear();
    }
  }

  private layout(v: View): StageItem[] {
    const items: StageItem[] = [];
    v.board.forEach((c, i) => items.push({ key: cardKey(c), card: c, x: C.x - 160 + i * 80, y: C.y - 10, r: 0, s: 0.72, z: 10 + i }));
    for (const seat of v.seats) {
      if (!holding(v, seat)) continue;
      const a = this.anchor(v, seat);
      const me = seat === this.viewer;
      const cards: (Card | null)[] = v.hole[seat].length && (me ? !this.hidden || this.ctx.demo : true) ? v.hole[seat] : [null, null];
      const toward = { x: (C.x - a.x) * 0.12, y: (C.y - a.y) * 0.12 };
      cards.forEach((c, i) => {
        const s = me ? 0.82 : 0.5;
        const x = a.x + toward.x + (i - 0.5) * (me ? 64 : 30);
        const y = a.y + toward.y - (me ? 40 : 0);
        const r = (i - 0.5) * (me ? 8 : 12);
        items.push(c ? { key: cardKey(c), card: c, x, y, r, s, z: (me ? 100 : 50) + i } : { key: `b:${seat}:${i}`, card: null, x, y, r, s, z: 50 + i });
      });
    }
    return items;
  }

  private draw(enter: Point | null = null, exit: Point | null = null) {
    const v = this.v;
    if (!v) return;
    this.cs.render(this.layout(v), this.ctx.speed(), enter, exit);
    let s = '';
    const pot = v.inHand.reduce((a, x) => a + v.total[x], 0);
    for (const seat of v.seats) {
      const a = this.anchor(v, seat);
      const me = seat === this.viewer;
      const busted = v.chips[seat] <= 0 && !v.inHand.includes(seat);
      const out = v.folded[seat];
      const on = v.turn === seat && v.phase !== 'over';
      const py = me ? a.y + 62 : a.y + 46;
      const tag = v.allin[seat] ? ' <em>ва-банк</em>' : out ? ' <em>пас</em>' : busted ? ' <em>вылетел</em>' : '';
      s += `<div class="cs-plate hd-plate${on ? ' on' : ''}${out || busted ? ' hd-dim' : ''}" style="--c:${SEATS[seat].color};left:${a.x}px;top:${py}px">${esc(this.plain(seat))} <i>${v.chips[seat]}</i>${tag}</div>`;
      // ставка этого круга — фишками к центру
      if (v.bet[seat] > 0) {
        // своя ставка — справа от карт, чужие — по пути к центру
        const bx = me ? a.x + 130 : a.x + (C.x - a.x) * 0.36;
        const by = me ? a.y - 70 : a.y + (C.y - a.y) * 0.36;
        s += `<div class="hd-bet" style="left:${bx}px;top:${by}px">${this.chipStack(v.bet[seat])}<span>${v.bet[seat]}</span></div>`;
      }
      if (seat === v.button && v.phase !== 'over') {
        const dx = a.x + (C.x - a.x) * 0.2 + 46;
        const dy = a.y + (C.y - a.y) * 0.2 - 10;
        s += `<div class="hd-button" style="left:${dx}px;top:${dy}px">D</div>`;
      }
    }
    if (pot) s += `<div class="hd-pot" style="left:${C.x}px;top:${C.y + 70}px">${this.chipStack(pot)}<span>банк ${pot}</span></div>`;
    s += `<div class="hd-blinds">блайнды ${v.big / 2}/${v.big} · раздача ${v.hand}</div>`;
    this.plates.innerHTML = s;
  }

  /** Стопка фишек по номиналам 500/100/25/5. */
  private chipStack(n: number): string {
    const kinds = [
      { v: 500, c: 'p' },
      { v: 100, c: 'k' },
      { v: 25, c: 'g' },
      { v: 5, c: 'r' },
    ];
    let out = '';
    let left = n;
    let total = 0;
    for (const k of kinds) {
      const cnt = Math.min(6, Math.floor(left / k.v));
      left -= cnt * k.v;
      for (let i = 0; i < cnt && total < 10; i++, total++) out += `<b class="hd-chip ${k.c}" style="--i:${total}"></b>`;
    }
    if (!total) out = '<b class="hd-chip r" style="--i:0"></b>';
    return `<div class="hd-stack">${out}</div>`;
  }

  private plain(seat: number) {
    return this.ctx.name(seat).replace(/<[^>]+>/g, '');
  }

  // ---------------------------------------------------------------- ход

  private send(a: Parameters<ViewCtx['act']>[1]) {
    const seat = this.actSeat;
    if (seat == null) return;
    Sound.unlock();
    this.clearTurn();
    this.ctx.act(seat, a);
  }

  private clearTurn() {
    this.actSeat = null;
    this.btns.innerHTML = '';
  }

  private renderButtons() {
    this.btns.innerHTML = '';
    const v = this.v;
    const seat = this.actSeat;
    if (!v || seat == null || this.ctx.demo || this.hidden) return;
    const call = toCall(v, seat);
    const stack = v.chips[seat];
    const pot = v.inHand.reduce((a, x) => a + v.total[x], 0);
    const max = v.bet[seat] + stack;
    const min = Math.min(max, minRaiseTo(v));
    const row = h('<div class="hd-row"></div>');
    const add = (text: string, cls: string, on: () => void) => {
      const b = h<HTMLButtonElement>(`<button class="btn ${cls}">${text}</button>`);
      b.onclick = () => {
        Sound.unlock();
        on();
      };
      row.appendChild(b);
    };
    add('Пас', '', () => this.send({ type: 'fold' }));
    if (call === 0) add('Чек', 'primary', () => this.send({ type: 'check' }));
    else add(call >= stack ? `Колл ва-банк ${stack}` : `Колл ${call}`, 'primary', () => this.send({ type: 'call' }));
    this.btns.appendChild(row);
    if (stack > call) {
      const box = h(`<div class="hd-raise"><div class="hd-rlabel">Рейз до <b>${min}</b></div><input type="range" min="${min}" max="${max}" step="${Math.max(1, Math.round(v.big / 2))}" value="${min}"><div class="hd-row hd-quick"></div></div>`);
      const input = box.querySelector('input') as HTMLInputElement;
      const label = box.querySelector('b') as HTMLElement;
      input.oninput = () => (label.textContent = input.value);
      const quick = box.querySelector('.hd-quick') as HTMLElement;
      const q = (text: string, to: number) => {
        const b = h<HTMLButtonElement>(`<button class="btn">${text}</button>`);
        b.onclick = () => {
          const t = Math.max(min, Math.min(max, Math.round(to)));
          input.value = String(t);
          label.textContent = String(t);
        };
        quick.appendChild(b);
      };
      q('½ банка', v.current + pot / 2);
      q('банк', v.current + pot);
      q('ва-банк', max);
      const go = h<HTMLButtonElement>('<button class="btn primary">Поставить</button>');
      go.onclick = () => {
        const to = Number(input.value);
        this.send(to >= max ? { type: 'allin' } : { type: 'raise', to });
      };
      box.appendChild(go);
      this.btns.appendChild(box);
    }
  }

  // ---------------------------------------------------------------- состояние

  setView(v: View) {
    this.v = v;
    this.banner.hidden = true;
    this.draw();
  }

  private async showBanner(text: string, ms: number) {
    this.banner.textContent = text;
    this.banner.hidden = false;
    if (!ms) return;
    await sleep(ms);
    this.banner.hidden = true;
  }

  async play(events: Event[], v: View) {
    const speed = this.ctx.speed();
    this.clearTurn();
    for (const ev of events) {
      const cur = this.v!;
      if (ev.type === 'act') {
        const bet = cur.bet.slice();
        const chips = cur.chips.slice();
        const total = cur.total.slice();
        bet[ev.seat] += ev.amount;
        chips[ev.seat] -= ev.amount;
        total[ev.seat] += ev.amount;
        const folded = cur.folded.slice();
        if (ev.action === 'fold') folded[ev.seat] = true;
        this.v = { ...cur, bet, chips, total, folded, turn: ev.seat };
        this.draw(null, ev.action === 'fold' ? { x: C.x, y: C.y } : null);
        if (ev.action === 'fold') Sound.card();
        else if (ev.action === 'check') Sound.ui();
        else Sound.place();
        await sleep(380 / speed);
      } else if (ev.type === 'street') {
        this.v = { ...cur, board: [...cur.board, ...ev.cards], bet: cur.bet.map(() => 0) };
        this.draw({ x: C.x, y: C.y - 200 });
        Sound.card();
        await sleep(520 / speed);
      } else if (ev.type === 'show') {
        const hole = cur.hole.slice();
        hole[ev.seat] = ev.cards;
        this.v = { ...cur, hole };
        this.draw();
        await sleep(500 / speed);
      } else if (ev.type === 'win') {
        Sound.win();
        await this.showBanner(`${this.plain(ev.seat)} +${ev.amount}${ev.hand ? ` — ${ev.hand}` : ''}`, 1400 / speed);
      } else if (ev.type === 'blinds') {
        await this.showBanner(`Блайнды ${ev.big / 2}/${ev.big}`, 900 / speed);
      } else if (ev.type === 'deal') {
        Sound.shuffle();
        this.v = { ...v };
      } else if (ev.type === 'end') {
        Sound.win();
        this.v = v;
        this.draw();
        await this.showBanner(`Все фишки — ${this.plain(ev.winner)}!`, 0);
      }
    }
    this.v = v;
    this.draw({ x: C.x, y: C.y - 200 });
  }

  setTurn(toAct: number[], interactive: number[]) {
    this.clearTurn();
    const v = this.v;
    if (!v || v.phase === 'over' || this.ctx.demo) return;
    this.chooseViewer(v, toAct);
    const seat = interactive.find((x) => x === this.viewer) ?? null;
    if (this.hidden && interactive.length && this.ctx.mySeats.length > 1) {
      (this.cover.querySelector('.hd-cover-t') as HTMLElement).innerHTML = `Ход: ${this.ctx.name(this.viewer)}.<br><small>Передайте устройство — остальным не подглядывать!</small>`;
      this.cover.hidden = false;
    } else {
      this.hidden = false;
      this.cover.hidden = true;
    }
    this.actSeat = seat;
    this.draw();
    this.renderButtons();
  }

  status(v: View, toAct: number[], interactive: number[]) {
    const name = (p: number) => this.ctx.name(p);
    if (v.phase === 'over') return v.winner != null ? `Все фишки у ${name(v.winner)}` : 'Игра окончена';
    const who = toAct[0];
    if (!interactive.includes(who)) return `Думает ${name(who)}…`;
    const call = toCall(v, who);
    return call ? `Ваш ход: колл ${call}?` : 'Ваш ход';
  }

  playerStats(v: View, seat: number) {
    return v.chips[seat] > 0 || v.inHand.includes(seat) ? `фишки: ${v.chips[seat]}` : 'вылетел';
  }

  destroy() {
    this.cs.destroy();
  }
}

export function createView(): GameView<View, Event> {
  return new HoldemView();
}
