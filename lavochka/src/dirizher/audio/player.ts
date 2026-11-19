/* Симулятор дирижёра — исполнитель: ведёт часы исполнения (core/perform) по часам звука и раздаёт ноты оркестру.
 * Ноты включаются заранее (на 0,15 с вперёд) с небрежностью по настрою группы, снимаются по тику — фермата и живой
 * темп не рвут звук. Громкость строки — уверенность группы: ждёт вступления — робко, попали — в полный голос,
 * промахнулись — тихо и вразнобой до следующего вступления. */
import type { Chart } from '../core/chart';
import { Performance, type Input, type PerfEvent } from '../core/perform';
import { laneOf, notesOf, type InstrId, type ScoreJson } from '../core/score';
import { Orchestra, type Voice } from './orchestra';

const AHEAD = 0.15;

interface PNote {
  tick: number;
  end: number;
  pitch: number;
  vel: number;
  /** Приём: 0 тянуть, 1 коротко, 2 пиццикато. */
  art: number;
  instr: InstrId;
  lane: number;
  /** id отметки-вступления фразы (−1 — до первого). */
  cue: number;
}

/** Где сидит группа (панорама −1..1). */
export const PAN: Partial<Record<InstrId, number>> = {
  vn1: -0.6, vn2: -0.25, va: 0.2, vc: 0.5, cb: 0.75, harp: -0.8,
  fl: -0.15, picc: -0.2, ob: 0.1, eh: 0.15, cl: -0.1, bcl: -0.05, bn: 0.15, cbn: 0.2,
  hn: -0.4, tp: 0.1, tb: 0.35, tu: 0.45, timp: 0, perc: 0.25, cel: -0.6,
};

export class ScorePlayer {
  readonly perf: Performance;
  private notes: PNote[] = [];
  private next = 0;
  private active: { n: PNote; v: Voice | null }[] = [];
  private lastCtx = 0;
  private running = false;
  private rnd = 1;
  /** Громкость группы после промаха вступления (растёт с сыгранностью). */
  missLevel = 0.25;
  /** Строка выключена (репетиция: послушать без группы). */
  muted = new Set<number>();
  /** Подписчики на события исполнения (лента, сцена, счёт). */
  onEvent: (e: PerfEvent) => void = () => {};

  constructor(
    readonly orch: Orchestra,
    readonly score: ScoreJson,
    readonly chart: Chart,
    opts: ConstructorParameters<typeof Performance>[2]
  ) {
    this.perf = new Performance(score, chart, opts);
    const cueLists = chart.lanes.map((_, li) => chart.marks.filter((m) => m.lane === li && m.kind === 'cue'));
    for (const p of score.parts) {
      const lane = laneOf(chart.lanes, p.instr);
      if (lane < 0) continue;
      const cues = cueLists[lane];
      let k = -1;
      const sorted = notesOf(p).sort((a, b) => a.tick - b.tick);
      for (const n of sorted) {
        while (k + 1 < cues.length && cues[k + 1].tick <= n.tick + 1) k++;
        this.notes.push({ tick: n.tick, end: n.tick + n.dur, pitch: n.pitch, vel: n.vel, art: n.art, instr: p.instr, lane, cue: k >= 0 ? cues[k].id : -1 });
      }
    }
    this.notes.sort((a, b) => a.tick - b.tick);
    while (this.next < this.notes.length && this.notes[this.next].tick < this.perf.tick) this.next++;
    orch.setup(
      chart.lanes.map((l) => l.instr),
      PAN
    );
    chart.lanes.forEach((_, i) => orch.laneLevel(i, 1, orch.ctx.currentTime, 0.01));
  }

  start(): void {
    this.running = true;
    this.lastCtx = this.orch.ctx.currentTime;
  }

  pause(on: boolean): void {
    this.running = !on;
    if (on) {
      for (const a of this.active) this.orch.release(a.v);
      this.active = [];
    } else this.lastCtx = this.orch.ctx.currentTime;
  }

  private rand(): number {
    this.rnd = (this.rnd * 1103515245 + 12345) >>> 0;
    return this.rnd / 0x100000000;
  }

  input(i: Input): void {
    for (const e of this.perf.input(i)) this.handle(e);
  }

  private handle(e: PerfEvent): void {
    const ctx = this.orch.ctx;
    if (e.kind === 'judge' && e.mark.lane >= 0 && (e.mark.kind === 'cue' || e.mark.kind === 'solo')) {
      const q = this.perf.noteQuality(e.mark.id, e.mark.lane);
      this.orch.laneLevel(e.mark.lane, e.grade === 'miss' ? this.missLevel : Math.max(0.45, q), ctx.currentTime, e.grade === 'miss' ? 0.3 : 0.08);
    } else if (e.kind === 'dyn') this.orch.dynamics(e.level);
    this.onEvent(e);
  }

  /** Кадр: шагнуть часы по часам звука, раздать ноты. */
  update(): void {
    if (!this.running) return;
    const ctx = this.orch.ctx;
    const now = ctx.currentTime;
    const dt = Math.min(0.1, Math.max(0, now - this.lastCtx));
    this.lastCtx = now;
    const before = this.perf.tick;
    for (const e of this.perf.step(dt)) this.handle(e);
    const perf = this.perf;
    // вступление прошло, а команды не было — группа робеет
    for (const m of this.chart.marks) {
      if (m.tick > perf.tick) break;
      if (m.tick > before && m.lane >= 0 && m.kind === 'cue' && !perf.quality.has(m.id)) this.orch.laneLevel(m.lane, Math.max(0.32, this.missLevel), now, 0.05);
    }
    // снять отзвучавшие
    this.active = this.active.filter((a) => {
      if (perf.tick >= a.n.end) {
        this.orch.release(a.v, now);
        return false;
      }
      return true;
    });
    if (perf.frozen) return;
    const spt = perf.secPerTick();
    const horizon = perf.tick + AHEAD / spt;
    while (this.next < this.notes.length && this.notes[this.next].tick < horizon) {
      const n = this.notes[this.next++];
      if (n.tick < before - 1 || this.muted.has(n.lane)) continue;
      // небрежность: настрой группы и промах вступления
      const q = n.cue >= 0 ? perf.quality.get(n.cue) : 1;
      const mood = perf.mood[n.lane] ?? 70;
      const sloppy = (1 - mood / 100) * 0.035 + (q === 0 ? 0.045 : 0);
      const jitter = (this.rand() - 0.5) * 2 * sloppy;
      const detune = (this.rand() - 0.5) * 2 * ((1 - mood / 100) * 12 + (q === 0 ? 8 : 0));
      const when = Math.max(now, now + (n.tick - perf.tick) * spt + Math.max(0, jitter));
      // короткая нота — коротким приёмом (у кого он есть)
      const art = n.art || ((n.end - n.tick) * spt < 0.2 ? 1 : 0);
      const v = this.orch.noteOn(n.instr, n.pitch, n.vel, when, detune, art);
      this.active.push({ n, v });
    }
  }

  stop(): void {
    this.running = false;
    for (const a of this.active) this.orch.release(a.v);
    this.active = [];
  }
}
