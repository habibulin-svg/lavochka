// Донат без сети: форма оплаты Robokassa, проверка уведомления, цель сбора, настройки только у Мастера.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Accounts } from '../server/accounts/accounts';
import { MemoryMailer } from '../server/accounts/mail';
import { MemoryAccountStore } from '../server/accounts/store';
import { Donate } from '../server/donate';
import { checkResult, payForm, phpUrlencode, robokassaFromEnv, type RobokassaConf } from '../server/pay/robokassa';
import { DONATE_LABEL } from '../src/core/donate';

const conf: RobokassaConf = { login: 'lavochka', pass1: 'p1', pass2: 'p2', test: true, hash: 'md5', receipt: true };
const md5 = (s: string) => createHash('md5').update(s).digest('hex');
const resultSig = (sum: string, inv: number) => md5(`${sum}:${inv}:p2`);

let ipN = 0;
function setup(pay: RobokassaConf | null = conf) {
  const acc = new Accounts(new MemoryAccountStore(), new MemoryMailer());
  const don = new Donate(acc, pay);
  const ctx = (sid?: string) => ({ sid, ip: '10.1.0.' + ++ipN, ua: 'test', site: 'https://lavochka-games.ru' });
  return { acc, don, ctx };
}

async function master(acc: Accounts, ctx: (sid?: string) => any) {
  const r = await acc.register({ email: 'master@x.ru', password: 'пароль-мастера', consent: true, name: 'Мастер' }, ctx());
  const id = (r.body.user as any).id;
  await acc.store.grant(id, 'master', null, null);
  return r.sid as string;
}

describe('Robokassa', () => {
  it('без ключей приём выключен', () => {
    expect(robokassaFromEnv({})).toBeNull();
    expect(robokassaFromEnv({ ROBOKASSA_LOGIN: 'a', ROBOKASSA_PASS1: 'b', ROBOKASSA_PASS2: 'c' })).toMatchObject({ test: false, hash: 'md5', receipt: true });
  });

  it('urlencode как в PHP', () => {
    expect(phpUrlencode('a b!*()~"«')).toBe('a+b%21%2A%28%29%7E%22%C2%AB');
  });

  it('подпись формы: Логин:Сумма:Номер:Receipt:Пароль1', () => {
    const f = payForm(conf, { invId: 7, amount: 30000, description: 'Поддержка', email: 'a@b.ru' });
    expect(f.fields.OutSum).toBe('300.00');
    expect(f.fields.IsTest).toBe('1');
    expect(JSON.parse(decodeURIComponent(f.fields.Receipt.replace(/\+/g, ' '))).items[0]).toMatchObject({ name: 'Поддержка', sum: 300, tax: 'none' });
    expect(f.fields.SignatureValue).toBe(md5(`lavochka:300.00:7:${f.fields.Receipt}:p1`));
    const plain = payForm({ ...conf, receipt: false, test: false }, { invId: 7, amount: 10000, description: 'x' });
    expect(plain.fields.Receipt).toBeUndefined();
    expect(plain.fields.IsTest).toBeUndefined();
    expect(plain.fields.SignatureValue).toBe(md5('lavochka:100.00:7:p1'));
  });

  it('уведомление: подпись Паролем 2, регистр не важен, Shp_ по алфавиту', () => {
    expect(checkResult(conf, { OutSum: '300.00', InvId: '7', SignatureValue: resultSig('300.00', 7).toUpperCase() })).toEqual({ invId: 7, amount: 30000 });
    expect(checkResult(conf, { OutSum: '300.00', InvId: '7', SignatureValue: md5('300.00:7:p1') })).toBeNull();
    const sig = md5('300.00:7:p2:Shp_a=1:Shp_b=2');
    expect(checkResult(conf, { OutSum: '300.00', InvId: '7', Shp_b: '2', Shp_a: '1', SignatureValue: sig })).not.toBeNull();
  });
});

describe('донат', () => {
  it('сумма в пределах, оплата засчитывается один раз и только своя', async () => {
    const { don, acc, ctx } = setup();
    expect((await don.start({ amount: 5 }, ctx())).code).toBe(400);
    expect((await don.start({ amount: 100.5 }, ctx())).code).toBe(400);
    const r = await don.start({ amount: 500 }, ctx());
    expect(r.code).toBe(200);
    const inv = Number((r.body.form as any).fields.InvId);
    // чужая сумма — отказ
    expect(await don.result({ OutSum: '1.00', InvId: String(inv), SignatureValue: resultSig('1.00', inv) })).toBeNull();
    expect(await don.result({ OutSum: '500.00', InvId: String(inv), SignatureValue: 'bad' })).toBeNull();
    expect(await don.result({ OutSum: '500.00', InvId: String(inv), SignatureValue: resultSig('500.00', inv) })).toBe('OK' + inv);
    // повтор уведомления — снова OK, но без второго зачёта
    expect(await don.result({ OutSum: '500.00', InvId: String(inv), SignatureValue: resultSig('500.00', inv) })).toBe('OK' + inv);
    expect(await acc.store.donatedSince(0)).toBe(50000);
  });

  it('без ключей — понятный отказ, кнопка с надписью по умолчанию', async () => {
    const { don, ctx } = setup(null);
    expect((await don.start({ amount: 300 }, ctx())).code).toBe(503);
    expect(await don.info()).toEqual({ label: DONATE_LABEL, goal: null, enabled: false });
  });

  it('надпись и цель меняет только Мастер; собранное считается с начала цели', async () => {
    const { don, acc, ctx } = setup();
    const guest = await acc.register({ email: 'g@x.ru', password: 'пароль-гостя', consent: true }, ctx());
    expect((await don.adminSet({ label: 'Взлом' }, ctx(guest.sid as string))).code).toBe(403);
    expect((await don.adminGet(ctx())).code).toBe(403);

    const sid = await master(acc, ctx);
    const pay = async (rub: number) => {
      const inv = Number(((await don.start({ amount: rub }, ctx())).body.form as any).fields.InvId);
      await don.result({ OutSum: rub.toFixed(2), InvId: String(inv), SignatureValue: resultSig(rub.toFixed(2), inv) }, Date.now());
    };
    await pay(100);
    await new Promise((ok) => setTimeout(ok, 5));
    const r = await don.adminSet({ label: '  На <b>видео</b>  ', goalTitle: 'Сервер для видео', goalText: 'Нужен мощнее', goalTarget: 5000, resetCollected: true }, ctx(sid));
    expect(r.code).toBe(200);
    await new Promise((ok) => setTimeout(ok, 5));
    await pay(300);
    const info = await don.info();
    expect(info.label).toBe('На b видео /b');
    expect(info.goal).toEqual({ title: 'Сервер для видео', text: 'Нужен мощнее', target: 5000, collected: 300 });
    const adm = await don.adminGet(ctx(sid));
    expect(adm.body.total).toBe(400);
    expect((adm.body.recent as any[]).length).toBe(2);
    // пустая надпись — снова по умолчанию, без названия цели — без цели
    await don.adminSet({ label: '', goalTitle: '' }, ctx(sid));
    expect(await don.info()).toMatchObject({ label: DONATE_LABEL, goal: null });
  });
});
