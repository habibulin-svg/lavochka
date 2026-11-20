/* Симулятор дирижёра — отметки ленты из партитуры.
 * Строка = группа инструментов (LANE_SETS). Фраза группы — непрерывная игра её инструментов (паузы короче порога склеиваются).
 * Начало фразы — «вступление», громкий конец перед паузой — «снятие». Длинные фразы режутся на месте самой большой
 * паузы в каждом окне (новая мысль — новое вступление). Особые места (фермата, ускорение, крещендо, соло) — строка «Палочка».
 * Густота — по сложности: минимум секунд между отметками строки, сколько строк могут вступить разом. */
import { barsOf, laneOf, LANE_SETS, notesOf, PPQ, TempoMap, type InstrId, type LaneCount, type LaneDef, type Note, type ScoreJson } from './score';

export interface Difficulty {
  lanes: LaneCount;
  /** Есть ли «снятия». */
  cuts: boolean;
  /** Есть ли строка «Палочка» (фермата, темп, динамика, соло). */
  specials: boolean;
  /** Не чаще, секунд, на одной строке. */
  minGap: number;
  /** Разом могут вступить не больше стольких строк. */
  maxChord: number;
  /** Пауза короче — фраза не прерывается (в долях). */
  mergeBeats: number;
  /** Фраза длиннее — режется на новую мысль (тактов). */
  phraseBars: number;
  /** Сколько отметок в минуту хочется (реже — режем фразы мельче, чаще — убираем слабые). */
  perMin: number;
  /** «Ведите такт»: доля палочкой всю пьесу — раз в столько долей (0 — раз в такт); не чаще minBeatSec. */
  beatEvery: number;
  minBeatSec: number;
}

export const DIFFS: Record<'learn' | 'easy' | 'normal' | 'hard' | 'master', Difficulty> = {
  learn: { lanes: 4, cuts: false, specials: false, minGap: 1.8, maxChord: 1, mergeBeats: 6, phraseBars: 8, perMin: 24, beatEvery: 0, minBeatSec: 1.2 },
  easy: { lanes: 6, cuts: false, specials: true, minGap: 1.4, maxChord: 2, mergeBeats: 4, phraseBars: 6, perMin: 36, beatEvery: 0, minBeatSec: 1.0 },
  normal: { lanes: 6, cuts: true, specials: true, minGap: 1.1, maxChord: 2, mergeBeats: 3, phraseBars: 4, perMin: 55, beatEvery: 2, minBeatSec: 0.7 },
  hard: { lanes: 8, cuts: true, specials: true, minGap: 0.8, maxChord: 3, mergeBeats: 2, phraseBars: 4, perMin: 80, beatEvery: 1, minBeatSec: 0.45 },
  master: { lanes: 8, cuts: true, specials: true, minGap: 0.6, maxChord: 4, mergeBeats: 2, phraseBars: 2, perMin: 110, beatEvery: 1, minBeatSec: 0.36 },
};
export type DiffId = keyof typeof DIFFS;

/** Строка «Палочка» — номер после строк групп. */
export type MarkKind = 'cue' | 'cut' | 'solo' | 'beat' | 'hold' | 'up' | 'down';

export interface Mark {
  id: number;
  kind: MarkKind;
  /** Строка группы; −1 — палочка. */
  lane: number;
  tick: number;
  /** hold: сколько держать (тики); cue: длина фразы до следующей отметки строки. */
  len: number;
  /** solo: кто встаёт. */
  instr?: InstrId;
  /** beat: доля ускорения/замедления — палочка ведёт темп (иначе — просто «ведите такт»). */
  tempo?: boolean;
}

export interface Chart {
  lanes: LaneDef[];
  marks: Mark[];
  /** Палочка есть хотя бы раз — показывать её строку. */
  baton: boolean;
}

interface Phrase {
  start: number;
  end: number;
  peakVel: number;
  endVel: number;
}

function phrasesOf(notes: Note[], mergeTicks: (t: number) => number): Phrase[] {
  const out: Phrase[] = [];
  const sorted = [...notes].sort((a, b) => a.tick - b.tick);
  let cur: Phrase | null = null;
  for (const n of sorted) {
    const end = n.tick + n.dur;
    if (cur && n.tick - cur.end < mergeTicks(n.tick)) {
      if (end >= cur.end) {
        cur.end = end;
        cur.endVel = n.vel;
      }
      cur.peakVel = Math.max(cur.peakVel, n.vel);
    } else {
      cur = { start: n.tick, end, peakVel: n.vel, endVel: n.vel };
      out.push(cur);
    }
  }
  return out;
}

