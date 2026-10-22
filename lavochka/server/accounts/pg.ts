/* Аккаунты в PostgreSQL. Подключение — стандартные переменные PGHOST/PGUSER/PGDATABASE (на сервере — сокет,
 * вход от имени системного пользователя lavochka, без пароля). Схема — миграции ниже, по порядку, каждая один раз
 * (таблица schema_migrations). Новую миграцию — только дописывать в конец, старые не править. */
import pg from 'pg';
import type { TicketStatus } from '../../src/core/support';
import { addMonths } from '../../src/core/plus';
import { ExistsError, mergeRights, type AccountStore, type Donation, type PlayRecord, type Right, type ErrorReport, type ErrorRow, type ErrorStatus, type PlusOrder, type PostRow, type Subscription, type Ticket, type TicketMsg, type TokenKind, type User, type UserPatch } from './store';

export const MIGRATIONS: string[] = [
  // 1 — аккаунты, сессии, ссылки из писем, права с датами, внешние входы
  `create table users (
     id bigserial primary key,
     email text,
     name text not null,
     password_hash text,
     email_verified boolean not null default false,
     totp_secret text,
     created_at timestamptz not null default now(),
     last_login_at timestamptz,
     banned_until timestamptz
   );
   create unique index users_email on users (lower(email)) where email is not null;
   create table sessions (
     token_hash text primary key,
     user_id bigint not null references users on delete cascade,
     created_at timestamptz not null default now(),
     expires_at timestamptz not null,
     ip text,
     ua text
   );
   create index sessions_user on sessions (user_id);
   create table email_tokens (
     token_hash text primary key,
     user_id bigint not null references users on delete cascade,
     kind text not null,
     expires_at timestamptz not null,
     used_at timestamptz
   );
   create table user_rights (
     user_id bigint not null references users on delete cascade,
     right_id text not null,
     until timestamptz,
     granted_by bigint references users on delete set null,
     granted_at timestamptz not null default now(),
     primary key (user_id, right_id)
   );
   create table external_logins (
     provider text not null,
     subject text not null,
     user_id bigint not null references users on delete cascade,
     email text,
     created_at timestamptz not null default now(),
     primary key (provider, subject)
   );`,
  // 2 — настройки сайта (меняет Мастер) и донаты; суммы — в копейках
  `create table site_settings (
     key text primary key,
     value text not null,
     updated_at timestamptz not null default now(),
     updated_by bigint references users on delete set null
   );
   create table donations (
     id bigserial primary key,
     user_id bigint references users on delete set null,
     amount_kop bigint not null,
     provider text not null default 'robokassa',
     created_at timestamptz not null default now(),
     paid_at timestamptz
   );
   create index donations_paid on donations (paid_at) where paid_at is not null;`,
  // 3 — лайки игр и история партий
  `create table game_likes (
     user_id bigint not null references users on delete cascade,
     game text not null,
     created_at timestamptz not null default now(),
     primary key (user_id, game)
   );
   create index game_likes_game on game_likes (game);
   create table game_history (
     id bigserial primary key,
     user_id bigint not null references users on delete cascade,
     game text not null,
     preset text,
     result text not null,
     place int,
     players int not null,
     bots int not null default 0,
     network boolean not null default false,
     score text,
     seconds int,
     ended_at timestamptz not null default now()
   );
   create index game_history_user on game_history (user_id, ended_at desc);`,
  // 4 — сохранённые партии (снимок JSON строкой; null — партия закончена или удалена в это время)
  `alter table users add column avatar text;
   alter table users add column photo text;
   create table game_saves (
     user_id bigint not null references users on delete cascade,
     game text not null,
     data text,
     at timestamptz not null,
     primary key (user_id, game)
   );`,
  // 5 — обращения в поддержку (src/core/support.ts) и переписка по ним
  `create table tickets (
     id bigserial primary key,
     kind text not null,
     status text not null default 'new',
     subject text not null,
     user_id bigint references users on delete set null,
     email text,
     name text,
     context text,
     source text not null,
     created_at timestamptz not null default now(),
     updated_at timestamptz not null default now()
   );
   create index tickets_updated on tickets (updated_at desc);
   create index tickets_user on tickets (user_id);
   create table ticket_messages (
     id bigserial primary key,
     ticket_id bigint not null references tickets on delete cascade,
     staff boolean not null default false,
     author text not null,
     body text not null,
     at timestamptz not null default now()
   );
   create index ticket_messages_ticket on ticket_messages (ticket_id, id);`,
  // 6 — статистика по дням и автоошибки (админка, этап 5)
  `create table stat_days (
     day date not null,
     metric text not null,
     key text not null default '',
     value bigint not null default 0,
     primary key (day, metric, key)
   );
   create table errors (
     id bigserial primary key,
     fingerprint text not null unique,
     source text not null,
     message text not null,
     place text not null,
     game text,
     url text,
     ua text,
     stack text,
     count int not null default 1,
     first_at timestamptz not null,
     last_at timestamptz not null,
     status text not null default 'new'
   );
   create index errors_last on errors (last_at desc);`,
  // 7 — записи из админки: новости, блог, «Слово Мастера»
  `create table posts (
     kind text not null,
     slug text not null,
     title text not null,
     h1 text,
     description text not null default '',
     day date not null,
     image text,
     games text not null default '',
     body text not null default '',
     hidden boolean not null default false,
     updated_at timestamptz not null default now(),
     updated_by bigint references users on delete set null,
     primary key (kind, slug)
   );`,
  // 8 — группы игроков: права группы действуют у каждого участника
  `create table user_groups (
     id bigserial primary key,
     name text not null,
     note text not null default '',
     created_at timestamptz not null default now()
   );
   create unique index user_groups_name on user_groups (lower(name));
   create table group_members (
     group_id bigint not null references user_groups on delete cascade,
     user_id bigint not null references users on delete cascade,
     added_at timestamptz not null default now(),
     primary key (group_id, user_id)
   );
   create index group_members_user on group_members (user_id);
   create table group_rights (
     group_id bigint not null references user_groups on delete cascade,
     right_id text not null,
     until timestamptz,
     granted_by bigint references users on delete set null,
     granted_at timestamptz not null default now(),
     primary key (group_id, right_id)
   );`,
  // 9 — подписка «Лавочка+»: заказы (номера с 1 000 001, чтобы не пересекаться с донатами у Robokassa) и сроки
  `create table plus_orders (
     id bigserial primary key,
     user_id bigint not null references users on delete cascade,
     amount_kop bigint not null,
     days int not null,
     recurring boolean not null default false,
     parent_id bigint,
     created_at timestamptz not null default now(),
     paid_at timestamptz,
     until timestamptz
   );
   alter sequence plus_orders_id_seq restart with 1000001;
   create index plus_orders_user on plus_orders (user_id, paid_at desc) where paid_at is not null;
   create table subscriptions (
     user_id bigint primary key references users on delete cascade,
     until timestamptz not null,
     autorenew boolean not null default false,
     parent_id bigint,
     tried_at timestamptz,
     reminded_at timestamptz
   );`,
  // 10 — помощник на ИИ («Совет Михалыча»): расход по месяцам (МСК), в миллионных долях рубля
  `create table ai_usage (
     user_id bigint not null references users on delete cascade,
     month text not null,
     cost_micro bigint not null default 0,
     requests int not null default 0,
     tokens_in bigint not null default 0,
     tokens_out bigint not null default 0,
     primary key (user_id, month)
   );`,
  // 11 — подписка по ссылке Robokassa: её платежи приходят со своими номерами, номер хранится, чтобы не засчитать дважды
  `alter table plus_orders add column ext_inv text;
   create unique index plus_orders_ext on plus_orders (ext_inv) where ext_inv is not null;`,
  // 12 — помощников двое (Михалыч в шахматах, Димон в покере): расход по каждому; запас пользователя — сумма по всем
  `alter table ai_usage add column helper text not null default 'mihalych';
   alter table ai_usage drop constraint ai_usage_pkey;
   alter table ai_usage add primary key (user_id, month, helper);`,
  // 13 — в подписку вошло оформление (колода «Классическая»): действующим подписчикам — до конца их срока
  `insert into user_rights (user_id, right_id, until)
     select user_id, 'cosmetics', until from subscriptions where until > now()
   on conflict (user_id, right_id) do nothing;`,
];

