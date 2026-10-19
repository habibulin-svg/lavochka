/* Сохранённые партии вошедшего игрока — копия в базе (/api/saves): начал на компьютере — продолжил на телефоне.
 * Браузер по-прежнему хранит своё; при входе и при открытии игры берём то, что новее (у каждого сохранения — время). */
import type { Snapshot } from '../core/authority';
import { loadSave, putSave, saveAt, saveHooks } from '../core/session';
import { CATALOG } from '../games/catalog';
import { currentUser, onAccount } from './account';

const timers = new Map<string, number>();

function upload(game: string, snap: Snapshot | null, at: number) {
  return fetch('/api/saves', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ game, at, snap }), keepalive: !snap })
    .then(() => {})
    .catch(() => {});
}

// сохранение изменилось — отправить (не чаще раза в 4 секунды на игру; конец партии — сразу)
saveHooks.changed = (game, snap, at) => {
  if (!currentUser()) return;
  clearTimeout(timers.get(game));
  if (!snap) return void upload(game, null, at);
  timers.set(
    game,
    window.setTimeout(() => {
      timers.delete(game);
      // за 4 секунды могло смениться — шлём последнее
      void upload(game, loadSave(game), saveAt(game) || at);
    }, 4000)
  );
};

/** Ушли со страницы — отправить отложенное. */
addEventListener('pagehide', () => {
  for (const [game, t] of timers) {
    clearTimeout(t);
    void upload(game, loadSave(game), saveAt(game));
  }
  timers.clear();
});

/** Сверить одну игру: в базе новее — взять себе. Перед экраном игры (с ограничением по времени — без сети не ждём). */
export async function syncSave(game: string, waitMs = 1500): Promise<void> {
  if (!currentUser()) return;
  const job = fetch('/api/saves?game=' + encodeURIComponent(game), { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((b: { at: number; snap: Snapshot | null } | null) => {
      if (b && b.at > saveAt(game)) putSave(game, b.snap, b.at);
    })
    .catch(() => {});
  await Promise.race([job, new Promise((ok) => setTimeout(ok, waitMs))]);
}

// вошёл — свести: новее в базе — забрать, новее здесь (или в базе нет) — отправить
onAccount((m) => {
  if (!m) return;
  void fetch('/api/saves', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then(async (b: { saves: { game: string; at: number; has: boolean }[] } | null) => {
      if (!b) return;
      const remote = new Map(b.saves.map((s) => [s.game, s]));
      for (const g of CATALOG) {
        if (!g.load) continue;
        const r = remote.get(g.id);
        const localAt = saveAt(g.id);
        const local = loadSave(g.id);
        if (r && r.at > localAt) {
          if (!r.has) putSave(g.id, null, r.at);
          else await syncSave(g.id, 5000);
        } else if (local && (!r || localAt > r.at)) await upload(g.id, local, localAt || Date.now());
      }
    })
    .catch(() => {});
});
