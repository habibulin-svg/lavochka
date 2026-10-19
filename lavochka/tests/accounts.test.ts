// Аккаунты без базы и без настоящей почты: регистрация, вход, сессии, подтверждение, сброс, права, второй фактор.
import { describe, expect, it } from 'vitest';
import { Accounts, Limiter, cleanName } from '../server/accounts/accounts';
import { base32, checkPassword, checkTotp, hashPassword, totp, unbase32 } from '../server/accounts/crypto';
import { MemoryMailer } from '../server/accounts/mail';
import { MemoryAccountStore } from '../server/accounts/store';
import { hasRight } from '../src/core/rights';

const site = 'https://lavochka-games.ru';
let ipN = 0;
function setup() {
  const mail = new MemoryMailer();
  const acc = new Accounts(new MemoryAccountStore(), mail);
  const ctx = (sid?: string) => ({ sid, ip: '10.0.0.' + ++ipN, ua: 'test', site });
  const tokenFrom = (kind: 'podtverdit' | 'sbros') => {
    const m = mail.sent.at(-1)!.text.match(new RegExp(`${kind}=([\\w-]+)`));
    return m![1];
  };
  return { mail, acc, ctx, tokenFrom };
}

describe('пароли и коды', () => {
  it('scrypt: верный пароль подходит, неверный — нет', async () => {
    const h = await hashPassword('дворовый пароль');
    expect(h.startsWith('scrypt$')).toBe(true);
    expect(await checkPassword('дворовый пароль', h)).toBe(true);
    expect(await checkPassword('чужой пароль', h)).toBe(false);
    expect(await checkPassword('x', null)).toBe(false);
  });

  it('TOTP по RFC 6238 (SHA1, 59 с → 287082)', () => {
    const secret = base32(Buffer.from('12345678901234567890'));
    expect(secret).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(unbase32(secret).toString()).toBe('12345678901234567890');
    expect(totp(secret, 59_000)).toBe('287082');
    expect(checkTotp(secret, '287082', 59_000 + 25_000)).toBe(true);
    expect(checkTotp(secret, '287082', 59_000 + 95_000)).toBe(false);
  });

  it('имя и ограничитель частоты', () => {
    expect(cleanName('  Вася\n  Пупкин ')).toBe('Вася Пупкин');
    expect(cleanName('я')).toBeNull();
    expect(cleanName('<b>x</b>')).toBe('bx/b');
    const l = new Limiter(2, 1000);
    expect([l.take('a', 0), l.take('a', 1), l.take('a', 2), l.take('a', 1500)]).toEqual([true, true, false, true]);
  });
});