const ms = (d: Date | null) => (d ? d.getTime() : null);
const date = (n: number | null | undefined) => (n == null ? null : new Date(n));

function toUser(r: any): User {
  return {
    id: Number(r.id),
    email: r.email,
    name: r.name,
    passwordHash: r.password_hash,
    emailVerified: r.email_verified,
    totpSecret: r.totp_secret,
    createdAt: ms(r.created_at)!,
    lastLoginAt: ms(r.last_login_at),
    bannedUntil: ms(r.banned_until),
    avatar: r.avatar ?? null,
    photo: r.photo ?? null,
  };
}

function toDonation(r: any): Donation {
  return { id: Number(r.id), userId: r.user_id == null ? null : Number(r.user_id), amount: Number(r.amount_kop), createdAt: ms(r.created_at)!, paidAt: ms(r.paid_at) };
}

function toPlusOrder(r: any): PlusOrder {
  return {
    id: Number(r.id),
    userId: Number(r.user_id),
    amount: Number(r.amount_kop),
    days: Number(r.days),
    recurring: !!r.recurring,
    parentId: r.parent_id == null ? null : Number(r.parent_id),
    createdAt: ms(r.created_at)!,
    paidAt: ms(r.paid_at),
    until: ms(r.until),
    extInv: r.ext_inv ?? null,
  };
}

