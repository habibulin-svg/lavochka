// Lavochka Music Studio — звук: WebAudio, планировщик на опережение по тактам, дорожки (громкость, панорама, mute/solo),
// петля, прослушивание из библиотеки, экспорт в WAV (OfflineAudioContext — тем же графом).
import { KitIndex, blockBars, songEnd, type Block, type Kit, type KitSample, type Project } from './project';

const AHEAD = 0.2; // с
const TICK = 25; // мс

export function sampleUrl(kit: Kit, bpm: number, s: KitSample): string {
  return `/music-studio/${kit.id}/${bpm}/${s.group}/${s.id}.ogg`;
}

interface Voice {
  src: AudioBufferSourceNode;
  block: number;
  end: number;
}

interface Graph {
  master: GainNode;
  tracks: { gain: GainNode; pan: StereoPannerNode }[];
}

function buildGraph(ctx: BaseAudioContext, p: Project): Graph {
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -6;
  comp.knee.value = 6;
  comp.ratio.value = 8;
  comp.attack.value = 0.003;
  comp.release.value = 0.15;
  comp.connect(ctx.destination);
  const master = ctx.createGain();
  master.connect(comp);
  const tracks = p.tracks.map(() => {
    const gain = ctx.createGain();
    const pan = ctx.createStereoPanner();
    gain.connect(pan).connect(master);
    return { gain, pan };
  });
  return { master, tracks };
}

function applyMix(g: Graph, p: Project, at = 0): void {
  const solo = p.tracks.some(t => t.solo);
  g.master.gain.setTargetAtTime(p.master, at, 0.01);
  p.tracks.forEach((t, i) => {
    const on = !t.mute && (!solo || t.solo);
    g.tracks[i].gain.gain.setTargetAtTime(on ? t.vol : 0, at, 0.01);
    g.tracks[i].pan.pan.setTargetAtTime(t.pan, at, 0.01);
  });
}

export class Engine {
  readonly ix: KitIndex;
  private ctx: AudioContext | null = null;
  private g: Graph | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private loading = new Map<string, Promise<AudioBuffer | null>>();
  private voices: Voice[] = [];
  private timer = 0;
  private t0 = 0; // время такта 0 текущего прохода
  private nextBar = 0;
  private segStart = 0; // такт, с которого начался проход (старт или возврат петли)
  private preview: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  playing = false;
  onStop: (() => void) | null = null;

  constructor(readonly kit: Kit, private p: Project) {
    this.ix = new KitIndex(kit);
  }

  setProject(p: Project): void {
    this.stop();
    this.p = p;
    if (this.ctx) {
      this.g = buildGraph(this.ctx, p);
      applyMix(this.g, p);
    }
  }

  get barSec(): number {
    return 240 / this.p.bpm;
  }

