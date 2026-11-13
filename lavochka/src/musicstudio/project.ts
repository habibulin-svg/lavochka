// Lavochka Music Studio — модель проекта (без DOM): дорожки, блоки сэмплов на сетке тактов, правила вставки,
// эффекты дорожек и свои грувы (Groove Generator).
// Как в Dance eJay: блок стоит на дорожке с такта `bar` и звучит `bars` тактов; на одной дорожке блоки не перекрываются.

export type Group = 'loop' | 'drum' | 'bass' | 'layer' | 'keys' | 'seq' | 'synth' | 'fx' | 'rap' | 'voice' | 'groove';

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
  /** Свой грув (Groove Generator) и подпись его рисунка — ключ кэша звука. */
  groove?: Groove;
  sig?: string;
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

/** Эффекты дорожки (как микшер Dance eJay 2): эхо в такт, реверб, фильтр одной ручкой. */
export interface TrackFx {
  echo: number; // 0..1 — сколько отправить в эхо (и длина хвоста)
  time: number; // индекс ECHO_TIMES
  reverb: number; // 0..1
  filter: number; // -1..1: влево — срезать верх (НЧ-фильтр), вправо — срезать низ (ВЧ-фильтр), 0 — выкл
}

export const ECHO_TIMES = [
  { beats: 0.5, label: '1/8' },
  { beats: 0.75, label: '3/16' },
  { beats: 1, label: '1/4' },
  { beats: 1.5, label: '3/8' },
] as const;

export interface Track {
  vol: number; // 0..1.5
  pan: number; // -1..1
  mute: boolean;
  solo: boolean;
  fx: TrackFx;
}

export interface Block {
  id: number;
  track: number;
  bar: number;
  sample: string;
}

/** Строка грува: звук (id удара из GROOVE_ROWS) и рисунок — по символу на шаг: `.` пусто, `x` удар, `X` акцент. */
export interface GrooveRow {
  sound: string;
  pat: string;
}

export interface Groove {
  id: string; // `~g<N>`
  name: string;
  bars: 1 | 2;
  swing: number; // 0..0.5 — запаздывание нечётных шестнадцатых (доля шага)
  rows: GrooveRow[];
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
  grooves: Groove[];
}

export const TRACKS = 16;
export const MIN_BARS = 32;
export const MAX_BARS = 256;
export const MAX_GROOVES = 32;
export const STEPS = 16; // шагов в такте

export const FILTER_DEAD = 0.02;
export const newFx = (): TrackFx => ({ echo: 0, time: 1, reverb: 0, filter: 0 });
export const fxOn = (f: TrackFx): boolean => f.echo > 0 || f.reverb > 0 || Math.abs(f.filter) >= FILTER_DEAD;

/** Ручка фильтра → тип, частота среза и добротность (DJ-фильтр: чем дальше ручка, тем резче «квак»). */
export function filterParams(f: number, nyquist: number): { type: 'lowpass' | 'highpass'; freq: number; q: number } {
  if (Math.abs(f) < FILTER_DEAD) return { type: 'lowpass', freq: nyquist, q: 0.5 };
  const k = Math.min(1, Math.abs(f));
  const q = 0.8 + 4 * k;
  return f < 0
    ? { type: 'lowpass', freq: Math.min(nyquist, 20000 * Math.pow(150 / 20000, k)), q }
    : { type: 'highpass', freq: 30 * Math.pow(4000 / 30, k), q };
}

/** Время эха в секундах — в такт темпу. */
export const echoSec = (fx: TrackFx, bpm: number): number => (ECHO_TIMES[fx.time]?.beats ?? 0.75) * 60 / bpm;
/** Обратная связь эха: чем больше ручка, тем длиннее хвост. */
export const echoFeedback = (fx: TrackFx): number => 0.2 + 0.4 * fx.echo;

export function newTrack(): Track {
  return { vol: 1, pan: 0, mute: false, solo: false, fx: newFx() };
}

export function newProject(kit: Kit, bpm = kit.bpms[0], name = 'Новый трек'): Project {
  return {
    v: 1, name, kit: kit.id, bpm, bars: 64, master: 0.9,
    tracks: Array.from({ length: TRACKS }, newTrack), blocks: [], loop: null, nextId: 1, grooves: [],
  };
}

