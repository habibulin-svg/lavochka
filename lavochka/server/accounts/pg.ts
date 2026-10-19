/* Аккаунты в PostgreSQL. Подключение — стандартные переменные PGHOST/PGUSER/PGDATABASE (на сервере — сокет,
 * вход от имени системного пользователя lavochka, без пароля). Схема — миграции ниже, по порядку, каждая один раз
 * (таблица schema_migrations). Новую миграцию — только дописывать в конец, старые не править. */
import pg from 'pg';
import { ExistsError, type AccountStore, type Donation, type PlayRecord, type Right, type TokenKind, type User, type UserPatch } from './store';

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
    const r = await this.pool.query('select right_id, until from user_rights where user_id = $1 and (until is null or until > $2)', [userId, date(now)]);
    return r.rows.map((x) => ({ right: x.right_id, until: ms(x.until) }));
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

  async cleanup(now: number) {
    await this.pool.query('delete from sessions where expires_at <= $1', [date(now)]);
    await this.pool.query('delete from email_tokens where expires_at <= $1', [date(now)]);
  }

  close() {
    return this.pool.end();
  }
}
