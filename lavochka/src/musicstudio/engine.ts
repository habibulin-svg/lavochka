// Lavochka Music Studio — звук: WebAudio, планировщик на опережение по тактам, дорожки (громкость, панорама, mute/solo,
// эффекты: фильтр, эхо в такт, реверб), петля, прослушивание из библиотеки, свои грувы, сведение
// (OfflineAudioContext тем же графом) в OGG (WebCodecs Opus + ogg.ts) или, если браузер не умеет, в WAV.
import { muxOggOpus } from './ogg';
import {
  KitIndex, STEPS, blockBars, echoFeedback, echoSec, filterParams, fxOn, grooveSources, hitById, renderGroove, songEnd,
  type Block, type Groove, type Kit, type KitSample, type Project,
} from './project';

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

interface TrackNodes {
  gain: GainNode;
  filter: BiquadFilterNode;
  pan: StereoPannerNode;
  echoSend: GainNode;
  delay: DelayNode;
  fb: GainNode;
  revSend: GainNode;
}

interface Graph {
  master: GainNode;
  tracks: TrackNodes[];
}

/** Искусственный зал: стерео-шум с экспоненциальным спадом (2,4 с), мягкий верх. */
function impulse(ctx: BaseAudioContext, sec = 2.4): AudioBuffer {
  const n = Math.round(sec * ctx.sampleRate);
  const b = ctx.createBuffer(2, n, ctx.sampleRate);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 0x80000000) - 1;
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / ctx.sampleRate;
      lp += 0.35 * (rnd() - lp); // сглаживание — зал не шипит
      const pre = t < 0.012 ? 0 : 1; // предзадержка
      d[i] = lp * pre * Math.pow(0.001, t / sec) * 1.6;
    }
  }
  return b;
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
  // общий зал: дорожки шлют в него долю своего звука
  const rev = ctx.createConvolver();
  rev.buffer = impulse(ctx);
  const revIn = ctx.createGain();
  const revOut = ctx.createGain();
  revOut.gain.value = 0.9;
  revIn.connect(rev).connect(revOut).connect(master);
  const tracks = p.tracks.map(() => {
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    const pan = ctx.createStereoPanner();
    gain.connect(filter).connect(pan).connect(master);
    // эхо: посыл → задержка ⟲ обратная связь (с приглушённым верхом, как у ленточного эха) → общий выход
    const echoSend = ctx.createGain();
    echoSend.gain.value = 0;
    const delay = ctx.createDelay(2);
    const fb = ctx.createGain();
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 5000;
    pan.connect(echoSend).connect(delay).connect(tone);
    tone.connect(fb).connect(delay);
    tone.connect(master);
    const revSend = ctx.createGain();
    revSend.gain.value = 0;
    pan.connect(revSend).connect(revIn);
    return { gain, filter, pan, echoSend, delay, fb, revSend };
  });
  return { master, tracks };
}

function applyMix(g: Graph, p: Project, at = 0, nyquist = 22050): void {
  const solo = p.tracks.some(t => t.solo);
  // в начале (и при сведении) — сразу, на ходу — плавно, без щелчков
  const set = (a: AudioParam, v: number, tc: number) => (at <= 0 ? a.setValueAtTime(v, 0) : a.setTargetAtTime(v, at, tc));
  set(g.master.gain, p.master, 0.01);
  p.tracks.forEach((t, i) => {
    const n = g.tracks[i];
    const on = !t.mute && (!solo || t.solo);
    set(n.gain.gain, on ? t.vol : 0, 0.01);
    set(n.pan.pan, t.pan, 0.01);
    const f = filterParams(t.fx.filter, nyquist);
    if (n.filter.type !== f.type) n.filter.type = f.type;
    set(n.filter.frequency, f.freq, 0.02);
    set(n.filter.Q, f.q, 0.02);
    set(n.echoSend.gain, t.fx.echo * 0.7, 0.02);
    set(n.fb.gain, t.fx.echo > 0 ? echoFeedback(t.fx) : 0, 0.02);
    set(n.delay.delayTime, echoSec(t.fx, p.bpm), 0.01);
    set(n.revSend.gain, t.fx.reverb * 0.8, 0.02);
  });
}

/** Умеет ли браузер кодировать Opus (WebCodecs) — тогда сведение в OGG. */
export async function canOgg(): Promise<boolean> {
  try {
    if (typeof AudioEncoder === 'undefined') return false;
    const r = await AudioEncoder.isConfigSupported({ codec: 'opus', sampleRate: 48000, numberOfChannels: 2, bitrate: 160000 });
    return !!r.supported;
  } catch {
    return false;
  }
}

