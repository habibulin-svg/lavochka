/* Хранилище аккаунтов: интерфейс и вариант в памяти (тесты и разработка без базы).
 * На сервере — PostgreSQL (pg.ts); выбор — в accounts/index.ts по переменной PGDATABASE.
 * Времена — миллисекунды (Date.now()); null у «до» — бессрочно. */
import type { TicketKind, TicketStatus } from '../../src/core/support';

export interface User {
  id: number;
  /** Почта (в нижнем регистре); у входа через VK без почты — null. */
  email: string | null;
  name: string;
  passwordHash: string | null;
  emailVerified: boolean;
  /** Секрет второго фактора (base32) — у Мастера. */
  totpSecret: string | null;
  createdAt: number;
  lastLoginAt: number | null;
  bannedUntil: number | null;
  /** Аватар: значок из src/core/avatars.ts или 'photo' (фото из сервиса входа). */
  avatar: string | null;
  /** Фото из Яндекса/VK (адрес). */
  photo: string | null;
}

/** Право (entitlement) с датой окончания; null — бессрочно. */
export interface Right {
  right: string;
  until: number | null;
}

export type TokenKind = 'verify' | 'reset';

export interface UserPatch {
  name?: string;
  email?: string | null;
  passwordHash?: string | null;
  emailVerified?: boolean;
  totpSecret?: string | null;
  lastLoginAt?: number;
  bannedUntil?: number | null;
  avatar?: string | null;
  photo?: string | null;
}

/** Пожертвование (донат): создаётся до оплаты, оплаченным его отмечает уведомление платёжного сервиса. Суммы — в копейках. */
export interface Donation {
  id: number;
  userId: number | null;
  amount: number;
  createdAt: number;
  paidAt: number | null;
}

/** Обращение в поддержку (src/core/support.ts). */
export interface Ticket {
  id: number;
  kind: TicketKind;
  status: TicketStatus;
  subject: string;
  userId: number | null;
  /** Куда отвечать (null — только в профиле). */
  email: string | null;
  name: string | null;
  context: string | null;
  source: 'site' | 'mail';
  createdAt: number;
  updatedAt: number;
}

export interface TicketMsg {
  staff: boolean;
  author: string;
  text: string;
  at: number;
}

/** Сыгранная партия в истории игрока. */
export interface PlayRecord {
  game: string;
  preset: string | null;
  /** Чем кончилось для игрока. */
  result: 'win' | 'lose' | 'draw' | 'done';
  /** Место (если в игре есть места). */
  place: number | null;
  players: number;
  bots: number;
  network: boolean;
  /** Счёт строкой, как показала игра («3 : 1», «120 очков»). */
  score: string | null;
  seconds: number | null;
  endedAt: number;
}

/** Счётчик за день (статистика админки): day — 'ГГГГ-ММ-ДД' по Москве, metric — что считаем, key — по чему (игра, '' — всего). */
export interface StatRow {
  day: string;
  metric: string;
  key: string;
  value: number;
}

export type ErrorStatus = 'new' | 'seen' | 'fixed' | 'ignored';

/** Ошибка (браузер или сервер) — одинаковые склеиваются по отпечатку (сообщение + место). */
export interface ErrorReport {
  source: 'client' | 'server';
  message: string;
  /** Место: первая строка стека своего кода или файл:строка. */
  place: string;
  game: string | null;
  url: string | null;
  ua: string | null;
  stack: string | null;
}

export interface ErrorRow extends ErrorReport {
  id: number;
  fingerprint: string;
  count: number;
  firstAt: number;
  lastAt: number;
  status: ErrorStatus;
}

export interface AccountStore {
  /** Подготовить хранилище (миграции). */
  init(): Promise<void>;
  userById(id: number): Promise<User | null>;
  userByEmail(email: string): Promise<User | null>;
  /** Новый пользователь; почта занята — ошибка с code 'exists'. */
  createUser(u: { email: string | null; name: string; passwordHash: string | null; emailVerified?: boolean }): Promise<User>;
  updateUser(id: number, patch: UserPatch): Promise<void>;

  createSession(hash: string, userId: number, expiresAt: number, ip: string, ua: string): Promise<void>;
  /** Владелец живой сессии. */
  sessionUser(hash: string, now: number): Promise<User | null>;
  deleteSession(hash: string): Promise<void>;
  /** Выйти везде (смена пароля) — кроме, при желании, текущей сессии. */
  deleteUserSessions(userId: number, except?: string): Promise<void>;

