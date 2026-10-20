// Обращения без сети: форма с сайта, письма от Postfix (переписка по «[№N]»), ответы Мастера письмом от support@.
import { describe, expect, it } from 'vitest';
import { Accounts } from '../server/accounts/accounts';
import { MemoryMailer } from '../server/accounts/mail';
import { MemoryAccountStore } from '../server/accounts/store';
import { stripQuote, Support } from '../server/support';
import { SUPPORT_EMAIL, ticketIdOf } from '../src/core/support';

let ipN = 0;
function setup() {
  const mail = new MemoryMailer();
  const acc = new Accounts(new MemoryAccountStore(), mail);
  const sup = new Support(acc);
  const ctx = (sid?: string) => ({ sid, ip: '10.2.0.' + ++ipN, ua: 'test', site: 'https://lavochka-games.ru' });
  return { acc, sup, ctx, mail };
}

async function user(acc: Accounts, ctx: (sid?: string) => any, email: string, master = false) {
  const r = await acc.register({ email, password: 'пароль-игрока', consent: true, name: master ? 'Мастер' : 'Вася' }, ctx());
  if (master) await acc.store.grant((r.body.user as any).id, 'master', null, null);
  return r.sid as string;
}

const letter = (from: string, subject: string, text: string, extra = '') =>
  `From: Петя <${from}>\r\nTo: support@lavochka-games.ru\r\nSubject: ${subject}\r\n${extra}Content-Type: text/plain; charset=utf-8\r\n\r\n${text}\r\n`;

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('обращения', () => {
  it('гость пишет с сайта, Мастеру уходит уведомление', async () => {
    const { acc, sup, ctx, mail } = setup();
    await user(acc, ctx, 'boss@x.ru', true);
    mail.sent = [];
    const r = await sup.create({ kind: 'bug', text: 'Кубики не кидаются в нардах', email: 'Guest@Mail.ru', context: { игра: 'nardy', '<b>': 'x'.repeat(1000) } }, ctx());
    expect(r.code).toBe(200);
    const id = r.body.id as number;
    await tick();
    expect(mail.sent.map((m) => m.to)).toEqual(['boss@x.ru']);
    expect(mail.sent[0].subject).toContain(`[№${id}]`);
    const t = (await acc.store.ticket(id))!;
    expect(t).toMatchObject({ kind: 'bug', status: 'new', email: 'guest@mail.ru', source: 'site', userId: null });
    expect(t.context!.length).toBeLessThan(400);
  });

  it('короткий текст, ловушка и частота', async () => {
    const { sup, ctx } = setup();
    expect((await sup.create({ text: 'а' }, ctx())).code).toBe(400);
    expect((await sup.create({ text: 'спам-спам-спам', website: 'http://x' }, ctx())).body.id).toBe(0);
    const c = ctx();
    for (let i = 0; i < 6; i++) expect((await sup.create({ text: 'вопрос номер ' + i }, c)).code).toBe(200);
    expect((await sup.create({ text: 'ещё один вопрос' }, c)).code).toBe(429);
  });

  it('вошедший видит свои обращения и ответ Мастера; ответ уходит письмом', async () => {
    const { acc, sup, ctx, mail } = setup();
    const boss = await user(acc, ctx, 'boss@x.ru', true);
    const vasya = await user(acc, ctx, 'vasya@x.ru');
    const id = (await sup.create({ kind: 'question', subject: 'Как играть в храп?', text: 'Не понял правила храпа' }, ctx(vasya))).body.id as number;
    expect((await acc.store.ticket(id))!.email).toBe('vasya@x.ru');
    // чужое обращение не видно, админка — только Мастеру
    const other = await user(acc, ctx, 'petya@x.ru');
    expect((await sup.mine(new URLSearchParams({ id: String(id) }), ctx(other))).code).toBe(404);
    expect((await sup.adminGet(new URLSearchParams(), ctx(vasya))).code).toBe(403);
    const list = await sup.adminGet(new URLSearchParams({ status: 'new' }), ctx(boss));
    expect(list.body.fresh).toBe(1);
    mail.sent = [];
    const r = await sup.adminPost({ id, text: 'Правила — в меню «Правила», там есть показ.' }, ctx(boss));
    expect(r.body.mailed).toBe(true);
    expect(mail.sent[0]).toMatchObject({ to: 'vasya@x.ru', from: { email: SUPPORT_EMAIL }, replyTo: SUPPORT_EMAIL });
    expect(ticketIdOf(mail.sent[0].subject)).toBe(id);
    const mine = await sup.mine(new URLSearchParams({ id: String(id) }), ctx(vasya));
    expect((mine.body.ticket as any).status).toBe('open');
    expect((mine.body.ticket as any).messages.map((m: any) => m.staff)).toEqual([false, true]);
    expect((mine.body.ticket as any).email).toBeNull();
    await sup.replyMine({ id, text: 'Спасибо, разобрался' }, ctx(vasya));
    expect((await acc.store.ticket(id))!.status).toBe('new');
    await sup.adminPost({ id, status: 'closed' }, ctx(boss));
    expect((await acc.store.ticket(id))!.status).toBe('closed');
  });

  it('письмо создаёт обращение, ответ с [№N] дописывается в него', async () => {
    const { acc, sup } = setup();
    const a = await sup.fromMail(letter('petya@mail.ru', 'Не работает голос', 'Не слышу соседа по столу'), 'bugs@lavochka-games.ru', 'https://x');
    expect(a.ok).toBe(true);
    const t = (await acc.store.ticket(a.id!))!;
    expect(t).toMatchObject({ kind: 'bug', email: 'petya@mail.ru', name: 'Петя', source: 'mail', subject: 'Не работает голос' });
    await acc.store.setTicketStatus(a.id!, 'open', Date.now());
    const b = await sup.fromMail(
      letter('petya@mail.ru', `Re: Не работает голос [№${a.id}]`, 'Теперь слышу!\n\n20.10.2026, Поддержка пишет:\n> Проверьте микрофон'),
      'support@lavochka-games.ru',
      'https://x'
    );
    expect(b.id).toBe(a.id);
    const t2 = (await acc.store.ticket(a.id!))!;
    expect(t2.status).toBe('new');
    expect(t2.messages.at(-1)!.text).toBe('Теперь слышу!');
    // чужой адрес с тем же номером — отдельное обращение
    const c = await sup.fromMail(letter('evil@mail.ru', `Re: [№${a.id}]`, 'подсуну'), 'support@lavochka-games.ru', 'https://x');
    expect(c.id).not.toBe(a.id);
  });

  it('автоответы, noreply и чужие ящики не принимаются', async () => {
    const { sup } = setup();
    expect((await sup.fromMail(letter('mailer-daemon@mail.ru', 'Undelivered', 'x'), 'support@lavochka-games.ru', 'x')).ok).toBe(false);
    expect((await sup.fromMail(letter('a@mail.ru', 'Отпуск', 'x', 'Auto-Submitted: auto-replied\r\n'), 'support@lavochka-games.ru', 'x')).ok).toBe(false);
    expect((await sup.fromMail(letter('a@mail.ru', 'Привет', 'x'), 'noreply@lavochka-games.ru', 'x')).ok).toBe(false);
  });

  it('цитата старого письма отрезается', () => {
    expect(stripQuote('Да\n\n-----Original Message-----\nстарое')).toBe('Да');
    expect(stripQuote('Ок\n> старое\n>\n> ещё')).toBe('Ок');
    expect(stripQuote('Смотрите:\n> цитата\nмой ответ')).toBe('Смотрите:\n> цитата\nмой ответ');
  });
});
