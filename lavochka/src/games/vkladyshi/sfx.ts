/* «Вкладыши»: звуки стола — шлепок вкладыша о лавочку, удар, уход, шуршание обёртки жвачки. Файлы — Stable Audio SFX
 * (studio/jobs/vkladyshi/02-sfx.yaml → public/vkladyshi/a/sfx/<имя>-1|2.ogg); пока файла нет — короткий синтез из общего микшера.
 * Выключатель 🔊 и громкость — общие (core/audio), музыка (♪) — отдельно. */
import { audioOut, click, tone } from '../../core/audio';

const DIR = '/vkladyshi/a/sfx/';
export type Sfx = 'place' | 'spell' | 'hit' | 'die' | 'turn' | 'win' | 'lose' | 'wrap' | 'coin';

const cache = new Map<string, Promise<AudioBuffer | null>>();
function buffer(ctx: AudioContext, file: string): Promise<AudioBuffer | null> {
  let p = cache.get(file);
  if (!p) {
    p = fetch(DIR + file)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.statusText))))
      .then((b) => ctx.decodeAudioData(b))
      .catch(() => null);
    cache.set(file, p);
  }
  return p;
}

function synth(name: Sfx, t: number) {
  switch (name) {
    case 'place':
      click(t, { freq: 900, q: 1.5, dur: 0.06, gain: 0.6 });
      tone(t, { freq: 160, to: 80, dur: 0.08, gain: 0.25 });
      break;
    case 'spell':
      tone(t, { freq: 660, to: 990, dur: 0.18, gain: 0.15, type: 'triangle' });
      break;
    case 'hit':
      click(t, { freq: 1600, q: 2, dur: 0.05, gain: 0.7 });
      tone(t, { freq: 120, to: 60, dur: 0.1, gain: 0.35 });
      break;
    case 'die':
      tone(t, { freq: 300, to: 90, dur: 0.25, gain: 0.2, type: 'sawtooth' });
      break;
    case 'turn':
      tone(t, { freq: 880, dur: 0.08, gain: 0.12, type: 'triangle' });
      break;
    case 'win':
      [523, 659, 784, 1046].forEach((f, i) => tone(t + i * 0.11, { freq: f, dur: 0.16, gain: 0.18, type: 'triangle' }));
      break;
    case 'lose':
      [392, 330, 262].forEach((f, i) => tone(t + i * 0.16, { freq: f, dur: 0.22, gain: 0.16, type: 'triangle' }));
      break;
    case 'wrap':
      for (let i = 0; i < 9; i++) click(t + i * 0.035 + Math.random() * 0.02, { freq: 3500 + Math.random() * 3000, q: 1.2, dur: 0.03, gain: 0.25 });
      break;
    case 'coin':
      tone(t, { freq: 1800, dur: 0.07, gain: 0.12, type: 'square' });
      tone(t + 0.07, { freq: 2400, dur: 0.12, gain: 0.1, type: 'square' });
      break;
  }
}

/** Сыграть звук (случайный из двух вариантов файла, иначе синтез). */
export function sfx(name: Sfx, vol = 1) {
  const o = audioOut();
  if (!o) return;
  void buffer(o.ctx, `${name}-${Math.random() < 0.5 ? 1 : 2}.ogg`).then((buf) => {
    if (!buf) return synth(name, o.ctx.currentTime);
    const src = o.ctx.createBufferSource();
    src.buffer = buf;
    const g = o.ctx.createGain();
    g.gain.value = vol;
    src.connect(g).connect(o.out);
    src.start();
  });
}
