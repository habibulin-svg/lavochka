/* Подписка «Лавочка+» (src/core/plus.ts) через Robokassa. Логика без HTTP — класс Plus (тесты — tests/plus.test.ts),
 * HTTP-обвязка — plusApi:
 *   GET  /api/plus             — статус подписки вошедшего, история оплат
 *   POST /api/plus {autorenew} — завести заказ, вернуть форму оплаты (браузер отправит её на Robokassa)
 *   POST /api/plus/autorenew {on} — включить/отменить автопродление
 *   GET  /api/admin/plus       — Мастеру: список подписок
 * Уведомление об оплате приходит на общий Result URL (server/donate.ts): номера заказов подписки — от PLUS_INV_FROM.
 * Оплата засчитывается один раз (store.payPlusOrder), права PLUS_RIGHTS выдаются до конца срока.
 * Повторные списания — только при ROBOKASSA_RECURRING=1 (Robokassa подключает их по заявке); без них —
 * напоминание на почту, что срок кончается. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Limiter, letter, type Accounts, type Ctx, type Reply } from './accounts/accounts';
import { cookieOf, sameOrigin, send, siteOf } from './accounts/http';
import { checkResult, payForm, recurringCharge, type RobokassaConf } from './pay/robokassa';
import { DAY_MS, PLUS_DAYS, PLUS_NAME, PLUS_PAGE, PLUS_PRICE, PLUS_PURPOSE, PLUS_RIGHTS, type PlusPayment, type PlusRow, type PlusStatus } from '../src/core/plus';

/** С этого номера — заказы подписки (донаты нумеруются с 1). */
export const PLUS_INV_FROM = 1_000_001;
export const isPlusInv = (inv: unknown) => /^\d+$/.test(String(inv ?? '')) && Number(inv) >= PLUS_INV_FROM;

/** За сколько до конца срока напоминать. */
const REMIND_BEFORE = 2 * DAY_MS;
/** Повторное списание — в последние сутки срока; не вышло — снова через сутки, пока срок не прошёл на 3 дня. */
const CHARGE_BEFORE = DAY_MS;
const RETRY = DAY_MS;
const GIVE_UP = 3 * DAY_MS;