  createToken(hash: string, userId: number, kind: TokenKind, expiresAt: number): Promise<void>;
  /** Погасить одноразовую ссылку из письма: вернуть владельца или null (нет, просрочена, уже использована). */
  useToken(hash: string, kind: TokenKind, now: number): Promise<number | null>;

  /** Действующие права. */
  rights(userId: number, now: number): Promise<Right[]>;
  grant(userId: number, right: string, until: number | null, by: number | null): Promise<void>;
  revoke(userId: number, right: string): Promise<void>;

  /** Вход через Яндекс ID / VK ID (этап 3б). */
  userByExternal(provider: string, subject: string): Promise<User | null>;
  linkExternal(provider: string, subject: string, userId: number, email: string | null): Promise<void>;
  /** Какие входы привязаны к игроку. */
  externalOf(userId: number): Promise<string[]>;
  unlinkExternal(provider: string, userId: number): Promise<void>;

  /** Настройки сайта, которые меняет Мастер (надпись кнопки «Поддержать», цель сбора). */
  settings(): Promise<Record<string, string>>;
  /** Записать настройку; null — удалить. */
  setSetting(key: string, value: string | null, by: number | null): Promise<void>;

  /** Новый донат (ещё не оплачен) — его номер уходит в платёжный сервис. */
  createDonation(d: { userId: number | null; amount: number }): Promise<number>;
  donation(id: number): Promise<Donation | null>;
  /** Отметить оплаченным; false — уже был отмечен (повторное уведомление) или его нет. */
  markDonationPaid(id: number, now: number): Promise<boolean>;
  /** Сколько оплачено (копейки) начиная с момента since. */
  donatedSince(since: number): Promise<number>;
  /** Последние оплаченные — для админки. */
  recentDonations(limit: number): Promise<(Donation & { userName: string | null })[]>;

  /** Лайк игре (on=false — снять). */
  setLike(userId: number, game: string, on: boolean): Promise<void>;
  /** Игры, которым игрок поставил лайк. */
  likesOf(userId: number): Promise<string[]>;
  /** Сколько лайков у каждой игры. */
  likeCounts(): Promise<Record<string, number>>;

  /** Сохранённая партия игрока (data — снимок JSON строкой; null — партии нет, удалена в это время). */
  getSave(userId: number, game: string): Promise<{ at: number; data: string | null } | null>;
  /** Записать, если at новее записанного; true — записано. */
  putSave(userId: number, game: string, at: number, data: string | null): Promise<boolean>;
  /** Все сохранения игрока: игра, время, есть ли партия. */
  listSaves(userId: number): Promise<{ game: string; at: number; has: boolean }[]>;

  addHistory(userId: number, p: PlayRecord): Promise<void>;
  /** Последние партии игрока (новые первыми). */
  history(userId: number, limit: number): Promise<PlayRecord[]>;

  /** Игроки с действующим правом (почты Мастеров — для уведомлений). */
  usersWithRight(right: string, now: number): Promise<User[]>;

  /** Обращения: новое (с первым сообщением) — номер. */
  createTicket(t: Omit<Ticket, 'id' | 'status' | 'createdAt' | 'updatedAt'>, first: TicketMsg): Promise<number>;
  ticket(id: number): Promise<(Ticket & { messages: TicketMsg[] }) | null>;
  /** Дописать сообщение; status — новое состояние обращения. */
  addTicketMessage(id: number, m: TicketMsg, status: TicketStatus): Promise<void>;
  setTicketStatus(id: number, status: TicketStatus, now: number): Promise<void>;
  /** Последние обращения (status — только такие; userId — только этого игрока), обновлённые первыми. */
  tickets(q: { status?: TicketStatus; userId?: number; limit: number }): Promise<Ticket[]>;
  /** Сколько обращений ждут ответа. */
  newTickets(): Promise<number>;

  /** Статистика: прибавить к счётчику дня. */
  bumpStat(day: string, metric: string, key: string, delta: number): Promise<void>;
  /** Статистика: записать, если больше записанного (пик онлайна). */
  peakStat(day: string, metric: string, key: string, value: number): Promise<void>;
  /** Счётчики за дни from..to включительно. */
  statsBetween(from: string, to: string): Promise<StatRow[]>;

