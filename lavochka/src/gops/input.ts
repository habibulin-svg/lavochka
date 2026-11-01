/* Ввод человека → Input кадра. Клавиши как в жанре: ←/→ — идти, ↑/↓ — прицел, Enter — прыжок,
 * Backspace — сальто назад, пробел — огонь (держать — сила), 1–5 — таймер гранаты.
 * Разовые нажатия (прыжок, смена оружия, таймер) копятся и уходят в ближайший кадр. */
import type { Input } from './sim/world';

export class Controls {
  private held = new Set<string>();
  private once: Input = {};
  /** Огонь с экранной кнопки/тача (держат пальцем). */
  touchFire = false;
  touchMove: -1 | 0 | 1 = 0;
  touchAim: -1 | 0 | 1 = 0;
  onMenu: () => void = () => {};

  private off = new AbortController();

  constructor(target: Window = window) {
    const sig = { signal: this.off.signal };
    target.addEventListener('keydown', (e) => {
      // печатают в чате — это не управление
      if ((e.target as HTMLElement | null)?.closest?.('input, textarea')) return;
      if (e.repeat && e.code !== 'Space') return;
      const k = e.code;
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'Tab', 'Enter', 'Backspace'].includes(k)) e.preventDefault();
      this.held.add(k);
      if (k === 'Enter') this.once.jump = 1;
      else if (k === 'Backspace') this.once.jump = 2;
      else if (k === 'Tab') this.onMenu();
      else if (/^Digit[1-5]$/.test(k)) this.once.fuse = Number(k.slice(5));
    }, sig);
    target.addEventListener('keyup', (e) => this.held.delete(e.code), sig);
    target.addEventListener('blur', () => this.held.clear(), sig);
  }

  dispose(): void {
    this.off.abort();
  }

  /** Точка на карте (px мира) — для наводки, авиаудара, маршрутки, плиты. */
  setTarget(x: number, y: number): void {
    this.once.target = [Math.round(x), Math.round(y)];
  }

  selectWeapon(id: string): void {
    this.once.weapon = id;
  }

  jump(back = false): void {
    this.once.jump = back ? 2 : 1;
  }

  /** Ввод на этот кадр; разовые нажатия сбрасываются. */
  take(): Input {
    const h = this.held;
    const move = (h.has('ArrowRight') ? 1 : 0) - (h.has('ArrowLeft') ? 1 : 0) || this.touchMove;
    const aim = (h.has('ArrowDown') ? 1 : 0) - (h.has('ArrowUp') ? 1 : 0) || this.touchAim;
    const inp: Input = { ...this.once, move: move as -1 | 0 | 1, aim: aim as -1 | 0 | 1, fire: h.has('Space') || this.touchFire };
    this.once = {};
    return inp;
  }
}
