/* Сцена с картами для карточных игр: карты — HTML-элементы на «сцене» фиксированного размера (масштабируется под экран).
 * Каждая карта живёт под своим ключом; анимация — CSS-переход transform от старого места к новому.
 *
 * Чтобы карты не пропадали и не появлялись из воздуха, новая карта сначала ищет, чьё место она занимает:
 *  1) тот же ключ;  2) та же карта под другим ключом (рука → скинутое рубашкой: в ключе есть «c:<карта>»);
 *  3) from — исчезающая карта с ключом-префиксом (рубашка из руки соперника);
 *  4) точка fromPt или enter (колода, рука соперника) — влетает оттуда;
 *  5) без enter — ближайшая исчезающая карта: сыгранная соперником рубашка летит на стол и переворачивается,
 *     взятые со стола карты уходят в руку рубашкой.
 * Влетающая карта летит рубашкой и переворачивается на лету. Исчезнувшие без пары улетают в exit или тают на месте.
 * Смена лица у живой карты — переворот (scaleX), а не подмена картинки.
 *
 * Тени — box-shadow на картоне, без CSS-фильтров: фильтр на каждой летящей карте — это перерисовка с размытием
 * каждый кадр, на телефоне анимация от этого падала до пары кадров в секунду.
 *
 * Вертикальный экран (телефон): если игра дала размеры portrait, сцена переключается на них, когда место под стол
 * вытянуто вверх; игра узнаёт об этом через onMode и раскладывает карты заново (cs.portrait, cs.W, cs.H). */
import { settings } from '../core/settings';
import { cardUrl } from './render';
import { cardId, cardName, type Card } from './deck';
import './stage.css';

export const CW = 100;
export const CH = 155;

export interface StageItem {
  key: string;
  card: Card | null;
  x: number;
  y: number;
  r: number;
  s: number;
  z: number;
  cls?: string;
  /** Данные для нажатий: data-* атрибуты. */
  data?: Record<string, string>;
  /** Новая карта забирает исчезающую карту, чей ключ начинается с from (рубашка из руки соперника — переворачивается на лету). */
  from?: string;
  /** Новая карта (если забрать нечего) вылетает из этой точки. */
  fromPt?: Point;
}

export type Point = { x: number; y: number };
type Pos = { x: number; y: number; r: number; s: number };

export const cardKey = (c: Card) => 'c:' + cardId(c);

/** Какая карта под ключом: сама карта или «c:<карта>» внутри ключа (скинутая рубашкой). */
function identOf(it: StageItem): string {
  if (it.card) return cardId(it.card);
  const m = /(?:^|:)c:([SCDH]\d+)/.exec(it.key);
  return m ? m[1] : '';
}

export interface StageOpts {
  /** Размеры сцены на вытянутом вверх экране (телефон). Без них сцена всегда одна. */
  portrait?: { W: number; H: number };
}

export interface RenderOpts {
  /** Подбирать новым картам ближайшие исчезающие (по умолчанию — если не задан enter: тогда новые карты летят оттуда). */
  pair?: boolean;
}

export class CardStage {
  readonly wrap: HTMLElement;
  readonly stage: HTMLElement;
  /** Слой поверх карт: таблички, надписи. */
  readonly over: HTMLElement;
  /** Вертикальная раскладка (телефон). */
  portrait = false;
  /** Вызывается при смене раскладки — игре надо разложить всё заново. */
  onMode: (() => void) | null = null;
  private els = new Map<string, HTMLElement>();
  private pos = new WeakMap<HTMLElement, Pos>();
  private ro: ResizeObserver;
  /** Наклон сцены «в 3D» (например, rotateX(24deg)); перспектива — на обёртке. */
  private tilt = '';
  private dims: { W: number; H: number };

  constructor(
    root: HTMLElement,
    private readonly landW: number,
    private readonly landH: number,
    cls: string,
    background = '',
    private readonly opts: StageOpts = {}
  ) {
    this.dims = { W: landW, H: landH };
    this.wrap = document.createElement('div');
    this.wrap.className = `cs-wrap ${cls}`;
    this.wrap.innerHTML = `<div class="cs-stage" style="width:${landW}px;height:${landH}px">${background}<div class="cs-over"></div></div>`;
    root.appendChild(this.wrap);
    // стол карточной игры: на телефоне — выше, кнопки сразу под ним
    root.closest('.table')?.classList.add('table--cards');
    this.stage = this.wrap.querySelector('.cs-stage') as HTMLElement;
    this.over = this.wrap.querySelector('.cs-over') as HTMLElement;
    this.ro = new ResizeObserver(() => this.fit());
    this.ro.observe(this.wrap);
    this.fit();
  }

  get W() {
    return this.dims.W;
  }

  get H() {
    return this.dims.H;
  }

