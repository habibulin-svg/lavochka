/* Яндекс Метрика: только на основном домене и только если задан номер счётчика.
 * Сайт — одна страница с History API, поэтому просмотры шлём сами (defer + hit на каждый новый адрес). */
import { SITE_URL } from './routes';

/** Номер счётчика из metrika.yandex.ru (0 — Метрика выключена). */
export const YM_ID = 113675275;

type Ym = ((id: number, method: string, ...args: unknown[]) => void) & { a?: unknown[][]; l?: number };
const w = window as unknown as { ym?: Ym };
let last = '';
const on = () => YM_ID > 0 && location.origin === SITE_URL;

export function startMetrika() {
  if (!on() || w.ym) return;
  const ym: Ym = (...args: unknown[]) => void (ym.a = ym.a || []).push(args);
  ym.l = Date.now();
  w.ym = ym;
  const s = document.createElement('script');
  s.async = true;
  s.src = 'https://mc.yandex.ru/metrika/tag.js?id=' + YM_ID;
  document.head.appendChild(s);
  ym(YM_ID, 'init', { ssr: true, defer: true, clickmap: true, trackLinks: true, accurateTrackBounce: true, webvisor: false });
  metrikaHit();
}

/** Просмотр текущего адреса (после pushState/replaceState/popstate). */
export function metrikaHit() {
  if (!on() || !w.ym) return;
  const url = location.pathname + location.search;
  if (url === last) return;
  const referer = last ? location.origin + last : document.referrer;
  last = url;
  w.ym(YM_ID, 'hit', location.href, { title: document.title, referer });
}
