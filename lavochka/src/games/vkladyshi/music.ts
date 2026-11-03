/* «Вкладыши»: музыка — «магнитофон во дворе», песни YuE2 в духе 90-х (studio/jobs/vkladyshi/03-music.yaml →
 * public/vkladyshi/a/music/*.ogg, список — list.json). По кругу в случайном порядке, плавная смена; выключатель ♪ запоминается. */
import { store } from '../../core/settings';

const DIR = '/vkladyshi/a/music/';
export const PREF_MUSIC = 'vk.music';

let list: Promise<string[]> | null = null;
const tracks = () => (list ??= fetch(`${DIR}list.json`).then((r) => (r.ok ? r.json() : [])).catch(() => []));

export class Music {
  private cur: HTMLAudioElement | null = null;
  private queue: string[] = [];
  private vol = 0.28;
  private playing = false;
  on(): boolean {
    return store.get<string>(PREF_MUSIC, 'on') !== 'off';
  }
  play(): void {
    if (!this.on() || this.playing) return;
    this.playing = true;
    void this.next();
  }
  private async next(): Promise<void> {
    if (!this.playing) return;
    if (!this.queue.length) this.queue = [...(await tracks())].sort(() => Math.random() - 0.5);
    const t = this.queue.shift();
    if (!t || !this.playing) return;
    const a = new Audio(`${DIR}${t}`);
    a.volume = 0;
    a.onended = () => void this.next();
    const old = this.cur;
    this.cur = a;
    void a.play().catch(() => {
      // браузер не дал играть без нажатия — начнём по первому касанию
      const go = () => {
        document.removeEventListener('pointerdown', go);
        if (this.cur === a && this.playing) void a.play().catch(() => {});
      };
      document.addEventListener('pointerdown', go);
    });
    fade(a, this.vol, 2000);
    if (old) fade(old, 0, 1500, () => old.pause());
  }
  stop(): void {
    this.playing = false;
    const a = this.cur;
    if (a) fade(a, 0, 600, () => a.pause());
    this.cur = null;
  }
  toggle(): boolean {
    const on = !this.on();
    store.set(PREF_MUSIC, on ? 'on' : 'off');
    if (on) this.play();
    else this.stop();
    return on;
  }
}

/** Плавно к громкости to на таймере (в фоновой вкладке кадров нет). */
function fade(a: HTMLAudioElement, to: number, ms: number, done?: () => void) {
  const from = a.volume;
  const t0 = performance.now();
  const id = window.setInterval(() => {
    const k = Math.min(1, (performance.now() - t0) / ms);
    a.volume = Math.max(0, Math.min(1, from + (to - from) * k));
    if (k < 1) return;
    clearInterval(id);
    done?.();
  }, 40);
}
