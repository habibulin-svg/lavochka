// Подписка «Лавочка+» без сети: заказ, форма Robokassa, засчёт оплаты один раз, права на срок, продление, автопродление.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Accounts } from '../server/accounts/accounts';
import { MemoryMailer } from '../server/accounts/mail';
import { MemoryAccountStore } from '../server/accounts/store';
import { Donate } from '../server/donate';
import { PLUS_INV_FROM, Plus, isPlusInv } from '../server/plus';
import { recurringCharge, type RobokassaConf } from '../server/pay/robokassa';
import { DAY_MS, PLUS_GRACE, PLUS_PRICE, addMonths, plusPeriod } from '../src/core/plus';
import { hasRight } from '../src/core/rights';

const conf: RobokassaConf = { login: 'lavochka', pass1: 'p1', pass2: 'p2', test: true, hash: 'md5', receipt: true, recurring: false, subscription: null };
const md5 = (s: string) => createHash('md5').update(s).digest('hex');
const SUM = (PLUS_PRICE / 100).toFixed(2);
const note = (inv: number, sum = SUM) => ({ OutSum: sum, InvId: String(inv), SignatureValue: md5(`${sum}:${inv}:p2`) });

let ipN = 0;
function setup(pay: RobokassaConf | null = conf) {
  const mail = new MemoryMailer();
  const acc = new Accounts(new MemoryAccountStore(), mail);
  const calls: { url: string; body: string }[] = [];
  const http = async (url: string, init: { body: string }) => {
    calls.push({ url, body: init.body });
    const inv = new URLSearchParams(init.body).get('InvoiceID');
    return { ok: true, status: 200, text: async () => 'OK' + inv };
  };
  const plus = new Plus(acc, pay, () => {}, http);
  const ctx = (sid?: string, now?: number) => ({ sid, ip: '10.2.0.' + ++ipN, ua: 'test', site: 'https://lavochka-games.ru', now });
  return { acc, plus, ctx, mail, calls };
}

async function user(acc: Accounts, ctx: (sid?: string) => any, email = 'igrok@x.ru') {
  const r = await acc.register({ email, password: 'пароль-игрока', consent: true, name: 'Игрок' }, ctx());
  const id = (r.body.user as any).id as number;
  await acc.store.updateUser(id, { emailVerified: true });
  (acc.mail as MemoryMailer).sent.length = 0; // письмо «подтвердите почту» не считаем
  return { sid: r.sid as string, id };
}

const invOf = (r: any) => Number(r.body.form.fields.InvId);

