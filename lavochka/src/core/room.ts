/*
 * Комната — хозяин партии. Один и тот же код работает:
 *   • в браузере при локальной игре (все каналы локальные);
 *   • в браузере хоста при игре P2P (каналы PeerJS + локальный канал самого хоста);
 *   • на сервере Node (каналы WebSocket) — тогда скрытую информацию не видит никто из игроков.
 *
 * Места: 'human' принадлежат владельцу комнаты (хот-сит за его экраном), 'remote' занимают подключившиеся,
 * 'bot' — боты. Если игрок отключился, за его место ходит бот, пока он не вернётся (по clientId или имени).
 */
import { Authority, type Snapshot, type StepResult } from './authority';
import { PROTOCOL_VERSION, type ClientMsg, type Link, type RoomMsg, type SeatStatus } from './protocol';
import { SeededRng, randomSeed } from './rng';
import type { GameDef, Options, SeatSpec } from './types';

const HEARTBEAT_MS = 2000;
const TIMEOUT_MS = 10000;
/** Сколько ждать, пока клиенты доиграют анимацию, прежде чем ходит бот. */
const PACE_TIMEOUT_MS = 6000;

interface Conn {
  link: Link;
  clientId: string | null;
  name: string;
  seats: number[];
  owner: boolean;
  lastSeen: number;
  idleSeq: number;
}

export interface RoomConfig {
  def: GameDef;
  options: Options;
  seats: SeatSpec[];
  code: string;
  ownerKey: string;
  snapshot?: Snapshot;
  /** Автосохранение (локальная игра). null — партия окончена, сохранение удалить. */
  onSnapshot?(snap: Snapshot | null): void;
  /** Все ушли — комнату можно удалять (сервер). */
  onEmpty?(): void;
  botDelay?: number;
}

export class Room {
  readonly def: GameDef;
  readonly code: string;
  options: Options;
  seats: SeatSpec[];
  auth: Authority | null = null;
  private conns = new Set<Conn>();
  /** remote-место → clientId занявшего. */
  private holders = new Map<number, { clientId: string; name: string }>();
  private heartbeat: ReturnType<typeof setInterval>;
  private botToken = 0;
  private botRng = new SeededRng(randomSeed());
  private closed = false;

  constructor(private cfg: RoomConfig) {
    this.def = cfg.def;
    this.code = cfg.code;
    this.options = cfg.options;
    this.seats = cfg.seats.map((s) => ({ ...s }));
    if (cfg.snapshot) this.auth = new Authority(this.def, cfg.snapshot.seats, cfg.snapshot.options, cfg.snapshot);
    this.heartbeat = setInterval(() => this.beat(), HEARTBEAT_MS);
  }

  get started() {
    return !!this.auth;
  }

  // ---------------------------------------------------------------- соединения

  connect(link: Link) {
    if (this.closed) return link.close();
    const conn: Conn = { link, clientId: null, name: '', seats: [], owner: false, lastSeen: Date.now(), idleSeq: 0 };
    this.conns.add(conn);
    link.onMessage = (m) => this.onMsg(conn, m);
    link.onClose = () => this.drop(conn);
  }

  private send(conn: Conn, msg: RoomMsg) {
    try {
      conn.link.send(msg);
    } catch {
      /* канал умер — его подберёт heartbeat */
    }
  }

  private broadcast(msg: RoomMsg) {
    this.conns.forEach((c) => c.clientId && this.send(c, msg));
  }

  private onMsg(conn: Conn, m: ClientMsg) {
    if (!m || typeof m !== 'object') return;
    conn.lastSeen = Date.now();
    switch (m.t) {
      case 'hello':
        return this.hello(conn, m);
      case 'act':
        if (this.auth && conn.seats.includes(m.seat)) this.tryAct(m.seat, m.action);
        return;
      case 'chat': {
        const text = String(m.text || '').trim().slice(0, 300);
        if (text && conn.clientId) this.broadcast({ t: 'chat', name: conn.name, seat: conn.seats[0] ?? null, text });
        return;
      }
      case 'idle':
        conn.idleSeq = Math.max(conn.idleSeq, m.seq | 0);
        return;
      case 'start':
        if (conn.owner && !this.auth) this.startGame(!!m.fillBots, conn);
        return;
      case 'restart':
        if (conn.owner && this.auth && this.auth.result) this.restart();
        return;
      case 'bye':
        return this.drop(conn);
      default:
        return;
    }
  }

