/* Сцена с картами для карточных игр: карты — HTML-элементы на «сцене» фиксированного размера (масштабируется под экран).
 * Каждая карта живёт под своим ключом; анимация — CSS-переход transform от старого места к новому.
 * Новые карты влетают из точки enter (или своей from / fromPt), исчезнувшие улетают в exit. Тот же приём, что у дурака. */
import { settings } from '../core/settings';
import { cardHTML } from './render';
import { cardId, type Card } from './deck';
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

export const cardKey = (c: Card) => 'c:' + cardId(c);

export class CardStage {
  readonly wrap: HTMLElement;
  readonly stage: HTMLElement;
  /** Слой поверх карт: таблички, надписи. */
  readonly over: HTMLElement;
  private els = new Map<string, HTMLElement>();
  private ro: ResizeObserver;
  /** Наклон сцены «в 3D» (например, rotateX(24deg)); перспектива — на обёртке. */
  private tilt = '';

  constructor(
    root: HTMLElement,
    readonly W: number,
    readonly H: number,
    cls: string,
    background = ''
  ) {
    this.wrap = document.createElement('div');
    this.wrap.className = `cs-wrap ${cls}`;
    this.wrap.innerHTML = `<div class="cs-stage" style="width:${W}px;height:${H}px">${background}<div class="cs-over"></div></div>`;
    root.appendChild(this.wrap);
    this.stage = this.wrap.querySelector('.cs-stage') as HTMLElement;
    this.over = this.wrap.querySelector('.cs-over') as HTMLElement;
    this.ro = new ResizeObserver(() => this.fit());
    this.ro.observe(this.wrap);
    this.fit();
  }

  fit() {
    const r = this.wrap.getBoundingClientRect();
    if (!r.width || !r.height) return;
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

  private transform(it: { x: number; y: number; r: number; s: number }) {
    return `translate(${it.x - CW / 2}px, ${it.y - CH / 2}px) rotate(${it.r}deg) scale(${it.s})`;
  }

  /** Разложить карты. speed — множитель скорости анимации. */
  render(items: StageItem[], speed: number, enter: Point | null = null, exit: Point | null = null) {
    const dur = Math.round(360 / speed);
    this.stage.style.setProperty('--cs-dur', dur + 'ms');
    const seen = new Set<string>();
    const keep = new Set(items.map((it) => it.key));
    let fresh = 0;
    for (const it of items) {
      seen.add(it.key);
      let el = this.els.get(it.key);
      if (!el && it.from) {
        // забрать исчезающую карту (последнюю подходящую — край веера)
        const gone = [...this.els.keys()].filter((k) => k.startsWith(it.from!) && !keep.has(k)).pop();
        if (gone) {
          el = this.els.get(gone)!;
          this.els.delete(gone);
          this.els.set(it.key, el);
          el.style.transitionDelay = '0ms';
        }
      }
      const face = it.card ? cardId(it.card) : 'back';
      if (!el) {
        el = document.createElement('div');
        el.className = 'cs-card';
        this.els.set(it.key, el);
        const from = it.fromPt ?? enter ?? it;
        const fly = from !== it;
        el.style.transition = 'none';
        el.style.transform = this.transform({ x: from.x, y: from.y, r: 0, s: it.s * (fly ? 0.7 : 1) });
        el.style.opacity = fly ? '1' : '0';
        this.stage.insertBefore(el, this.over);
        void el.offsetWidth;
        el.style.transition = '';
        el.style.transitionDelay = enter && !it.fromPt ? `${Math.min(fresh++ * 45, 400)}ms` : '0ms';
        el.style.opacity = '1';
      } else el.style.transitionDelay = '0ms';
      if (el.dataset.face !== face) {
        el.dataset.face = face;
        el.innerHTML = cardHTML(it.card, settings.deck);
      }
      el.style.transform = this.transform(it);
      el.style.zIndex = String(it.z);
      el.className = `cs-card${it.cls ? ' ' + it.cls : ''}`;
      for (const k of Object.keys(el.dataset)) if (k !== 'face') delete el.dataset[k];
      if (it.data) for (const [k, v] of Object.entries(it.data)) el.dataset[k] = v;
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
