/* Звук ГОПС: события мира → звуки, реплики бойцов (шесть голосовых наборов), музыка и фон темы.
 * Web Audio, файлы Opus грузятся по первому требованию. Пока ассеты не разложены в public/gops —
 * берём с выхода конвейера (как assets.ts). Громкость и панорама — от положения на карте относительно камеры. */
import { WEAPONS } from './sim/weapons';
import { type SimEvent, TICK_HZ, type World, wormById } from './sim/world';

const SFX = '/@fs/G:/temp/studio/out/gops/08-sfx/ogg/';
const ARSENAL = '/@fs/G:/temp/studio/out/gops/26-sfx-arsenal/ogg/';
/** Озвучка реплик: 32-voices — Chatterbox, 33-voices-qwen — Qwen3-TTS (выбор модели — за пользователем, STATE.md).
 * picks.json в папке — лучший дубль каждой фразы по разборчивости (studio/post/asr_score.py); без него — дубль наугад. */
const VOICES = '/@fs/G:/temp/studio/out/gops/32-voices/';
let picks: Record<string, string> | null = null;
void fetch(`${VOICES}picks.json`)
  .then((r) => (r.ok ? r.json() : null))
  .then((p) => (picks = p))
  .catch(() => {});
const MUSIC = '/@fs/G:/ai/out/studio/gops/music/';

/** Звук → папка (08 — базовые, остальное — 26-sfx-arsenal). У каждого два варианта: -1, -2. */
const BASE = new Set(['bottle-smash', 'crate-drop', 'explosion-big', 'explosion-medium', 'explosion-small', 'grenade-bounce', 'jump', 'pigeons', 'punch', 'rocket-launch', 'rope-throw', 'slingshot', 'splash', 'steps-gravel', 'timer-tick', 'wind-loop']);

/** Звук выстрела по оружию. */
const FIRE_SFX: Record<string, string> = {
  mukha: 'rocket-launch', limonka: 'throw', sling: 'slingshot', obrez: 'shotgun', makarov: 'pistol', tnt: 'fuse-hiss',
  mine: 'mine-beep', tychok: 'poke', armatura: 'bat-swing', kuryu: 'ui-click', pas: 'ui-click',
  homing: 'rocket-launch', mortar: 'mortar-fire', carbide: 'throw', korsar: 'throw', posylka: 'throw', samogon: 'holy-choir',
  kalash: 'rifle-burst', pulemet: 'machinegun', uppercut: 'punch', mawashi: 'kick', kukuruznik: 'plane-fly', pochta: 'plane-fly',
  vanna: 'bathtub-fall', kirpichi: 'bricks-fall', truba: 'pipe-burst', ponyatiya: 'scales', marshrutka: 'minibus', plita: 'slab-place',
  otboinik: 'jackhammer', payalnik: 'blowtorch', zontik: 'umbrella-open', buratino: 'soda-gulp', kedy: 'ui-select', yagga: 'can-hiss',
  ukazka: 'ui-click', tyidi: 'ui-select', ognetushitel: 'jetpack', rezinka: 'bungee', nevidimka: 'ui-select', dog: 'dog-bark',
  babka: 'grandma-steps', kozy: 'goats', pigeon: 'pigeon-flap', kite: 'throw', auger: 'drill', zapacanov: 'jump', napalm: 'plane-fly',
  holodilnik: 'throw',
};

/** Голосовые наборы (docs/gops/texts/voices.json) — по бригаде партии. */
export const VOICE_SETS = ['sipliy', 'batya', 'maloy', 'sibiryak', 'botan', 'intelligent'];

/** Сколько треков у ситуации (G:/ai/out/studio/gops/music, README там же). */
export const MUSIC_COUNT: Record<string, number> = {
  menu: 8, 'brigade-select': 3, 'battle-calm': 6, battle: 9, 'time-attack': 4, 'sudden-death': 4, victory: 6, defeat: 6,
};
/** Музыка миссии (missions.json → music) → ситуация. */
const MISSION_MUSIC: Record<string, string> = { calm: 'battle-calm', battle: 'battle', timed: 'time-attack' };
const FADE = 1.5;

/** Случайный трек ситуации, не тот же, что играл. */
export function pickTrack(kind: string, last: string): string {
  const n = MUSIC_COUNT[kind] ?? 1;
  let track = '';
  for (let i = 0; i < 6 && (!track || track === last); i++) track = `${kind}-${String(1 + Math.floor(Math.random() * n)).padStart(2, '0')}`;
  return track;
}

export class GopsAudio {
  private ctx: AudioContext | null = null;
  private out!: GainNode;
  private musicGain!: GainNode;
  private cache = new Map<string, Promise<AudioBuffer | null>>();
  private voiceBusyUntil = 0;
  private music: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  /** Музыка боя по умолчанию (у миссии — своя). */
  battleMusic = 'battle-calm';
  private musicKind = '';
  private lastTrack = '';
  private amb: AudioBufferSourceNode | null = null;
  muted = false;
  /** Камера (центр, px мира) и полуширина экрана в px мира — для громкости и панорамы. */
  view = { x: 960, y: 350, half: 960 };

