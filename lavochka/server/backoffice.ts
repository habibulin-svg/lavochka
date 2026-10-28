/* Админка (этап 5): статистика по дням, автоошибки, игроки и права. Логика без HTTP — класс Backoffice
 * (тесты — tests/backoffice.test.ts), HTTP-обвязка — backofficeApi:
 *   POST /api/errors {message, place?, stack?, game?, url?}     — ошибка из браузера (window.onerror), без входа, с пределом
 *   GET  /api/admin/dash[?days=30]                              — Мастеру: сводка — по дням, по играм, итоги, что сейчас
 *   GET  /api/admin/users[?q=]                                  — Мастеру: игроки с правами
 *   POST /api/admin/users {id, grant?, days?, revoke?, ban?}    — Мастеру: выдать право (days — срок, без него — бессрочно),
 *                                                                 забрать, закрыть вход на ban дней (0 — открыть)
 *   GET  /api/admin/errors[?status=new][&format=md]             — Мастеру: ошибки (md — выгрузка пачкой для разбора)
 *   POST /api/admin/errors {id, status}                         — Мастеру: состояние ошибки
 *   POST /api/admin/games {id, state?, new?, order?}             — Мастеру: выход игры (src/core/release.ts); всем — в /api/stats
 *   GET  /api/admin/groups                                      — Мастеру: группы игроков с участниками и правами
 *   POST /api/admin/groups {id?, name?, note?, del?, add?, remove?, grant?, days?, revoke?}
 *                                                               — Мастеру: создать/переименовать/удалить группу, добавить
 *                                                                 участника (add — номер или почта), убрать, право группе
 * Счётчики пишет сервер сам: партии (countPlay в браузере → /api/played), пик онлайна и посетители за день; регистрации — из таблицы игроков. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import { RIGHTS } from '../src/core/rights';
import { cleanRelease, withDefaults, type Release } from '../src/core/release';
import { ExistsError } from './accounts/store';
import { Limiter, type Accounts, type Ctx, type Reply } from './accounts/accounts';
import { cookieOf, sameOrigin, send, siteOf } from './accounts/http';
import type { ErrorReport, ErrorRow, ErrorStatus, StatRow, User } from './accounts/store';

const err = (code: number, error: string, message: string): Reply => ({ code, body: { error, message } });
const DAY = 86_400_000;
export const ERROR_STATUS: Record<ErrorStatus, string> = { new: 'новая', seen: 'смотрю', fixed: 'исправлена', ignored: 'не важно' };

/** День по Москве (сайт российский — сутки считаем по ней): 'ГГГГ-ММ-ДД'. */
export const mskDay = (t: number) => new Date(t + 3 * 3600_000).toISOString().slice(0, 10);

const line = (s: unknown, max: number) =>
  String(s ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
const text = (s: unknown, max: number) =>
  String(s ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '')
    .slice(0, max);

/** Отпечаток ошибки: числа, адреса и хэши сборки не различают одинаковые ошибки. */
export function fingerprint(e: Pick<ErrorReport, 'source' | 'message' | 'place'>): string {
  const norm = (s: string) =>
    s
      .replace(/https?:\/\/[^\s)]+?\/(assets\/)?/g, '')
      .replace(/-[\w-]{8}\.js/g, '.js')
      .replace(/\d+/g, '#');
  return createHash('sha1')
    .update(e.source + '|' + norm(e.message) + '|' + norm(e.place))
    .digest('hex')
    .slice(0, 24);
}