// ── Groove Generator ────────────────────────────────────────────────────────
// Удары нарезаются из рисунков группы `drum` кита: известно, на каком шаге рисунка стоит первый удар (kit/drums.py).
export interface Hit {
  id: string;
  name: string;
  src: string; // id сэмпла кита
  step: number; // шаг первого удара в сэмпле
  len: number; // сколько шагов брать (дальше — следующий удар рисунка)
}

const letters = (s: string) => [...s];
const hits = (ids: string, name: (k: string) => string, src: (k: string) => string, step: number, len: number, id: (k: string) => string): Hit[] =>
  letters(ids).map(k => ({ id: id(k), name: name(k), src: src(k), step, len }));
const lc = (k: string) => k.toLowerCase();

export const GROOVE_ROWS: { title: string; hits: Hit[] }[] = [
  { title: 'Бочка', hits: hits('ABCDEFGHIJKL', k => `Бочка ${k}`, k => `kick-${lc(k)}-half`, 0, 8, k => `kick-${lc(k)}`) },
  { title: 'Хлопок', hits: [...hits('ABCDEFGH', k => `Хлопок ${k}`, k => `clap-${lc(k)}`, 4, 8, k => `clap-${lc(k)}`),
    ...hits('AB', k => `Щелчок ${k}`, k => `snap-${lc(k)}`, 4, 8, k => `snap-${lc(k)}`)] },
  { title: 'Малый', hits: [...hits('ABCDEFGH', k => `Малый ${k}`, k => `snare-${lc(k)}-beat`, 4, 8, k => `snare-${lc(k)}`),
    ...hits('ABC', k => `Римшот ${k}`, k => `rimshot-${lc(k)}`, 3, 3, k => `rim-${lc(k)}`)] },
  { title: 'Хэт', hits: hits('ABCDEFGHIJ', k => `Хэт ${k}`, k => `hihat-${lc(k)}-offbeat`, 2, 4, k => `hat-${lc(k)}`) },
  { title: 'Открытый хэт', hits: hits('ABCDEF', k => `Открытый ${k}`, k => `open-hat-${lc(k)}`, 2, 4, k => `ohat-${lc(k)}`) },
  { title: 'Шейкер', hits: [...hits('ABCD', k => `Шейкер ${k}`, k => `shaker-${lc(k)}`, 1, 1, k => `shaker-${lc(k)}`),
    ...hits('ABCD', k => `Бубен ${k}`, k => `tambourine-${lc(k)}`, 4, 8, k => `tamb-${lc(k)}`)] },
  { title: 'Перкуссия', hits: [
    ...hits('ABC', k => `Конга ${k} низ`, k => `conga-${lc(k)}`, 0, 2, k => `conga-${lc(k)}`),
    ...hits('ABC', k => `Конга ${k} верх`, k => `conga-${lc(k)}`, 2, 1, k => `conga-${lc(k)}-hi`),
    ...hits('ABC', k => `Бонго ${k}`, k => `bongo-${lc(k)}`, 0, 2, k => `bongo-${lc(k)}`),
    ...hits('ABC', k => `Ковбелл ${k}`, k => `cowbell-${lc(k)}`, 2, 4, k => `cowbell-${lc(k)}`),
    ...hits('AB', k => `Клаве ${k}`, k => `clave-${lc(k)}`, 0, 3, k => `clave-${lc(k)}`),
    { id: 'tom-lo', name: 'Том низкий', src: 'tom-fill-up', step: 0, len: 2 },
    { id: 'tom-mid', name: 'Том средний', src: 'tom-fill-up', step: 4, len: 2 },
    { id: 'tom-hi', name: 'Том высокий', src: 'tom-fill-up', step: 8, len: 2 },
    ...hits('AB', k => `Зап ${k}`, k => `zap-${lc(k)}`, 4, 8, k => `zap-${lc(k)}`),
  ] },
  { title: 'Тарелка', hits: [...hits('ABCD', k => `Райд ${k}`, k => `ride-${lc(k)}-offbeat`, 2, 4, k => `ride-${lc(k)}`),
    ...hits('ABCDEF', k => `Крэш ${k}`, k => `crash-${lc(k)}`, 0, 16, k => `crash-${lc(k)}`)] },
];

export const hitById = new Map(GROOVE_ROWS.flatMap(r => r.hits.map(h => [h.id, h] as const)));