describe('аккаунты', () => {
  it('регистрация → сессия, письмо подтверждения, подтверждение по ссылке', async () => {
    const { acc, mail, ctx, tokenFrom } = setup();
    const r = await acc.register({ email: ' Vasya@Example.ru ', password: 'секрет123', name: 'Вася', consent: true }, ctx());
    expect(r.code).toBe(200);
    expect(r.sid).toBeTruthy();
    expect((r.body.user as any).email).toBe('vasya@example.ru');
    expect((r.body.user as any).verified).toBe(false);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].text).toContain(site + '/vhod/?podtverdit=');
    const me = await acc.me(ctx(r.sid!));
    expect((me.body.user as any).name).toBe('Вася');
    const c = await acc.confirm({ token: tokenFrom('podtverdit') }, ctx(r.sid!));
    expect(c.code).toBe(200);
    expect((c.body.user as any).verified).toBe(true);
    // ссылка одноразовая
    expect((await acc.confirm({ token: tokenFrom('podtverdit') }, ctx())).code).toBe(400);
  });

  it('без согласия, с плохой почтой, коротким паролем и повторной почтой — отказ', async () => {
    const { acc, ctx } = setup();
    expect((await acc.register({ email: 'a@b.ru', password: '12345678' }, ctx())).body.error).toBe('consent');
    expect((await acc.register({ email: 'нет-почты', password: '12345678', consent: true }, ctx())).body.error).toBe('email');
    expect((await acc.register({ email: 'a@b.ru', password: '123', consent: true }, ctx())).body.error).toBe('password');
    expect((await acc.register({ email: 'a@b.ru', password: '12345678', consent: true }, ctx())).code).toBe(200);
    expect((await acc.register({ email: 'A@B.ru', password: '12345678', consent: true }, ctx())).code).toBe(409);
  });

  it('вход, неверный пароль, выход', async () => {
    const { acc, ctx } = setup();
    await acc.register({ email: 'p@x.ru', password: 'пароль-пароль', consent: true }, ctx());
    expect((await acc.login({ email: 'p@x.ru', password: 'не тот' }, ctx())).code).toBe(401);
    expect((await acc.login({ email: 'nobody@x.ru', password: 'не тот' }, ctx())).code).toBe(401);
    const r = await acc.login({ email: 'P@x.ru', password: 'пароль-пароль' }, ctx());
    expect(r.code).toBe(200);
    expect((await acc.me(ctx(r.sid!))).body.user).not.toBeNull();
    const out = await acc.logout(ctx(r.sid!));
    expect(out.sid).toBeNull();
    expect((await acc.me(ctx(r.sid!))).body.user).toBeNull();
  });

  it('подбор пароля упирается в предел', async () => {
    const { acc } = setup();
    await acc.register({ email: 'q@x.ru', password: 'пароль-пароль', consent: true }, { ip: '1.1.1.1', ua: '', site });
    const c = { ip: '2.2.2.2', ua: '', site };
    for (let i = 0; i < 10; i++) expect((await acc.login({ email: 'q@x.ru', password: 'нет' + i }, c)).code).toBe(401);
    expect((await acc.login({ email: 'q@x.ru', password: 'пароль-пароль' }, c)).code).toBe(429);
  });

  it('сброс пароля: письмо, новый пароль, старые сессии закрыты', async () => {
    const { acc, mail, ctx, tokenFrom } = setup();
    const reg = await acc.register({ email: 'r@x.ru', password: 'старый-пароль', consent: true }, ctx());
    expect((await acc.forgot({ email: 'nobody@x.ru' }, ctx())).code).toBe(200);
    const before = mail.sent.length;
    expect((await acc.forgot({ email: 'r@x.ru' }, ctx())).code).toBe(200);
    expect(mail.sent.length).toBe(before + 1);
    const r = await acc.reset({ token: tokenFrom('sbros'), password: 'новый-пароль' }, ctx());
    expect(r.code).toBe(200);
    expect(r.sid).toBeTruthy();
    expect((await acc.me(ctx(reg.sid!))).body.user).toBeNull();
    expect((await acc.login({ email: 'r@x.ru', password: 'старый-пароль' }, ctx())).code).toBe(401);
    expect((await acc.login({ email: 'r@x.ru', password: 'новый-пароль' }, ctx())).code).toBe(200);
  });

  it('права со сроком; Мастер входит только с кодом', async () => {
    const { acc, ctx } = setup();
    const reg = await acc.register({ email: 'm@x.ru', password: 'мастер-пароль', consent: true }, ctx());
    const id = (reg.body.user as any).id as number;
    await acc.grant(id, 'video', 30, null);
    await acc.grant(id, 'cosmetics', undefined, null);
    const rights = (await acc.store.rights(id, Date.now())) as any[];
    expect(hasRight(rights, 'video')).toBe(true);
    expect(hasRight(rights, 'video', Date.now() + 31 * 86_400_000)).toBe(false);
    expect(hasRight(rights, 'ai')).toBe(false);
    await expect(acc.grant(id, 'всё', undefined, null)).rejects.toThrow();

    const secret = base32(Buffer.from('abcdefghijabcdefghij'));
    await acc.store.updateUser(id, { totpSecret: secret });
    await acc.grant(id, 'master', undefined, null);
    expect(hasRight(await acc.store.rights(id, Date.now()), 'ai')).toBe(true);
    const step1 = await acc.login({ email: 'm@x.ru', password: 'мастер-пароль' }, ctx());
    expect(step1.body.need).toBe('totp');
    expect(step1.sid).toBeUndefined();
    expect((await acc.login({ email: 'm@x.ru', password: 'мастер-пароль', totp: '000000' }, ctx())).code).toBe(401);
    const ok = await acc.login({ email: 'm@x.ru', password: 'мастер-пароль', totp: totp(secret) }, ctx());
    expect(ok.code).toBe(200);
    expect(ok.sid).toBeTruthy();
  });

  it('почта выключена — регистрация работает, письма нет', async () => {
    const { acc, mail, ctx } = setup();
    mail.fail = true;
    const r = await acc.register({ email: 'n@x.ru', password: '12345678', consent: true }, ctx());
    expect(r.code).toBe(200);
    expect(r.body.mailSent).toBe(false);
  });

  it('имя меняется', async () => {
    const { acc, ctx } = setup();
    const r = await acc.register({ email: 's@x.ru', password: '12345678', consent: true }, ctx());
    expect((await acc.profile({ name: 'Серёга' }, ctx(r.sid!))).code).toBe(200);
    expect(((await acc.me(ctx(r.sid!))).body.user as any).name).toBe('Серёга');
    expect((await acc.profile({ name: 'x' }, ctx(r.sid!))).code).toBe(400);
    expect((await acc.profile({ name: 'Серёга' }, ctx())).code).toBe(401);
  });
});
