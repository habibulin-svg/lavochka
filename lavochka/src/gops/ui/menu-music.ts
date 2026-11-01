/* Музыка меню ГОПС: случайный трек «menu», по окончании — следующий (без повтора подряд), плавное включение и выключение.
 * Браузер даёт звук только после жеста — до первого щелчка/клавиши молчим. M в бою — общий выключатель (gops-mute). */
import { MUSIC_COUNT, pickTrack } from '../audio';

const MUSIC = '/@fs/G:/ai/out/studio/gops/music/';
const VOL = 0.35;

export class MenuMusic {
  private el: HTMLAudioElement | null = null;
  private last = '';
  private want = false;
  private fade = 0;

  constructor() {
    const wake = () => {
      if (this.want && !this.el) this.next();
    };
    window.addEventListener('pointerdown', wake);
    window.addEventListener('keydown', wake);
  }

  private muted(): boolean {
    try {
      return localStorage.getItem('gops-mute') === '1';
    } catch {
      return false;
    }
  }

  private next(): void {
    if (!this.want || this.muted() || !MUSIC_COUNT.menu) return;
    this.last = pickTrack('menu', this.last);
    const el = new Audio(`${MUSIC}${this.last}.ogg`);
    el.volume = 0;
    el.onended = () => {
      if (this.el === el) {
        this.el = null;
        this.next();
      }
    };
    this.el = el;
    void el.play().then(() => this.ramp(el, VOL)).catch(() => {
      // жеста ещё не было — дождёмся
      if (this.el === el) this.el = null;
    });
  }

  private ramp(el: HTMLAudioElement, to: number, then?: () => void): void {
    clearInterval(this.fade);
    this.fade = window.setInterval(() => {
      const v = el.volume + (to > el.volume ? 0.02 : -0.03);
      el.volume = Math.max(0, Math.min(VOL, v));
      if ((to > 0 && el.volume >= to) || (to === 0 && el.volume <= 0)) {
        clearInterval(this.fade);
        then?.();
      }
    }, 40);
  }

  start(): void {
    this.want = true;
    if (!this.el) this.next();
  }

  stop(): void {
    this.want = false;
    const el = this.el;
    this.el = null;
    if (el) this.ramp(el, 0, () => el.pause());
  }
}
