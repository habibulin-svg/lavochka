/* Дворовый спорт — управление своим пацаном: направление бега (WASD / стрелки, на телефоне — виртуальный стик слева внизу)
 * и кнопки действий (клавиша + круглая кнопка справа внизу на телефоне). Игра читает pad.dir() и pad.take(имя) —
 * «нажато ли с прошлого раза» (одноразовые действия: ловить, бросить, рывок, переключиться). Без привязки к осям игры:
 * dir() — в осях экрана (x вправо, y вверх), игра сама поворачивает под камеру.
 * Нужен лапте, пекарю, чижу (бег за мячом/битой, увернуться, осалить). */
import { h } from '../util';
import './dvorsport.css';

export interface PadButton {
  /** Имя действия (take(имя)). */
  id: string;
  /** Подпись на кнопке телефона и в подсказке. */
  label: string;
  /** Клавиши (KeyboardEvent.code). */
  keys: string[];
}

export class Pad {
  private keys = new Set<string>();
  private hits = new Map<string, number>();
  private stick = { x: 0, y: 0, id: -1, cx: 0, cy: 0 };
  private off: (() => void)[] = [];
  private box: HTMLElement;
  private knob: HTMLElement | null = null;
  private btnEls = new Map<string, HTMLElement>();
  /** Можно ли сейчас управлять (своя партия, не пауза). */
  enabled = () => true;

  constructor(
    host: HTMLElement,
    private buttons: PadButton[],
  ) {
    const touch = matchMedia('(pointer: coarse)').matches;
    this.box = h(`<div class="ds-pad${touch ? ' touch' : ''}"><div class="ds-stick"><i></i></div><div class="ds-btns"></div></div>`);
    host.appendChild(this.box);
    this.knob = this.box.querySelector('.ds-stick i');
    const btns = this.box.querySelector('.ds-btns') as HTMLElement;
    for (const b of buttons) {
      const el = h(`<button class="ds-btn" data-id="${b.id}">${b.label}</button>`);
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.press(b.id);
      });
      btns.appendChild(el);
      this.btnEls.set(b.id, el);
    }
    const st = this.box.querySelector('.ds-stick') as HTMLElement;
    const sd = (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const r = st.getBoundingClientRect();
      this.stick = { x: 0, y: 0, id: e.pointerId, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
      try {
        st.setPointerCapture(e.pointerId);
      } catch {
        /* уже отпущен */
      }
      sm(e);
    };
    const sm = (e: PointerEvent) => {
      if (e.pointerId !== this.stick.id) return;
      const R = 42;
      let dx = (e.clientX - this.stick.cx) / R;
      let dy = -(e.clientY - this.stick.cy) / R;
      const l = Math.hypot(dx, dy);
      if (l > 1) (dx /= l), (dy /= l);
      this.stick.x = dx;
      this.stick.y = dy;
      if (this.knob) this.knob.style.transform = `translate(${dx * R}px, ${-dy * R}px)`;
    };
    const su = (e: PointerEvent) => {
      if (e.pointerId !== this.stick.id) return;
      this.stick = { x: 0, y: 0, id: -1, cx: 0, cy: 0 };
      if (this.knob) this.knob.style.transform = '';
    };
    st.addEventListener('pointerdown', sd);
    st.addEventListener('pointermove', sm);
    st.addEventListener('pointerup', su);
    st.addEventListener('pointercancel', su);
    const kd = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (!this.enabled()) return;
      const known = MOVE[e.code] || this.buttons.some((b) => b.keys.includes(e.code));
      if (!known) return;
      e.preventDefault();
      if (!this.keys.has(e.code)) for (const b of this.buttons) if (b.keys.includes(e.code)) this.press(b.id);
      this.keys.add(e.code);
    };
    const ku = (e: KeyboardEvent) => this.keys.delete(e.code);
    const blur = () => this.keys.clear();
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    window.addEventListener('blur', blur);
    this.off.push(() => {
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      window.removeEventListener('blur', blur);
    });
  }

  /** Нажать действие (кнопкой, клавишей или из игры — тапом по полю). */
  press(id: string) {
    if (!this.enabled()) return;
    this.hits.set(id, (this.hits.get(id) ?? 0) + 1);
  }

  /** Было ли нажато с прошлого раза (и сбросить). */
  take(id: string): boolean {
    const n = this.hits.get(id) ?? 0;
    if (n) this.hits.set(id, 0);
    return n > 0;
  }

  /** Направление в осях экрана: x вправо, y вверх, длина ≤ 1. */
  dir(): { x: number; y: number } {
    if (!this.enabled()) return { x: 0, y: 0 };
    let x = this.stick.x;
    let y = this.stick.y;
    for (const k of this.keys) {
      const m = MOVE[k];
      if (m) (x += m[0]), (y += m[1]);
    }
    const l = Math.hypot(x, y);
    return l > 1 ? { x: x / l, y: y / l } : { x, y };
  }

  /** Показать только эти кнопки (по фазе игры) и подписать их; подпись с «!» в начале — главная кнопка (красная). */
  show(ids: Record<string, string | null>) {
    for (const [id, el] of this.btnEls) {
      const lb = ids[id];
      el.style.display = lb ? '' : 'none';
      if (!lb) continue;
      const hot = lb.startsWith('!');
      const text = hot ? lb.slice(1) : lb;
      if (el.textContent !== text) el.textContent = text;
      el.classList.toggle('hot', hot);
    }
  }

  /** Стик и кнопки видны (на телефоне) — например, только в своей партии. */
  visible(on: boolean) {
    this.box.style.display = on ? '' : 'none';
  }

  dispose() {
    this.off.forEach((f) => f());
    this.box.remove();
  }
}

const MOVE: Record<string, [number, number]> = {
  KeyW: [0, 1],
  KeyS: [0, -1],
  KeyA: [-1, 0],
  KeyD: [1, 0],
  ArrowUp: [0, 1],
  ArrowDown: [0, -1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
};
