/* Поддержка проекта (донат) через Robokassa. Логика без HTTP — класс Donate (тесты — tests/donate.test.ts),
 * HTTP-обвязка — donateApi:
 *   GET  /api/donate                    — надпись кнопки, цель сбора, подключена ли оплата
 *   POST /api/donate {amount}           — завести донат, вернуть форму оплаты (браузер отправит её на Robokassa)
 *   GET|POST /api/pay/robokassa/result  — уведомление об оплате (подпись Паролем #2), ответ «OK<номер>»;
 *                                         заказы подписки (номера от PLUS_INV_FROM) уходят в server/plus.ts
 *   GET|POST /api/pay/robokassa/success|fail — возврат покупателя: во двор с ?donate=… или ?plus=spasibo|otmena
 *   GET|POST /api/admin/donate          — Мастеру: настройки и последние донаты */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Accounts, Limiter, type Ctx, type Reply } from './accounts/accounts';
import { cookieOf, sameOrigin, send, siteOf } from './accounts/http';
import { checkResult, payForm, type RobokassaConf } from './pay/robokassa';
import { isPlusInv, type Plus } from './plus';
import { DONATE_LABEL, DONATE_MAX, DONATE_MIN, DONATE_PURPOSE, LIMITS, type DonateInfo } from '../src/core/donate';

const K = { label: 'donate.label', title: 'donate.goal.title', text: 'donate.goal.text', target: 'donate.goal.target', since: 'donate.goal.since' };