/** Кодировать буфер (48 кГц, стерео) в Ogg Opus. */
export async function encodeOgg(b: AudioBuffer, onProgress?: (k: number) => void): Promise<Blob> {
  const rate = 48000;
  const ch = b.numberOfChannels;
  const packets: { data: Uint8Array; samples: number }[] = [];
  let preSkip = 312; // задержка кодера libopus при 48 кГц
  let failed: unknown = null;
  const enc = new AudioEncoder({
    output: (chunk, meta) => {
      const d = new Uint8Array(chunk.byteLength);
      chunk.copyTo(d);
      packets.push({ data: d, samples: Math.round(((chunk.duration ?? 20000) * rate) / 1e6) });
      const desc = meta?.decoderConfig?.description;
      if (desc) {
        const u = ArrayBuffer.isView(desc) ? new Uint8Array(desc.buffer, desc.byteOffset, desc.byteLength) : new Uint8Array(desc as ArrayBuffer);
        if (u.length >= 12 && String.fromCharCode(...u.subarray(0, 8)) === 'OpusHead') preSkip = u[10] | (u[11] << 8);
      }
    },
    error: e => (failed = e),
  });
  enc.configure({ codec: 'opus', sampleRate: rate, numberOfChannels: ch, bitrate: 160000 });
  const step = 4800; // 0,1 с
  const chans = Array.from({ length: ch }, (_, i) => b.getChannelData(i));
  for (let o = 0; o < b.length; o += step) {
    const n = Math.min(step, b.length - o);
    const buf = new Float32Array(n * ch);
    for (let c = 0; c < ch; c++) buf.set(chans[c].subarray(o, o + n), c * n);
    const data = new AudioData({ format: 'f32-planar', sampleRate: rate, numberOfFrames: n, numberOfChannels: ch, timestamp: Math.round((o / rate) * 1e6), data: buf });
    enc.encode(data);
    data.close();
    if (enc.encodeQueueSize > 50) await new Promise(r => setTimeout(r, 0));
    if ((o / step) % 50 === 0) onProgress?.(o / b.length);
  }
  await enc.flush();
  enc.close();
  if (failed) throw failed;
  const ogg = muxOggOpus(packets, { channels: ch, preSkip, rate, total: b.length });
  return new Blob([ogg as Uint8Array<ArrayBuffer>], { type: 'audio/ogg' });
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
  private preview: { src: AudioBufferSourceNode; gain: GainNode; loop?: boolean } | null = null;
  playing = false;
  onStop: (() => void) | null = null;

  constructor(readonly kit: Kit, private p: Project) {
    this.ix = new KitIndex(kit);
    this.ix.useProject(p);
  }

  setProject(p: Project): void {
    this.stop();
    this.p = p;
    this.ix.useProject(p);
    this.mix(); // граф тот же (16 дорожек), меняются только настройки
  }

  get barSec(): number {
    return 240 / this.p.bpm;
  }

  private audio(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
      this.g = buildGraph(this.ctx, this.p);
      applyMix(this.g, this.p, 0, this.ctx.sampleRate / 2);
    }
    if (this.ctx.state !== 'running') void this.ctx.resume();
    return this.ctx;
  }

  key(s: KitSample, bpm = this.p.bpm): string {
    return s.sig ? `${bpm}/~/${s.sig}` : `${bpm}/${s.id}`;
  }

  load(s: KitSample, bpm = this.p.bpm): Promise<AudioBuffer | null> {
    const k = this.key(s, bpm);
    const have = this.buffers.get(k);
    if (have) return Promise.resolve(have);
    let pr = this.loading.get(k);
    if (!pr && s.groove) {
      pr = this.renderGroove(s.groove, bpm).then(buf => {
        if (buf) this.buffers.set(k, buf);
        else this.loading.delete(k);
        return buf;
      });
      this.loading.set(k, pr);
    }
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

  /** Свести грув в буфер из ударов кита (в темпе bpm). */
  async renderGroove(g: Groove, bpm = this.p.bpm): Promise<AudioBuffer | null> {
    const ctx = this.audio();
    const src = new Map<string, Float32Array[]>();
    await Promise.all(grooveSources(g).map(async id => {
      const s = this.ix.get(id);
      const b = s && (await this.load(s, bpm));
      if (b) src.set(id, Array.from({ length: b.numberOfChannels }, (_, c) => b.getChannelData(c)));
    }));
    const ch = renderGroove(g, bpm, ctx.sampleRate, id => src.get(id) ?? null);
    const buf = ctx.createBuffer(2, ch[0].length, ctx.sampleRate);
    ch.forEach((d, c) => buf.copyToChannel(d as Float32Array<ArrayBuffer>, c));
    return buf;
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
    if (this.g && this.ctx) applyMix(this.g, this.p, this.ctx.currentTime, this.ctx.sampleRate / 2);
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

  /** Играть грув петлёй (окно Groove Generator); повторный вызов подменяет рисунок, не сбивая счёт. */
  async loopGroove(g: Groove): Promise<void> {
    const ctx = this.audio();
    const buf = await this.renderGroove(g);
    if (!buf || !this.g) return;
    const old = this.preview;
    const start = this.loopStart && old?.loop ? this.loopStart : ctx.currentTime + 0.03;
    const now = ctx.currentTime + 0.02;
    const offset = now > start ? (now - start) % buf.duration : 0;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = 0.9;
    src.connect(gain).connect(this.g.master);
    src.start(Math.max(now, start), offset);
    this.stopPreview();
    this.loopStart = start;
    this.preview = { src, gain, loop: true };
  }

  private loopStart = 0;

  /** Шаг грува, который звучит сейчас (подсветка в окне Groove Generator), или null. */
  loopStep(): number | null {
    const pv = this.preview;
    if (!pv?.loop || !this.ctx || !pv.src.buffer) return null;
    const t = this.ctx.currentTime - this.loopStart;
    if (t < 0) return null;
    const stepSec = this.barSec / STEPS;
    return Math.floor((t % pv.src.buffer.duration) / stepSec + 1e-6);
  }

  /** Прослушать один удар грува (щелчок по клетке без петли). */
  async previewHit(id: string, accent = false): Promise<void> {
    const h = hitById.get(id);
    const s = h && this.ix.get(h.src);
    if (!h || !s) return;
    const ctx = this.audio();
    const buf = await this.load(s);
    if (!buf || !this.g) return;
    if (this.preview?.loop) return; // петля уже играет — рисунок слышен в ней
    this.stopPreview();
    const stepSec = this.barSec / STEPS;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gain = ctx.createGain();
    gain.gain.value = accent ? 0.95 : 0.7;
    src.connect(gain).connect(this.g.master);
    const now = ctx.currentTime + 0.01;
    const dur = Math.min(h.len, 8) * stepSec;
    gain.gain.setValueAtTime(gain.gain.value, now + dur - 0.01);
    gain.gain.linearRampToValueAtTime(0, now + dur);
    src.start(now, h.step * stepSec, dur);
    this.preview = { src, gain };
  }

  /** Свести песню: OGG (Opus, 48 кГц), если браузер умеет, иначе WAV (16 бит, 44,1 кГц). */
  async exportSong(onProgress?: (k: number) => void): Promise<{ blob: Blob; ext: 'ogg' | 'wav' }> {
    const ogg = await canOgg();
    await this.preload((d, t) => onProgress?.(0.3 * d / t));
    const bars = Math.max(1, songEnd(this.p, this.ix));
    const sr = ogg ? 48000 : 44100;
    const tail = this.p.tracks.some(t => fxOn(t.fx)) ? 3 : 0.5; // хвосты эха и реверба
    const len = Math.ceil((bars * this.barSec + tail) * sr);
    const off = new OfflineAudioContext(2, len, sr);
    const g = buildGraph(off, this.p);
    applyMix(g, this.p, 0, sr / 2);
    for (const b of this.p.blocks) {
      const s = this.ix.get(b.sample);
      const buf = s && this.buffers.get(this.key(s));
      if (!s || !buf) continue;
      const src = off.createBufferSource();
      src.buffer = buf;
      src.connect(g.tracks[b.track].gain);
      src.start(b.bar * this.barSec, 0, Math.min(buf.duration, s.bars * this.barSec));
    }
    onProgress?.(0.35);
    const out = await off.startRendering();
    onProgress?.(0.6);
    if (ogg) {
      try {
        return { blob: await encodeOgg(out, k => onProgress?.(0.6 + 0.4 * k)), ext: 'ogg' };
      } catch (e) {
        console.warn('OGG не вышел, свожу в WAV', e);
      }
    }
    onProgress?.(1);
    return { blob: wav(out), ext: 'wav' };
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
