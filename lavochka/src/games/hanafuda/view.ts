/* Ханафуда — отрисовка: сверху соперники (рубашки руки и взятое по видам), посередине стол (карты собраны по месяцам)
 * и колода, внизу своё взятое и своя рука. Ход: касание карты на руке (две пары на столе — потом касание той, что брать),
 * затем «Открыть карту» (или касание колоды / свободного места); «коикои/го» и «стоп» — кнопками. */
import { Sound } from '../../core/audio';
import { store } from '../../core/settings';
import { esc, h, sleep } from '../../core/util';
import type { GameView, ViewCtx, ViewPref } from '../../core/view';
import { CardStage, fan, type Point, type StageItem } from '../../cards/stage';
import type { Card } from '../../cards/deck';
import { MONTHS, MONTH_NUM_JP, MONTH_NUM_KR, SAKE, SSANGPI, info, monthOf, type Kind } from './cards';
import { bombMonths, canShake, goMin, handSize, moves, pointsOf, type Action, type Event, type View } from './engine';
import { SEATS, MODE_NAME, cardTitle } from './def';
import '../../cards/trickview.css';
import './hanafuda.css';

const PREF_DECK = 'hanafuda.deck';
const PREF_MONTHS = 'hanafuda.months';
export const HF_PREFS: ViewPref[] = [
  {
    key: PREF_DECK,
    label: 'Колода',
    choices: [
      { value: 'alt', label: 'традиционная, чёрная' },
      { value: 'alt2', label: 'традиционная, красная' },
      { value: 'green', label: 'зелёные растения' },
    ],
    default: 'alt',
  },
  { key: PREF_MONTHS, label: 'Номера месяцев', hint: 'маленькая цифра в углу карты — пока не запомнились растения', choices: [{ value: 'on', label: 'показывать' }, { value: 'off', label: 'не показывать' }], default: 'on' },
];

const BASE = import.meta.env.BASE_URL;
const deckSet = () => {
  const d = store.get<string>(PREF_DECK, 'alt');
  return d === 'alt2' || d === 'green' ? d : 'alt';
};
/** Карта ханафуды на общей сцене: {s, r} — масть = место в месяце, ранг = месяц + 1. */
const toCard = (id: number): Card => ({ s: 'SCDH'[id & 3] as Card['s'], r: (id >> 2) + 1 });
const fromCard = (c: Card) => (c.r - 1) * 4 + 'SCDH'.indexOf(c.s);
const keyOf = (id: number) => `c:${'SCDH'[id & 3]}${(id >> 2) + 1}`;

const KINDS: Kind[] = ['hikari', 'tane', 'tan', 'kasu'];
/** Доля ширины полосы взятого под каждый вид. */
const KIND_W: Record<Kind, number> = { hikari: 0.17, tane: 0.24, tan: 0.24, kasu: 0.35 };