  fit() {
    const r = this.wrap.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const port = !!this.opts.portrait && r.width / r.height < 0.8;
    if (port !== this.portrait) {
      this.portrait = port;
      this.dims = port ? { ...this.opts.portrait! } : { W: this.landW, H: this.landH };
      this.stage.style.width = this.W + 'px';
      this.stage.style.height = this.H + 'px';
      this.wrap.classList.toggle('cs-port', port);
      // переразложить без полёта через весь стол
      this.stage.classList.add('cs-snap');
      this.onMode?.();
      requestAnimationFrame(() => requestAnimationFrame(() => this.stage.classList.remove('cs-snap')));
    }
    const k = Math.min(r.width / this.W, r.height / this.H);
    this.stage.style.transform = `translate(${(r.width - this.W * k) / 2}px, ${(r.height - this.H * k) / 2}px) scale(${k}) ${this.tilt}`;
  }

  /** Наклонить сцену (пустая строка — вид сверху). */
  setTilt(tilt: string, perspective = '1500px') {
    this.tilt = tilt;
    this.wrap.style.perspective = tilt ? perspective : '';
    this.wrap.style.perspectiveOrigin = '50% 20%';
    this.fit();
  }

  private transform(it: Pos) {
    return `translate(${it.x - CW / 2}px, ${it.y - CH / 2}px) rotate(${it.r}deg) scale(${it.s})`;
  }

  private place(el: HTMLElement, p: Pos) {
    this.pos.set(el, p);
    el.style.transform = this.transform(p);
  }

  /** Разложить карты. speed — множитель скорости анимации. */
  render(items: StageItem[], speed: number, enter: Point | null = null, exit: Point | null = null, opts: RenderOpts = {}) {
    const dur = Math.round(360 / speed);
    const pair = opts.pair ?? !enter;
    this.stage.style.setProperty('--cs-dur', dur + 'ms');
    const keep = new Set(items.map((it) => it.key));
    // исчезающие карты — кандидаты на роль новых
    const gone = new Map<string, HTMLElement>();
    for (const [k, el] of this.els) if (!keep.has(k)) gone.set(k, el);
    const take = (k: string, key: string) => {
      const el = gone.get(k)!;
      gone.delete(k);
      this.els.delete(k);
      this.els.set(key, el);
      return el;
    };
    const found = new Map<StageItem, HTMLElement>();
    // 1–3: тот же ключ, та же карта, from
    for (const it of items) {
      let el = this.els.get(it.key);
      if (!el) {
        const id = identOf(it);
        const same = id ? [...gone.keys()].find((k) => gone.get(k)!.dataset.id === id) : undefined;
        if (same) el = take(same, it.key);
        else if (it.from) {
          const k = [...gone.keys()].filter((x) => x.startsWith(it.from!)).pop();
          if (k) el = take(k, it.key);
        }
      }
      if (el) found.set(it, el);
    }
    // 5: ближайшая исчезающая карта
    if (pair)
      for (const it of items) {
        if (found.has(it) || it.fromPt || !gone.size) continue;
        let best = '';
        let bd = Infinity;
        for (const [k, el] of gone) {
          const p = this.pos.get(el);
          if (!p) continue;
          const d = (p.x - it.x) ** 2 + (p.y - it.y) ** 2;
          if (d < bd) {
            bd = d;
            best = k;
          }
        }
        if (best) found.set(it, take(best, it.key));
      }
    let fresh = 0;
    for (const it of items) {
      let el = found.get(it);
      const face = it.card ? cardId(it.card) : 'back';
      if (!el) {
        // новая карта: влетает из fromPt / enter или проявляется на месте
        el = document.createElement('div');
        el.className = 'cs-card';
        el.innerHTML = '<div class="cs-face"></div>';
        this.els.set(it.key, el);
        const from = it.fromPt ?? enter;
        el.style.transition = 'none';
        el.style.opacity = from ? '1' : '0';
        this.place(el, from ? { x: from.x, y: from.y, r: 0, s: it.s * 0.8 } : it);
        // влетает рубашкой и переворачивается на лету
        this.paint(el, from ? null : it.card);
        this.stage.insertBefore(el, this.over);
        void el.offsetWidth;
        el.style.transition = '';
        el.style.transitionDelay = enter && !it.fromPt ? `${Math.min(fresh++ * 45, 400)}ms` : '0ms';
        el.style.opacity = '1';
      } else {
        el.style.transition = '';
        el.style.transitionDelay = '0ms';
        el.style.opacity = '1';
      }
      if (el.dataset.face !== face) this.flip(el, it.card, dur, el.style.transitionDelay);
      el.dataset.id = identOf(it);
      this.place(el, it);
      el.style.zIndex = String(it.z);
      el.className = `cs-card${it.cls ? ' ' + it.cls : ''}`;
      for (const k of Object.keys(el.dataset)) if (k !== 'face' && k !== 'id') delete el.dataset[k];
      if (it.data) for (const [k, v] of Object.entries(it.data)) el.dataset[k] = v;
    }
    // исчезнувшие без пары: в exit (в стопку, в руку) или тают на месте
    for (const [k, el] of gone) {
      this.els.delete(k);
      el.style.transitionDelay = '0ms';
      el.style.pointerEvents = 'none';
      if (exit) {
        const p = this.pos.get(el);
        el.style.transition = `transform ${dur}ms cubic-bezier(0.2, 0.7, 0.3, 1), opacity ${Math.round(dur * 0.3)}ms linear ${Math.round(dur * 0.7)}ms`;
        this.place(el, { x: exit.x, y: exit.y, r: p ? p.r * 0.5 : 0, s: (p?.s ?? 1) * 0.85 });
        el.style.opacity = '0';
        setTimeout(() => el.remove(), dur + 60);
      } else {
        el.style.transition = `opacity ${Math.round(dur * 0.5)}ms linear`;
        el.style.opacity = '0';
        setTimeout(() => el.remove(), dur * 0.5 + 60);
      }
    }
  }

