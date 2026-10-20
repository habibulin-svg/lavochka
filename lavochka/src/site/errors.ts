/* Ошибки браузера → «Ошибки» админки (server/backoffice.ts, POST /api/errors). Одинаковые за одну загрузку страницы — один раз,
 * всего — не больше 10; ошибки расширений и чужих скриптов не шлём. */
import { serverBase } from '../core/net/ws';

let game: string | null = null;
/** Какая игра открыта (стол ставит при входе, снимает при выходе) — приложится к ошибке. */
export function setErrorGame(id: string | null) {
  game = id;
}

const sent = new Set<string>();

function report(message: string, stack: string | undefined, place: string | undefined) {
  if (!message || sent.size >= 10 || sent.has(message)) return;
  // расширения браузера, сторонние скрипты без подробностей, обрыв загрузки при уходе со страницы
  if (/extension:\/\/|^Script error\.?$|ResizeObserver loop|Load failed|Failed to fetch|NetworkError|AbortError|The operation was aborted/i.test(message + ' ' + (stack ?? ''))) return;
  sent.add(message);
  const body = JSON.stringify({ message: message.slice(0, 500), stack: stack?.slice(0, 4000), place, game, url: location.pathname + location.search });
  try {
    const url = `${serverBase()}/api/errors`;
    if (!navigator.sendBeacon?.(url, body)) void fetch(url, { method: 'POST', body, keepalive: true }).catch(() => {});
  } catch {
    /* без связи — не беда */
  }
}

/** Включить сбор (на сайте; в разработке — тоже, чтобы видеть свои ошибки в админке). */
export function startErrorReports() {
  window.addEventListener('error', (e) => {
    // ошибка загрузки картинки/скрипта приходит без message — её не шлём
    if (!e.message) return;
    report(e.message, (e.error as Error | undefined)?.stack, e.filename ? `${e.filename.replace(location.origin, '')}:${e.lineno}:${e.colno}` : undefined);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason as Error | string | undefined;
    const msg = r instanceof Error ? r.message || r.name : String(r ?? '');
    report('(промис) ' + msg, r instanceof Error ? r.stack : undefined, undefined);
  });
}
