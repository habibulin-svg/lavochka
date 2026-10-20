// Админка без сети: счётчики по дням, автоошибки (склейка, выгрузка), игроки — права и закрытие входа.
import { describe, expect, it } from 'vitest';
import { Accounts } from '../server/accounts/accounts';
import { MemoryMailer } from '../server/accounts/mail';
import { MemoryAccountStore } from '../server/accounts/store';
import { Backoffice, fingerprint, mskDay, placeOf } from '../server/backoffice';
import { mayPlay } from '../src/core/release';

let ipN = 0;
function setup() {
  const acc = new Accounts(new MemoryAccountStore(), new MemoryMailer());
  const bo = new Backoffice(acc, () => ({ online: 7, rooms: 2, players: 5 }));
  const ctx = (sid?: string) => ({ sid, ip: '10.3.0.' + ++ipN, ua: 'test', site: 'https://lavochka-games.ru' });
  return { acc, bo, ctx };
}

async function user(acc: Accounts, ctx: (sid?: string) => any, email: string, master = false) {
  const r = await acc.register({ email, password: 'пароль-игрока', consent: true, name: master ? 'Мастер' : 'Вася' }, ctx());
  if (master) await acc.store.grant((r.body.user as any).id, 'master', null, null);
  return { sid: r.sid as string, id: (r.body.user as any).id as number };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const q = (s = '') => new URLSearchParams(s);

describe('админка', () => {
  it('день по Москве', () => {
    expect(mskDay(Date.UTC(2026, 9, 20, 20, 59))).toBe('2026-10-20');
    expect(mskDay(Date.UTC(2026, 9, 20, 21, 1))).toBe('2026-10-21');
  });

  it('сводка: партии по дням и играм, онлайн, посетители, регистрации — только Мастеру', async () => {
    const { acc, bo, ctx } = setup();
    const boss = await user(acc, ctx, 'boss@x.ru', true);
    const vasya = await user(acc, ctx, 'vasya@x.ru');
    bo.played('durak', 'net');
    bo.played('durak', 'local');
    bo.played('nardy', 'local');
    bo.played('tetris', 'arcade');
    bo.visit('tab-aaaaaa');
    bo.visit('tab-bbbbbb');
    bo.visit('tab-aaaaaa');
    await tick();
    await bo.sample();
    expect((await bo.dash(q(), ctx(vasya.sid))).code).toBe(403);
    const r = await bo.dash(q('days=7'), ctx(boss.sid));
    expect(r.code).toBe(200);
    const days = r.body.days as any[];
    expect(days).toHaveLength(7);
    expect(days[6]).toMatchObject({ plays: 4, net: 1, local: 2, arcade: 1, online: 7, players: 5, visitors: 2, signups: 2 });
    expect(r.body.games).toEqual([
      { game: 'durak', plays: 2 },
      { game: 'nardy', plays: 1 },
      { game: 'tetris', plays: 1 },
    ]);
    expect(r.body.totals).toMatchObject({ users: 2, users7: 2, errorsNew: 0 });
  });

  it('ошибки браузера склеиваются, «исправленная» при повторе снова новая, выгрузка в Markdown', async () => {
    const { acc, bo, ctx } = setup();
    const boss = await user(acc, ctx, 'boss@x.ru', true);
    const stack = 'TypeError: x is null\n    at draw (https://lavochka-games.ru/assets/view-AbC12345.js:10:5)\n    at chrome-extension://abc/inject.js:1:1';
    expect(placeOf(stack)).toBe('draw (https://lavochka-games.ru/assets/view-AbC12345.js:10:5)');
    await bo.clientError({ message: "Cannot read properties of null (reading 'x')", stack, game: 'durak', url: '/durak/' }, ctx());
    // другая сборка и другие числа — та же ошибка
    await bo.clientError({ message: "Cannot read properties of null (reading 'x')", stack: stack.replace('AbC12345', 'Zz998877').replace(':10:5', ':11:7') }, ctx());
    let list = (await bo.errors(q(), ctx(boss.sid))).body.errors as any[];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ count: 2, status: 'new', game: 'durak', source: 'client' });
    expect((await bo.errorPost({ id: list[0].id, status: 'fixed' }, ctx(boss.sid))).code).toBe(200);
    expect((await bo.errors(q('status=new'), ctx(boss.sid))).body.errors).toHaveLength(0);
    await bo.clientError({ message: "Cannot read properties of null (reading 'x')", stack }, ctx());
    list = (await bo.errors(q('status=new'), ctx(boss.sid))).body.errors as any[];
    expect(list[0]).toMatchObject({ count: 3, status: 'new' });
    const md = (await bo.errors(q('format=md'), ctx(boss.sid))).body.md as string;
    expect(md).toContain('# Ошибки сайта (1)');
    expect(md).toContain('×3');
    // сервер пишет свои
    bo.serverError(new Error('бот упал'), 'бот', 'nardy');
    await tick();
    expect((await acc.store.errors({ limit: 10 })).map((e) => e.source).sort()).toEqual(['client', 'server']);
    expect(fingerprint({ source: 'client', message: 'a 1', place: 'b' })).toBe(fingerprint({ source: 'client', message: 'a 22', place: 'b' }));
  });

  it('частота ошибок с одного адреса ограничена', async () => {
    const { acc, bo } = setup();
    const c = { ip: '10.9.9.9', ua: 'x', site: '' };
    for (let i = 0; i < 40; i++) await bo.clientError({ message: 'ошибка ' + 'abcdefghijklmnopqrstuvwxyzабвгдежзийклмн'[i], place: 'p' }, c);
    expect((await acc.store.errors({ limit: 100 })).length).toBe(30);
  });

  it('игроки: поиск, права на срок, закрыть и открыть вход', async () => {
    const { acc, bo, ctx } = setup();
    const boss = await user(acc, ctx, 'boss@x.ru', true);
    const vasya = await user(acc, ctx, 'vasya@x.ru');
    expect((await bo.users(q(), ctx(vasya.sid))).code).toBe(403);
    const found = (await bo.users(q('q=vasya'), ctx(boss.sid))).body.users as any[];
    expect(found.map((u) => u.id)).toEqual([vasya.id]);
    expect((await bo.userPost({ id: vasya.id, grant: 'video', days: 30 }, ctx(boss.sid))).code).toBe(200);
    expect((await bo.userPost({ id: vasya.id, grant: 'master' }, ctx(boss.sid))).code).toBe(400);
    let u = ((await bo.users(q('q=' + vasya.id), ctx(boss.sid))).body.users as any[])[0];
    expect(u.rights).toHaveLength(1);
    expect(u.rights[0].right).toBe('video');
    expect(u.rights[0].until - Date.now()).toBeGreaterThan(29 * 86_400_000);
    await bo.userPost({ id: vasya.id, revoke: 'video' }, ctx(boss.sid));
    // закрыть вход — его сессия больше не действует
    expect((await bo.userPost({ id: boss.id, ban: 7 }, ctx(boss.sid))).code).toBe(400);
    expect((await bo.userPost({ id: vasya.id, ban: 7 }, ctx(boss.sid))).code).toBe(200);
    expect(await acc.current(ctx(vasya.sid))).toBeNull();
    u = ((await bo.users(q('q=' + vasya.id), ctx(boss.sid))).body.users as any[])[0];
    expect(u.rights).toHaveLength(0);
    expect(u.bannedUntil).toBeGreaterThan(Date.now());
    await bo.userPost({ id: vasya.id, ban: 0 }, ctx(boss.sid));
    u = ((await bo.users(q('q=' + vasya.id), ctx(boss.sid))).body.users as any[])[0];
    expect(u.bannedUntil).toBeNull();
  });

  it('выход игр: только Мастеру, чистка, сохраняется в настройках', async () => {
    const { acc, ctx } = setup();
    const bo = new Backoffice(acc, () => ({ online: 0, rooms: 0, players: 0 }), () => {}, (g) => ['durak', 'nardy'].includes(g));
    const boss = await user(acc, ctx, 'boss@x.ru', true);
    const vasya = await user(acc, ctx, 'vasya@x.ru');
    expect((await bo.gamePost({ id: 'durak', state: 'hidden' }, ctx(vasya.sid))).code).toBe(403);
    expect((await bo.gamePost({ id: 'нет', state: 'hidden' }, ctx(boss.sid))).code).toBe(400);
    await bo.gamePost({ id: 'durak', state: 'early', new: true, order: '3' }, ctx(boss.sid));
    await bo.gamePost({ id: 'nardy', state: 'чушь', order: 5000 }, ctx(boss.sid));
    expect(bo.release).toEqual({ durak: { state: 'early', new: true, order: 3 } });
    const again = new Backoffice(acc, () => ({ online: 0, rooms: 0, players: 0 }), () => {}, (g) => ['durak', 'nardy'].includes(g));
    await again.loadRelease();
    expect(again.release).toEqual(bo.release);
    // кто может играть (и сервер — при создании сетевой комнаты)
    expect(mayPlay(bo.release, 'durak', [])).toBe(false);
    expect(mayPlay(bo.release, 'durak', [{ right: 'early_access', until: null, group: 'Тестировщики' }])).toBe(true);
    expect(mayPlay(bo.release, 'durak', [{ right: 'early_access', until: 1 }])).toBe(false);
    expect(mayPlay({ nardy: { state: 'hidden' } }, 'nardy', [{ right: 'early_access', until: null }])).toBe(false);
    expect(mayPlay({ nardy: { state: 'hidden' } }, 'nardy', [{ right: 'master', until: null }])).toBe(true);
    expect(mayPlay(bo.release, 'nardy', [])).toBe(true);
    await bo.gamePost({ id: 'durak' }, ctx(boss.sid));
    expect(bo.release).toEqual({});
  });

  it('группы: права группы — у каждого участника, со сроком; убрали из группы — права нет', async () => {
    const { acc, bo, ctx } = setup();
    const boss = await user(acc, ctx, 'boss@x.ru', true);
    const vasya = await user(acc, ctx, 'vasya@x.ru');
    const petya = await user(acc, ctx, 'petya@x.ru');
    expect((await bo.groupPost({ name: 'Тестировщики' }, ctx(vasya.sid))).code).toBe(403);
    const made = await bo.groupPost({ name: 'Тестировщики', note: 'ранний доступ' }, ctx(boss.sid));
    expect(made.code).toBe(200);
    const id = made.body.id as number;
    expect((await bo.groupPost({ name: 'тестировщики' }, ctx(boss.sid))).code).toBe(400);
    expect((await bo.groupPost({ id, grant: 'master' }, ctx(boss.sid))).code).toBe(400);
    expect((await bo.groupPost({ id, add: 'nobody@x.ru' }, ctx(boss.sid))).code).toBe(404);
    await bo.groupPost({ id, add: 'VASYA@x.ru' }, ctx(boss.sid));
    await bo.groupPost({ id, add: String(petya.id) }, ctx(boss.sid));
    const now = Date.now();
    await bo.groupPost({ id, grant: 'early_access', days: 30 }, ctx(boss.sid));
    await bo.groupPost({ id, grant: 'video' }, ctx(boss.sid));
    // личное право дольше группового — остаётся личным
    await acc.store.grant(petya.id, 'video', null, null);
    await acc.store.grant(petya.id, 'early_access', now + 3 * 86_400_000, null);
    const vr = await acc.store.rights(vasya.id, now);
    expect(vr.find((r) => r.right === 'early_access')).toMatchObject({ group: 'Тестировщики' });
    expect(vr.find((r) => r.right === 'early_access')!.until).toBeGreaterThan(now + 29 * 86_400_000);
    const pr = await acc.store.rights(petya.id, now);
    expect(pr.filter((r) => r.right === 'video')).toEqual([{ right: 'video', until: null }]);
    expect(pr.find((r) => r.right === 'early_access')!.group).toBe('Тестировщики');
    // срок вышел
    expect(await acc.store.rights(vasya.id, now + 40 * 86_400_000)).toEqual([{ right: 'video', until: null, group: 'Тестировщики' }]);
    const list = (await bo.groups(ctx(boss.sid))).body as any;
    expect(list.groups).toHaveLength(1);
    expect(list.groups[0]).toMatchObject({ name: 'Тестировщики', members: 2 });
    expect(((await bo.users(q('vasya'), ctx(boss.sid))).body as any).users[0].groups).toEqual([{ id, name: 'Тестировщики' }]);
    await bo.groupPost({ id, remove: vasya.id }, ctx(boss.sid));
    expect(await acc.store.rights(vasya.id, now)).toEqual([]);
    await bo.groupPost({ id, revoke: 'video' }, ctx(boss.sid));
    await bo.groupPost({ id, name: 'Друзья' }, ctx(boss.sid));
    expect((await acc.store.rights(petya.id, now)).find((r) => r.right === 'early_access')!.group).toBe('Друзья');
    await bo.groupPost({ id, del: true }, ctx(boss.sid));
    expect((await bo.groups(ctx(boss.sid))).body.groups).toEqual([]);
    expect((await acc.store.rights(petya.id, now)).map((r) => r.right).sort()).toEqual(['early_access', 'video']);
  });
});
