/* Аккаунты сервера: хранилище по окружению (PGDATABASE — PostgreSQL, иначе в памяти) и почта (UNISENDER_API_KEY). */
import { Accounts } from './accounts';
import { mailerFromEnv } from './mail';
import { PgAccountStore } from './pg';
import { MemoryAccountStore, type AccountStore } from './store';

export { Accounts } from './accounts';
export { authApi } from './http';

export function storeFromEnv(log: (s: string) => void): AccountStore {
  if (process.env.PGDATABASE || process.env.DATABASE_URL) return new PgAccountStore();
  log('аккаунты: базы нет (PGDATABASE не задан) — храню в памяти до перезапуска');
  return new MemoryAccountStore();
}

export function accountsFromEnv(log: (s: string) => void): Accounts {
  return new Accounts(storeFromEnv(log), mailerFromEnv(log), log);
}
