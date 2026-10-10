/* Дурак — отрисовка: дворовый стол под клеёнкой, веер своих карт, соперники по дуге, колода с козырем, бито.
 * Карты — HTML-элементы на «сцене» 1000×720 (масштабируется под экран). Каждая карта живёт под своим ключом,
 * а анимация — это CSS-переход transform от старого места к новому (новые карты влетают из колоды или от игрока). */
import { Sound } from '../../core/audio';
import { settings } from '../../core/settings';
import { esc, h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { cardHTML, preloadDeck } from '../../cards/render';
import { cardId, sameCard, sortHand, SUIT_NAME, SUIT_SYM, SUITS, type Card, type Suit } from '../../cards/deck';
import { beats, canTransfer, deckLeft, has, longOn, room, throwable, transferTarget, trumpOf, unbeaten, type Action, type Event, type View } from './engine';
import { SEATS, titleOf } from './def';
import './durak.css';

const SW = 1000;
const SH = 720;
const CW = 100; // карта
const CH = 155;
const HAND_Y = 618;
const DECK = { x: 92, y: 360 };
const BITO = { x: 908, y: 360 };

type Anchor = { x: number; y: number };

interface Item {
  key: string;
  card: Card | null;
  x: number;
  y: number;
  r: number;
  s: number;
  z: number;
  role?: 'hand' | 'att' | 'def';
  i?: number;
  cls?: string;
}

/** Места соперников по дуге сверху: слева направо — по часовой стрелке от меня. */
function arc(n: number): Anchor[] {
  if (n === 1) return [{ x: 500, y: 92 }];
  const out: Anchor[] = [];
  const span = Math.min(760, 220 * (n - 1));
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const x = 500 - span / 2 + span * t;
    const y = 86 + Math.pow(2 * t - 1, 2) * (n > 3 ? 70 : 40);
    out.push({ x, y });
  }
  return out;
}

class DurakView implements GameView<View, Event> {
  private ctx!: ViewCtx;
  private wrap!: HTMLElement;
  private stage!: HTMLElement;
  private plates!: HTMLElement;
  private zone!: HTMLElement;
  private banner!: HTMLElement;
  private cover!: HTMLElement;
  private btns!: HTMLElement;
  private info!: HTMLElement;
  private els = new Map<string, HTMLElement>();
  private m: View | null = null;
  private ro: ResizeObserver | null = null;
  /** Чьи карты внизу экрана (за этим экраном). */
  private viewer = 0;
  /** Хот-сит: карты скрыты, пока игрок не нажмёт «показать». */
  private hidden = false;
  private actSeat: number | null = null;
  private selected: Card[] = [];
  private onKey = (e: KeyboardEvent) => {
    if (this.actSeat == null) return;
    const t = e.target as HTMLElement;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    if (e.key === 'Escape') this.select(null);
  };

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    preloadDeck(settings.deck);
    this.wrap = h(`<div class="dk-wrap"><div class="dk-stage">
        <div class="dk-cloth"></div>
        <div class="dk-plates"></div>
        <div class="dk-zone" hidden><span>Сюда</span></div>
        <div class="dk-banner" hidden></div>
        <div class="dk-cover" hidden><div class="dk-cover-box"><div class="dk-cover-t"></div><button class="btn primary">Показать карты</button></div></div>
      </div></div>`);
    root.appendChild(this.wrap);
    this.stage = this.wrap.querySelector('.dk-stage') as HTMLElement;
    this.plates = this.wrap.querySelector('.dk-plates') as HTMLElement;
    this.zone = this.wrap.querySelector('.dk-zone') as HTMLElement;
    this.banner = this.wrap.querySelector('.dk-banner') as HTMLElement;
    this.cover = this.wrap.querySelector('.dk-cover') as HTMLElement;
    (this.cover.querySelector('button') as HTMLButtonElement).onclick = () => {
      Sound.unlock();
      this.hidden = false;
      this.cover.hidden = true;
      this.draw();
      this.refreshTurn();
    };
    const ctl = h(`<div class="dk-controls"><div class="dk-info"></div><div class="dk-btns"></div>
      ${ctx.demo ? '' : '<div class="hint small-hint">Нажмите карту, потом — куда её положить (подсвечено). Esc — отменить выбор.</div>'}</div>`);
    ctx.controls.appendChild(ctl);
    this.btns = ctl.querySelector('.dk-btns') as HTMLElement;
    this.info = ctl.querySelector('.dk-info') as HTMLElement;

