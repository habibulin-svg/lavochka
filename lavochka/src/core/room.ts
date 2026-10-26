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
import { AVATARS, PHOTO_RE } from './avatars';
import { PROTOCOL_VERSION, type ClientMsg, type HostOp, type Link, type Me, type RoomMsg, type SeatStatus, type VoiceMember } from './protocol';
import { SeededRng, randomSeed } from './rng';
import { startTicker, type Ticker } from './ticker';
import type { GameDef, Options, SeatKind, SeatSpec } from './types';

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

interface Holder {
  clientId: string;
  name: string;
  avatar: string | null;
  look: string | null;
}

/** Кто сидит на месте — то, что переезжает при пересадке. */
interface Occupant {
  kind: SeatKind;
  level: number;
  name: string;
  avatar: string | null;
  look: string | null;
  holder: Holder | null;
}

/** Аватар из сети: только значок из списка или фото с сервисов входа. */
/** Куда сообщать о сбоях ботов (сервер пишет их в «Ошибки» админки); в браузере не задано. */
export let roomErrorHook: ((e: unknown, where: string, game: string) => void) | null = null;
export function setRoomErrorHook(f: typeof roomErrorHook) {
  roomErrorHook = f;
}

export const cleanAvatar = (a: unknown): string | null => (typeof a === 'string' && (AVATARS.includes(a) || PHOTO_RE.test(a)) ? a : null);
/** Персонаж: короткий id (проверяет сама игра — незнакомый она заменит своим). */
export const cleanLook = (l: unknown): string | null => (typeof l === 'string' && /^[a-z0-9_-]{1,24}$/i.test(l) ? l : null);
/** Сигнал WebRTC от того, кому камера не положена: видеочасти SDP — только на приём (чужие камеры он видит, свою не шлёт). */
export function noVideoSend(data: any): any {
  const d = data?.description;
  if (!d || typeof d.sdp !== 'string') return data;
  const sdp = d.sdp
    .split(/(?=\r?\nm=)/)
    .map((sec: string) => (/^(\r?\n)?m=video/.test(sec) ? sec.replace(/a=sendrecv/g, 'a=recvonly').replace(/a=sendonly/g, 'a=inactive') : sec))
    .join('');
  return { ...data, description: { ...d, sdp } };
}

const cleanName = (n: unknown) => String(n || 'Игрок').trim().slice(0, 16) || 'Игрок';

interface Conn {
  link: Link;
  clientId: string | null;
  name: string;
  avatar: string | null;
  look: string | null;
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
  /** Молчит до этого момента (правило игры в чате). */
  muteUntil?: number;
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
  private holders = new Map<number, Holder>();
  /** Кого хозяин выгнал: за этот стол им больше не сесть. */
  private banned = new Set<string>();
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
  private rtTimer: Ticker | undefined;
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

  /** Сколько вкладок подключено (счётчик онлайна на сервере). */
  get clientCount() {
    return new Set([...this.conns].map((c) => c.clientId).filter(Boolean)).size;
  }

  // ---------------------------------------------------------------- соединения

