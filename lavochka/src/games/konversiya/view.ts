/* «Конверсия» — отрисовка. Всё — из PnP-архива набора (tools/konversiya/cut.py, tracks.py): сверху — настоящая таблица
 * ввоза-вывоза выбранной длины с фишкой-индикатором на клетке; ниже — внутренний рынок СССР (ячейки со стопками карточек
 * собственности, планками заводов и жетонами, цены по курсу) и мировой рынок (континенты со своим импортом); затем стол каждого
 * игрока: банковские чеки, кредитное обязательство, карточки, заводы со вставленными станками, жетоны сырья и товара, груз.
 * Пуговицы игроков стоят в СССР или на континенте и переезжают при поездке. Действия — формами в боковой панели;
 * поездку можно начать и щелчком по континенту. */
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
  total,
  trips,
  tripGoods,
  WORLD_PRICE,
  worth,
  type Action,
  type Cont,
  type Event,
  type Key,
  type Mode,
  type Player,
  type State,
} from './engine';
import TRACKS from './tracks.json';
import './konversiya.css';

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
/** Карточки собственности (картон) и жетоны (пластмасса) — рисуются по-разному. */
const CARD: Key[] = ['equipS', 'equipI', 'truckS', 'truckI', 'fleetS', 'fleetI'];
const icon = (k: Key, cls = '') => `<img class="kv-ic kv-ic-${k} ${cls}" src="/konversiya/${k}.webp" alt="${SHORT[k]}" draggable="false">`;
const MODE_NAME: Record<Mode, string> = { truck: 'свой автотранспорт', fleet: 'свой флот', state: 'государственный транспорт' };
const btnImg = (s: number) => `/hodilki/buttons/${Math.min(s, 6)}.webp`;

/** Стопка карточек: до 5 видимых слоёв со сдвигом и число. */
function stack(k: Key, n: number, cls = '') {
  if (n <= 0) return '';
  const layers = Math.min(n, 5);
  let o = `<span class="kv-stack ${cls}" title="${SHORT[k]}: ${n}">`;
  for (let i = 0; i < layers; i++) o += `<img src="/konversiya/${k}.webp" alt="" draggable="false" style="--i:${layers - 1 - i}">`;
  return o + (n > 1 ? `<b class="kv-n">${n}</b>` : '') + `</span>`;
}

/** Кучка жетонов: до 4 видимых со сдвигом и число. */
function pile(k: Key, n: number, cls = '') {
  if (n <= 0) return '';
  const layers = Math.min(n, 4);
  let o = `<span class="kv-pile ${cls}" title="${SHORT[k]}: ${n}">`;
  for (let i = 0; i < layers; i++) o += `<img src="/konversiya/${k}.webp" alt="" draggable="false" style="--i:${i}">`;
  return o + (n > 1 ? `<b class="kv-n">${n}</b>` : '') + `</span>`;
}

/** Сырьё и товар — жетонами 10, 5 и 1. */
function chips(k: 'raw' | 'goods', n: number) {
  if (n <= 0) return '';
  let o = '';
  let left = n;
  for (const [v, img] of [
    [10, `${k}10`],
    [5, `${k}5`],
    [1, k],
  ] as const) {
    const c = Math.floor(left / v);
    left -= c * v;
    if (!c) continue;
    o += `<span class="kv-pile kv-coin" title="${SHORT[k]}: жетоны по ${v}">${Array.from({ length: Math.min(c, 4) }, (_, i) => `<img src="/konversiya/${img}.webp" alt="" draggable="false" style="--i:${i}">`).join('')}${c > 1 ? `<b class="kv-n">${c}</b>` : ''}</span>`;
  }
  return `<span class="kv-coins" title="${SHORT[k]}: ${n}">${o}<em>${SHORT[k].toLowerCase()} ${n}</em></span>`;
}

