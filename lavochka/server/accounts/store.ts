/* Хранилище аккаунтов: интерфейс и вариант в памяти (тесты и разработка без базы).
 * На сервере — PostgreSQL (pg.ts); выбор — в accounts/index.ts по переменной PGDATABASE.
 * Времена — миллисекунды (Date.now()); null у «до» — бессрочно. */

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
}

/** Пожертвование (донат): создаётся до оплаты, оплаченным его отмечает уведомление платёжного сервиса. Суммы — в копейках. */
export interface Donation {
  id: number;
  userId: number | null;
  amount: number;
  createdAt: number;
  paidAt: number | null;
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

  async cleanup(now: number) {
    for (const [h, s] of this.sessions) if (s.expiresAt <= now) this.sessions.delete(h);
    for (const [h, t] of this.tokens) if (t.expiresAt <= now) this.tokens.delete(h);
  }

  async close() {}
}
