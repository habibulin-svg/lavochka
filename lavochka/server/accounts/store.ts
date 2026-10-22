/* Хранилище аккаунтов: интерфейс и вариант в памяти (тесты и разработка без базы).
 * На сервере — PostgreSQL (pg.ts); выбор — в accounts/index.ts по переменной PGDATABASE.
 * Времена — миллисекунды (Date.now()); null у «до» — бессрочно. */
import { addMonths } from '../../src/core/plus';
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
  /** Право пришло от группы (её название) — забирают его у группы, а не у игрока. */
  group?: string;
}

/** Группа игроков: права, выданные группе, действуют у каждого её участника (админка → «Группы»). */
export interface Group {
  id: number;
  name: string;
  note: string;
  createdAt: number;
}

/** Свести личные права и права групп: одно право — один раз, с самым долгим сроком (личное при равенстве). */
export function mergeRights(list: Right[]): Right[] {
  const best = new Map<string, Right>();
  const longer = (a: Right, b: Right) => (a.until == null ? b.until != null : b.until != null && a.until > b.until);
  for (const r of list) {
    const was = best.get(r.right);
    if (!was || longer(r, was)) best.set(r.right, r);
  }
  return [...best.values()].map((r) => (r.group ? r : { right: r.right, until: r.until }));
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

/** Заказ подписки «Лавочка+» (src/core/plus.ts): создаётся до оплаты, оплаченным его отмечает уведомление Robokassa. */
export interface PlusOrder {
  id: number;
  userId: number;
  /** Копейки. */
  amount: number;
  days: number;
  /** Первая оплата с согласием на повторные списания (Recurring). */
  recurring: boolean;
  /** Повторное списание: номер материнского заказа. */
  parentId: number | null;
  createdAt: number;
  paidAt: number | null;
  /** Конец срока после этой оплаты. */
  until: number | null;
  /** Номер платежа Robokassa, если заказ завела её подписка по ссылке (у такого платежа номер не наш). */
  extInv?: string | null;
}

/** Подписка игрока: до какого числа оплачена и продлевать ли самой. */
export interface Subscription {
  userId: number;
  until: number;
  autorenew: boolean;
  /** Материнский заказ для повторных списаний (null — платили без автопродления). */
  parentId: number | null;
  /** Когда последний раз пытались списать или напоминали (чтобы не повторять каждый час). */
  triedAt: number | null;
  remindedAt: number | null;
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

/** Запись из админки: новость, статья блога или «Слово Мастера» (kind 'master'). Текст — Markdown (src/core/markdown.ts). */
export interface PostRow {
  kind: string;
  slug: string;
  title: string;
  h1: string | null;
  description: string;
  /** Дата записи ГГГГ-ММ-ДД. */
  date: string;
  image: string | null;
  games: string[];
  body: string;
  /** Снята с сайта (у записи из файла — файл не показывается). */
  hidden: boolean;
  updatedAt: number;
  updatedBy: number | null;
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

  /** Действующие права — личные и от групп (mergeRights). */
  rights(userId: number, now: number): Promise<Right[]>;
  grant(userId: number, right: string, until: number | null, by: number | null): Promise<void>;
  revoke(userId: number, right: string): Promise<void>;

  /** Группы с числом участников и действующими правами. */
  groups(now: number): Promise<(Group & { members: number; rights: Right[] })[]>;
  /** Новая группа (без id) или правка; название занято — ExistsError. Возвращает номер. */
  saveGroup(g: { id?: number; name: string; note: string }): Promise<number>;
  deleteGroup(id: number): Promise<void>;
  groupMembers(id: number): Promise<User[]>;
  setGroupMember(groupId: number, userId: number, on: boolean): Promise<void>;
  /** В каких группах игрок. */
  groupsOf(userId: number): Promise<{ id: number; name: string }[]>;
  groupGrant(groupId: number, right: string, until: number | null, by: number | null): Promise<void>;
  groupRevoke(groupId: number, right: string): Promise<void>;

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

  /** Новый заказ подписки (ещё не оплачен). */
  /** extInv — номер платежа Robokassa (подписка по ссылке); второй заказ с тем же номером — ошибка ExistsError. */
  createPlusOrder(o: { userId: number; amount: number; days: number; recurring: boolean; parentId: number | null; extInv?: string | null }): Promise<number>;
  plusOrder(id: number): Promise<PlusOrder | null>;
  plusOrderByExt(extInv: string): Promise<PlusOrder | null>;
  /** Засчитать оплату: отметить заказ и продлить подписку от конца срока (или от now, если срок прошёл) — за один раз.
   * Вернёт новый конец срока или null — заказ уже был оплачен (повторное уведомление) или его нет. */
  payPlusOrder(id: number, now: number): Promise<number | null>;
  subscription(userId: number): Promise<Subscription | null>;
  updateSubscription(userId: number, patch: Partial<Pick<Subscription, 'autorenew' | 'parentId' | 'triedAt' | 'remindedAt'>>): Promise<void>;
  /** Оплаченные заказы игрока, новые первыми. */
  plusPayments(userId: number, limit: number): Promise<PlusOrder[]>;
  /** Подписки для админки (позже кончаются — выше), с числом оплат и суммой. */
  subscriptions(limit: number): Promise<(Subscription & { name: string; email: string | null; payments: number; amount: number })[]>;
  /** С автопродлением и материнским заказом, срок кончается раньше before. */
  dueSubscriptions(before: number): Promise<Subscription[]>;

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

  /** Расход помощника на ИИ за месяц ('ГГГГ-ММ', МСК): миллионные доли рубля и число запросов. */
  aiUsage(userId: number, month: string): Promise<{ cost: number; requests: number }>;
  addAiUsage(userId: number, month: string, costMicro: number, tokensIn: number, tokensOut: number): Promise<void>;
  /** Расход всего сайта за месяц. */
  aiTotal(month: string): Promise<{ cost: number; requests: number; users: number }>;
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

  /** Записи админки (все). */
  posts(): Promise<PostRow[]>;
  savePost(p: PostRow): Promise<void>;
  deletePost(kind: string, slug: string): Promise<void>;

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
  private plusOrders = new Map<number, PlusOrder>();
  private plusSeq = 1_000_000;
  private subs = new Map<number, Subscription>();
  private ai = new Map<string, { userId: number; month: string; cost: number; requests: number }>();
  private likes = new Map<number, Set<string>>();
  private plays = new Map<number, PlayRecord[]>();
  private saves = new Map<string, { at: number; data: string | null }>();
  private ticketsBy = new Map<number, Ticket & { messages: TicketMsg[] }>();
  private groupsBy = new Map<number, Group & { users: Set<number>; rights: Map<string, number | null> }>();
  private groupSeq = 0;

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
    const live = ([, until]: [string, number | null]) => until == null || until > now;
    const own: Right[] = [...(this.rightsBy.get(userId) ?? [])].filter(live).map(([right, until]) => ({ right, until }));
    for (const g of this.groupsBy.values()) if (g.users.has(userId)) own.push(...[...g.rights].filter(live).map(([right, until]) => ({ right, until, group: g.name })));
    return mergeRights(own);
  }

  async groups(now: number) {
    return [...this.groupsBy.values()]
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
      .map((g) => ({
        id: g.id,
        name: g.name,
        note: g.note,
        createdAt: g.createdAt,
        members: g.users.size,
        rights: [...g.rights].filter(([, until]) => until == null || until > now).map(([right, until]) => ({ right, until })),
      }));
  }

  async saveGroup(g: { id?: number; name: string; note: string }) {
    if ([...this.groupsBy.values()].some((x) => x.name.toLowerCase() === g.name.toLowerCase() && x.id !== g.id)) throw new ExistsError('exists');
    if (g.id != null) {
      const was = this.groupsBy.get(g.id);
      if (was) Object.assign(was, { name: g.name, note: g.note });
      return g.id;
    }
    const id = ++this.groupSeq;
    this.groupsBy.set(id, { id, name: g.name, note: g.note, createdAt: Date.now(), users: new Set(), rights: new Map() });
    return id;
  }

  async deleteGroup(id: number) {
    this.groupsBy.delete(id);
  }

  async groupMembers(id: number) {
    return [...(this.groupsBy.get(id)?.users ?? [])]
      .map((u) => this.users.get(u))
      .filter((u): u is User => !!u)
      .map((u) => ({ ...u }));
  }

  async setGroupMember(groupId: number, userId: number, on: boolean) {
    const g = this.groupsBy.get(groupId);
    if (g && on) g.users.add(userId);
    else g?.users.delete(userId);
  }

  async groupsOf(userId: number) {
    return [...this.groupsBy.values()].filter((g) => g.users.has(userId)).map((g) => ({ id: g.id, name: g.name }));
  }

  async groupGrant(groupId: number, right: string, until: number | null) {
    this.groupsBy.get(groupId)?.rights.set(right, until);
  }

  async groupRevoke(groupId: number, right: string) {
    this.groupsBy.get(groupId)?.rights.delete(right);
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

  async createPlusOrder(o: { userId: number; amount: number; days: number; recurring: boolean; parentId: number | null; extInv?: string | null }) {
    if (o.extInv != null && (await this.plusOrderByExt(o.extInv))) throw new ExistsError('exists');
    const id = ++this.plusSeq;
    this.plusOrders.set(id, { id, ...o, extInv: o.extInv ?? null, createdAt: Date.now(), paidAt: null, until: null });
    return id;
  }

  async plusOrder(id: number) {
    const o = this.plusOrders.get(id);
    return o ? { ...o } : null;
  }

  async plusOrderByExt(extInv: string) {
    for (const o of this.plusOrders.values()) if (o.extInv === extInv) return { ...o };
    return null;
  }

  async payPlusOrder(id: number, now: number) {
    const o = this.plusOrders.get(id);
    if (!o || o.paidAt != null) return null;
    const was = this.subs.get(o.userId);
    const until = addMonths(Math.max(was?.until ?? 0, now), 1);
    o.paidAt = now;
    o.until = until;
    const s: Subscription = was ?? { userId: o.userId, until, autorenew: false, parentId: null, triedAt: null, remindedAt: null };
    s.until = until;
    s.triedAt = null;
    s.remindedAt = null;
    if (o.recurring) Object.assign(s, { parentId: id, autorenew: true });
    this.subs.set(o.userId, s);
    return until;
  }

  async aiUsage(userId: number, month: string) {
    const r = this.ai.get(`${userId}/${month}`);
    return { cost: r?.cost ?? 0, requests: r?.requests ?? 0 };
  }

  async addAiUsage(userId: number, month: string, costMicro: number) {
    const k = `${userId}/${month}`;
    const r = this.ai.get(k) ?? { userId, month, cost: 0, requests: 0 };
    this.ai.set(k, { ...r, cost: r.cost + Math.round(costMicro), requests: r.requests + 1 });
  }

  async aiTotal(month: string) {
    const rows = [...this.ai.values()].filter((r) => r.month === month);
    return { cost: rows.reduce((a, r) => a + r.cost, 0), requests: rows.reduce((a, r) => a + r.requests, 0), users: rows.length };
  }

  async subscription(userId: number) {
    const s = this.subs.get(userId);
    return s ? { ...s } : null;
  }

  async updateSubscription(userId: number, patch: Partial<Pick<Subscription, 'autorenew' | 'parentId' | 'triedAt' | 'remindedAt'>>) {
    const s = this.subs.get(userId);
    if (s) Object.assign(s, patch);
  }

  async plusPayments(userId: number, limit: number) {
    return [...this.plusOrders.values()]
      .filter((o) => o.userId === userId && o.paidAt != null)
      .sort((a, b) => b.paidAt! - a.paidAt!)
      .slice(0, limit)
      .map((o) => ({ ...o }));
  }

  async subscriptions(limit: number) {
    return [...this.subs.values()]
      .sort((a, b) => b.until - a.until)
      .slice(0, limit)
      .map((s) => {
        const paid = [...this.plusOrders.values()].filter((o) => o.userId === s.userId && o.paidAt != null);
        const u = this.users.get(s.userId);
        return { ...s, name: u?.name ?? '?', email: u?.email ?? null, payments: paid.length, amount: paid.reduce((a, o) => a + o.amount, 0) };
      });
  }

  async dueSubscriptions(before: number) {
    return [...this.subs.values()].filter((s) => s.autorenew && s.parentId != null && s.until < before).map((s) => ({ ...s }));
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

  private postsBy = new Map<string, PostRow>();

  async posts() {
    return [...this.postsBy.values()].map((p) => ({ ...p, games: [...p.games] }));
  }

  async savePost(p: PostRow) {
    this.postsBy.set(p.kind + '/' + p.slug, { ...p, games: [...p.games] });
  }

  async deletePost(kind: string, slug: string) {
    this.postsBy.delete(kind + '/' + slug);
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