  connect(link: Link) {
    if (this.closed) return link.close();
    const conn: Conn = { link, clientId: null, name: '', avatar: null, look: null, seats: [], owner: false, lastSeen: Date.now(), idleSeq: 0, fast: false, holdUntil: 0, voice: null };
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
        if (!text || !conn.clientId) return;
        const now = Date.now();
        if (conn.muteUntil && conn.muteUntil > now) {
          this.send(conn, { t: 'chat', name: 'Стол', seat: null, text: `Вы молчите ещё ${Math.ceil((conn.muteUntil - now) / 1000)} с.` });
          return;
        }
        this.broadcast({ t: 'chat', name: conn.name, seat: conn.seats[0] ?? null, text });
        const seat = conn.seats[0];
        const rule = this.auth && seat != null ? this.def.chatRule?.(this.auth.state, seat, text, this.auth.seats.reduce<string[]>((a, x) => ((a[x.seat] = x.name), a), [])) : null;
        if (rule) {
          conn.muteUntil = now + rule.mute * 1000;
          this.broadcast({ t: 'chat', name: 'Стол', seat: null, text: rule.note });
        }
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
      case 'me':
        if (conn.clientId) this.setMe(conn, m);
        return;
      case 'sit':
        if (conn.clientId && !conn.owner && !this.auth) this.sit(conn, m.seat);
        return;
      case 'host':
        if (conn.owner && !this.auth) this.hostOp(conn, m);
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
        // камера — по праву video (на сервере канал знает его; локально и P2P не проверяем)
        conn.voice = m.on ? { video: !!m.video && conn.link.video !== false } : null;
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
        const data = conn.link.video === false ? noVideoSend(m.data) : m.data;
        for (const c of this.conns) if (c.voice && c.clientId === m.to) this.send(c, { t: 'rtc', from: conn.clientId, data });
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
    conn.name = cleanName(m.name);
    conn.avatar = cleanAvatar(m.avatar);
    conn.look = cleanLook(m.look);
    if (this.banned.has(conn.clientId) && m.ownerKey !== this.cfg.ownerKey) {
      this.send(conn, { t: 'closed', reason: 'Хозяин стола убрал вас из этой комнаты.' });
      setTimeout(() => this.kick(conn), 200);
      return;
    }

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
        const was = this.holders.get(seat);
        // посреди партии место остаётся под прежним именем (его видели все); в лобби — как игрок себя назвал
        this.holders.set(seat, this.auth && was ? { ...was, clientId: conn.clientId } : { clientId: conn.clientId, name: conn.name, avatar: conn.avatar, look: conn.look });
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
      this.lobbyAll();
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
      this.lobbyAll();
    } else if (conn.seats.length) {
      if (conn.clientId) this.dropped.add(conn.clientId);
      const who = conn.owner ? conn.name || 'Хозяин стола' : this.seatName(conn.seats[0]);
      const grace = this.grace();
      const now = Date.now();
      for (const s of conn.seats) if (!this.isOnline(s)) this.offSince.set(s, now);
      const then = this.def.awayText?.(this.options) ?? 'за него будет ходить бот';
      this.broadcast({
        t: 'info',
        text: grace >= 1000 ? `${who}: потерял связь — ждём ${Math.round(grace / 1000)} с, потом ${then}` : `${who}: потерял связь — пока ${then}`,
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
    return this.seats.map((s) => {
      const o = this.occupant(s.seat);
      return {
        seat: s.seat,
        kind: s.kind,
        level: s.level,
        name: this.seatName(s.seat),
        filled: s.kind !== 'remote' || this.holders.has(s.seat),
        online: this.isOnline(s.seat),
        avatar: o.avatar,
        look: o.look,
      };
    });
  }

  private ownerConn(): Conn | null {
    return [...this.conns].find((c) => c.owner) ?? null;
  }

  /** Кто на месте сейчас: в лобби аватар и персонаж — живые (игрок мог сменить), в партии — как записано в месте.
   * Хозяин за своим экраном один (не хот-сит) — его аватар и персонаж и есть аватар его места. */
  private occupant(seat: number): Occupant {
    const spec = this.seats.find((s) => s.seat === seat)!;
    const holder = spec.kind === 'remote' ? this.holders.get(seat) ?? null : null;
    let avatar = spec.avatar ?? null;
    let look = spec.look ?? null;
    if (!this.auth) {
      if (holder) ({ avatar, look } = holder);
      else if (spec.kind === 'human' && this.seats.filter((x) => x.kind === 'human').length === 1) {
        const oc = this.ownerConn();
        if (oc) ({ avatar, look } = oc);
      }
    }
    return { kind: spec.kind, level: spec.level, name: spec.name, avatar, look, holder };
  }

  /** Посадить на место (from — откуда пересел): бот получает имя места, человек хозяина с именем по умолчанию — тоже. */
  private place(seat: number, o: Occupant, from: number) {
    const spec = this.seats.find((s) => s.seat === seat)!;
    const lookName = (n: number) => this.def.seats[n]?.name ?? 'Игрок';
    spec.kind = o.kind;
    spec.level = o.level;
    spec.avatar = o.kind === 'human' ? o.avatar : null;
    spec.look = o.kind === 'human' ? o.look : null;
    if (o.kind === 'bot') spec.name = `${lookName(seat)} (бот)`;
    else if (o.kind === 'human') spec.name = !o.name || o.name === lookName(from) ? lookName(seat) : o.name;
    else spec.name = '';
    if (o.kind === 'remote' && o.holder) this.holders.set(seat, o.holder);
    else this.holders.delete(seat);
  }

  /** После пересадки: каждый экран — на свои места. */
  private reseat() {
    const human = this.seats.filter((s) => s.kind === 'human').map((s) => s.seat);
    for (const c of this.conns) {
      if (!c.clientId) continue;
      const had = c.seats.length > 0;
      c.seats = c.owner ? human : this.seats.filter((s) => s.kind === 'remote' && this.holders.get(s.seat)?.clientId === c.clientId).map((s) => s.seat);
      if (!c.owner && had && !c.seats.length) this.send(c, { t: 'info', text: 'Хозяин освободил ваше место — вы зритель. Можно сесть на свободное.' });
    }
  }

  /** Лобби — каждому со своими местами. */
  private lobbyAll() {
    const seats = this.seatStatus();
    this.conns.forEach((c) => c.clientId && this.send(c, { t: 'lobby', seats, options: this.options, mySeats: c.seats }));
  }

  // ---------------------------------------------------------------- лобби: я, пересадка, хозяин

  private setMe(conn: Conn, m: Me) {
    if (m.name != null && !this.auth) conn.name = cleanName(m.name);
    if (m.avatar !== undefined) conn.avatar = cleanAvatar(m.avatar);
    if (m.look !== undefined) conn.look = cleanLook(m.look);
    if (this.auth) return;
    for (const [seat, h] of this.holders) if (h.clientId === conn.clientId) this.holders.set(seat, { ...h, name: conn.name, avatar: conn.avatar, look: conn.look });
    if (conn.owner && m.name != null) {
      const human = this.seats.filter((s) => s.kind === 'human');
      if (human.length === 1) human[0].name = conn.name;
    }
    this.lobbyAll();
  }

  private sit(conn: Conn, seat: number) {
    const spec = this.seats.find((s) => s.seat === seat);
    if (!spec || spec.kind !== 'remote' || this.holders.has(seat)) return this.send(conn, { t: 'error', text: 'Это место уже занято.' });
    for (const s of conn.seats) this.holders.delete(s);
    this.holders.set(seat, { clientId: conn.clientId!, name: conn.name, avatar: conn.avatar, look: conn.look });
    this.reseat();
    this.lobbyAll();
  }

  private hostOp(conn: Conn, m: HostOp) {
    const has = (seat: number) => this.seats.some((s) => s.seat === seat);
    const mid = Math.floor((this.def.bot.levels.length - 1) / 2);
    switch (m.op) {
      case 'swap': {
        if (!has(m.a) || !has(m.b) || m.a === m.b) return;
        const a = this.occupant(m.a);
        const b = this.occupant(m.b);
        this.place(m.a, b, m.b);
        this.place(m.b, a, m.a);
        break;
      }
      case 'shuffle': {
        const nums = this.seats.map((s) => s.seat);
        const occ = nums.map((n) => ({ o: this.occupant(n), from: n }));
        for (let i = occ.length - 1; i > 0; i--) {
          const j = Math.floor(this.botRng.next() * (i + 1));
          [occ[i], occ[j]] = [occ[j], occ[i]];
        }
        nums.forEach((n, i) => this.place(n, occ[i].o, occ[i].from));
        break;
      }
      case 'kind': {
        if (!has(m.seat) || !['human', 'bot', 'remote'].includes(m.kind)) return;
        const cur = this.occupant(m.seat);
        const level = Math.max(0, Math.min(this.def.bot.levels.length - 1, Math.floor(Number(m.level ?? (cur.kind === 'bot' ? cur.level : mid)) || 0)));
        if (cur.kind === m.kind && m.kind !== 'bot') return;
        const humans = this.seats.filter((s) => s.kind === 'human').length;
        this.place(m.seat, { kind: m.kind, level, name: m.kind === 'human' && !humans ? conn.name : '', avatar: null, look: null, holder: null }, m.seat);
        break;
      }
      case 'kick': {
        const h = this.holders.get(m.seat);
        if (!h) return;
        this.banned.add(h.clientId);
        this.holders.delete(m.seat);
        for (const c of [...this.conns])
          if (c.clientId === h.clientId && !c.owner) {
            this.send(c, { t: 'closed', reason: 'Хозяин стола убрал вас из этой комнаты.' });
            this.conns.delete(c);
            setTimeout(() => this.kick(c), 200);
          }
        this.broadcast({ t: 'info', text: `${h.name} больше не за столом.` });
        break;
      }
      case 'setup': {
        const err = this.setup(m.options, m.count);
        if (err) return this.send(conn, { t: 'error', text: err });
        break;
      }
      default:
        return;
    }
    this.reseat();
    this.lobbyAll();
  }

  /** Сменить варианты и число мест до начала партии. Люди с убранных мест пересаживаются на свободные. */
  private setup(raw: unknown, count: number): string | null {
    const def = this.def;
    const options: Options = { ...this.options };
    if (raw && typeof raw === 'object')
      for (const o of def.options ?? []) {
        const v = (raw as Options)[o.key];
        if (v !== undefined && typeof v === typeof o.default) options[o.key] = v;
      }
    const range = Array.from({ length: def.players.max - def.players.min + 1 }, (_, i) => def.players.min + i);
    const listed = (def.countsFor?.(options) ?? []).filter((n) => range.includes(n));
    const allowed = listed.length ? listed : range;
    if (!allowed.includes(count)) return `При этих правилах играют: ${allowed.join(', ')}.`;
    const nums = def.seatsFor ? def.seatsFor(count) : Array.from({ length: count }, (_, i) => i);
    const old = new Map(this.seats.map((s) => [s.seat, this.occupant(s.seat)] as const));
    const people = [...old].filter(([n, o]) => !nums.includes(n) && (o.kind === 'human' || o.holder));
    const free = nums.filter((n) => {
      const o = old.get(n);
      return !o || o.kind === 'bot' || (o.kind === 'remote' && !o.holder);
    });
    if (people.length > free.length) return 'Людей больше, чем мест: сначала уберите кого-нибудь из-за стола.';
    const mid = Math.floor((def.bot.levels.length - 1) / 2);
    this.seats = nums.map((seat) => ({ seat, kind: 'remote', level: mid, name: '' }));
    this.holders.clear();
    for (const n of nums) {
      const o = old.get(n);
      if (o) this.place(n, o, n);
    }
    // люди с убранных мест — на первые свободные; новые места ждут игрока по сети
    people.forEach(([from, o], i) => this.place(free[i], o, from));
    this.options = options;
    return null;
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
    for (const s of this.seats) {
      const o = this.occupant(s.seat);
      s.avatar = o.avatar;
      s.look = o.look;
      if (s.kind === 'remote') s.name = this.seatName(s.seat);
    }
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
    this.rtTimer = startTicker(() => this.rtLoop(), Math.max(4, Math.floor(rt.tickMs / 2)));
  }

  private rtStop() {
    this.rtTimer?.stop();
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
        roomErrorHook?.(e, 'бот (реальное время)', this.def.id);
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
        // отключившийся человек «сидит вне игры», если игра так умеет; иначе за него ходит бот
        const away = spec.kind === 'bot' ? null : (this.def.away?.(a.viewFor([seat]), seat) ?? null);
        action = away ?? (await this.def.bot.choose(a.viewFor([seat]), seat, level, this.botRng));
      } catch (e) {
        console.error('bot failed', e);
        roomErrorHook?.(e, 'бот', this.def.id);
      }
      if (token !== this.botToken || this.auth !== a || a.seq !== seq) return;
      if (action == null) {
        console.warn('Бот не нашёл хода', this.def.id, seat);
        roomErrorHook?.(new Error('Бот не нашёл хода'), `бот, фаза ${String((a.viewFor([seat]) as any)?.phase ?? '?')}`, this.def.id);
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