  private audio(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
      this.g = buildGraph(this.ctx, this.p);
      applyMix(this.g, this.p);
    }
    if (this.ctx.state !== 'running') void this.ctx.resume();
    return this.ctx;
  }

  key(s: KitSample, bpm = this.p.bpm): string {
    return `${bpm}/${s.id}`;
  }

  load(s: KitSample, bpm = this.p.bpm): Promise<AudioBuffer | null> {
    const k = this.key(s, bpm);
    const have = this.buffers.get(k);
    if (have) return Promise.resolve(have);
    let pr = this.loading.get(k);
    if (!pr) {
      const ctx = this.audio();
      pr = fetch(sampleUrl(this.kit, bpm, s))
        .then(r => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${r.status}`))))
        .then(b => ctx.decodeAudioData(b))
        .then(buf => {
          this.buffers.set(k, buf);
          return buf;
        })
        .catch(e => {
          console.warn('сэмпл не загрузился', s.id, e);
          this.loading.delete(k);
          return null;
        });
      this.loading.set(k, pr);
    }
    return pr;
  }

  /** Загрузить всё, что стоит в проекте (перед игрой и экспортом). */
  async preload(onProgress?: (done: number, total: number) => void): Promise<void> {
    const ids = [...new Set(this.p.blocks.map(b => b.sample))];
    let done = 0;
    await Promise.all(ids.map(async id => {
      const s = this.ix.get(id);
      if (s) await this.load(s);
      onProgress?.(++done, ids.length);
    }));
  }

  mix(): void {
    if (this.g && this.ctx) applyMix(this.g, this.p, this.ctx.currentTime);
  }

  /** Текущий такт (дробный) или null, если стоим. */
  position(): number | null {
    if (!this.playing || !this.ctx) return null;
    const pos = (this.ctx.currentTime - this.t0) / this.barSec;
    return Math.max(this.segStart, pos);
  }

  private segEnd(): number {
    const lp = this.p.loop;
    return lp ? lp.to : Math.max(songEnd(this.p, this.ix), 1);
  }

  play(fromBar = 0): void {
    const ctx = this.audio();
    this.stop();
    this.stopPreview();
    const lp = this.p.loop;
    if (lp && (fromBar < lp.from || fromBar >= lp.to)) fromBar = lp.from;
    this.playing = true;
    this.segStart = this.nextBar = Math.floor(fromBar);
    this.t0 = ctx.currentTime + 0.08 - this.nextBar * this.barSec;
    this.tick();
    this.timer = window.setInterval(() => this.tick(), TICK);
  }

  stop(): void {
    window.clearInterval(this.timer);
    this.timer = 0;
    const now = this.ctx?.currentTime ?? 0;
    for (const v of this.voices) this.fadeOut(v.src, now);
    this.voices = [];
    if (this.playing) {
      this.playing = false;
      this.onStop?.();
    }
  }

  private fadeOut(src: AudioBufferSourceNode, now: number): void {
    try {
      const g = (src as AudioBufferSourceNode & { _g?: GainNode })._g;
      if (g) g.gain.setTargetAtTime(0, now, 0.01);
      src.stop(now + 0.06);
    } catch {
      /* уже остановлен */
    }
  }

  private start(b: Block, s: KitSample, when: number, offsetBars: number, untilBar: number, barTime: (bar: number) => number): void {
    if (!this.ctx || !this.g) return;
    const buf = this.buffers.get(this.key(s));
    if (!buf) {
      void this.load(s); // догрузится — заиграет со следующего прохода
      return;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    src.connect(g).connect(this.g.tracks[b.track].gain);
    (src as AudioBufferSourceNode & { _g?: GainNode })._g = g;
    const off = offsetBars * this.barSec;
    const end = barTime(untilBar);
    const dur = Math.max(0, end - when);
    if (off > 0) {
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(1, when + 0.01);
    }
    src.start(when, off, Math.min(dur, buf.duration - off));
    src.onended = () => {
      this.voices = this.voices.filter(v => v.src !== src);
    };
    this.voices.push({ src, block: b.id, end });
  }

  private tick(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const barTime = (bar: number) => this.t0 + bar * this.barSec;
    while (barTime(this.nextBar) < now + AHEAD) {
      const bar = this.nextBar;
      const end = this.segEnd();
      if (bar >= end) {
        if (this.p.loop) {
          // петля: тот же отсчёт времени, такт loop.from встаёт на место loop.to
          this.t0 += (this.p.loop.to - this.p.loop.from) * this.barSec;
          this.segStart = this.nextBar = this.p.loop.from;
          continue;
        }
        const stopAt = barTime(bar);
        window.clearInterval(this.timer);
        window.setTimeout(() => this.stop(), Math.max(0, (stopAt - now) * 1000) + 50);
        return;
      }
      for (const b of this.p.blocks) {
        const s = this.ix.get(b.sample);
        if (!s) continue;
        const bEnd = b.bar + s.bars;
        const starts = b.bar === bar || (bar === this.segStart && b.bar < bar && bar < bEnd);
        if (!starts) continue;
        this.start(b, s, barTime(bar), bar - b.bar, Math.min(bEnd, end), barTime);
      }
      this.nextBar++;
    }
  }

  /** Проект поменялся во время игры: заглушить блоки, которых больше нет на месте, и подхватить новые с текущего такта. */
  resync(): void {
    if (!this.playing || !this.ctx) return;
    const now = this.ctx.currentTime;
    const pos = this.position() ?? 0;
    const barTime = (bar: number) => this.t0 + bar * this.barSec;
    const alive = new Set<number>();
    for (const v of [...this.voices]) {
      const b = this.p.blocks.find(x => x.id === v.block);
      const ok = b && b.bar <= pos && pos < b.bar + blockBars(this.ix, b);
      if (!ok) {
        this.fadeOut(v.src, now);
        this.voices = this.voices.filter(x => x !== v);
      } else alive.add(v.block);
    }
    // уже запланированные такты (до nextBar) для новых блоков — начать сейчас с нужного места
    const end = this.segEnd();
    for (const b of this.p.blocks) {
      if (alive.has(b.id)) continue;
      const s = this.ix.get(b.sample);
      if (!s) continue;
      const when = now + 0.03;
      const at = (when - this.t0) / this.barSec;
      if (b.bar <= at && at < b.bar + s.bars && b.bar < this.nextBar) {
        this.start(b, s, when, at - b.bar, Math.min(b.bar + s.bars, end), barTime);
      }
    }
  }

  /** Прослушать сэмпл из библиотеки: если идёт песня — с ближайшей доли и в такт, иначе сразу. */
  async previewSample(s: KitSample): Promise<void> {
    const ctx = this.audio();
    const buf = await this.load(s);
    if (!buf) return;
    this.stopPreview();
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gain = ctx.createGain();
    gain.gain.value = 0.9;
    src.connect(gain).connect(this.g!.master);
    let when = ctx.currentTime + 0.02;
    if (this.playing) {
      const beat = this.barSec / 4;
      when = this.t0 + Math.ceil((when - this.t0) / beat) * beat;
    }
    src.start(when, 0, s.bars * this.barSec);
    src.onended = () => {
      if (this.preview?.src === src) this.preview = null;
    };
    this.preview = { src, gain };
  }

  stopPreview(): void {
    if (!this.preview || !this.ctx) return;
    this.preview.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.01);
    try {
      this.preview.src.stop(this.ctx.currentTime + 0.05);
    } catch {
      /* */
    }
    this.preview = null;
  }

  /** Свести песню в WAV (16 бит, 44,1 кГц, стерео). */
  async exportWav(onProgress?: (k: number) => void): Promise<Blob> {
    await this.preload((d, t) => onProgress?.(0.5 * d / t));
    const bars = Math.max(1, songEnd(this.p, this.ix));
    const sr = 44100;
    const len = Math.ceil((bars * this.barSec + 0.5) * sr);
    const off = new OfflineAudioContext(2, len, sr);
    const g = buildGraph(off, this.p);
    applyMix(g, this.p);
    for (const b of this.p.blocks) {
      const s = this.ix.get(b.sample);
      const buf = s && this.buffers.get(this.key(s));
      if (!s || !buf) continue;
      const src = off.createBufferSource();
      src.buffer = buf;
      src.connect(g.tracks[b.track].gain);
      src.start(b.bar * this.barSec, 0, Math.min(buf.duration, s.bars * this.barSec));
    }
    onProgress?.(0.6);
    const out = await off.startRendering();
    onProgress?.(1);
    return wav(out);
  }

  close(): void {
    this.stop();
    void this.ctx?.close();
    this.ctx = null;
  }
}

export function wav(b: AudioBuffer): Blob {
  const n = b.length;
  const ch = b.numberOfChannels;
  const data = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const str = (o: number, s: string) => [...s].forEach((c, i) => data.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  data.setUint32(4, 36 + n * ch * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  data.setUint32(16, 16, true);
  data.setUint16(20, 1, true);
  data.setUint16(22, ch, true);
  data.setUint32(24, b.sampleRate, true);
  data.setUint32(28, b.sampleRate * ch * 2, true);
  data.setUint16(32, ch * 2, true);
  data.setUint16(34, 16, true);
  str(36, 'data');
  data.setUint32(40, n * ch * 2, true);
  const chans = Array.from({ length: ch }, (_, i) => b.getChannelData(i));
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const v = Math.max(-1, Math.min(1, chans[c][i]));
      data.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      o += 2;
    }
  }
  return new Blob([data], { type: 'audio/wav' });
}