const clean = (s: unknown, max: number) =>
  String(s ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

const err = (code: number, error: string, message: string): Reply => ({ code, body: { error, message } });

export class Donate {
  private byIp = new Limiter(20, 3600_000);

  constructor(
    private acc: Accounts,
    private pay: RobokassaConf | null,
    private log: (s: string) => void = () => {}
  ) {}

  get enabled() {
    return !!this.pay;
  }

  async info(): Promise<DonateInfo> {
    const s = await this.acc.store.settings();
    const title = s[K.title] ?? '';
    const target = Number(s[K.target] ?? 0) || 0;
    const goal = title
      ? { title, text: s[K.text] ?? '', target, collected: Math.floor((await this.acc.store.donatedSince(Number(s[K.since] ?? 0) || 0)) / 100) }
      : null;
    return { label: s[K.label] || DONATE_LABEL, goal, enabled: this.enabled };
  }

  /** Завести донат и отдать форму оплаты. */
  async start(b: any, ctx: Ctx): Promise<Reply> {
    if (!this.pay) return err(503, 'off', 'Приём платежей ещё не подключён. Спасибо, что хотите поддержать!');
    const rub = Number(b?.amount);
    if (!Number.isInteger(rub) || rub < DONATE_MIN || rub > DONATE_MAX) return err(400, 'amount', `Сумма — целым числом от ${DONATE_MIN} до ${DONATE_MAX.toLocaleString('ru-RU')} ₽.`);
    if (!this.byIp.take(ctx.ip, ctx.now)) return err(429, 'often', 'Слишком много попыток подряд. Попробуйте позже.');
    const u = await this.acc.current(ctx);
    const id = await this.acc.store.createDonation({ userId: u?.id ?? null, amount: rub * 100 });
    return { code: 200, body: { form: payForm(this.pay, { invId: id, amount: rub * 100, description: DONATE_PURPOSE, email: u?.emailVerified ? u.email : null }) } };
  }

  /** Уведомление Robokassa; текст ответа или null — отказ. */
  async result(p: Record<string, string>, now = Date.now()): Promise<string | null> {
    if (!this.pay) return null;
    const r = checkResult(this.pay, p);
    if (!r) {
      this.log('донат: уведомление с неверной подписью, InvId=' + String(p.InvId ?? '').slice(0, 20));
      return null;
    }
    const d = await this.acc.store.donation(r.invId);
    if (!d || d.amount !== r.amount) {
      this.log(`донат: уведомление не сходится с базой (№${r.invId}, ${r.amount} коп.)`);
      return null;
    }
    if (await this.acc.store.markDonationPaid(d.id, now)) this.log(`донат №${d.id}: оплачено ${d.amount / 100} ₽`);
    return 'OK' + d.id;
  }

  private async master(ctx: Ctx) {
    const u = await this.acc.current(ctx);
    if (!u) return null;
    const rights = await this.acc.store.rights(u.id, ctx.now ?? Date.now());
    return rights.some((r) => r.right === 'master') ? u : null;
  }

  async adminGet(ctx: Ctx): Promise<Reply> {
    if (!(await this.master(ctx))) return err(403, 'master', 'Только для Мастера.');
    const s = await this.acc.store.settings();
    const recent = await this.acc.store.recentDonations(20);
    return {
      code: 200,
      body: {
        settings: { label: s[K.label] ?? '', goalTitle: s[K.title] ?? '', goalText: s[K.text] ?? '', goalTarget: Number(s[K.target] ?? 0) || 0 },
        since: Number(s[K.since] ?? 0) || 0,
        info: await this.info(),
        total: Math.floor((await this.acc.store.donatedSince(0)) / 100),
        recent: recent.map((d) => ({ id: d.id, rub: d.amount / 100, at: d.paidAt, user: d.userName })),
        enabled: this.enabled,
      },
    };
  }

  async adminSet(b: any, ctx: Ctx): Promise<Reply> {
    const u = await this.master(ctx);
    if (!u) return err(403, 'master', 'Только для Мастера.');
    const target = Math.max(0, Math.min(10_000_000, Math.floor(Number(b?.goalTarget) || 0)));
    const set = (k: string, v: string) => this.acc.store.setSetting(k, v || null, u.id);
    await set(K.label, clean(b?.label, LIMITS.label));
    await set(K.title, clean(b?.goalTitle, LIMITS.goalTitle));
    await set(K.text, clean(b?.goalText, LIMITS.goalText));
    await set(K.target, target ? String(target) : '');
    if (b?.resetCollected) await set(K.since, String(ctx.now ?? Date.now()));
    return this.adminGet(ctx);
  }
}

/** Параметры уведомления: из адреса (GET) или тела формы (POST). */
async function params(req: IncomingMessage, url: URL, readBody: (req: IncomingMessage, limit?: number) => Promise<string>): Promise<Record<string, string>> {
  const p: Record<string, string> = Object.fromEntries(url.searchParams);
  if (req.method === 'POST') Object.assign(p, Object.fromEntries(new URLSearchParams(await readBody(req, 16_384))));
  return p;
}

/** Обработать адреса доната; false — не наш адрес. */
export async function donateApi(
  don: Donate,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ip: string,
  readBody: (req: IncomingMessage, limit?: number) => Promise<string>,
  plus?: Plus
): Promise<boolean> {
  const path = url.pathname;
  const ctx: Ctx = { sid: cookieOf(req), ip, ua: String(req.headers['user-agent'] || ''), site: siteOf(req) };
  const m = path.match(/^\/api\/pay\/robokassa\/(result|success|fail)$/);
  if (m) {
    const p: Record<string, string> = await params(req, url, readBody).catch(() => ({}));
    // платёж подписки по ссылке Robokassa приходит со своим номером — узнаём его раньше доната
    const link = !!plus && (await plus.isLinkPayment(p));
    const sub = link || (!!plus && isPlusInv(p.InvId));
    if (m[1] === 'result') {
      const ok = link ? await plus!.linkResult(p) : sub ? await plus!.result(p) : await don.result(p);
      res.writeHead(ok ? 200 : 400, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      res.end(ok ?? 'bad sign');
    } else {
      // возврат с Robokassa: оплата засчитывается уведомлением, здесь только «спасибо» или «не вышло»
      const q = sub ? 'plus' : 'donate';
      res.writeHead(303, { location: `/?${q}=${m[1] === 'success' ? 'spasibo' : 'otmena'}`, 'cache-control': 'no-store' });
      res.end();
    }
    return true;
  }
  if (path !== '/api/donate' && path !== '/api/admin/donate') return false;
  if (req.method === 'GET') {
    send(req, res, path === '/api/donate' ? { code: 200, body: { ...(await don.info()) } } : await don.adminGet(ctx));
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
  send(req, res, path === '/api/donate' ? await don.start(b, ctx) : await don.adminSet(b, ctx));
  return true;
}