function toSub(r: any): Subscription {
  return { userId: Number(r.user_id), until: ms(r.until)!, autorenew: !!r.autorenew, parentId: r.parent_id == null ? null : Number(r.parent_id), triedAt: ms(r.tried_at), remindedAt: ms(r.reminded_at) };
}

function toError(r: any): ErrorRow {
  return {
    id: Number(r.id),
    fingerprint: r.fingerprint,
    source: r.source,
    message: r.message,
    place: r.place,
    game: r.game,
    url: r.url,
    ua: r.ua,
    stack: r.stack,
    count: Number(r.count),
    firstAt: ms(r.first_at)!,
    lastAt: ms(r.last_at)!,
    status: r.status,
  };
}

function toTicket(r: any): Ticket {
  return {
    id: Number(r.id),
    kind: r.kind,
    status: r.status,
    subject: r.subject,
    userId: r.user_id == null ? null : Number(r.user_id),
    email: r.email,
    name: r.name,
    context: r.context,
    source: r.source,
    createdAt: ms(r.created_at)!,
    updatedAt: ms(r.updated_at)!,
  };
}

export class PgAccountStore implements AccountStore {
  private pool = new pg.Pool({ max: 5, ...(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {}) });

  async init() {
    await this.pool.query('create table if not exists schema_migrations (id int primary key, at timestamptz not null default now())');
    const done = new Set((await this.pool.query('select id from schema_migrations')).rows.map((r) => r.id));
    for (let i = 0; i < MIGRATIONS.length; i++) {
      const id = i + 1;
      if (done.has(id)) continue;
      const c = await this.pool.connect();
      try {
        await c.query('begin');
        await c.query(MIGRATIONS[i]);
        await c.query('insert into schema_migrations (id) values ($1)', [id]);
        await c.query('commit');
      } catch (e) {
        await c.query('rollback');
        throw e;
      } finally {
        c.release();
      }
    }
  }

  private async one(sql: string, args: unknown[]): Promise<User | null> {
    const r = await this.pool.query(sql, args);
    return r.rows[0] ? toUser(r.rows[0]) : null;
  }

  userById(id: number) {
    return this.one('select * from users where id = $1', [id]);
  }

  userByEmail(email: string) {
    return this.one('select * from users where lower(email) = lower($1)', [email]);
  }

  async createUser(u: { email: string | null; name: string; passwordHash: string | null; emailVerified?: boolean }) {
    try {
      return (await this.one('insert into users (email, name, password_hash, email_verified) values ($1, $2, $3, $4) returning *', [
        u.email?.toLowerCase() ?? null,
        u.name,
        u.passwordHash,
        !!u.emailVerified,
      ]))!;
    } catch (e: any) {
      if (e?.code === '23505') throw new ExistsError('exists');
      throw e;
    }
  }

  async updateUser(id: number, p: UserPatch) {
    const cols: [string, unknown][] = [];
    if (p.name !== undefined) cols.push(['name', p.name]);
    if (p.email !== undefined) cols.push(['email', p.email?.toLowerCase() ?? null]);
    if (p.passwordHash !== undefined) cols.push(['password_hash', p.passwordHash]);
    if (p.emailVerified !== undefined) cols.push(['email_verified', p.emailVerified]);
    if (p.totpSecret !== undefined) cols.push(['totp_secret', p.totpSecret]);
    if (p.lastLoginAt !== undefined) cols.push(['last_login_at', date(p.lastLoginAt)]);
    if (p.bannedUntil !== undefined) cols.push(['banned_until', date(p.bannedUntil)]);
    if (p.avatar !== undefined) cols.push(['avatar', p.avatar]);
    if (p.photo !== undefined) cols.push(['photo', p.photo]);
    if (!cols.length) return;
    try {
      await this.pool.query(`update users set ${cols.map(([c], i) => `${c} = $${i + 2}`).join(', ')} where id = $1`, [id, ...cols.map(([, v]) => v)]);
    } catch (e: any) {
      if (e?.code === '23505') throw new ExistsError('exists');
      throw e;
    }
  }

  async createSession(hash: string, userId: number, expiresAt: number, ip: string, ua: string) {
    await this.pool.query('insert into sessions (token_hash, user_id, expires_at, ip, ua) values ($1, $2, $3, $4, $5)', [hash, userId, date(expiresAt), ip.slice(0, 64), ua.slice(0, 300)]);
  }

  sessionUser(hash: string, now: number) {
    return this.one('select u.* from sessions s join users u on u.id = s.user_id where s.token_hash = $1 and s.expires_at > $2', [hash, date(now)]);
  }