  /** Нарисовать лицо (или рубашку) сразу. */
  private paint(el: HTMLElement, c: Card | null) {
    const face = el.firstElementChild as HTMLElement;
    el.dataset.face = c ? cardId(c) : 'back';
    if (c && c.r === 15) {
      face.innerHTML = `<span class="card card-joker" data-red="${c.s === 'H' || c.s === 'D' ? 1 : 0}"><b>★</b><small>ДЖОКЕР</small></span>`;
      return;
    }
    let img = face.firstElementChild as HTMLImageElement | null;
    if (!img || img.tagName !== 'IMG') {
      face.innerHTML = '<img class="card" draggable="false" alt="">';
      img = face.firstElementChild as HTMLImageElement;
    }
    // картинки уже подгружены и раскодированы (preloadDeck) — смена src без пустого кадра
    img.src = cardUrl(c, settings.deck);
    img.alt = c ? cardName(c) : 'рубашка';
  }

  /** Перевернуть карту: сжать по ширине, сменить лицо, развернуть обратно. */
  private flip(el: HTMLElement, c: Card | null, dur: number, delay: string) {
    const face = el.firstElementChild as HTMLElement;
    const target = c ? cardId(c) : 'back';
    el.dataset.face = target;
    if (typeof face.animate !== 'function' || this.stage.classList.contains('cs-snap')) return this.paint(el, c);
    for (const a of face.getAnimations()) a.cancel();
    const half = Math.max(60, Math.min(200, dur * 0.4));
    const wait = parseInt(delay) || 0;
    const a = face.animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], { duration: half, delay: wait + dur * 0.15, easing: 'ease-in', fill: 'forwards' });
    a.onfinish = () => {
      if (el.dataset.face !== target) return;
      this.paint(el, c);
      a.cancel();
      face.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: half, easing: 'ease-out' });
    };
  }

  has(key: string) {
    return this.els.has(key);
  }

  /** Убрать все карты (например, при смене зрителя в хот-сите). */
  clear() {
    for (const el of this.els.values()) el.remove();
    this.els.clear();
  }

  destroy() {
    this.ro.disconnect();
  }
}

/** Веер карт: позиция k-й карты из n вокруг центра (x, y). */
export function fan(n: number, k: number, x: number, y: number, width: number, maxStep: number, bend = 40, tilt = 26) {
  const step = Math.min(maxStep, width / Math.max(1, n - 1));
  const t = n > 1 ? k / (n - 1) - 0.5 : 0;
  return { x: x + (k - (n - 1) / 2) * step, y: y + t * t * bend, r: t * Math.min(tilt, n * 2.6) };
}

/** Своя рука на узкой (вертикальной) сцене: веер шириной width; при многих картах — в два ряда, чтобы карты не превращались в полоски. */
export function portraitHand(n: number, k: number, x: number, y: number, width = 410, s = 1.22, shrink = true) {
  const two = n > 9;
  const top = two ? Math.ceil(n / 2) : n;
  const row = two && k >= top ? 1 : 0;
  const m = row ? n - top : top;
  const j = row ? k - top : k;
  const step = Math.min(78, width / Math.max(1, m - 1));
  const t = m > 1 ? j / (m - 1) - 0.5 : 0;
  const yy = two ? (row ? y + 28 : y - 58) : y;
  return { x: x + (j - (m - 1) / 2) * step, y: yy + t * t * 24, r: t * Math.min(16, m * 2.4), s: two && shrink ? s * 0.9 : s };
}

/** Места соперников сверху на узкой сцене шириной W: слева направо. */
export function portraitArc(n: number, W = 540): Point[] {
  if (n === 1) return [{ x: W / 2, y: 70 }];
  const span = Math.min(W - 120, 150 * (n - 1));
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    return { x: W / 2 - span / 2 + span * t, y: 62 + Math.pow(2 * t - 1, 2) * (n > 3 ? 26 : 14) };
  });
}
