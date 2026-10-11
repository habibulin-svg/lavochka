/* Бильярд — звуки, синтез Web Audio (без файлов). Всё зависит от силы соударения и места на столе (панорама).
 * Шар о шар — сухой «щелчок» фенольной смолы: короткий импульс + несколько быстро гаснущих мод 2,5–9 кГц, на сильных — ярче;
 * кий — кожаная наклейка: глуше, с «телом»; борт — резина: низкий глухой удар, на сильных — стук дерева рамы;
 * луза — удар в сетку (русский, снукер) или в резиновый карман и катание по жёлобу (пул); качение — тихий шорох по сукну.
 * Зал — короткая реверберация, чтобы щелчки звучали в комнате, а не «в наушниках». */
import { audioOut } from '../../core/audio';

interface Bus {
  ctx: AudioContext;
  dry: GainNode;
  rev: ConvolverNode;
  noise: AudioBuffer;
  roll: { src: AudioBufferSourceNode; gain: GainNode } | null;
}
let bus: Bus | null = null;

function impulse(ctx: AudioContext, sec: number, decay: number): AudioBuffer {
  const n = Math.round(ctx.sampleRate * sec);
  const b = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    for (let i = 0; i < n; i++) {
      const t = i / ctx.sampleRate;
      // ранние отражения от стен и потолка + хвост
      const early = t < 0.05 && Math.random() < 0.004 ? 1 : 0;
      d[i] = ((Math.random() * 2 - 1) * 0.5 + early * (Math.random() < 0.5 ? -1 : 1)) * Math.exp(-t / decay);
    }
  }
  return b;
}

function get(): Bus | null {
  const o = audioOut();
  if (!o) return null;
  if (!bus || bus.ctx !== o.ctx) {
    const ctx = o.ctx;
    const dry = ctx.createGain();
    dry.gain.value = 0.9;
    dry.connect(o.out);
    const rev = ctx.createConvolver();
    rev.buffer = impulse(ctx, 0.9, 0.18);
    const wet = ctx.createGain();
    wet.gain.value = 0.22;
    rev.connect(wet).connect(o.out);
    bus = { ctx, dry, rev, noise: o.noise, roll: null };
  }
  return bus;
}

/** Выход одного звука: панорама + сухой и в зал. */
function out(b: Bus, pan: number, send = 1): AudioNode {
  const p = b.ctx.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, pan)) * 0.7;
  p.connect(b.dry);
  const s = b.ctx.createGain();
  s.gain.value = send;
  p.connect(s).connect(b.rev);
  return p;
}

const rnd = (k: number) => 1 + (Math.random() * 2 - 1) * k;

/** Затухающая синусоида (мода). */
function mode(b: Bus, dst: AudioNode, t: number, freq: number, gain: number, tau: number, to?: number) {
  const o = b.ctx.createOscillator();
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + tau * 3);
  const g = b.ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.0006);
  g.gain.setTargetAtTime(0, t + 0.0006, tau);
  o.connect(g).connect(dst);
  o.start(t);
  o.stop(t + tau * 8 + 0.01);
}

/** Шумовой всплеск через фильтр. */
function burst(b: Bus, dst: AudioNode, t: number, type: BiquadFilterType, freq: number, q: number, gain: number, tau: number, len = tau * 6) {
  const s = b.ctx.createBufferSource();
  s.buffer = b.noise;
  const f = b.ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = b.ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.0008);
  g.gain.setTargetAtTime(0, t + 0.0008, tau);
  s.connect(f).connect(g).connect(dst);
  s.start(t, Math.random() * 0.8, len + 0.02);
}

/** Сила 0…1 по скорости соударения (м/с): тихие касания слышны, разбой не оглушает. */
const level = (v: number, full: number) => Math.min(1, Math.pow(Math.max(0, v) / full, 0.75));

export interface HitOpts {
  /** Когда (в секундах контекста); 0 — сейчас. */
  at?: number;
  pan?: number;
}

function when(b: Bus, at?: number) {
  return Math.max(b.ctx.currentTime, at ?? 0) + 0.005;
}

/** Шар о шар. */
export function ballClick(v: number, o: HitOpts = {}) {
  const b = get();
  if (!b) return;
  const t = when(b, o.at);
  const a = level(v, 4.5);
  if (a < 0.01) return;
  const dst = out(b, o.pan ?? 0, 0.8);
  const bright = 0.45 + 0.55 * a;
  const p = rnd(0.05);
  burst(b, dst, t, 'highpass', 2600, 0.7, 0.55 * a, 0.0018);
  mode(b, dst, t, 2650 * p, 0.42 * a, 0.012);
  mode(b, dst, t, 4180 * p, 0.3 * a * bright, 0.008);
  mode(b, dst, t, 6020 * p, 0.2 * a * bright, 0.006);
  mode(b, dst, t, 8650 * p, 0.12 * a * bright * bright, 0.004);
  mode(b, dst, t, 820 * p, 0.12 * a, 0.01);
}

