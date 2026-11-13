/* Комната Арены на сервере (без сокетов: сервер даёт peer.send и зовёт tick; тесты гоняют её напрямую).
 * Лобби → драфт → бой → итог. Сервер считает бой сам и следит за часами: кончился запас — за игрока ходит бот (DESIGN §2). */
import { botAction } from '../bot/bot';
import { type BattleEvent, type BattleState, act, actionError, createBattle, currentUnit, resign } from '../sim/battle';
import { FACTIONS } from '../sim/creatures';
import { ARMY_ROUNDS, type DraftState, draftAdvance, draftPick, newDraft } from '../sim/draft';
import { BUDGETS, type ClockView, type DraftView, type NetClientMsg, type NetPeer, type NetServerMsg, type ResultView, battleViewFor, cleanAction } from './protocol';

export const HERO_MS = 25_000;
export const ARMY_MS = 15_000;
/** Запас на бой и прибавка за ход. */
export const BANK_MS = 240_000;
export const INCREMENT_MS = 5_000;
/** Кончился запас — на ход всё равно столько. */
export const MIN_MOVE_MS = 12_000;
/** Сколько ждём пропавшего, потом — поражение. */
export const GONE_MS = 90_000;
/** Пауза между драфтом и боем: загрузить картинки. */
const LOAD_MS = 5_000;
/** На показ события; часы ходящего стоят, пока идёт показ. */
const EVENT_MS = 420;
const MAX_SHOW_MS = 6_000;

export interface RoomPeer {
  id: number;
  name: string;
  /** Ключ браузера: по нему вернувшийся садится на своё место. */
  token: string;
  user: number | null;
  /** Купил полную игру (право geroi_full): вторая четвёрка фракций открыта. */
  full?: boolean;
  send(m: NetServerMsg): void;
}

export interface RoomHooks {
  /** Партия кончилась: вернуть, что стало с рейтингом (нерейтинговая — ничего). */
  onResult?(winner: number, users: [number | null, number | null], names: [string, string]): ResultView['rating'] | undefined;
}

interface Seat {
  token: string;
  name: string;
  user: number | null;
  full?: boolean;
  goneAt: number;
}

type Phase = 'lobby' | 'draft' | 'battle' | 'over';

export class ArenaRoom {
  private peers: RoomPeer[] = [];
  private seats: [Seat | null, Seat | null] = [null, null];
  private talking = new Set<number>();
  phase: Phase = 'lobby';
  budget: number;
  private draft: DraftState | null = null;
  private deadline = 0;
  state: BattleState | null = null;
  private bank: [number, number] = [BANK_MS, BANK_MS];
  /** С какого времени идут часы ходящего. */
  private since = 0;
  private result: ResultView | null = null;

  constructor(
    budget: number,
    private readonly seed: number,
    /** Подбор соперника: рейтинговая, если оба вошли; сама стартует. */
    readonly ranked: boolean,
    private readonly hooks: RoomHooks = {},
    private readonly now: () => number = Date.now,
  ) {
    this.budget = BUDGETS.includes(budget) ? budget : BUDGETS[1];
  }

  get isEmpty(): boolean {
    return this.peers.length === 0;
  }

  private seatOf(p: RoomPeer): number | null {
    const i = this.seats.findIndex((s) => s?.token === p.token);
    return i < 0 ? null : i;
  }

  add(p: RoomPeer): void {
    this.peers.push(p);
    let seat = this.seatOf(p);
    if (seat === null && this.phase === 'lobby') {
      seat = this.seats[0] ? (this.seats[1] ? null : 1) : 0;
      if (seat !== null) this.seats[seat] = { token: p.token, name: p.name, user: p.user, full: !!p.full, goneAt: 0 };
    }
    if (seat !== null && this.seats[seat]!.goneAt) {
      this.seats[seat]!.goneAt = 0;
      this.broadcast({ t: 'peer', name: p.name, on: true });
    }
    if (this.phase === 'lobby') {
      this.sendLobby();
      if (this.ranked && this.seats[0] && this.seats[1]) this.startDraft();
    } else if (this.phase === 'draft') this.sendDraft(p);
    else this.sendStart(p);
  }