describe('подписка «Лавочка+»', () => {
  it('без входа и без ключей — понятный отказ', async () => {
    const { plus, ctx } = setup();
    expect((await plus.start({}, ctx())).code).toBe(401);
    const off = setup(null);
    expect((await off.plus.start({}, off.ctx())).code).toBe(503);
    expect((await off.plus.status(off.ctx())).body).toMatchObject({ enabled: false, until: null });
  });

  it('заказ: номер из своего ряда, форма с чеком и подписью Паролем 1, без Recurring', async () => {
    const { plus, acc, ctx } = setup();
    const u = await user(acc, ctx);
    const r = await plus.start({ autorenew: true }, ctx(u.sid));
    expect(r.code).toBe(200);
    const f = (r.body.form as any).fields;
    expect(Number(f.InvId)).toBeGreaterThanOrEqual(PLUS_INV_FROM);
    expect(isPlusInv(f.InvId)).toBe(true);
    expect(isPlusInv('7')).toBe(false);
    expect(f.OutSum).toBe('299.00');
    expect(f.Email).toBe('igrok@x.ru');
    expect(f.Recurring).toBeUndefined(); // автопродление выключено на сервере — согласие не берём
    expect(f.SignatureValue).toBe(md5(`lavochka:299.00:${f.InvId}:${f.Receipt}:p1`));
    expect(JSON.parse(decodeURIComponent(f.Receipt.replace(/\+/g, ' '))).items[0]).toMatchObject({ sum: 299, tax: 'none', payment_object: 'service' });
  });

  it('оплата засчитывается один раз, только с верной подписью и суммой; права — до конца срока', async () => {
    const { plus, acc, ctx } = setup();
    const u = await user(acc, ctx);
    const inv = invOf(await plus.start({}, ctx(u.sid)));
    const now = Date.now();
    expect(await plus.result({ ...note(inv), SignatureValue: md5(`${SUM}:${inv}:p1`) }, now)).toBeNull();
    expect(await plus.result(note(inv, '1.00'), now)).toBeNull();
    expect(await plus.result(note(999), now)).toBeNull();
    expect(hasRight(await acc.store.rights(u.id, now), 'video', now)).toBe(false);

    expect(await plus.result(note(inv), now)).toBe('OK' + inv);
    const until = addMonths(now, 1);
    expect((await acc.store.subscription(u.id))?.until).toBe(until);
    // повтор уведомления — снова OK, но срок не прибавился
    expect(await plus.result(note(inv), now + 1000)).toBe('OK' + inv);
    expect((await acc.store.subscription(u.id))?.until).toBe(until);
    const rights = await acc.store.rights(u.id, now);
    expect(rights).toEqual(expect.arrayContaining([{ right: 'video', until }, { right: 'early_access', until }]));
    expect(hasRight(rights, 'video', until + 1)).toBe(false);

    const st = await plus.status(ctx(u.sid, now));
    expect(st.body).toMatchObject({ until, autorenew: false });
    expect(st.body.payments).toEqual([{ id: inv, rub: 299, at: now, until, auto: false }]);
  });

  it('повторная оплата продлевает от конца срока, после конца — от дня оплаты', async () => {
    const { plus, acc, ctx } = setup();
    const u = await user(acc, ctx);
    const t0 = Date.now();
    await plus.result(note(invOf(await plus.start({}, ctx(u.sid)))), t0);
    // продлили за 10 дней до конца — месяц прибавился к сроку, а не к сегодня
    const t1 = t0 + 20 * DAY_MS;
    await plus.result(note(invOf(await plus.start({}, ctx(u.sid)))), t1);
    const end = addMonths(t0, 2);
    expect((await acc.store.subscription(u.id))?.until).toBe(end);
    expect((await acc.store.rights(u.id, t1)).find((r) => r.right === 'video')?.until).toBe(end);
    // срок прошёл, оплатили через неделю — от дня оплаты
    const t2 = end + 7 * DAY_MS;
    await plus.result(note(invOf(await plus.start({}, ctx(u.sid)))), t2);
    expect((await acc.store.subscription(u.id))?.until).toBe(addMonths(t2, 1));
    expect((await plus.status(ctx(u.sid, t2))).body.payments).toHaveLength(3);
  });

  it('бессрочное право от Мастера подписка не урезает', async () => {
    const { plus, acc, ctx } = setup();
    const u = await user(acc, ctx);
    await acc.store.grant(u.id, 'video', null, null);
    const now = Date.now();
    await plus.result(note(invOf(await plus.start({}, ctx(u.sid)))), now);
    const rights = await acc.store.rights(u.id, now);
    expect(rights.find((r) => r.right === 'video')?.until).toBeNull();
    expect(rights.find((r) => r.right === 'early_access')?.until).toBe(addMonths(now, 1));
  });

  it('общий Result URL: номер подписки уходит в подписку, доната — в донат', async () => {
    const { plus, acc, ctx } = setup();
    const don = new Donate(acc, conf);
    const u = await user(acc, ctx);
    const d = await don.start({ amount: 299 }, ctx());
    const dInv = Number((d.body.form as any).fields.InvId);
    const pInv = invOf(await plus.start({}, ctx(u.sid)));
    expect(isPlusInv(dInv)).toBe(false);
    expect(isPlusInv(pInv)).toBe(true);
    // номер доната подписка не примет, и наоборот
    expect(await plus.result(note(dInv))).toBeNull();
    expect(await don.result(note(pInv))).toBeNull();
  });

  it('Мастеру — список подписок, остальным нельзя', async () => {
    const { plus, acc, ctx } = setup();
    const u = await user(acc, ctx);
    await plus.result(note(invOf(await plus.start({}, ctx(u.sid)))));
    expect((await plus.admin(ctx(u.sid))).code).toBe(403);
    const m = await user(acc, ctx, 'master@x.ru');
    await acc.store.grant(m.id, 'master', null, null);
    const r = await plus.admin(ctx(m.sid));
    expect(r.code).toBe(200);
    expect(r.body.active).toBe(1);
    expect(r.body.list).toEqual([expect.objectContaining({ userId: u.id, payments: 1, rub: 299, autorenew: false })]);
  });

  it('без автопродления: за 2 дня до конца — одно напоминание на почту, списаний нет', async () => {
    const { plus, acc, ctx, mail, calls } = setup();
    const u = await user(acc, ctx);
    const t0 = Date.now();
    await plus.result(note(invOf(await plus.start({}, ctx(u.sid)))), t0);
    const end = addMonths(t0, 1);
    await plus.tick(end - 5 * DAY_MS);
    expect(mail.sent).toHaveLength(0);
    await plus.tick(end - DAY_MS);
    await plus.tick(end - DAY_MS / 2);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].subject).toMatch(/заканчивается/);
    expect(calls).toHaveLength(0);
    // отмены нет, включить без согласия нельзя
    expect((await plus.setAutorenew({ on: true }, ctx(u.sid))).code).toBe(409);
  });
});

