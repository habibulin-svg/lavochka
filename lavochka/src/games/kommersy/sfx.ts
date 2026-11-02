/* «Коммерсы»: звуки клеток, сделок, событий и падений — Stable Audio 3 SFX (studio/jobs/kommersy/08-sfx.yaml), по два варианта.
 * Играют через общий микшер (core/audio): выключатель 🔊 и громкость — общие, музыка (♪) — отдельно. */
import { audioOut } from '../../core/audio';

const DIR = '/kommersy/a/sfx/';

export type Sfx =
  | 'cell-deal' | 'cell-routine' | 'cell-study' | 'cell-rest' | 'cell-news' | 'cell-event' | 'cell-naezd' | 'cell-check' | 'cell-period'
  | 'buy' | 'sell' | 'dark' | 'hist'
  | 'fall-razor' | 'fall-jail' | 'fall-pokushenie' | 'fall-zapoi' | 'out-hosp' | 'club';

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

/** Сыграть звук (случайный из двух вариантов); vol — доля от общей громкости. */
export function sfx(name: Sfx, vol = 1) {
  const o = audioOut();
  if (!o) return;
  void buffer(o.ctx, `${name}-${Math.random() < 0.5 ? 1 : 2}.ogg`).then((buf) => {
    if (!buf) return;
    const src = o.ctx.createBufferSource();
    src.buffer = buf;
    const g = o.ctx.createGain();
    g.gain.value = vol;
    src.connect(g).connect(o.out);
    src.start();
  });
}