/** Банковские чеки на сумму (тысячи): купюры по достоинствам, стопками. */
function notes(sum: number, usd: boolean) {
  const vals = usd ? [20, 10, 5, 1] : [100, 50, 20, 10, 5, 1];
  let left = Math.max(0, Math.floor(sum));
  let o = '';
  for (const v of vals) {
    const c = Math.floor(left / v);
    left -= c * v;
    if (!c) continue;
    o += `<span class="kv-note" title="${v} тыс. ${usd ? 'долларов' : 'рублей'} × ${c}">${Array.from({ length: Math.min(c, 3) }, (_, i) => `<img src="/konversiya/${usd ? 'usd' : 'rub'}${v}.webp" alt="" draggable="false" style="--i:${i}">`).join('')}${c > 1 ? `<b class="kv-n">${c}</b>` : ''}</span>`;
  }
  return o;
}

/** Заводы — планки с пятью гнёздами, станки вставлены по порядку (импортные первыми). */
function factories(pl: Player) {
  let mi = pl.own.machI;
  let ms = pl.own.machS;
  let o = '';
  for (let f = 0; f < pl.own.factory; f++) {
    let slots = '';
    for (let k = 0; k < 5; k++) {
      const key: Key | null = mi > 0 ? 'machI' : ms > 0 ? 'machS' : null;
      if (key === 'machI') mi--;
      else if (key === 'machS') ms--;
      if (key) slots += `<img class="kv-slot-m" src="/konversiya/${key}.webp" alt="" draggable="false" style="--k:${k}">`;
    }
    o += `<span class="kv-plant" title="Завод: до 5 станков"><img src="/konversiya/factory.webp" alt="завод" draggable="false">${slots}</span>`;
  }
  // станки без завода
  if (mi > 0) o += pile('machI', mi);
  if (ms > 0) o += pile('machS', ms);
  return o;
}

