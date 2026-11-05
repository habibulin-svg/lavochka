/* Разовые покупки (src/core/buy.ts) через Robokassa: товар → бессрочное право. Логика без HTTP — класс Buy (тесты — tests/buy.test.ts),
 * HTTP-обвязка — buyApi:
 *   GET  /api/buy?product=geroi  — цена, подключена ли касса, куплено ли
 *   POST /api/buy {product}      — завести заказ, вернуть форму оплаты
 * Заказ — донат с purpose 'buy:<товар>' (в сбор и список донатов не идёт); уведомление приходит на общий Result URL
 * (server/donate.ts), оплата засчитывается один раз (markDonationPaid) и зовёт Buy.paid — право выдаётся навсегда. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Limiter, type Accounts, type Ctx, type Reply } from './accounts/accounts';
import type { Donation } from './accounts/store';
import { cookieOf, sameOrigin, send, siteOf } from './accounts/http';
import { payForm, type RobokassaConf } from './pay/robokassa';
import { PRODUCTS, PURPOSE_PREFIX, productOfPurpose, type BuyStatus } from '../src/core/buy';
import { hasRight } from '../src/core/rights';

const err = (code: number, error: string, message: string): Reply => ({ code, body: { error, message } });

export class Buy {
  private byUser = new Limiter(10, 3600_000);

  constructor(
    private acc: Accounts,
    private pay: RobokassaConf | null,
    private log: (s: string) => void = () => {}
  ) {}

  get enabled() {
    return !!this.pay;
  }

  async status(product: string, ctx: Ctx): Promise<Reply> {
    const p = PRODUCTS[product];
    if (!p) return err(404, 'product', 'Нет такого товара.');
    const u = await this.acc.current(ctx);
    const rights = u ? await this.acc.store.rights(u.id, ctx.now ?? Date.now()) : [];
    const body: BuyStatus = { product: p.id, rub: p.rub, enabled: this.enabled, signedIn: !!u, owned: hasRight(rights, p.right, ctx.now ?? Date.now()) };
    return { code: 200, body: { ...body } };
  }

  async start(b: any, ctx: Ctx): Promise<Reply> {
    const p = PRODUCTS[String(b?.product ?? '')];
    if (!p) return err(400, 'product', 'Нет такого товара.');
    if (!this.pay) return err(503, 'off', 'Оплата ещё не подключена. Загляните чуть позже!');
    const u = await this.acc.current(ctx);
    if (!u) return err(401, 'login', 'Чтобы купить, войдите на сайт — покупка привязывается к аккаунту и открывается на любом устройстве.');
    const now = ctx.now ?? Date.now();
    if (hasRight(await this.acc.store.rights(u.id, now), p.right, now)) return err(409, 'owned', 'Уже куплено — всё открыто.');
    if (!this.byUser.take('u' + u.id, ctx.now)) return err(429, 'often', 'Слишком много попыток подряд. Попробуйте позже.');
    const id = await this.acc.store.createDonation({ userId: u.id, amount: p.rub * 100, purpose: PURPOSE_PREFIX + p.id });
    return { code: 200, body: { form: payForm(this.pay, { invId: id, amount: p.rub * 100, description: p.purpose, email: u.emailVerified ? u.email : null }) } };
  }

  /** Оплата пришла (server/donate.ts, один раз на заказ): право — навсегда. false — заказ не наш. */
  async paid(d: Donation): Promise<boolean> {
    const p = productOfPurpose(d.purpose);
    if (!p) return false;
    if (d.userId == null) {
      this.log(`покупка №${d.id}: без игрока — право выдаст Мастер вручную`);
      return true;
    }
    if (d.amount !== p.rub * 100) this.log(`покупка №${d.id}: сумма ${d.amount / 100} ₽ не равна цене ${p.rub} ₽ — право всё равно выдано (касса подтвердила оплату заказа)`);
    await this.acc.store.grant(d.userId, p.right, null, null);
    this.log(`покупка №${d.id}: ${p.id} — игроку ${d.userId}`);
    return true;
  }
}

/** Обработать адреса покупок; false — не наш адрес. */
export async function buyApi(
  buy: Buy,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ip: string,
  readBody: (req: IncomingMessage, limit?: number) => Promise<string>
): Promise<boolean> {
  if (url.pathname !== '/api/buy') return false;
  const ctx: Ctx = { sid: cookieOf(req), ip, ua: String(req.headers['user-agent'] || ''), site: siteOf(req) };
  if (req.method === 'GET') {
    send(req, res, await buy.status(url.searchParams.get('product') ?? '', ctx));
    return true;
  }
  if (req.method !== 'POST') {
    send(req, res, { code: 405, body: { error: 'method' } });
    return true;
  }
  if (!sameOrigin(req) || !/^application\/json/.test(String(req.headers['content-type'] || ''))) {
    send(req, res, { code: 403, body: { error: 'origin' } });
    return true;
  }
  let b: any;
  try {
    b = JSON.parse((await readBody(req, 4096)) || '{}');
  } catch {
    send(req, res, { code: 400, body: { error: 'bad body' } });
    return true;
  }
  send(req, res, await buy.start(b, ctx));
  return true;
}
