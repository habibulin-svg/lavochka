/* Симулятор дирижёра — оркестр: сэмплер на WebAudio.
 * Сэмплы — public/dirizher/s/<инструмент>/<нота>_<сила>.ogg + index.json (пишет tools/dirizher/samples.py из VSCO 2 CE / VCSL, CC0):
 * по инструменту 6–12 опорных нот, две силы (p, f), у тянущихся — петля (точки в index.json, шов сглажен при нарезке).
 * Нота = ближайшая опорная с playbackRate. Включение — точно по времени (планировщик снаружи), снятие — по тику
 * (release), поэтому фермата и живой темп ничего не обрывают. Шины: инструмент (панорама по месту) → строка ленты
 * (громкость = уверенность группы) → оркестр (динамика) → зал (реверб) → выход. */

import { notesOf, TempoMap, type InstrId, type ScoreJson } from '../core/score';

export interface SampleZone {
  /** Опорная нота MIDI. */
  n: number;
  /** 0 — p, 1 — f. */
  v: 0 | 1;
  file: string;
  /** Петля (с): тянущиеся звуки. */
  loop?: [number, number];
  /** Приём: нет — тянуть, 1 — коротко, 2 — пиццикато. */
  a?: 1 | 2;
}

export interface InstrSamples {
  zones: SampleZone[];
  /** Секунды затухания после снятия. */
  rel: number;
  /** Громкость инструмента (сведение). */
  gain: number;
  /** Секция: слоёв с расстройкой (из соло — секция). */
  layers?: number;
  /** Сэмплы родственника (английский рожок — гобоя): папка. */
  from?: InstrId;
}

export type SampleIndex = Partial<Record<InstrId, InstrSamples>>;

const BASE = `${import.meta.env.BASE_URL}dirizher/s/`;

interface Voice {
  srcs: AudioBufferSourceNode[];
  env: GainNode;
  instr: InstrId;
}

/** Синтетический импульс зала: стерео-шум с экспоненциальным спадом за rt60 с. */
function hallImpulse(ctx: BaseAudioContext, rt60: number): AudioBuffer {
  const sec = Math.min(4, rt60 * 1.3);
  const n = Math.round(sec * ctx.sampleRate);
  const b = ctx.createBuffer(2, n, ctx.sampleRate);
  let seed = 9871;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 0x80000000) - 1;
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / ctx.sampleRate;
      lp += 0.3 * (rnd() - lp);
      const pre = t < 0.02 ? 0 : 1;
      d[i] = lp * pre * Math.exp((-6.9 * t) / rt60);
    }
  }
  return b;
}

export class Orchestra {
  readonly ctx: AudioContext;
  readonly out: GainNode;
  private dry: GainNode;
  private wet: GainNode;
  private verb: ConvolverNode;
  private master: GainNode;
  private index: SampleIndex = {};
  private buffers = new Map<string, AudioBuffer>();
  private instrBus = new Map<InstrId, { gain: GainNode; pan: StereoPannerNode }>();
  private laneBus: GainNode[] = [];
  private laneOfInstr = new Map<InstrId, number>();
  private voices = new Set<Voice>();

  constructor(ctx?: AudioContext) {
    this.ctx = ctx ?? new AudioContext({ latencyHint: 'interactive' });
    this.out = this.ctx.createGain();
    // мягкий ограничитель: тутти не хрипит, пиано не тонет
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.01;
    comp.release.value = 0.25;
    this.out.gain.value = 1.6;
    this.out.connect(comp).connect(this.ctx.destination);
    this.master = this.ctx.createGain();
    this.master.gain.value = 1;
    this.dry = this.ctx.createGain();
    this.wet = this.ctx.createGain();
    this.verb = this.ctx.createConvolver();
    this.master.connect(this.dry).connect(this.out);
    this.master.connect(this.verb).connect(this.wet).connect(this.out);
    this.setHall(1.6);
  }

  /** Зал: время реверберации и сколько «зала» в звуке. */
  setHall(rt60: number, wet = 0.32): void {
    this.verb.buffer = hallImpulse(this.ctx, rt60);
    this.wet.gain.value = wet;
    this.dry.gain.value = 1 - wet * 0.5;
  }

