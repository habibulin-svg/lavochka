/* «Конверсия» — отрисовка. Поля в наборе не было, собираем его как в правилах («Как организовать поле для игры»): сверху —
 * таблица ввоза-вывоза с фишкой-индикатором (цвета зон — как в наборе), ряд континентов мирового рынка с «стопками» импорта,
 * внутренний рынок СССР с запасами и ценами по курсу, карточки игроков с имуществом и грузом. Картинки — карточки собственности,
 * жетоны и «События в пути» из PnP-архива (tools/konversiya/cut.py). Действия — формами в боковой панели. */
import { Sound } from '../../core/audio';
import { h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { SEATS } from './def';
import {
  buyPrice,
  BY_SEA,
  capacity,
  CARD_KINDS,
  CONT_ITEM,
  CONT_NAME,
  CONTS,
  freight,
  KEYS,
  legal,
  LOAN_BACK,
  loadOf,
  mineYield,
  produceYield,
  rate,
  ROW,
  sellPrice,
  toNextRate,
  trips,
  tripGoods,
  WORLD_PRICE,
  worth,
  ZONES,
  type Action,
  type Cont,
  type Event,
  type Key,
  type Mode,
  type State,
} from './engine';
import './konversiya.css';

const ZONE_COLORS: Record<string, string[]> = {
  short: ['#8a3ab8', '#2f7fd8', '#f0b020', '#3aa040'],
  medium: ['#8a3ab8', '#3aa040', '#2f7fd8', '#f0b020'],
  long: ['#8a3ab8', '#3aa040', '#2f7fd8', '#f0b020'],
};
const RATIO = ['1:10', '1:8', '1:5', '1:2', '1:1'];
const SHORT: Record<Key, string> = {
  equipS: 'Оборудование',
  equipI: 'Оборуд. (Азия)',
  factory: 'Завод',
  machS: 'Станки',
  machI: 'Станки (Европа)',
  truckS: 'Автотранспорт',
  truckI: 'Автотр. (Африка)',
  fleetS: 'Флот',
  fleetI: 'Флот (Австралия)',
  comp: 'Компьютер',
  raw: 'Сырьё',
  goods: 'Товар',
};
const icon = (k: Key) => `<img class="kv-ic kv-ic-${k}" src="/konversiya/${k}.webp" alt="" draggable="false">`;
const MODE_NAME: Record<Mode, string> = { truck: 'свой автотранспорт', fleet: 'свой флот', state: 'государственный транспорт' };

class KonversiyaView implements GameView<State, Event> {
  private ctx!: ViewCtx;
  private root!: HTMLElement;
  private track!: HTMLElement;
  private world!: HTMLElement;
  private ussr!: HTMLElement;
  private players!: HTMLElement;
  private cardEl!: HTMLElement;
  private panel!: HTMLElement;
  private v: State | null = null;
  private me: number | null = null;
  private form: 'buy' | 'sell' | 'trip' | null = null;
  private qty: Partial<Record<Key, number>> = {};
  private trip: { to: string; mode: Mode; goods: number } | null = null;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    this.root = h(`<div class="kv-wrap">
        <div class="kv-track"></div>
        <div class="kv-world"></div>
        <div class="kv-ussr"></div>
        <div class="kv-players"></div>
        <div class="kv-card" hidden></div>
      </div>`);
    root.appendChild(this.root);
    this.track = this.root.querySelector('.kv-track') as HTMLElement;
    this.world = this.root.querySelector('.kv-world') as HTMLElement;
    this.ussr = this.root.querySelector('.kv-ussr') as HTMLElement;
    this.players = this.root.querySelector('.kv-players') as HTMLElement;
    this.cardEl = this.root.querySelector('.kv-card') as HTMLElement;
    this.cardEl.addEventListener('click', () => (this.cardEl.hidden = true));
    this.panel = h(`<div class="kv-panel"></div>`);
    ctx.controls.appendChild(this.panel);
    this.panel.addEventListener('click', (e) => this.onClick(e));
  }

  private onClick(e: MouseEvent) {
    const b = (e.target as HTMLElement).closest('[data-k]') as HTMLElement | null;
    if (!b || !this.v) return;
    e.preventDefault();
    const k = b.dataset.k!;
    const v = this.v;
    if (k === 'form') {
      const f = b.dataset.f as 'buy' | 'sell' | 'trip';
      this.form = this.form === f ? null : f;
      this.qty = {};
      this.trip = null;
      this.renderPanel();
      return;
    }
    if (k === 'q') {
      const key = b.dataset.key as Key;
      const d = Number(b.dataset.d);
      const max = Number(b.dataset.max);
      this.qty[key] = Math.max(0, Math.min(max, (this.qty[key] ?? 0) + d));
      this.renderPanel();
      return;
    }
    if (k === 'dest') {
      const mode = b.dataset.mode as Mode;
      this.trip = { to: b.dataset.to!, mode, goods: tripGoods(v, this.me!, mode) };
      this.renderPanel();
      return;
    }
    if (k === 'tg') {
      if (this.trip) this.trip.goods = Math.max(0, Math.min(tripGoods(v, this.me!, this.trip.mode), this.trip.goods + Number(b.dataset.d)));
      this.renderPanel();
      return;
    }
    if (k === 'go') {
      if (this.form === 'buy' || this.form === 'sell') {
        const items = Object.fromEntries(Object.entries(this.qty).filter(([, n]) => (n ?? 0) > 0));
        if (Object.keys(items).length) this.send({ type: this.form, items });
      } else if (this.form === 'trip' && this.trip) this.send({ type: 'trip', to: this.trip.to as State['p'][0]['loc'], mode: this.trip.mode, goods: this.trip.goods });
      return;
    }
    if (k === 'act') this.send(JSON.parse(b.dataset.a!) as Action);
  }

  private send(a: Action) {
    const seat = this.me;
    if (seat == null || !this.v || this.v.turn !== seat) return;
    Sound.unlock();
    const free = a.type === 'loan' || a.type === 'repay' || a.type === 'exchange';
    if (!free) {
      this.form = null;
      this.qty = {};
      this.trip = null;
      this.me = null;
    }
    this.ctx.act(seat, a);
    this.renderPanel();
  }

  // ---------- поле

  private renderTrack(v: State) {
    const z = ZONES[v.cfg.variant];
    const tot = z.reduce((a, b) => a + b, 0);
    const col = ZONE_COLORS[v.cfg.variant];
    let o = `<div class="kv-tt"><b>Курс ${rate(v)}</b> (${RATIO[rate(v) - 1]}) · пересекло границу ${v.ind} из ${tot}${rate(v) < 5 ? ` · до смены курса ${toNextRate(v)}` : ''}</div><div class="kv-bar">`;
    z.forEach((n, i) => (o += `<i style="flex:${n};background:${col[i]}"><span>${i + 1}</span></i>`));
    o += `<em style="left:${Math.min(100, (v.ind / tot) * 100)}%"></em></div>`;
    this.track.innerHTML = o;
  }

  private chips(v: State, loc: string) {
    return v.p
      .map((q, i) => (q.alive && q.loc === loc ? `<b class="kv-chip" style="background:${SEATS[i].color}" title="${SEATS[i].name}"></b>` : ''))
      .join('');
  }

  private renderWorld(v: State) {
    let o = '<div class="kv-h">Мировой рынок</div><div class="kv-conts">';
    for (const c of CONTS) {
      const k = CONT_ITEM[c];
      o += `<div class="kv-cont${BY_SEA.includes(c) ? ' sea' : ''}"><div class="kv-cn">${CONT_NAME[c]}${this.chips(v, c)}</div>${icon(k)}
        <div class="kv-cs">${SHORT[k].replace(/ \(.*\)/, '')} · $${WORLD_PRICE[ROW[k]]} · <b>${v.world[c]}</b></div></div>`;
    }
    this.world.innerHTML = o + '</div>';
  }

  private renderUssr(v: State) {
    let o = `<div class="kv-h">Внутренний рынок СССР ${this.chips(v, 'ussr')}<small>купить / продать, тыс. руб.; перевозка партии — ${freight(v)}</small></div><div class="kv-goods">`;
    for (const k of KEYS) {
      const stock = k === 'raw' || k === 'goods' ? '∞' : String(v.market[k]);
      if (stock === '0' && (k.endsWith('I') || k === 'comp')) {
        o += `<div class="kv-g off">${icon(k)}<span>${SHORT[k]}</span><small>ещё не завезли</small></div>`;
        continue;
      }
      o += `<div class="kv-g">${icon(k)}<span>${SHORT[k]}</span><small>${buyPrice(v, k)} / ${sellPrice(v, k)} · ${stock}</small></div>`;
    }
    this.ussr.innerHTML = o + '</div>';
  }

  private renderPlayers(v: State) {
    let o = '';
    v.p.forEach((q, i) => {
      const own = KEYS.filter((k) => q.own[k] > 0)
        .map((k) => `<span class="kv-own">${icon(k)}<b>${q.own[k]}</b></span>`)
        .join('');
      const cargo = loadOf(q.cargo)
        ? `груз: ${[q.cargo.goods ? `свой товар ${q.cargo.goods}` : '', q.cargo.state ? `гос. ${q.cargo.stateKind === 'goods' ? 'товар' : SHORT[q.cargo.stateKind ?? 'goods'].toLowerCase()} ${q.cargo.state}` : '', ...Object.entries(q.cargo.imports).map(([k, n]) => `${SHORT[k as Key].toLowerCase()} ${n}`)].filter(Boolean).join(', ')}`
        : '';
      o += `<div class="kv-pl${v.turn === i && !v.over ? ' on' : ''}${q.alive ? '' : ' out'}" style="--c:${SEATS[i].color}">
        <div class="kv-pn">${this.ctx.name(i)} <small>${q.loc === 'ussr' ? 'в СССР' : CONT_NAME[q.loc as Cont]}${q.skip ? ' · пропускает ход' : ''}</small></div>
        <div class="kv-money"><b>${q.rub}</b> тыс. руб. · <b>${q.usd}</b> тыс. $${q.loan ? ' · <span class="kv-loan">ссуда: вернуть 150</span>' : ''} · итог ≈ ${worth(v, i)}</div>
        <div class="kv-owns">${own || '<small>имущества нет</small>'}</div>${cargo ? `<div class="kv-cargo">${cargo}</div>` : ''}</div>`;
    });
    this.players.innerHTML = o;
  }

  // ---------- панель действий

  private btn(a: Action, text: string, cls = '') {
    return `<button class="btn ${cls}" data-k="act" data-a='${JSON.stringify(a)}'>${text}</button>`;
  }

  private renderPanel() {
    const v = this.v;
    if (!v || this.me == null || v.turn !== this.me || v.over) {
      this.panel.innerHTML = '';
      return;
    }
    const i = this.me;
    const pl = v.p[i];
    const L = legal(v);
    const has = (t: Action['type']) => L.some((a) => a.type === t);
    let o = `<div class="kv-q">Ваш ход: одно действие.${v.extra ? ' <b>Досрочно прибыли — ещё одна операция!</b>' : ''}</div><div class="kv-acts">`;
    o += `<button class="btn ${this.form === 'buy' ? 'primary' : ''}" data-k="form" data-f="buy">Купить…</button>`;
    o += `<button class="btn ${this.form === 'sell' ? 'primary' : ''}" data-k="form" data-f="sell">Продать…</button>`;
    if (has('mine')) {
      const m = mineYield(pl);
      o += this.btn({ type: 'mine' }, `Добыть: ${m.units} сырья за ${m.cost} тыс.`);
    }
    if (has('produce')) {
      const p = produceYield(pl);
      o += this.btn({ type: 'produce' }, `Произвести: ${p.units} товара за ${p.cost} тыс.`);
    }
    const load = L.find((a) => a.type === 'load') as (Action & { type: 'load' }) | undefined;
    if (load) {
      o += this.btn(load, `Погрузить гос. груз: ${load.n} × ${freight(v)} тыс.`);
      if (load.n > 1) o += this.btn({ type: 'load', n: 1 }, 'Погрузить 1');
    }
    if (has('unload')) o += this.btn({ type: 'unload' }, 'Разгрузить гос. груз');
    if (has('trip')) o += `<button class="btn ${this.form === 'trip' ? 'primary' : ''}" data-k="form" data-f="trip">${pl.loc === 'ussr' ? 'Поездка за границу…' : 'Домой, в СССР…'}</button>`;
    o += this.btn({ type: 'skip' }, 'Пропустить ход');
    o += `</div><div class="kv-free">`;
    if (has('loan')) o += this.btn({ type: 'loan' }, 'Ссуда +100 (вернуть 150)', 'small');
    if (has('repay')) o += this.btn({ type: 'repay' }, `Вернуть ссуду ${LOAN_BACK}`, 'small');
    if (has('exchange')) o += this.btn({ type: 'exchange', usd: pl.usd }, `Обменять ${pl.usd} $ на рубли`, 'small');
    o += `</div>`;
    if (this.form) o += `<div class="kv-form">${this.formHtml(v, i)}</div>`;
    this.panel.innerHTML = o;
  }

  private stepper(key: Key, max: number, price: number, usd: boolean) {
    const n = this.qty[key] ?? 0;
    return `<div class="kv-row">${icon(key)}<span>${SHORT[key]} <small>${usd ? '$' : ''}${price}${usd ? '' : ' тыс.'} · до ${max}</small></span>
      <button class="btn small" data-k="q" data-key="${key}" data-d="-1" data-max="${max}">−</button><b>${n}</b><button class="btn small" data-k="q" data-key="${key}" data-d="1" data-max="${max}">+</button></div>`;
  }

  private formHtml(v: State, i: number): string {
    const pl = v.p[i];
    let o = '';
    if (this.form === 'buy') {
      let sum = 0;
      if (pl.loc === 'ussr') {
        for (const k of KEYS) {
          if (v.market[k] <= 0) continue;
          const pr = buyPrice(v, k);
          if (pr > pl.rub && !(this.qty[k] ?? 0)) continue;
          o += this.stepper(k, Math.min(v.market[k], Math.floor(pl.rub / pr)), pr, false);
          sum += (this.qty[k] ?? 0) * pr;
        }
        o += `<div class="kv-sum">Итого: ${sum} тыс. руб. из ${pl.rub}</div>`;
      } else {
        const c = pl.loc as Cont;
        const k = CONT_ITEM[c];
        const pr = WORLD_PRICE[ROW[k]]!;
        const room = pl.lastMode === 'state' ? 99 : Math.max(0, capacity(pl, pl.lastMode ?? 'truck') - loadOf(pl.cargo));
        o += this.stepper(k, Math.min(v.world[c], Math.floor(pl.usd / pr), room), pr, true);
        sum = (this.qty[k] ?? 0) * pr;
        o += `<div class="kv-sum">Итого: $${sum} из ${pl.usd} · места в транспорте: ${pl.lastMode === 'state' ? 'сколько угодно' : room}</div>`;
      }
      return o + `<button class="btn primary" data-k="go">Купить</button>`;
    }
    if (this.form === 'sell') {
      let sum = 0;
      if (pl.loc === 'ussr') {
        for (const k of KEYS) {
          if (pl.own[k] <= 0) continue;
          o += this.stepper(k, pl.own[k], sellPrice(v, k), false);
          sum += (this.qty[k] ?? 0) * sellPrice(v, k);
        }
        if (!o) o = '<div class="kv-q">Продавать нечего.</div>';
        o += `<div class="kv-sum">Выручка: ${sum} тыс. руб.</div>`;
      } else {
        if (pl.cargo.goods) o += this.stepper('goods', pl.cargo.goods, WORLD_PRICE.goods!, true);
        else o = '<div class="kv-q">Мировой рынок покупает только советский товар — его в грузе нет.</div>';
        sum = (this.qty.goods ?? 0) * WORLD_PRICE.goods!;
        o += `<div class="kv-sum">Выручка: $${sum}</div>`;
      }
      return o + `<button class="btn primary" data-k="go">Продать</button>`;
    }
    // поездка
    const ts = trips(v, i);
    o += '<div class="kv-q">Куда и на чём:</div><div class="kv-dests">';
    for (const t of ts) {
      const sel = this.trip && this.trip.to === t.to && this.trip.mode === t.mode;
      o += `<button class="btn small ${sel ? 'primary' : ''}" data-k="dest" data-to="${t.to}" data-mode="${t.mode}">${t.to === 'ussr' ? 'СССР' : CONT_NAME[t.to as Cont]} — ${MODE_NAME[t.mode]}${t.cost ? ` (${t.cost} тыс.)` : ''}</button>`;
    }
    o += '</div>';
    if (this.trip) {
      const max = tripGoods(v, i, this.trip.mode);
      if (pl.loc === 'ussr' && pl.own.goods > 0)
        o += `<div class="kv-row">${icon('goods')}<span>Своего товара с собой <small>до ${max}</small></span><button class="btn small" data-k="tg" data-d="-1">−</button><b>${this.trip.goods}</b><button class="btn small" data-k="tg" data-d="1">+</button></div>`;
      o += `<button class="btn primary" data-k="go">Ехать</button>`;
    }
    return o;
  }

  private render() {
    const v = this.v;
    if (!v) return;
    this.renderTrack(v);
    this.renderWorld(v);
    this.renderUssr(v);
    this.renderPlayers(v);
    this.renderPanel();
  }

  setView(v: State) {
    this.v = v;
    this.render();
  }

  async play(events: Event[], v: State) {
    const sp = () => this.ctx.speed();
    for (const ev of events) {
      if (ev.type === 'card') {
        const c = CARD_KINDS[ev.kind];
        this.cardEl.innerHTML = `<img src="/konversiya/cards/${c.id}.webp" alt="${c.text}"><div>${c.text}</div>`;
        this.cardEl.hidden = false;
        Sound.card();
        await sleep(1700 / sp());
        this.cardEl.hidden = true;
      } else if (ev.type === 'rate') {
        Sound.win();
        await sleep(400 / sp());
      } else if (ev.type === 'buy' || ev.type === 'load') Sound.place();
      else if (ev.type === 'sell') Sound.home();
      else if (ev.type === 'trip') Sound.step();
      else if (ev.type === 'end') Sound.win();
    }
    this.v = v;
    this.render();
  }

  setTurn(toAct: number[], interactive: number[]) {
    const v = this.v;
    this.me = v && !v.over && !this.ctx.demo ? (interactive.find((x) => toAct.includes(x)) ?? null) : null;
    this.render();
  }

  status(v: State, toAct: number[], interactive: number[]) {
    if (v.over) return v.winner == null ? 'Поровну' : `Победа: ${this.ctx.name(v.winner)}`;
    if (!interactive.includes(toAct[0])) return `Ходит ${this.ctx.name(toAct[0])}…`;
    return v.extra ? 'Ещё одна операция' : 'Ваш ход — выберите действие';
  }
}

export function createView(): GameView<State, Event> {
  return new KonversiyaView();
}

