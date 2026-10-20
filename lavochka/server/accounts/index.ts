/* Аккаунты сервера: хранилище по окружению (PGDATABASE — PostgreSQL, иначе в памяти) и почта (UNISENDER_API_KEY). */
import { Accounts } from './accounts';
import { mailerFromEnv } from './mail';
import { PgAccountStore } from './pg';
import { MemoryAccountStore, type AccountStore } from './store';

export { Accounts } from './accounts';
export { authApi } from './http';
export { OAuth, oauthApi, providersFromEnv } from './oauth';

export function storeFromEnv(log: (s: string) => void): AccountStore {
  if (process.env.PGDATABASE || process.env.DATABASE_URL) return new PgAccountStore();
  log('аккаунты: базы нет (PGDATABASE не задан) — храню в памяти до перезапуска; первый зарегистрированный — Мастер (для разработки)');
  return new DevMemoryStore();
}

export function accountsFromEnv(log: (s: string) => void): Accounts {
  return new Accounts(storeFromEnv(log), mailerFromEnv(log), log);
}

/** Разработка без базы: первый зарегистрированный сразу Мастер — чтобы проверять админку локально (на сервере всегда Postgres). */
class DevMemoryStore extends MemoryAccountStore {
  private first = true;
  override async createUser(u: Parameters<MemoryAccountStore['createUser']>[0]) {
    const user = await super.createUser(u);
    if (this.first) {
      this.first = false;
      await this.grant(user.id, 'master', null);
    }
    return user;
  }
}
