/* Тысяча — отрисовка: стол под зелёным сукном, свой веер снизу, соперники по бокам (вчетвером — и сверху),
 * прикуп и взятка в центре. Торговля, отдача карт и подъём заказа — кнопками в панели; запись очков — «пулька» там же.
 * Ход — нажать на карту; король или дама марьяжа (туз при тузовом) на своём ходу — спросит, объявить ли марьяж.
 * Тёмная — первая рука решает, не видя своих карт (рубашки); роспись и пересдача — кнопками. */
import { Sound } from '../../core/audio';
import { esc, h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { preloadDeck } from '../../cards/render';
import { settings } from '../../core/settings';
import { sameCard, sortHand, SUIT_SYM, type Card } from '../../cards/deck';
import { CardStage, cardKey, fan, portraitHand, type Point, type StageItem } from '../../cards/stage';
import { canRospis, handCount, legalCards, marriageFor, marriageValue, maxBid, prikupRedeal, rospisPay, type Event, type MarriageKind, type View } from './engine';
import { SEATS } from './def';
import './thousand.css';

/** Геометрия стола: альбомная 1000×720 и вертикальная для телефона 540×900.
 * S — размер карт на руке, на столе и прикупа (одинаковый); os — закрытые руки соперников. */
const LAND = { port: false, W: 1000, hand: { x: 500, y: 606 }, c: { x: 500, y: 306 }, S: 1.05, prik: 236, os: 0.6, oo: 0.62, kx: 0.22, ky: 0.22 };
const PORT = { port: true, W: 540, hand: { x: 270, y: 792 }, c: { x: 270, y: 440 }, S: 1, prik: 250, os: 0.5, oo: 0.5, kx: 0.3, ky: 0.25 };
type Geo = typeof LAND;

class ThousandView implements GameView<View, Event> {
  private ctx!: ViewCtx;
  private cs!: CardStage;
  private plates!: HTMLElement;
  private banner!: HTMLElement;
  private cover!: HTMLElement;
  private btns!: HTMLElement;
  private sheet!: HTMLElement;
  private v: View | null = null;
  private viewer = 0;
  private hidden = false;
  private actSeat: number | null = null;
  private selected: Card | null = null;
  private askMarriage: Card | null = null;
  /** Идёт анимация play(): setTurn в это время только снимает управление (не перерисовывает и не убирает «Дальше»). */
  private busy = false;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    preloadDeck(settings.deck);
    this.cs = new CardStage(root, 1000, 720, 'th-wrap', '<div class="th-cloth"></div>', { portrait: { W: 540, H: 900 } });
    this.cs.onMode = () => this.draw();
    this.cs.over.innerHTML = '<div class="th-plates"></div><div class="cs-banner" hidden></div>';
    this.plates = this.cs.over.querySelector('.th-plates') as HTMLElement;
    this.banner = this.cs.over.querySelector('.cs-banner') as HTMLElement;
    this.cover = h('<div class="cs-cover" hidden><div class="cs-cover-box"><div class="th-cover-t"></div><button class="btn primary">Показать карты</button></div></div>');
    this.cs.stage.appendChild(this.cover);
    (this.cover.querySelector('button') as HTMLButtonElement).onclick = () => {
      Sound.unlock();
      this.hidden = false;
      this.cover.hidden = true;
      this.draw();
      this.renderButtons();
    };
    const ctl = h(`<div class="th-controls"><div class="th-btns"></div><div class="th-sheet"></div>${ctx.demo ? '' : '<div class="hint small-hint">Ход — нажать на карту. Чтобы отдать карту, выберите её и нажмите на имя соперника.</div>'}</div>`);
    ctx.controls.appendChild(ctl);
    this.btns = ctl.querySelector('.th-btns') as HTMLElement;
    this.sheet = ctl.querySelector('.th-sheet') as HTMLElement;
    this.cs.stage.addEventListener('click', (e) => this.onClick(e));
    this.plates.addEventListener('click', (e) => {
      const pl = (e.target as Element).closest('[data-give]') as HTMLElement | null;
      if (pl && this.selected) this.send({ type: 'give', to: +pl.dataset.give!, card: this.selected });
    });
  }

  // ---------------------------------------------------------------- места

  private order(v: View): number[] {
    const i0 = Math.max(0, v.seats.indexOf(this.viewer));
    return v.seats.map((_, k) => v.seats[(i0 + k) % v.seats.length]);
  }

  private get g(): Geo {
    return this.cs.portrait ? PORT : LAND;
  }

  private anchor(v: View, seat: number): Point {
    const ord = this.order(v);
    const k = ord.indexOf(seat);
    if (k === 0) return this.g.hand;
    if (this.g.port) {
      if (v.seats.length === 3) return k === 1 ? { x: 120, y: 92 } : { x: 420, y: 92 };
      return k === 1 ? { x: 82, y: 160 } : k === 2 ? { x: 270, y: 72 } : { x: 458, y: 160 };
    }
    if (v.seats.length === 3) return k === 1 ? { x: 150, y: 210 } : { x: 850, y: 210 };
    return k === 1 ? { x: 130, y: 260 } : k === 2 ? { x: 500, y: 92 } : { x: 870, y: 260 };
  }

  private faceUp(v: View, seat: number) {
    if (this.ctx.demo) return v.hands[seat].length > 0 || handCount(v, seat) === 0;
    // темнящий видит рубашки, пока не решит
    return seat === this.viewer && !this.hidden && this.ctx.mySeats.includes(seat) && v.hands[seat].length === handCount(v, seat);
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

  // ---------------------------------------------------------------- раскладка

  private playable(v: View): Card[] {
    if (this.actSeat == null || this.hidden) return [];
    if (v.phase === 'play') return legalCards(v, this.actSeat);
    if (v.phase === 'give') return v.hands[this.actSeat];
    return [];
  }

  private layout(v: View): StageItem[] {
    const g = this.g;
    const CENTER = g.c;
    const items: StageItem[] = [];
    // прикуп
    if (v.phase === 'bid' || v.phase === 'dark') for (let i = 0; i < 3; i++) items.push({ key: `p:${i}`, card: null, x: CENTER.x - 70 + i * 70, y: g.prik, r: (i - 1) * 6, s: g.S, z: 5 + i });
    // взятка
    const t = v.trick;
    if (t)
      t.cards.forEach((x, i) => {
        const a = this.anchor(v, x.seat);
        const dx = (a.x - CENTER.x) * g.kx;
        const dy = (a.y - CENTER.y) * g.ky;
        items.push({ key: cardKey(x.card), card: x.card, x: CENTER.x + dx, y: CENTER.y + dy, r: ((i * 23) % 20) - 10, s: g.S, z: 20 + i, from: `b:${x.seat}:`, fromPt: a });
      });
    // руки
    for (const seat of v.seats) {
      const n = handCount(v, seat);
      if (!n) continue;
      const a = this.anchor(v, seat);
      const up = this.faceUp(v, seat);
      const me = seat === this.viewer;
      const list = up ? sortHand(v.hands[seat], v.trump) : [];
      const playable = me ? this.playable(v) : [];
      for (let k = 0; k < n; k++) {
        if (me) {
          const p = g.port ? portraitHand(n, k, a.x, a.y, 410, g.S, false) : { ...fan(n, k, a.x, a.y, 720, 80, 40, 24), s: g.S };
          if (!up) {
            items.push({ key: `b:${seat}:${k}`, card: null, ...p, z: 100 + k });
            continue;
          }
          const c = list[k];
          const sel = this.selected && sameCard(this.selected, c);
          const can = playable.some((x) => sameCard(x, c));
          const cls = this.actSeat != null && (v.phase === 'play' || v.phase === 'give') ? (sel ? 'cs-sel' : can ? 'cs-can' : 'cs-dim') : '';
          items.push({ key: cardKey(c), card: c, x: p.x, y: p.y - (sel ? 30 : 0), r: p.r, s: p.s, z: 100 + k, cls, data: { hand: '1', card: c.s + c.r } });
        } else {
          const p = fan(n, k, a.x, a.y, g.port ? 110 : 150, 16, 8, 30);
          const s = up ? g.oo : g.os;
          items.push(up ? { key: cardKey(list[k]), card: list[k], ...p, s, z: 50 + k } : { key: `b:${seat}:${k}`, card: null, ...p, s, z: 50 + k });
        }
      }
    }
    return items;
  }

  private draw(enter: Point | null = null, exit: Point | null = null) {
    const v = this.v;
    if (!v) return;
    this.cs.render(this.layout(v), this.ctx.speed(), enter, exit);
    this.drawPlates(v);
    this.drawSheet(v);
  }

  private drawPlates(v: View) {
    const g = this.g;
    const CENTER = g.c;
    let s = '';
    const giving = this.actSeat != null && v.phase === 'give' && this.selected;
    for (const seat of v.seats) {
      const a = this.anchor(v, seat);
      const me = seat === this.viewer;
      const y = me ? a.y - (g.port ? (handCount(v, seat) > 9 ? 184 : 126) : 124) : a.y + (g.port ? 44 : 62);
      const x = g.port && !me ? Math.max(80, Math.min(g.W - 80, a.x)) : a.x;
      const marks: string[] = [];
      if (v.scores[seat]) marks.push(`<i>${v.scores[seat]}</i>`);
      if (v.barrel[seat]) marks.push(`<em title="На бочке">🛢${v.barrel[seat]}</em>`);
      if (v.bolts[seat]) marks.push(`<em title="Болты">${'⚬'.repeat(v.bolts[seat])}</em>`);
      if (v.seats.length === 4 && seat === v.dealer && v.phase !== 'over') marks.push('<em>сдаёт</em>');
      if (seat === v.bidder && v.phase !== 'bid' && v.phase !== 'dark') marks.push(`<b>заказ ${v.bid}${v.dark ? ' втёмную' : ''}</b>`);
      if (v.phase === 'bid' && seat === v.bidder) marks.push(`<b>${v.bid}${v.dark ? ' втёмную' : ''}</b>`);
      if (v.phase === 'bid' && v.passed.includes(seat)) marks.push('<em>пас</em>');
      if (v.phase === 'play' && v.players.includes(seat)) marks.push(`<em>${v.roundPts[seat]}</em>`);
      const pick = giving && v.players.includes(seat) && seat !== this.actSeat && !v.given.includes(seat);
      const on = v.turn === seat && v.phase !== 'over';
      s += `<div class="cs-plate${on ? ' on' : ''}${pick ? ' pick' : ''}" style="--c:${SEATS[seat].color};left:${x}px;top:${y}px"${pick ? ` data-give="${seat}"` : ''}>${esc(this.plain(seat))} ${marks.join(' ')}</div>`;
    }
    if (v.trump) s += `<div class="th-trump" title="Козырь"><span class="${v.trump === 'H' || v.trump === 'D' ? 'red' : ''}">${SUIT_SYM[v.trump]}</span><small>козырь</small></div>`;
    if (v.phase === 'bid' || v.phase === 'dark') s += `<div class="th-label" style="left:${CENTER.x}px;top:${g.prik + 86 * g.S}px">прикуп</div>`;
    else if (v.prikup.length && v.phase !== 'over') s += `<div class="th-label th-was" style="left:${CENTER.x}px;top:${g.port ? CENTER.y + 190 : v.trick?.cards.length ? g.prik - 86 : g.prik - 14}px">прикуп был: ${v.prikup.map((c) => `<b class="${c.s === 'H' || c.s === 'D' ? 'red' : ''}">${c.r > 10 ? 'ВДКТ'[c.r - 11] : c.r}${SUIT_SYM[c.s]}</b>`).join(' ')}</div>`;
    if (v.golden && v.phase !== 'over') s += '<div class="th-golden">золотой кон · ×2</div>';
    this.plates.innerHTML = s;
  }

  /** «Пулька» — последние строки записи. */
  private drawSheet(v: View) {
    const rows = v.sheet.slice(-6);
    const head = v.seats.map((x) => `<th style="color:${SEATS[x].ink ?? SEATS[x].color}">${esc(this.plain(x)).slice(0, 7)}</th>`).join('');
    const TAG = { dark: 'т', rospis: 'р', golden: 'з', fine: 'ш' } as const;
    const TITLE = { dark: 'тёмная', rospis: 'роспись', golden: 'золотой кон', fine: 'штраф за плохую раздачу' } as const;
    const body = rows
      .map((r) => `<tr><td>${r.round}${r.tag ? `<sup title="${TITLE[r.tag]}">${TAG[r.tag]}</sup>` : ''}</td>${v.seats.map((x) => `<td class="${x === r.bidder ? (r.made ? 'ok' : 'bad') : ''}">${r.deltas[x] > 0 ? '+' : ''}${r.deltas[x] || '·'}</td>`).join('')}</tr>`)
      .join('');
    const total = `<tr class="sum"><td>Σ</td>${v.seats.map((x) => `<td>${v.scores[x]}</td>`).join('')}</tr>`;
    this.sheet.innerHTML = `<table><tr><th>#</th>${head}</tr>${body}${total}</table>`;
  }

  private plain(seat: number) {
    return this.ctx.name(seat).replace(/<[^>]+>/g, '');
  }

  // ---------------------------------------------------------------- ход

  private onClick(e: MouseEvent) {
    const v = this.v;
    if (!v || this.actSeat == null || this.hidden) return;
    const el = (e.target as Element).closest('[data-hand]') as HTMLElement | null;
    if (!el) return;
    const id = el.dataset.card!;
    const card = v.hands[this.actSeat].find((c) => c.s + c.r === id);
    if (!card) return;
    if (v.phase === 'give') {
      this.selected = this.selected && sameCard(this.selected, card) ? null : card;
      Sound.ui();
      this.draw();
      this.renderButtons();
      return;
    }
    if (v.phase !== 'play' || !legalCards(v, this.actSeat).some((c) => sameCard(c, card))) {
      Sound.nomove();
      return;
    }
    if (marriageFor(v, this.actSeat, card)) {
      this.askMarriage = card;
      this.selected = card;
      this.draw();
      this.renderButtons();
      return;
    }
    this.send({ type: 'play', card });
  }

  private send(a: Parameters<ViewCtx['act']>[1]) {
    const seat = this.actSeat;
    if (seat == null) return;
    Sound.unlock();
    this.clearTurn();
    this.ctx.act(seat, a);
  }

  private clearTurn() {
    this.actSeat = null;
    this.selected = null;
    this.askMarriage = null;
    this.btns.innerHTML = '';
  }

  private button(text: string, primary: boolean, on: () => void, cls = '') {
    const b = h<HTMLButtonElement>(`<button class="btn ${primary ? 'primary' : ''} ${cls}">${text}</button>`);
    b.onclick = () => {
      Sound.unlock();
      on();
    };
    this.btns.appendChild(b);
  }

  private renderButtons() {
    this.btns.innerHTML = '';
    const v = this.v;
    const seat = this.actSeat;
    if (!v || seat == null || this.ctx.demo || this.hidden) return;
    const hand = v.hands[seat];
    if (v.phase === 'dark') {
      this.btns.appendChild(h('<div class="th-ask">Вы первая рука. Темнить — сыграть 120, не глядя в карты? Очки вдвойне: +240 или −240.</div>'));
      this.button('Темню!', false, () => this.send({ type: 'dark' }));
      this.button('Смотрю карты', true, () => this.send({ type: 'light' }));
      return;
    }
    if (v.phase === 'bid') {
      const max = maxBid(hand, v.cfg.aces);
      const next = v.bid + v.cfg.step;
      this.btns.appendChild(h(`<div class="th-ask">Торговля: сейчас ${v.bid}${v.bidder >= 0 ? ` (${esc(this.plain(v.bidder))})` : ''}. Вам можно до ${max}.</div>`));
      const row = h('<div class="th-row"></div>');
      for (const add of [0, 5, 10, 20]) {
        const val = next + add;
        if (val > max) break;
        const b = h<HTMLButtonElement>(`<button class="btn ${add === 0 ? 'primary' : ''}">${val}</button>`);
        b.onclick = () => this.send({ type: 'bid', value: val });
        row.appendChild(b);
      }
      this.btns.appendChild(row);
      this.button('Пас', false, () => this.send({ type: 'pass' }));
      return;
    }
    if (v.phase === 'give') {
      const left = v.players.filter((x) => x !== seat && !v.given.includes(x));
      this.btns.appendChild(h(`<div class="th-ask">${this.selected ? 'Кому отдать карту?' : 'Выберите карту, которую отдадите'}</div>`));
      if (this.selected) for (const to of left) this.button(`Отдать — ${esc(this.plain(to))}`, true, () => this.send({ type: 'give', to, card: this.selected! }));
      const why = prikupRedeal(v);
      if (why) this.button(`Пересдать (${why === 'prikup9' ? 'две девятки в прикупе' : 'пустой прикуп'})`, false, () => this.send({ type: 'redeal' }));
      return;
    }
    if (v.phase === 'raise') {
      const max = Math.max(v.bid, maxBid(hand, v.cfg.aces));
      this.btns.appendChild(h(`<div class="th-ask">Заказ ${v.bid}. Поднять?</div>`));
      const row = h('<div class="th-row"></div>');
      this.button(`Играю ${v.bid}`, true, () => this.send({ type: 'raise', value: v.bid }));
      for (const add of [10, 20, 30, 50]) {
        const val = v.bid + add;
        if (val > max) break;
        const b = h<HTMLButtonElement>(`<button class="btn">${val}</button>`);
        b.onclick = () => this.send({ type: 'raise', value: val });
        row.appendChild(b);
      }
      this.btns.appendChild(row);
      if (canRospis(v)) this.button(`Расписаться (${v.dark ? -2 * v.bid : -v.bid}, соперникам по ${rospisPay(v)})`, false, () => this.send({ type: 'rospis' }), 'th-rospis');
      return;
    }
    if (v.phase === 'play' && this.askMarriage) {
      const c = this.askMarriage;
      const m = marriageFor(v, seat, c) as MarriageKind;
      const pts = marriageValue(m);
      this.btns.appendChild(h(`<div class="th-ask">${m === 'A' ? `Объявить тузовый марьяж? (+${pts}, козырь не меняется)` : `Объявить марьяж ${SUIT_SYM[m]}? (+${pts}, козырь — ${SUIT_SYM[m]})`}</div>`));
      this.button(`Марьяж! +${pts}`, true, () => this.send({ type: 'play', card: c, marriage: true }));
      this.button('Просто сходить', false, () => this.send({ type: 'play', card: c }));
      this.button('Отмена', false, () => {
        this.askMarriage = null;
        this.selected = null;
        this.draw();
        this.renderButtons();
      });
    }
  }

  // ---------------------------------------------------------------- состояние

  setView(v: View) {
    this.v = v;
    this.banner.hidden = true;
    this.draw();
  }

  /** Подождать ms или до нажатия «Дальше». */
  private hold(ms: number): Promise<void> {
    return new Promise((done) => {
      const b = h<HTMLButtonElement>('<button class="btn primary">Дальше ▸</button>');
      const end = () => {
        clearTimeout(t);
        b.remove();
        done();
      };
      const t = setTimeout(end, ms);
      b.onclick = end;
      if (ms > 2000) this.btns.appendChild(b);
    });
  }

  private async showBanner(text: string, ms: number) {
    this.banner.textContent = text;
    this.banner.hidden = false;
    if (!ms) return;
    await sleep(ms);
    this.banner.hidden = true;
  }

  async play(events: Event[], v: View) {
    this.busy = true;
    try {
      await this.animate(events, v);
    } finally {
      this.busy = false;
    }
  }

  private async animate(events: Event[], v: View) {
    const speed = this.ctx.speed();
    this.clearTurn();
    for (const ev of events) {
      if (ev.type === 'play') {
        const cur = this.v!;
        const t = cur.trick && cur.trick.cards.length < cur.players.length ? cur.trick : { leader: ev.seat, cards: [] };
        this.v = {
          ...cur,
          trick: { leader: t.leader, cards: [...t.cards, { seat: ev.seat, card: ev.card }] },
          hands: cur.hands.map((hh, i) => (i === ev.seat ? hh.filter((c) => !sameCard(c, ev.card)) : hh)),
          counts: cur.counts.map((n, i) => (i === ev.seat ? n - 1 : n)),
          trump: ev.trump,
        };
        this.draw(null);
        Sound.card();
        if (ev.marriage) await this.showBanner(`${ev.marriage === 'A' ? 'Тузовый марьяж' : `Марьяж ${SUIT_SYM[ev.marriage]}`}! +${marriageValue(ev.marriage)}`, 900 / speed);
        else await sleep(260 / speed);
      } else if (ev.type === 'trick') {
        await sleep(500 / speed);
        const cur = this.v!;
        this.v = { ...cur, trick: null };
        this.draw(null, this.anchor(cur, ev.winner));
        Sound.step();
        await sleep(300 / speed);
      } else if (ev.type === 'prikup') {
        // прикуп переворачивается на месте и лежит, пока его не рассмотрят (10 с или «Дальше»), потом уходит заказчику
        const cur = this.v!;
        this.cs.render(
          [...this.layout({ ...cur, phase: 'give' }), ...ev.cards.map((c, i) => ({ key: cardKey(c), card: c, x: this.g.c.x - 114 + i * 114, y: this.g.prik, r: 0, s: this.g.S, z: 30 + i, from: 'p:' }))],
          speed
        );
        Sound.card();
        const mine = !this.ctx.demo && ev.seat === this.viewer && this.ctx.mySeats.includes(ev.seat);
        this.banner.textContent = `${this.plain(ev.seat)} берёт прикуп за ${ev.bid}`;
        this.banner.hidden = false;
        this.banner.classList.add('cs-banner-top');
        await this.hold(this.ctx.demo ? 1200 / speed : mine ? 1500 : 10000);
        this.banner.classList.remove('cs-banner-top');
        this.banner.hidden = true;
        // карты прикупа уходят в руку заказчику (соперник — рубашками)
        const known = cur.hands[ev.seat].length === handCount(cur, ev.seat);
        const next: View = {
          ...cur,
          prikup: ev.cards,
          shown: true,
          phase: 'give',
          hands: cur.hands.map((hh, i) => (i === ev.seat && known ? [...hh, ...ev.cards] : hh)),
          counts: cur.counts.map((n, i) => (i === ev.seat ? n + ev.cards.length : n)),
        };
        const left = known ? [] : ev.cards.slice();
        const fresh = this.layout(next).map((it) => {
          if (this.cs.has(it.key) || !it.key.startsWith(`b:${ev.seat}:`) || !left.length) return it;
          return { ...it, from: cardKey(left.shift()!) };
        });
        this.cs.render(fresh, speed);
        this.v = next;
        this.drawPlates(next);
        await sleep(380 / speed);
      } else if (ev.type === 'give') {
        // отданная карта летит к получателю
        const cur = this.v!;
        const c = ev.card;
        const seeTo = cur.hands[ev.to].length === handCount(cur, ev.to);
        const next: View = {
          ...cur,
          given: [...cur.given, ev.to],
          hands: cur.hands.map((hh, i) => (i === ev.seat && c ? hh.filter((x) => !sameCard(x, c)) : i === ev.to && c && seeTo ? [...hh, c] : hh)),
          counts: cur.counts.map((n, i) => (i === ev.seat ? n - 1 : i === ev.to ? n + 1 : n)),
        };
        const from = c && this.cs.has(cardKey(c)) ? cardKey(c) : `b:${ev.seat}:`;
        const fromPt = this.anchor(cur, ev.seat);
        const items = this.layout(next).map((it) => (!this.cs.has(it.key) && (it.key.startsWith(`b:${ev.to}:`) || (c && it.key === cardKey(c))) ? { ...it, from, fromPt } : it));
        this.v = next;
        this.cs.render(items, speed);
        this.drawPlates(next);
        Sound.card();
        await sleep(420 / speed);
      } else if (ev.type === 'bid' || ev.type === 'pass') {
        Sound.ui();
      } else if (ev.type === 'dark') {
        Sound.ui();
        if (ev.dark) await this.showBanner(`${this.plain(ev.seat)}: темню!`, 1000 / speed);
      } else if (ev.type === 'redeal') {
        Sound.shuffle();
        await this.showBanner(ev.reason === 'nines' ? `Четыре девятки у ${this.plain(ev.seat)} — пересдача` : 'Пересдача', 1100 / speed);
      } else if (ev.type === 'fine') {
        this.v = { ...this.v!, scores: ev.scores };
        this.draw();
        await this.showBanner(`Три пересдачи подряд: ${this.plain(ev.seat)} ${ev.amount}`, 1300 / speed);
      } else if (ev.type === 'rospis') {
        await this.showBanner(`${this.plain(ev.seat)} расписывается`, 1000 / speed);
      } else if (ev.type === 'score') {
        this.v = { ...v, trick: null };
        this.draw();
        if (!ev.rospis) await this.showBanner(ev.made ? `Заказ ${ev.bid} сыгран!` : `Заказ ${ev.bid} не сыгран`, 1400 / speed);
      } else if (ev.type === 'deal') {
        Sound.shuffle();
      } else if (ev.type === 'end') {
        Sound.win();
        this.v = v;
        this.draw();
        await this.showBanner(`Тысяча! Победа: ${this.plain(ev.winner)}`, 0);
      }
    }
    this.v = v;
    this.draw({ x: this.g.c.x, y: this.g.prik });
  }

  setTurn(toAct: number[], interactive: number[]) {
    if (this.busy) {
      this.actSeat = null;
      return;
    }
    this.clearTurn();
    const v = this.v;
    if (!v || v.phase === 'over' || this.ctx.demo) return;
    this.chooseViewer(v, toAct);
    const seat = interactive.find((x) => x === this.viewer) ?? null;
    if (this.hidden && interactive.length && this.ctx.mySeats.length > 1) {
      (this.cover.querySelector('.th-cover-t') as HTMLElement).innerHTML = `Ход: ${this.ctx.name(this.viewer)}.<br><small>Передайте устройство — остальным не подглядывать!</small>`;
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
    if (v.phase === 'over') return v.winner != null ? `Тысяча у ${name(v.winner)}!` : 'Партия окончена';
    const who = toAct[0];
    const mine = interactive.includes(who);
    switch (v.phase) {
      case 'dark':
        return mine ? 'Темнить или смотреть карты?' : `${name(who)} решает, темнить ли…`;
      case 'bid':
        return mine ? 'Торгуйтесь: больше или пас?' : `Торгуется ${name(who)}…`;
      case 'give':
        return mine ? 'Отдайте по карте соперникам' : `${name(who)} отдаёт карты…`;
      case 'raise':
        return mine ? (canRospis(v) ? 'Поднять заказ, играть или расписаться?' : 'Поднять заказ?') : `${name(who)} думает над заказом…`;
      default:
        return mine ? 'Ваш ход' : `Ходит ${name(who)}…`;
    }
  }

  playerStats(v: View, seat: number) {
    return `<span title="Очки">${v.scores[seat]}</span>${v.barrel[seat] ? ' · на бочке' : ''}${v.falls?.[seat] ? ` · слётов ${v.falls[seat]}` : ''}`;
  }

  destroy() {
    this.cs.destroy();
  }
}

export function createView(): GameView<View, Event> {
  return new ThousandView();
}