/** Готовые рисунки (по строкам GROOVE_ROWS; 16 шагов, для двух тактов повторяются). */
export const GROOVE_PRESETS: { id: string; title: string; swing: number; rows: [string, string][] }[] = [
  { id: 'house', title: 'Хаус', swing: 0, rows: [
    ['kick-b', 'X...X...X...X...'], ['clap-a', '....X.......X...'], ['snare-a', '................'], ['hat-a', 'x.x.x.x.x.x.x.x.'],
    ['ohat-a', '..x...x...x...x.'], ['shaker-a', '.x.x.x.x.x.x.x.x'], ['conga-a', '................'], ['ride-a', '................']] },
  { id: 'euro', title: 'Евродэнс', swing: 0, rows: [
    ['kick-a', 'X...X...X...X...'], ['clap-b', '....x.......x...'], ['snare-b', '....X.......X...'], ['hat-c', 'xxXxxxXxxxXxxxXx'],
    ['ohat-b', '..x...x...x...x.'], ['tamb-a', '................'], ['tom-lo', '................'], ['crash-a', 'x...............']] },
  { id: 'breaks', title: 'Брейкбит', swing: 0.08, rows: [
    ['kick-c', 'X.x.......X.....'], ['clap-c', '................'], ['snare-c', '....X..x.x..X..x'], ['hat-b', 'x.x.x.x.x.x.xxx.'],
    ['ohat-c', '..............x.'], ['shaker-b', '................'], ['bongo-a', '......x.......x.'], ['ride-b', '................']] },
  { id: 'trance', title: 'Транс', swing: 0, rows: [
    ['kick-d', 'X...X...X...X...'], ['clap-d', '....X.......X...'], ['snare-d', '................'], ['hat-d', 'xxXxxxXxxxXxxxXx'],
    ['ohat-d', '..X...X...X...X.'], ['shaker-c', '................'], ['zap-a', '...............x'], ['ride-c', 'x.x.x.x.x.x.x.x.']] },
  { id: 'garage', title: 'Гараж (2-step)', swing: 0.25, rows: [
    ['kick-e', 'X......x..X.....'], ['clap-e', '................'], ['rim-a', '....X.......X...'], ['hat-e', '..x...x...x...x.'],
    ['ohat-e', '................'], ['shaker-d', 'xxxxxxxxxxxxxxxx'], ['conga-b-hi', '.........x.....x'], ['ride-d', '................']] },
  { id: 'hard', title: 'Хард-дэнс', swing: 0, rows: [
    ['kick-k', 'X...X...X...X.x.'], ['clap-f', '....X.......X...'], ['snare-e', '...............x'], ['hat-f', 'xxXxxxXxxxXxxxXx'],
    ['ohat-f', '..x...x...x...x.'], ['tamb-b', '....x.......x...'], ['cowbell-a', '..x.....x.......'], ['crash-b', '................']] },
];

const SOUND_DEFAULT = ['kick-a', 'clap-a', 'snare-a', 'hat-a', 'ohat-a', 'shaker-a', 'conga-a', 'ride-a'];

export function newGroove(id: string, name: string, bars: 1 | 2 = 1): Groove {
  return { id, name, bars, swing: 0, rows: SOUND_DEFAULT.map(sound => ({ sound, pat: '.'.repeat(bars * STEPS) })) };
}

/** Применить готовый рисунок (звуки и шаги; для двух тактов — повтор). */
export function applyPreset(g: Groove, presetId: string): void {
  const pr = GROOVE_PRESETS.find(x => x.id === presetId);
  if (!pr) return;
  g.swing = pr.swing;
  g.rows = pr.rows.map(([sound, pat]) => ({ sound, pat: pat.repeat(g.bars) }));
}

/** Сменить длину: 1 → 2 такта — второй такт копией первого, 2 → 1 — обрезать. */
export function setGrooveBars(g: Groove, bars: 1 | 2): void {
  if (g.bars === bars) return;
  for (const r of g.rows) r.pat = bars === 2 ? r.pat + r.pat : r.pat.slice(0, STEPS);
  g.bars = bars;
}

