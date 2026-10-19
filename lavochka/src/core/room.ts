/*
 * Комната — хозяин партии. Один и тот же код работает:
 *   • в браузере при локальной игре (все каналы локальные);
 *   • в браузере хоста при игре P2P (каналы PeerJS + локальный канал самого хоста);
 *   • на сервере Node (каналы WebSocket) — тогда скрытую информацию не видит никто из игроков.
 *
 * Места: 'human' принадлежат владельцу комнаты (хот-сит за его экраном), 'remote' занимают подключившиеся,
 * 'bot' — боты. Если игрок отключился, за его место ходит бот, пока он не вернётся (по clientId или имени);
 * первые DROP_GRACE_MS бот не ходит — даём перезагрузиться и вернуться.
 */
import { Authority, type Snapshot, type StepResult } from './authority';
import { PROTOCOL_VERSION, type ClientMsg, type Link, type RoomMsg, type SeatStatus, type VoiceMember } from './protocol';
import { SeededRng, randomSeed } from './rng';
import type { GameDef, Options, SeatSpec } from './types';

const HEARTBEAT_MS = 2000;
const TIMEOUT_MS = 10000;
/** Сколько лобби ждёт хозяина, потерявшего связь (обновил страницу). */
const OWNER_WAIT_MS = 60000;
/** Сколько ждать, пока клиенты доиграют анимацию, прежде чем ходит бот. */
const PACE_TIMEOUT_MS = 6000;
/** Сколько самое большее ждать клиента, у которого грузится стол. */
const HOLD_MAX_MS = 30000;
/** Сколько ждать отключившегося, прежде чем за него сядет бот. */
const DROP_GRACE_MS = 45000;

interface Conn {
  link: Link;
  clientId: string | null;
  name: string;
  seats: number[];
  owner: boolean;
  lastSeen: number;
  idleSeq: number;
  /** Просит «пропустить» — боты ходят без пауз. */
  fast: boolean;
  /** До этого момента стол грузится — боты ждут. */
  holdUntil: number;
  /** В голосовом чате (и с камерой ли). */
  voice: { video: boolean } | null;
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
  /** Сколько ждать отключившегося до бота (по умолчанию DROP_GRACE_MS). */
  dropGraceMs?: number;
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
  /** Кто отвалился посреди партии — чтобы объявить его возвращение. */
  private dropped = new Set<string>();
  /** Место → когда его игрок отключился (пока ждём, бот за него не ходит). */
  private offSince = new Map<number, number>();
  private graceTimer: ReturnType<typeof setTimeout> | undefined;
  /** Хозяин потерял связь в лобби (обновил страницу): ждём его, прежде чем закрыть комнату. */
  private ownerTimer: ReturnType<typeof setTimeout> | undefined;
  // игра реального времени: таймер шагов, последний ввод мест, память ботов, события до ближайшего снимка
  private rtTimer: ReturnType<typeof setInterval> | undefined;
  private rtLast = 0;
  private rtTicks = 0;
  private rtInputs = new Map<number, unknown>();
  private rtBotMem = new Map<number, Record<string, any>>();
  private rtEvents: unknown[] = [];
  private rtSaveAt = 0;

  constructor(private cfg: RoomConfig) {
    this.def = cfg.def;
    this.code = cfg.code;
    this.options = cfg.options;
    this.seats = cfg.seats.map((s) => ({ ...s }));
    if (cfg.snapshot) this.auth = new Authority(this.def, cfg.snapshot.seats, cfg.snapshot.options, cfg.snapshot);
    this.heartbeat = setInterval(() => this.beat(), HEARTBEAT_MS);
    if (this.auth) this.rtStart();
  }

  get started() {
    return !!this.auth;
  }

  // ---------------------------------------------------------------- соединения