/** Место ошибки — первая строка стека из своего кода (не из библиотек и не из расширений браузера). */
export function placeOf(stack: string): string {
  const lines = stack.split('\n').map((l) => l.trim());
  const own = lines.find((l) => /\/(src|assets|server)\//.test(l) && !/node_modules|extension:\/\//.test(l)) ?? lines.find((l) => /^at |@/.test(l)) ?? '';
  return line(own.replace(/^at\s+/, ''), 300);
}

export interface Live {
  /** Сейчас на сайте (вкладок за 3 минуты). */
  online: number;
  rooms: number;
  /** Людей за сетевыми столами. */
  players: number;
}

export class Backoffice {
  private byIp = new Limiter(30, 3600_000);
  /** Сколько разных ошибок принято за час со всего сайта — чтобы шквал не забил базу. */
  private total = new Limiter(2000, 3600_000);
  /** Вкладки, заходившие сегодня (посетители дня). */
  private visitors = { day: '', tabs: new Set<string>() };

  /** Выход игр — в памяти (берётся из настроек при старте), отдаётся всем в /api/stats. */
  release: Release = withDefaults({});

  constructor(
    private acc: Accounts,
    private live: () => Live,
    private log: (s: string) => void = () => {},
    /** Есть ли такая игра (адреса из src/site/routes.ts). */
    private known: (id: string) => boolean = () => true
  ) {}

  /** Прочитать выход игр из настроек (при старте, когда база готова). */
  async loadRelease() {
    try {
      this.release = withDefaults(cleanRelease(JSON.parse((await this.acc.store.settings()).games || '{}'), this.known), this.known);
    } catch {
      this.release = withDefaults({}, this.known);
    }
  }

  async gamePost(b: any, ctx: Ctx): Promise<Reply> {
    const me = await this.master(ctx);
    if (!me) return err(403, 'master', 'Только для Мастера.');
    const id = String(b?.id ?? '');
    if (!this.known(id)) return err(400, 'game', 'Нет такой игры.');
    const next = { ...this.release, [id]: { state: b?.state, new: b?.new, order: b?.order } };
    this.release = withDefaults(cleanRelease(next, this.known), this.known);
    await this.acc.store.setSetting('games', JSON.stringify(this.release), me.id);
    this.log(`админка: ${me.name} — выход ${id}: ${JSON.stringify(this.release[id] ?? 'для всех')}`);
    return { code: 200, body: { ok: true, release: this.release } };
  }

  private async master(ctx: Ctx): Promise<User | null> {
    const u = await this.acc.current(ctx);
    if (!u) return null;
    const rights = await this.acc.store.rights(u.id, ctx.now ?? Date.now());
    return rights.some((r) => r.right === 'master') ? u : null;
  }

  // ---------------------------------------------------------------- счётчики

  /** Начата партия: mode — local (за одним экраном), net (по сети), arcade. */
  played(game: string, mode: string, now = Date.now()) {
    const day = mskDay(now);
    const st = this.acc.store;
    const m = ['local', 'net', 'arcade'].includes(mode) ? mode : 'local';
    void Promise.all([st.bumpStat(day, 'plays', game, 1), st.bumpStat(day, 'plays', '', 1), st.bumpStat(day, 'plays_' + m, '', 1)]).catch(() => {});
  }

  /** Вкладка отметилась на сайте (раз в минуту). */
  visit(tab: string, now = Date.now()) {
    const day = mskDay(now);
    if (this.visitors.day !== day) this.visitors = { day, tabs: new Set() };
    if (this.visitors.tabs.size < 200_000) this.visitors.tabs.add(tab);
  }

  /** Раз в несколько минут: пик онлайна и посетители за день. */
  async sample(now = Date.now()) {
    const day = mskDay(now);
    const l = this.live();
    await this.acc.store.peakStat(day, 'online', '', l.online);
    await this.acc.store.peakStat(day, 'players', '', l.players);
    if (this.visitors.day === day) await this.acc.store.peakStat(day, 'visitors', '', this.visitors.tabs.size);
  }

  // ---------------------------------------------------------------- ошибки

  /** Ошибка из браузера. */
  async clientError(b: any, ctx: Ctx): Promise<Reply> {
    const now = ctx.now ?? Date.now();
    const message = line(b?.message, 500);
    if (!message) return err(400, 'empty', 'Пусто.');
    if (!this.byIp.take(ctx.ip, now) || !this.total.take('all', now)) return { code: 200, body: { ok: true } };
    const stack = text(b?.stack, 4000) || null;
    const e: ErrorReport = {
      source: 'client',
      message,
      place: line(b?.place, 300) || (stack ? placeOf(stack) : ''),
      game: /^[\w-]{1,40}$/.test(String(b?.game ?? '')) ? String(b.game) : null,
      url: line(b?.url, 300) || null,
      ua: line(ctx.ua, 300) || null,
      stack,
    };
    await this.acc.store.logError(fingerprint(e), e, now);
    return { code: 200, body: { ok: true } };
  }

  /** Ошибка на сервере (комнаты, API) — пишет сам сервер. */
  serverError(e: unknown, where: string, game: string | null = null, now = Date.now()) {
    const x = e instanceof Error ? e : new Error(String(e));
    const r: ErrorReport = { source: 'server', message: line(x.message, 500) || 'ошибка', place: line(where, 120) + (x.stack ? ' · ' + placeOf(x.stack) : ''), game, url: null, ua: null, stack: text(x.stack, 4000) || null };
    if (!this.total.take('all', now)) return;
    void this.acc.store.logError(fingerprint(r), r, now).catch((er) => this.log('ошибка не записалась: ' + er));
  }

  // ---------------------------------------------------------------- админка

  async dash(q: URLSearchParams, ctx: Ctx): Promise<Reply> {
    if (!(await this.master(ctx))) return err(403, 'master', 'Только для Мастера.');
    const now = ctx.now ?? Date.now();
    const days = Math.max(1, Math.min(365, Number(q.get('days')) || 30));
    const st = this.acc.store;
    const list: string[] = [];
    for (let i = days - 1; i >= 0; i--) list.push(mskDay(now - i * DAY));
    const rows = await st.statsBetween(list[0], list[list.length - 1]);
    const signups = await st.signupsByDay(now - days * DAY - DAY);
    const by = (metric: string, day: string, key = '') => rows.find((r) => r.day === day && r.metric === metric && r.key === key)?.value ?? 0;
    const series = list.map((day) => ({
      day,
      plays: by('plays', day),
      net: by('plays_net', day),
      local: by('plays_local', day),
      arcade: by('plays_arcade', day),
      signups: signups[day] ?? 0,
      online: by('online', day),
      players: by('players', day),
      visitors: by('visitors', day),
    }));
    const games = new Map<string, number>();
    for (const r of rows as StatRow[]) if (r.metric === 'plays' && r.key) games.set(r.key, (games.get(r.key) ?? 0) + r.value);
    const [users, users7, donated30, ticketsNew, errorsNew] = await Promise.all([
      st.countUsers(),
      st.countUsers(now - 7 * DAY),
      st.donatedSince(now - 30 * DAY),
      st.newTickets(),
      st.countErrors('new'),
    ]);
    return {
      code: 200,
      body: {
        days: series,
        games: [...games].sort((a, b) => b[1] - a[1]).map(([game, plays]) => ({ game, plays })),
        totals: { users, users7, donated30, ticketsNew, errorsNew },
        live: this.live(),
      },
    };
  }

  async users(q: URLSearchParams, ctx: Ctx): Promise<Reply> {
    if (!(await this.master(ctx))) return err(403, 'master', 'Только для Мастера.');
    const now = ctx.now ?? Date.now();
    const list = await this.acc.store.searchUsers(line(q.get('q'), 100), 50);
    const out = await Promise.all(
      list.map(async (u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        createdAt: u.createdAt,
        lastLoginAt: u.lastLoginAt,
        bannedUntil: u.bannedUntil && u.bannedUntil > now ? u.bannedUntil : null,
        verified: u.emailVerified,
        logins: await this.acc.store.externalOf(u.id),
        rights: await this.acc.store.rights(u.id, now),
        groups: await this.acc.store.groupsOf(u.id),
      }))
    );
    return { code: 200, body: { users: out, rights: RIGHTS } };
  }

  async userPost(b: any, ctx: Ctx): Promise<Reply> {
    const me = await this.master(ctx);
    if (!me) return err(403, 'master', 'Только для Мастера.');
    const now = ctx.now ?? Date.now();
    const st = this.acc.store;
    const u = await st.userById(Number(b?.id));
    if (!u) return err(404, 'user', 'Нет такого игрока.');
    const days = (v: unknown) => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? Math.min(n, 36500) : null;
    };
    if (b?.grant != null) {
      if (!Object.hasOwn(RIGHTS, b.grant)) return err(400, 'right', 'Нет такого права.');
      if (b.grant === 'master') return err(400, 'master', 'Мастера заводят командой на сервере (lavochka-admin create-master).');
      const d = days(b.days);
      await st.grant(u.id, b.grant, d == null ? null : now + d * DAY, me.id);
      this.log(`админка: ${me.name} выдал ${b.grant} игроку №${u.id}${d ? ` на ${d} дн.` : ''}`);
    }
    if (b?.revoke != null) {
      if (b.revoke === 'master') return err(400, 'master', 'Право Мастера забирают командой на сервере.');
      await st.revoke(u.id, String(b.revoke));
      this.log(`админка: ${me.name} забрал ${b.revoke} у игрока №${u.id}`);
    }
    if (b?.ban != null) {
      if (u.id === me.id) return err(400, 'self', 'Себя закрыть нельзя.');
      if ((await st.rights(u.id, now)).some((r) => r.right === 'master')) return err(400, 'master', 'Мастера закрыть нельзя.');
      const d = days(b.ban);
      await st.updateUser(u.id, { bannedUntil: d == null ? null : now + d * DAY });
      if (d != null) await st.deleteUserSessions(u.id);
      this.log(`админка: ${me.name} ${d ? `закрыл вход игроку №${u.id} на ${d} дн.` : `открыл вход игроку №${u.id}`}`);
    }
    return { code: 200, body: { ok: true } };
  }

  // ---------------------------------------------------------------- группы

  async groups(ctx: Ctx): Promise<Reply> {
    if (!(await this.master(ctx))) return err(403, 'master', 'Только для Мастера.');
    const st = this.acc.store;
    const list = await st.groups(ctx.now ?? Date.now());
    const out = await Promise.all(
      list.map(async (g) => ({ ...g, users: (await st.groupMembers(g.id)).slice(0, 500).map((u) => ({ id: u.id, name: u.name, email: u.email })) }))
    );
    return { code: 200, body: { groups: out, rights: RIGHTS } };
  }

  async groupPost(b: any, ctx: Ctx): Promise<Reply> {
    const me = await this.master(ctx);
    if (!me) return err(403, 'master', 'Только для Мастера.');
    const now = ctx.now ?? Date.now();
    const st = this.acc.store;
    const name = line(b?.name, 60);
    const note = line(b?.note, 300);
    if (b?.id == null) {
      if (!name) return err(400, 'name', 'Назовите группу.');
      try {
        const id = await st.saveGroup({ name, note });
        this.log(`админка: ${me.name} завёл группу «${name}»`);
        return { code: 200, body: { ok: true, id } };
      } catch (e) {
        if (e instanceof ExistsError) return err(400, 'exists', 'Группа с таким названием уже есть.');
        throw e;
      }
    }
    const g = (await st.groups(now)).find((x) => x.id === Number(b.id));
    if (!g) return err(404, 'group', 'Нет такой группы.');
    if (b.del) {
      await st.deleteGroup(g.id);
      this.log(`админка: ${me.name} удалил группу «${g.name}»`);
      return { code: 200, body: { ok: true } };
    }
    if (b.name != null || b.note != null) {
      if (!name) return err(400, 'name', 'Назовите группу.');
      try {
        await st.saveGroup({ id: g.id, name, note: b.note == null ? g.note : note });
      } catch (e) {
        if (e instanceof ExistsError) return err(400, 'exists', 'Группа с таким названием уже есть.');
        throw e;
      }
    }
    if (b.add != null) {
      const q = line(b.add, 200).toLowerCase();
      const u = /^\d{1,15}$/.test(q) ? await st.userById(Number(q)) : q.includes('@') ? await st.userByEmail(q) : null;
      if (!u) return err(404, 'user', 'Нет игрока с таким номером или почтой.');
      await st.setGroupMember(g.id, u.id, true);
      this.log(`админка: ${me.name} добавил игрока №${u.id} в группу «${g.name}»`);
    }
    if (b.remove != null) await st.setGroupMember(g.id, Number(b.remove), false);
    if (b.grant != null) {
      if (!Object.hasOwn(RIGHTS, b.grant)) return err(400, 'right', 'Нет такого права.');
      if (b.grant === 'master') return err(400, 'master', 'Право Мастера группе не выдаётся.');
      const n = Number(b.days);
      const d = Number.isFinite(n) && n > 0 ? Math.min(n, 36500) : null;
      await st.groupGrant(g.id, b.grant, d == null ? null : now + d * DAY, me.id);
      this.log(`админка: ${me.name} выдал ${b.grant} группе «${g.name}»${d ? ` на ${d} дн.` : ''}`);
    }
    if (b.revoke != null) {
      await st.groupRevoke(g.id, String(b.revoke));
      this.log(`админка: ${me.name} забрал ${b.revoke} у группы «${g.name}»`);
    }
    return { code: 200, body: { ok: true, id: g.id } };
  }

  async errors(q: URLSearchParams, ctx: Ctx): Promise<Reply> {
    if (!(await this.master(ctx))) return err(403, 'master', 'Только для Мастера.');
    const s = q.get('status');
    const list = await this.acc.store.errors({ status: s && Object.hasOwn(ERROR_STATUS, s) ? (s as ErrorStatus) : undefined, limit: 300 });
    if (q.get('format') === 'md') return { code: 200, body: { md: errorsMarkdown(list) } };
    return { code: 200, body: { errors: list } };
  }

  async errorPost(b: any, ctx: Ctx): Promise<Reply> {
    if (!(await this.master(ctx))) return err(403, 'master', 'Только для Мастера.');
    if (!Object.hasOwn(ERROR_STATUS, b?.status)) return err(400, 'status', 'Нет такого состояния.');
    const ids: number[] = (Array.isArray(b?.ids) ? b.ids : [b?.id]).map(Number).filter((n: number) => Number.isInteger(n) && n > 0).slice(0, 500);
    for (const id of ids) await this.acc.store.setErrorStatus(id, b.status);
    return { code: 200, body: { ok: true, n: ids.length } };
  }
}

