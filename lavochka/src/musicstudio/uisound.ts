// Звуки интерфейса студии: тихие щелчки «железного» пульта. Свой AudioContext — отдельно от музыки трека (engine.ts),
// громкость и выключатель свои (запоминаются), на сведение в WAV и на трек не влияют.
import { store } from '../core/settings';

export type UiSound = 'click' | 'tab' | 'pick' | 'drop' | 'bad' | 'del' | 'open' | 'close' | 'toggle';

let ctx: AudioContext | null = null;
let out: GainNode | null = null;
let noise: AudioBuffer | null = null;
let enabled = store.get('musicstudio.uisound', true);
const VOLUME = 0.22;

export const uiSoundOn = (): boolean => enabled;

export function setUiSound(on: boolean): void {
  enabled = on;
  store.set('musicstudio.uisound', on);
}

function ensure(): AudioContext | null {
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    out = ctx.createGain();
    out.gain.value = VOLUME;
    out.connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate / 4, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** Щелчок: шум через полосовой фильтр (механика кнопки). */
function tick(c: AudioContext, t: number, freq: number, gain: number, dur = 0.025): void {
  const src = c.createBufferSource();
  src.buffer = noise;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq;
  bp.Q.value = 4;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(bp).connect(g).connect(out!);
  src.start(t, Math.random() * 0.1, dur + 0.01);
}

/** Тон: короткая нота с огибающей и скольжением высоты. */
function tone(c: AudioContext, t: number, f0: number, f1: number, dur: number, gain: number, type: OscillatorType = 'sine'): void {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out!);
  o.start(t);
  o.stop(t + dur + 0.02);
}

export function ui(s: UiSound): void {
  if (!enabled) return;
  const c = ensure();
  if (!c || !out) return;
  const t = c.currentTime + 0.005;
  switch (s) {
    case 'click':
      tick(c, t, 3200, 0.5);
      tone(c, t, 1800, 1500, 0.03, 0.08);
      break;
    case 'toggle':
      tick(c, t, 2400, 0.55, 0.03);
      tone(c, t, 1100, 1000, 0.05, 0.1, 'triangle');
      break;
    case 'tab':
      tick(c, t, 2000, 0.4);
      tone(c, t, 900, 1200, 0.05, 0.08, 'triangle');
      break;
    case 'pick': // взял сэмпл: короткий подъём
      tone(c, t, 520, 880, 0.07, 0.12, 'triangle');
      break;
    case 'drop': // положил: «щёлк» в гнездо
      tick(c, t, 1400, 0.6, 0.035);
      tone(c, t, 330, 180, 0.08, 0.2);
      break;
    case 'bad': // нельзя: два низких гудка
      tone(c, t, 180, 170, 0.07, 0.08, 'square');
      tone(c, t + 0.09, 150, 140, 0.09, 0.08, 'square');
      break;
    case 'del': // убрал: спад шума и тона
      tick(c, t, 1800, 0.35, 0.06);
      tone(c, t, 600, 220, 0.1, 0.1, 'triangle');
      break;
    case 'open': // окно: две ноты вверх (ля — ми)
      tone(c, t, 880, 880, 0.09, 0.07, 'triangle');
      tone(c, t + 0.06, 1318.5, 1318.5, 0.14, 0.07, 'triangle');
      break;
    case 'close':
      tone(c, t, 1318.5, 1318.5, 0.07, 0.06, 'triangle');
      tone(c, t + 0.05, 880, 880, 0.11, 0.06, 'triangle');
      break;
  }
}