describe('автопродление (ROBOKASSA_RECURRING=1)', () => {
  const rec = { ...conf, recurring: true };

  it('согласие — Recurring в форме; в конце срока — повторное списание, его оплата продлевает', async () => {
    const { plus, acc, ctx, mail, calls } = setup(rec);
    const u = await user(acc, ctx);
    const r = await plus.start({ autorenew: true }, ctx(u.sid));
    const f = (r.body.form as any).fields;
    expect(f.Recurring).toBe('true');
    expect(f.SignatureValue).toBe(md5(`lavochka:299.00:${f.InvId}:${f.Receipt}:p1`)); // Recurring в подпись не входит
    const mother = Number(f.InvId);
    const t0 = Date.now();
    await plus.result(note(mother), t0);
    expect(await acc.store.subscription(u.id)).toMatchObject({ autorenew: true, parentId: mother });
    expect((await plus.status(ctx(u.sid, t0))).body.autorenew).toBe(true);

    const end = addMonths(t0, 1);
    await plus.tick(end - 2 * DAY_MS + 1000);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].subject).toMatch(/продление/);
    expect(calls).toHaveLength(0);
    await plus.tick(end - DAY_MS / 2);
    expect(calls).toHaveLength(1);
    const p = new URLSearchParams(calls[0].body);
    expect(calls[0].url).toBe('https://auth.robokassa.ru/Merchant/Recurring');
    expect(p.get('PreviousInvoiceID')).toBe(String(mother));
    const child = Number(p.get('InvoiceID'));
    expect(child).toBeGreaterThan(mother);
    expect(p.get('SignatureValue')).toBe(md5(`lavochka:299.00:${child}:${p.get('Receipt')}:p1`));
    expect(p.get('IsTest')).toBeNull();
    // через час — не дёргаем снова
    await plus.tick(end - DAY_MS / 2 + 3600_000);
    expect(calls).toHaveLength(1);
    // уведомление о дочернем платеже — срок от конца прежнего
    expect(await plus.result(note(child), end - 1000)).toBe('OK' + child);
    expect((await acc.store.subscription(u.id))?.until).toBe(addMonths(end, 1));
    expect(((await plus.status(ctx(u.sid, end))).body.payments as any[])[0]).toMatchObject({ id: child, auto: true });
  });

  it('без согласия — без Recurring; отменил — списаний нет', async () => {
    const { plus, acc, ctx, calls } = setup(rec);
    const u = await user(acc, ctx);
    const f = ((await plus.start({}, ctx(u.sid))).body.form as any).fields;
    expect(f.Recurring).toBeUndefined();
    const v = await user(acc, ctx, 'v@x.ru');
    const t0 = Date.now();
    await plus.result(note(invOf(await plus.start({ autorenew: true }, ctx(v.sid)))), t0);
    const off = await plus.setAutorenew({ on: false }, ctx(v.sid, t0));
    expect(off.body).toMatchObject({ autorenew: false, until: addMonths(t0, 1) });
    await plus.tick(addMonths(t0, 1) - 1000);
    expect(calls).toHaveLength(0);
    // включить обратно можно: материнский платёж есть
    expect((await plus.setAutorenew({ on: true }, ctx(v.sid, t0))).body.autorenew).toBe(true);
  });

  it('запрос повторного списания: PreviousInvoiceID в подписи нет', () => {
    const c = recurringCharge({ ...rec, receipt: false }, { invId: 1000005, previousId: 1000001, amount: PLUS_PRICE, description: 'x' });
    expect(c.fields.SignatureValue).toBe(md5('lavochka:299.00:1000005:p1'));
    expect(c.fields.Receipt).toBeUndefined();
  });
});

describe('срок — календарный месяц от оплаты', () => {
  it('addMonths и plusPeriod: конец месяца, текущий оплаченный месяц', () => {
    const msk = (y: number, m: number, d: number) => Date.UTC(y, m, d, 9) - 3 * 3600_000; // 09:00 МСК
    expect(addMonths(msk(2026, 9, 22), 1)).toBe(msk(2026, 10, 22));
    expect(addMonths(msk(2027, 0, 31), 1)).toBe(msk(2027, 1, 28));
    expect(addMonths(msk(2026, 11, 15), 1)).toBe(msk(2027, 0, 15));
    expect(addMonths(msk(2026, 10, 22), -1)).toBe(msk(2026, 9, 22));
    // оплачено до 22 января: 5 декабря идёт месяц 22.11–22.12
    expect(plusPeriod(msk(2027, 0, 22), msk(2026, 11, 5))).toEqual({ start: msk(2026, 10, 22), end: msk(2026, 11, 22) });
    expect(plusPeriod(msk(2027, 0, 22), msk(2027, 0, 22))).toBeNull();
    expect(plusPeriod(null, msk(2027, 0, 22))).toBeNull();
  });
});

