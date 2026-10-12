/* Пищалка эмулятора: уровень вывода (0/1) с частотой кварца уходит потоком в AudioWorklet,
 * там — пересчёт в частоту звуковой карты с подстройкой под заполненность буфера (часы страницы и звука идут врозь),
 * срез постоянной составляющей и лёгкий фильтр — пьезо не звенит «цифрой». */
import { audioOut } from '../core/audio';

const WORKLET = `
class GwBeeper extends AudioWorkletProcessor {
  constructor(opts) {
    super();
    this.inRate = opts.processorOptions.rate;
    this.buf = new Float32Array(1 << 16);
    this.w = 0; this.r = 0; this.frac = 0;
    this.x1 = 0; this.y1 = 0; this.lp = 0; this.last = 0;
    this.gain = opts.processorOptions.gain;
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d.gain != null) { this.gain = d.gain; return; }
      const n = this.buf.length;
      for (let i = 0; i < d.length; i++) { this.buf[this.w] = d[i]; this.w = (this.w + 1) & (n - 1); }
      // переполнение (вкладка отставала) — догоняем до цели
      const fill = (this.w - this.r + n) & (n - 1);
      const target = this.inRate * 0.08;
      if (fill > this.inRate * 0.3) this.r = (this.w - Math.floor(target) + n) & (n - 1);
    };
  }
  process(_in, outs) {
    const out = outs[0][0];
    const n = this.buf.length;
    let fill = (this.w - this.r + n) & (n - 1);
    const target = this.inRate * 0.08;
    const adj = Math.max(-0.02, Math.min(0.02, ((fill - target) / target) * 0.05));
    const step = (this.inRate / sampleRate) * (1 + adj);
    for (let i = 0; i < out.length; i++) {
      let x;
      if (fill > 2) {
        // среднее по отрезку входа, который покрывает этот выходной сэмпл (простая децимация без звона)
        let acc = 0, cnt = 0;
        this.frac += step;
        while (this.frac >= 1 && fill > 1) { acc += this.buf[this.r]; this.r = (this.r + 1) & (n - 1); fill--; this.frac -= 1; cnt++; }
        x = cnt ? acc / cnt : this.last;
        this.last = x;
      } else x = this.last *= 0.999;
      const y = x - this.x1 + 0.995 * this.y1;
      this.x1 = x; this.y1 = y;
      this.lp += (y - this.lp) * 0.55;
      out[i] = this.lp * this.gain;
    }
    return true;
  }
}
registerProcessor('gw-beeper', GwBeeper);
`;

const ready = new WeakMap<BaseAudioContext, Promise<boolean>>();

function loadWorklet(ctx: AudioContext): Promise<boolean> {
  let p = ready.get(ctx);
  if (!p) {
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
    p = ctx.audioWorklet
      .addModule(url)
      .then(() => true)
      .catch((e) => {
        console.warn('gw beeper', e);
        return false;
      });
    ready.set(ctx, p);
  }
  return p;
}

export class Beeper {
  private node: AudioWorkletNode | null = null;
  private closed = false;

  constructor(
    private rate: number,
    private gain = 0.22
  ) {
    const a = audioOut();
    if (!a || !a.ctx.audioWorklet) return;
    void loadWorklet(a.ctx).then((ok) => {
      if (!ok || this.closed) return;
      this.node = new AudioWorkletNode(a.ctx, 'gw-beeper', {
        numberOfInputs: 0,
        outputChannelCount: [1],
        processorOptions: { rate: this.rate, gain: this.gain },
      });
      this.node.connect(a.out);
    });
  }

  /** Есть ли звук прямо сейчас (ворклет загружен). */
  get live() {
    return !!this.node;
  }

  push(samples: Float32Array) {
    if (this.node) this.node.port.postMessage(samples, [samples.buffer]);
  }

  close() {
    this.closed = true;
    this.node?.disconnect();
    this.node = null;
  }
}
