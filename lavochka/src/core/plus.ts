/* Подписка «Лавочка+»: общее для сайта и сервера (server/plus.ts). Оплата — Robokassa, как у доната.
 * Оплаченный срок даёт права из PLUS_RIGHTS (src/core/rights.ts); повторная оплата продлевает от конца срока.
 * Голос за столом бесплатный — в подписку не входит (решение пользователя 2026-10-19). */
import type { RightId } from './rights';

export const PLUS_NAME = 'Лавочка+';
/** Цена, копейки. */
export const PLUS_PRICE = 29_900;
/** Срок одной оплаты — календарный месяц от дня оплаты (addMonths); в заказе по-прежнему пишется 30 «дней» для справки. */
export const PLUS_DAYS = 30;
export const DAY_MS = 86_400_000;
/** Права подписки по ссылке держатся сутки после срока: Robokassa списывает в тот же день месяца, но не в ту же минуту
 * (и повторяет неудачное списание в течение дня). */
export const PLUS_GRACE = DAY_MS;

/** +n календарных месяцев (по Москве); 31 января + 1 = 28/29 февраля, как у Postgres. */
export function addMonths(t: number, n: number): number {
  const MSK = 3 * 3600_000;
  const d = new Date(t + MSK);
  const day = d.getUTCDate();
  const r = new Date(d);
  r.setUTCDate(1);
  r.setUTCMonth(r.getUTCMonth() + n);
  const last = new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, 0)).getUTCDate();
  r.setUTCDate(Math.min(day, last));
  return r.getTime() - MSK;
}

/** Текущий оплаченный месяц подписки, которая действует до until: [start, end), end — ближайшая «дата месяца»
 * после now. null — подписка не действует. */
export function plusPeriod(until: number | null | undefined, now: number): { start: number; end: number } | null {
  if (until == null || until <= now) return null;
  let k = 0;
  while (addMonths(until, -(k + 1)) > now && k < 240) k++;
  return { start: addMonths(until, -(k + 1)), end: addMonths(until, -k) };
}
/** Права подписки: камера, ранний доступ, помощники на ИИ (Михалыч и Димон), оформление (колода «Классическая»). */
export const PLUS_RIGHTS: RightId[] = ['video', 'early_access', 'ai', 'cosmetics'];
/** Назначение платежа (оно же — строка чека). */
export const PLUS_PURPOSE = 'Подписка «Лавочка+» на месяц — сайт «Вечером на лавочке»';
/** Адрес страницы подписки. */
export const PLUS_PAGE = '/podpiska/';

/** Оплата подписки в истории профиля. */
export interface PlusPayment {
  id: number;
  rub: number;
  at: number;
  /** Срок после этой оплаты. */
  until: number;
  /** Повторное списание (автопродление). */
  auto: boolean;
}

/** Что профиль знает о подписке (GET /api/plus). */
export interface PlusStatus {
  /** Приём оплаты подключён. */
  enabled: boolean;
  /** Повторные списания включены на сервере. */
  recurring: boolean;
  /** Подключена подписка по ссылке Robokassa (списывает и отменяет она сама). */
  link: boolean;
  /** Подтверждённая почта вошедшего — по ней Robokassa привязывает подписку по ссылке. */
  email: string | null;
  price: number;
  days: number;
  /** Конец оплаченного срока (может быть в прошлом) или null — не оформляли. */
  until: number | null;
  /** Автопродление в силе: повторными списаниями или подпиской по ссылке. */
  autorenew: boolean;
  payments: PlusPayment[];
}

/** Подписка в админке Мастера. */
export interface PlusRow {
  userId: number;
  name: string;
  email: string | null;
  until: number;
  autorenew: boolean;
  payments: number;
  /** Всего оплачено, ₽. */
  rub: number;
}
