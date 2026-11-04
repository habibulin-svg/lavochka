/* Звук «Героев»: музыка по ситуациям с перекрёстным затуханием (PIPELINE.md §6, п. 9) и короткие звуки через Web Audio.
 * ♪ — только музыка, M — весь звук; оба запоминаются. Браузер даёт звук только после жеста — до него молчим. */
const BASE = '/geroi/a';
const MUSIC_KEY = 'geroi-music-off';
const MUTE_KEY = 'geroi-mute';
const VOL = 0.32;
const FADE_MS = 1400;

const read = (k: string): boolean => {
  try {
    return localStorage.getItem(k) === '1';
  } catch {
    return false;
  }
};
const write = (k: string, on: boolean): void => {
  try {
    localStorage.setItem(k, on ? '1' : '0');
  } catch {
    /* хранилище закрыто — живём без памяти */
  }
};

export type Situation = 'menu' | 'battle' | 'victory' | 'defeat';
const TRACKS: Record<Situation, string[]> = {
  menu: ['menu', 'menu-vox'],
  battle: ['battle', 'battle-b', 'battle-c'],
  victory: ['victory'],
  defeat: ['defeat'],
};
const SINGLE: Situation[] = ['victory', 'defeat'];

export class Audio2 {
  musicOff = read(MUSIC_KEY);
  muted = read(MUTE_KEY);
  private ctx: AudioContext | null = null;
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private el: HTMLAudioElement | null = null;
  private want: Situation | null = null;
  private last = '';

  constructor() {
    const wake = (): void => {
      this.ctx?.resume().catch(() => {});
      if (this.want && !this.el) this.next();
    };
    window.addEventListener('pointerdown', wake);
    window.addEventListener('keydown', wake);
  }

  /** Сменить музыку; та же ситуация — трек играет дальше. */
  music(sit: Situation | null): void {
    if (sit === this.want) return;
    this.want = sit;
    this.fadeOut();
    if (sit) this.next();
  }

  private fadeOut(): void {
    const el = this.el;
    this.el = null;
    if (!el) return;
    const from = el.volume;
    const t0 = performance.now();
    const id = window.setInterval(() => {
      const k = (performance.now() - t0) / FADE_MS;
      if (k >= 1) {
        clearInterval(id);
        el.pause();
      } else el.volume = from * (1 - k);
    }, 50);
  }

  private next(): void {
    if (!this.want || this.musicOff || this.muted) return;
    const list = TRACKS[this.want].filter((t) => t !== this.last || TRACKS[this.want!].length === 1);
    const name = list[Math.floor(Math.random() * list.length)];
    this.last = name;
    const el = new Audio(`${BASE}/music/${name}.ogg`);
    el.volume = 0;
    const sit = this.want;
    el.onended = () => {
      if (this.el !== el) return;
      this.el = null;
      if (!SINGLE.includes(sit)) this.next();
    };
    this.el = el;
    void el.play().then(() => {
      if (this.el !== el) return el.pause();
      const t0 = performance.now();
      const id = window.setInterval(() => {
        const k = (performance.now() - t0) / FADE_MS;
        el.volume = Math.min(VOL, VOL * k);
        if (k >= 1 || this.el !== el) clearInterval(id);
      }, 50);
    }).catch(() => {
      // жеста ещё не было — дождёмся
      if (this.el === el) this.el = null;
    });
  }

  toggleMusic(): boolean {
    this.musicOff = !this.musicOff;
    write(MUSIC_KEY, this.musicOff);
    if (this.musicOff) this.fadeOut();
    else if (this.want && !this.el) this.next();
    return this.musicOff;
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    write(MUTE_KEY, this.muted);
    if (this.muted) this.fadeOut();
    else if (this.want && !this.el) this.next();
    return this.muted;
  }

  private buffer(name: string): Promise<AudioBuffer | null> {
    let b = this.buffers.get(name);
    if (!b) {
      this.ctx ??= new AudioContext();
      const ctx = this.ctx;
      b = fetch(`${BASE}/sfx/${name}.ogg`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(name))))
        .then((a) => ctx.decodeAudioData(a))
        .catch(() => null);
      this.buffers.set(name, b);
    }
    return b;
  }

  sfx(name: string | undefined, vol = 0.7): void {
    if (!name || this.muted) return;
    void this.buffer(name).then((b) => {
      const ctx = this.ctx;
      if (!b || !ctx || ctx.state !== 'running') return;
      const src = ctx.createBufferSource();
      const gain = ctx.createGain();
      gain.gain.value = vol;
      src.buffer = b;
      src.connect(gain).connect(ctx.destination);
      src.start();
    });
  }

  stop(): void {
    this.music(null);
  }
}