/** Щелчок по шагу: пусто → удар → акцент → пусто. */
export function cycleStep(g: Groove, row: number, step: number): void {
  const r = g.rows[row];
  if (!r || step < 0 || step >= r.pat.length) return;
  const c = r.pat[step];
  const n = c === '.' ? 'x' : c === 'x' ? 'X' : '.';
  r.pat = r.pat.slice(0, step) + n + r.pat.slice(step + 1);
}

export const grooveEmpty = (g: Groove): boolean => g.rows.every(r => !/[xX]/.test(r.pat));
export const grooveSig = (g: Groove): string => `${g.bars}|${g.swing}|${g.rows.map(r => `${r.sound}:${r.pat}`).join(',')}`;

export function grooveSample(g: Groove): KitSample {
  return { id: g.id, name: g.name, group: 'groove', bars: g.bars, loop: true, chord: null, star: 0, family: null, groove: g, sig: grooveSig(g) };
}

/** Свободный id для нового грува. */
export function nextGrooveId(p: Project): string {
  let n = 1;
  while (p.grooves.some(g => g.id === `~g${n}`)) n++;
  return `~g${n}`;
}

/** Сэмплы кита, из которых режутся удары грува. */
export const grooveSources = (g: Groove): string[] => [...new Set(g.rows.flatMap(r => (/[xX]/.test(r.pat) ? [hitById.get(r.sound)?.src ?? ''] : [])).filter(Boolean))];

/**
 * Свести грув в звук (без WebAudio — чистые массивы): удары режутся из сэмплов кита и раскладываются по шагам,
 * удар звучит до следующего удара своей строки (или до конца своего куска), конец мягко гасится, хвост за краем
 * заворачивается в начало — грув играет петлёй без щелчка.
 * `src(id)` — каналы сэмпла кита той же частоты `sr` (или null — не загружен).
 */
export function renderGroove(g: Groove, bpm: number, sr: number, src: (id: string) => Float32Array[] | null): Float32Array[] {
  const stepLen = (240 / bpm / STEPS) * sr;
  const total = Math.round(g.bars * STEPS * stepLen);
  const out = [new Float32Array(total), new Float32Array(total)];
  const fade = Math.round(0.004 * sr);
  const steps = g.bars * STEPS;
  for (const r of g.rows) {
    const h = hitById.get(r.sound);
    if (!h) continue;
    const ch = src(h.src);
    if (!ch?.length) continue;
    const on = [...r.pat.slice(0, steps)].map((c, i) => (c === 'x' || c === 'X' ? i : -1)).filter(i => i >= 0);
    on.forEach((i, k) => {
      const gap = k + 1 < on.length ? on[k + 1] - i : on[0] + steps - i; // до следующего удара строки (по кругу)
      const swing = i % 2 ? g.swing * stepLen : 0;
      const at = Math.round(i * stepLen + swing);
      const from = Math.round(h.step * stepLen);
      const len = Math.min(Math.round(Math.min(h.len, gap) * stepLen), ch[0].length - from);
      if (len <= 0) return;
      const gain = r.pat[i] === 'X' ? 0.9 : 0.65;
      for (let c = 0; c < 2; c++) {
        const s = ch[Math.min(c, ch.length - 1)];
        const o = out[c];
        for (let j = 0; j < len; j++) {
          const env = j > len - fade ? (len - j) / fade : 1;
          o[(at + j) % total] += s[from + j] * gain * env;
        }
      }
    });
  }
  return out;
}

const GROOVE_ID = /^~g\d{1,3}$/;

export function parseGroove(raw: unknown): Groove | null {
  const o = (raw && typeof raw === 'object' ? raw : null) as Record<string, unknown> | null;
  if (!o || typeof o.id !== 'string' || !GROOVE_ID.test(o.id)) return null;
  const bars: 1 | 2 = o.bars === 2 ? 2 : 1;
  const g = newGroove(o.id, typeof o.name === 'string' && o.name.trim() ? o.name.slice(0, 40) : 'Грув', bars);
  g.swing = clamp(o.swing, 0, 0.5, 0);
  if (Array.isArray(o.rows)) {
    GROOVE_ROWS.forEach((row, i) => {
      const r = (o.rows as unknown[])[i] as Record<string, unknown> | undefined;
      if (!r) return;
      if (typeof r.sound === 'string' && row.hits.some(h => h.id === r.sound)) g.rows[i].sound = r.sound;
      if (typeof r.pat === 'string') g.rows[i].pat = r.pat.replace(/[^.xX]/g, '.').padEnd(bars * STEPS, '.').slice(0, bars * STEPS);
    });
  }
  return g;
}

