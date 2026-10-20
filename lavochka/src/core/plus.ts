/* Подписка «Лавочка+»: общее для сайта и сервера (server/plus.ts). Оплата — Robokassa, как у доната.
 * Оплаченный срок даёт права из PLUS_RIGHTS (src/core/rights.ts); повторная оплата продлевает от конца срока.
 * Голос за столом бесплатный — в подписку не входит (решение пользователя 2026-10-19). */
import type { RightId } from './rights';

export const PLUS_NAME = 'Лавочка+';
/** Цена, копейки. */
export const PLUS_PRICE = 29_900;
/** Срок одной оплаты, дней. */
export const PLUS_DAYS = 30;
export const DAY_MS = 86_400_000;
/** Права подписки (косметика и ИИ добавятся, когда появятся). */
export const PLUS_RIGHTS: RightId[] = ['video', 'early_access'];
/** Назначение платежа (оно же — строка чека). */
export const PLUS_PURPOSE = 'Подписка «Лавочка+» на 30 дней — сайт «Вечером на лавочке»';
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
  price: number;
  days: number;
  /** Конец оплаченного срока (может быть в прошлом) или null — не оформляли. */
  until: number | null;
  /** Автопродление включено у игрока (только при recurring). */
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