  connect(link: Link) {
    if (this.closed) return link.close();
    const conn: Conn = { link, clientId: null, name: '', seats: [], owner: false, lastSeen: Date.now(), idleSeq: 0, fast: false, holdUntil: 0, voice: null };
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
      case 'input': {
        const rt = this.def.realtime;
        if (!rt || !this.auth || !conn.seats.includes(m.seat)) return;
        const inp = rt.input(m.input);
        if (inp != null) this.rtInputs.set(m.seat, inp);
        return;
      }
      case 'chat': {
        const text = String(m.text || '').trim().slice(0, 300);
        if (text && conn.clientId) this.broadcast({ t: 'chat', name: conn.name, seat: conn.seats[0] ?? null, text });
        return;
      }
      case 'idle':
        conn.idleSeq = Math.max(conn.idleSeq, m.seq | 0);
        conn.fast = !!m.fast;
        return;
      case 'hold':
        conn.holdUntil = m.ms > 0 ? Date.now() + Math.min(HOLD_MAX_MS, m.ms) : 0;
        return;
      case 'start':
        if (conn.owner && !this.auth) this.startGame(!!m.fillBots, conn);
        return;
      case 'restart':
        if (conn.owner && this.auth && this.auth.result) this.restart();
        return;
      case 'bye':
        return this.drop(conn, true);
      case 'sync':
        if (this.auth && conn.clientId) this.sendStart(conn, true);
        return;
      case 'voice':
        if (!conn.clientId) return;
        conn.voice = m.on ? { video: !!m.video } : null;
        return this.voiceList();
      case 'rtc': {
        // сигналы WebRTC — только между участниками голосового чата, не больше 32 КБ
        if (!conn.voice || !conn.clientId) return;
        let size = 0;
        try {
          size = JSON.stringify(m.data ?? null).length;
        } catch {
          return;
        }
        if (size > 32000) return;
        for (const c of this.conns) if (c.voice && c.clientId === m.to) this.send(c, { t: 'rtc', from: conn.clientId, data: m.data });
        return;
      }
      default:
        return;
    }
  }

  /** Кто в голосовом чате — всем. */
  private voiceList() {
    const members: VoiceMember[] = [...this.conns]
      .filter((c) => c.voice && c.clientId)
      .map((c) => ({ id: c.clientId!, name: c.seats.length === 1 ? this.seatName(c.seats[0]) : c.name, seat: c.seats.length === 1 ? c.seats[0] : null, video: c.voice!.video }));
    this.broadcast({ t: 'voice', members });
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
      clearTimeout(this.ownerTimer);
      this.ownerTimer = undefined;
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
      if (conn.seats.length && this.dropped.delete(conn.clientId)) {
        this.broadcast({ t: 'info', text: `${conn.owner ? conn.name : this.seatName(conn.seats[0])}: снова в игре` });
      }
      this.broadcast({ t: 'seats', seats: this.seatStatus() });
      // партия из сохранения (или ход бота, прерванный перезагрузкой) — без этого бот так и не пойдёт
      this.pumpBots();
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
    if (c.voice) this.voiceList();
    try {
      c.link.onClose = null;
      c.link.close();
    } catch {
      /* ignore */
    }
  }

  private drop(conn: Conn, bye = false) {
    if (!this.conns.has(conn)) return;
    this.conns.delete(conn);
    if (conn.voice) this.voiceList();
    try {
      conn.link.onClose = null;
      conn.link.close();
    } catch {
      /* ignore */
    }
    if (this.closed) return;
    if (!this.auth && conn.owner) {
      // хозяин вышел до начала партии — ждать больше некого
      const gone = () => {
        this.close('Хозяин стола закрыл комнату.');
        this.cfg.onEmpty?.();
      };
      if (bye) return gone();
      // а связь оборвалась (обновил страницу) — ждём его минуту: вернётся по своему ключу
      clearTimeout(this.ownerTimer);
      this.ownerTimer = setTimeout(() => {
        if (![...this.conns].some((c) => c.owner)) gone();
      }, OWNER_WAIT_MS);
      this.broadcast({ t: 'info', text: 'Хозяин стола потерял связь — ждём минуту.' });
      return;
    }
    if (!this.auth) {
      // в лобби место освобождается
      for (const s of conn.seats) if (this.holders.get(s)?.clientId === conn.clientId) this.holders.delete(s);
      this.broadcast({ t: 'lobby', seats: this.seatStatus() });
    } else if (conn.seats.length) {
      if (conn.clientId) this.dropped.add(conn.clientId);
      const who = conn.owner ? conn.name || 'Хозяин стола' : this.seatName(conn.seats[0]);
      const grace = this.grace();
      const now = Date.now();
      for (const s of conn.seats) if (!this.isOnline(s)) this.offSince.set(s, now);
      this.broadcast({
        t: 'info',
        text: grace >= 1000 ? `${who}: потерял связь — ждём ${Math.round(grace / 1000)} с, потом за него будет ходить бот` : `${who}: потерял связь — пока за него ходит бот`,
      });
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

  private grace() {
    return this.cfg.dropGraceMs ?? DROP_GRACE_MS;
  }

  private isBotSeat(seat: number): boolean {
    const spec = this.seats.find((s) => s.seat === seat);
    if (!spec) return false;
    if (spec.kind === 'bot') return true;
    if (this.isOnline(seat)) {
      this.offSince.delete(seat);
      return false;
    }
    // только что отключился — ждём; за тех, кого ждать некому (все люди ушли), ходить тоже незачем
    const since = this.offSince.get(seat);
    return since == null || Date.now() - since >= this.grace();
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
    this.rtStart();
  }

  private restart() {
    this.botToken++;
    if (this.def.again) this.options = this.def.again(this.options);
    this.auth = new Authority(this.def, this.seats.map((s) => ({ ...s })), this.options);
    this.conns.forEach((c) => c.clientId && this.sendStart(c));
    this.save();
    this.pumpBots();
    this.rtStart();
  }

  // ---------------------------------------------------------------- реальное время

  private rtStart() {
    this.rtStop();
    const rt = this.def.realtime;
    if (!rt || !this.auth || this.auth.result || this.closed) return;
    this.rtInputs.clear();
    this.rtBotMem.clear();
    this.rtEvents = [];
    this.rtLast = now();
    this.rtTimer = setInterval(() => this.rtLoop(), Math.max(4, Math.floor(rt.tickMs / 2)));
  }

  private rtStop() {
    clearInterval(this.rtTimer);
    this.rtTimer = undefined;
  }

  /** Догоняем часы шагами симуляции; раз в sendEvery шагов — снимок всем. */
  private rtLoop() {
    const a = this.auth;
    const rt = this.def.realtime!;
    if (!a || a.result || this.closed) return this.rtStop();
    const t = now();
    // у кого-то грузится стол или людей нет совсем — стоим на паузе
    const watchers = [...this.conns].filter((c) => c.clientId && c.seats.length);
    if (!watchers.length || watchers.some((c) => c.holdUntil > Date.now())) {
      this.rtLast = t;
      return;
    }
    let n = Math.floor((t - this.rtLast) / rt.tickMs);
    if (n <= 0) return;
    // сильно отстали (вкладка хоста спала) — не догоняем рывком
    if (n > 8) {
      n = 8;
      this.rtLast = t - n * rt.tickMs;
    }
    this.rtLast += n * rt.tickMs;
    const top = Math.max(...a.seats.map((s) => s.seat)) + 1;
    for (let i = 0; i < n && !a.result; i++) {
      const inputs: unknown[] = new Array(top).fill(null);
      for (const s of a.seats) inputs[s.seat] = this.rtInput(s.seat);
      const ev = a.tick(inputs);
      if (ev.length) this.rtEvents.push(...ev);
      this.rtTicks++;
      if (this.rtTicks % rt.sendEvery === 0) this.rtSend();
    }
    if (a.result) {
      this.rtSend();
      this.rtStop();
      this.broadcastStep({ seq: a.seq, actor: -1, events: [] });
      this.save();
    } else if (t > this.rtSaveAt) {
      this.rtSaveAt = t + 3000;
      this.save();
    }
  }

  private rtInput(seat: number): unknown {
    const rt = this.def.realtime!;
    const a = this.auth!;
    if (this.isBotSeat(seat)) {
      const spec = a.seats.find((s) => s.seat === seat)!;
      const level = spec.kind === 'bot' ? spec.level : Math.floor((this.def.bot.levels.length - 1) / 2);
      let mem = this.rtBotMem.get(seat);
      if (!mem) this.rtBotMem.set(seat, (mem = {}));
      try {
        return rt.bot(a.viewFor([seat]), seat, level, mem, this.botRng);
      } catch (e) {
        console.error('bot failed', e);
        return rt.idle();
      }
    }
    // пока ждём отключившегося — его фигуры стоят
    return this.isOnline(seat) ? this.rtInputs.get(seat) ?? rt.idle() : rt.idle();
  }

  private rtSend() {
    const a = this.auth!;
    const events = this.rtEvents;
    this.rtEvents = [];
    this.conns.forEach((c) => {
      if (!c.clientId) return;
      const seats = this.viewSeats(c);
      this.send(c, { t: 'rt', view: a.viewFor(seats), events: events.length ? a.redact(events, seats) : [] });
    });
  }

  private viewSeats(conn: Conn): number[] {
    return conn.seats;
  }

  private sendStart(conn: Conn, resync = false) {
    const a = this.auth!;
    this.send(conn, {
      t: 'start',
      seats: this.seatStatus(),
      mySeats: conn.seats,
      view: a.viewFor(this.viewSeats(conn)),
      toAct: a.toAct(),
      seq: a.seq,
      result: a.result,
      ...(resync ? { resync: true } : {}),
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
    if (this.def.realtime) return;
    const token = ++this.botToken;
    const a = this.auth;
    if (!a || a.result || this.closed) return;
    clearTimeout(this.graceTimer);
    const seat = a.toAct().find((s) => this.isBotSeat(s));
    if (seat == null) {
      // ход за отключившимся, которого ещё ждём, — проверить снова, когда ожидание кончится
      const waiting = a
        .toAct()
        .filter((s) => this.offSince.has(s) && !this.isOnline(s))
        .map((s) => this.offSince.get(s)!);
      if (waiting.length) this.graceTimer = setTimeout(() => this.pumpBots(), Math.max(50, Math.min(...waiting) + this.grace() - Date.now() + 20));
      return;
    }
    const seq = a.seq;
    void (async () => {
      const deadline = Date.now() + PACE_TIMEOUT_MS;
      const watchers = () => [...this.conns].filter((c) => c.clientId && c.seats.length);
      for (;;) {
        const now = Date.now();
        // у кого-то ещё грузится стол — ждём его (не дольше HOLD_MAX_MS)
        const holding = watchers().some((c) => c.holdUntil > now);
        if (!holding && (now >= deadline || watchers().every((c) => c.idleSeq >= seq))) break;
        await wait(60);
        if (token !== this.botToken) return;
      }
      // все просят «пропустить» — без пауз
      const w = watchers();
      await wait(w.length && w.every((c) => c.fast) ? 0 : (this.cfg.botDelay ?? 450));
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
    clearTimeout(this.graceTimer);
    clearTimeout(this.ownerTimer);
    this.rtStop();
    const conns = [...this.conns];
    this.conns.clear();
    // даём сообщению «closed» уйти
    setTimeout(() => conns.forEach((c) => this.kick(c)), 200);
  }

  get isClosed() {
    return this.closed;
  }
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function wait(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}
