/* Симулятор дирижёра — партитура: формат JSON (public/dirizher/scores/<id>.json, пишет tools/dirizher/score.py
 * из MusicXML или из своих переложений), инструменты, группы-строки ленты, время «тик ↔ секунды» по карте темпа.
 * Без DOM и звука — это гоняют тесты. */

/** Тиков на четверть. */
export const PPQ = 480;

export type InstrId =
  | 'vn1' | 'vn2' | 'va' | 'vc' | 'cb'
  | 'picc' | 'fl' | 'ob' | 'eh' | 'cl' | 'bcl' | 'bn' | 'cbn'
  | 'hn' | 'tp' | 'tb' | 'tu'
  | 'timp' | 'perc' | 'harp' | 'cel';

export interface InstrInfo {
  id: InstrId;
  name: string;
  /** Звучащий диапазон (MIDI). */
  lo: number;
  hi: number;
  family: 'str' | 'ww' | 'br' | 'perc';
}

export const INSTR: Record<InstrId, InstrInfo> = {
  vn1: { id: 'vn1', name: 'Первые скрипки', lo: 55, hi: 100, family: 'str' },
  vn2: { id: 'vn2', name: 'Вторые скрипки', lo: 55, hi: 96, family: 'str' },
  va: { id: 'va', name: 'Альты', lo: 48, hi: 88, family: 'str' },
  vc: { id: 'vc', name: 'Виолончели', lo: 36, hi: 76, family: 'str' },
  cb: { id: 'cb', name: 'Контрабасы', lo: 28, hi: 60, family: 'str' },
  picc: { id: 'picc', name: 'Флейта-пикколо', lo: 74, hi: 108, family: 'ww' },
  fl: { id: 'fl', name: 'Флейты', lo: 60, hi: 96, family: 'ww' },
  ob: { id: 'ob', name: 'Гобои', lo: 58, hi: 91, family: 'ww' },
  eh: { id: 'eh', name: 'Английский рожок', lo: 52, hi: 84, family: 'ww' },
  cl: { id: 'cl', name: 'Кларнеты', lo: 50, hi: 91, family: 'ww' },
  bcl: { id: 'bcl', name: 'Бас-кларнет', lo: 34, hi: 72, family: 'ww' },
  bn: { id: 'bn', name: 'Фаготы', lo: 34, hi: 75, family: 'ww' },
  cbn: { id: 'cbn', name: 'Контрафагот', lo: 22, hi: 53, family: 'ww' },
  hn: { id: 'hn', name: 'Валторны', lo: 34, hi: 77, family: 'br' },
  tp: { id: 'tp', name: 'Трубы', lo: 54, hi: 84, family: 'br' },
  tb: { id: 'tb', name: 'Тромбоны', lo: 34, hi: 72, family: 'br' },
  tu: { id: 'tu', name: 'Туба', lo: 26, hi: 58, family: 'br' },
  timp: { id: 'timp', name: 'Литавры', lo: 38, hi: 57, family: 'perc' },
  perc: { id: 'perc', name: 'Ударные', lo: 0, hi: 127, family: 'perc' },
  harp: { id: 'harp', name: 'Арфа', lo: 24, hi: 103, family: 'perc' },
  cel: { id: 'cel', name: 'Челеста', lo: 60, hi: 108, family: 'perc' },
};

/** Ударные (perc): высота ноты — что бьём (General MIDI). */
export const PERC = { bass: 35, snare: 38, cymbal: 49, triangle: 81, tambourine: 54, bells: 84 } as const;

export interface PartJson {
  /** Как в партитуре: «Violin I», «Flute 1». */
  name: string;
  instr: InstrId;
  /** Плоско по 4: тик, длительность (тики), высота MIDI (звучащая), сила 1..127 + 128 × приём (1 коротко, 2 пиццикато). */
  notes: number[];
}

/** Особые места (ставятся руками в таблице пьес или переложением). */
export type SpecialKind = 'fermata' | 'accel' | 'rit' | 'cresc' | 'subito_p' | 'sforzando' | 'solo';

export interface SpecialJson {
  kind: SpecialKind;
  tick: number;
  /** Длина в тиках (фермата — сколько держать по партитуре, accel — участок). */
  len: number;
  /** solo: кто солирует; accel/rit: во сколько раз меняется темп к концу участка. */
  instr?: InstrId;
  to?: number;
  /** accel/rit: тап палочкой — раз в столько долей (по умолчанию на каждую). */
  every?: number;
}