  async loadIndex(): Promise<SampleIndex> {
    if (Object.keys(this.index).length) return this.index;
    const r = await fetch(`${BASE}index.json`);
    this.index = (await r.json()) as SampleIndex;
    return this.index;
  }

  /** Загрузить все сэмплы инструментов; onProgress(0..1). */
  async load(instrs: InstrId[], onProgress?: (k: number) => void): Promise<void> {
    const idx = await this.loadIndex();
    await this.loadFiles(instrs.flatMap((i) => idx[i]?.zones.map((z) => `${idx[i]!.from ?? i}/${z.file}`) ?? []), onProgress);
  }

  /** Ближайшая зона ноты среди всех (как zoneFor, но без оглядки на загруженное) — файл. */
  private fileFor(instr: InstrId, pitch: number, vel: number, art: number): string | null {
    const s = this.index[instr];
    if (!s) return null;
    const want: 0 | 1 = vel >= 80 ? 1 : 0;
    let best: SampleZone | null = null;
    let bestD = 1e9;
    for (const z of s.zones) {
      const d = Math.abs(z.n - pitch) * 2 + (z.v === want ? 0 : 5) + ((z.a ?? 0) === art ? 0 : 40);
      if (d < bestD) {
        bestD = d;
        best = z;
      }
    }
    return best ? `${s.from ?? instr}/${best.file}` : null;
  }

  /** Какие файлы понадобятся партитуре — по порядку первого звучания (нужно для «грузить только своё и по очереди»).
   * Нота короче 0,2 с играется коротким приёмом; около порога (живой темп, репетиция) берём оба приёма.
   * fromSec/toSec — только ноты в этом окне (секунды по партитуре). */
  async scoreFiles(score: ScoreJson, fromSec = 0, toSec = 1e9): Promise<string[]> {
    await this.loadIndex();
    const tm = new TempoMap(score.tempo);
    const all: { t: number; f: string }[] = [];
    for (const p of score.parts)
      for (const n of notesOf(p)) {
        const t = tm.sec(n.tick);
        if (t < fromSec || t >= toSec) continue;
        const d = tm.sec(n.tick + n.dur) - t;
        const arts = n.art ? [n.art] : d < 0.12 ? [1] : d < 0.36 ? [0, 1] : [0];
        for (const a of arts) {
          const f = this.fileFor(p.instr, n.pitch, n.vel, a);
          if (f) all.push({ t, f });
        }
      }
    all.sort((a, b) => a.t - b.t);
    return [...new Set(all.map((x) => x.f))];
  }

