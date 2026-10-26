/* Приближение небольших досок (далдос, шен, сальто, Санторин и т. п.) — когда на телефоне лунки и клетки мелкие.
 * Доска (target — элемент на всё окно wrap: svg или div) масштабируется transform: scale + сдвиг; колесо мыши и щипок
 * приближают к месту под пальцем, перетаскивание приближенной доски сдвигает её (это не нажатие), кнопки «−», «+» и «⤢».
 * Нажатия по доске работают как прежде: браузер сам пересчитывает координаты через transform (и getScreenCTM у svg).
 * Кнопки — в стиле камеры больших полей (core/boardcam.css). */
import { h } from './util';
import './boardcam.css';

export interface ZoomOpts {
  /** Насколько можно приблизить (по умолчанию в 3 раза). */
  max?: number;
  /** Угол для кнопок (по умолчанию справа внизу). */
  corner?: 'br' | 'bl' | 'tr' | 'tl';
  /** Показ правил — без кнопок и жестов. */
  demo?: boolean;
  /** Масштаб изменился (например, перерисовать то, что держит экранный размер). */
  changed?: (z: number) => void;
}

export class Zoom {
  z = 1;
  private tx = 0;
  private ty = 0;
  private ptrs = new Map<number, { x: number; y: number }>();
  private g: { x: number; y: number; tx: number; ty: number; moved: boolean; dist?: number; z?: number; cx?: number; cy?: number } | null = null;
  private eat = false;
  private bar: HTMLElement;
  private max: number;

  constructor(
    private wrap: HTMLElement,
    private target: HTMLElement | SVGElement,
    private o: ZoomOpts = {}
  ) {
    this.max = o.max ?? 3;
    (target as HTMLElement).style.transformOrigin = '0 0';
    this.bar = h(`<div class="bc-cam zm-bar zm-${o.corner ?? 'br'}"><span class="bc-zoom">
        <button class="bc-cb" data-z="out" title="Отдалить">−</button><button class="bc-cb" data-z="all" title="Вся доска">⤢</button><button class="bc-cb" data-z="in" title="Приблизить">+</button>
      </span></div>`);
    this.bar.hidden = !!o.demo;
    wrap.appendChild(this.bar);
    if (getComputedStyle(wrap).position === 'static') wrap.style.position = 'relative';
    this.bar.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const z = ((e.target as HTMLElement).closest('[data-z]') as HTMLElement | null)?.dataset.z;
      const r = this.wrap.getBoundingClientRect();
      if (z === 'in') this.zoomAt(r.width / 2, r.height / 2, this.z * 1.5);
      else if (z === 'out') this.zoomAt(r.width / 2, r.height / 2, this.z / 1.5);
      else if (z === 'all') this.reset();
    });
    this.bar.addEventListener('pointerdown', (e) => e.stopPropagation());
    if (o.demo) return;
    wrap.style.touchAction = 'none';
    wrap.addEventListener('wheel', this.onWheel, { passive: false });
    wrap.addEventListener('pointerdown', this.onDown);
    wrap.addEventListener('pointermove', this.onMove);
    wrap.addEventListener('pointerup', this.onUp);
    wrap.addEventListener('pointercancel', this.onUp);
    wrap.addEventListener('click', this.onClick, true);
    this.apply();
  }

  /** Вся доска. */
  reset() {
    this.z = 1;
    this.tx = this.ty = 0;
    this.apply();
  }

  private zoomAt(px: number, py: number, z: number) {
    const nz = Math.min(this.max, Math.max(1, z));
    // точка под пальцем остаётся на месте
    this.tx = px - ((px - this.tx) * nz) / this.z;
    this.ty = py - ((py - this.ty) * nz) / this.z;
    this.z = nz;
    this.apply();
  }

  private apply() {
    const r = this.wrap.getBoundingClientRect();
    // доска не уходит из окна: края не отходят внутрь
    this.tx = Math.min(0, Math.max(r.width - r.width * this.z, this.tx));
    this.ty = Math.min(0, Math.max(r.height - r.height * this.z, this.ty));
    (this.target as HTMLElement).style.transform = this.z === 1 ? '' : `translate(${this.tx}px, ${this.ty}px) scale(${this.z})`;
    this.wrap.classList.toggle('bc-zoomed', this.z > 1);
    this.bar.querySelector<HTMLButtonElement>('[data-z="out"]')!.disabled = this.z <= 1;
    this.bar.querySelector<HTMLButtonElement>('[data-z="all"]')!.disabled = this.z <= 1;
    this.bar.querySelector<HTMLButtonElement>('[data-z="in"]')!.disabled = this.z >= this.max;
    this.o.changed?.(this.z);
  }

  private local(e: { clientX: number; clientY: number }) {
    const r = this.wrap.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const p = this.local(e);
    this.zoomAt(p.x, p.y, this.z * Math.exp(-e.deltaY * 0.0015));
  };

  private onDown = (e: PointerEvent) => {
    this.ptrs.set(e.pointerId, this.local(e));
    if (this.ptrs.size === 1) {
      const p = this.local(e);
      this.g = { x: p.x, y: p.y, tx: this.tx, ty: this.ty, moved: false };
    } else if (this.ptrs.size === 2) {
      const [a, b] = [...this.ptrs.values()];
      this.g = { x: 0, y: 0, tx: this.tx, ty: this.ty, moved: true, dist: Math.hypot(a.x - b.x, a.y - b.y), z: this.z, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
    }
  };

  private onMove = (e: PointerEvent) => {
    if (!this.ptrs.has(e.pointerId) || !this.g) return;
    const p = this.local(e);
    this.ptrs.set(e.pointerId, p);
    const g = this.g;
    if (this.ptrs.size >= 2 && g.dist) {
      const [a, b] = [...this.ptrs.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      const nz = Math.min(this.max, Math.max(1, (g.z! * d) / g.dist));
      // щипок: середина между пальцами ведёт доску за собой
      this.tx = cx - ((g.cx! - g.tx) * nz) / g.z!;
      this.ty = cy - ((g.cy! - g.ty) * nz) / g.z!;
      this.z = nz;
      this.apply();
      return;
    }
    if (this.z <= 1) return;
    if (!g.moved && Math.hypot(p.x - g.x, p.y - g.y) < 8) return;
    g.moved = true;
    this.tx = g.tx + p.x - g.x;
    this.ty = g.ty + p.y - g.y;
    this.apply();
  };

  private onUp = (e: PointerEvent) => {
    this.ptrs.delete(e.pointerId);
    if (this.g?.moved) this.eat = true;
    if (!this.ptrs.size) this.g = null;
    else if (this.ptrs.size === 1) {
      // отпустили один палец из двух — дальше просто сдвиг
      const [p] = [...this.ptrs.values()];
      this.g = { x: p.x, y: p.y, tx: this.tx, ty: this.ty, moved: true };
    }
  };

  /** Перетаскивание и щипок — не нажатие по доске. */
  private onClick = (e: MouseEvent) => {
    if (!this.eat) return;
    this.eat = false;
    e.stopPropagation();
    e.preventDefault();
  };
}