  async deleteSession(hash: string) {
    await this.pool.query('delete from sessions where token_hash = $1', [hash]);
  }

  async deleteUserSessions(userId: number, except?: string) {
    await this.pool.query('delete from sessions where user_id = $1 and token_hash <> $2', [userId, except ?? '']);
  }

  async createToken(hash: string, userId: number, kind: TokenKind, expiresAt: number) {
    await this.pool.query('insert into email_tokens (token_hash, user_id, kind, expires_at) values ($1, $2, $3, $4)', [hash, userId, kind, date(expiresAt)]);
  }

  async useToken(hash: string, kind: TokenKind, now: number) {
    const r = await this.pool.query(
      'update email_tokens set used_at = $3 where token_hash = $1 and kind = $2 and used_at is null and expires_at > $3 returning user_id',
      [hash, kind, date(now)]
    );
    return r.rows[0] ? Number(r.rows[0].user_id) : null;
  }

  async rights(userId: number, now: number): Promise<Right[]> {
    const r = await this.pool.query(
      `select right_id, until, null as grp from user_rights where user_id = $1 and (until is null or until > $2)
       union all
       select r.right_id, r.until, g.name from group_rights r join group_members m on m.group_id = r.group_id join user_groups g on g.id = r.group_id
        where m.user_id = $1 and (r.until is null or r.until > $2)`,
      [userId, date(now)]
    );
    return mergeRights(r.rows.map((x) => (x.grp == null ? { right: x.right_id, until: ms(x.until) } : { right: x.right_id, until: ms(x.until), group: x.grp })));
  }

  async groups(now: number) {
    const g = await this.pool.query('select g.*, (select count(*) from group_members m where m.group_id = g.id) as n from user_groups g order by lower(g.name)');
    const r = await this.pool.query('select group_id, right_id, until from group_rights where until is null or until > $1 order by right_id', [date(now)]);
    return g.rows.map((x) => ({
      id: Number(x.id),
      name: x.name,
      note: x.note,
      createdAt: ms(x.created_at)!,
      members: Number(x.n),
      rights: r.rows.filter((y) => Number(y.group_id) === Number(x.id)).map((y) => ({ right: y.right_id, until: ms(y.until) })),
    }));
  }

  async saveGroup(g: { id?: number; name: string; note: string }) {
    try {
      if (g.id != null) {
        await this.pool.query('update user_groups set name = $2, note = $3 where id = $1', [g.id, g.name, g.note]);
        return g.id;
      }
      const r = await this.pool.query('insert into user_groups (name, note) values ($1, $2) returning id', [g.name, g.note]);
      return Number(r.rows[0].id);
    } catch (e: any) {
      if (e?.code === '23505') throw new ExistsError('exists');
      throw e;
    }
  }

  async deleteGroup(id: number) {
    await this.pool.query('delete from user_groups where id = $1', [id]);
  }

  async groupMembers(id: number) {
    const r = await this.pool.query('select u.* from group_members m join users u on u.id = m.user_id where m.group_id = $1 order by m.added_at', [id]);
    return r.rows.map(toUser);
  }

  async setGroupMember(groupId: number, userId: number, on: boolean) {
    if (on) await this.pool.query('insert into group_members (group_id, user_id) values ($1, $2) on conflict do nothing', [groupId, userId]);
    else await this.pool.query('delete from group_members where group_id = $1 and user_id = $2', [groupId, userId]);
  }

  async groupsOf(userId: number) {
    const r = await this.pool.query('select g.id, g.name from group_members m join user_groups g on g.id = m.group_id where m.user_id = $1 order by lower(g.name)', [userId]);
    return r.rows.map((x) => ({ id: Number(x.id), name: x.name }));
  }

  async groupGrant(groupId: number, right: string, until: number | null, by: number | null) {
    await this.pool.query(
      `insert into group_rights (group_id, right_id, until, granted_by) values ($1, $2, $3, $4)
       on conflict (group_id, right_id) do update set until = excluded.until, granted_by = excluded.granted_by, granted_at = now()`,
      [groupId, right, date(until), by]
    );
  }

  async groupRevoke(groupId: number, right: string) {
    await this.pool.query('delete from group_rights where group_id = $1 and right_id = $2', [groupId, right]);
  }

  async grant(userId: number, right: string, until: number | null, by: number | null) {
    await this.pool.query(
      `insert into user_rights (user_id, right_id, until, granted_by) values ($1, $2, $3, $4)
       on conflict (user_id, right_id) do update set until = excluded.until, granted_by = excluded.granted_by, granted_at = now()`,
      [userId, right, date(until), by]
    );
  }

