/* Снимок мира ГОПС для восстановления после рассинхрона: хозяин сохраняет, остальные накладывают на свой мир.
 * Маска — длины серий uint32 LE в base64 (как уровни из export_levels.py, первая серия — воздух), остальное — JSON как есть. */
import type { Mask } from './mask';
import type { World } from './world';

export interface Snapshot {
  mask: string;
  rng: number;
  /** Все прочие поля мира (без маски, rng и событий кадра). */
  rest: Record<string, unknown>;
}

function encodeMask(m: Mask): string {
  const runs: number[] = [];
  let cur = 0, n = 0;
  for (let i = 0; i < m.d.length; i++) {
    if (m.d[i] === cur) n++;
    else {
      runs.push(n);
      cur = m.d[i];
      n = 1;
    }
  }
  runs.push(n);
  const bytes = new Uint8Array(runs.length * 4);
  const dv = new DataView(bytes.buffer);
  runs.forEach((r, i) => dv.setUint32(i * 4, r, true));
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function decodeInto(m: Mask, b64: string): void {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const dv = new DataView(bytes.buffer);
  let pos = 0;
  for (let i = 0; i * 4 < bytes.length; i++) {
    const n = dv.getUint32(i * 4, true);
    m.d.fill(i & 1, pos, pos + n);
    pos += n;
  }
}

export function takeSnapshot(w: World): Snapshot {
  const { mask, rng, events, ...rest } = w;
  void events;
  // глубокая копия через JSON: снимок не должен меняться вместе с миром
  return { mask: encodeMask(mask), rng: rng.s, rest: JSON.parse(JSON.stringify(rest)) };
}

/** Наложить снимок на мир на месте: та же маска (её объект держит отрисовка), те же ссылки на мир. */
export function applySnapshot(w: World, s: Snapshot): void {
  decodeInto(w.mask, s.mask);
  w.rng.s = s.rng >>> 0;
  Object.assign(w, s.rest);
  w.events = [];
}