  remove(p: RoomPeer): void {
    const i = this.peers.indexOf(p);
    if (i < 0) return;
    this.peers.splice(i, 1);
    if (this.talking.delete(p.id)) this.voiceList();
    const seat = this.seatOf(p);
    if (seat === null || this.peers.some((x) => this.seatOf(x) === seat)) return;
    if (this.phase === 'lobby') {
      this.seats[seat] = null;
      this.sendLobby();
    } else {
      this.seats[seat]!.goneAt = this.now();
      this.broadcast({ t: 'peer', name: p.name, on: false });
    }
  }

  message(p: RoomPeer, m: NetClientMsg): void {
    if (!this.peers.includes(p)) return;
    const seat = this.seatOf(p);
    switch (m.t) {
      case 'budget':
        if (this.phase === 'lobby' && seat === 0 && !this.ranked && BUDGETS.includes(m.budget)) {
          this.budget = m.budget;
          this.sendLobby();
        }
        return;
      case 'start':
        if (this.phase === 'lobby' && seat === 0 && this.seats[1]) this.startDraft();
        return;
      case 'pick':
        if (this.phase === 'draft' && seat !== null && this.draft && draftPick(this.draft, seat, m.i)) {
          if (this.draft.sides.every((s) => s.pick >= 0)) this.nextRound();
          else this.sendDraftAll();
        }
        return;
      case 'act': {
        if (this.phase !== 'battle' || seat === null) return;
        const s = this.state!;
        if (currentUnit(s)?.side !== seat) return p.send({ t: 'nope', why: 'не твой ход' });
        const a = cleanAction(m.a);
        const err = a ? actionError(s, a) : 'непонятный ход';
        if (err || !a) return p.send({ t: 'nope', why: err ?? 'непонятный ход' });
        this.chargeClock(seat, a.t !== 'cast');
        this.pushStep(act(s, a));
        return;
      }
      case 'resign':
        if ((this.phase === 'battle' || this.phase === 'draft') && seat !== null) this.forfeit(seat, 'resign');
        return;
      case 'chat': {
        const text = String(m.text ?? '').trim().slice(0, 200);
        if (text) this.broadcast({ t: 'chat', name: p.name, text });
        return;
      }
      case 'voice':
        if (m.on) this.talking.add(p.id);
        else this.talking.delete(p.id);
        this.voiceList();
        return;
      case 'rtc': {
        const to = this.peers.find((x) => String(x.id) === String(m.to));
        if (to && this.talking.has(p.id) && this.talking.has(to.id)) to.send({ t: 'rtc', from: String(p.id), data: m.data });
        return;
      }
      case 'ping':
        p.send({ t: 'pong' });
        return;
    }
  }

  /** Часы комнаты: круг драфта, запас на ход, пропавшие. */
  tick(): void {
    const t = this.now();
    if (this.phase === 'draft' && t >= this.deadline) this.nextRound();
    if (this.phase === 'draft' || this.phase === 'battle') {
      // пропали оба — партия просто закрывается, без победителя и рейтинга
      if (this.seats.every((x) => x?.goneAt && t - x.goneAt >= GONE_MS)) return this.finishGame(-1, 'gone');
      for (const side of [0, 1] as const) {
        const seat = this.seats[side];
        if (seat?.goneAt && t - seat.goneAt >= GONE_MS) return this.forfeit(side, 'gone');
      }
    }
    if (this.phase === 'battle') {
      const s = this.state!;
      const u = currentUnit(s);
      if (!u) return;
      const elapsed = t - this.since;
      if (elapsed >= Math.max(this.bank[u.side], MIN_MOVE_MS)) {
        // время вышло: ход делает бот
        this.chargeClock(u.side, false);
        this.pushStep(act(s, botAction(s, 'medium')));
      }
    }
  }

  private chargeClock(side: number, increment: boolean): void {
    const spent = Math.max(0, this.now() - this.since);
    this.bank[side] = Math.max(0, this.bank[side] - spent) + (increment ? INCREMENT_MS : 0);
    this.bank[side] = Math.min(this.bank[side], BANK_MS);
  }

  private clock(waitMs: number): ClockView {
    return { bank: [Math.max(0, this.bank[0]), Math.max(0, this.bank[1])], waitMs };
  }

  private pushStep(events: BattleEvent[]): void {
    const s = this.state!;
    // пока идёт показ, часы ходящего стоят: удар не должен есть его время
    const show = Math.min(MAX_SHOW_MS, events.length * EVENT_MS);
    this.since = this.now() + show;
    this.broadcastStep(events, show);
    if (s.over) this.finishGame(s.winner, 'battle');
  }

