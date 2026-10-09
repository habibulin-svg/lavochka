/* Авторитетное состояние партии: правила, случайность, счётчик ходов. Без DOM и без сети. */
import { SeededRng, randomSeed } from './rng';
import type { GameDef, GameResult, Options, SeatSpec } from './types';

export interface Snapshot {
  gameId: string;
  options: Options;
  seats: SeatSpec[];
  state: unknown;
  rng: number;
  seq: number;
}

export interface StepResult {
  seq: number;
  actor: number;
  events: unknown[];
}

export class Authority {
  state: any;
  seq = 0;
  rng: SeededRng;
  result: GameResult | null = null;

  constructor(
    public def: GameDef,
    public seats: SeatSpec[],
    public options: Options,
    snap?: Snapshot
  ) {
    if (snap) {
      this.state = snap.state;
      this.rng = new SeededRng(snap.rng);
      this.seq = snap.seq;
    } else {
      this.rng = new SeededRng(randomSeed());
      this.state = def.setup(seats, options, this.rng);
    }
    this.result = def.result(this.state);
  }

  toAct(): number[] {
    return this.result ? [] : this.def.toAct(this.state);
  }

  act(seat: number, action: unknown): StepResult | null {
    if (this.result || !this.toAct().includes(seat)) return null;
    let res;
    try {
      res = this.def.apply(this.state, seat, action, this.rng);
    } catch (e) {
      console.error('apply failed', e);
      return null;
    }
    if (!res) return null;
    this.state = res.state;
    this.seq++;
    this.result = this.def.result(this.state);
    return { seq: this.seq, actor: seat, events: res.events };
  }

  viewFor(seats: number[] | 'all') {
    return this.def.view(this.state, seats);
  }

  redact(events: unknown[], seats: number[] | 'all'): unknown[] {
    const r = this.def.redact;
    if (!r) return events;
    const out: unknown[] = [];
    for (const ev of events) {
      const x = r(ev, seats);
      if (x != null) out.push(x);
    }
    return out;
  }

  snapshot(): Snapshot {
    return {
      gameId: this.def.id,
      options: this.options,
      seats: this.seats,
      state: this.state,
      rng: this.rng.getState(),
      seq: this.seq,
    };
  }
}
