/* Robokassa (https://docs.robokassa.ru): переход на оплату POST-формой и проверка уведомлений.
 * Переменные: ROBOKASSA_LOGIN, ROBOKASSA_PASS1, ROBOKASSA_PASS2 (в тестовом режиме — тестовые пароли магазина),
 * ROBOKASSA_TEST=1 — тестовые платежи, ROBOKASSA_HASH — алгоритм подписи из настроек магазина (md5 по умолчанию),
 * ROBOKASSA_RECEIPT=0 — не передавать номенклатуру чека (по умолчанию передаём: для чека самозанятого),
 * ROBOKASSA_RECURRING=1 — повторные списания подписки (включать, только когда Robokassa подключит их магазину),
 * ROBOKASSA_SUBSCRIPTION — продукт «Подписки» из кабинета Robokassa (SubscriptionId или вся платёжная ссылка):
 *   подписчик оформляет её на странице Robokassa, списывает и отменяет тоже Robokassa, нам приходят уведомления.
 * Адреса в кабинете магазина: Result URL — /api/pay/robokassa/result, Success URL — …/success, Fail URL — …/fail. */
import { createHash } from 'node:crypto';

export const PAY_FORM = 'https://auth.robokassa.ru/Merchant/Index.aspx';
/** Повторное списание по материнскому платежу (тестового режима у него нет). */
export const RECURRING_URL = 'https://auth.robokassa.ru/Merchant/Recurring';
/** Страница оформления продукта «Подписки». */
export const SUBSCRIBE_URL = 'https://auth.robokassa.ru/RecurringSubscriptionPage/Subscription/Subscribe';

export interface RobokassaConf {
  login: string;
  pass1: string;
  pass2: string;
  test: boolean;
  hash: string;
  receipt: boolean;
  /** Повторные платежи подключены (автопродление подписки). */
  recurring: boolean;
  /** Ссылка на продукт «Подписки» (без почты) или null. */
  subscription: string | null;
}

/** ROBOKASSA_SUBSCRIPTION: SubscriptionId или вся ссылка → ссылка на страницу оформления. */
export function subscriptionUrl(v: string | undefined): string | null {
  const s = (v || '').trim();
  if (!s) return null;
  if (/^https:\/\/auth\.robokassa\.ru\//.test(s)) return s;
  return /^[0-9a-f-]{36}$/i.test(s) ? `${SUBSCRIBE_URL}?SubscriptionId=${s}` : null;
}

export function robokassaFromEnv(env = process.env): RobokassaConf | null {
  if (!env.ROBOKASSA_LOGIN || !env.ROBOKASSA_PASS1 || !env.ROBOKASSA_PASS2) return null;
  return {
    login: env.ROBOKASSA_LOGIN,
    pass1: env.ROBOKASSA_PASS1,
    pass2: env.ROBOKASSA_PASS2,
    test: env.ROBOKASSA_TEST === '1',
    hash: (env.ROBOKASSA_HASH || 'md5').toLowerCase(),
    receipt: env.ROBOKASSA_RECEIPT !== '0',
    recurring: env.ROBOKASSA_RECURRING === '1',
    subscription: subscriptionUrl(env.ROBOKASSA_SUBSCRIPTION),
  };
}

const sign = (c: RobokassaConf, s: string) => createHash(c.hash).update(s, 'utf8').digest('hex');

/** urlencode как в PHP (пример Robokassa кодирует номенклатуру именно так). */
export const phpUrlencode = (s: string) => encodeURIComponent(s).replace(/[!'()*~]/g, (ch) => '%' + ch.charCodeAt(0).toString(16).toUpperCase()).replace(/%20/g, '+');

/** Сумма в копейках → «300.00». */
export const outSum = (kop: number) => (kop / 100).toFixed(2);

export interface PayForm {
  action: string;
  fields: Record<string, string>;
}

/** Номенклатура чека: одна строка; самозанятому НДС нет. */
const receiptOf = (c: RobokassaConf, description: string, sum: string) =>
  c.receipt
    ? phpUrlencode(JSON.stringify({ items: [{ name: description.slice(0, 128), quantity: 1, sum: Number(sum), payment_method: 'full_payment', payment_object: 'service', tax: 'none' }] }))
    : '';

/** Подпись запроса магазина: Логин:Сумма:Номер[:Receipt]:Пароль1. */
const shopSign = (c: RobokassaConf, sum: string, invId: number, receipt: string) => sign(c, [c.login, sum, invId, ...(receipt ? [receipt] : []), c.pass1].join(':'));

/** Поля формы оплаты: браузер отправит их POST-ом на страницу Robokassa.
 * recurring — материнский платёж подписки (согласие на повторные списания; в подпись не входит). */
export function payForm(c: RobokassaConf, o: { invId: number; amount: number; description: string; email?: string | null; recurring?: boolean }): PayForm {
  const sum = outSum(o.amount);
  const fields: Record<string, string> = { MerchantLogin: c.login, OutSum: sum, InvId: String(o.invId), Description: o.description.slice(0, 100), Culture: 'ru', Encoding: 'utf-8' };
  const receipt = receiptOf(c, o.description, sum);
  if (receipt) fields.Receipt = receipt;
  if (o.email) fields.Email = o.email;
  if (o.recurring && c.recurring) fields.Recurring = 'true';
  if (c.test) fields.IsTest = '1';
  fields.SignatureValue = shopSign(c, sum, o.invId, receipt);
  return { action: PAY_FORM, fields };
}

/** Запрос повторного списания (сервер шлёт его сам, POST формой). PreviousInvoiceID в подпись не входит.
 * Ответ «OK<номер>» значит лишь «операция заведена» — оплату подтвердит уведомление на Result URL. */
export function recurringCharge(c: RobokassaConf, o: { invId: number; previousId: number; amount: number; description: string }): PayForm {
  const sum = outSum(o.amount);
  const fields: Record<string, string> = { MerchantLogin: c.login, InvoiceID: String(o.invId), PreviousInvoiceID: String(o.previousId), OutSum: sum, Description: o.description.slice(0, 100) };
  const receipt = receiptOf(c, o.description, sum);
  if (receipt) fields.Receipt = receipt;
  fields.SignatureValue = shopSign(c, sum, o.invId, receipt);
  return { action: RECURRING_URL, fields };
}

/** Уведомление об оплате (Result URL): подпись Паролем #2. Вернёт номер и сумму в копейках или null — подпись не та. */
export function checkResult(c: RobokassaConf, p: Record<string, string>): { invId: number; amount: number } | null {
  const sum = String(p.OutSum ?? '');
  const inv = String(p.InvId ?? '');
  const got = String(p.SignatureValue ?? '').toLowerCase();
  if (!/^\d+(\.\d+)?$/.test(sum) || !/^\d+$/.test(inv) || !got) return null;
  const shp = Object.keys(p)
    .filter((k) => k.startsWith('Shp_'))
    .sort()
    .map((k) => `${k}=${p[k]}`);
  if (sign(c, [sum, inv, c.pass2, ...shp].join(':')) !== got) return null;
  return { invId: Number(inv), amount: Math.round(Number(sum) * 100) };
}