  private hello(conn: Conn, m: Extract<ClientMsg, { t: 'hello' }>) {
    if (m.v !== PROTOCOL_VERSION) {
      this.send(conn, { t: 'error', text: 'Версия игры у вас и у хоста не совпадает. Обновите страницу.' });
      return;
    }
    conn.clientId = String(m.clientId || '').slice(0, 64) || 'anon';
    conn.name = String(m.name || 'Игрок').trim().slice(0, 16) || 'Игрок';

    if (m.ownerKey && m.ownerKey === this.cfg.ownerKey) {
      // владелец (в т.ч. вернувшийся после обрыва): старое соединение владельца закрываем
      for (const c of this.conns) if (c !== conn && c.owner) this.kick(c);
      conn.owner = true;
      conn.seats = this.seats.filter((s) => s.kind === 'human').map((s) => s.seat);
    } else {
      // тот же клиент мог открыть второе окно — старое соединение выкидываем
      for (const c of this.conns) if (c !== conn && c.clientId === conn.clientId && !c.owner) this.kick(c);
      const seat = this.pickSeat(conn);
      if (seat != null) {
        this.holders.set(seat, { clientId: conn.clientId, name: this.auth ? this.holders.get(seat)?.name ?? conn.name : conn.name });
        conn.seats = [seat];
      }
    }

    this.send(conn, { t: 'welcome', code: this.code, game: this.def.id, options: this.options, mySeats: conn.seats, owner: conn.owner });
    if (this.auth) {
      this.sendStart(conn);
      if (conn.seats.length && !conn.link.local) this.broadcast({ t: 'info', text: `${conn.owner ? conn.name : this.seatName(conn.seats[0])}: снова в игре` });
      this.broadcast({ t: 'seats', seats: this.seatStatus() });
    } else {
      if (!conn.seats.length && !conn.owner) this.send(conn, { t: 'info', text: 'Свободных мест нет — вы зритель.' });
      this.broadcast({ t: 'lobby', seats: this.seatStatus() });
    }
  }

  /** Место для подключившегося: своё прежнее → прежнее по имени → любое свободное. */
  private pickSeat(conn: Conn): number | null {
    const remote = this.seats.filter((s) => s.kind === 'remote').map((s) => s.seat);
    const onlineIds = new Set([...this.conns].filter((c) => c !== conn && c.clientId).map((c) => c.clientId));
    const free = (seat: number) => {
      const h = this.holders.get(seat);
      return !h || !onlineIds.has(h.clientId);
    };
    for (const s of remote) if (this.holders.get(s)?.clientId === conn.clientId) return s;
    for (const s of remote) if (free(s) && this.holders.get(s)?.name === conn.name) return s;
    if (!this.auth) {
      for (const s of remote) if (!this.holders.has(s)) return s;
      return null;
    }
    for (const s of remote) if (free(s)) return s;
    return null;
  }

  private kick(c: Conn) {
    this.conns.delete(c);
    try {
      c.link.onClose = null;
      c.link.close();
    } catch {
      /* ignore */
    }
  }

  private drop(conn: Conn) {
    if (!this.conns.has(conn)) return;
    this.conns.delete(conn);
    try {
      conn.link.onClose = null;
      conn.link.close();
    } catch {
      /* ignore */
    }
    if (this.closed) return;
    if (!this.auth && conn.owner) {
      // хозяин ушёл до начала партии — ждать больше некого
      this.close('Хозяин стола закрыл комнату.');
      this.cfg.onEmpty?.();
      return;
    }
    if (!this.auth) {
      // в лобби место освобождается
      for (const s of conn.seats) if (this.holders.get(s)?.clientId === conn.clientId) this.holders.delete(s);
      this.broadcast({ t: 'lobby', seats: this.seatStatus() });
    } else if (conn.seats.length) {
      const who = conn.owner ? conn.name || 'Хозяин стола' : this.seatName(conn.seats[0]);
      this.broadcast({ t: 'info', text: `${who}: потерял связь — пока за него ходит бот` });
      this.broadcast({ t: 'seats', seats: this.seatStatus() });
      this.pumpBots();
    }
    if (![...this.conns].some((c) => c.clientId)) this.cfg.onEmpty?.();
  }

  private beat() {
    const now = Date.now();
    for (const c of [...this.conns]) {
      if (c.link.local) continue;
      if (now - c.lastSeen > TIMEOUT_MS) this.drop(c);
      else this.send(c, { t: 'ping' });
    }
  }

  // ---------------------------------------------------------------- места

  private isOnline(seat: number): boolean {
    const spec = this.seats.find((s) => s.seat === seat);
    if (!spec) return false;
    if (spec.kind === 'bot') return true;
    if (spec.kind === 'human') return [...this.conns].some((c) => c.owner);
    const h = this.holders.get(seat);
    return !!h && [...this.conns].some((c) => c.clientId === h.clientId);
  }

  private isBotSeat(seat: number): boolean {
    const spec = this.seats.find((s) => s.seat === seat);
    return !!spec && (spec.kind === 'bot' || !this.isOnline(seat));
  }

  private seatName(seat: number): string {
    const spec = this.seats.find((s) => s.seat === seat);
    if (!spec) return '?';
    if (spec.kind === 'remote') return this.holders.get(seat)?.name || spec.name || 'Игрок';
    return spec.name;
  }