class KonversiyaView implements GameView<State, Event> {
  private ctx!: ViewCtx;
  private root!: HTMLElement;
  private track!: HTMLElement;
  private trackImg!: HTMLImageElement;
  private ind!: HTMLElement;
  private rateEl!: HTMLElement;
  private world!: HTMLElement;
  private ussr!: HTMLElement;
  private players!: HTMLElement;
  private chipsEl!: HTMLElement;
  private cardEl!: HTMLElement;
  private panel!: HTMLElement;
  private v: State | null = null;
  private me: number | null = null;
  private form: 'buy' | 'sell' | 'trip' | null = null;
  private qty: Partial<Record<Key, number>> = {};
  private trip: { to: string; mode: Mode; goods: number } | null = null;
  /** Показанное положение фишки-индикатора (во время анимации отстаёт от состояния). */
  private shownInd = 0;
  private variant = '';
  private ro!: ResizeObserver;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    this.root = h(`<div class="kv-wrap"><div class="kv-table">
        <div class="kv-head"><div class="kv-rate"></div></div>
        <div class="kv-track"><div class="kv-track-in"><img class="kv-track-img" alt="таблица ввоза-вывоза" draggable="false"><i class="kv-ind" title="фишка-индикатор перемены курса"></i></div></div>
        <div class="kv-markets">
          <section class="kv-sheet kv-ussr"></section>
          <section class="kv-sheet kv-world"></section>
        </div>
        <div class="kv-players"></div>
        <div class="kv-chips"></div>
      </div>
      <div class="kv-card" hidden></div></div>`);
    root.appendChild(this.root);
    // в показе правил и на снимке пуговицы встают сразу, без переезда
    this.root.classList.toggle('kv-demo', !!ctx.demo);
    this.track = this.root.querySelector('.kv-track') as HTMLElement;
    this.trackImg = this.root.querySelector('.kv-track-img') as HTMLImageElement;
    this.ind = this.root.querySelector('.kv-ind') as HTMLElement;
    this.rateEl = this.root.querySelector('.kv-rate') as HTMLElement;
    this.world = this.root.querySelector('.kv-world') as HTMLElement;
    this.ussr = this.root.querySelector('.kv-ussr') as HTMLElement;
    this.players = this.root.querySelector('.kv-players') as HTMLElement;
    this.chipsEl = this.root.querySelector('.kv-chips') as HTMLElement;
    this.cardEl = this.root.querySelector('.kv-card') as HTMLElement;
    this.cardEl.addEventListener('click', () => (this.cardEl.hidden = true));
    this.world.addEventListener('click', (e) => this.onCont(e));
    this.panel = h(`<div class="kv-panel"></div>`);
    ctx.controls.appendChild(this.panel);
    this.panel.addEventListener('click', (e) => this.onClick(e));
    this.trackImg.onload = () => this.placeChips();
    // пуговицы стоят над якорями мест: раскладка сдвигается, пока грузятся картинки, — пересчёт по размеру стола
    this.ro = new ResizeObserver(() => this.placeChips());
    this.ro.observe(this.root);
    this.ro.observe(this.root.querySelector('.kv-table') as HTMLElement);
    // и по загрузке каждой картинки (событие load не всплывает — ловим на погружении)
    let queued = false;
    this.root.addEventListener(
      'load',
      () => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => {
          queued = false;
          this.placeChips();
        });
      },
      true,
    );
  }

  /** Щелчок по континенту в свой ход в СССР — поездка туда (форма с выбором транспорта). */
  private onCont(e: MouseEvent) {
    const el = (e.target as HTMLElement).closest('[data-cont]') as HTMLElement | null;
    const v = this.v;
    if (!el || !v || this.me == null || v.turn !== this.me || v.over) return;
    const ts = trips(v, this.me).filter((t) => t.to === el.dataset.cont);
    if (!ts.length) return;
    e.preventDefault();
    this.form = 'trip';
    this.qty = {};
    this.trip = { to: ts[0].to, mode: ts[0].mode, goods: tripGoods(v, this.me, ts[0].mode) };
    this.renderPanel();
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

  // ---------- таблица ввоза-вывоза

  private useTrack(v: State) {
    if (this.variant === v.cfg.variant) return;
    this.variant = v.cfg.variant;
    const t = TRACKS[v.cfg.variant];
    this.trackImg.src = `/konversiya/track-${v.cfg.variant}.webp`;
    this.root.style.setProperty('--track-ar', `${t.w} / ${t.h}`);
    this.track.dataset.variant = v.cfg.variant;
  }

  private placeInd(n: number) {
    const cells = TRACKS[this.variant as keyof typeof TRACKS].cells;
    const [x, y] = cells[Math.max(0, Math.min(cells.length - 1, n))];
    this.ind.style.left = x * 100 + '%';
    this.ind.style.top = y * 100 + '%';
  }

  private renderRate(v: State, ind = v.ind) {
    const r = rate({ cfg: v.cfg, ind });
    const left = toNextRate({ cfg: v.cfg, ind });
    this.rateEl.innerHTML = `<b class="kv-r r${r}">Курс ${r}</b><span>рубль к доллару ${RATIO[r - 1]}</span><span>партий через границу: <b>${ind}</b> из ${total(v.cfg.variant)}</span>${r < 5 ? `<span>до смены курса — <b>${left}</b></span>` : '<span><b>рубль конвертируемый — конец игры</b></span>'}`;
  }

  // ---------- рынки

  private renderUssr(v: State) {
    let o = `<header><i class="kv-star">★</i><h3>Внутренний рынок СССР</h3><small>покупка / продажа, тыс. руб. · перевозка партии ${freight(v)}</small><span class="kv-anchor" data-anchor="ussr"></span></header><div class="kv-slots">`;
    for (const k of KEYS) {
      const inf = k === 'raw' || k === 'goods';
      const n = v.market[k];
      const off = !inf && n <= 0;
      const goods = inf ? chips(k as 'raw' | 'goods', 15) : CARD.includes(k) ? stack(k, n) : k === 'factory' ? `<span class="kv-plantpile">${pile('factory', n)}</span>` : pile(k, n);
      o += `<div class="kv-slot${off ? ' off' : ''}${CARD.includes(k) ? ' card' : ''}">
        <div class="kv-slot-in">${off ? `<span class="kv-empty">${k.endsWith('I') || k === 'comp' ? 'ещё не завезли' : 'раскупили'}</span>` : goods}</div>
        <div class="kv-tag"><span>${SHORT[k]}</span><b>${buyPrice(v, k)}<i>/</i>${sellPrice(v, k)}</b>${inf ? '' : `<small>${n} шт.</small>`}</div></div>`;
    }
    this.ussr.innerHTML = o + '</div>';
  }

  private renderWorld(v: State) {
    let o = '<header><i class="kv-globe">◍</i><h3>Мировой рынок</h3><small>цены в тысячах долларов, рынок покупает советский товар по $4</small></header><div class="kv-conts">';
    const meHere = this.me != null && v.turn === this.me && !v.over ? trips(v, this.me).map((t) => t.to) : [];
    for (const c of CONTS) {
      const k = CONT_ITEM[c];
      const n = v.world[c];
      const can = meHere.includes(c);
      o += `<div class="kv-cont kv-c-${c}${can ? ' can' : ''}" data-cont="${c}"${can ? ' title="Поехать сюда"' : ''}>
        <div class="kv-cn">${CONT_NAME[c]}${BY_SEA.includes(c) ? '<i class="kv-sea" title="сюда ходит и флот">⚓</i>' : ''}</div>
        <div class="kv-cg">${CARD.includes(k) ? stack(k, n, 'small') : pile(k, n)}</div>
        <div class="kv-cs">${SHORT[k].replace(/ \(.*\)/, '')} · <b>$${WORLD_PRICE[ROW[k]]}</b></div>
        <span class="kv-anchor" data-anchor="${c}"></span></div>`;
    }
    this.world.innerHTML = o + '</div>';
  }

  // ---------- столы игроков

  private renderPlayers(v: State) {
    let o = '';
    v.p.forEach((q, i) => {
      const cards = CARD.map((k) => stack(k, q.own[k], 'small')).join('');
      const tok = `${factories(q)}${pile('comp', q.own.comp)}${chips('raw', q.own.raw)}${chips('goods', q.own.goods)}`;
      const c = q.cargo;
      const cargo = loadOf(c)
        ? `<div class="kv-cargo"><span>груз${q.loc === 'ussr' ? '' : ' в пути'}:</span>${c.goods ? chips('goods', c.goods) : ''}${c.state ? `<span class="kv-state" title="государственный груз">гос. ${c.stateKind && c.stateKind !== 'goods' ? SHORT[c.stateKind].toLowerCase() : 'товар'} ×${c.state}</span>` : ''}${Object.entries(c.imports)
            .map(([k, n]) => (CARD.includes(k as Key) ? stack(k as Key, n ?? 0, 'small') : pile(k as Key, n ?? 0)))
            .join('')}</div>`
        : '';
      const where = q.loc === 'ussr' ? 'в СССР' : CONT_NAME[q.loc as Cont];
      o += `<div class="kv-pl${v.turn === i && !v.over ? ' on' : ''}${q.alive ? '' : ' out'}" style="--c:${SEATS[i].color}">
        <div class="kv-pn"><img src="${btnImg(i)}" alt="" draggable="false"><b>${this.ctx.name(i)}</b><small>${where}${q.skip ? ' · пропускает ход' : ''} · итог ≈ ${worth(v, i)}</small></div>
        <div class="kv-cash"><span class="kv-sum">${q.rub} тыс. руб.</span>${notes(q.rub, false)}${q.usd ? `<span class="kv-sum usd">$${q.usd} тыс.</span>${notes(q.usd, true)}` : ''}${q.loan ? `<span class="kv-loan" title="Кредитное обязательство: вернуть ${LOAN_BACK} тыс."><img src="/konversiya/credit.webp" alt="кредитное обязательство" draggable="false"></span>` : ''}</div>
        ${cards || tok ? `<div class="kv-owns">${cards}${tok}</div>` : '<div class="kv-owns"><small class="kv-none">имущества нет</small></div>'}${cargo}</div>`;
    });
    this.players.innerHTML = o;
  }

  /** Пуговицы игроков — над якорями мест (СССР, континенты); при смене места переезжают. */
  private placeChips() {
    const v = this.v;
    if (!v) return;
    const table = this.chipsEl.parentElement!;
    // положение якоря внутри стола (не экранное: стол может быть масштабирован)
    const at = (el: HTMLElement) => {
      let x = 0;
      let y = 0;
      for (let e: HTMLElement | null = el; e && e !== table; e = e.offsetParent as HTMLElement | null) {
        x += e.offsetLeft;
        y += e.offsetTop;
      }
      return { x, y };
    };
    const byLoc = new Map<string, number[]>();
    v.p.forEach((q, i) => {
      if (!q.alive) return;
      byLoc.set(q.loc, [...(byLoc.get(q.loc) ?? []), i]);
    });
    for (let i = 0; i < v.p.length; i++) {
      let el = this.chipsEl.querySelector(`[data-seat="${i}"]`) as HTMLElement | null;
      if (!el) {
        el = h(`<img class="kv-chip" data-seat="${i}" src="${btnImg(i)}" alt="" draggable="false">`);
        this.chipsEl.appendChild(el);
      }
      const q = v.p[i];
      el.hidden = !q.alive;
      const a = this.root.querySelector(`[data-anchor="${q.loc}"]`) as HTMLElement | null;
      if (!a || !q.alive) continue;
      const r = at(a);
      const list = byLoc.get(q.loc) ?? [i];
      const k = list.indexOf(i);
      el.style.left = r.x - k * 28 + 'px';
      el.style.top = r.y + 'px';
      el.classList.toggle('on', v.turn === i && !v.over);
    }
    this.placeInd(this.shownInd);
  }

  private render() {
    const v = this.v;
    if (!v) return;
    this.useTrack(v);
    this.renderRate(v, this.shownInd);
    this.renderUssr(v);
    this.renderWorld(v);
    this.renderPlayers(v);
    this.placeChips();
    this.renderPanel();
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
    o += `<div class="kv-q">Куда и на чём${pl.loc === 'ussr' ? ' (можно щёлкнуть по континенту)' : ''}:</div><div class="kv-dests">`;
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

  setView(v: State) {
    this.v = v;
    this.shownInd = v.ind;
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
      } else if (ev.type === 'trip' || ev.type === 'back') {
        // пуговица переезжает на место назначения (или возвращается)
        if (this.v) {
          const p = this.v.p.slice();
          p[ev.seat] = { ...p[ev.seat], loc: ev.type === 'trip' ? ev.to : ev.at };
          this.v = { ...this.v, p };
          this.placeChips();
        }
        Sound.step();
        await sleep(520 / sp());
      } else if (ev.type === 'arrive' && ev.units > 0) {
        // фишка-индикатор: на столько клеток, сколько партий пересекло границу
        const from = this.shownInd;
        const to = Math.min(total(v.cfg.variant), from + ev.units);
        this.ind.classList.add('lifted');
        for (let n = from + 1; n <= to; n++) {
          this.shownInd = n;
          this.placeInd(n);
          this.renderRate(v, n);
          Sound.step();
          await sleep((ev.units > 12 ? 60 : 140) / sp());
        }
        this.ind.classList.remove('lifted');
        Sound.place();
      } else if (ev.type === 'rate') {
        this.rateEl.classList.add('flash');
        Sound.win();
        await sleep(700 / sp());
        this.rateEl.classList.remove('flash');
      } else if (ev.type === 'buy' || ev.type === 'load') Sound.place();
      else if (ev.type === 'sell') Sound.home();
      else if (ev.type === 'end') Sound.win();
    }
    this.v = v;
    this.shownInd = v.ind;
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

  destroy() {
    this.ro.disconnect();
  }
}

export function createView(): GameView<State, Event> {
  return new KonversiyaView();
}