  async revoke(userId: number, right: string) {
    await this.pool.query('delete from user_rights where user_id = $1 and right_id = $2', [userId, right]);
  }

  userByExternal(provider: string, subject: string) {
    return this.one('select u.* from external_logins e join users u on u.id = e.user_id where e.provider = $1 and e.subject = $2', [provider, subject]);
  }

  async linkExternal(provider: string, subject: string, userId: number, email: string | null) {
    await this.pool.query(
      'insert into external_logins (provider, subject, user_id, email) values ($1, $2, $3, $4) on conflict (provider, subject) do update set user_id = excluded.user_id, email = excluded.email',
      [provider, subject, userId, email]
    );
  }

  async externalOf(userId: number) {
    const r = await this.pool.query('select distinct provider from external_logins where user_id = $1 order by provider', [userId]);
    return r.rows.map((x) => x.provider as string);
  }

  async unlinkExternal(provider: string, userId: number) {
    await this.pool.query('delete from external_logins where provider = $1 and user_id = $2', [provider, userId]);
  }

  async setLike(userId: number, game: string, on: boolean) {
    if (on) await this.pool.query('insert into game_likes (user_id, game) values ($1, $2) on conflict do nothing', [userId, game]);
    else await this.pool.query('delete from game_likes where user_id = $1 and game = $2', [userId, game]);
  }

  async likesOf(userId: number) {
    const r = await this.pool.query('select game from game_likes where user_id = $1 order by game', [userId]);
    return r.rows.map((x) => x.game as string);
  }

  async likeCounts() {
    const r = await this.pool.query('select game, count(*)::int as n from game_likes group by game');
    return Object.fromEntries(r.rows.map((x) => [x.game, x.n]));
  }

  async getSave(userId: number, game: string) {
    const r = await this.pool.query('select data, at from game_saves where user_id = $1 and game = $2', [userId, game]);
    return r.rows[0] ? { at: ms(r.rows[0].at)!, data: r.rows[0].data as string | null } : null;
  }

  async putSave(userId: number, game: string, at: number, data: string | null) {
    const r = await this.pool.query(
      `insert into game_saves (user_id, game, data, at) values ($1, $2, $3, $4)
       on conflict (user_id, game) do update set data = excluded.data, at = excluded.at where game_saves.at < excluded.at`,
      [userId, game, data, date(at)]
    );
    return (r.rowCount ?? 0) > 0;
  }

  async listSaves(userId: number) {
    const r = await this.pool.query('select game, at, data is not null as has from game_saves where user_id = $1', [userId]);
    return r.rows.map((x) => ({ game: x.game as string, at: ms(x.at)!, has: !!x.has }));
  }

