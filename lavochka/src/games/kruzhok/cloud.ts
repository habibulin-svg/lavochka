/* Шахматный кружок — журнал вошедшего в базе (/api/kruzhok): прогресс задач, пройденные уроки, ответы в партиях,
 * путь и звёзды — одним объектом. Браузер хранит своё; при входе в кружок берём то, что новее (время — kruzhok.at),
 * изменения отправляем с задержкой. Без входа — только устройство, как раньше. */
import { store } from '../../core/settings';
import { currentUser } from '../../site/account';

const KEYS = ['kruzhok.progress', 'kruzhok.lessons', 'kruzhok.classics', 'kruzhok.path', 'kruzhok.storm', 'kruzhok.mated'] as const;
const AT = 'kruzhok.at';
let timer = 0;

const pack = () => Object.fromEntries(KEYS.map((k) => [k, store.get<unknown>(k, null)]));

function upload() {
  const at = store.get<number>(AT, 0);
  if (!currentUser() || !at) return;
  void fetch('/api/kruzhok', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ at, data: pack() }), keepalive: true }).catch(() => {});
}

/** Журнал изменился — отметить время и отправить (не чаще раза в 4 секунды). */
export function touch() {
  store.set(AT, Date.now());
  if (!currentUser()) return;
  clearTimeout(timer);
  timer = setTimeout(upload, 4000) as unknown as number;
}

/** Сверить с базой при входе в кружок: там новее — взять себе (true — журнал сменился), здесь новее — отправить. */
export async function syncKruzhok(): Promise<boolean> {
  if (!currentUser()) return false;
  try {
    const r = await fetch('/api/kruzhok', { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return false;
    const { at, data } = (await r.json()) as { at: number; data: Record<string, unknown> | null };
    const mine = store.get<number>(AT, 0);
    if (data && at > mine) {
      for (const k of KEYS) if (data[k] != null) store.set(k, data[k]);
      store.set(AT, at);
      return true;
    }
    if (mine > at) upload();
  } catch {
    /* без сети — работаем с тем, что на устройстве */
  }
  return false;
}

if (typeof addEventListener !== 'undefined')
  addEventListener('pagehide', () => {
    if (timer) {
      clearTimeout(timer);
      timer = 0;
      upload();
    }
  });
