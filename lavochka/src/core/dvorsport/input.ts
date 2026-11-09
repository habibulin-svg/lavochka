/* Дворовый спорт — ввод удара/броска мышью и пальцем «рогаткой»: нажал на поле, потянул назад (вниз по экрану) —
 * чем дальше, тем сильнее; вбок — направление; отпустил — удар. Едва потянул и отпустил — отмена. Плюс шкала силы
 * у края поля (видна, пока тянешь) и подсказка «потяните и отпустите». Клавиши и геймпад — у игры (nudge). */
import { h } from '../util';
import './dvorsport.css';

export interface PullOpts {
  /** На какую долю высоты холста потянуть до полной силы. */
  span?: number;
  /** Меньше этой доли высоты — отмена. */
  cancel?: number;
  /** Можно ли сейчас тянуть (наш ход, не идёт показ). */
  enabled: () => boolean;
  /** Прицел поменялся: pow 0…1, side — сдвиг вбок в долях ширины (плюс — вправо по экрану). */
  onAim?: (pow: number, side: number) => void;
  /** Отпустил с силой: удар. */
  onRelease: (pow: number, side: number) => void;
  /** Нажал (начал тянуть). */
  onStart?: () => void;
  /** Шкала силы: подпись (по умолчанию «сила»), false — без шкалы. */
  gauge?: string | false;
}

export class PullAim {
  pow = 0;
  side = 0;
  private drag: { x: number; y: number; id: number } | null = null;
  private gauge: HTMLElement | null = null;
  private fill: HTMLElement | null = null;
  private off: (() => void)[] = [];

  /** el — холст; box — куда положить шкалу (обёртка поля, position: relative). */
  constructor(
    el: HTMLElement,
    box: HTMLElement,
    o: PullOpts,
  ) {
    if (o.gauge !== false) {
      this.gauge = h(`<div class="ds-gauge"><div class="ds-gauge-bar"><i></i></div><span>${o.gauge ?? 'сила'}</span></div>`);
      this.fill = this.gauge.querySelector('i');
      box.appendChild(this.gauge);
    }
    const span = o.span ?? 0.55;
    const cancel = o.cancel ?? 0.06;
    const down = (e: PointerEvent) => {
      if (!o.enabled()) return;
      this.drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* указатель уже отпущен — тянем без захвата */
      }
      e.preventDefault();
      o.onStart?.();
    };
    const move = (e: PointerEvent) => {
      const d = this.drag;
      if (!d || e.pointerId !== d.id) return;
      const r = el.getBoundingClientRect();
      this.pow = Math.max(0, Math.min(1, (e.clientY - d.y) / (r.height * span)));
      this.side = (e.clientX - d.x) / r.width;
      this.show(true);
      o.onAim?.(this.pow, this.side);
    };
    const up = (e: PointerEvent) => {
      const d = this.drag;
      if (!d || e.pointerId !== d.id) return;
      const r = el.getBoundingClientRect();
      const pulled = (e.clientY - d.y) / r.height;
      this.drag = null;
      this.show(false);
      if (pulled > cancel && o.enabled()) o.onRelease(this.pow, this.side);
    };
    const cancelDrag = () => {
      this.drag = null;
      this.show(false);
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', cancelDrag);
    this.off.push(() => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', cancelDrag);
    });
  }

  /** Тянет сейчас. */
  get dragging() {
    return !!this.drag;
  }

  /** Шкала силы: видна и заполнена на pow. */
  show(on: boolean, pow = this.pow) {
    if (!this.gauge || !this.fill) return;
    this.gauge.classList.toggle('on', on);
    this.fill.style.height = `${Math.round(pow * 100)}%`;
    // красная зона — перебор
    this.fill.style.background = pow > 0.9 ? '#e0452a' : pow > 0.7 ? '#f0a020' : '#7ac943';
  }

  dispose() {
    this.off.forEach((f) => f());
    this.gauge?.remove();
  }
}

/** Подсказка над полем («Потяните вниз и отпустите — удар»): on — показать. */
export function tip(box: HTMLElement, text: string): (on: boolean) => void {
  const el = h(`<div class="ds-tip">${text}</div>`);
  box.appendChild(el);
  return (on) => el.classList.toggle('on', on);
}
