/* Кончинка — отрисовка: стол посередине (открытые карты рядами), своя рука внизу, соперники по дуге сверху, у каждого — стопка взятого.
 * Ход — касание карты на руке: если взять ею можно одним способом — ход сразу, если несколькими — кнопки «Взять …». */
import { Sound } from '../../core/audio';
import { esc, h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { preloadDeck, deckStyle } from '../../cards/render';
import { CardStage, cardKey, fan, type Point, type StageItem } from '../../cards/stage';
import { sameCard, sortHand, type Card } from '../../cards/deck';
import { countOf, moves, teamOf, type Action, type Event, type View } from './engine';
import { SEATS, cn, RULES_NAME } from './def';
import '../../cards/trickview.css';
import './konchinka.css';

class KonchinkaView implements GameView<View, Event> {
  private ctx!: ViewCtx;
  private cs!: CardStage;
  private plates!: HTMLElement;
  private banner!: HTMLElement;
  private btns!: HTMLElement;
  private v: View | null = null;
  private viewer = 0;
  private actSeat: number | null = null;
  private picked: Card | null = null;
  /** Карта, только что положенная на стол (для показа взятия). */
  private flying: { seat: number; card: Card } | null = null;
  private exitPt: Point | null = null;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    this.viewer = ctx.mySeats[0] ?? 0;
    preloadDeck(deckStyle());
    this.cs = new CardStage(root, 1000, 720, 'kc-wrap', '<div class="kc-cloth"></div>', { portrait: { W: 540, H: 900 } });
    this.cs.onMode = () => this.draw();
    this.cs.over.innerHTML = '<div class="kc-plates"></div><div class="cs-banner" hidden></div>';
    this.plates = this.cs.over.querySelector('.kc-plates') as HTMLElement;
    this.banner = this.cs.over.querySelector('.cs-banner') as HTMLElement;
    this.cs.stage.addEventListener('click', (e) => this.onClick(e));
    if (ctx.demo) return;
    const ctl = h('<div class="kc-controls"><div class="kc-btns"></div></div>');
    ctx.controls.appendChild(ctl);
    this.btns = ctl.querySelector('.kc-btns') as HTMLElement;
  }

  private get port() {
    return this.cs.portrait;
  }

  private order(v: View): number[] {
    const i0 = Math.max(0, v.seats.indexOf(this.viewer));
    return v.seats.map((_, k) => v.seats[(i0 + k) % v.seats.length]);
  }

  private anchor(v: View, seat: number): Point {
    const k = this.order(v).indexOf(seat);
    const n = v.seats.length;
    if (k === 0) return this.port ? { x: 270, y: 792 } : { x: 500, y: 620 };
    const t = n === 2 ? 0.5 : (k - 1) / (n - 2);
    const a = Math.PI * (1 - t);
    if (this.port) return { x: 270 + Math.cos(a) * 200, y: 250 - Math.sin(a) * 170 };
    return { x: 500 + Math.cos(a) * 400, y: 300 - Math.sin(a) * 220 };
  }

  private pilePt(v: View, seat: number): Point {
    const a = this.anchor(v, seat);
    if (seat === this.viewer) return this.port ? { x: 470, y: 640 } : { x: 860, y: 600 };
    return { x: a.x + (a.x >= (this.port ? 270 : 500) ? -1 : 1) * (this.port ? 70 : 90), y: a.y + 10 };
  }

  private tablePts(n: number): Point[] {
    const per = this.port ? 4 : 6;
    const rows = Math.max(1, Math.ceil(n / per));
    const cx = this.port ? 270 : 500;
    const cy = this.port ? 480 : 345;
    const dx = this.port ? 96 : 100;
    const dy = this.port ? 128 : 132;
    const out: Point[] = [];
    for (let i = 0; i < n; i++) {
      const r = Math.floor(i / per);
      const inRow = r === rows - 1 ? n - r * per : per;
      const j = i - r * per;
      out.push({ x: cx + (j - (inRow - 1) / 2) * dx, y: cy + (r - (rows - 1) / 2) * dy });
    }
    return out;
  }

  private layout(v: View): StageItem[] {
    const items: StageItem[] = [];
    const table = this.flying ? [...v.table, this.flying.card] : v.table;
    const opts = this.actSeat != null ? moves(v, this.actSeat) : [];
    const pickedSets = this.picked ? opts.filter((m) => sameCard(m.card, this.picked!)).flatMap((m) => m.take) : [];
    const ts = this.port ? 0.6 : 0.62;
    this.tablePts(table.length).forEach((p, i) => {
      const c = table[i];
      const hot = pickedSets.some((x) => sameCard(x, c));
      items.push({ key: cardKey(c), card: c, x: p.x, y: p.y, r: ((i * 7) % 9) - 4, s: ts, z: 20 + i, cls: hot ? 'cs-sel' : '', fromPt: this.flying && sameCard(c, this.flying.card) ? this.anchor(v, this.flying.seat) : undefined });
    });
    // колода
    if (v.deckLeft) {
      const d = this.port ? { x: 70, y: 640 } : { x: 92, y: 200 };
      for (let k = 0; k < Math.min(4, Math.ceil(v.deckLeft / 8)); k++) items.push({ key: `deck:${k}`, card: null, x: d.x - k * 1.5, y: d.y - k * 2.5, r: 0, s: 0.5, z: 2 + k });
    }
    for (const seat of v.seats) {
      const a = this.anchor(v, seat);
      const me = seat === this.viewer;
      const cnt = countOf(v, seat);
      if (me && v.hands[seat].length) {
        const list = sortHand(v.hands[seat]);
        const can = new Set(opts.map((m) => m.card.s + m.card.r));
        list.forEach((c, k) => {
          const p = fan(list.length, k, a.x, a.y, this.port ? 420 : 560, this.port ? 92 : 110, 14, 8);
          const ok = this.actSeat === seat && can.has(c.s + c.r);
          const sel = this.picked && sameCard(this.picked, c);
          items.push({ key: cardKey(c), card: c, x: p.x, y: p.y - (sel ? 30 : ok ? 14 : 0), r: p.r, s: this.port ? 0.95 : 1, z: 100 + k, cls: this.actSeat === seat ? (sel ? 'cs-sel' : ok ? 'cs-can' : 'tv-no') : '', data: ok ? { hand: c.s + c.r } : undefined });
        });
      } else
        for (let k = 0; k < cnt; k++) {
          const p = fan(cnt, k, a.x, a.y, this.port ? 60 : 100, 10, 6, 10);
          items.push({ key: `b:${seat}:${k}`, card: null, ...p, s: me ? 1 : 0.42, z: 50 + k });
        }
      const pile = v.piles[seat]?.length ?? 0;
      if (pile) {
        const p = this.pilePt(v, seat);
        for (let k = 0; k < Math.min(3, Math.ceil(pile / 6)); k++) items.push({ key: `pile:${seat}:${k}`, card: null, x: p.x + k, y: p.y - k * 2, r: 84, s: 0.42, z: 40 + k, cls: 'tv-pile' });
      }
    }
    return items;
  }

  private draw() {
    const v = this.v;
    if (!v) return;
    const exit = this.exitPt;
    this.exitPt = null;
    this.cs.render(this.layout(v), this.ctx.speed(), null, exit);
    let s = '';
    for (const seat of v.seats) {
      const a = this.anchor(v, seat);
      const me = seat === this.viewer;
      const y = me ? a.y - (this.port ? 120 : 126) : a.y + (this.port ? 34 : 40);
      const x = Math.max(90, Math.min((this.port ? 540 : 1000) - 90, a.x));
      const sw = v.sweeps[seat] ? ` · ${v.cfg.rules === 'escoba' ? 'эскоб' : 'скоп'} ${v.sweeps[seat]}` : '';
      s += `<div class="cs-plate${v.turn === seat && !v.over ? ' on' : ''}" style="--c:${SEATS[seat].color};left:${x}px;top:${y}px">${esc(this.plain(seat))} <b title="Очки">${v.score[seat]}</b> <i title="Взято карт">· карт ${v.piles[seat]?.length ?? 0}${sw}</i></div>`;
    }
    const pairs = v.cfg.pairs && v.seats.length === 4 ? ' · пара на пару' : '';
    s += `<div class="tv-center${this.port ? '' : ' corner'}" style="left:${this.port ? 270 : 40}px;top:${this.port ? 18 : 34}px">${RULES_NAME(v.cfg)}<small>до ${v.cfg.target}${pairs} · в колоде ${v.deckLeft}</small></div>`;
    this.plates.innerHTML = s;
  }

  private plain(seat: number) {
    return this.ctx.name(seat).replace(/<[^>]+>/g, '');
  }

  // ---------------------------------------------------------------- ход

  private onClick(e: MouseEvent) {
    const v = this.v;
    if (!v || this.actSeat == null) return;
    const el = (e.target as Element).closest('[data-hand]') as HTMLElement | null;
    if (!el) return;
    const card = v.hands[this.actSeat].find((c) => c.s + c.r === el.dataset.hand);
    if (!card) return;
    const opts = moves(v, this.actSeat).filter((m) => sameCard(m.card, card));
    if (opts.length === 1) return this.send(opts[0]);
    this.picked = card;
    Sound.ui();
    this.draw();
    this.renderButtons();
  }

  private send(a: Action) {
    const seat = this.actSeat;
    if (seat == null) return;
    Sound.unlock();
    this.actSeat = null;
    this.picked = null;
    if (this.btns) this.btns.innerHTML = '';
    this.ctx.act(seat, a);
  }

  private renderButtons() {
    if (!this.btns) return;
    this.btns.innerHTML = '';
    const v = this.v;
    const seat = this.actSeat;
    if (!v || seat == null) return;
    const all = moves(v, seat);
    if (this.picked) {
      const opts = all.filter((m) => sameCard(m.card, this.picked!));
      this.btns.appendChild(h(`<div class="kc-ask">Чем взять ${cn(this.picked)}?</div>`));
      for (const m of opts) {
        const b = h<HTMLButtonElement>(`<button class="btn primary">Взять ${m.take.map(cn).join(' + ')}</button>`);
        b.onclick = () => this.send(m);
        this.btns.appendChild(b);
      }
      const back = h<HTMLButtonElement>('<button class="btn">Другая карта</button>');
      back.onclick = () => {
        this.picked = null;
        this.draw();
        this.renderButtons();
      };
      this.btns.appendChild(back);
      return;
    }
    const capture = all.some((m) => m.take.length);
    this.btns.appendChild(h(`<div class="kc-ask">${capture ? 'Есть что взять — коснитесь подсвеченной карты (брать обязательно).' : 'Взять нечем — коснитесь карты, она ляжет на стол.'}</div>`));
  }

  // ---------------------------------------------------------------- события

  async play(events: Event[], v: View) {
    this.actSeat = null;
    this.picked = null;
    if (this.btns) this.btns.innerHTML = '';
    const speed = this.ctx.speed();
    for (const ev of events) {
      const cur = this.v!;
      if (ev.type === 'play') {
        const hands = cur.hands.map((hh, i) => (i === ev.seat ? hh.filter((c) => !sameCard(c, ev.card)) : hh));
        const counts = cur.counts.map((c, i) => (i === ev.seat ? c - 1 : c));
        this.v = { ...cur, hands, counts };
        this.flying = { seat: ev.seat, card: ev.card };
        this.draw();
        Sound.card();
        await sleep(520 / speed);
        this.flying = null;
        if (ev.take.length) {
          const piles = cur.piles.map((p, i) => (i === ev.seat ? [...p, ev.card, ...ev.take] : p));
          const table = cur.table.filter((c) => !ev.take.some((t) => sameCard(t, c)));
          this.exitPt = this.pilePt(cur, ev.seat);
          this.v = { ...this.v, table, piles, sweeps: ev.sweep ? cur.sweeps.map((x, i) => (i === ev.seat ? x + 1 : x)) : cur.sweeps, lastCap: ev.seat };
          Sound.step();
        } else this.v = { ...this.v, table: [...cur.table, ev.card] };
        this.draw();
        if (ev.sweep) await this.say(`${this.plain(ev.seat)}: ${v.cfg.rules === 'escoba' ? 'эскоба' : 'скопа'}! Стол чист`, 900);
        else await sleep(260 / speed);
      } else if (ev.type === 'rest') {
        this.exitPt = this.pilePt(cur, ev.seat);
        this.v = { ...cur, table: [], piles: cur.piles.map((p, i) => (i === ev.seat ? [...p, ...ev.cards] : p)) };
        this.draw();
        await this.say(`Остаток стола — ${this.plain(ev.seat)}`, 900);
      } else if (ev.type === 'score') {
        Sound.win();
        const sides = ev.lines.map((l) => `${this.sideName(cur, l.seat)}: ${l.what} +${l.pts}`);
        await this.say(sides.length ? sides.join(' · ') : 'Никому ничего', 2600);
        this.v = { ...cur, score: ev.score };
      } else if (ev.type === 'deal') {
        Sound.shuffle();
        this.v = { ...v, table: ev.first ? ev.table : cur.table };
        this.draw();
        await sleep(400 / speed);
      } else if (ev.type === 'end') {
        this.v = v;
        this.draw();
        await this.say(`Партия: ${ev.winners.map((x) => this.plain(x)).join(' и ')} — ${ev.score[ev.winners[0]]}`, 0);
      }
    }
    this.v = v;
    this.draw();
  }

  private sideName(v: View, seat: number) {
    const mates = v.seats.filter((x) => teamOf(v, x) === teamOf(v, seat));
    return mates.map((x) => this.plain(x)).join(' и ');
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
    this.picked = null;
    if (!v) return;
    const mine = this.ctx.mySeats.filter((x) => v.seats.includes(x));
    const next = toAct.find((x) => mine.includes(x));
    if (next != null && mine.length > 1) this.viewer = next;
    this.actSeat = interactive.find((x) => x === this.viewer) ?? null;
    this.draw();
    this.renderButtons();
  }

  status(v: View, toAct: number[], interactive: number[]) {
    if (v.over) return 'Партия окончена';
    const who = toAct[0];
    return interactive.includes(who) ? 'Ваш ход' : `Ходит ${this.ctx.name(who)}…`;
  }

  playerStats(v: View, seat: number) {
    return `очки: ${v.score[seat]}, взято карт: ${v.piles[seat]?.length ?? 0}`;
  }

  destroy() {
    this.cs.destroy();
  }
}

export function createView(): GameView<View, Event> {
  return new KonchinkaView();
}