  /** Загрузить файлы сэмплов (по порядку списка, 6 потоков); уже загруженные пропускаются. */
  async loadFiles(list: string[], onProgress?: (k: number) => void): Promise<void> {
    const files = [...new Set(list)].filter((f) => !this.buffers.has(f) && !this.loading.has(f));
    let done = 0;
    const queue = [...files];
    for (const f of files) this.loading.add(f);
    const worker = async () => {
      while (queue.length) {
        const f = queue.shift()!;
        try {
          const ab = await (await fetch(BASE + f)).arrayBuffer();
          this.buffers.set(f, await this.ctx.decodeAudioData(ab));
        } catch {
          /* нет файла — нота возьмёт соседнюю зону или промолчит */
        }
        this.loading.delete(f);
        onProgress?.(++done / Math.max(1, files.length));
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    // файлы, которые грузит другой вызов, — дождаться
    while (list.some((f) => this.loading.has(f))) await new Promise((r) => setTimeout(r, 50));
    onProgress?.(1);
  }
  private loading = new Set<string>();

  /** Раскладка шин: инструмент → строка ленты; pan — место на сцене (−1 слева … 1 справа). */
  setup(lanes: InstrId[][], pan: Partial<Record<InstrId, number>>): void {
    for (const g of this.laneBus) g.disconnect();
    for (const b of this.instrBus.values()) b.gain.disconnect();
    this.laneBus = [];
    this.instrBus.clear();
    this.laneOfInstr.clear();
    lanes.forEach((list, li) => {
      const g = this.ctx.createGain();
      g.connect(this.master);
      this.laneBus.push(g);
      for (const id of list) {
        this.laneOfInstr.set(id, li);
        const gain = this.ctx.createGain();
        gain.gain.value = this.index[id]?.gain ?? 1;
        const p = this.ctx.createStereoPanner();
        p.pan.value = pan[id] ?? 0;
        gain.connect(p).connect(g);
        this.instrBus.set(id, { gain, pan: p });
      }
    });
  }

  /** Громкость строки (уверенность группы), плавно. */
  laneLevel(lane: number, level: number, at = this.ctx.currentTime, glide = 0.12): void {
    const g = this.laneBus[lane]?.gain;
    if (!g) return;
    g.cancelScheduledValues(at);
    g.setTargetAtTime(level, at, glide / 3);
  }

  /** Динамика всего оркестра (0.5..1.4). */
  dynamics(level: number): void {
    this.master.gain.setTargetAtTime(level, this.ctx.currentTime, 0.15);
  }

  private zoneFor(instr: InstrId, pitch: number, vel: number, art: number): { z: SampleZone; buf: AudioBuffer } | null {
    const s = this.index[instr];
    if (!s) return null;
    const dir = s.from ?? instr;
    const want: 0 | 1 = vel >= 80 ? 1 : 0;
    let best: SampleZone | null = null;
    let bestD = 1e9;
    for (const z of s.zones) {
      if (!this.buffers.has(`${dir}/${z.file}`)) continue;
      const d = Math.abs(z.n - pitch) * 2 + (z.v === want ? 0 : 5) + ((z.a ?? 0) === art ? 0 : 40);
      if (d < bestD) {
        bestD = d;
        best = z;
      }
    }
    return best ? { z: best, buf: this.buffers.get(`${dir}/${best.file}`)! } : null;
  }

  /** Взять ноту в момент `when` (время контекста); art — приём (0 тянуть, 1 коротко, 2 пиццикато). Голос снять через release(). */
  noteOn(instr: InstrId, pitch: number, vel: number, when: number, detuneCents = 0, art = 0): Voice | null {
    const found = this.zoneFor(instr, pitch, vel, art);
    const bus = this.instrBus.get(instr);
    if (!found || !bus) return null;
    const { z, buf } = found;
    const s = this.index[instr]!;
    const env = this.ctx.createGain();
    // сила внутри слоя: p-слой 30..80, f-слой 80..127
    const v = z.v === 1 ? 0.55 + 0.45 * Math.min(1, (vel - 80) / 47) : 0.35 + 0.65 * Math.min(1, Math.max(0, vel - 20) / 60);
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(v, when + 0.012);
    env.connect(bus.gain);
    const layers = s.layers ?? 1;
    const srcs: AudioBufferSourceNode[] = [];
    for (let k = 0; k < layers; k++) {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const spread = layers > 1 ? (k - (layers - 1) / 2) * 7 : 0;
      src.playbackRate.value = Math.pow(2, (pitch - z.n + (detuneCents + spread) / 100) / 12);
      if (z.loop) {
        src.loop = true;
        src.loopStart = z.loop[0];
        src.loopEnd = z.loop[1];
      }
      const g = layers > 1 ? this.ctx.createGain() : null;
      if (g) {
        g.gain.value = 1 / Math.sqrt(layers);
        src.connect(g).connect(env);
      } else src.connect(env);
      src.start(when + (layers > 1 ? k * 0.011 : 0));
      srcs.push(src);
    }
    const voice: Voice = { srcs, env, instr };
    this.voices.add(voice);
    srcs[0].onended = () => {
      this.voices.delete(voice);
      env.disconnect();
    };
    if (!z.loop) {
      // без петли сэмпл сам кончится; страховка — снять по длине
      for (const x of srcs) x.stop(when + buf.duration / x.playbackRate.value + 0.05);
    }
    return voice;
  }

  release(v: Voice | null, at = this.ctx.currentTime): void {
    if (!v) return;
    const rel = this.index[v.instr]?.rel ?? 0.4;
    const t = Math.max(at, this.ctx.currentTime);
    v.env.gain.cancelScheduledValues(t);
    v.env.gain.setTargetAtTime(0, t, rel / 4);
    for (const s of v.srcs) {
      try {
        s.stop(t + rel * 1.5);
      } catch {
        /* уже остановлен */
      }
    }
  }

  private clapBuf: AudioBuffer | null = null;

  /** Аплодисменты: много хлопков вразнобой (шум через полосовой фильтр), сила 0..1, длительность с. */
  applause(level: number, sec: number): void {
    const ctx = this.ctx;
    if (!this.clapBuf) {
      const len = 6;
      const n = Math.round(len * ctx.sampleRate);
      const b = ctx.createBuffer(2, n, ctx.sampleRate);
      let seed = 4242;
      const rnd = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 0x100000000;
      for (let c = 0; c < 2; c++) {
        const d = b.getChannelData(c);
        for (let who = 0; who < 70; who++) {
          const rate = 0.22 + rnd() * 0.16;
          const amp = 0.25 + rnd() * 0.75;
          for (let t = rnd() * rate; t < len; t += rate * (0.9 + rnd() * 0.2)) {
            const i0 = Math.round(t * ctx.sampleRate);
            const clapLen = Math.round(0.012 * ctx.sampleRate);
            for (let k = 0; k < clapLen && i0 + k < n; k++) d[i0 + k] += (rnd() * 2 - 1) * amp * Math.exp(-k / (clapLen / 4)) * 0.08;
          }
        }
      }
      this.clapBuf = b;
    }
    const src = ctx.createBufferSource();
    src.buffer = this.clapBuf;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800;
    bp.Q.value = 0.6;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + 0.5);
    g.gain.setValueAtTime(level, t + Math.max(0.6, sec - 1.2));
    g.gain.linearRampToValueAtTime(0, t + sec);
    src.connect(bp).connect(g).connect(this.out);
    g.connect(this.verb);
    src.start(t, Math.random() * 3);
    src.stop(t + sec + 0.1);
  }

  /** Зал хлопает в такт: десятки хлопков почти разом (разброс ±18 мс), сила 0..1. */
  clap(level: number): void {
    const ctx = this.ctx;
    if (!this.syncClap) {
      const n = Math.round(0.16 * ctx.sampleRate);
      const b = ctx.createBuffer(2, n, ctx.sampleRate);
      let seed = 777;
      const rnd = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 0x100000000;
      for (let c = 0; c < 2; c++) {
        const d = b.getChannelData(c);
        for (let who = 0; who < 60; who++) {
          const i0 = Math.round((0.004 + rnd() * 0.036) * ctx.sampleRate);
          const amp = 0.3 + rnd() * 0.7;
          const len = Math.round((0.008 + rnd() * 0.008) * ctx.sampleRate);
          for (let k = 0; k < len && i0 + k < n; k++) d[i0 + k] += (rnd() * 2 - 1) * amp * Math.exp(-k / (len / 4)) * 0.09;
        }
      }
      this.syncClap = b;
    }
    const src = ctx.createBufferSource();
    src.buffer = this.syncClap;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1500 + Math.random() * 300;
    bp.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.value = Math.max(0.05, Math.min(1.2, level));
    src.connect(bp).connect(g).connect(this.out);
    g.connect(this.verb);
    src.start();
  }
  private syncClap: AudioBuffer | null = null;

  /** Недовольный гул публики (провал). */
  boo(): void {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    for (let k = 0; k < 6; k++) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(110 + k * 23, t);
      o.frequency.linearRampToValueAtTime(80 + k * 17, t + 2.2);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 500;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.03, t + 0.4);
      g.gain.linearRampToValueAtTime(0, t + 2.4);
      o.connect(f).connect(g).connect(this.out);
      o.start(t + k * 0.05);
      o.stop(t + 2.5);
    }
  }

  /** Тишина: снять всё (пауза, выход). */
  silence(): void {
    for (const v of [...this.voices]) this.release(v, this.ctx.currentTime);
    this.voices.clear();
  }

  close(): void {
    this.silence();
    void this.ctx.close();
  }
}

export type { Voice };
