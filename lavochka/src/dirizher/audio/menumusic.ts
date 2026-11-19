/* Симулятор дирижёра — музыка меню и прослушивание переложений: оркестр сам играет партитуру (без ленты и судейства),
 * тихо и по кругу. Ноты — тем же сэмплером, планировщик на опережение по часам звука. */
import { notesOf, TempoMap, type InstrId, type ScoreJson } from '../core/score';
import { PAN } from './player';
import type { Orchestra, Voice } from './orchestra';

export class Autoplay {
  private notes: { t: number; e: number; pitch: number; vel: number; art: number; instr: InstrId }[] = [];
  private next = 0;
  private t0 = 0;
  private timer = 0;
  private active: { e: number; v: Voice | null }[] = [];
  private len: number;
  stopped = false;

  constructor(
    private orch: Orchestra,
    score: ScoreJson,
    private opts: { loop?: boolean; volume?: number; maxSec?: number } = {}
  ) {
    const tm = new TempoMap(score.tempo);
    for (const p of score.parts)
      for (const n of notesOf(p)) this.notes.push({ t: tm.sec(n.tick), e: tm.sec(n.tick + n.dur), pitch: n.pitch, vel: n.vel, art: n.art, instr: p.instr });
    this.notes.sort((a, b) => a.t - b.t);
    this.len = Math.min(opts.maxSec ?? 1e9, tm.sec(score.end));
    if (opts.maxSec) this.notes = this.notes.filter((n) => n.t < opts.maxSec!);
    const instrs = [...new Set(score.parts.map((p) => p.instr))];
    orch.setup([instrs], PAN);
    orch.laneLevel(0, opts.volume ?? 1, orch.ctx.currentTime, 0.3);
    orch.dynamics(1);
  }

  instruments(): InstrId[] {
    return [...new Set(this.notes.map((n) => n.instr))];
  }

  start(): void {
    this.t0 = this.orch.ctx.currentTime + 0.15;
    this.next = 0;
    const tick = () => {
      if (this.stopped) return;
      const now = this.orch.ctx.currentTime;
      const pos = now - this.t0;
      while (this.next < this.notes.length && this.notes[this.next].t < pos + 0.25) {
        const n = this.notes[this.next++];
        const art = n.art || (n.e - n.t < 0.2 ? 1 : 0);
        const v = this.orch.noteOn(n.instr, n.pitch, n.vel, this.t0 + n.t, 0, art);
        this.active.push({ e: this.t0 + n.e, v });
      }
      this.active = this.active.filter((a) => {
        if (a.e <= now + 0.03) {
          this.orch.release(a.v, a.e);
          return false;
        }
        return true;
      });
      if (pos > this.len + 1.5) {
        if (this.opts.loop) this.start();
        else {
          this.stop();
          return;
        }
      }
      this.timer = window.setTimeout(tick, 40);
    };
    tick();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    for (const a of this.active) this.orch.release(a.v);
    this.active = [];
  }
}
