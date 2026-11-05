// Разовые покупки («Герои» целиком, 300 ₽) без сети: заказ через кассу доната, засчёт один раз, право навсегда.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Accounts } from '../server/accounts/accounts';
import { MemoryMailer } from '../server/accounts/mail';
import { MemoryAccountStore } from '../server/accounts/store';
import { Buy } from '../server/buy';
import { Donate } from '../server/donate';
import type { RobokassaConf } from '../server/pay/robokassa';
import { PRODUCTS } from '../src/core/buy';
import { hasRight } from '../src/core/rights';

const conf: RobokassaConf = { login: 'lavochka', pass1: 'p1', pass2: 'p2', test: true, hash: 'md5', receipt: true, recurring: false, subscription: null };
const md5 = (s: string) => createHash('md5').update(s).digest('hex');
const note = (inv: number, sum: string) => ({ OutSum: sum, InvId: String(inv), SignatureValue: md5(`${sum}:${inv}:p2`) });

let ipN = 0;
function setup(pay: RobokassaConf | null = conf) {
  const acc = new Accounts(new MemoryAccountStore(), new MemoryMailer());
  const buy = new Buy(acc, pay);
  const don = new Donate(acc, pay);
  don.onPaid = async (d) => {
    await buy.paid(d);
  };
  const ctx = (sid?: string) => ({ sid, ip: '10.3.0.' + ++ipN, ua: 'test', site: 'https://lavochka-games.ru' });
  return { acc, buy, don, ctx };
}

async function user(acc: Accounts, ctx: (sid?: string) => any) {
  const r = await acc.register({ email: 'geroi@x.ru', password: 'пароль-игрока', consent: true, name: 'Игрок' }, ctx());
  return { sid: r.sid as string, id: (r.body.user as any).id as number };
}

describe('покупка «Героев»', () => {
  it('цена 300 ₽, без входа и без кассы — понятный отказ', async () => {
    expect(PRODUCTS.geroi.rub).toBe(300);
    const { buy, ctx } = setup();
    expect((await buy.start({ product: 'geroi' }, ctx())).code).toBe(401);
    expect((await buy.start({ product: 'nope' }, ctx())).code).toBe(400);
    const off = setup(null);
    expect((await off.buy.start({ product: 'geroi' }, off.ctx())).code).toBe(503);
    expect((await off.buy.status('geroi', off.ctx())).body).toMatchObject({ enabled: false, owned: false, rub: 300 });
  });

  it('оплата засчитывается один раз, с верной подписью; право — навсегда; второй раз купить нельзя', async () => {
    const { buy, don, acc, ctx } = setup();
    const u = await user(acc, ctx);
    const r = await buy.start({ product: 'geroi' }, ctx(u.sid));
    expect(r.code).toBe(200);
    const f = (r.body.form as any).fields;
    expect(f.OutSum).toBe('300.00');
    const inv = Number(f.InvId);
    expect(await don.result({ ...note(inv, '300.00'), SignatureValue: 'плохая' })).toBeNull();
    expect(await don.result(note(inv, '300.00'))).toBe('OK' + inv);
    expect(await don.result(note(inv, '300.00'))).toBe('OK' + inv); // повтор уведомления — без второго права
    const rights = await acc.store.rights(u.id, Date.now());
    expect(rights.filter((g) => g.right === 'geroi_full')).toHaveLength(1);
    expect(hasRight(rights, 'geroi_full', Date.now() + 50 * 365 * 86400_000)).toBe(true);
    expect((await buy.status('geroi', ctx(u.sid))).body).toMatchObject({ owned: true, signedIn: true });
    expect((await buy.start({ product: 'geroi' }, ctx(u.sid))).code).toBe(409);
    // в сбор доната покупка не идёт
    expect(await acc.store.donatedSince(0)).toBe(0);
  });
});
