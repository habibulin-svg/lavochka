// Lavochka Music Studio — модель проекта (без DOM): дорожки, блоки сэмплов на сетке тактов, правила вставки.
// Как в Dance eJay: блок стоит на дорожке с такта `bar` и звучит `bars` тактов; на одной дорожке блоки не перекрываются.

export type Group = 'loop' | 'drum' | 'bass' | 'layer' | 'keys' | 'seq' | 'synth' | 'fx' | 'rap' | 'voice';

export interface KitSample {
  id: string;
  name: string;
  group: Group;
  bars: number;
  loop: boolean;
  chord: string | null; // аккорд последовательности (звёздочки) или null — ложится на любой
  star: number; // 1..4 — номер аккорда, 0 — нейтральный
  family: string | null;
  style?: string;
  text?: string;
}

export interface Kit {
  id: string;
  title: string;
  key: string;
  chords: string[];
  bpms: number[];
  groups: Group[];
  samples: KitSample[];
}

export interface Track {
  vol: number; // 0..1.5
  pan: number; // -1..1
  mute: boolean;
  solo: boolean;
}

export interface Block {
  id: number;
  track: number;
  bar: number;
  sample: string;
}

export interface Project {
  v: 1;
  name: string;
  kit: string;
  bpm: number;
  bars: number; // длина листа
  master: number;
  tracks: Track[];
  blocks: Block[];
  loop: { from: number; to: number } | null;
  nextId: number;
}

export const TRACKS = 16;
export const MIN_BARS = 32;
export const MAX_BARS = 256;

export function newTrack(): Track {
  return { vol: 1, pan: 0, mute: false, solo: false };
}

export function newProject(kit: Kit, bpm = kit.bpms[0], name = 'Новый трек'): Project {
  return {
    v: 1, name, kit: kit.id, bpm, bars: 64, master: 0.9,
    tracks: Array.from({ length: TRACKS }, newTrack), blocks: [], loop: null, nextId: 1,
  };
}

export class KitIndex {
  readonly byId = new Map<string, KitSample>();
  constructor(readonly kit: Kit) {
    for (const s of kit.samples) this.byId.set(s.id, s);
  }
  get(id: string): KitSample | undefined {
    return this.byId.get(id);
  }
  /** Сэмпл той же семьи на другом аккорде (`*` → `**` …). */
  sibling(id: string, star: number): KitSample | undefined {
    const s = this.byId.get(id);
    if (!s?.family) return undefined;
    return this.kit.samples.find(x => x.family === s.family && x.star === star && x.group === s.group);
  }
}

export function blockBars(ix: KitIndex, b: Block): number {
  return ix.get(b.sample)?.bars ?? 1;
}

/** Можно ли поставить сэмпл на дорожку с такта bar (не вылезает за лист, не перекрывает соседей). */
export function canPlace(p: Project, ix: KitIndex, track: number, bar: number, sample: string, ignore?: number): boolean {
  const s = ix.get(sample);
  if (!s || track < 0 || track >= p.tracks.length || bar < 0 || !Number.isInteger(bar)) return false;
  if (bar + s.bars > p.bars) return false;
  return !p.blocks.some(b => b.id !== ignore && b.track === track && b.bar < bar + s.bars && bar < b.bar + blockBars(ix, b));
}

export function place(p: Project, ix: KitIndex, track: number, bar: number, sample: string): Block | null {
  if (!canPlace(p, ix, track, bar, sample)) return null;
  const b = { id: p.nextId++, track, bar, sample };
  p.blocks.push(b);
  return b;
}

export function move(p: Project, ix: KitIndex, id: number, track: number, bar: number): boolean {
  const b = p.blocks.find(x => x.id === id);
  if (!b || !canPlace(p, ix, track, bar, b.sample, id)) return false;
  b.track = track;
  b.bar = bar;
  return true;
}

export function copy(p: Project, ix: KitIndex, id: number, track: number, bar: number): Block | null {
  const b = p.blocks.find(x => x.id === id);
  return b ? place(p, ix, track, bar, b.sample) : null;
}

export function remove(p: Project, id: number): boolean {
  const i = p.blocks.findIndex(x => x.id === id);
  if (i < 0) return false;
  p.blocks.splice(i, 1);
  return true;
}