  /** Ошибка: новая или ещё раз (счётчик, время; «исправленная» снова стала новой). */
  logError(fingerprint: string, e: ErrorReport, now: number): Promise<void>;
  errors(q: { status?: ErrorStatus; limit: number }): Promise<ErrorRow[]>;
  setErrorStatus(id: number, status: ErrorStatus): Promise<void>;
  /** Сколько ошибок в таком состоянии. */
  countErrors(status: ErrorStatus): Promise<number>;

  /** Игроки для админки: поиск по почте, имени или номеру (пусто — последние), новые первыми. */
  searchUsers(q: string, limit: number): Promise<User[]>;
  /** Сколько игроков (зарегистрированных с since, если задано). */
  countUsers(since?: number): Promise<number>;
  /** Регистрации по дням (по Москве) начиная с since: 'ГГГГ-ММ-ДД' → сколько. */
  signupsByDay(since: number): Promise<Record<string, number>>;

  /** Убрать просроченные сессии и ссылки. */
  cleanup(now: number): Promise<void>;
  close(): Promise<void>;
}

export class ExistsError extends Error {
  code = 'exists';
}

/** Всё в памяти: для тестов и `npm run dev:server` без базы (после перезапуска пусто). */
export class MemoryAccountStore implements AccountStore {
  private users = new Map<number, User>();
  private sessions = new Map<string, { userId: number; expiresAt: number }>();
  private tokens = new Map<string, { userId: number; kind: TokenKind; expiresAt: number; used: boolean }>();
  private rightsBy = new Map<number, Map<string, number | null>>();
  private external = new Map<string, number>();
  private site = new Map<string, string>();
  private donations = new Map<number, Donation>();
  private seq = 0;
  private donSeq = 0;
  private likes = new Map<number, Set<string>>();
  private plays = new Map<number, PlayRecord[]>();
  private saves = new Map<string, { at: number; data: string | null }>();
  private ticketsBy = new Map<number, Ticket & { messages: TicketMsg[] }>();

  async init() {}

  async userById(id: number) {
    const u = this.users.get(id);
    return u ? { ...u } : null;
  }

  async userByEmail(email: string) {
    const e = email.toLowerCase();
    for (const u of this.users.values()) if (u.email === e) return { ...u };
    return null;
  }

  async createUser(u: { email: string | null; name: string; passwordHash: string | null; emailVerified?: boolean }) {
    if (u.email && (await this.userByEmail(u.email))) throw new ExistsError('exists');
    const user: User = {
      id: ++this.seq,
      email: u.email?.toLowerCase() ?? null,
      name: u.name,
      passwordHash: u.passwordHash,
      emailVerified: !!u.emailVerified,
      totpSecret: null,
      createdAt: Date.now(),
      lastLoginAt: null,
      bannedUntil: null,
      avatar: null,
      photo: null,
    };
    this.users.set(user.id, user);
    return { ...user };
  }

  async updateUser(id: number, patch: UserPatch) {
    const u = this.users.get(id);
    if (!u) return;
    if (patch.email !== undefined && patch.email && patch.email !== u.email && (await this.userByEmail(patch.email))) throw new ExistsError('exists');
    Object.assign(u, patch);
    if (u.email) u.email = u.email.toLowerCase();
  }

  async createSession(hash: string, userId: number, expiresAt: number) {
    this.sessions.set(hash, { userId, expiresAt });
  }

  async sessionUser(hash: string, now: number) {
    const s = this.sessions.get(hash);
    if (!s || s.expiresAt <= now) return null;
    return this.userById(s.userId);
  }

  async deleteSession(hash: string) {
    this.sessions.delete(hash);
  }

  async deleteUserSessions(userId: number, except?: string) {
    for (const [h, s] of this.sessions) if (s.userId === userId && h !== except) this.sessions.delete(h);
  }

  async createToken(hash: string, userId: number, kind: TokenKind, expiresAt: number) {
    this.tokens.set(hash, { userId, kind, expiresAt, used: false });
  }

  async useToken(hash: string, kind: TokenKind, now: number) {
    const t = this.tokens.get(hash);
    if (!t || t.kind !== kind || t.used || t.expiresAt <= now) return null;
    t.used = true;
    return t.userId;
  }

  async rights(userId: number, now: number) {
    const m = this.rightsBy.get(userId);
    if (!m) return [];
    return [...m].filter(([, until]) => until == null || until > now).map(([right, until]) => ({ right, until }));
  }

