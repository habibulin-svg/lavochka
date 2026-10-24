/* Рамми — отрисовка: своя рука веером внизу, соперники сверху (рубашкой), слева колода и сброс, посередине — комбинации на столе рядами.
 * Ход: коснуться колоды или сброса — взять; выбрать карты касанием — «Выложить» (несколько комбинаций сразу делятся сами),
 * одну карту и комбинацию на столе — доложить; одну карту — «Сбросить» (в джине — «Сбросить и постучать»). */
import { Sound } from '../../core/audio';
import { esc, h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { preloadDeck, deckStyle } from '../../cards/render';
import { CardStage, fan, type Point, type StageItem } from '../../cards/stage';
import { SUITS } from '../../cards/deck';
import { canMeldNow, canTakeDiscard, countOf, KNOCK, OPEN_MIN, rulesOf, splitAll, type Action, type Event, type View } from './engine';
import { bestSplit, canLayoff, meldValue, same, type RCard } from './melds';
import { SEATS, cn } from './def';
import '../../cards/trickview.css';
import './rummy.css';

const key = (c: RCard) => `k:${c.s}${c.r}.${c.d ?? 0}`;

class RummyView implements GameView<View, Event> {
  private ctx!: ViewCtx;
  private cs!: CardStage;
  private plates!: HTMLElement;
  private banner!: HTMLElement;
  private btns!: HTMLElement;
  private v: View | null = null;
  private viewer = 0;
  private act: number | null = null;
  private sel: RCard[] = [];
  private byRank = false;
  private shown: { seat: number; melds: RCard[][]; dead: RCard[] }[] = [];

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    this.viewer = ctx.mySeats[0] ?? 0;
    preloadDeck(deckStyle());
    this.cs = new CardStage(root, 1000, 720, 'rm-wrap', '<div class="tv-cloth rm-cloth"></div>', { portrait: { W: 540, H: 900 } });
    this.cs.onMode = () => this.draw();
    this.cs.over.innerHTML = '<div class="rm-plates"></div><div class="cs-banner" hidden></div>';
    this.plates = this.cs.over.querySelector('.rm-plates') as HTMLElement;
    this.banner = this.cs.over.querySelector('.cs-banner') as HTMLElement;
    this.cs.stage.addEventListener('click', (e) => this.onClick(e));
    if (ctx.demo) return;
    const ctl = h('<div class="rm-controls"><div class="rm-btns"></div></div>');
    ctx.controls.appendChild(ctl);
    this.btns = ctl.querySelector('.rm-btns') as HTMLElement;
  }

  private get port() {
    return this.cs.portrait;
  }
  private get W() {
    return this.port ? 540 : 1000;
  }

  private others(v: View) {
    const i0 = Math.max(0, v.seats.indexOf(this.viewer));
    return v.seats.map((_, k) => v.seats[(i0 + k) % v.seats.length]).slice(1);
  }

  private anchor(v: View, seat: number): Point {
    if (seat === this.viewer) return this.port ? { x: 270, y: 790 } : { x: 560, y: 630 };
    const list = this.others(v);
    const k = list.indexOf(seat);
    const n = list.length;
    const span = this.port ? 380 : 640;
    const cx = this.port ? 270 : 560;
    return { x: n === 1 ? cx : cx - span / 2 + (span * k) / (n - 1), y: this.port ? 70 : 80 };
  }

  private get stockPt(): Point {
    return this.port ? { x: 70, y: 220 } : { x: 90, y: 300 };
  }
  private get discardPt(): Point {
    return this.port ? { x: 160, y: 220 } : { x: 90, y: 470 };
  }

  private sorted(hand: RCard[]): RCard[] {
    const o = (s: string) => SUITS.indexOf(s as never);
    return hand.slice().sort((a, b) => (this.byRank ? a.r - b.r || o(a.s) - o(b.s) : o(a.s) - o(b.s) || a.r - b.r));
  }

  /** Места комбинаций на столе: ряды слева направо. */
  private meldSpots(n: number[]): Point[] {
    const x0 = this.port ? 40 : 250;
    const x1 = this.port ? 520 : 980;
    const y0 = this.port ? 310 : 230;
    const dy = this.port ? 96 : 100;
    const step = this.port ? 18 : 22;
    const out: Point[] = [];
    let x = x0;
    let y = y0;
    for (const len of n) {
      const w = 50 + step * (len - 1);
      if (x + w > x1) {
        x = x0;
        y += dy;
      }
      out.push({ x: x + 25, y });
      x += w + 18;
    }
    return out;
  }

  private layout(v: View): StageItem[] {
    const items: StageItem[] = [];
    const s0 = this.port ? 0.42 : 0.5;
    // колода и сброс
    const sp = this.stockPt;
    const canDraw = this.act != null && v.phase === 'draw';
    for (let k = 0; k < Math.min(4, Math.ceil(v.stockLeft / 10)); k++) items.push({ key: `stock:${k}`, card: null, x: sp.x - k, y: sp.y - k * 2, r: 0, s: 0.6, z: 2 + k, cls: canDraw ? 'cs-can' : '', data: canDraw ? { pile: 'stock' } : undefined });
    const dp = this.discardPt;
    const dn = v.discard.length;
    v.discard.slice(-3).forEach((c, i, arr) => {
      const top = i === arr.length - 1;
      const ok = top && canDraw && canTakeDiscard(v, this.act!);
      items.push({ key: key(c), card: c, x: dp.x + (i - arr.length + 1) * 4, y: dp.y + (i - arr.length + 1) * 3, r: ((dn - arr.length + i) * 7) % 10 - 5, s: 0.6, z: 10 + i, cls: ok ? 'cs-can' : '', data: ok ? { pile: 'discard' } : undefined });
    });
    // комбинации
    const melds = v.melds;
    const spots = this.meldSpots(melds.map((m) => m.cards.length));
    const one = this.sel.length === 1 ? this.sel[0] : null;
    const rules = rulesOf(v.cfg);
    melds.forEach((m, i) => {
      const p = spots[i];
      const can = this.act != null && one && canMeldNow(v, this.act) && (v.cfg.mode !== 'kunken' || v.opened[this.act]) && canLayoff(m.cards, one, rules);
      m.cards.forEach((c, k) => items.push({ key: key(c), card: c, x: p.x + k * (this.port ? 18 : 22), y: p.y, r: 0, s: s0, z: 20 + k, cls: can ? 'cs-can' : '', data: can ? { meld: String(m.id) } : undefined }));
    });
    // показ рук (джин)
    for (const sh of this.shown) {
      const a = this.anchor(v, sh.seat);
      const cards = [...sh.melds.flat(), ...sh.dead];
      cards.forEach((c, k) => items.push({ key: key(c), card: c, x: a.x + (k - (cards.length - 1) / 2) * (this.port ? 34 : 44) + (sh.dead.includes(c) ? 14 : 0), y: a.y + (sh.seat === this.viewer ? -150 : 120), r: 0, s: s0 + 0.08, z: 300 + k, cls: sh.dead.includes(c) ? 'rm-dead' : '' }));
    }
    // руки
    for (const seat of v.seats) {
      if (this.shown.some((x) => x.seat === seat)) continue;
      const a = this.anchor(v, seat);
      const me = seat === this.viewer;
      if (me && v.hands[seat].length) {
        const list = this.sorted(v.hands[seat]);
        const act = this.act === seat && v.phase === 'play';
        list.forEach((c, k) => {
          const p = fan(list.length, k, a.x, a.y, this.port ? 460 : 640, this.port ? 50 : 62, 14, 8);
          const sel = this.sel.some((x) => same(x, c));
          const must = v.mustUse && same(v.mustUse, c);
          items.push({ key: key(c), card: c, x: p.x, y: p.y - (sel ? 28 : 0), r: p.r, s: this.port ? 0.88 : 0.95, z: 100 + k, cls: sel ? 'cs-sel' : must ? 'cs-can' : '', data: act ? { hand: key(c) } : undefined });
        });
      } else {
        const cnt = countOf(v, seat);
        for (let k = 0; k < cnt; k++) {
          const p = fan(cnt, k, a.x, a.y, this.port ? 90 : 140, 10, 6, 12);
          items.push({ key: `b:${seat}:${k}`, card: null, ...p, s: 0.4, z: 50 + k });
        }
      }
    }
    return items;
  }

  private draw() {
    const v = this.v;
    if (!v) return;
    this.cs.render(this.layout(v), this.ctx.speed());
    let s = '';
    for (const seat of v.seats) {
      const a = this.anchor(v, seat);
      const me = seat === this.viewer;
      const y = me ? a.y - (this.port ? 112 : 120) : a.y + (this.port ? 38 : 44);
      const x = Math.max(80, Math.min(this.W - 80, a.x));
      const op = v.cfg.mode === 'kunken' && v.opened[seat] ? ' ✓' : '';
      s += `<div class="cs-plate${v.turn === seat && !v.over ? ' on' : ''}" style="--c:${SEATS[seat].color};left:${x}px;top:${y}px">${esc(this.plain(seat))} <b>${v.score[seat]}</b>${op}</div>`;
    }
    const mode = v.cfg.mode === 'gin' ? 'Джин-рамми' : v.cfg.mode === 'kunken' ? 'Кункен' : 'Рамми';
    s += `<div class="tv-center${this.port ? '' : ' corner'}" style="left:${this.port ? 400 : 40}px;top:${this.port ? 170 : 150}px">${mode}<small>${v.cfg.mode === 'kunken' ? 'штраф до' : 'до'} ${v.cfg.target} · в колоде ${v.stockLeft}</small></div>`;
    this.plates.innerHTML = s;
  }

  private plain(seat: number) {
    return this.ctx.name(seat).replace(/<[^>]+>/g, '');
  }

  // ---------------------------------------------------------------- ход

  private onClick(e: MouseEvent) {
    const v = this.v;
    if (!v || this.act == null) return;
    const el = (e.target as Element).closest('[data-hand],[data-pile],[data-meld]') as HTMLElement | null;
    if (!el) return;
    if (el.dataset.pile) return this.send({ type: 'draw', from: el.dataset.pile as 'stock' | 'discard' });
    if (el.dataset.meld && this.sel.length === 1) return this.send({ type: 'layoff', card: this.sel[0], meld: Number(el.dataset.meld) });
    const c = v.hands[this.act].find((x) => key(x) === el.dataset.hand);
    if (!c) return;
    const i = this.sel.findIndex((x) => same(x, c));
    if (i >= 0) this.sel.splice(i, 1);
    else this.sel.push(c);
    Sound.ui();
    this.draw();
    this.renderButtons();
  }

  private send(a: Action) {
    const seat = this.act;
    if (seat == null) return;
    Sound.unlock();
    this.act = null;
    this.sel = [];
    if (this.btns) this.btns.innerHTML = '';
    this.ctx.act(seat, a);
  }

  private button(text: string, cls: string, on: () => void, ok = true) {
    const b = h<HTMLButtonElement>(`<button class="btn ${cls}"${ok ? '' : ' disabled'}>${text}</button>`);
    b.onclick = () => {
      Sound.unlock();
      on();
    };
    this.btns.appendChild(b);
  }

  private renderButtons() {
    if (!this.btns) return;
    this.btns.innerHTML = '';
    const v = this.v;
    const seat = this.act;
    if (!v || seat == null) return;
    const rules = rulesOf(v.cfg);
    if (v.phase === 'draw') {
      this.btns.appendChild(h(`<div class="rm-ask">Возьмите карту: коснитесь колоды или сброса.</div>`));
      this.button('Из колоды', 'primary', () => this.send({ type: 'draw', from: 'stock' }));
      this.button('Из сброса', '', () => this.send({ type: 'draw', from: 'discard' }), canTakeDiscard(v, seat));
      return;
    }
    const sel = this.sel;
    if (canMeldNow(v, seat) && sel.length >= 3) {
      const parts = splitAll(sel, rules);
      const sum = parts ? parts.reduce((x, m) => x + meldValue(m, rules), 0) : 0;
      const need = v.cfg.mode === 'kunken' && !v.opened[seat];
      const ok = !!parts && (!need || sum >= OPEN_MIN);
      this.button(parts ? `Выложить ${parts.length > 1 ? `${parts.length} комбинации` : ''}${need ? ` (${sum} из ${OPEN_MIN})` : ''}` : 'Не комбинация', 'primary', () => this.send({ type: 'meld', cards: sel.slice() }), ok);
    }
    if (sel.length === 1) {
      const c = sel[0];
      const okDiscard = !v.mustUse;
      this.button(`Сбросить ${cn(c)}`, '', () => this.send({ type: 'discard', card: c }), okDiscard);
      if (v.cfg.mode === 'gin') {
        const rest = v.hands[seat].filter((x) => !same(x, c));
        const dv = bestSplit(rest, rules).deadValue;
        this.button(dv === 0 ? 'Сбросить — джин!' : `Сбросить и постучать (${dv})`, 'primary', () => this.send({ type: 'discard', card: c, knock: true }), dv <= KNOCK);
      }
    }
    this.button(this.byRank ? 'По мастям' : 'По достоинству', 'rm-sort', () => {
      this.byRank = !this.byRank;
      this.draw();
      this.renderButtons();
    });
    const hint = v.mustUse
      ? `Карту из сброса (${cn(v.mustUse)}) надо сразу выложить или доложить.`
      : sel.length === 1 && v.melds.length && v.cfg.mode !== 'gin'
        ? 'Коснитесь комбинации на столе, чтобы доложить карту, или сбросьте её.'
        : v.cfg.mode === 'gin'
          ? `Выберите карту для сброса. Лишних сейчас: ${bestSplit(v.hands[seat], rules).deadValue}.`
          : 'Выберите карты: три и больше — выложить, одну — сбросить или доложить.';
    this.btns.appendChild(h(`<div class="rm-ask">${hint}</div>`));
  }

  // ---------------------------------------------------------------- события

  async play(events: Event[], v: View) {
    this.act = null;
    this.sel = [];
    if (this.btns) this.btns.innerHTML = '';
    const sp = this.ctx.speed();
    for (const ev of events) {
      const cur = this.v!;
      if (ev.type === 'draw') {
        const hands = cur.hands.map((hh, i) => (i === ev.seat && ev.card && (i === this.viewer || this.ctx.demo) ? [...hh, ev.card] : hh));
        const counts = cur.counts.map((c, i) => (i === ev.seat ? c + 1 : c));
        this.v = { ...cur, hands, counts, discard: ev.from === 'discard' ? cur.discard.slice(0, -1) : cur.discard, stockLeft: ev.from === 'stock' ? cur.stockLeft - 1 : cur.stockLeft };
        this.draw();
        Sound.card();
        await sleep(300 / sp);
      } else if (ev.type === 'meld' || ev.type === 'layoff') {
        const cards = ev.type === 'meld' ? ev.cards : [ev.card];
        const hands = cur.hands.map((hh, i) => (i === ev.seat ? hh.filter((c) => !cards.some((x) => same(x, c))) : hh));
        const counts = cur.counts.map((c, i) => (i === ev.seat ? c - cards.length : c));
        const melds = ev.type === 'meld' ? [...cur.melds, { id: ev.id, owner: ev.seat, cards: ev.cards }] : cur.melds.map((m) => (m.id === ev.meld ? { ...m, cards: [...m.cards, ev.card] } : m));
        this.v = { ...cur, hands, counts, melds };
        this.draw();
        Sound.place();
        await sleep(420 / sp);
      } else if (ev.type === 'discard') {
        const hands = cur.hands.map((hh, i) => (i === ev.seat ? hh.filter((c) => !same(c, ev.card)) : hh));
        const counts = cur.counts.map((c, i) => (i === ev.seat ? c - 1 : c));
        this.v = { ...cur, hands, counts, discard: [...cur.discard, ev.card] };
        this.draw();
        Sound.card();
        if (ev.knock) await this.say(`${this.plain(ev.seat)} стучит!`, 900);
        else await sleep(300 / sp);
      } else if (ev.type === 'show') {
        this.shown.push({ seat: ev.seat, melds: ev.melds, dead: ev.dead });
        this.draw();
        await sleep(1200 / sp);
      } else if (ev.type === 'hand') {
        Sound.win();
        await this.say(ev.winner == null ? 'Пересдача' : `Сдача — ${this.plain(ev.winner)}${ev.lines.length ? `: ${ev.lines.join(', ')}` : ''}`, 1800);
        this.shown = [];
      } else if (ev.type === 'deal') {
        Sound.shuffle();
        this.shown = [];
        this.v = { ...v, phase: 'draw' };
        this.draw();
        await sleep(400 / sp);
      } else if (ev.type === 'end') {
        this.v = v;
        this.draw();
        await this.say(`Партия — ${this.plain(ev.winner)}`, 0);
      }
    }
    this.shown = [];
    this.v = v;
    this.draw();
  }

  private async say(text: string, ms: number) {
    this.banner.textContent = text;
    this.banner.hidden = false;
    if (!ms) return;
    await sleep(ms / this.ctx.speed());
    this.banner.hidden = true;
  }

  setView(v: View) {
    this.v = v;
    this.banner.hidden = true;
    this.draw();
  }

  setTurn(toAct: number[], interactive: number[]) {
    const v = this.v;
    this.sel = [];
    if (!v) return;
    const mine = this.ctx.mySeats.filter((x) => v.seats.includes(x));
    const next = toAct.find((x) => mine.includes(x));
    if (next != null && mine.length > 1) this.viewer = next;
    this.act = interactive.includes(this.viewer) && toAct.includes(this.viewer) ? this.viewer : null;
    this.draw();
    this.renderButtons();
  }

  status(v: View, toAct: number[], interactive: number[]) {
    if (v.over) return 'Партия окончена';
    const who = toAct[0];
    if (!interactive.includes(who)) return `Ходит ${this.ctx.name(who)}…`;
    return v.phase === 'draw' ? 'Возьмите карту' : 'Выкладывайте или сбрасывайте';
  }

  playerStats(v: View, seat: number) {
    return `${v.cfg.mode === 'kunken' ? 'штраф' : 'очки'}: ${v.score[seat]}`;
  }

  destroy() {
    this.cs.destroy();
  }
}

export function createView(): GameView<View, Event> {
  return new RummyView();
}