/** Ближайший свободный такт справа (для «поставить после» и двойного щелчка в библиотеке). */
export function nextFree(p: Project, ix: KitIndex, track: number, from: number, sample: string): number | null {
  for (let bar = Math.max(0, from); bar < p.bars; bar++) if (canPlace(p, ix, track, bar, sample)) return bar;
  return null;
}

/** Последний звучащий такт (конец песни) — по нему экспорт и остановка. */
export function songEnd(p: Project, ix: KitIndex): number {
  return p.blocks.reduce((m, b) => Math.max(m, b.bar + blockBars(ix, b)), 0);
}

/** Какие блоки звучат в такте bar (с учётом mute/solo). */
export function audibleAt(p: Project, ix: KitIndex, bar: number): Block[] {
  const solo = p.tracks.some(t => t.solo);
  return p.blocks.filter(b => {
    const t = p.tracks[b.track];
    if (!t || t.mute || (solo && !t.solo)) return false;
    return b.bar <= bar && bar < b.bar + blockBars(ix, b);
  });
}

/** Аккорд такта по поставленным «звёздным» сэмплам (большинство); null — гармонии нет. */
export function chordAt(p: Project, ix: KitIndex, bar: number): string | null {
  const count = new Map<string, number>();
  for (const b of p.blocks) {
    const s = ix.get(b.sample);
    if (!s?.chord || bar < b.bar || bar >= b.bar + s.bars) continue;
    count.set(s.chord, (count.get(s.chord) ?? 0) + 1);
  }
  let best: string | null = null;
  let n = 0;
  for (const [c, k] of count) if (k > n) [best, n] = [c, k];
  return best;
}

/** Растянуть/сжать лист; блоки за краем не теряем — лист не короче песни. */
export function setBars(p: Project, ix: KitIndex, bars: number): void {
  p.bars = Math.max(MIN_BARS, Math.min(MAX_BARS, Math.max(Math.round(bars), songEnd(p, ix))));
}

const clamp = (x: unknown, lo: number, hi: number, d: number) =>
  typeof x === 'number' && Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : d;

/** Проект из JSON (сохранение, ссылка): всё проверяется, неизвестные сэмплы выбрасываются. */
export function parseProject(raw: unknown, kit: Kit): Project {
  const ix = new KitIndex(kit);
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const p = newProject(kit, kit.bpms.includes(o.bpm as number) ? (o.bpm as number) : kit.bpms[0],
    typeof o.name === 'string' ? o.name.slice(0, 60) : 'Новый трек');
  p.bars = clamp(o.bars, MIN_BARS, MAX_BARS, 64) | 0;
  p.master = clamp(o.master, 0, 1.5, 0.9);
  if (Array.isArray(o.tracks)) {
    o.tracks.slice(0, TRACKS).forEach((t, i) => {
      const r = (t ?? {}) as Record<string, unknown>;
      p.tracks[i] = { vol: clamp(r.vol, 0, 1.5, 1), pan: clamp(r.pan, -1, 1, 0), mute: r.mute === true, solo: r.solo === true };
    });
  }
  if (Array.isArray(o.blocks)) {
    for (const b of o.blocks) {
      const r = (b ?? {}) as Record<string, unknown>;
      if (typeof r.sample !== 'string') continue;
      const s = ix.get(r.sample);
      if (!s) continue;
      const bar = clamp(r.bar, 0, MAX_BARS, -1) | 0;
      const track = clamp(r.track, 0, TRACKS - 1, -1) | 0;
      if (bar + s.bars > p.bars) p.bars = Math.min(MAX_BARS, bar + s.bars);
      place(p, ix, track, bar, s.id);
    }
  }
  const lp = o.loop as Record<string, unknown> | null | undefined;
  if (lp && typeof lp === 'object') {
    const from = clamp(lp.from, 0, p.bars - 1, 0) | 0;
    const to = clamp(lp.to, from + 1, p.bars, from + 1) | 0;
    p.loop = { from, to };
  }
  return p;
}

/** Компактная запись для сохранения и ссылки «поделиться». */
export function serialize(p: Project): string {
  return JSON.stringify({
    v: 1, name: p.name, kit: p.kit, bpm: p.bpm, bars: p.bars, master: p.master, loop: p.loop,
    tracks: p.tracks.map(t => ({ vol: +t.vol.toFixed(2), pan: +t.pan.toFixed(2), ...(t.mute ? { mute: true } : {}), ...(t.solo ? { solo: true } : {}) })),
    blocks: p.blocks.map(b => ({ track: b.track, bar: b.bar, sample: b.sample })),
  });
}