/** Длинную фразу режем на «мысли»: в каждом окне phraseBars — по самой большой паузе между началами нот. */
function splitLong(p: Phrase, notes: Note[], windowTicks: number): number[] {
  if (p.end - p.start <= windowTicks * 1.25) return [];
  const on = [...new Set(notes.filter((n) => n.tick > p.start && n.tick < p.end).map((n) => n.tick))].sort((a, b) => a - b);
  const cuts: number[] = [];
  let from = p.start;
  while (p.end - from > windowTicks * 1.25) {
    // ищем в середине окна [from + 0.5w, from + 1.25w] начало после самой длинной тишины между началами
    let best = -1;
    let bestGap = -1;
    let prev = from;
    for (const t of on) {
      if (t <= from) continue;
      if (t > from + windowTicks * 1.25) break;
      const gap = t - prev;
      if (t >= from + windowTicks * 0.5 && gap > bestGap) {
        bestGap = gap;
        best = t;
      }
      prev = t;
    }
    if (best < 0) break;
    cuts.push(best);
    from = best;
  }
  return cuts;
}

export function buildChart(s: ScoreJson, d: Difficulty): Chart {
  const lanes = LANE_SETS[d.lanes];
  const tm = new TempoMap(s.tempo);
  const bars = barsOf(s);
  const barTicks = bars.length ? bars[0].num * bars[0].beat : PPQ * 4;
  const beatAt = (t: number) => {
    let b = bars[0]?.beat ?? PPQ;
    for (const x of bars) {
      if (x.tick > t) break;
      b = x.beat;
    }
    return b;
  };
  const perLane: Note[][] = lanes.map(() => []);
  for (const p of s.parts) {
    const li = laneOf(lanes, p.instr);
    if (li < 0) continue;
    perLane[li].push(...notesOf(p));
  }
  type Cand = { kind: 'cue' | 'cut'; lane: number; tick: number; weight: number };
  const minutes = Math.max(0.2, tm.sec(s.end) / 60);
  const pass = (phraseBars: number): Mark[] => {
    const marks: Mark[] = [];
    const cands: Cand[] = [];
    perLane.forEach((notes, li) => {
      if (!notes.length) return;
      const phrases = phrasesOf(notes, (t) => beatAt(t) * d.mergeBeats);
      for (let i = 0; i < phrases.length; i++) {
        const p = phrases[i];
        cands.push({ kind: 'cue', lane: li, tick: p.start, weight: p.peakVel + 40 });
        for (const t of splitLong(p, notes, barTicks * phraseBars)) cands.push({ kind: 'cue', lane: li, tick: t, weight: p.peakVel });
        const next = phrases[i + 1];
        const restAfter = (next ? next.start : s.end + barTicks * 4) - p.end;
        if (d.cuts && p.endVel >= 80 && restAfter >= beatAt(p.end) * 2 && p.end - p.start > barTicks) cands.push({ kind: 'cut', lane: li, tick: p.end, weight: p.endVel });
      }
    });
    // густота: по времени, строка не чаще minGap; аккорд не больше maxChord (оставляем самые громкие)
    cands.sort((a, b) => a.tick - b.tick || b.weight - a.weight);
    const lastAt = lanes.map(() => -1e9);
    const chordAt = new Map<number, number>();
    for (const c of cands) {
      const sec = tm.sec(c.tick);
      if (sec - lastAt[c.lane] < d.minGap) continue;
      const near = [...chordAt.entries()].filter(([t]) => Math.abs(tm.sec(t) - sec) < 0.12).reduce((n, [, k]) => n + k, 0);
      if (near >= d.maxChord) continue;
      chordAt.set(c.tick, (chordAt.get(c.tick) ?? 0) + 1);
      lastAt[c.lane] = sec;
      marks.push({ id: 0, kind: c.kind, lane: c.lane, tick: c.tick, len: 0, w: c.weight } as Mark);
    }
    return marks;
  };
  // реже желаемого — режем фразы мельче; чаще — убираем самые слабые отметки
  let marks = pass(d.phraseBars);
  for (const pb of [d.phraseBars * 0.66, d.phraseBars * 0.5, 4, 3, 2]) {
    if (marks.length / minutes >= d.perMin * 0.6 || pb >= d.phraseBars) break;
    marks = pass(pb);
  }
  const cap = Math.ceil(d.perMin * 1.15 * minutes);
  if (marks.length > cap) {
    const firstOf = new Set(chartFirsts(marks));
    const drop = marks.filter((m) => !firstOf.has(m)).sort((a, b) => (a as Mark & { w: number }).w - (b as Mark & { w: number }).w).slice(0, marks.length - cap);
    const ds = new Set(drop);
    marks = marks.filter((m) => !ds.has(m));
  }
  for (const m of marks) delete (m as Partial<Mark & { w: number }>).w;
  // палочка
  if (d.specials)
    for (const x of s.specials ?? []) {
      if (x.kind === 'fermata') marks.push({ id: 0, kind: 'hold', lane: -1, tick: x.tick, len: x.len });
      else if (x.kind === 'accel' || x.kind === 'rit') {
        // тапы в такт на каждой доле участка
        for (let t = x.tick; t < x.tick + x.len; ) {
          marks.push({ id: 0, kind: 'beat', lane: -1, tick: t, len: 0, tempo: true });
          t += beatAt(t) * (x.every ?? 1);
        }
      } else if (x.kind === 'cresc' || x.kind === 'sforzando') marks.push({ id: 0, kind: 'up', lane: -1, tick: x.tick, len: x.len });
      else if (x.kind === 'subito_p') marks.push({ id: 0, kind: 'down', lane: -1, tick: x.tick, len: x.len });
      else if (x.kind === 'solo' && x.instr) {
        const li = laneOf(lanes, x.instr);
        if (li < 0) continue;
        // соло — это и есть вступление группы: близкая отметка той же строки становится звездой, новой не ставим
        const near = marks.find((m) => m.lane === li && Math.abs(tm.sec(m.tick) - tm.sec(x.tick)) < d.minGap);
        if (near) {
          near.kind = 'solo';
          near.instr = x.instr;
        } else marks.push({ id: 0, kind: 'solo', lane: li, tick: x.tick, len: x.len, instr: x.instr });
      }
    }
  // «ведите такт»: доли палочкой всю пьесу (кроме участков ускорения/замедления — там свои — и около ферматы)
  {
    let first = Infinity;
    let last = 0;
    for (const p of s.parts)
      for (const n of notesOf(p)) {
        first = Math.min(first, n.tick);
        last = Math.max(last, n.tick);
      }
    const zones = (d.specials ? s.specials ?? [] : []).filter((x) => x.kind === 'accel' || x.kind === 'rit');
    const holds = marks.filter((m) => m.kind === 'hold');
    let lastSec = -1e9;
    for (const b of bars) {
      const step = d.beatEvery > 0 ? b.beat * d.beatEvery : b.num * b.beat;
      for (let t = b.tick; t < b.tick + b.num * b.beat; t += step) {
        if (t < first || t > last) continue;
        if (zones.some((z) => t >= z.tick - b.beat && t < z.tick + z.len)) continue;
        if (holds.some((h) => t > h.tick - b.beat * 2 && t < h.tick + h.len + b.beat)) continue;
        const sec = tm.sec(t);
        if (sec - lastSec < d.minBeatSec - 1e-6) continue;
        lastSec = sec;
        marks.push({ id: 0, kind: 'beat', lane: -1, tick: t, len: 0 });
      }
    }
  }
  marks.sort((a, b) => a.tick - b.tick || a.lane - b.lane);
  marks.forEach((m, i) => (m.id = i));
  // длина фразы вступления — до следующей отметки этой строки
  for (let i = 0; i < marks.length; i++) {
    const m = marks[i];
    if (m.kind !== 'cue') continue;
    const next = marks.find((x, j) => j > i && x.lane === m.lane && (x.kind === 'cue' || x.kind === 'cut'));
    m.len = (next ? next.tick : s.end) - m.tick;
  }
  return { lanes, marks, baton: marks.some((m) => m.lane < 0) };
}

/** Первое вступление каждой строки — его не убираем при прореживании. */
function chartFirsts(marks: Mark[]): Mark[] {
  const seen = new Set<number>();
  const out: Mark[] = [];
  for (const m of [...marks].sort((a, b) => a.tick - b.tick))
    if (!seen.has(m.lane)) {
      seen.add(m.lane);
      out.push(m);
    }
  return out;
}

/** Для каждой строки: к какой отметке-вступлению относится нота (номер в marks), −1 — нота до первого вступления. */
export function cueIndexOf(chart: Chart, lane: number, tick: number): number {
  let best = -1;
  for (const m of chart.marks) {
    if (m.tick > tick) break;
    if (m.lane === lane && m.kind === 'cue') best = m.id;
  }
  return best;
}
