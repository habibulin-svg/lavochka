/* Харнесс для тестов: прогон партий ботов без DOM и клиенты комнаты, играющие «как люди». */
import { Authority } from '../src/core/authority';
import { RoomClient } from '../src/core/client';
import { localPair, type RoomMsg } from '../src/core/protocol';
import { SeededRng } from '../src/core/rng';
import type { GameDef, Options, SeatSpec } from '../src/core/types';

/** Все места — боты указанного уровня (или разных уровней по кругу). */
export function botSeats(def: GameDef, n: number, levels?: number[]): SeatSpec[] {
  const seats = def.seatsFor ? def.seatsFor(n) : Array.from({ length: n }, (_, i) => i);
  return seats.map((seat, i) => ({
    seat,
    kind: 'bot',
    name: def.seats[seat].name,
    level: levels ? levels[i % levels.length] : def.bot.levels.length - 1,
  }));
}

export interface SimResult {
  steps: number;
  finished: boolean;
  winners: number[];
  error?: string;
}

/**
 * Партия ботов против ботов через Authority. Проверяет на каждом шаге:
 * кто-то должен ходить, бот находит допустимый ход, состояние и view сериализуются.
 */
export async function simulate(def: GameDef, seats: SeatSpec[], options: Options, seed: number, maxSteps = 20000): Promise<SimResult> {
  const a = new Authority(def, seats, options);
  a.rng = new SeededRng(seed);
  a.state = def.setup(seats, options, a.rng);
  const botRng = new SeededRng(seed ^ 0x5bd1e995);
  let steps = 0;
  while (!a.result && steps < maxSteps) {
    const toAct = a.toAct();
    if (!toAct.length) return { steps, finished: false, winners: [], error: 'никто не ходит, а результата нет' };
    const seat = toAct[0];
    const spec = seats.find((s) => s.seat === seat)!;
    const view = a.viewFor([seat]);
    JSON.stringify(view);
    const action = await def.bot.choose(view, seat, spec.level, botRng);
    if (action == null) return { steps, finished: false, winners: [], error: `бот места ${seat} не нашёл хода (шаг ${steps})` };
    const res = a.act(seat, action);
    if (!res) return { steps, finished: false, winners: [], error: `ход бота отклонён правилами: ${JSON.stringify(action)} (шаг ${steps})` };
    JSON.stringify(res.events);
    steps++;
  }
  JSON.stringify(a.state);
  return { steps, finished: !!a.result, winners: a.result?.winners ?? [] };
}

/** Значения опций по умолчанию. */
export function defaults(def: GameDef): Options {
  const o: Options = {};
  for (const opt of def.options || []) o[opt.key] = opt.default;
  return o;
}

/**
 * Тестовый клиент комнаты: сразу сообщает «анимация доиграна» и, когда ход его,
 * ходит ботом — как человек, который играет быстро.
 */
export class AutoClient {
  client: RoomClient;
  log: RoomMsg[] = [];
  view: any = null;
  mySeats: number[] = [];
  result: any = null;
  seq = 0;
  playing = true;
  private rng: SeededRng;

  constructor(
    public def: GameDef,
    link: ReturnType<typeof localPair>[1],
    name: string,
    ownerKey?: string,
    seed = 1,
    clientId = name
  ) {
    this.rng = new SeededRng(seed);
    this.client = new RoomClient(link, { name, ownerKey, clientId });
    this.client.on((m) => this.onMsg(m));
    this.client.release();
  }

  private onMsg(m: RoomMsg) {
    this.log.push(m);
    if (m.t === 'start' || m.t === 'step') {
      this.view = m.view;
      this.seq = m.seq;
      this.result = m.result;
      if (m.t === 'start') this.mySeats = m.mySeats;
      this.client.idle(m.seq);
      void this.maybeAct(m.toAct);
    }
  }

  private async maybeAct(toAct: number[]) {
    if (!this.playing || this.result) return;
    const seat = toAct.find((s) => this.mySeats.includes(s));
    if (seat == null) return;
    const seq = this.seq;
    const action = await this.def.bot.choose(this.view, seat, 1, this.rng);
    if (action != null && seq === this.seq && this.playing) this.client.act(seat, action);
  }

  has(t: RoomMsg['t']) {
    return this.log.some((m) => m.t === t);
  }
}

export const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

export async function until(cond: () => boolean, timeoutMs = 10000, what = 'условие') {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > timeoutMs) throw new Error(`Не дождались: ${what}`);
    await tick(5);
  }
}
