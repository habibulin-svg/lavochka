/* «Коммерсы»: голос Коляна — ElevenLabs v4 (решение пользователя 2026-11-11; studio/jobs/kommersy/10-kolyan-voice.json →
 * studio/post/stress.py → runners/tts_eleven.py → studio/post/pack_voices.py). Реплики не накладываются; через общий микшер (🔊), как звуки. */
import { audioOut } from '../../core/audio';
import type { Event, View } from './engine';
import counts from './voice.json';

const DIR = '/kommersy/a/voice/';
const N = counts as Record<string, number>;
const cache = new Map<string, Promise<AudioBuffer | null>>();
let busyUntil = 0;

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

/** Сказать реплику ситуации key (случайную из набора). force — перебить очередь (падения, история, клуб). */
export function say(key: string, force = false) {
  const n = N[key];
  const o = audioOut();
  if (!n || !o) return;
  const now = o.ctx.currentTime;
  if (!force && now < busyUntil) return;
  busyUntil = now + 2.5;
  const i = 1 + Math.floor(Math.random() * n);
  void buffer(o.ctx, `${key}-${String(i).padStart(2, '0')}.ogg`).then((buf) => {
    if (!buf) return;
    const src = o.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(o.out);
    src.start();
    busyUntil = Math.max(busyUntil, o.ctx.currentTime + buf.duration + 0.3);
  });
}

/** Второй сезон: у части дат есть и общие реплики ситуации — через раз говорит их. */
const HIST_ALT: Record<string, string> = { lehman: 'crash', 'crash-biz': 'crash', 'crash-dolgi': 'crash_bottom', tolmachevo: 'it_start', bolezn: 'ill' };

/** Что сказал бы Колян (место seat) на событие: old — вид до событий, v — после. */
export function voiceKey(ev: Event, seat: number, old: View | null, v: View): [string, boolean] | null {
  const me = (x: View | null) => x?.players.find((p) => p.seat === seat);
  switch (ev.t) {
    case 'hist':
      return [HIST_ALT[ev.id] && Math.random() < 0.5 ? HIST_ALT[ev.id] : `h_${ev.id.replace(/-/g, '_')}`, true];
    case 'over': {
      if (ev.season !== 2) return me(v)?.club ? null : ['over', true];
      const e = me(v)?.ending;
      return [e === 'island' || e === 'tyndex' ? e : 'over_s2', true];
    }
    case 'auction':
    case 'resold':
    case 'risk':
    case 'buy':
    case 'sell':
      return ev.seat === seat ? [ev.t, false] : null;
    case 'pick':
      return ev.seat === seat && ev.label === 'Мимо' ? ['pass', false] : null;
    case 'move':
      if (ev.seat !== seat) return null;
      if (ev.cell === 'transfer') return ['transfer', false];
      return ev.cell === 'naezd' || ev.cell === 'check' ? [ev.cell, false] : (ev.cell === 'study' || ev.cell === 'rest') && Math.random() < 0.5 ? [ev.cell, false] : null;
    case 'fall':
      return ev.seat === seat ? [`fall_${ev.kind}`, true] : null;
    case 'club':
      return ev.seat === seat ? ['club', true] : null;
    case 'buh':
      return ev.seat === seat ? [ev.ok ? 'buh_ok' : 'buh_bad', false] : null;
    case 'rival':
      return ev.seat === seat ? ['rival', false] : ev.target === seat ? ['rival_hit', false] : null;
    // второй сезон
    case 'match':
      return ev.seat === seat ? [ev.win ? 'match_win' : 'match_lose', false] : null;
    case 'tour':
      return ev.seat === seat && ev.final && ev.trophies?.length ? ['trophy', true] : null;
    case 'venture':
      if (ev.seat !== seat) return null;
      return !ev.ok ? ['venture_bad', false] : ev.stage >= 4 ? ['venture_exit', true] : Math.random() < 0.5 ? ['venture_ok', false] : null;
    case 'btc':
      if (ev.seat !== seat) return null;
      // продал дороже, чем в среднем покупали в 2010-х ($1000), — довольный, дешевле — досада
      return ev.buy ? ['btc_buy', false] : [ev.price >= 1000 ? 'btc_up' : 'btc_down', false];
    case 'health':
      return ev.seat === seat && ev.ok ? ['health_ok', true] : null;
    case 'period': {
      const a = me(old);
      const b = me(v);
      if (!a || !b) return null;
      if (a.out > 0 && b.out === 0) return ['back', false];
      if (Math.random() < 0.6) return null;
      return [b.cash >= a.cash ? 'period_up' : 'period_down', false];
    }
  }
  return null;
}