export interface ScoreJson {
  id: string;
  title: string;
  composer: string;
  /** Откуда: «OpenScore Orchestra (CC0)», «своё переложение». */
  source: string;
  /** [тик, числитель, знаменатель]. */
  time: [number, number, number][];
  /** [тик, четвертей в минуту]. */
  tempo: [number, number][];
  /** Буквы/цифры репетиций [тик, метка]. */
  marks?: [number, string][];
  /** Конец пьесы, тик. */
  end: number;
  parts: PartJson[];
  specials?: SpecialJson[];
}

export interface Note {
  tick: number;
  dur: number;
  pitch: number;
  vel: number;
  /** Приём: 0 тянуть, 1 коротко, 2 пиццикато. */
  art: number;
}

export function notesOf(p: PartJson): Note[] {
  const out: Note[] = [];
  for (let i = 0; i + 3 < p.notes.length; i += 4) out.push({ tick: p.notes[i], dur: p.notes[i + 1], pitch: p.notes[i + 2], vel: p.notes[i + 3] & 127, art: p.notes[i + 3] >> 7 });
  return out;
}

// ---------------------------------------------------------------- строки ленты

export type LaneId = 'str' | 'wind' | 'perc' | 'ww' | 'br' | 'vn' | 'vavc' | 'bass' | 'vn1' | 'vn2' | 'va' | 'low' | 'hn' | 'tptb';

export interface LaneDef {
  id: LaneId;
  name: string;
  /** Короткая подпись на кнопке. */
  short: string;
  color: string;
  instr: InstrId[];
}

const L = (id: LaneId, name: string, short: string, color: string, instr: InstrId[]): LaneDef => ({ id, name, short, color, instr });

/** Раскладки строк по числу: 3 — первый сезон, 8 — финал. Каждый инструмент — ровно в одной строке. */
export const LANE_SETS: Record<3 | 4 | 6 | 8, LaneDef[]> = {
  3: [
    L('str', 'Струнные', 'Струнные', '#e0a040', ['vn1', 'vn2', 'va', 'vc', 'cb', 'harp']),
    L('wind', 'Духовые', 'Духовые', '#4aa0e0', ['picc', 'fl', 'ob', 'eh', 'cl', 'bcl', 'bn', 'cbn', 'hn', 'tp', 'tb', 'tu']),
    L('perc', 'Ударные', 'Ударные', '#d05050', ['timp', 'perc', 'cel']),
  ],
  4: [
    L('str', 'Струнные', 'Струнные', '#e0a040', ['vn1', 'vn2', 'va', 'vc', 'cb', 'harp']),
    L('ww', 'Деревянные', 'Дерево', '#58b868', ['picc', 'fl', 'ob', 'eh', 'cl', 'bcl', 'bn', 'cbn']),
    L('br', 'Медные', 'Медь', '#e8c040', ['hn', 'tp', 'tb', 'tu']),
    L('perc', 'Ударные', 'Ударные', '#d05050', ['timp', 'perc', 'cel']),
  ],
  6: [
    L('vn', 'Скрипки', 'Скрипки', '#e0a040', ['vn1', 'vn2', 'harp']),
    L('vavc', 'Альты и виолончели', 'Альты', '#c87830', ['va', 'vc']),
    L('bass', 'Контрабасы', 'Басы', '#9a5a28', ['cb']),
    L('ww', 'Деревянные', 'Дерево', '#58b868', ['picc', 'fl', 'ob', 'eh', 'cl', 'bcl', 'bn', 'cbn']),
    L('br', 'Медные', 'Медь', '#e8c040', ['hn', 'tp', 'tb', 'tu']),
    L('perc', 'Ударные', 'Ударные', '#d05050', ['timp', 'perc', 'cel']),
  ],
  8: [
    L('vn1', 'Первые скрипки', 'I скр.', '#f0b048', ['vn1', 'harp']),
    L('vn2', 'Вторые скрипки', 'II скр.', '#d89838', ['vn2']),
    L('va', 'Альты', 'Альты', '#c87830', ['va']),
    L('low', 'Виолончели и контрабасы', 'Басы', '#9a5a28', ['vc', 'cb']),
    L('ww', 'Деревянные', 'Дерево', '#58b868', ['picc', 'fl', 'ob', 'eh', 'cl', 'bcl', 'bn', 'cbn']),
    L('hn', 'Валторны', 'Валторны', '#e8d060', ['hn']),
    L('tptb', 'Трубы и тромбоны', 'Медь', '#e8a020', ['tp', 'tb', 'tu']),
    L('perc', 'Литавры и ударные', 'Ударные', '#d05050', ['timp', 'perc', 'cel']),
  ],
};

export type LaneCount = keyof typeof LANE_SETS;

export function laneOf(set: LaneDef[], instr: InstrId): number {
  return set.findIndex((l) => l.instr.includes(instr));
}

// ---------------------------------------------------------------- время

