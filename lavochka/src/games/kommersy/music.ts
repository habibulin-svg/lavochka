/* «Коммерсы»: музыка по эпохам — песни YuE2 в духе попсы своих лет (docs/kommersy/MUSIC.md), по два варианта каждой.
 * Эпоха — по году пути: синти-поп 88-го, евро-диско 90-го, евродэнс, эстрада, поп-рок, нулевые; клуб куплен — «Лондонский туман».
 * Плавная смена, внутри эпохи — по кругу в случайном порядке; выключатель запоминается. */
import { store } from '../../core/settings';
import { yearOf } from './data';
import type { View } from './engine';

const DIR = '/kommersy/a/music/';
export const PREF_MUSIC = 'km.music';

export type Era = 'y88' | 'y90' | 'y93' | 'y96' | 'y99' | 'y02' | 'london';

/** Песни эпохи; у каждой два варианта (сиды 11 и 22). */
const SONGS: Record<Era, string[]> = {
  y88: ['y88-1', 'y88-2', 'y88-3'],
  y90: ['y90-1', 'y90-2', 'y90-3'],
  y93: ['y93-1', 'y93-2', 'y93-3'],
  y96: ['y96-1', 'y96-2', 'y96-3'],
  y99: ['y99-1', 'y99-2'],
  y02: ['y02-1'],
  london: ['london-1'],
};
const TRACKS = Object.fromEntries(Object.entries(SONGS).map(([e, l]) => [e, l.flatMap((s) => [`${s}-11`, `${s}-22`])])) as Record<Era, string[]>;

export function eraMusic(v: View): Era {
  if (v.players.some((p) => p.club)) return 'london';
  const y = yearOf(v.m);
  return y >= 2001 ? 'y02' : y >= 1998 ? 'y99' : y >= 1995 ? 'y96' : y >= 1992 ? 'y93' : y >= 1990 ? 'y90' : 'y88';
}

export class Music {
  private cur: HTMLAudioElement | null = null;
  private era: Era | null = null;
  private queue: string[] = [];
  private vol = 0.3;
  private blocked = false;
  private fades = new Map<HTMLAudioElement, number>();
  on(): boolean {
    return store.get<string>(PREF_MUSIC, 'on') !== 'off';
  }
  set(e: Era): void {
    if (!this.on()) {
      this.stop();
      return;
    }
    if (e === this.era && this.cur && !this.blocked) return; // браузер не дал играть до первого нажатия — пробуем снова
    this.era = e;
    this.queue = [];
    this.next();
  }
  private next(): void {
    const e = this.era;
    if (!e) return;
    if (!this.queue.length) this.queue = [...TRACKS[e]].sort(() => Math.random() - 0.5);
    const a = new Audio(`${DIR}${this.queue.shift()}.ogg`);
    a.volume = 0;
    a.onended = () => this.next();
    const old = this.cur;
    this.cur = a;
    this.blocked = false;
    void a.play().catch(() => {
      if (this.cur === a) this.blocked = true;
    });
    this.fade(a, this.vol, 2000);
    if (old) this.fade(old, 0, 1500, () => old.pause());
  }
  /** Плавно к громкости to; на таймере, а не на кадрах: в фоновой вкладке кадров нет, и трек не останавливался. */
  private fade(a: HTMLAudioElement, to: number, ms: number, done?: () => void): void {
    clearInterval(this.fades.get(a));
    const from = a.volume;
    const t0 = performance.now();
    const id = window.setInterval(() => {
      const k = Math.min(1, (performance.now() - t0) / ms);
      a.volume = Math.max(0, Math.min(1, from + (to - from) * k));
      if (k < 1) return;
      clearInterval(id);
      this.fades.delete(a);
      done?.();
    }, 40);
    this.fades.set(a, id);
  }
  stop(): void {
    if (this.cur) {
      const a = this.cur;
      this.fade(a, 0, 600, () => a.pause());
    }
    this.cur = null;
    this.era = null;
  }
  toggle(): boolean {
    const on = !this.on();
    store.set(PREF_MUSIC, on ? 'on' : 'off');
    if (!on) this.stop();
    return on;
  }
}