describe('подписка по ссылке Robokassa (ROBOKASSA_SUBSCRIPTION)', () => {
  const link = { ...conf, subscription: 'https://auth.robokassa.ru/RecurringSubscriptionPage/Subscription/Subscribe?SubscriptionId=fc0f4590-90c8-450c-88c6-10ec1ea44e9b' };
  const ext = (inv: number, email: string, sum = SUM) => ({ OutSum: sum, InvId: String(inv), EMail: email, SignatureValue: md5(`${sum}:${inv}:p2`) });

  it('ссылка — с почтой игрока; без подтверждённой почты — отказ', async () => {
    const { plus, acc, ctx } = setup(link);
    const u = await user(acc, ctx);
    const r = await plus.linkUrl(ctx(u.sid));
    expect(r.body.url).toBe(link.subscription + '&Email=igrok%40x.ru');
    await acc.store.updateUser(u.id, { emailVerified: false });
    expect((await plus.linkUrl(ctx(u.sid))).code).toBe(409);
    expect((await plus.status(ctx(u.sid))).body).toMatchObject({ link: true, email: null });
  });

  it('платёж с чужим номером засчитан по почте один раз; срок +месяц; права с запасом в сутки', async () => {
    const { plus, acc, ctx, mail } = setup(link);
    const u = await user(acc, ctx);
    const t0 = Date.now();
    const p = ext(171608573, 'Igrok@X.ru');
    expect(await plus.isLinkPayment(p)).toBe(true);
    expect(await plus.linkResult(p, t0)).toBe('OK171608573');
    const until = addMonths(t0, 1);
    expect((await acc.store.subscription(u.id))?.until).toBe(until);
    expect(hasRight(await acc.store.rights(u.id, until + PLUS_GRACE / 2), 'video', until + PLUS_GRACE / 2)).toBe(true);
    // повтор того же уведомления — OK без продления
    expect(await plus.linkResult(p, t0 + 1000)).toBe('OK171608573');
    expect((await acc.store.subscription(u.id))?.until).toBe(until);
    expect((await plus.status(ctx(u.sid, t0))).body).toMatchObject({ autorenew: true, until });
    // напоминает сама Robokassa — от нас писем нет; отменяют у неё
    await plus.tick(until - DAY_MS);
    expect(mail.sent).toHaveLength(0);
    expect((await plus.setAutorenew({ on: false }, ctx(u.sid, t0))).code).toBe(409);
    // следующее списание — ещё месяц от конца
    expect(await plus.linkResult(ext(171700000, 'igrok@x.ru'), until - 3600_000)).toBe('OK171700000');
    expect((await acc.store.subscription(u.id))?.until).toBe(addMonths(until, 1));
    // отписался в Robokassa: списаний нет, срок прошёл — автопродление больше не показываем
    expect((await plus.status(ctx(u.sid, addMonths(until, 1) + 2 * DAY_MS))).body.autorenew).toBe(false);
  });

  it('неверная подпись — отказ; почта не найдена — OK (Мастер выдаст вручную); свои заказы и донаты не путаются', async () => {
    const { plus, acc, ctx } = setup(link);
    const u = await user(acc, ctx);
    expect(await plus.linkResult({ ...ext(5, 'igrok@x.ru'), SignatureValue: 'x' })).toBeNull();
    expect(await plus.linkResult(ext(6, 'chuzhoy@x.ru'))).toBe('OK6');
    expect(await acc.store.subscription(u.id)).toBeNull();
    // свой заказ подписки — обычный путь
    const inv = invOf(await plus.start({}, ctx(u.sid)));
    expect(await plus.isLinkPayment(note(inv))).toBe(false);
    // неоплаченный донат на ту же сумму — донат
    const don = new Donate(acc, link);
    const d = Number(((await don.start({ amount: 299 }, ctx())).body.form as any).fields.InvId);
    expect(await plus.isLinkPayment(ext(d, 'igrok@x.ru'))).toBe(false);
    // другая сумма — не подписка
    expect(await plus.isLinkPayment(ext(777, 'igrok@x.ru', '100.00'))).toBe(false);
    // без ROBOKASSA_SUBSCRIPTION ничего не узнаём
    expect(await setup().plus.isLinkPayment(ext(777, 'igrok@x.ru'))).toBe(false);
  });
});