/** Карта темпа: тик ↔ секунды. Темп пьесы × множитель (репетиция медленнее) — множитель снаружи. */
export class TempoMap {
  private ticks: number[] = [];
  private secs: number[] = [];
  private qpm: number[] = [];

  constructor(tempo: [number, number][]) {
    const list = tempo.length ? [...tempo].sort((a, b) => a[0] - b[0]) : [[0, 100] as [number, number]];
    if (list[0][0] > 0) list.unshift([0, list[0][1]]);
    let s = 0;
    for (let i = 0; i < list.length; i++) {
      if (i > 0) s += ((list[i][0] - list[i - 1][0]) / PPQ) * (60 / list[i - 1][1]);
      this.ticks.push(list[i][0]);
      this.secs.push(s);
      this.qpm.push(list[i][1]);
    }
  }

  private idxTick(t: number): number {
    let lo = 0;
    let hi = this.ticks.length - 1;
    while (lo < hi) {
      const m = (lo + hi + 1) >> 1;
      if (this.ticks[m] <= t) lo = m;
      else hi = m - 1;
    }
    return lo;
  }

  sec(tick: number): number {
    const i = this.idxTick(tick);
    return this.secs[i] + ((tick - this.ticks[i]) / PPQ) * (60 / this.qpm[i]);
  }

  tick(sec: number): number {
    let lo = 0;
    let hi = this.secs.length - 1;
    while (lo < hi) {
      const m = (lo + hi + 1) >> 1;
      if (this.secs[m] <= sec) lo = m;
      else hi = m - 1;
    }
    return this.ticks[lo] + ((sec - this.secs[lo]) * this.qpm[lo] * PPQ) / 60;
  }

  /** Четвертей в минуту на тике. */
  bpm(tick: number): number {
    return this.qpm[this.idxTick(tick)];
  }
}

/** Такты: начало каждого такта (тик) и доли в нём. */
export interface Bar {
  tick: number;
  num: number;
  /** Длина доли в тиках. */
  beat: number;
}

export function barsOf(s: ScoreJson): Bar[] {
  const ts = s.time.length ? [...s.time].sort((a, b) => a[0] - b[0]) : [[0, 4, 4] as [number, number, number]];
  const out: Bar[] = [];
  let k = 0;
  let t = 0;
  while (t < s.end) {
    while (k + 1 < ts.length && ts[k + 1][0] <= t) k++;
    const [, num, den] = ts[k];
    // составные размеры (6/8, 9/8, 12/8) — доля = пунктирная четверть
    const compound = den === 8 && num % 3 === 0 && num > 3;
    const beat = compound ? (PPQ * 4 * 3) / den : (PPQ * 4) / den;
    const n = compound ? num / 3 : num;
    out.push({ tick: t, num: n, beat });
    t += n * beat;
  }
  return out;
}

export function barAt(bars: Bar[], tick: number): number {
  let lo = 0;
  let hi = bars.length - 1;
  while (lo < hi) {
    const m = (lo + hi + 1) >> 1;
    if (bars[m].tick <= tick) lo = m;
    else hi = m - 1;
  }
  return lo;
}

/** Вырезать отрывок [from, to) тактов — для репетиции и коротких концертных версий. */
export function excerpt(s: ScoreJson, fromBar: number, toBar: number): ScoreJson {
  const bars = barsOf(s);
  const a = bars[Math.max(0, fromBar)]?.tick ?? 0;
  const b = bars[Math.min(bars.length, toBar)]?.tick ?? s.end;
  const cut = (t: number) => t - a;
  const tempoAt = new TempoMap(s.tempo).bpm(a);
  const tempo: [number, number][] = [[0, tempoAt], ...s.tempo.filter(([t]) => t > a && t < b).map(([t, q]) => [cut(t), q] as [number, number])];
  const tsAt = [...s.time].reverse().find(([t]) => t <= a) ?? [0, 4, 4];
  const time: [number, number, number][] = [[0, tsAt[1], tsAt[2]], ...s.time.filter(([t]) => t > a && t < b).map(([t, n, d]) => [cut(t), n, d] as [number, number, number])];
  const parts = s.parts.map((p) => {
    const notes: number[] = [];
    for (const n of notesOf(p)) {
      if (n.tick < a || n.tick >= b) continue;
      notes.push(cut(n.tick), Math.min(n.dur, b - n.tick), n.pitch, n.vel + 128 * n.art);
    }
    return { ...p, notes };
  });
  return {
    ...s,
    time,
    tempo,
    marks: s.marks?.filter(([t]) => t >= a && t < b).map(([t, m]) => [cut(t), m] as [number, string]),
    end: b - a,
    parts,
    specials: s.specials?.filter((x) => x.tick >= a && x.tick < b).map((x) => ({ ...x, tick: cut(x.tick), len: Math.min(x.len, b - x.tick) })),
  };
}
