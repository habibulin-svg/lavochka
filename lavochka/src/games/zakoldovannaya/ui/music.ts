/* Музыка по настроению: дорога днём, ночь у костра, город и трактир, замок, бой, победа. Треки — public/zakoldovannaya/music
 * (CC0 и CC-BY, авторы — в титрах правил). Плавная смена, громкость и выключатель — на экране игры. */
import { store } from '../../../core/settings';
import type { View } from '../engine';
import { IMG, PREF_MUSIC } from './common';

export type Mood = 'menu' | 'road' | 'night' | 'town' | 'castle' | 'battle' | 'victory';

/** Что играть в каждом настроении (по кругу). Авторы и лицензии — tools/zakoldovannaya/music.txt и титры в правилах. */
export const TRACKS: Record<Mood, string[]> = {
  menu: ['master-of-the-feast.mp3'],
  road: ['bards-tale.mp3', 'achaidh-cheide.mp3'],
  night: ['lonely-night.ogg'],
  town: ['kings-feast.mp3', 'old-tower-inn.mp3'],
  castle: ['spellbound.mp3'],
  battle: ['medieval-battle.mp3', 'war-theme.ogg'],
  victory: ['orcs-victorious.ogg'],
};

export function moodOf(v: View): Mood {
  if (v.result) return v.result.win ? 'victory' : 'night';
  if (v.phase === 'create') return 'menu';
  if (v.combat) return 'battle';
  if (v.where.k === 'site') return v.where.site === 'forpost' || v.where.site === 'c4' || v.where.site === 'c7' || v.where.site === 'c8' ? 'town' : 'castle';
  return v.world.night ? 'night' : 'road';
}

export class Music {
  private cur: HTMLAudioElement | null = null;
  private mood: Mood | null = null;
  private i: Record<string, number> = {};
  private vol = 0.35;
  on(): boolean {
    return store.get<string>(PREF_MUSIC, 'on') !== 'off';
  }
  set(m: Mood): void {
    if (!this.on()) {
      this.stop();
      return;
    }
    if (m === this.mood && this.cur) return;
    this.mood = m;
    this.next();
  }
  private next(): void {
    const m = this.mood;
    if (!m) return;
    const list = TRACKS[m];
    const k = (this.i[m] = ((this.i[m] ?? -1) + 1) % list.length);
    const a = new Audio(`${IMG}music/${list[k]}`);
    a.volume = 0;
    a.onended = () => this.next();
    a.onerror = () => {
      /* трек ещё не положен — тишина */
    };
    const old = this.cur;
    this.cur = a;
    void a.play().catch(() => {});
    this.fade(a, this.vol, 1500);
    if (old) this.fade(old, 0, 1200, () => old.pause());
  }
  private fade(a: HTMLAudioElement, to: number, ms: number, done?: () => void): void {
    const from = a.volume;
    const t0 = performance.now();
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / ms);
      a.volume = Math.max(0, Math.min(1, from + (to - from) * k));
      if (k < 1) requestAnimationFrame(step);
      else done?.();
    };
    requestAnimationFrame(step);
  }
  stop(): void {
    if (this.cur) {
      const a = this.cur;
      this.fade(a, 0, 600, () => a.pause());
    }
    this.cur = null;
    this.mood = null;
  }
  toggle(): boolean {
    const on = !this.on();
    store.set(PREF_MUSIC, on ? 'on' : 'off');
    if (!on) this.stop();
    return on;
  }
}