/** Выгрузка ошибок пачкой — разбирать вместе с Claude. */
export function errorsMarkdown(list: ErrorRow[]): string {
  const d = (t: number) => new Date(t + 3 * 3600_000).toISOString().slice(0, 16).replace('T', ' ');
  const out = [`# Ошибки сайта (${list.length})`, ''];
  for (const e of list) {
    out.push(`## №${e.id} · ${e.source === 'client' ? 'браузер' : 'сервер'} · ${ERROR_STATUS[e.status]} · ×${e.count}`);
    out.push('', `**${e.message}**`, '');
    if (e.place) out.push(`- место: \`${e.place}\``);
    if (e.game) out.push(`- игра: ${e.game}`);
    if (e.url) out.push(`- адрес: ${e.url}`);
    if (e.ua) out.push(`- браузер: ${e.ua}`);
    out.push(`- первый раз: ${d(e.firstAt)}, последний: ${d(e.lastAt)} (МСК)`);
    if (e.stack) out.push('', '```', e.stack, '```');
    out.push('');
  }
  return out.join('\n');
}

/** Обработать адреса админки и ошибок; false — не наш адрес. */
export async function backofficeApi(
  bo: Backoffice,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ip: string,
  readBody: (req: IncomingMessage, limit?: number) => Promise<string>
): Promise<boolean> {
  const path = url.pathname;
  const ctx: Ctx = { sid: cookieOf(req), ip, ua: String(req.headers['user-agent'] || ''), site: siteOf(req) };
  const routes = ['/api/errors', '/api/admin/dash', '/api/admin/users', '/api/admin/errors', '/api/admin/games', '/api/admin/groups'];
  if (!routes.includes(path)) return false;
  if (req.method === 'GET') {
    const r =
      path === '/api/admin/dash' ? await bo.dash(url.searchParams, ctx) : path === '/api/admin/users' ? await bo.users(url.searchParams, ctx) : path === '/api/admin/errors' ? await bo.errors(url.searchParams, ctx) : path === '/api/admin/groups' ? await bo.groups(ctx) : { code: 405, body: { error: 'method' } };
    send(req, res, r);
    return true;
  }
  if (req.method !== 'POST') {
    send(req, res, { code: 405, body: { error: 'method' } });
    return true;
  }
  // ошибки браузер шлёт и через sendBeacon (text/plain) — тип не проверяем, только свой сайт
  if (!sameOrigin(req) || (path !== '/api/errors' && !/^application\/json/.test(String(req.headers['content-type'] || '')))) {
    send(req, res, { code: 403, body: { error: 'origin' } });
    return true;
  }
  let b: any;
  try {
    b = JSON.parse((await readBody(req, 16_384)) || '{}');
  } catch {
    send(req, res, { code: 400, body: { error: 'bad body' } });
    return true;
  }
  send(req, res, path === '/api/errors' ? await bo.clientError(b, ctx) : path === '/api/admin/users' ? await bo.userPost(b, ctx) : path === '/api/admin/games' ? await bo.gamePost(b, ctx) : path === '/api/admin/groups' ? await bo.groupPost(b, ctx) : await bo.errorPost(b, ctx));
  return true;
}
