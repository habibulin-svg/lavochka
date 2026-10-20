/* Что игрок уже видел (данетки, дела детективов): номер задания → минута, когда открылась разгадка. Браузер хранит своё
 * (отдельно для гостя и для каждого аккаунта), вошедшему site/seen.ts подтягивает и пополняет копию в базе через seenHooks.
 * Вид игры отдаёт список столу действием, и игра подбирает то, чего за столом никто не видел (core/fresh.ts). */
import { SEEN_MAX } from './fresh';
import { store } from './settings';

export const seenHooks: {
  /** Чей список: номер аккаунта или 'guest'. */
  scope?(): string;
  /** Список из базы (вошедшему). */
  load?(game: string): Promise<Record<string, number> | null>;
  /** Открылись новые — отправить в базу. */
  added?(game: string, ids: number[]): void;
} = {};

const key = (game: string) => `seen.${game}.${seenHooks.scope?.() ?? 'guest'}`;
const minute = () => Math.floor(Date.now() / 60000);

function save(game: string, m: Record<string, number>) {
  const list = Object.entries(m);
  if (list.length > SEEN_MAX) m = Object.fromEntries(list.sort((a, b) => b[1] - a[1]).slice(0, SEEN_MAX));
  store.set(key(game), m);
}

/** Игрок увидел разгадку (или сказал, что уже знает). */
export function markSeen(game: string, ids: number[]) {
  const m = store.get<Record<string, number>>(key(game), {});
  const t = minute();
  const fresh = ids.filter((id) => m[id] !== t);
  if (!fresh.length) return;
  for (const id of fresh) m[id] = t;
  save(game, m);
  seenHooks.added?.(game, fresh);
}

/** Список для стола: [[номер, минута], …], свежие первыми. Вошедшему сперва сводит с базой (без сети не ждёт дольше waitMs). */
export async function seenList(game: string, waitMs = 1500): Promise<[number, number][]> {
  const load = seenHooks.load?.(game);
  if (load) {
    const remote = await Promise.race([load.catch(() => null), new Promise<null>((ok) => setTimeout(() => ok(null), waitMs))]);
    if (remote) {
      const m = store.get<Record<string, number>>(key(game), {});
      for (const [id, t] of Object.entries(remote)) if (Number.isFinite(t)) m[id] = Math.max(m[id] ?? 0, t);
      save(game, m);
    }
  }
  return Object.entries(store.get<Record<string, number>>(key(game), {}))
    .map(([id, t]) => [Number(id), t] as [number, number])
    .sort((a, b) => b[1] - a[1])
    .slice(0, SEEN_MAX);
}