  constructor(private theme: string, private voices: string[]) {
    try {
      this.muted = localStorage.getItem('gops-mute') === '1';
    } catch {
      /* без хранилища — со звуком */
    }
    const wake = () => this.ensure();
    const sig = { signal: this.off.signal };
    window.addEventListener('pointerdown', wake, sig);
    window.addEventListener('keydown', (e) => {
      wake();
      if (e.code === 'KeyM') this.toggleMute();
    }, sig);
  }

  private off = new AbortController();

  /** Конец партии: тишина и никаких слушателей. */
  dispose(): void {
    this.off.abort();
    void this.ctx?.close();
    this.ctx = null;
  }

  /** Браузер разрешает звук только после жеста пользователя. */
  private ensure(): AudioContext | null {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.out = this.ctx.createGain();
      this.out.gain.value = this.muted ? 0 : 1;
      const comp = this.ctx.createDynamicsCompressor();
      this.out.connect(comp).connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.35;
      this.musicGain.connect(this.out);
      this.startAmbience();
      this.playMusic(this.battleMusic);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  toggleMute(): void {
    this.muted = !this.muted;
    try {
      localStorage.setItem('gops-mute', this.muted ? '1' : '0');
    } catch {
      /* ничего */
    }
    if (this.ctx) this.out.gain.value = this.muted ? 0 : 1;
  }

  private load(url: string): Promise<AudioBuffer | null> {
    let p = this.cache.get(url);
    if (!p) {
      p = fetch(url)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(r.status)))
        .then((b) => this.ctx!.decodeAudioData(b))
        .catch(() => null);
      this.cache.set(url, p);
    }
    return p;
  }

  private async play(url: string, vol = 1, pan = 0, dest?: AudioNode, loop = false): Promise<AudioBufferSourceNode | null> {
    const ctx = this.ctx;
    if (!ctx || this.muted) return null;
    const buf = await this.load(url);
    if (!buf) return null;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = loop;
    const g = ctx.createGain();
    g.gain.value = vol;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    src.connect(g).connect(p).connect(dest ?? this.out);
    src.start();
    return src;
  }

  /** Звук эффекта в точке карты (x, y в px); без точки — «в ухо». */
  sfx(name: string, x?: number, y?: number, vol = 1): void {
    const url = `${BASE.has(name) ? SFX : ARSENAL}${name}-${1 + Math.floor(Math.random() * 2)}.ogg`;
    let v = vol, pan = 0;
    if (x !== undefined) {
      const dx = x - this.view.x, dy = (y ?? this.view.y) - this.view.y;
      const d = Math.hypot(dx, dy) / (this.view.half * 2.2);
      v *= Math.max(0.15, 1 - d);
      pan = dx / (this.view.half * 1.5);
    }
    void this.play(url, v, pan);
  }

  /** Реплика бойца бригады team; ситуация key — из voices.json. Реплики не накладываются. */
  voice(team: number, key: string, force = false): void {
    if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    if (!force && now < this.voiceBusyUntil) return;
    const set = this.voices[team] ?? VOICE_SETS[team % VOICE_SETS.length];
    const n = 1 + Math.floor(Math.random() * 3);
    const phrase = `${set}/${key}-${String(n).padStart(2, '0')}`;
    // лучший дубль фразы, если отобран; иначе любой из двух
    const best = picks?.[phrase]?.replace(/^.*\//, '').replace(/\.wav$/, '');
    const url = `${VOICES}${set}/ogg/${best ?? `${key}-${String(n).padStart(2, '0')}-${1 + Math.floor(Math.random() * 2)}`}.ogg`;
    this.voiceBusyUntil = now + 2.2;
    void this.play(url, 0.95);
  }

  /** Музыка миссии: calm / battle / timed. */
  setMissionMusic(m: string): void {
    this.battleMusic = MISSION_MUSIC[m] ?? 'battle-calm';
  }

  /** Сменить ситуацию: старый трек гаснет, новый нарастает (FADE с); кончился трек — следующий той же ситуации. */
  playMusic(kind: string, force = false): void {
    const ctx = this.ctx;
    if (!ctx || (this.musicKind === kind && !force)) return;
    this.musicKind = kind;
    const track = pickTrack(kind, this.lastTrack);
    this.lastTrack = track;
    const old = this.music;
    if (old) {
      const t = ctx.currentTime;
      old.gain.gain.setValueAtTime(old.gain.gain.value, t);
      old.gain.gain.linearRampToValueAtTime(0, t + FADE);
      old.src.onended = null;
      try {
        old.src.stop(t + FADE + 0.05);
      } catch {
        /* уже остановлен */
      }
      this.music = null;
    }
    const once = kind === 'victory' || kind === 'defeat';
    void this.load(`${MUSIC}${track}.ogg`).then((buf) => {
      if (!buf || this.ctx !== ctx || this.musicKind !== kind) return;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(1, ctx.currentTime + (old ? FADE : 0.3));
      src.connect(gain).connect(this.musicGain);
      src.start();
      // трек кончился — следующий той же ситуации (победа и поражение — один раз)
      if (!once) src.onended = () => this.music?.src === src && this.playMusic(kind, true);
      this.music = { src, gain };
    });
  }

  private startAmbience(): void {
    void this.play(`${ARSENAL}amb-${this.theme}-1.ogg`, 0.25, 0, this.out, true).then((s) => (this.amb = s));
  }

  /** События кадра мира → звуки и реплики. human — бригады людей (для победы/поражения). */
  onEvents(w: World, evs: SimEvent[]): void {
    if (!this.ctx) return;
    for (const e of evs) {
      switch (e.t) {
        case 'turn':
          this.sfx('ui-turn', undefined, undefined, 0.6);
          this.voice(e.team, 'turn_start');
          break;
        case 'buff':
          this.sfx(FIRE_SFX[e.weapon] ?? 'ui-click');
          break;
        case 'freeze':
          this.sfx('freeze', e.x, e.y);
          break;
        case 'fire': {
          const a = wormById(w, e.worm);
          const def = WEAPONS[e.weapon];
          // очередь: звук очереди — один раз, на первом выстреле
          if (def?.auto && w.shots < (def.shots ?? 1) - 1) break;
          this.sfx(FIRE_SFX[e.weapon] ?? 'throw', a && a.x / 256, a && a.y / 256);
          const kind = WEAPONS[e.weapon]?.kind;
          if (a && kind === 'grenade') this.voice(a.team, 'throw');
          else if (a && kind === 'skip') this.voice(a.team, 'skip', true);
          else if (a && kind === 'surrender') this.voice(a.team, 'surrender', true);
          else if (a && Math.random() < 0.4) this.voice(a.team, 'fire');
          break;
        }
        case 'explode':
          this.sfx(e.r >= 60 ? 'explosion-big' : e.r >= 40 ? 'explosion-medium' : 'explosion-small', e.x, e.y);
          break;
        case 'shot':
          break;
        case 'bounce': {
          const p = w.projs.find((q) => q.id === e.proj);
          if (p) this.sfx('grenade-bounce', p.x / 256, p.y / 256, 0.6);
          break;
        }
        case 'hit': {
          const v = wormById(w, e.worm);
          if (!v) break;
          const shooter = wormById(w, w.active);
          // кто попал — радуется или огорчается, кому попало — ойкает (по очереди, не наложением)
          if (shooter && shooter.team !== v.team) this.voice(shooter.team, 'hit_enemy');
          else if (shooter && shooter.id !== v.id) this.voice(shooter.team, 'hit_friend');
          else if (shooter && shooter.id === v.id && e.dmg > 10) this.voice(v.team, 'self_blow');
          this.voiceSoon(v.team, e.dmg >= 30 ? 'hurt_big' : 'hurt');
          break;
        }
        case 'splash':
          this.sfx('splash', e.x, w.waterY);
          break;
        case 'drown': {
          const v = wormById(w, e.worm);
          if (v) {
            this.sfx('drown', v.x / 256, w.waterY);
            this.voice(v.team, 'drown', true);
          }
          break;
        }
        case 'deflate': {
          const v = wormById(w, e.worm);
          if (v) {
            this.sfx('deflate', v.x / 256, v.y / 256);
            this.voice(v.team, 'deflate', true);
          }
          break;
        }
        case 'rope': {
          this.sfx('rope-throw', e.x, e.y, 0.8);
          const a = wormById(w, w.active);
          if (a && Math.random() < 0.3) this.voice(a.team, 'rope');
          break;
        }
        case 'crate-drop':
          this.sfx('parachute', e.x, 0, 0.7);
          break;
        case 'crate': {
          const v = wormById(w, e.worm);
          this.sfx(e.kind === 'health' ? 'health-pickup' : 'crate-open', v && v.x / 256, v && v.y / 256);
          if (v) this.voice(v.team, e.kind === 'health' ? 'heal' : 'see_crate');
          break;
        }
        case 'rise':
          this.sfx('water-rise', undefined, undefined, 0.8);
          this.playMusic('sudden-death');
          break;
        case 'over':
          if (this.amb) this.amb.stop();
          this.playMusic(e.winner >= 0 && this.humans.includes(e.winner) ? 'victory' : this.humans.length ? 'defeat' : 'victory');
          if (e.winner >= 0) this.voice(e.winner, 'win', true);
          break;
      }
    }
    // последние 5 секунд хода — тиканье и «время!»
    if (w.phase === 'turn' && w.left <= 5 * TICK_HZ && w.left % TICK_HZ === 0 && w.left > 0) {
      this.sfx('timer-tick', undefined, undefined, 0.5);
      if (w.left === 5 * TICK_HZ) this.voice(w.team, 'time_low');
    }
  }

  /** Бригады, за которые играют люди на этом устройстве. */
  humans: number[] = [];

  private pending: ReturnType<typeof setTimeout> | null = null;

  /** «Ой» пострадавшего — чуть позже реплики стрелявшего. */
  private voiceSoon(team: number, key: string): void {
    if (this.pending) clearTimeout(this.pending);
    this.pending = setTimeout(() => this.voice(team, key, true), 900);
  }
}
