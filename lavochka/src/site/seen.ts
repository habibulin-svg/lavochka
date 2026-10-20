/* Виденные задания вошедшего игрока (данетки, детективы) — копия в базе (/api/seen): с другого устройства тоже не покажем одно и то же. */
import { seenHooks } from '../core/seen';
import { currentUser } from './account';

seenHooks.scope = () => {
  const u = currentUser();
  return u ? 'u' + u.id : 'guest';
};

seenHooks.load = (game) =>
  currentUser()
    ? fetch('/api/seen?game=' + encodeURIComponent(game), { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((b: { seen?: Record<string, number> } | null) => b?.seen ?? null)
    : Promise.resolve(null);

seenHooks.added = (game, ids) => {
  if (!currentUser()) return;
  void fetch('/api/seen', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ game, ids }), keepalive: true }).catch(() => {});
};
