/* Счётчики двора с сервера: сколько народу на сайте (в шапке) и сколько партий начато в каждой игре
 * (сортировка «популярные»). Вкладка отмечается раз в минуту, пока видна; нет связи — счётчиков просто нет. */
import { serverBase } from '../core/net/ws';
import { uid } from '../core/util';

export interface Stats {
  online: number;
  played: Record<string, number>;
  /** Лайки по играм (этап 3б; старый сервер их не шлёт). */
  likes?: Record<string, number>;
  /** Выход игр из админки (src/core/release.ts). */
  release?: import('../core/release').Release;
}

let last: Stats | null = null;
let at = 0;
let req: Promise<Stats | null> | null = null;
const subs = new Set<(s: Stats) => void>();
// метка вкладки: одна на вкладку, переживает обновление страницы
let tab = '';
try {
  tab = sessionStorage.getItem('lavochka.tab') || uid();
  sessionStorage.setItem('lavochka.tab', tab);
} catch {
  tab = uid();
}

/** Счётчики (кэш на минуту). */
export function loadStats(): Promise<Stats | null> {
  if (last && Date.now() - at < 60_000) return Promise.resolve(last);
  req ??= fetch(`${serverBase()}/api/stats?v=${encodeURIComponent(tab)}`, { cache: 'no-store', signal: AbortSignal.timeout(5000) })
    .then((r) => (r.ok ? (r.json() as Promise<Stats>) : null))
    .catch(() => null)
    .then((s) => {
      req = null;
      if (s && typeof s.online === 'number') {
        last = s;
        at = Date.now();
        subs.forEach((f) => f(s));
      }
      return last;
    });
  return req;
}

/** Подписаться на свежие счётчики; сразу отдаёт известные. */
export function onStats(f: (s: Stats) => void): () => void {
  subs.add(f);
  if (last) f(last);
  return () => subs.delete(f);
}

/** Начали партию (только тот, кто её начал: хозяин стола или игрок за своим экраном). mode — для статистики админки. */
export function countPlay(game: string, mode: 'local' | 'net' | 'arcade') {
  void fetch(`${serverBase()}/api/played`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ game, mode }), keepalive: true }).catch(() => {});
}

let beat: ReturnType<typeof setInterval> | undefined;
/** Отмечаться «во дворе», пока вкладка видна. */
export function startPresence() {
  if (beat) return;
  void loadStats();
  beat = setInterval(() => {
    if (document.visibilityState === 'visible') void loadStats();
  }, 60_000);
}