  async grant(userId: number, right: string, until: number | null) {
    if (!this.rightsBy.has(userId)) this.rightsBy.set(userId, new Map());
    this.rightsBy.get(userId)!.set(right, until);
  }

  async revoke(userId: number, right: string) {
    this.rightsBy.get(userId)?.delete(right);
  }

  async userByExternal(provider: string, subject: string) {
    const id = this.external.get(provider + ':' + subject);
    return id == null ? null : this.userById(id);
  }

  async linkExternal(provider: string, subject: string, userId: number) {
    this.external.set(provider + ':' + subject, userId);
  }

  async externalOf(userId: number) {
    return [...new Set([...this.external].filter(([, id]) => id === userId).map(([k]) => k.split(':')[0]))].sort();
  }

  async unlinkExternal(provider: string, userId: number) {
    for (const [k, id] of this.external) if (id === userId && k.startsWith(provider + ':')) this.external.delete(k);
  }

  async setLike(userId: number, game: string, on: boolean) {
    if (!this.likes.has(userId)) this.likes.set(userId, new Set());
    if (on) this.likes.get(userId)!.add(game);
    else this.likes.get(userId)!.delete(game);
  }

  async likesOf(userId: number) {
    return [...(this.likes.get(userId) ?? [])].sort();
  }

  async likeCounts() {
    const c: Record<string, number> = {};
    for (const set of this.likes.values()) for (const g of set) c[g] = (c[g] ?? 0) + 1;
    return c;
  }

  async getSave(userId: number, game: string) {
    const s = this.saves.get(userId + ':' + game);
    return s ? { ...s } : null;
  }

  async putSave(userId: number, game: string, at: number, data: string | null) {
    const k = userId + ':' + game;
    const old = this.saves.get(k);
    if (old && old.at >= at) return false;
    this.saves.set(k, { at, data });
    return true;
  }

  async listSaves(userId: number) {
    const p = userId + ':';
    return [...this.saves].filter(([k]) => k.startsWith(p)).map(([k, v]) => ({ game: k.slice(p.length), at: v.at, has: v.data != null }));
  }

  async addHistory(userId: number, p: PlayRecord) {
    if (!this.plays.has(userId)) this.plays.set(userId, []);
    this.plays.get(userId)!.push({ ...p });
  }

  async history(userId: number, limit: number) {
    return [...(this.plays.get(userId) ?? [])].sort((a, b) => b.endedAt - a.endedAt).slice(0, limit);
  }

  async settings() {
    return Object.fromEntries(this.site);
  }

  async setSetting(key: string, value: string | null) {
    if (value == null) this.site.delete(key);
    else this.site.set(key, value);
  }

  async createDonation(d: { userId: number | null; amount: number }) {
    const id = ++this.donSeq;
    this.donations.set(id, { id, userId: d.userId, amount: d.amount, createdAt: Date.now(), paidAt: null });
    return id;
  }

  async donation(id: number) {
    const d = this.donations.get(id);
    return d ? { ...d } : null;
  }

  async markDonationPaid(id: number, now: number) {
    const d = this.donations.get(id);
    if (!d || d.paidAt != null) return false;
    d.paidAt = now;
    return true;
  }

  async donatedSince(since: number) {
    let sum = 0;
    for (const d of this.donations.values()) if (d.paidAt != null && d.paidAt >= since) sum += d.amount;
    return sum;
  }

  async recentDonations(limit: number) {
    return [...this.donations.values()]
      .filter((d) => d.paidAt != null)
      .sort((a, b) => b.paidAt! - a.paidAt!)
      .slice(0, limit)
      .map((d) => ({ ...d, userName: d.userId == null ? null : this.users.get(d.userId)?.name ?? null }));
  }

  async usersWithRight(right: string, now: number) {
    const out: User[] = [];
    for (const [id, m] of this.rightsBy) {
      const until = m.get(right);
      if (until !== undefined && (until == null || until > now) && this.users.has(id)) out.push({ ...this.users.get(id)! });
    }
    return out;
  }

  async createTicket(t: Omit<Ticket, 'id' | 'status' | 'createdAt' | 'updatedAt'>, first: TicketMsg) {
    const id = this.ticketsBy.size + 1;
    this.ticketsBy.set(id, { ...t, id, status: 'new', createdAt: first.at, updatedAt: first.at, messages: [{ ...first }] });
    return id;
  }