  seatStatus(): SeatStatus[] {
    return this.seats.map((s) => ({
      seat: s.seat,
      kind: s.kind,
      level: s.level,
      name: this.seatName(s.seat),
      filled: s.kind !== 'remote' || this.holders.has(s.seat),
      online: this.isOnline(s.seat),
    }));
  }

  // ---------------------------------------------------------------- партия

  private startGame(fillBots: boolean, by: Conn) {
    const empty = this.seats.filter((s) => s.kind === 'remote' && !this.holders.has(s.seat));
    if (empty.length && !fillBots) {
      this.send(by, { t: 'error', text: 'Ещё не все подключились.' });
      return;
    }
    const mid = Math.floor((this.def.bot.levels.length - 1) / 2);
    for (const s of empty) {
      s.kind = 'bot';
      s.level = mid;
      s.name = `${this.def.seats[s.seat]?.name ?? 'Бот'} (бот)`;
    }
    for (const s of this.seats) if (s.kind === 'remote') s.name = this.seatName(s.seat);
    this.auth = new Authority(this.def, this.seats.map((s) => ({ ...s })), this.options);
    this.conns.forEach((c) => c.clientId && this.sendStart(c));
    this.save();
    this.pumpBots();
  }

  private restart() {
    this.botToken++;
    this.auth = new Authority(this.def, this.seats.map((s) => ({ ...s })), this.options);
    this.conns.forEach((c) => c.clientId && this.sendStart(c));
    this.save();
    this.pumpBots();
  }

  private viewSeats(conn: Conn): number[] {
    return conn.seats;
  }

  private sendStart(conn: Conn) {
    const a = this.auth!;
    this.send(conn, {
      t: 'start',
      seats: this.seatStatus(),
      mySeats: conn.seats,
      view: a.viewFor(this.viewSeats(conn)),
      toAct: a.toAct(),
      seq: a.seq,
      result: a.result,
    });
  }

  private tryAct(seat: number, action: unknown) {
    const a = this.auth;
    if (!a) return;
    const res = a.act(seat, action);
    if (!res) return;
    this.broadcastStep(res);
    this.save();
    this.pumpBots();
  }

  private broadcastStep(res: StepResult) {
    const a = this.auth!;
    const toAct = a.toAct();
    this.conns.forEach((c) => {
      if (!c.clientId) return;
      const seats = this.viewSeats(c);
      this.send(c, {
        t: 'step',
        seq: res.seq,
        actor: res.actor,
        events: a.redact(res.events, seats),
        view: a.viewFor(seats),
        toAct,
        result: a.result,
      });
    });
  }

  private save() {
    if (!this.cfg.onSnapshot || !this.auth) return;
    this.cfg.onSnapshot(this.auth.result ? null : this.auth.snapshot());
  }

  /** Если ход за ботом (или за отключившимся) — ждём, пока все доиграют анимацию, и ходим. */
  private pumpBots() {
    const token = ++this.botToken;
    const a = this.auth;
    if (!a || a.result || this.closed) return;
    const seat = a.toAct().find((s) => this.isBotSeat(s));
    if (seat == null) return;
    const seq = a.seq;
    void (async () => {
      const deadline = Date.now() + PACE_TIMEOUT_MS;
      while (Date.now() < deadline) {
        const watchers = [...this.conns].filter((c) => c.clientId && c.seats.length);
        if (watchers.every((c) => c.idleSeq >= seq)) break;
        await wait(60);
        if (token !== this.botToken) return;
      }
      await wait(this.cfg.botDelay ?? 450);
      if (token !== this.botToken || this.auth !== a || a.seq !== seq || !this.isBotSeat(seat)) return;
      const spec = a.seats.find((s) => s.seat === seat)!;
      const level = spec.kind === 'bot' ? spec.level : Math.floor((this.def.bot.levels.length - 1) / 2);
      let action: unknown = null;
      try {
        action = await this.def.bot.choose(a.viewFor([seat]), seat, level, this.botRng);
      } catch (e) {
        console.error('bot failed', e);
      }
      if (token !== this.botToken || this.auth !== a || a.seq !== seq) return;
      if (action == null) {
        console.warn('Бот не нашёл хода', this.def.id, seat);
        return;
      }
      this.tryAct(seat, action);
    })();
  }

  close(reason?: string) {
    if (this.closed) return;
    this.broadcast({ t: 'closed', reason });
    this.closed = true;
    this.botToken++;
    clearInterval(this.heartbeat);
    const conns = [...this.conns];
    this.conns.clear();
    // даём сообщению «closed» уйти
    setTimeout(() => conns.forEach((c) => this.kick(c)), 200);
  }

  get isClosed() {
    return this.closed;
  }
}

function wait(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}
