/* Синтез звуков через Web Audio — без файлов. Общие «кирпичики» + набор готовых эффектов. */
import { settings } from './settings';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;

function ensure(): AudioContext | null {
  if (!ctx) {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC() as AudioContext;
    master = ctx.createGain();
    master.gain.value = settings.volume;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp);
    comp.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function on(): AudioContext | null {
  if (!settings.sound) return null;
  const c = ensure();
  if (c && master) master.gain.value = settings.volume;
  return c;
}

interface ClickOpts {
  freq?: number;
  q?: number;
  dur?: number;
  gain?: number;
}
/** Короткий шумовой щелчок через полосовой фильтр — «дерево/кость/картон». */
export function click(t: number, { freq = 2500, q = 3, dur = 0.03, gain = 0.5 }: ClickOpts = {}) {
  if (!ctx || !master || !noiseBuf) return;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq;
  bp.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(bp).connect(g).connect(master);
  src.start(t, Math.random() * 0.5, dur + 0.02);
}

interface ToneOpts {
  freq?: number;
  to?: number | null;
  dur?: number;
  gain?: number;
  type?: OscillatorType;
}
export function tone(t: number, { freq = 200, to = null, dur = 0.12, gain = 0.4, type = 'sine' }: ToneOpts = {}) {
  if (!ctx || !master) return;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function sweep(t: number, from: number, peak: number, to: number, dur: number, gain: number) {
  if (!ctx || !master || !noiseBuf) return;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 6;
  bp.frequency.setValueAtTime(from, t);
  bp.frequency.exponentialRampToValueAtTime(peak, t + dur * 0.55);
  bp.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + dur * 0.33);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(bp).connect(g).connect(master);
  src.start(t, 0, dur + 0.05);
}

/** Удар деревянной фишки о доску. */
function knock(t: number, strength = 1) {
  tone(t, { freq: 190 + Math.random() * 40, to: 90, dur: 0.09, gain: 0.35 * strength });
  click(t, { freq: 1100 + Math.random() * 500, q: 2.5, dur: 0.045, gain: 0.45 * strength });
}

export const Sound = {
  unlock() {
    ensure();
  },
  /** Писк пьезоизлучателя ЖК-игры: прямоугольная волна. */
  beep(freq = 2000, dur = 0.05, gain = 0.12) {
    const c = on();
    if (c) tone(c.currentTime, { freq, dur, gain, type: 'square' });
  },
  diceRoll(duration = 0.9) {
    const c = on();
    if (!c) return;
    const t0 = c.currentTime;
    for (let i = 0; i < 7; i++) {
      click(t0 + i * 0.045 + Math.random() * 0.02, { freq: 3000 + Math.random() * 2000, q: 4, dur: 0.02, gain: 0.25 });
    }
    let t = t0 + 0.35;
    let gap = 0.04;
    let g = 0.7;
    while (t < t0 + duration) {
      click(t, { freq: 1800 + Math.random() * 2200, q: 3, dur: 0.035, gain: g });
      if (Math.random() < 0.35) tone(t, { freq: 140 + Math.random() * 60, to: 80, dur: 0.06, gain: g * 0.3 });
      t += gap + Math.random() * 0.03;
      gap *= 1.18;
      g *= 0.86;
    }
  },
  step() {
    const c = on();
    if (c) knock(c.currentTime, 0.55);
  },
  place() {
    const c = on();
    if (c) knock(c.currentTime, 1);
  },
  enter() {
    const c = on();
    if (!c) return;
    const t = c.currentTime;
    knock(t, 1);
    tone(t + 0.02, { freq: 392, dur: 0.18, gain: 0.12, type: 'triangle' });
    tone(t + 0.12, { freq: 587, dur: 0.25, gain: 0.12, type: 'triangle' });
  },
  jump() {
    const c = on();
    if (!c) return;
    const t = c.currentTime;
    sweep(t, 400, 2600, 700, 0.45, 0.5);
    tone(t, { freq: 300, to: 900, dur: 0.3, gain: 0.08 });
  },
  capture() {
    const c = on();
    if (!c) return;
    const t = c.currentTime;
    knock(t, 1.2);
    knock(t + 0.07, 0.9);
    tone(t + 0.08, { freq: 520, to: 130, dur: 0.45, gain: 0.18, type: 'sawtooth' });
    click(t + 0.08, { freq: 600, q: 1, dur: 0.25, gain: 0.25 });
  },
  home() {
    const c = on();
    if (!c) return;
    const t = c.currentTime;
    knock(t, 0.8);
    [523, 659, 784].forEach((f, i) => tone(t + 0.05 + i * 0.08, { freq: f, dur: 0.5, gain: 0.1, type: 'triangle' }));
  },
  turn() {
    const c = on();
    if (!c) return;
    const t = c.currentTime;
    tone(t, { freq: 880, dur: 0.35, gain: 0.07 });
    tone(t + 0.09, { freq: 1320, dur: 0.4, gain: 0.05 });
  },
  nomove() {
    const c = on();
    if (!c) return;
    const t = c.currentTime;
    tone(t, { freq: 330, to: 250, dur: 0.25, gain: 0.08, type: 'triangle' });
    tone(t + 0.15, { freq: 250, to: 200, dur: 0.3, gain: 0.08, type: 'triangle' });
  },
  win() {
    const c = on();
    if (!c) return;
    const t = c.currentTime;
    [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => {
      tone(t + i * 0.13, { freq: f, dur: 0.4, gain: 0.12, type: 'triangle' });
      tone(t + i * 0.13, { freq: f / 2, dur: 0.3, gain: 0.06 });
    });
  },
  /** Карта ложится на стол. */
  card() {
    const c = on();
    if (!c) return;
    const t = c.currentTime;
    sweep(t, 1800, 4200, 2500, 0.12, 0.35);
    click(t + 0.1, { freq: 900, q: 1.5, dur: 0.03, gain: 0.3 });
  },
  shuffle() {
    const c = on();
    if (!c) return;
    const t0 = c.currentTime;
    for (let i = 0; i < 26; i++) click(t0 + i * 0.022 + Math.random() * 0.01, { freq: 2600 + Math.random() * 1800, q: 2, dur: 0.018, gain: 0.18 });
  },
  chat() {
    const c = on();
    if (!c) return;
    tone(c.currentTime, { freq: 1180, dur: 0.12, gain: 0.05 });
  },
  ui() {
    const c = on();
    if (c) click(c.currentTime, { freq: 1600, q: 2, dur: 0.025, gain: 0.25 });
  },
};
