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
  private seq = 0;

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

  async cleanup(now: number) {
    for (const [h, s] of this.sessions) if (s.expiresAt <= now) this.sessions.delete(h);
    for (const [h, t] of this.tokens) if (t.expiresAt <= now) this.tokens.delete(h);
  }

  async close() {}
}
