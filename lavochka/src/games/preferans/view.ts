/* Преферанс — отрисовка: стол под сукном, свой веер снизу, соперники слева и справа (открытые руки — лицом), прикуп и взятка в центре.
 * Торговля — сеткой ставок в панели; снос — выбрать две карты; вист — кнопками; «пулька» (пуля, гора, висты) — там же.
 * Игра в светлую: за открытого пасующего ходит вистующий — его карты тоже нажимаются. */
import { Sound } from '../../core/audio';
import { esc, h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { preloadDeck } from '../../cards/render';
import { settings } from '../../core/settings';
import { sameCard, sortHand, SUIT_SYM, type Card, type Suit } from '../../cards/deck';
import { CardStage, cardKey, fan, type Point, type StageItem } from '../../cards/stage';
import { allBids, bidName, bidRank, DUTY, finalScores, goraForFinal, handCount, isMisere, legalCards, levelOk, minLevel, SKAKS, type Bid, type Event, type View } from './engine';
import { SEATS } from './def';
import './preferans.css';

const W = 1000;
const H = 720;
const HAND_Y = 615;
const CENTER = { x: 500, y: 320 };

class PrefView implements GameView<View, Event> {
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
  private selected: Card[] = [];
  /** Идёт анимация play(): setTurn в это время только снимает управление. */
  private busy = false;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    preloadDeck(settings.deck);
    this.cs = new CardStage(root, W, H, 'pf-wrap', '<div class="pf-cloth"></div>');
    this.cs.over.innerHTML = '<div class="pf-plates"></div><div class="cs-banner" hidden></div>';
    this.plates = this.cs.over.querySelector('.pf-plates') as HTMLElement;
    this.banner = this.cs.over.querySelector('.cs-banner') as HTMLElement;
    this.cover = h('<div class="cs-cover" hidden><div class="cs-cover-box"><div class="pf-cover-t"></div><button class="btn primary">Показать карты</button></div></div>');
    this.cs.stage.appendChild(this.cover);
    (this.cover.querySelector('button') as HTMLButtonElement).onclick = () => {
      Sound.unlock();
      this.hidden = false;
      this.cover.hidden = true;
      this.draw();
      this.renderButtons();
    };
    const ctl = h(`<div class="pf-controls"><div class="pf-btns"></div><div class="pf-sheet"></div>${ctx.demo ? '' : '<div class="hint small-hint">Ход — нажать на карту. Снос — выбрать две карты и «Снести».</div>'}</div>`);
    ctx.controls.appendChild(ctl);
    this.btns = ctl.querySelector('.pf-btns') as HTMLElement;
    this.sheet = ctl.querySelector('.pf-sheet') as HTMLElement;
    this.cs.stage.addEventListener('click', (e) => this.onClick(e));
  }

  private order(v: View): number[] {
    const i0 = Math.max(0, v.seats.indexOf(this.viewer));
    return v.seats.map((_, k) => v.seats[(i0 + k) % v.seats.length]);
  }

  private anchor(v: View, seat: number): Point {
    const k = this.order(v).indexOf(seat);
    if (k === 0) return { x: 500, y: HAND_Y };
    if (v.seats.length === 3) return k === 1 ? { x: 160, y: 230 } : { x: 840, y: 230 };
    return k === 1 ? { x: 140, y: 260 } : k === 2 ? { x: 500, y: 92 } : { x: 860, y: 260 };
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

  /** Чьими картами сейчас ходит этот экран (своими или открытого пасующего). */
  private controlled(v: View): number | null {
    if (this.actSeat == null || this.hidden) return null;
    return v.phase === 'play' ? v.turn : this.actSeat;
  }

  private faceUp(v: View, seat: number) {
    if (seat === this.viewer) return this.ctx.demo || (!this.hidden && this.ctx.mySeats.includes(seat));
    // открытые руки (в светлую, ловящие на мизере) и все — в показе правил
    return v.hands[seat].length > 0 && (this.ctx.demo || !this.hidden);
  }

  private layout(v: View): StageItem[] {
    const items: StageItem[] = [];
    if (v.phase === 'bid' || v.phase === 'dark') for (let i = 0; i < 2; i++) items.push({ key: `p:${i}`, card: null, x: CENTER.x - 30 + i * 60, y: 240, r: (i - 0.5) * 8, s: 0.62, z: 5 + i });
    const t = v.trick;
    if (t) {
      if (t.prikup) items.push({ key: cardKey(t.prikup), card: t.prikup, x: CENTER.x, y: 230, r: 0, s: 0.66, z: 18, cls: 'pf-prk', from: 'p:' });
      t.cards.forEach((x, i) => {
        const a = this.anchor(v, x.seat);
        items.push({ key: cardKey(x.card), card: x.card, x: CENTER.x + (a.x - CENTER.x) * 0.24, y: CENTER.y + 30 + (a.y - CENTER.y) * 0.2, r: ((i * 23) % 20) - 10, s: 0.8, z: 20 + i, from: `b:${x.seat}:`, fromPt: a });
      });
    }
    const ctl = this.controlled(v);
    const legal = ctl != null && v.phase === 'play' ? legalCards(v, ctl) : [];
    for (const seat of v.seats) {
      const n = handCount(v, seat);
      if (!n) continue;
      const a = this.anchor(v, seat);
      const me = seat === this.viewer;
      const up = this.faceUp(v, seat) && v.hands[seat].length === n;
      const list = up ? sortHand(v.hands[seat], v.trump && v.trump !== 'NT' ? (v.trump as Suit) : undefined) : [];
      for (let k = 0; k < n; k++) {
        const p = me ? fan(n, k, a.x, a.y, 720, 64, 40, 24) : fan(n, k, a.x, a.y, up ? 250 : 150, up ? 26 : 14, 8, up ? 20 : 30);
        const s = me ? 1 : up ? 0.62 : 0.52;
        if (!up) {
          items.push({ key: `b:${seat}:${k}`, card: null, ...p, s, z: (me ? 100 : 50) + k });
          continue;
        }
        const c = list[k];
        const mine = ctl === seat;
        const sel = mine && this.selected.some((x) => sameCard(x, c));
        const can = mine && (v.phase === 'discard' || legal.some((x) => sameCard(x, c)));
        const cls = mine && (v.phase === 'play' || v.phase === 'discard') ? (sel ? 'cs-sel' : can ? 'cs-can' : 'cs-dim') : '';
        items.push({ key: cardKey(c), card: c, x: p.x, y: p.y - (sel ? (me ? 30 : 16) : 0), r: p.r, s, z: (me ? 100 : 50) + k, cls, data: mine ? { hand: c.s + c.r, seat: String(seat) } : undefined });
      }
    }
    return items;
  }

  private draw(enter: Point | null = null, exit: Point | null = null) {
    const v = this.v;
    if (!v) return;
    this.cs.render(this.layout(v), this.ctx.speed(), enter, exit);
    let s = '';
    for (const seat of v.seats) {
      const a = this.anchor(v, seat);
      const me = seat === this.viewer;
      const y = me ? a.y - 112 : a.y + 66;
      const marks: string[] = [];
      if (v.seats.length === 4 && seat === v.dealer && v.phase !== 'over') marks.push('<em>сдаёт</em>');
      if (v.phase === 'bid' && v.passed.includes(seat)) marks.push('<em>пас</em>');
      if (v.phase === 'bid' && seat === v.bidder && v.bid) marks.push(`<b>${bidName(v.bid)}</b>`);
      if (v.phase !== 'bid' && seat === v.declarer && v.contract) marks.push(`<b>${bidName(v.contract)}</b>`);
      if (v.whist[seat]) marks.push(`<em>${{ whist: 'вист', pass: 'пас', half: 'полвиста' }[v.whist[seat]]}</em>`);
      if (v.phase === 'bid' && seat === v.darkSeat) marks.push('<em>втёмную</em>');
      if (v.bombs[seat]?.length) marks.push(`<em title="Бомбы: ${v.bombs[seat].map((b) => '×' + b).join(', ')}">💣${v.bombs[seat].length > 1 ? v.bombs[seat].length : ''}</em>`);
      if (v.phase === 'play') marks.push(`<i>${v.tricks[seat]}</i>`);
      const on = v.turn === seat && v.phase !== 'over';
      s += `<div class="cs-plate${on ? ' on' : ''}" style="--c:${SEATS[seat].color};left:${a.x}px;top:${y}px">${esc(this.plain(seat))} ${marks.join(' ')}</div>`;
    }
    if (v.trump && v.trump !== 'NT') s += `<div class="pf-trump"><span class="${v.trump === 'H' || v.trump === 'D' ? 'red' : ''}">${SUIT_SYM[v.trump as Suit]}</span><small>козырь</small></div>`;
    else if (v.kind === 'raspasy' && v.phase === 'play') s += '<div class="pf-trump"><span>☰</span><small>распасы</small></div>';
    else if (v.kind === 'misere' && v.phase === 'play') s += '<div class="pf-trump"><span>∅</span><small>мизер</small></div>';
    if (v.prikup.length && v.phase !== 'bid' && v.kind !== 'raspasy') s += `<div class="pf-label" style="left:${CENTER.x}px;top:200px">прикуп был: ${v.prikup.map((c) => SUIT_SYM[c.s] + (c.r > 10 ? 'ВДКТ'[c.r - 11] : c.r)).join(' ')}</div>`;
    this.plates.innerHTML = s;
    this.drawSheet(v);
  }

  private drawSheet(v: View) {
    const seats = v.seats;
    const head = seats.map((x) => `<th style="color:${SEATS[x].ink ?? SEATS[x].color}">${esc(this.plain(x)).slice(0, 7)}</th>`).join('');
    const row = (label: string, f: (x: number) => string | number) => `<tr><td>${label}</td>${seats.map((x) => `<td>${f(x)}</td>`).join('')}</tr>`;
    const fin = v.final ?? finalScores(v);
    const num = (n: number) => String(Math.round(n * 10) / 10);
    const sk = v.cfg.variant === 'skachki';
    const g = goraForFinal(v);
    this.sheet.innerHTML = `<table><tr><th></th>${head}</tr>
      ${sk ? `<tr><td colspan="${seats.length + 1}" class="pf-sk">скак ${Math.min(v.skak, SKAKS)} из ${SKAKS} · до ${v.cfg.pulya}</td></tr>` : ''}
      ${row(sk ? 'пуля скака' : `пуля /${v.cfg.pulya}`, (x) => v.pulya[x])}
      ${row(sk ? 'гора скака' : 'гора', (x) => num(v.gora[x]))}
      ${sk ? row('пуля всего', (x) => v.totPulya[x] + v.pulya[x]) : ''}
      ${sk || v.cfg.variant === 'leningrad' ? row(sk ? 'гора всего' : 'гора с пулей', (x) => num(g[x])) : ''}
      ${row('висты', (x) => num(seats.reduce((a, y) => a + (y !== x ? v.whists[x][y] : 0), 0)))}
      <tr class="sum"><td>итог</td>${seats.map((x) => `<td>${fin[x] > 0 ? '+' : ''}${fin[x]}</td>`).join('')}</tr></table>`;
  }

  private plain(seat: number) {
    return this.ctx.name(seat).replace(/<[^>]+>/g, '');
  }

  private onClick(e: MouseEvent) {
    const v = this.v;
    const ctl = v ? this.controlled(v) : null;
    if (!v || ctl == null) return;
    const el = (e.target as Element).closest('[data-hand]') as HTMLElement | null;
    if (!el) return;
    const card = v.hands[ctl].find((c) => c.s + c.r === el.dataset.hand);
    if (!card) return;
    if (v.phase === 'discard') {
      const i = this.selected.findIndex((x) => sameCard(x, card));
      if (i >= 0) this.selected.splice(i, 1);
      else {
        if (this.selected.length >= 2) this.selected.shift();
        this.selected.push(card);
      }
      Sound.ui();
      this.draw();
      this.renderButtons();
      return;
    }
    if (v.phase !== 'play') return;
    if (!legalCards(v, ctl).some((c) => sameCard(c, card))) {
      Sound.nomove();
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
    this.selected = [];
    this.btns.innerHTML = '';
  }

  private button(text: string, primary: boolean, on: () => void, disabled = false) {
    const b = h<HTMLButtonElement>(`<button class="btn ${primary ? 'primary' : ''}"${disabled ? ' disabled' : ''}>${text}</button>`);
    b.onclick = () => {
      Sound.unlock();
      on();
    };
    this.btns.appendChild(b);
  }

  private bidGrid(min: Bid | null, onPick: (b: Bid) => void, allowMisere: boolean, level = 6) {
    const grid = h('<div class="pf-grid"></div>');
    for (const b of allBids()) {
      if (isMisere(b) && !allowMisere) continue;
      const off = (min != null && bidRank(b) <= bidRank(min)) || !levelOk(b, level);
      const label = isMisere(b) ? 'мизер' : `${b.level}${b.trump === 'NT' ? 'БК' : SUIT_SYM[b.trump as Suit]}`;
      const red = !isMisere(b) && (b.trump === 'H' || b.trump === 'D');
      const el = h<HTMLButtonElement>(`<button class="btn pf-bid${red ? ' red' : ''}${isMisere(b) ? ' mis' : ''}"${off ? ' disabled' : ''}>${label}</button>`);
      el.onclick = () => onPick(b);
      grid.appendChild(el);
    }
    this.btns.appendChild(grid);
  }

  private renderButtons() {
    this.btns.innerHTML = '';
    const v = this.v;
    const seat = this.actSeat;
    if (!v || seat == null || this.ctx.demo || this.hidden) return;
    switch (v.phase) {
      case 'dark':
        this.btns.appendChild(h('<div class="pf-ask">Ваше первое слово. Спасовать втёмную, не глядя в карты? Если будут распасы — они вдвое, а вам бомба; перебить пас втёмную можно только семерной.</div>'));
        this.button('Пас втёмную', true, () => this.send({ type: 'dark-pass' }));
        this.button('Смотреть карты', false, () => this.send({ type: 'look' }));
        return;
      case 'bid': {
        const min = minLevel(v);
        this.btns.appendChild(h(`<div class="pf-ask">Торговля: ${v.bid ? `сейчас ${bidName(v.bid)}` : 'ставок не было'}${min > 6 ? ` · не ниже ${min}-й (${v.darkSeat != null ? 'пас втёмную' : 'выход из распасов'})` : ''}</div>`));
        this.bidGrid(v.bid, (b) => this.send({ type: 'bid', bid: b }), !v.spoke.includes(seat), min);
        this.button('Пас', false, () => this.send({ type: 'pass' }));
        return;
      }
      case 'discard':
        this.btns.appendChild(h(`<div class="pf-ask">Снесите две карты (выбрано ${this.selected.length})</div>`));
        this.button('Снести', true, () => this.send({ type: 'discard', cards: this.selected }), this.selected.length !== 2);
        return;
      case 'contract': {
        this.btns.appendChild(h(`<div class="pf-ask">Какую игру заказать? Не ниже ${bidName(v.bid)}</div>`));
        const grid = h('<div class="pf-grid"></div>');
        for (const b of allBids()) {
          if (isMisere(b)) continue;
          const off = bidRank(b) < bidRank(v.bid!);
          const red = b.trump === 'H' || b.trump === 'D';
          const el = h<HTMLButtonElement>(`<button class="btn pf-bid${red ? ' red' : ''}"${off ? ' disabled' : ''}>${b.level}${b.trump === 'NT' ? 'БК' : SUIT_SYM[b.trump as Suit]}</button>`);
          el.onclick = () => this.send({ type: 'contract', bid: b });
          grid.appendChild(el);
        }
        this.btns.appendChild(grid);
        if (v.cfg.concede) this.button(`Сдать без ${v.cfg.concede === 2 ? 'двух' : 'трёх'}`, false, () => this.send({ type: 'concede' }));
        return;
      }
      case 'whist': {
        const c = v.contract as { level: number };
        const who = esc(this.plain(v.declarer));
        const halfAsk = v.cfg.halfWhist && c.level <= 7;
        if (v.wstep === 'choose') {
          this.btns.appendChild(h(`<div class="pf-ask">Вистуете один против ${who} (${bidName(v.contract)}). Как играть?</div>`));
          this.button('В светлую', true, () => this.send({ type: 'show', open: true }));
          this.button('Втёмную', false, () => this.send({ type: 'show', open: false }));
          if (!v.cfg.greedy && halfAsk && !v.wback && v.players.find((x) => x !== v.declarer && x !== seat && v.whist[x] === 'pass') != null && v.whistOrder[0] === seat)
            this.button(`Полвиста (+${DUTY[c.level] / 2} взятки)`, false, () => this.send({ type: 'half-whist' }));
          return;
        }
        if (v.wstep === 'return') {
          this.btns.appendChild(h(`<div class="pf-ask">Сосед ушёл за полвиста. Вернуть вист — играть против ${who} самому?</div>`));
          this.button('Вернуть вист', true, () => this.send({ type: 'whist' }));
          this.button('Пас', false, () => this.send({ type: 'pass-whist' }));
          return;
        }
        this.btns.appendChild(h(`<div class="pf-ask">${who} играет ${bidName(v.contract)}. Вистовать?</div>`));
        this.button('Вист', true, () => this.send({ type: 'whist' }));
        this.button('Пас', false, () => this.send({ type: 'pass-whist' }));
        const firstPassed = Object.values(v.whist).includes('pass');
        if (v.wstep === 'd2' && halfAsk && firstPassed) this.button(`Полвиста (+${DUTY[c.level] / 2} взятки)`, false, () => this.send({ type: 'half-whist' }));
        return;
      }
      case 'play':
        if (v.turn !== seat) this.btns.appendChild(h(`<div class="pf-ask">Ходите за ${esc(this.plain(v.turn))} (его карты открыты)</div>`));
        return;
    }
  }

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
    this.busy = true;
    try {
      await this.animate(events, v);
    } finally {
      this.busy = false;
    }
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

  private async animate(events: Event[], v: View) {
    const speed = this.ctx.speed();
    this.clearTurn();
    for (const ev of events) {
      const cur = this.v!;
      if (ev.type === 'play') {
        const t = cur.trick ?? { leader: ev.seat, cards: [] };
        this.v = {
          ...cur,
          trick: { ...t, cards: [...t.cards, { seat: ev.seat, card: ev.card }] },
          hands: cur.hands.map((hh, i) => (i === ev.seat ? hh.filter((c) => !sameCard(c, ev.card)) : hh)),
          counts: cur.counts.map((n, i) => (i === ev.seat ? n - 1 : n)),
        };
        this.draw();
        Sound.card();
        await sleep(240 / speed);
      } else if (ev.type === 'trick') {
        await sleep(480 / speed);
        this.v = { ...this.v!, trick: null, tricks: this.v!.tricks.map((x, i) => (i === ev.winner ? x + 1 : x)) };
        this.draw(null, this.anchor(cur, ev.winner));
        Sound.step();
        await sleep(260 / speed);
      } else if (ev.type === 'prikup') {
        // прикуп переворачивается на месте и лежит, пока его не рассмотрят (10 с или «Дальше»), потом уходит заказчику
        this.cs.render([...this.layout({ ...cur, phase: 'bid', bid: null }).filter((it) => !it.key.startsWith('p:')), ...ev.cards.map((c, i) => ({ key: cardKey(c), card: c, x: CENTER.x - 52 + i * 104, y: 240, r: 0, s: 0.9, z: 30 + i, from: 'p:' }))], speed);
        Sound.card();
        const mine = !this.ctx.demo && ev.seat === this.viewer && this.ctx.mySeats.includes(ev.seat);
        this.banner.textContent = `Прикуп — ${this.plain(ev.seat)}`;
        this.banner.hidden = false;
        this.banner.classList.add('cs-banner-top');
        await this.hold(this.ctx.demo ? 1300 / speed : mine ? 1500 : 10000);
        this.banner.classList.remove('cs-banner-top');
        this.banner.hidden = true;
        const known = cur.hands[ev.seat].length === handCount(cur, ev.seat);
        const next: View = {
          ...cur,
          phase: 'discard',
          prikup: ev.cards,
          hands: cur.hands.map((hh, i) => (i === ev.seat && known ? [...hh, ...ev.cards] : hh)),
          counts: cur.counts.map((n, i) => (i === ev.seat ? n + ev.cards.length : n)),
        };
        const left = known ? [] : ev.cards.slice();
        this.cs.render(this.layout(next).map((it) => (this.cs.has(it.key) || !it.key.startsWith(`b:${ev.seat}:`) || !left.length ? it : { ...it, from: cardKey(left.shift()!) })), speed);
        this.v = next;
        await sleep(380 / speed);
      } else if (ev.type === 'raspasy') {
        await this.showBanner(ev.forced ? 'Распасы (обязательные)' : 'Распасы!', 1000 / speed);
      } else if (ev.type === 'dark') {
        Sound.ui();
        if (ev.dark) await this.showBanner(`${this.plain(ev.seat)}: пас втёмную!`, 1000 / speed);
      } else if (ev.type === 'show') {
        Sound.ui();
        await this.showBanner(`${this.plain(ev.seat)}: ${ev.open ? 'в светлую' : 'втёмную'}`, 800 / speed);
      } else if (ev.type === 'skak') {
        Sound.win();
        await this.showBanner(`Скак ${ev.skak} окончен`, 1600 / speed);
      } else if (ev.type === 'contract') {
        Sound.ui();
        await this.showBanner(`${this.plain(ev.seat)}: ${bidName(ev.bid)}`, 900 / speed);
      } else if (ev.type === 'bid' || ev.type === 'pass' || ev.type === 'whist') {
        Sound.ui();
      } else if (ev.type === 'score') {
        this.v = { ...v, trick: null };
        this.draw();
        const msg =
          ev.kind === 'raspasy'
            ? 'Распасы сыграны'
            : ev.kind === 'free'
              ? 'Без розыгрыша — сыграна'
              : ev.kind === 'half'
                ? 'Полвиста — сыграна'
                : ev.kind === 'concede'
                  ? `${bidName(ev.contract)} — сдана без розыгрыша`
                  : ev.made
                    ? `${bidName(ev.contract)} — сыграна!`
                    : `${bidName(ev.contract)} — без взяток!`;
        await this.showBanner(msg, 1400 / speed);
      } else if (ev.type === 'deal') Sound.shuffle();
      else if (ev.type === 'end') {
        Sound.win();
        this.v = v;
        this.draw();
        await this.showBanner('Пуля закрыта!', 0);
      }
    }
    this.v = v;
    this.draw({ x: CENTER.x, y: 240 });
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
      (this.cover.querySelector('.pf-cover-t') as HTMLElement).innerHTML = `Ход: ${this.ctx.name(this.viewer)}.<br><small>Передайте устройство — остальным не подглядывать!</small>`;
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
    if (v.phase === 'over') return 'Пуля закрыта';
    const who = toAct[0];
    const mine = interactive.includes(who);
    switch (v.phase) {
      case 'dark':
        return mine ? 'Пас втёмную или смотреть карты?' : `${name(who)} решает, пасовать ли втёмную…`;
      case 'bid':
        return mine ? 'Торгуйтесь' : `Торгуется ${name(who)}…`;
      case 'discard':
        return mine ? 'Снесите две карты' : `${name(who)} сносит…`;
      case 'contract':
        return mine ? 'Закажите игру' : `${name(who)} заказывает…`;
      case 'whist':
        if (v.wstep === 'choose') return mine ? 'В светлую или втёмную?' : `${name(who)} решает, как вистовать…`;
        return mine ? (v.wstep === 'return' ? 'Вернуть вист?' : 'Вист или пас?') : `${name(who)} думает, вистовать ли…`;
      default:
        return mine ? 'Ваш ход' : `Ходит ${name(v.turn)}…`;
    }
  }

  playerStats(v: View, seat: number) {
    return `пуля ${v.pulya[seat]} · гора ${Math.round(v.gora[seat] * 10) / 10}`;
  }

  destroy() {
    this.cs.destroy();
  }
}

export function createView(): GameView<View, Event> {
  return new PrefView();
}