  /** Шаг боя каждому своим снимком: чужая ловушка и счётчик бросков не уходят. */
  private broadcastStep(events: BattleEvent[], show: number): void {
    const clock = this.clock(show);
    for (const p of this.peers) p.send({ t: 'step', events, state: battleViewFor(this.state!, this.seatOf(p)), clock });
  }

  private forfeit(side: number, why: 'resign' | 'gone'): void {
    if (this.phase === 'draft') {
      this.phase = 'over';
      this.finishGame(1 - side, why);
      return;
    }
    const events = resign(this.state!, side);
    this.since = this.now();
    this.broadcastStep(events, 0);
    this.finishGame(1 - side, why);
  }

  private finishGame(winner: number, why: ResultView['why']): void {
    this.phase = 'over';
    const users: [number | null, number | null] = [this.seats[0]?.user ?? null, this.seats[1]?.user ?? null];
    let rating: ResultView['rating'];
    // сам с собой из двух вкладок рейтинг не набирается
    if (this.ranked && winner >= 0 && users[0] !== null && users[1] !== null && users[0] !== users[1]) rating = this.hooks.onResult?.(winner, users, this.names());
    this.result = { winner, why, rating };
    this.broadcast({ t: 'result', result: this.result });
  }

  private names(): [string, string] {
    return [this.seats[0]?.name ?? '—', this.seats[1]?.name ?? '—'];
  }

  private startDraft(): void {
    this.phase = 'draft';
    // вторая четвёрка — только если купили оба
    this.draft = newDraft(this.seed, this.budget, this.seats.every((s) => s?.full));
    this.deadline = this.now() + HERO_MS;
    this.sendDraftAll();
  }

  private nextRound(): void {
    const d = this.draft!;
    draftAdvance(d);
    if (d.done) return this.startBattle();
    this.deadline = this.now() + ARMY_MS;
    this.sendDraftAll();
  }

  private startBattle(): void {
    const d = this.draft!;
    // поле — из базовых четырёх: у них оно есть всегда
    const field = FACTIONS[this.seed % 4].field;
    this.state = createBattle({
      seed: this.seed,
      field,
      sides: [{ hero: d.sides[0].hero!, army: d.sides[0].army }, { hero: d.sides[1].hero!, army: d.sides[1].army }],
    });
    this.phase = 'battle';
    this.since = this.now() + LOAD_MS;
    for (const p of this.peers) this.sendStart(p);
  }

  private sendStart(p: RoomPeer): void {
    if (!this.state) {
      // партия кончилась ещё на драфте: боя нет, только итог
      if (this.result) p.send({ t: 'result', result: this.result });
      return;
    }
    const wait = Math.max(0, this.since - this.now());
    p.send({ t: 'start', state: battleViewFor(this.state, this.seatOf(p)), seat: this.seatOf(p), names: this.names(), clock: this.clock(wait), result: this.result ?? undefined, you: p.id });
  }

  private sendDraftAll(): void {
    for (const p of this.peers) this.sendDraft(p);
  }

  private sendDraft(p: RoomPeer): void {
    const d = this.draft!;
    const seat = this.seatOf(p);
    const view: DraftView = {
      round: d.round,
      rounds: ARMY_ROUNDS,
      budget: d.budget,
      offer: seat === null ? [] : d.sides[seat].offer,
      picked: seat === null ? -1 : d.sides[seat].pick,
      sides: [
        { hero: d.sides[0].hero, army: d.sides[0].army, thinking: d.sides[0].pick < 0 },
        { hero: d.sides[1].hero, army: d.sides[1].army, thinking: d.sides[1].pick < 0 },
      ],
      ms: Math.max(0, this.deadline - this.now()),
    };
    p.send({ t: 'draft', d: view, seat, peers: this.peerList() });
  }

  private peerList(): NetPeer[] {
    return this.seats.flatMap((s, i) => (s ? [{ id: i, name: s.name, seat: i, on: !s.goneAt }] : []));
  }

  private sendLobby(): void {
    for (const p of this.peers) p.send({ t: 'lobby', budget: this.budget, peers: this.peerList(), you: p.id, host: this.seatOf(p) === 0, rated: this.ranked });
  }

  private voiceList(): void {
    const members = this.peers.filter((x) => this.talking.has(x.id)).map((x) => ({ id: String(x.id), name: x.name, seat: this.seatOf(x), video: false }));
    this.broadcast({ t: 'voice', members });
  }

  private broadcast(m: NetServerMsg): void {
    for (const p of this.peers) p.send(m);
  }
}