/** Удар кия по битку. */
export function cueStrike(v: number, o: HitOpts = {}) {
  const b = get();
  if (!b) return;
  const t = when(b, o.at);
  const a = level(v, 7);
  const dst = out(b, o.pan ?? 0, 0.6);
  burst(b, dst, t, 'bandpass', 1500, 0.9, 0.5 * a + 0.08, 0.004);
  mode(b, dst, t, 470 * rnd(0.04), 0.3 * a + 0.05, 0.022, 380);
  // отклик самого шара — тише и глуше щелчка о шар
  mode(b, dst, t, 2500 * rnd(0.04), 0.14 * a, 0.007);
  mode(b, dst, t, 3900 * rnd(0.04), 0.07 * a, 0.005);
}

/** Шар о борт. */
export function cushionThud(v: number, o: HitOpts = {}) {
  const b = get();
  if (!b) return;
  const t = when(b, o.at);
  const a = level(v, 3.5);
  if (a < 0.02) return;
  const dst = out(b, o.pan ?? 0, 0.7);
  mode(b, dst, t, 150 * rnd(0.06), 0.55 * a, 0.035, 90);
  burst(b, dst, t, 'lowpass', 700, 0.7, 0.35 * a, 0.012);
  // сильный удар — отзывается деревянная рама
  if (a > 0.35) mode(b, dst, t + 0.002, 330 * rnd(0.05), 0.12 * a, 0.03);
  mode(b, dst, t, 2300 * rnd(0.05), 0.05 * a, 0.004);
}

/** Шар в лузе: net — сетка (русский, снукер), иначе резиновый карман и жёлоб (пул); full — в лузе уже есть шары. */
export function pocketDrop(v: number, net: boolean, full: boolean, o: HitOpts = {}) {
  const b = get();
  if (!b) return;
  const t = when(b, o.at);
  const a = 0.35 + 0.65 * level(v, 3);
  const dst = out(b, o.pan ?? 0, 1);
  // о губку / край лузы
  mode(b, dst, t, 210 * rnd(0.08), 0.25 * a, 0.02, 120);
  if (net) {
    // мягкий удар в сетку, шорох
    mode(b, dst, t + 0.06, 95, 0.4 * a, 0.06, 70);
    burst(b, dst, t + 0.06, 'bandpass', 900, 0.6, 0.12 * a, 0.08);
    if (full) {
      // стук о шары, что уже в сетке
      const tt = t + 0.07;
      mode(b, dst, tt, 2500 * rnd(0.05), 0.18 * a, 0.01);
      mode(b, dst, tt, 4000 * rnd(0.05), 0.1 * a, 0.006);
    }
  } else {
    // карман и жёлоб под столом: глухой удар и укатывание со стуками
    mode(b, dst, t + 0.05, 85, 0.5 * a, 0.07, 60);
    burst(b, dst, t + 0.05, 'lowpass', 400, 0.8, 0.25 * a, 0.05);
    const rs = b.ctx.createBufferSource();
    rs.buffer = b.noise;
    const f = b.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 260;
    const g = b.ctx.createGain();
    g.gain.setValueAtTime(0, t + 0.25);
    g.gain.linearRampToValueAtTime(0.22 * a, t + 0.4);
    g.gain.linearRampToValueAtTime(0, t + 1.1);
    rs.connect(f).connect(g).connect(dst);
    rs.start(t + 0.25, Math.random() * 0.3, 0.9);
    for (const k of [0.75, 1.05]) {
      mode(b, dst, t + k, 2200 * rnd(0.06), 0.06 * a, 0.008);
      mode(b, dst, t + k, 380, 0.08 * a, 0.02);
    }
  }
}

/** Шорох качения: уровень 0…1 (сумма скоростей шаров), вызывать каждый кадр анимации; 0 — тишина. */
export function rolling(lv: number) {
  const b = get();
  if (!b) return;
  if (!b.roll && lv > 0.01) {
    const src = b.ctx.createBufferSource();
    src.buffer = b.noise;
    src.loop = true;
    const lp = b.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 380;
    const bp = b.ctx.createBiquadFilter();
    bp.type = 'peaking';
    bp.frequency.value = 140;
    bp.gain.value = 8;
    const gain = b.ctx.createGain();
    gain.gain.value = 0;
    src.connect(lp).connect(bp).connect(gain).connect(b.dry);
    src.start();
    b.roll = { src, gain };
  }
  if (b.roll) {
    b.roll.gain.gain.setTargetAtTime(Math.min(1, lv) * 0.16, b.ctx.currentTime, 0.06);
    if (lv <= 0.01) {
      const r = b.roll;
      b.roll = null;
      r.gain.gain.setTargetAtTime(0, b.ctx.currentTime, 0.08);
      r.src.stop(b.ctx.currentTime + 0.5);
    }
  }
}