export class KitIndex {
  readonly byId = new Map<string, KitSample>();
  /** Грувы текущего проекта как «сэмплы» (id `~g<N>`). */
  readonly grooves = new Map<string, KitSample>();
  constructor(readonly kit: Kit) {
    for (const s of kit.samples) this.byId.set(s.id, s);
  }
  get(id: string): KitSample | undefined {
    return this.byId.get(id) ?? this.grooves.get(id);
  }
  /** Подхватить грувы проекта (после загрузки, отмены, правки грува). */
  useProject(p: Project): void {
    this.grooves.clear();
    for (const g of p.grooves) this.grooves.set(g.id, grooveSample(g));
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

/**
 * Записать грув в проект: новый — добавить; существующий — заменить рисунок. Если у грува, который уже стоит
 * на дорожках, поменялась длина, блоки, которые теперь налезли бы на соседей, убираются (их число — в ответе).
 */
export function saveGroove(p: Project, ix: KitIndex, g: Groove): number {
  const i = p.grooves.findIndex(x => x.id === g.id);
  if (i < 0) p.grooves.push(g);
  else p.grooves[i] = g;
  ix.useProject(p);
  let dropped = 0;
  for (const b of [...p.blocks]) {
    if (b.sample !== g.id) continue;
    if (!canPlace(p, ix, b.track, b.bar, b.sample, b.id)) {
      remove(p, b.id);
      dropped++;
    }
  }
  return dropped;
}

/** Убрать грув из библиотеки вместе с его блоками. */
export function deleteGroove(p: Project, ix: KitIndex, id: string): void {
  p.grooves = p.grooves.filter(g => g.id !== id);
  p.blocks = p.blocks.filter(b => b.sample !== id);
  ix.useProject(p);
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

function clamp(x: unknown, lo: number, hi: number, d: number): number {
  return typeof x === 'number' && Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : d;
}

/** Проект из JSON (сохранение, ссылка): всё проверяется, неизвестные сэмплы выбрасываются; старые записи без эффектов и грувов открываются. */
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
      const f = (r.fx && typeof r.fx === 'object' ? r.fx : {}) as Record<string, unknown>;
      p.tracks[i] = {
        vol: clamp(r.vol, 0, 1.5, 1), pan: clamp(r.pan, -1, 1, 0), mute: r.mute === true, solo: r.solo === true,
        fx: {
          echo: clamp(f.echo, 0, 1, 0), time: clamp(f.time, 0, ECHO_TIMES.length - 1, 1) | 0,
          reverb: clamp(f.reverb, 0, 1, 0), filter: clamp(f.filter, -1, 1, 0),
        },
      };
    });
  }
  if (Array.isArray(o.grooves)) {
    for (const g of o.grooves.slice(0, MAX_GROOVES)) {
      const q = parseGroove(g);
      if (q && !p.grooves.some(x => x.id === q.id)) p.grooves.push(q);
    }
  }
  ix.useProject(p);
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

const r2 = (x: number) => +x.toFixed(2);

/** Компактная запись для сохранения и ссылки «поделиться» (эффекты и грувы — только если есть). */
export function serialize(p: Project): string {
  return JSON.stringify({
    v: 1, name: p.name, kit: p.kit, bpm: p.bpm, bars: p.bars, master: p.master, loop: p.loop,
    tracks: p.tracks.map(t => ({
      vol: r2(t.vol), pan: r2(t.pan), ...(t.mute ? { mute: true } : {}), ...(t.solo ? { solo: true } : {}),
      ...(fxOn(t.fx) || t.fx.time !== 1 ? { fx: { echo: r2(t.fx.echo), time: t.fx.time, reverb: r2(t.fx.reverb), filter: r2(t.fx.filter) } } : {}),
    })),
    blocks: p.blocks.map(b => ({ track: b.track, bar: b.bar, sample: b.sample })),
    ...(p.grooves.length
      ? { grooves: p.grooves.map(g => ({ id: g.id, name: g.name, bars: g.bars, swing: r2(g.swing), rows: g.rows.map(r => ({ sound: r.sound, pat: r.pat })) })) }
      : {}),
  });
}