    this.stage.addEventListener('click', (e) => this.onClick(e));
    this.zone.addEventListener('click', (e) => {
      e.stopPropagation();
      this.playToZone();
    });
    this.ro = new ResizeObserver(() => this.fit());
    this.ro.observe(this.wrap);
    this.fit();
    if (!ctx.demo) document.addEventListener('keydown', this.onKey);
  }

  private fit() {
    const r = this.wrap.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const k = Math.min(r.width / SW, r.height / SH);
    this.stage.style.transform = `translate(${(r.width - SW * k) / 2}px, ${(r.height - SH * k) / 2}px) scale(${k})`;
  }

  // ---------------------------------------------------------------- кто где сидит

  /** Места по кругу, начиная со зрителя. */
  private order(v: View): number[] {
    const i0 = Math.max(0, v.seats.indexOf(this.viewer));
    return v.seats.map((_, k) => v.seats[(i0 + k) % v.seats.length]);
  }

  private anchorOf(v: View, seat: number): Anchor {
    if (seat === this.viewer) return { x: 500, y: HAND_Y };
    const others = this.order(v).slice(1);
    return arc(others.length)[others.indexOf(seat)] ?? { x: 500, y: 90 };
  }

  private chooseViewer(v: View, toAct: number[]) {
    const mine = this.ctx.mySeats.filter((x) => v.seats.includes(x));
    if (!mine.length) {
      this.viewer = v.seats.includes(this.viewer) ? this.viewer : v.seats[0];
      return;
    }
    if (mine.length === 1) {
      this.viewer = mine[0];
      return;
    }
    // хот-сит: внизу тот, кто ходит; если ходит бот — оставляем прежнего
    const next = toAct.find((x) => mine.includes(x));
    if (next != null && next !== this.viewer) {
      this.viewer = next;
      this.hidden = true;
    } else if (!mine.includes(this.viewer)) this.viewer = mine[0];
  }

  /** Видно ли лицо карт игрока seat на этом экране. */
  private faceUp(v: View, seat: number) {
    if (this.ctx.demo) return v.hands[seat].length > 0 || v.counts[seat] === 0;
    return seat === this.viewer && !this.hidden && this.ctx.mySeats.includes(seat);
  }

  // ---------------------------------------------------------------- раскладка

  private layout(v: View): Item[] {
    const items: Item[] = [];
    // колода и козырь
    const dl = deckLeft(v);
    if (v.trumpCard && dl > 0) items.push({ key: 'c:' + cardId(v.trumpCard), card: v.trumpCard, x: DECK.x + 34, y: DECK.y, r: 90, s: 0.92, z: 1 });
    if (dl > (v.trumpCard ? 1 : 0)) items.push({ key: 'deck', card: null, x: DECK.x, y: DECK.y - Math.min(8, dl / 4), r: 0, s: 0.92, z: 2, cls: 'dk-deck' });
    // бито
    if (v.bito.length) items.push({ key: 'bito', card: null, x: BITO.x, y: BITO.y, r: 12, s: 0.92, z: 1, cls: 'dk-bito' });
    // стол
    const n = v.table.length;
    const rows = n > 3 ? 2 : 1;
    const perRow = rows === 2 ? Math.ceil(n / 2) : n;
    v.table.forEach((p, i) => {
      const row = rows === 2 && i >= perRow ? 1 : 0;
      const col = row ? i - perRow : i;
      const inRow = row ? n - perRow : perRow;
      const x = 500 + (col - (inRow - 1) / 2) * 128 - 10;
      const y = rows === 2 ? (row ? 438 : 272) : 352;
      const sel = this.targetsFor(v).has(i);
      items.push({ key: 'c:' + cardId(p.a), card: p.a, x, y, r: -3 + ((i * 7) % 6), s: 0.86, z: 10 + i * 2, role: 'att', i, cls: sel ? 'dk-target' : '' });
      if (p.d) items.push({ key: 'c:' + cardId(p.d), card: p.d, x: x + 20, y: y + 26, r: 8 - ((i * 5) % 7), s: 0.86, z: 11 + i * 2, role: 'def', i });
    });
    // руки
    for (const seat of v.seats) {
      const cnt = v.counts[seat];
      if (!cnt) continue;
      if (seat === this.viewer) {
        const up = this.faceUp(v, seat);
        const hand = up ? sortHand(v.hands[seat], v.trump) : [];
        const N = up ? hand.length : cnt;
        const step = Math.min(64, 760 / Math.max(1, N - 1));
        const playable = up ? this.playable(v) : [];
        for (let k = 0; k < N; k++) {
          const t = N > 1 ? k / (N - 1) - 0.5 : 0;
          const x = 500 + (k - (N - 1) / 2) * step;
          const y = HAND_Y + Math.abs(t) * Math.abs(t) * 40 * (N > 8 ? 1.4 : 1);
          const r = t * Math.min(26, N * 2.6);
          if (!up) {
            items.push({ key: `b:${seat}:${k}`, card: null, x, y, r, s: 1, z: 100 + k });
            continue;
          }
          const c = hand[k];
          const isSel = this.selected.some((x) => sameCard(x, c));
          const can = playable.some((x) => sameCard(x, c));
          const cls = this.actSeat != null ? (isSel ? 'dk-sel' : can ? 'dk-can' : 'dk-dim') : '';
          items.push({ key: 'c:' + cardId(c), card: c, x, y: y - (isSel ? 34 : 0), r, s: 1, z: 100 + k, role: 'hand', cls });
        }
        continue;
      }
      const a = this.anchorOf(v, seat);
      const up = this.faceUp(v, seat);
      const list = up ? sortHand(v.hands[seat], v.trump) : [];
      const N = up ? list.length : cnt;
      const step = Math.min(up ? 26 : 14, 150 / Math.max(1, N - 1));
      for (let k = 0; k < N; k++) {
        const t = N > 1 ? k / (N - 1) - 0.5 : 0;
        const x = a.x + (k - (N - 1) / 2) * step;
        const y = a.y + Math.abs(t) * 8;
        const r = t * Math.min(30, N * 4);
        items.push(up ? { key: 'c:' + cardId(list[k]), card: list[k], x, y, r, s: 0.6, z: 50 + k } : { key: `b:${seat}:${k}`, card: null, x, y, r, s: 0.6, z: 50 + k });
      }
    }
    // длинный дурак: шестёрка (личный козырь) и выложенные карты — веером рядом с игроком
    if (longOn(v)) {
      for (const seat of v.seats) {
        const list = v.laid[seat] || [];
        const me = seat === this.viewer;
        const a = this.anchorOf(v, seat);
        const right = !me && a.x > 640;
        list.forEach((c, i) => {
          const x = me ? 150 + i * 17 : right ? a.x - 112 - i * 15 : a.x + 112 + i * 15;
          const y = me ? HAND_Y + 20 : a.y + 6;
          items.push({ key: 'c:' + cardId(c), card: c, x, y, r: me ? -4 : 0, s: me ? 0.46 : 0.4, z: 30 + i, cls: 'dk-laid' });
        });
      }
    }
    return items;
  }

  private transform(it: { x: number; y: number; r: number; s: number }) {
    return `translate(${it.x - CW / 2}px, ${it.y - CH / 2}px) rotate(${it.r}deg) scale(${it.s})`;
  }

  /** Разложить карты по местам. Новые влетают из enter, исчезнувшие улетают в exit. */
  private draw(enter: Anchor | null = null, exit: Anchor | null = null) {
    const v = this.m;
    if (!v) return;
    const dur = Math.round(360 / this.ctx.speed());
    this.stage.style.setProperty('--dk-dur', dur + 'ms');
    const items = this.layout(v);
    const seen = new Set<string>();
    let fresh = 0;
    for (const it of items) {
      seen.add(it.key);
      let el = this.els.get(it.key);
      const face = it.card ? cardId(it.card) : 'back';
      if (!el) {
        el = document.createElement('div');
        el.className = 'dk-card';
        el.dataset.k = it.key;
        this.els.set(it.key, el);
        const from = enter ?? it;
        el.style.transition = 'none';
        el.style.transform = this.transform({ x: from.x, y: from.y, r: 0, s: it.s * (enter ? 0.7 : 1) });
        el.style.opacity = enter ? '1' : '0';
        this.stage.insertBefore(el, this.plates);
        void el.offsetWidth;
        el.style.transition = '';
        el.style.transitionDelay = enter ? `${Math.min(fresh++ * 45, 400)}ms` : '0ms';
        el.style.opacity = '1';
      } else el.style.transitionDelay = '0ms';
      if (el.dataset.face !== face) {
        el.dataset.face = face;
        el.innerHTML = cardHTML(it.card, settings.deck);
      }
      el.style.transform = this.transform(it);
      el.style.zIndex = String(it.z);
      el.className = `dk-card${it.cls ? ' ' + it.cls : ''}`;
      if (it.role) el.dataset.role = it.role;
      else delete el.dataset.role;
      if (it.i != null) el.dataset.i = String(it.i);
    }
    for (const [k, el] of [...this.els]) {
      if (seen.has(k)) continue;
      this.els.delete(k);
      if (exit) {
        el.style.transitionDelay = '0ms';
        el.style.transform = this.transform({ x: exit.x, y: exit.y, r: 20, s: 0.6 });
        el.style.opacity = '0.2';
        setTimeout(() => el.remove(), dur + 60);
      } else el.remove();
    }
    this.drawPlates(v);
    this.drawZone(v);
  }

  private drawPlates(v: View) {
    let s = '';
    const dl = deckLeft(v);
    if (dl > 0) s += `<div class="dk-count" style="left:${DECK.x - 40}px;top:${DECK.y + 92}px">${dl}</div>`;
    if (!longOn(v))
      s += `<div class="dk-trump" style="left:${DECK.x - 60}px;top:${DECK.y - 136}px" title="Козырь"><span class="${v.trump === 'H' || v.trump === 'D' ? 'red' : ''}">${SUIT_SYM[v.trump]}</span>${dl ? '' : '<small>козырь</small>'}</div>`;
    if (v.bito.length) s += `<div class="dk-count" style="left:${BITO.x - 40}px;top:${BITO.y + 96}px">бито ${v.bito.length}</div>`;
    const toAct = v.phase === 'attack' ? v.attacker : v.phase === 'defend' ? v.defender : v.asker;
    for (const seat of v.seats) {
      const a = this.anchorOf(v, seat);
      const me = seat === this.viewer;
      const role = v.out.includes(seat)
        ? `вышел${v.out.indexOf(seat) === 0 ? ' первым' : ''}`
        : v.phase === 'over' || v.phase === 'trump'
          ? ''
          : seat === v.attacker
            ? 'ходит'
            : seat === v.defender
              ? v.phase === 'take'
                ? 'берёт'
                : 'отбивается'
              : '';
      const title = v.cfg.ranks && v.ranking.length === v.seats.length ? titleOf(v.ranking.indexOf(seat), v.seats.length) : '';
      const pt = longOn(v) && v.ptrump[seat] ? v.ptrump[seat]! : null;
      const ptChip = pt ? `<span class="dk-pt${pt === 'H' || pt === 'D' ? ' red' : ''}" title="Личный козырь">${SUIT_SYM[pt]}</span>` : '';
      const pog = v.pogony[seat] ? `<span class="dk-pog" title="Погоны">${'★'.repeat(Math.min(4, v.pogony[seat]))}</span>` : '';
      const team = v.team[seat] >= 0 ? `<span class="dk-team t${v.team[seat]}" title="Команда">${v.team[seat] ? 'Б' : 'А'}</span>` : '';
      const fool = v.cfg.games > 1 && v.fools[seat] ? `<span class="dk-fools" title="Сколько раз был дураком">🃏${v.fools[seat]}</span>` : '';
      const y = me ? HAND_Y - 120 : a.y + 58;
      const x = me ? 500 : a.x;
      const look = SEATS[seat];
      s += `<div class="dk-plate${toAct === seat && v.phase !== 'over' ? ' on' : ''}${me ? ' me' : ''}" style="left:${x}px;top:${y}px;--c:${look.color}">
        ${team}${ptChip}${title ? `<i class="dk-title">${esc(title)}</i><small>${this.ctx.name(seat)}</small>` : `<b>${this.ctx.name(seat)}</b>`}${role ? `<em>${role}</em>` : ''}${pog}${fool}</div>`;
    }
    this.plates.innerHTML = s;
  }

  private drawZone(v: View) {
    const show = this.actSeat != null && this.selected.length > 0 && this.zoneAction(v) != null;
    this.zone.hidden = !show;
    if (!show) return;
    const act = this.zoneAction(v)!;
    const n = v.table.length;
    const tr = act.type === 'transfer';
    const label = act.type === 'attack' ? 'Ходить' : act.type === 'throw' ? 'Подкинуть' : 'Перевести';
    (this.zone.firstElementChild as HTMLElement).textContent = label;
    let x = 500;
    let y = 352;
    if (n) {
      // справа от последней карты
      const rows = n > 3 ? 2 : 1;
      const perRow = rows === 2 ? Math.ceil(n / 2) : n;
      const inRow = rows === 2 ? n - perRow : perRow;
      x = 500 + (inRow - (inRow - 1) / 2) * 128 - 10;
      y = rows === 2 ? 438 : 352;
      if (x > 800) {
        x = 500;
        y = 352;
      }
    }
    this.zone.style.left = x - 55 + 'px';
    this.zone.style.top = y - 75 + 'px';
    this.zone.classList.toggle('tr', tr);
  }

  // ---------------------------------------------------------------- выбор хода

  /** Что можно сделать выбранными картами, положив их в зону стола. */
  private zoneAction(v: View): Action | null {
    const sel = this.selected;
    if (!sel.length || this.actSeat == null) return null;
    if (v.phase === 'attack' && v.attacker === this.actSeat) return { type: 'attack', cards: sel };
    if ((v.phase === 'throw' || v.phase === 'take') && v.asker === this.actSeat) return { type: 'throw', cards: sel };
    if (v.phase === 'defend' && v.defender === this.actSeat && sel.length === 1 && canTransfer(v, sel[0], false)) return { type: 'transfer', card: sel[0] };
    return null;
  }

  /** Непокрытые карты на столе, которые бьёт выбранная. */
  private targetsFor(v: View): Set<number> {
    const out = new Set<number>();
    if (this.actSeat == null || v.phase !== 'defend' || v.defender !== this.actSeat || this.selected.length !== 1) return out;
    const c = this.selected[0];
    v.table.forEach((p, i) => {
      if (!p.d && beats(v, p.a, c)) out.add(i);
    });
    return out;
  }

  /** Какими картами вообще можно сейчас сыграть. */
  private playable(v: View): Card[] {
    const seat = this.actSeat;
    if (seat == null) return [];
    const hand = v.hands[seat] || [];
    if (v.phase === 'attack') return hand;
    if (v.phase === 'throw' || v.phase === 'take') return throwable(v, seat);
    if (v.phase === 'defend') return hand.filter((c) => v.table.some((p) => !p.d && beats(v, p.a, c)) || canTransfer(v, c, false));
    return [];
  }

  private onClick(e: MouseEvent) {
    const el = (e.target as Element).closest('.dk-card') as HTMLElement | null;
    const v = this.m;
    if (!v || this.actSeat == null || this.hidden) return;
    if (!el) return this.select(null);
    const role = el.dataset.role;
    const key = el.dataset.k || '';
    if (role === 'hand') {
      const c = (v.hands[this.actSeat] || []).find((x) => 'c:' + cardId(x) === key);
      if (c) this.select(c);
      return;
    }
    if (role === 'att' && el.classList.contains('dk-target')) {
      const i = +(el.dataset.i ?? -1);
      const c = this.selected[0];
      if (c) this.send({ type: 'beat', i, card: c });
      return;
    }
    if (role === 'att' || role === 'def') {
      // нажали на стол — как на зону, если она есть
      if (this.zoneAction(v)) this.playToZone();
      return;
    }
  }

  private select(c: Card | null) {
    const v = this.m;
    if (!v || this.actSeat == null) return;
    if (!c) this.selected = [];
    else if (!this.playable(v).some((x) => sameCard(x, c))) return;
    else if (this.selected.some((x) => sameCard(x, c))) this.selected = this.selected.filter((x) => !sameCard(x, c));
    else {
      const multi = (v.phase === 'attack' && v.cfg.multiLead) || v.phase === 'throw' || v.phase === 'take';
      if (multi && this.selected.length && (v.phase !== 'attack' || this.selected[0].r === c.r)) {
        const lim = room(v);
        this.selected = [...this.selected, c].slice(-Math.max(1, lim));
      } else this.selected = [c];
    }
    Sound.ui();
    this.draw();
    this.renderButtons();
  }

  private playToZone() {
    const v = this.m;
    if (!v) return;
    const a = this.zoneAction(v);
    if (a) this.send(a);
  }

  private send(a: Action) {
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
    if (this.m) this.draw();
  }

  private button(text: string, primary: boolean, on: () => void, cls = '') {
    const b = h<HTMLButtonElement>(`<button class="btn ${primary ? 'primary pulse' : ''} ${cls}">${text}</button>`);
    b.onclick = () => {
      Sound.unlock();
      on();
    };
    this.btns.appendChild(b);
  }

  private renderButtons() {
    this.btns.innerHTML = '';
    const v = this.m;
    const seat = this.actSeat;
    if (!v || seat == null || this.hidden) return;
    const za = this.zoneAction(v);
    if (v.phase === 'trump') {
      const row = h(`<div class="dk-suits"></div>`);
      for (const s of SUITS) {
        const b = h<HTMLButtonElement>(`<button class="btn dk-suit${s === 'H' || s === 'D' ? ' red' : ''}" title="${SUIT_NAME[s]}">${SUIT_SYM[s]}</button>`);
        b.onclick = () => this.send({ type: 'trump', suit: s });
        row.appendChild(b);
      }
      this.btns.appendChild(h(`<div class="dk-ask">Король, назначайте козырь:</div>`));
      this.btns.appendChild(row);
      return;
    }
    if (za && za.type !== 'transfer') this.button(`${za.type === 'attack' ? 'Ходить' : 'Подкинуть'} (${this.selected.length})`, true, () => this.send(za));
    if (v.phase === 'defend') {
      if (za?.type === 'transfer') this.button('Перевести', true, () => this.send(za));
      if (transferTarget(v) != null) {
        const r = v.table[0].a.r;
        for (const c of (v.hands[seat] || []).filter((x) => x.r === r && x.s === v.trump))
          if (canTransfer(v, c, true)) this.button(`Показать ${this.cardTxt(c)} — перевести`, false, () => this.send({ type: 'show', card: c }));
      }
      this.button('Беру', false, () => this.send({ type: 'take' }), 'dk-take');
    }
    if (v.phase === 'throw') this.button(v.attacker === seat ? 'Бито' : 'Пас', !za, () => this.send({ type: 'pass' }));
    if (v.phase === 'take') this.button('Хватит — пусть забирает', !za, () => this.send({ type: 'pass' }));
  }

  private cardTxt(c: Card) {
    const r = c.r > 10 ? 'ВДКТ'[c.r - 11] : String(c.r);
    return `<b class="${c.s === 'H' || c.s === 'D' ? 'red' : ''}">${r}${SUIT_SYM[c.s]}</b>`;
  }

  // ---------------------------------------------------------------- состояние

  setView(v: View) {
    this.m = v;
    this.chooseViewer(v, this.toActOf(v));
    for (const el of this.els.values()) el.remove();
    this.els.clear();
    this.banner.hidden = true;
    this.draw();
    this.renderInfo(v);
  }

  private toActOf(v: View): number[] {
    if (v.phase === 'attack') return [v.attacker];
    if (v.phase === 'defend') return [v.defender];
    if (v.phase === 'throw' || v.phase === 'take' || v.phase === 'trump') return v.asker >= 0 ? [v.asker] : [];
    return [];
  }

  private renderInfo(v: View) {
    const parts: string[] = [];
    if (v.cfg.games > 1) parts.push(`Партия <b>${v.game}</b> из ${v.cfg.games}`);
    if (longOn(v)) {
      const mine = trumpOf(v, this.viewer);
      parts.push(`Ваш козырь: <b class="${mine === 'H' || mine === 'D' ? 'red' : ''}">${SUIT_SYM[mine]} ${SUIT_NAME[mine]}</b>`);
      parts.push(`<small>у каждого свой козырь — масть его шестёрки</small>`);
    } else parts.push(`Козырь: <b class="${v.trump === 'H' || v.trump === 'D' ? 'red' : ''}">${SUIT_SYM[v.trump]} ${SUIT_NAME[v.trump]}</b>`);
    const variant = [longOn(v) ? 'длинный' : '', v.cfg.ranks ? 'Король-говно' : '', v.team.some((t) => t >= 0) ? (v.seats.length === 6 ? '3 на 3' : '2 на 2') : '', v.cfg.transfer ? 'переводной' : v.cfg.throwers === 'none' ? 'простой' : 'подкидной', v.cfg.spades ? 'пики пиками' : '', v.cfg.pogony ? 'с погонами' : ''].filter(Boolean).join(', ');
    parts.push(`<small>${variant}</small>`);
    this.info.innerHTML = parts.map((p) => `<div>${p}</div>`).join('');
  }

  /** Применить событие к модели на экране (чтобы показать промежуточные шаги до финального view). */
  private step(m: View, ev: Event): { enter: Anchor | null; exit: Anchor | null } {
    const takeFrom = (seat: number, list: Card[]) => {
      if (m.hands[seat].length) m.hands[seat] = m.hands[seat].filter((x) => !list.some((c) => sameCard(c, x)));
      m.counts[seat] = Math.max(0, m.counts[seat] - list.length);
    };
    switch (ev.type) {
      case 'attack':
      case 'throw':
        takeFrom(ev.seat, ev.cards);
        for (const c of ev.cards) m.table.push({ a: c, d: null });
        return { enter: this.anchorOf(m, ev.seat), exit: null };
      case 'beat':
        takeFrom(ev.seat, [ev.card]);
        if (m.table[ev.i]) m.table[ev.i] = { ...m.table[ev.i], d: ev.card };
        return { enter: this.anchorOf(m, ev.seat), exit: null };
      case 'transfer':
        if (ev.card) {
          takeFrom(ev.seat, [ev.card]);
          m.table.push({ a: ev.card, d: null });
        }
        m.attacker = ev.seat;
        m.defender = ev.to;
        return { enter: this.anchorOf(m, ev.seat), exit: null };
      case 'bito':
        m.bito = [...m.bito, ...m.table.flatMap((p) => (p.d ? [p.a, p.d] : [p.a]))];
        m.table = [];
        return { enter: null, exit: BITO };
      case 'pickup': {
        const seat = ev.seat;
        if (this.faceUp(m, seat) || m.hands[seat].length) m.hands[seat] = [...m.hands[seat], ...ev.cards];
        m.counts[seat] += ev.cards.length;
        m.table = [];
        return { enter: null, exit: this.anchorOf(m, seat) };
      }
      case 'draw': {
        const seat = ev.seat;
        m.counts[seat] += ev.count;
        if (ev.cards && (this.faceUp(m, seat) || m.hands[seat].length)) m.hands[seat] = [...m.hands[seat], ...ev.cards];
        m.deckCount = Math.max(0, m.deckCount - ev.count);
        if (!m.deckCount) m.trumpCard = null;
        return { enter: DECK, exit: null };
      }
      case 'out':
        m.out = [...m.out, ev.seat];
        return { enter: null, exit: null };
      case 'laid':
        m.laid = m.laid.map((x, i) => (i === ev.seat ? [...x, ev.card] : x));
        m.level = m.level.map((x, i) => (i === ev.seat ? ev.card.r : x));
        return { enter: DECK, exit: null };
      default:
        return { enter: null, exit: null };
    }
  }

  async play(events: Event[], v: View) {
    const speed = this.ctx.speed();
    const dur = 380 / speed;
    this.clearTurn();
    const m: View = this.m ? structuredClone(this.m) : structuredClone(v);
    for (const ev of events) {
      switch (ev.type) {
        case 'deal': {
          this.banner.hidden = true;
          Sound.shuffle();
          this.m = v;
          this.chooseViewer(v, this.toActOf(v));
          this.draw(DECK, DECK);
          this.renderInfo(v);
          await sleep(dur + 700 / speed);
          if (ev.chooser != null) await this.showBanner(`${SEATS[ev.chooser] ? this.plain(ev.chooser) : ''} выбирает козырь`, 900 / speed);
          else await this.showBanner(`Козырь — ${SUIT_SYM[ev.trump]} ${SUIT_NAME[ev.trump]}`, 900 / speed);
          Object.assign(m, structuredClone(v));
          continue;
        }
        case 'trump':
          Sound.ui();
          m.trump = ev.suit;
          this.m = m;
          this.renderInfo(m);
          await this.showBanner(`Козырь — ${SUIT_SYM[ev.suit]} ${SUIT_NAME[ev.suit]}`, 1000 / speed);
          continue;
        case 'take':
          Sound.nomove();
          await this.showBanner(`${this.plain(ev.seat)}: беру!`, 650 / speed);
          continue;
        case 'pass':
          await sleep(120 / speed);
          continue;
        case 'gameEnd': {
          Sound.win();
          const who = ev.losers.length > 1 ? `Дураки — ${ev.losers.map((x) => this.plain(x)).join(' и ')}!` : `${this.plain(ev.fool!)} — дурак!`;
          const t = ev.draw ? 'Ничья!' : `${who}${ev.pogony ? (ev.pogony === 2 ? ' С погонами!' : ' С погоном!') : ''}`;
          await this.showBanner(t, ev.last ? 0 : 2200 / speed, ev.last);
          continue;
        }
        default:
          break;
      }
      const { enter, exit } = this.step(m, ev);
      this.m = m;
      if (ev.type === 'bito' || ev.type === 'pickup') Sound.shuffle();
      else if (ev.type !== 'out') Sound.card();
      this.draw(enter, exit);
      await sleep(dur + (ev.type === 'draw' ? Math.min(ev.count, 8) * 45 : 0) + 60);
      if (ev.type === 'out') await this.showBanner(`${this.plain(ev.seat)} вышел`, 700 / speed);
      if (ev.type === 'laid') await this.showBanner(`${this.plain(ev.seat)} выкладывает ${this.cardPlain(ev.card)}${ev.card.r === 14 ? ' — длинный дурак!' : ''}`, 1300 / speed);
      if (ev.type === 'transfer') {
        const how = ev.shown ? `показывает ${this.cardPlain(ev.shown)} — ` : '';
        await this.showBanner(`${this.plain(ev.seat)}: ${how}перевод на ${this.plain(ev.to)}`, 900 / speed);
      }
    }
    this.m = v;
    this.draw();
    this.renderInfo(v);
  }

  private cardPlain(c: Card) {
    return `${c.r > 10 ? 'ВДКТ'[c.r - 11] : c.r}${SUIT_SYM[c.s]}`;
  }

  private plain(seat: number) {
    return this.ctx.name(seat).replace(/<[^>]+>/g, '');
  }

  private async showBanner(text: string, ms: number, stay = false) {
    this.banner.textContent = text;
    this.banner.hidden = false;
    if (stay) return;
    await sleep(ms);
    this.banner.hidden = true;
  }

  setTurn(toAct: number[], interactive: number[]) {
    this.clearTurn();
    const v = this.m;
    if (!v || v.phase === 'over' || this.ctx.demo) return;
    const prev = this.viewer;
    this.chooseViewer(v, toAct);
    const seat = interactive.find((x) => x === this.viewer) ?? null;
    if (this.hidden && interactive.length && this.ctx.mySeats.length > 1) {
      (this.cover.querySelector('.dk-cover-t') as HTMLElement).innerHTML = `Ход: ${this.ctx.name(this.viewer)}.<br><small>Передайте устройство — остальным не подглядывать!</small>`;
      this.cover.hidden = false;
    } else {
      this.hidden = false;
      this.cover.hidden = true;
    }
    this.actSeat = seat;
    if (prev !== this.viewer) {
      for (const el of this.els.values()) el.remove();
      this.els.clear();
    }
    this.draw();
    this.renderButtons();
  }

  private refreshTurn() {
    this.renderButtons();
  }

  status(v: View, toAct: number[], interactive: number[]) {
    const name = (p: number) => this.ctx.name(p);
    if (v.phase === 'over') {
      if (v.cfg.games > 1) return 'Серия окончена';
      if (v.losers.length > 1) return `Дураки — ${v.losers.map(name).join(' и ')}`;
      return v.draw ? 'Ничья!' : v.fool != null ? `Дурак — ${name(v.fool)}` : 'Партия окончена';
    }
    const who = toAct[0];
    if (who == null) return '';
    const mine = interactive.includes(who);
    switch (v.phase) {
      case 'trump':
        return mine ? 'Назначьте козырь' : `${name(who)} выбирает козырь…`;
      case 'attack':
        return mine ? `Ваш ход под ${name(v.defender)}` : `${name(who)} ходит под ${name(v.defender)}…`;
      case 'defend': {
        const n = unbeaten(v.table);
        return mine ? `Отбивайтесь${longOn(v) ? ` (ваш козырь ${SUIT_SYM[trumpOf(v, who)]})` : ''}: ${n} ${n === 1 ? 'карта' : n < 5 ? 'карты' : 'карт'}${v.cfg.transfer && transferTarget(v) != null ? ' — или переводите' : ''}` : `${name(who)} отбивается…`;
      }
      case 'throw':
        return mine ? `Подкинете ${name(v.defender)}? Можно ещё ${room(v)}` : `${name(who)} думает, подкинуть ли…`;
      case 'take':
        return mine ? `${name(v.defender)} берёт — подкинете вдогонку?` : `${name(v.defender)} берёт…`;
    }
    return '';
  }

  playerStats(v: View, seat: number) {
    const out = v.out.includes(seat);
    const cnt = out ? '✓' : `🂠 ${v.counts[seat]}`;
    const f = v.cfg.games > 1 ? `<span title="Сколько раз был дураком">🃏 ${v.fools[seat]}</span>` : '';
    return `<span title="Карт на руках">${cnt}</span>${f}`;
  }

  destroy() {
    this.ro?.disconnect();
    document.removeEventListener('keydown', this.onKey);
  }
}

export function createView(): GameView<View, Event> {
  return new DurakView();
}

export { has };
export type { Suit };