class HanafudaView implements GameView<View, Event> {
  private ctx!: ViewCtx;
  private cs!: CardStage;
  private plates!: HTMLElement;
  private banner!: HTMLElement;
  private btns!: HTMLElement;
  private v: View | null = null;
  private viewer = 0;
  private actSeat: number | null = null;
  private picked: number | null = null;
  private exitPt: Point | null = null;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    this.viewer = ctx.mySeats[0] ?? 0;
    const set = deckSet();
    for (let i = 0; i < 48; i++) new Image().src = `${BASE}hanafuda/${set}/${i}.webp`;
    this.cs = new CardStage(root, 1000, 760, 'hf-wrap', '<div class="hf-cloth"></div>', {
      portrait: { W: 540, H: 960 },
      faces: {
        url: (c) => `${BASE}hanafuda/${set}/${c ? fromCard(c) : 'back'}.webp`,
        alt: (c) => (c ? cardTitle(fromCard(c)) : 'рубашка'),
      },
    });
    this.cs.wrap.classList.toggle('hf-nums', store.get<string>(PREF_MONTHS, 'on') !== 'off');
    this.cs.onMode = () => this.draw();
    this.cs.over.innerHTML = '<div class="tv-plates"></div><div class="cs-banner hf-banner" hidden></div>';
    this.plates = this.cs.over.querySelector('.tv-plates') as HTMLElement;
    this.banner = this.cs.over.querySelector('.cs-banner') as HTMLElement;
    this.cs.stage.addEventListener('click', (e) => this.onClick(e));
    if (ctx.demo) return;
    const ctl = h('<div class="tv-controls hf-controls"><div class="tv-btns"></div></div>');
    ctx.controls.appendChild(ctl);
    this.btns = ctl.querySelector('.tv-btns') as HTMLElement;
  }

  private get port() {
    return this.cs.portrait;
  }

  private order(v: View): number[] {
    const i0 = Math.max(0, v.seats.indexOf(this.viewer));
    return v.seats.map((_, k) => v.seats[(i0 + k) % v.seats.length]);
  }

  /** Область места: центр руки, полоса взятого [x0, x1] на высоте y, табличка. */
  private zone(v: View, seat: number) {
    const W = this.port ? 540 : 1000;
    const k = this.order(v).indexOf(seat);
    if (k === 0)
      return this.port
        ? { hand: { x: 270, y: 830 }, caps: { x0: 12, x1: 528, y: 650 }, plate: { x: 270, y: 580 } }
        : { hand: { x: 500, y: 684 }, caps: { x0: 150, x1: 850, y: 552 }, plate: { x: 500, y: 492 } };
    const others = v.seats.length - 1;
    const x0 = others === 1 ? (this.port ? 12 : 150) : k === 1 ? 12 : W / 2 + 6;
    const x1 = others === 1 ? W - x0 : k === 1 ? W / 2 - 6 : W - 12;
    const cx = (x0 + x1) / 2;
    return this.port ? { hand: { x: cx, y: 52 }, caps: { x0, x1, y: 160 }, plate: { x: cx, y: 104 } } : { hand: { x: cx, y: 58 }, caps: { x0, x1, y: 166 }, plate: { x: cx, y: 106 } };
  }

  private deckPt(): Point {
    return this.port ? { x: 52, y: 372 } : { x: 84, y: 360 };
  }

  /** Стол: карты по месяцам; сыгранная (ждёт колоды) — поверх своей цели. */
  private tableItems(v: View, items: StageItem[], targets: Set<number>) {
    const months: number[] = [];
    const groups = new Map<number, number[]>();
    for (const c of v.table) {
      const m = monthOf(c);
      if (!groups.has(m)) {
        groups.set(m, []);
        months.push(m);
      }
      groups.get(m)!.push(c);
    }
    const pend = v.pend?.cards ?? [];
    for (const c of pend) {
      const m = monthOf(c);
      if (!groups.has(m)) {
        groups.set(m, []);
        months.push(m);
      }
    }
    months.sort((a, b) => a - b);
    const per = this.port ? 4 : 7;
    const rows = Math.max(1, Math.ceil(months.length / per));
    const cx = this.port ? 290 : 520;
    const cy = this.port ? 372 : 362;
    const dx = this.port ? 112 : 104;
    const dy = this.port ? 124 : 112;
    const s = this.port ? 0.64 : 0.68;
    months.forEach((m, i) => {
      const r = Math.floor(i / per);
      const inRow = r === rows - 1 ? months.length - r * per : per;
      const j = i - r * per;
      const x = cx + (j - (inRow - 1) / 2) * dx;
      const y = cy + (r - (rows - 1) / 2) * dy;
      const list = groups.get(m)!;
      list.forEach((c, n) => {
        const off = (n - (list.length - 1) / 2) * 14;
        items.push(this.item(v, c, x + off, y + off * 0.25, ((c * 7) % 7) - 3, s, 20 + n, targets.has(c) ? 'cs-target' : ''));
      });
      pend
        .filter((c) => monthOf(c) === m)
        .forEach((c, n) => items.push(this.item(v, c, x + 16 + n * 10, y + 22, 6, s, 40 + n, 'hf-pend')));
    });
  }

  private item(v: View, id: number, x: number, y: number, r: number, s: number, z: number, cls = '', data?: Record<string, string>): StageItem {
    const mark = v.cfg.mode === 'gostop' && (SSANGPI.includes(id) || id === SAKE) ? (id === SAKE ? ' hf-sake' : ' hf-dbl') : '';
    const num = v.cfg.mode === 'gostop' ? MONTH_NUM_KR(monthOf(id)) : MONTH_NUM_JP(monthOf(id));
    return { key: keyOf(id), card: toCard(id), x, y, r, s, z, cls: (cls + mark).trim(), data: { ...(data ?? {}), m: String(num) } };
  }

  /** Взятое места: четыре кучки по видам. */
  private capItems(v: View, seat: number, items: StageItem[]) {
    const z = this.zone(v, seat).caps;
    const W = z.x1 - z.x0;
    const s = this.port ? 0.38 : v.seats.length === 3 && seat !== this.viewer ? 0.42 : 0.5;
    const cw = 94 * s;
    let x = z.x0;
    for (const kind of KINDS) {
      const gw = W * KIND_W[kind];
      const list = v.caps[seat].filter((c) => info(c).kind === kind).sort((a, b) => a - b);
      const step = list.length > 1 ? Math.min(cw * 0.62, (gw - cw - 6) / (list.length - 1)) : 0;
      list.forEach((c, n) => items.push(this.item(v, c, x + cw / 2 + 3 + n * step, z.y, 0, s, 60 + n)));
      x += gw;
    }
  }

  private layout(v: View): StageItem[] {
    const items: StageItem[] = [];
    const opts = this.actSeat != null ? moves(v, this.actSeat) : [];
    const targets = new Set<number>();
    if (v.phase === 'pick' && this.actSeat != null) for (const c of v.pick?.options ?? []) targets.add(c);
    if (this.picked != null) for (const m of opts) if (m.type === 'play' && m.card === this.picked && m.onto != null) targets.add(m.onto);
    this.tableItems(v, items, targets);
    if (v.deckLeft) {
      const d = this.deckPt();
      const tap = this.actSeat != null && v.phase === 'draw';
      for (let k = 0; k < Math.min(5, Math.ceil(v.deckLeft / 5)); k++)
        items.push({ key: `deck:${k}`, card: null, x: d.x - k * 1.2, y: d.y - k * 2, r: 0, s: 0.6, z: 2 + k, cls: tap ? 'cs-can hf-deck' : '', data: tap ? { deck: '1' } : undefined });
    }
    for (const seat of v.seats) {
      const zn = this.zone(v, seat);
      const me = seat === this.viewer;
      if (me && v.hands[seat].length) {
        const list = v.hands[seat].slice().sort((a, b) => a - b);
        const can = new Set(opts.filter((m) => m.type === 'play').map((m) => (m as { card: number }).card));
        const n = list.length;
        list.forEach((c, k) => {
          const p = this.port ? fan(n, k, zn.hand.x, zn.hand.y, 500, 64, 18, 10) : fan(n, k, zn.hand.x, zn.hand.y, 660, 86, 16, 8);
          const ok = this.actSeat === seat && v.phase === 'play' && can.has(c);
          const sel = this.picked === c;
          const cls = this.actSeat === seat && v.phase === 'play' ? (sel ? 'cs-sel' : ok ? 'cs-can' : 'tv-no') : '';
          items.push(this.item(v, c, p.x, p.y - (sel ? 26 : ok ? 10 : 0), p.r, this.port ? 0.92 : 0.8, 100 + k, cls, ok ? { hand: String(c) } : undefined));
        });
      } else {
        const cnt = v.counts[seat];
        for (let k = 0; k < cnt; k++) {
          const p = fan(cnt, k, zn.hand.x, zn.hand.y, this.port ? 130 : 200, 16, 6, 8);
          items.push({ key: `b:${seat}:${k}`, card: null, ...p, s: me ? 0.8 : 0.4, z: 50 + k });
        }
      }
      this.capItems(v, seat, items);
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
      const zn = this.zone(v, seat);
      const pts = pointsOf(v, seat).total;
      const call = v.calls[seat] ? ` · ${v.cfg.mode === 'koikoi' ? 'коикои' : `${v.calls[seat]} го`}` : '';
      const shake = v.shakes[seat] ? ` · ×${2 ** v.shakes[seat]}` : '';
      const ppeok = v.ppeoks[seat] ? ` · ппок ${v.ppeoks[seat]}` : '';
      s += `<div class="cs-plate${v.turn === seat && !v.over ? ' on' : ''}" style="--c:${SEATS[seat].color};left:${zn.plate.x}px;top:${zn.plate.y - 13}px">${esc(this.plain(seat))} <b title="Счёт партии">${v.score[seat]}</b> <i title="Очки в этом коне">· в коне ${pts}${call}${shake}${ppeok}</i></div>`;
    }
    const d = this.deckPt();
    const carry = v.carry > 1 ? ` · кон ×${v.carry}` : '';
    s += `<div class="tv-center corner hf-info" style="left:${this.port ? 14 : 24}px;top:${this.port ? 196 : 440}px">${MODE_NAME(v.cfg.mode, v.seats.length)}<small>кон ${v.round} из ${v.cfg.months}${carry} · в колоде ${v.deckLeft}</small></div>`;
    if (v.deckLeft) s += `<div class="hf-decknum" style="left:${d.x}px;top:${d.y + 52}px">${v.deckLeft}</div>`;
    this.plates.innerHTML = s;
  }

  private plain(seat: number) {
    return this.ctx.name(seat).replace(/<[^>]+>/g, '');
  }

  // ---------------------------------------------------------------- ход

  private onClick(e: MouseEvent) {
    const v = this.v;
    const seat = this.actSeat;
    if (!v || seat == null) return;
    const el = (e.target as Element).closest('.cs-card') as HTMLElement | null;
    if (v.phase === 'draw') {
      if (el?.dataset.deck) this.send({ type: 'draw' });
      return;
    }
    if (!el) return;
    const id = el.dataset.m != null ? this.idOf(el) : null;
    if (id == null) return;
    if (v.phase === 'pick') {
      if (v.pick?.options.includes(id)) this.send({ type: 'pick', card: id });
      return;
    }
    if (v.phase !== 'play') return;
    if (el.dataset.hand != null) return this.pickHand(id);
    if (this.picked != null) {
      const m = moves(v, seat).find((a) => a.type === 'play' && a.card === this.picked && a.onto === id && !a.shake);
      if (m) this.send(m);
    }
  }

  /** id карты по элементу сцены (ключ «c:<масть><ранг>» хранится в data-id). */
  private idOf(el: HTMLElement): number | null {
    const m = /^([SCDH])(\d+)$/.exec(el.dataset.id ?? '');
    return m ? fromCard({ s: m[1] as Card['s'], r: Number(m[2]) }) : null;
  }

  private pickHand(id: number) {
    const v = this.v!;
    const seat = this.actSeat!;
    const opts = moves(v, seat).filter((a) => a.type === 'play' && a.card === id && !a.shake) as (Action & { type: 'play' })[];
    if (!opts.length) return;
    if (opts.length === 1) {
      this.picked = id;
      if (canShake(v, seat, id)) {
        Sound.ui();
        this.draw();
        return this.renderButtons();
      }
      return this.send(opts[0]);
    }
    // две пары на столе — выбрать, какую брать
    this.picked = id;
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
    this.draw();
    this.ctx.act(seat, a);
  }

  private button(label: string, onClick: () => void, cls = 'btn', tap = false) {
    const b = h<HTMLButtonElement>(`<button class="${cls}"${tap ? ' data-tap' : ''}>${label}</button>`);
    b.onclick = onClick;
    this.btns.appendChild(b);
    return b;
  }

  private renderButtons() {
    if (!this.btns) return;
    this.btns.innerHTML = '';
    const v = this.v;
    const seat = this.actSeat;
    if (!v || seat == null) return;
    const ask = (html: string) => this.btns.appendChild(h(`<div class="tv-ask hf-ask">${html}</div>`));
    if (v.phase === 'draw') {
      ask('Теперь откройте верхнюю карту колоды.');
      this.button('Открыть карту из колоды', () => this.send({ type: 'draw' }), 'btn primary', true);
      return;
    }
    if (v.phase === 'pick') {
      ask(`Из колоды — ${esc(cardTitle(v.pick!.card))}. На столе две карты этого месяца: коснитесь той, которую взять.`);
      return;
    }
    if (v.phase === 'call') {
      const p = pointsOf(v, seat);
      const koi = v.cfg.mode === 'koikoi';
      ask(`${p.lines.map((l) => `${esc(l.name)} — ${l.pts}`).join('<br>')}<br><b>Всего ${p.total}.</b> ${koi ? 'Коикои или стоп?' : 'Го или стоп?'}`);
      this.button(koi ? 'Коикои! — дальше' : `Го! (${v.calls[seat] + 1}-е)`, () => this.send({ type: 'call', go: true }), 'btn');
      this.button('Стоп — забрать очки', () => this.send({ type: 'call', go: false }), 'btn primary');
      return;
    }
    // выкладка
    const all = moves(v, seat);
    if (this.picked != null) {
      const id = this.picked;
      const plays = all.filter((a) => a.type === 'play' && a.card === id) as (Action & { type: 'play' })[];
      const two = plays.some((a) => a.onto != null);
      if (two) ask(`${esc(cardTitle(id))}: на столе две карты месяца «${MONTHS[monthOf(id)]}» — коснитесь той, которую взять.`);
      if (canShake(v, seat, id) && !two) {
        ask(`У вас три карты месяца «${MONTHS[monthOf(id)]}» — можно трясти: показать их и удвоить свой выигрыш.`);
        this.button('Трясти (×2) и сыграть', () => this.send({ ...plays[0], shake: true }), 'btn primary');
        this.button('Просто сыграть', () => this.send(plays.find((a) => !a.shake)!), 'btn');
      }
      this.button('Другая карта', () => {
        this.picked = null;
        this.draw();
        this.renderButtons();
      });
      return;
    }
    ask('Ваш ход: коснитесь карты на руке. Карта того же месяца на столе — заберёте пару.');
    for (const m of bombMonths(v, seat)) this.button(`Бомба: три карты «${MONTHS[m]}» (×2)`, () => this.send({ type: 'bomb', month: m }), 'btn primary');
    if (all.some((a) => a.type === 'pass')) this.button(`Только открыть колоду (после бомбы: ${v.skips[seat]})`, () => this.send({ type: 'pass' }), 'btn');
  }

  // ---------------------------------------------------------------- события

  async play(events: Event[], v: View) {
    this.actSeat = null;
    this.picked = null;
    if (this.btns) this.btns.innerHTML = '';
    const speed = this.ctx.speed();
    for (const ev of events) {
      const cur = this.v!;
      switch (ev.type) {
        case 'deal': {
          if (ev.redeal) {
            await this.say('Четыре одного месяца на столе — пересдача', 900);
            break;
          }
          Sound.shuffle();
          const hands = cur.hands.map((_, i) => (ev.hands?.[i] ? ev.hands[i].slice() : []));
          const counts: number[] = cur.counts.map((_, i) => (cur.seats.includes(i) ? handSize(cur.cfg, cur.seats.length) : 0));
          this.v = { ...cur, round: ev.round, oya: ev.oya, turn: ev.oya, table: ev.table.slice(), hands, counts, caps: cur.caps.map(() => []), pend: null, pick: null, calls: cur.calls.map(() => 0), shakes: cur.shakes.map(() => 0), ppeoks: cur.ppeoks.map(() => 0), deckLeft: 48 - ev.table.length - counts.reduce((a, b) => a + b, 0), phase: 'play' };
          this.cs.render([], speed);
          this.draw();
          await sleep(500 / speed);
          break;
        }
        case 'play': {
          const hands = cur.hands.map((hh, i) => (i === ev.seat ? hh.filter((c) => !ev.cards.includes(c)) : hh));
          const counts = cur.counts.map((c, i) => (i === ev.seat ? c - ev.cards.length : c));
          if (ev.shown && ev.seat !== this.viewer) await this.say(`${this.plain(ev.seat)} трясёт: три карты «${MONTHS[monthOf(ev.cards[0])]}» (×2)`, 1100);
          this.v = { ...cur, hands, counts, pend: { cards: ev.cards, had: 0, onto: ev.onto }, phase: 'draw' };
          this.flyFrom(ev.seat);
          Sound.card();
          await sleep(480 / speed);
          if (ev.bomb) await this.say(`${this.plain(ev.seat)}: бомба!`, 900);
          break;
        }
        case 'pass':
          break;
        case 'flip': {
          const table = [...cur.table, ...(cur.pend?.cards ?? []), ev.card];
          this.v = { ...cur, table, pend: null, deckLeft: cur.deckLeft - 1 };
          this.draw();
          Sound.card();
          await sleep(560 / speed);
          break;
        }
        case 'take': {
          if (!ev.cards.length) {
            if (ev.why === 'sseul') await this.say(`${this.plain(ev.seat)}: ссыль — стол чист!`, 1000);
            break;
          }
          const table = cur.table.filter((c) => !ev.cards.includes(c));
          const caps = cur.caps.map((cc, i) => (i === ev.seat ? [...cc, ...ev.cards] : cc));
          this.v = { ...cur, table, caps, pick: null };
          this.draw();
          Sound.step();
          const word = ev.why === 'jjok' ? 'чок!' : ev.why === 'ttadak' ? 'ттадак!' : ev.why === 'eat' ? 'съел ппок!' : ev.why === 'bomb' ? 'бомба!' : '';
          if (word) await this.say(`${this.plain(ev.seat)}: ${word}`, 800);
          else await sleep(420 / speed);
          break;
        }
        case 'stick':
          await this.say(`${this.plain(ev.seat)}: ппок! Карты застряли`, 1000);
          break;
        case 'steal': {
          const caps = cur.caps.map((cc, i) => (i === ev.from ? cc.filter((c) => c !== ev.card) : i === ev.to ? [...cc, ev.card] : cc));
          this.v = { ...cur, caps };
          this.draw();
          await sleep(450 / speed);
          break;
        }
        case 'yaku':
          Sound.win();
          await this.say(`${this.plain(ev.seat)}: ${ev.lines.map((l) => `${l.name} ${l.pts}`).join(' · ')}`, ev.ask && ev.seat === this.viewer ? 900 : 1800, true);
          break;
        case 'call':
          await this.say(ev.go ? `${this.plain(ev.seat)}: «${ev.mode === 'koikoi' ? 'Коикои!' : `${ev.n}-го!`}»` : `${this.plain(ev.seat)}: «Стоп!»`, 1000);
          if (ev.go) this.v = { ...cur, calls: cur.calls.map((c, i) => (i === ev.seat ? ev.n : c)) };
          break;
        case 'instant':
          await this.say(`${this.plain(ev.seat)}: ${ev.what}`, 1600);
          break;
        case 'score': {
          const r = ev.result;
          const head = r.winner == null ? 'Кон без очков' : `Кон взял ${this.plain(r.winner)}: +${r.add[r.winner]}`;
          const lines = [head, ...(r.winner != null ? r.yaku.map((l) => `${l.name} — ${l.pts}`) : []), ...r.notes];
          await this.say(lines.join('\n'), 3200, true);
          this.v = { ...cur, score: ev.score, last: r };
          break;
        }
        case 'end':
          this.v = v;
          this.draw();
          await this.say(`Партия: ${ev.winners.map((x) => this.plain(x)).join(' и ')} — ${ev.score[ev.winners[0]]}`, 0);
          break;
      }
    }
    this.v = v;
    this.draw();
  }

  /** Сыгранная карта вылетает с руки (у соперника — из рубашек). */
  private flyFrom(seat: number) {
    if (seat !== this.viewer && this.v) {
      const items = this.layout(this.v);
      const z = this.zone(this.v, seat).hand;
      for (const it of items) if (it.card && !this.cs.has(it.key)) it.fromPt = z;
      this.cs.render(items, this.ctx.speed());
      return;
    }
    this.draw();
  }

  private async say(text: string, ms: number, multi = false) {
    this.banner.innerHTML = esc(text).replace(/\n/g, '<br>');
    this.banner.classList.toggle('hf-multi', multi);
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
    if (next != null && mine.length > 1 && next !== this.viewer) {
      this.viewer = next;
      this.cs.clear();
    }
    this.actSeat = interactive.find((x) => x === this.viewer) ?? null;
    this.draw();
    this.renderButtons();
  }

  status(v: View, toAct: number[], interactive: number[]) {
    if (v.over) return 'Партия окончена';
    const who = toAct[0];
    if (!interactive.includes(who)) return `Ходит ${this.ctx.name(who)}…`;
    if (v.phase === 'draw') return 'Откройте карту колоды';
    if (v.phase === 'pick') return 'Выберите карту на столе';
    if (v.phase === 'call') return v.cfg.mode === 'koikoi' ? 'Коикои или стоп?' : 'Го или стоп?';
    return 'Ваш ход';
  }

  playerStats(v: View, seat: number) {
    const need = v.cfg.mode === 'gostop' ? ` (для «го» — ${goMin(v.seats.length)})` : '';
    return `счёт: ${v.score[seat]}, в коне: ${pointsOf(v, seat).total}${need}, взято карт: ${v.caps[seat]?.length ?? 0}`;
  }

  destroy() {
    this.cs.destroy();
  }
}

export function createView(): GameView<View, Event> {
  return new HanafudaView();
}
