/* Авторитетное состояние партии: правила, случайность, счётчик ходов. Без DOM и без сети. */
import { atTime } from './clock';
import { SeededRng, randomSeed } from './rng';
import type { GameDef, GameResult, Options, SeatSpec } from './types';

export interface Snapshot {
  gameId: string;
  options: Options;
  seats: SeatSpec[];
  state: unknown;
  rng: number;
  seq: number;
  /** Сид раздачи и запись ходов — для таблиц рекордов (только у игр с `def.records`). */
  seed?: number;
  t0?: number;
  log?: LogEntry[];
}

/** Ход в записи партии: место, действие, сколько мс прошло с прошлого хода (с начала партии). */
export type LogEntry = [number, unknown, number];

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
  /** Сид раздачи; undefined — партия из старого сохранения, переиграть её нельзя. */
  seed: number | undefined;
  /** Запись ходов (у игр с таблицами рекордов). */
  log: LogEntry[] | null = null;
  /** Часы партии (игры с рекордами): начало и сумма пауз между ходами. Движки видят время через core/clock —
   * так переигрывание записи на сервере даёт то же время, что и у игрока. */
  t0 = Date.now();
  private lastAt = Date.now();

  constructor(
    public def: GameDef,
    public seats: SeatSpec[],
    public options: Options,
    snap?: Snapshot,
    /** Переигрывание: сид и начало часов из записи (lastAt не нужен — паузы берутся из записи). */
    replay?: { seed: number; t0: number }
  ) {
    if (snap) {
      this.state = snap.state;
      this.rng = new SeededRng(snap.rng);
      this.seq = snap.seq;
      this.seed = snap.seed;
      if (def.records && snap.log && snap.seed != null && snap.t0 != null) {
        this.log = snap.log.slice();
        this.t0 = snap.t0;
        this.ms = this.log.reduce((a, x) => a + x[2], 0);
      }
    } else {
      this.seed = replay?.seed ?? randomSeed();
      if (replay) this.t0 = replay.t0;
      this.rng = new SeededRng(this.seed);
      this.state = def.records ? atTime(this.t0, () => def.setup(seats, options, this.rng)) : def.setup(seats, options, this.rng);
      if (def.records) this.log = [];
    }
    this.result = def.result(this.state);
  }

  /** Время партии по записи (мс): паузы между ходами; пока партию не продолжили после перезагрузки — не тикает. */
  get playMs(): number {
    return this.ms;
  }
  private ms = 0;

  toAct(): number[] {
    return this.result ? [] : this.def.toAct(this.state);
  }

  /** dt — пауза перед ходом из записи (переигрывание); без него — по настоящим часам. */
  act(seat: number, action: unknown, dt?: number): StepResult | null {
    if (this.result) return null;
    if (!this.toAct().includes(seat) && !this.def.free?.(this.state, seat, action)) return null;
    let res;
    let pause = 0;
    try {
      if (this.log) {
        const t = Date.now();
        // долгая отлучка посреди партии (ушёл обедать, вкладка спала) — во время идёт не больше 10 минут на ход
        pause = Math.max(0, Math.round(dt ?? Math.min(t - this.lastAt, 10 * 60_000)));
        res = atTime(this.t0 + this.playMs + pause, () => this.def.apply(this.state, seat, action, this.rng));
      } else res = this.def.apply(this.state, seat, action, this.rng);
    } catch (e) {
      console.error('apply failed', e);
      return null;
    }
    if (!res) return null;
    this.state = res.state;
    this.seq++;
    if (this.log) {
      this.log.push([seat, action, pause]);
      this.ms += pause;
      this.lastAt = Date.now();
    }
    this.result = this.def.result(this.state);
    return { seq: this.seq, actor: seat, events: res.events };
  }

  /** Шаг игры реального времени. */
  tick(inputs: unknown[]): unknown[] {
    if (this.result || !this.def.realtime) return [];
    const ev = this.def.realtime.tick(this.state, inputs, this.rng);
    this.result = this.def.result(this.state);
    return ev;
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
      ...(this.log ? { seed: this.seed, t0: this.t0, log: this.log } : {}),
    };
  }
}
