/* Разовые покупки (server/buy.ts): товар → право навсегда. Заказ идёт через ту же кассу, что донат (donations с purpose 'buy:<товар>').
 * «Герои» (решение пользователя 2026-11-06): база бесплатно, вторая четвёрка фракций и кампании 3–7 — разовым платежом 300 ₽. */
import type { RightId } from './rights';

export interface Product {
  id: string;
  /** Какое право даёт (бессрочно). */
  right: RightId;
  /** Цена, рубли. */
  rub: number;
  /** Назначение платежа в чеке. */
  purpose: string;
  /** Куда вернуть покупателя с кассы (к адресу добавится ?buy=spasibo|otmena). */
  back: string;
}

export const PRODUCTS: Record<string, Product> = {
  geroi: { id: 'geroi', right: 'geroi_full', rub: 300, purpose: 'Герои кастета и семок: полная игра (4 фракции и кампании)', back: '/geroi.html' },
};

export const PURPOSE_PREFIX = 'buy:';
export const productOfPurpose = (purpose: string | null | undefined): Product | null =>
  purpose?.startsWith(PURPOSE_PREFIX) ? PRODUCTS[purpose.slice(PURPOSE_PREFIX.length)] ?? null : null;

export interface BuyStatus {
  product: string;
  rub: number;
  /** Касса подключена. */
  enabled: boolean;
  signedIn: boolean;
  owned: boolean;
}