  async ticket(id: number) {
    const t = this.ticketsBy.get(id);
    return t ? { ...t, messages: t.messages.map((m) => ({ ...m })) } : null;
  }

  async addTicketMessage(id: number, m: TicketMsg, status: TicketStatus) {
    const t = this.ticketsBy.get(id);
    if (!t) return;
    t.messages.push({ ...m });
    t.status = status;
    t.updatedAt = m.at;
  }

  async setTicketStatus(id: number, status: TicketStatus, now: number) {
    const t = this.ticketsBy.get(id);
    if (t) Object.assign(t, { status, updatedAt: now });
  }

  async tickets(q: { status?: TicketStatus; userId?: number; limit: number }) {
    return [...this.ticketsBy.values()]
      .filter((t) => (!q.status || t.status === q.status) && (q.userId == null || t.userId === q.userId))
      .sort((a, b) => b.updatedAt - a.updatedAt || b.id - a.id)
      .slice(0, q.limit)
      .map(({ messages: _, ...t }) => ({ ...t }));
  }

  async newTickets() {
    return [...this.ticketsBy.values()].filter((t) => t.status === 'new').length;
  }

  private statMap = new Map<string, StatRow>();
  private errorsBy = new Map<string, ErrorRow>();

  async bumpStat(day: string, metric: string, key: string, delta: number) {
    const k = `${day}|${metric}|${key}`;
    const r = this.statMap.get(k);
    if (r) r.value += delta;
    else this.statMap.set(k, { day, metric, key, value: delta });
  }

  async peakStat(day: string, metric: string, key: string, value: number) {
    const k = `${day}|${metric}|${key}`;
    const r = this.statMap.get(k);
    if (r) r.value = Math.max(r.value, value);
    else this.statMap.set(k, { day, metric, key, value });
  }

  async statsBetween(from: string, to: string) {
    return [...this.statMap.values()].filter((r) => r.day >= from && r.day <= to).map((r) => ({ ...r }));
  }

  async logError(fingerprint: string, e: ErrorReport, now: number) {
    const r = this.errorsBy.get(fingerprint);
    if (r) Object.assign(r, { count: r.count + 1, lastAt: now, status: r.status === 'fixed' ? 'new' : r.status, url: e.url ?? r.url, ua: e.ua ?? r.ua, game: e.game ?? r.game });
    else this.errorsBy.set(fingerprint, { ...e, id: this.errorsBy.size + 1, fingerprint, count: 1, firstAt: now, lastAt: now, status: 'new' });
  }

  async errors(q: { status?: ErrorStatus; limit: number }) {
    return [...this.errorsBy.values()]
      .filter((r) => !q.status || r.status === q.status)
      .sort((a, b) => b.lastAt - a.lastAt)
      .slice(0, q.limit)
      .map((r) => ({ ...r }));
  }

  async setErrorStatus(id: number, status: ErrorStatus) {
    for (const r of this.errorsBy.values()) if (r.id === id) r.status = status;
  }

  async countErrors(status: ErrorStatus) {
    return [...this.errorsBy.values()].filter((r) => r.status === status).length;
  }

  async searchUsers(q: string, limit: number) {
    const t = q.trim().toLowerCase();
    return [...this.users.values()]
      .filter((u) => !t || String(u.id) === t || u.name.toLowerCase().includes(t) || (u.email ?? '').includes(t))
      .sort((a, b) => b.createdAt - a.createdAt || b.id - a.id)
      .slice(0, limit)
      .map((u) => ({ ...u }));
  }

  async countUsers(since?: number) {
    return [...this.users.values()].filter((u) => since == null || u.createdAt >= since).length;
  }

  async signupsByDay(since: number) {
    const out: Record<string, number> = {};
    for (const u of this.users.values()) if (u.createdAt >= since) {
      const d = new Date(u.createdAt + 3 * 3600_000).toISOString().slice(0, 10);
      out[d] = (out[d] ?? 0) + 1;
    }
    return out;
  }

  async cleanup(now: number) {
    for (const [h, s] of this.sessions) if (s.expiresAt <= now) this.sessions.delete(h);
    for (const [h, t] of this.tokens) if (t.expiresAt <= now) this.tokens.delete(h);
  }

  async close() {}
}