const err = (code: number, error: string, message: string): Reply => ({ code, body: { error, message } });
const day = (t: number) => new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Moscow' });

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export class Plus {
  private byUser = new Limiter(10, 3600_000);

  constructor(
    private acc: Accounts,
    private pay: RobokassaConf | null,
    private log: (s: string) => void = () => {},
    private http: Fetch = fetch,
    /** Адрес сайта для ссылок в письмах. */
    private site = 'https://lavochka-games.ru'
  ) {}

  get enabled() {
    return !!this.pay;
  }

  get recurring() {
    return !!this.pay?.recurring;
  }

  async status(ctx: Ctx): Promise<Reply> {
    const u = await this.acc.current(ctx);
    const base: PlusStatus = { enabled: this.enabled, recurring: this.recurring, price: PLUS_PRICE / 100, days: PLUS_DAYS, until: null, autorenew: false, payments: [] };
    if (!u) return { code: 200, body: { ...base } };
    const s = await this.acc.store.subscription(u.id);
    if (s) await this.giveRights(u.id, s.until, ctx.now ?? Date.now());
    const payments: PlusPayment[] = (await this.acc.store.plusPayments(u.id, 24)).map((o) => ({ id: o.id, rub: o.amount / 100, at: o.paidAt!, until: o.until ?? o.paidAt!, auto: o.parentId != null }));
    return { code: 200, body: { ...base, until: s?.until ?? null, autorenew: !!s?.autorenew && this.recurring, payments } };
  }

  /** Завести заказ и отдать форму оплаты. autorenew — согласие на повторные списания (только если они включены). */
  async start(b: any, ctx: Ctx): Promise<Reply> {
    if (!this.pay) return err(503, 'off', 'Оплата подписки ещё не подключена. Загляните чуть позже!');
    const u = await this.acc.current(ctx);
    if (!u) return err(401, 'login', 'Чтобы оформить подписку, войдите на сайт — подписка привязывается к аккаунту.');
    if (!this.byUser.take('u' + u.id, ctx.now)) return err(429, 'often', 'Слишком много попыток подряд. Попробуйте позже.');
    const recurring = this.recurring && b?.autorenew === true;
    const id = await this.acc.store.createPlusOrder({ userId: u.id, amount: PLUS_PRICE, days: PLUS_DAYS, recurring, parentId: null });
    return { code: 200, body: { form: payForm(this.pay, { invId: id, amount: PLUS_PRICE, description: PLUS_PURPOSE, email: u.emailVerified ? u.email : null, recurring }) } };
  }

  /** Уведомление Robokassa по заказу подписки; текст ответа или null — отказ. */
  async result(p: Record<string, string>, now = Date.now()): Promise<string | null> {
    if (!this.pay) return null;
    const r = checkResult(this.pay, p);
    if (!r) {
      this.log('подписка: уведомление с неверной подписью, InvId=' + String(p.InvId ?? '').slice(0, 20));
      return null;
    }
    const o = await this.acc.store.plusOrder(r.invId);
    if (!o || o.amount !== r.amount) {
      this.log(`подписка: уведомление не сходится с базой (№${r.invId}, ${r.amount} коп.)`);
      return null;
    }
    const until = await this.acc.store.payPlusOrder(o.id, now);
    if (until != null) {
      await this.giveRights(o.userId, until, now);
      this.log(`подписка №${o.id}: оплачено ${o.amount / 100} ₽, игрок ${o.userId}, до ${new Date(until).toISOString().slice(0, 10)}`);
    }
    return 'OK' + o.id;
  }

  /** Права подписки до конца срока. Бессрочные и более долгие (выданные Мастером) не трогаем. */
  private async giveRights(userId: number, until: number, now: number) {
    if (until <= now) return;
    const have = await this.acc.store.rights(userId, now);
    for (const right of PLUS_RIGHTS) {
      const g = have.find((x) => x.right === right && !x.group);
      if (g && (g.until == null || g.until >= until)) continue;
      await this.acc.store.grant(userId, right, until, null);
    }
  }

  async setAutorenew(b: any, ctx: Ctx): Promise<Reply> {
    const u = await this.acc.current(ctx);
    if (!u) return err(401, 'login', 'Войдите на сайт.');
    const s = await this.acc.store.subscription(u.id);
    if (!s) return err(404, 'none', 'Подписка не оформлена.');
    const on = b?.on === true;
    // включить снова можно, только если есть материнский платёж (иначе — оформить заново с согласием)
    if (on && (!this.recurring || s.parentId == null)) return err(409, 'parent', 'Чтобы включить автопродление, оформите подписку заново с согласием на списания.');
    await this.acc.store.updateSubscription(u.id, { autorenew: on });
    this.log(`подписка: игрок ${u.id} ${on ? 'включил' : 'отменил'} автопродление`);
    return this.status(ctx);
  }

  async admin(ctx: Ctx): Promise<Reply> {
    const u = await this.acc.current(ctx);
    const rights = u ? await this.acc.store.rights(u.id, ctx.now ?? Date.now()) : [];
    if (!rights.some((r) => r.right === 'master')) return err(403, 'master', 'Только для Мастера.');
    const now = ctx.now ?? Date.now();
    const list: PlusRow[] = (await this.acc.store.subscriptions(500)).map((s) => ({
      userId: s.userId,
      name: s.name,
      email: s.email,
      until: s.until,
      autorenew: s.autorenew && this.recurring,
      payments: s.payments,
      rub: s.amount / 100,
    }));
    return { code: 200, body: { list, active: list.filter((s) => s.until > now).length, enabled: this.enabled, recurring: this.recurring } };
  }

  /** Раз в час: напоминания о конце срока и (если включены) повторные списания. */
  async tick(now = Date.now()) {
    if (!this.pay) return;
    for (const s of await this.acc.store.subscriptions(10_000)) {
      if (s.until <= now || s.until - now > REMIND_BEFORE || s.remindedAt != null) continue;
      const auto = s.autorenew && s.parentId != null && this.recurring;
      await this.acc.store.updateSubscription(s.userId, { remindedAt: now });
      await this.remind(s.userId, s.until, auto);
    }
    if (!this.recurring) return;
    for (const s of await this.acc.store.dueSubscriptions(now + CHARGE_BEFORE)) {
      if (now - s.until > GIVE_UP || (s.triedAt != null && now - s.triedAt < RETRY)) continue;
      await this.acc.store.updateSubscription(s.userId, { triedAt: now });
      await this.charge(s.userId, s.parentId!);
    }
  }

  private async charge(userId: number, parentId: number) {
    const id = await this.acc.store.createPlusOrder({ userId, amount: PLUS_PRICE, days: PLUS_DAYS, recurring: false, parentId });
    const f = recurringCharge(this.pay!, { invId: id, previousId: parentId, amount: PLUS_PRICE, description: PLUS_PURPOSE });
    try {
      const r = await this.http(f.action, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(f.fields).toString() });
      const text = (await r.text()).trim();
      this.log(`подписка: повторное списание №${id} (игрок ${userId}) — ${r.ok && text === 'OK' + id ? 'заведено' : `отказ ${r.status} ${text.slice(0, 200)}`}`);
    } catch (e) {
      this.log(`подписка: повторное списание №${id} не отправлено — ${(e as Error).message}`);
    }
  }

  private async remind(userId: number, until: number, auto: boolean) {
    const u = await this.acc.store.userById(userId);
    if (!u?.email || !u.emailVerified || !this.acc.mail.enabled) return;
    const link = this.site + PLUS_PAGE;
    const rub = PLUS_PRICE / 100;
    const lead = auto
      ? `Подписка «${PLUS_NAME}» оплачена до ${day(until)}. В этот день с карты спишется ${rub} ₽ за следующие ${PLUS_DAYS} дней. Не хотите продлевать — отмените автопродление в профиле на сайте.`
      : `Подписка «${PLUS_NAME}» заканчивается ${day(until)}. Чтобы видео за столом и ранний доступ к новым играм не пропали, продлите её — ${rub} ₽ за ${PLUS_DAYS} дней, новый срок прибавится к оставшемуся.`;
    await this.acc.mail.send({
      to: u.email,
      subject: auto ? `«${PLUS_NAME}»: скоро продление` : `«${PLUS_NAME}» заканчивается ${day(until)}`,
      text: `Здравствуйте, ${u.name}!\n\n${lead}\n\n${link}`,
      html: letter(u.name, lead, link, auto ? 'Подписка на сайте' : 'Продлить подписку', 'Письмо пришло, потому что вы оформили подписку на сайте «Вечером на лавочке».'),
      tag: 'plus',
    });
  }
}

/** Обработать адреса подписки; false — не наш адрес. */
export async function plusApi(
  plus: Plus,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ip: string,
  readBody: (req: IncomingMessage, limit?: number) => Promise<string>
): Promise<boolean> {
  const path = url.pathname;
  if (path !== '/api/plus' && path !== '/api/plus/autorenew' && path !== '/api/admin/plus') return false;
  const ctx: Ctx = { sid: cookieOf(req), ip, ua: String(req.headers['user-agent'] || ''), site: siteOf(req) };
  if (req.method === 'GET') {
    send(req, res, path === '/api/admin/plus' ? await plus.admin(ctx) : await plus.status(ctx));
    return true;
  }
  if (req.method !== 'POST' || path === '/api/admin/plus') {
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
  send(req, res, path === '/api/plus' ? await plus.start(b, ctx) : await plus.setAutorenew(b, ctx));
  return true;
}