  async addHistory(userId: number, p: PlayRecord) {
    await this.pool.query(
      `insert into game_history (user_id, game, preset, result, place, players, bots, network, score, seconds, ended_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [userId, p.game, p.preset, p.result, p.place, p.players, p.bots, p.network, p.score, p.seconds, date(p.endedAt)]
    );
  }

  async history(userId: number, limit: number) {
    const r = await this.pool.query('select * from game_history where user_id = $1 order by ended_at desc limit $2', [userId, limit]);
    return r.rows.map(
      (x): PlayRecord => ({
        game: x.game,
        preset: x.preset,
        result: x.result,
        place: x.place,
        players: x.players,
        bots: x.bots,
        network: x.network,
        score: x.score,
        seconds: x.seconds,
        endedAt: ms(x.ended_at)!,
      })
    );
  }

  async settings() {
    const r = await this.pool.query('select key, value from site_settings');
    return Object.fromEntries(r.rows.map((x) => [x.key, x.value]));
  }

  async setSetting(key: string, value: string | null, by: number | null) {
    if (value == null) await this.pool.query('delete from site_settings where key = $1', [key]);
    else
      await this.pool.query(
        `insert into site_settings (key, value, updated_by) values ($1, $2, $3)
         on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`,
        [key, value, by]
      );
  }

  async createDonation(d: { userId: number | null; amount: number }) {
    const r = await this.pool.query('insert into donations (user_id, amount_kop) values ($1, $2) returning id', [d.userId, d.amount]);
    return Number(r.rows[0].id);
  }

  async donation(id: number) {
    const r = await this.pool.query('select * from donations where id = $1', [id]);
    return r.rows[0] ? toDonation(r.rows[0]) : null;
  }

  async markDonationPaid(id: number, now: number) {
    const r = await this.pool.query('update donations set paid_at = $2 where id = $1 and paid_at is null', [id, date(now)]);
    return (r.rowCount ?? 0) > 0;
  }

  async donatedSince(since: number) {
    const r = await this.pool.query('select coalesce(sum(amount_kop), 0) as s from donations where paid_at >= $1', [date(since)]);
    return Number(r.rows[0].s);
  }

  async recentDonations(limit: number) {
    const r = await this.pool.query(
      'select d.*, u.name as user_name from donations d left join users u on u.id = d.user_id where d.paid_at is not null order by d.paid_at desc limit $1',
      [limit]
    );
    return r.rows.map((x) => ({ ...toDonation(x), userName: x.user_name ?? null }));
  }

  async createPlusOrder(o: { userId: number; amount: number; days: number; recurring: boolean; parentId: number | null; extInv?: string | null }) {
    try {
      const r = await this.pool.query('insert into plus_orders (user_id, amount_kop, days, recurring, parent_id, ext_inv) values ($1, $2, $3, $4, $5, $6) returning id', [
        o.userId,
        o.amount,
        o.days,
        o.recurring,
        o.parentId,
        o.extInv ?? null,
      ]);
      return Number(r.rows[0].id);
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw new ExistsError('exists');
      throw e;
    }
  }

  async plusOrderByExt(extInv: string) {
    const r = await this.pool.query('select * from plus_orders where ext_inv = $1', [extInv]);
    return r.rows[0] ? toPlusOrder(r.rows[0]) : null;
  }

  async plusOrder(id: number) {
    const r = await this.pool.query('select * from plus_orders where id = $1', [id]);
    return r.rows[0] ? toPlusOrder(r.rows[0]) : null;
  }

  async payPlusOrder(id: number, now: number) {
    const c = await this.pool.connect();
    try {
      await c.query('begin');
      // заказ отмечается один раз: второе уведомление не найдёт неоплаченного и ничего не продлит
      const o = await c.query('update plus_orders set paid_at = $2 where id = $1 and paid_at is null returning *', [id, date(now)]);
      if (!o.rows[0]) {
        await c.query('rollback');
        return null;
      }
      const ord = toPlusOrder(o.rows[0]);
      // срок — календарный месяц от конца оплаченного (или от дня оплаты), считается так же, как в памяти (addMonths)
      const was = await c.query('select until from subscriptions where user_id = $1 for update', [ord.userId]);
      const next = addMonths(Math.max(ms(was.rows[0]?.until ?? null) ?? 0, now), 1);
      const s = await c.query(
        `insert into subscriptions (user_id, until, autorenew, parent_id) values ($1, $2, $3, $4)
         on conflict (user_id) do update set
           until = $2,
           autorenew = subscriptions.autorenew or excluded.autorenew,
           parent_id = coalesce(excluded.parent_id, subscriptions.parent_id),
           tried_at = null, reminded_at = null
         returning until`,
        [ord.userId, date(next), ord.recurring, ord.recurring ? ord.id : null]
      );
      const until = ms(s.rows[0].until)!;
      await c.query('update plus_orders set until = $2 where id = $1', [id, date(until)]);
      await c.query('commit');
      return until;
    } catch (e) {
      await c.query('rollback').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  async subscription(userId: number) {
    const r = await this.pool.query('select * from subscriptions where user_id = $1', [userId]);
    return r.rows[0] ? toSub(r.rows[0]) : null;
  }

  async updateSubscription(userId: number, patch: Partial<Pick<Subscription, 'autorenew' | 'parentId' | 'triedAt' | 'remindedAt'>>) {
    const cols: Record<string, unknown> = {};
    if (patch.autorenew !== undefined) cols.autorenew = patch.autorenew;
    if (patch.parentId !== undefined) cols.parent_id = patch.parentId;
    if (patch.triedAt !== undefined) cols.tried_at = date(patch.triedAt);
    if (patch.remindedAt !== undefined) cols.reminded_at = date(patch.remindedAt);
    const keys = Object.keys(cols);
    if (!keys.length) return;
    await this.pool.query(`update subscriptions set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} where user_id = $1`, [userId, ...keys.map((k) => cols[k])]);
  }

  async plusPayments(userId: number, limit: number) {
    const r = await this.pool.query('select * from plus_orders where user_id = $1 and paid_at is not null order by paid_at desc limit $2', [userId, limit]);
    return r.rows.map(toPlusOrder);
  }

  async subscriptions(limit: number) {
    const r = await this.pool.query(
      `select s.*, u.name, u.email, count(o.id) as n, coalesce(sum(o.amount_kop), 0) as kop
         from subscriptions s join users u on u.id = s.user_id left join plus_orders o on o.user_id = s.user_id and o.paid_at is not null
        group by s.user_id, u.name, u.email order by s.until desc limit $1`,
      [limit]
    );
    return r.rows.map((x) => ({ ...toSub(x), name: x.name, email: x.email, payments: Number(x.n), amount: Number(x.kop) }));
  }

  async dueSubscriptions(before: number) {
    const r = await this.pool.query('select * from subscriptions where autorenew and parent_id is not null and until < $1', [date(before)]);
    return r.rows.map(toSub);
  }

  async usersWithRight(right: string, now: number) {
    const r = await this.pool.query(
      'select u.* from users u join user_rights r on r.user_id = u.id where r.right_id = $1 and (r.until is null or r.until > $2)',
      [right, date(now)]
    );
    return r.rows.map(toUser);
  }

  async createTicket(t: Omit<Ticket, 'id' | 'status' | 'createdAt' | 'updatedAt'>, first: TicketMsg) {
    const c = await this.pool.connect();
    try {
      await c.query('begin');
      const r = await c.query(
        `insert into tickets (kind, subject, user_id, email, name, context, source, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $8) returning id`,
        [t.kind, t.subject, t.userId, t.email, t.name, t.context, t.source, date(first.at)]
      );
      const id = Number(r.rows[0].id);
      await c.query('insert into ticket_messages (ticket_id, staff, author, body, at) values ($1, $2, $3, $4, $5)', [id, first.staff, first.author, first.text, date(first.at)]);
      await c.query('commit');
      return id;
    } catch (e) {
      await c.query('rollback').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  async ticket(id: number) {
    const r = await this.pool.query('select * from tickets where id = $1', [id]);
    if (!r.rows[0]) return null;
    const m = await this.pool.query('select staff, author, body, at from ticket_messages where ticket_id = $1 order by id', [id]);
    return { ...toTicket(r.rows[0]), messages: m.rows.map((x) => ({ staff: x.staff, author: x.author, text: x.body, at: ms(x.at)! })) };
  }

  async addTicketMessage(id: number, m: TicketMsg, status: TicketStatus) {
    await this.pool.query('insert into ticket_messages (ticket_id, staff, author, body, at) values ($1, $2, $3, $4, $5)', [id, m.staff, m.author, m.text, date(m.at)]);
    await this.pool.query('update tickets set status = $2, updated_at = $3 where id = $1', [id, status, date(m.at)]);
  }

  async setTicketStatus(id: number, status: TicketStatus, now: number) {
    await this.pool.query('update tickets set status = $2, updated_at = $3 where id = $1', [id, status, date(now)]);
  }

  async tickets(q: { status?: TicketStatus; userId?: number; limit: number }) {
    const where: string[] = [];
    const args: unknown[] = [];
    if (q.status) where.push(`status = $${args.push(q.status)}`);
    if (q.userId != null) where.push(`user_id = $${args.push(q.userId)}`);
    const r = await this.pool.query(
      `select * from tickets ${where.length ? 'where ' + where.join(' and ') : ''} order by updated_at desc, id desc limit $${args.push(q.limit)}`,
      args
    );
    return r.rows.map(toTicket);
  }

  async newTickets() {
    const r = await this.pool.query("select count(*) as n from tickets where status = 'new'");
    return Number(r.rows[0].n);
  }

  async posts() {
    const r = await this.pool.query("select *, to_char(day, 'YYYY-MM-DD') as d from posts");
    return r.rows.map(
      (x): PostRow => ({
        kind: x.kind,
        slug: x.slug,
        title: x.title,
        h1: x.h1,
        description: x.description,
        date: x.d,
        image: x.image,
        games: x.games ? String(x.games).split(',') : [],
        body: x.body,
        hidden: x.hidden,
        updatedAt: ms(x.updated_at)!,
        updatedBy: x.updated_by == null ? null : Number(x.updated_by),
      })
    );
  }

  async savePost(p: PostRow) {
    await this.pool.query(
      `insert into posts (kind, slug, title, h1, description, day, image, games, body, hidden, updated_at, updated_by) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       on conflict (kind, slug) do update set title = $3, h1 = $4, description = $5, day = $6, image = $7, games = $8, body = $9, hidden = $10, updated_at = $11, updated_by = $12`,
      [p.kind, p.slug, p.title, p.h1, p.description, p.date, p.image, p.games.join(','), p.body, p.hidden, date(p.updatedAt), p.updatedBy]
    );
  }

  async deletePost(kind: string, slug: string) {
    await this.pool.query('delete from posts where kind = $1 and slug = $2', [kind, slug]);
  }

  async aiUsage(userId: number, month: string) {
    const r = await this.pool.query('select coalesce(sum(cost_micro), 0) as c, coalesce(sum(requests), 0) as n from ai_usage where user_id = $1 and month = $2', [userId, month]);
    return { cost: Number(r.rows[0].c), requests: Number(r.rows[0].n) };
  }

  async addAiUsage(userId: number, month: string, costMicro: number, tokensIn: number, tokensOut: number, helper = 'mihalych') {
    await this.pool.query(
      `insert into ai_usage (user_id, month, helper, cost_micro, requests, tokens_in, tokens_out) values ($1, $2, $3, $4, 1, $5, $6)
       on conflict (user_id, month, helper) do update set cost_micro = ai_usage.cost_micro + excluded.cost_micro, requests = ai_usage.requests + 1,
         tokens_in = ai_usage.tokens_in + excluded.tokens_in, tokens_out = ai_usage.tokens_out + excluded.tokens_out`,
      [userId, month, helper, Math.round(costMicro), tokensIn, tokensOut]
    );
  }

  async aiTotal(month: string) {
    const r = await this.pool.query('select helper, sum(cost_micro) as c, sum(requests) as n, count(distinct user_id) as u from ai_usage where month = $1 group by rollup (helper)', [month]);
    const helpers: Record<string, { cost: number; requests: number }> = {};
    let all = { cost: 0, requests: 0, users: 0 };
    for (const x of r.rows) {
      if (x.helper == null) all = { cost: Number(x.c), requests: Number(x.n), users: Number(x.u) };
      else helpers[x.helper] = { cost: Number(x.c), requests: Number(x.n) };
    }
    return { ...all, helpers };
  }

  async bumpStat(day: string, metric: string, key: string, delta: number) {
    await this.pool.query(
      'insert into stat_days (day, metric, key, value) values ($1, $2, $3, $4) on conflict (day, metric, key) do update set value = stat_days.value + excluded.value',
      [day, metric, key, delta]
    );
  }

  async peakStat(day: string, metric: string, key: string, value: number) {
    await this.pool.query(
      'insert into stat_days (day, metric, key, value) values ($1, $2, $3, $4) on conflict (day, metric, key) do update set value = greatest(stat_days.value, excluded.value)',
      [day, metric, key, value]
    );
  }

  async statsBetween(from: string, to: string) {
    const r = await this.pool.query("select to_char(day, 'YYYY-MM-DD') as day, metric, key, value from stat_days where day between $1 and $2", [from, to]);
    return r.rows.map((x) => ({ day: x.day, metric: x.metric, key: x.key, value: Number(x.value) }));
  }

  async logError(fingerprint: string, e: ErrorReport, now: number) {
    await this.pool.query(
      `insert into errors (fingerprint, source, message, place, game, url, ua, stack, first_at, last_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
       on conflict (fingerprint) do update set count = errors.count + 1, last_at = excluded.last_at,
         status = case when errors.status = 'fixed' then 'new' else errors.status end,
         url = coalesce(excluded.url, errors.url), ua = coalesce(excluded.ua, errors.ua), game = coalesce(excluded.game, errors.game)`,
      [fingerprint, e.source, e.message, e.place, e.game, e.url, e.ua, e.stack, date(now)]
    );
  }

  async errors(q: { status?: ErrorStatus; limit: number }) {
    const r = q.status
      ? await this.pool.query('select * from errors where status = $1 order by last_at desc limit $2', [q.status, q.limit])
      : await this.pool.query('select * from errors order by last_at desc limit $1', [q.limit]);
    return r.rows.map(toError);
  }

  async setErrorStatus(id: number, status: ErrorStatus) {
    await this.pool.query('update errors set status = $2 where id = $1', [id, status]);
  }

  async countErrors(status: ErrorStatus) {
    const r = await this.pool.query('select count(*) as n from errors where status = $1', [status]);
    return Number(r.rows[0].n);
  }

  async searchUsers(q: string, limit: number) {
    const t = q.trim().toLowerCase();
    if (!t) return (await this.pool.query('select * from users order by created_at desc, id desc limit $1', [limit])).rows.map(toUser);
    const id = /^\d{1,15}$/.test(t) ? Number(t) : -1;
    const like = '%' + t.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
    const r = await this.pool.query('select * from users where id = $1 or lower(name) like $2 or email like $2 order by created_at desc, id desc limit $3', [id, like, limit]);
    return r.rows.map(toUser);
  }

  async signupsByDay(since: number) {
    const r = await this.pool.query(
      "select to_char(created_at at time zone 'Europe/Moscow', 'YYYY-MM-DD') as d, count(*) as n from users where created_at >= $1 group by 1",
      [date(since)]
    );
    return Object.fromEntries(r.rows.map((x) => [x.d, Number(x.n)]));
  }

  async countUsers(since?: number) {
    const r = since == null ? await this.pool.query('select count(*) as n from users') : await this.pool.query('select count(*) as n from users where created_at >= $1', [date(since)]);
    return Number(r.rows[0].n);
  }

  async cleanup(now: number) {
    await this.pool.query('delete from sessions where expires_at <= $1', [date(now)]);
    await this.pool.query('delete from email_tokens where expires_at <= $1', [date(now)]);
  }

  close() {
    return this.pool.end();
  }
}
