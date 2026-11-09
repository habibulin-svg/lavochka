/* Дворовый спорт — музыка двора отдельно от звуков (CLAUDE.md: выключатель музыки, запоминается). 🔊 стола глушит всё,
 * ♪ — только музыку. Треки идут по кругу; пока вкладка скрыта, партия окончена или это показ правил — тишина.
 * Пауза (Esc и кнопка ☰), «?» (GameModule.help), сохранение/загрузка (GameView.saveTitle) — общие у стола core/table.ts,
 * игре на наборе нужно только заполнить help и saveTitle.
 * Музыка — необязательная часть набора: в лапте, пекаре и чиже её нет (решение пользователя 2026-11-09 — только звуки). */
import { segRow } from '../rtview';
import { onSettings, settings, store } from '../settings';

/** Треки двора (public/gorodki/music/<имя>.ogg, CC0/CC-BY — studio). */
export const DVOR_TRACKS = ['match', 'dvor'];

export class DvorMusic {
  private el: HTMLAudioElement | null = null;
  private track = 0;
  private off: (() => void)[] = [];

  /** pref — ключ настройки (у каждой игры свой: «gorodki.music»); want — играть ли сейчас (не показ, партия идёт). */
  constructor(
    private pref: string,
    private want: () => boolean,
    private tracks = DVOR_TRACKS,
    private base = `${import.meta.env.BASE_URL}gorodki/music/`,
    private volume = 0.3,
  ) {
    const vis = () => this.sync();
    document.addEventListener('visibilitychange', vis);
    this.off.push(() => document.removeEventListener('visibilitychange', vis));
    const o = onSettings(vis);
    if (typeof o === 'function') this.off.push(o);
  }

  get on() {
    return store.get<string>(this.pref, 'on') !== 'off';
  }

  set on(v: boolean) {
    store.set(this.pref, v ? 'on' : 'off');
    this.sync();
  }

  sync() {
    const want = this.on && settings.sound && !document.hidden && this.want();
    if (!want) {
      this.el?.pause();
      return;
    }
    if (!this.el) {
      this.el = new Audio(`${this.base}${this.tracks[this.track % this.tracks.length]}.ogg`);
      this.el.volume = this.volume;
      this.el.onended = () => {
        this.track++;
        this.el = null;
        this.sync();
      };
    }
    if (this.el.paused) void this.el.play().catch(() => {});
  }

  /** Ряд «♪ Музыка: вкл/выкл» для панели под полем. */
  row(): HTMLElement {
    return segRow(
      '♪ Музыка',
      [
        ['on', 'вкл'],
        ['off', 'выкл'],
      ],
      () => (this.on ? 'on' : 'off'),
      (x) => (this.on = x === 'on'),
    );
  }

  dispose() {
    this.off.forEach((f) => f());
    this.el?.pause();
    this.el = null;
  }
}
