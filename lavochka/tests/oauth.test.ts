// Вход через Яндекс ID и VK ID без сети: подставные ответы сервисов, проверка state, слияние по почте, Мастер, привязка.
import { describe, expect, it } from 'vitest';
import { Accounts } from '../server/accounts/accounts';
import { MemoryMailer } from '../server/accounts/mail';
import { MemoryAccountStore } from '../server/accounts/store';
import { OAuth, challengeOf, safeBack, vkProvider, yandexProvider } from '../server/accounts/oauth';

const site = 'https://lavochka-games.ru';
let ipN = 0;
const ctx = (sid?: string) => ({ sid, ip: '10.2.0.' + ++ipN, ua: 'test', site });

/** Подставной fetch: Яндекс отдаёт игрока ya, VK — vkUser. */
function fakeFetch(ya: object, vkUser: object) {
  const calls: { url: string; body?: string }[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? String(init.body) : undefined });
    const ok = (b: object) => new Response(JSON.stringify(b), { status: 200 });
    if (url.startsWith('https://oauth.yandex.ru/token')) return ok({ access_token: 'ya-token', token_type: 'bearer' });
    if (url.startsWith('https://login.yandex.ru/info')) return ok(ya);
    if (url === 'https://id.vk.ru/oauth2/auth') return ok({ access_token: 'vk-token', user_id: 77 });
    if (url === 'https://id.vk.ru/oauth2/user_info') return ok({ user: vkUser });
    return new Response('{}', { status: 404 });
  }) as unknown as typeof fetch;
  return { f, calls };
}

function setup(ya: object = { id: '1001', default_email: 'Petya@yandex.ru', display_name: 'Петя' }, vk: object = { user_id: 77, first_name: 'Вася', last_name: 'Пупкин' }) {
  const acc = new Accounts(new MemoryAccountStore(), new MemoryMailer());
  const { f, calls } = fakeFetch(ya, vk);
  const oa = new OAuth(acc, [yandexProvider('ya-id', 'ya-secret'), vkProvider('54834822')], f);
  /** Пройти вход целиком: start → callback с тем же state (и cookie). */
  const login = async (p: 'yandex' | 'vk', sid?: string, extra: Record<string, string> = {}) => {
    const s = oa.start(p, site, '/nardy/')!;
    const q = new URLSearchParams({ code: 'c0de', state: s.state, ...(p === 'vk' ? { device_id: 'dev1' } : {}), ...extra });
    return { start: s, res: await oa.callback(p, q, s.state, ctx(sid)) };
  };
  return { acc, oa, calls, login };
}

describe('вход через сервисы', () => {
  it('адрес Яндекса: PKCE S256, свой обратный адрес; назад — только свой путь', () => {
    const { oa } = setup();
    const s = oa.start('yandex', site, '//evil.ru')!;
    const u = new URL(s.location);
    expect(u.origin + u.pathname).toBe('https://oauth.yandex.ru/authorize');
    expect(u.searchParams.get('redirect_uri')).toBe(site + '/api/auth/yandex/callback');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('state')).toBe(s.state);
    expect(safeBack('//evil.ru')).toBe('/');
    expect(safeBack('/nardy/?igra')).toBe('/nardy/?igra');
    expect(challengeOf('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    expect(oa.start('nope', site, '/')).toBeNull();
  });

  it('Яндекс: новый игрок с подтверждённой почтой, второй вход — тот же аккаунт', async () => {
    const { login, acc, calls } = setup();
    const a = await login('yandex');
    expect(a.res.location).toBe('/nardy/?voshel=yandex');
    expect(typeof a.res.sid).toBe('string');
    const u = (await acc.store.userByEmail('petya@yandex.ru'))!;
    expect(u).toMatchObject({ name: 'Петя', emailVerified: true, passwordHash: null });
    expect(calls.find((c) => c.url.includes('oauth.yandex.ru/token'))!.body).toContain('code_verifier=');
    const b = await login('yandex');
    expect((await acc.current(ctx(b.res.sid as string)))!.id).toBe(u.id);
  });

  it('чужой или устаревший state, отмена на стороне сервиса — без входа', async () => {
    const { oa } = setup();
    const s = oa.start('yandex', site, '/')!;
    expect((await oa.callback('yandex', new URLSearchParams({ code: 'x', state: s.state }), 'другой', ctx())).location).toBe('/vhod/?oshibka=ustarelo');
    // state одноразовый
    expect((await oa.callback('yandex', new URLSearchParams({ code: 'x', state: s.state }), s.state, ctx())).location).toBe('/vhod/?oshibka=ustarelo');
    const s2 = oa.start('yandex', site, '/')!;
    expect((await oa.callback('yandex', new URLSearchParams({ error: 'access_denied', state: s2.state }), s2.state, ctx())).sid).toBeUndefined();
  });

  it('та же почта: подтверждённый аккаунт — общий; неподтверждённый — чужой пароль сброшен', async () => {
    const { login, acc } = setup();
    const r = await acc.register({ email: 'petya@yandex.ru', password: 'захватчик-пароль', consent: true }, ctx());
    const id = (r.body.user as any).id;
    const a = await login('yandex');
    expect((await acc.current(ctx(a.res.sid as string)))!.id).toBe(id);
    const u = (await acc.store.userById(id))!;
    expect(u.passwordHash).toBeNull();
    expect(u.emailVerified).toBe(true);
    // прежняя сессия захватчика закрыта
    expect(await acc.current(ctx(r.sid as string))).toBeNull();
  });

  it('Мастеру вход через сервис закрыт', async () => {
    const { login, acc } = setup();
    const r = await acc.register({ email: 'petya@yandex.ru', password: 'пароль-мастера', consent: true }, ctx());
    await acc.store.updateUser((r.body.user as any).id, { emailVerified: true });
    await acc.store.grant((r.body.user as any).id, 'master', null, null);
    const a = await login('yandex');
    expect(a.res.location).toBe('/vhod/?oshibka=master');
    expect(a.res.sid).toBeUndefined();
  });

  it('VK без почты: новый игрок «Вася П.»; привязка Яндекса из профиля и отвязка', async () => {
    const { login, acc } = setup();
    const v = await login('vk');
    const sid = v.res.sid as string;
    const u = (await acc.current(ctx(sid)))!;
    expect(u).toMatchObject({ name: 'Вася П.', email: null });
    // уже вошёл — Яндекс привязывается к этому же аккаунту
    const y = await login('yandex', sid);
    expect(y.res.location).toBe('/nardy/?privyazan=yandex');
    expect(await acc.store.externalOf(u.id)).toEqual(['vk', 'yandex']);
    expect((await acc.unlink({ provider: 'vk' }, ctx(sid))).code).toBe(200);
    // последний вход без пароля не отвязать
    expect((await acc.unlink({ provider: 'yandex' }, ctx(sid))).code).toBe(400);
    const me = await acc.me(ctx(sid));
    expect((me.body.user as any).providers).toEqual(['yandex']);
  });

  it('VK: обмен с device_id и code_verifier', async () => {
    const { login, calls } = setup();
    await login('vk');
    const body = new URLSearchParams(calls.find((c) => c.url === 'https://id.vk.ru/oauth2/auth')!.body);
    expect(body.get('device_id')).toBe('dev1');
    expect(body.get('code_verifier')!.length).toBeGreaterThanOrEqual(43);
    expect(body.get('grant_type')).toBe('authorization_code');
  });
});

describe('аватар', () => {
  it('фото из Яндекса — сразу аватаром; выбор значка; чужое и несуществующее — отказ', async () => {
    const { login, acc } = setup({ id: '5', default_email: 'ava@yandex.ru', display_name: 'Ава', default_avatar_id: '12/abc', is_avatar_empty: false });
    const sid = (await login('yandex')).res.sid as string;
    const me = async () => (await acc.me(ctx(sid))).body.user as any;
    expect(await me()).toMatchObject({ avatar: 'https://avatars.yandex.net/get-yapic/12/abc/islands-200', photo: true });
    expect((await acc.profile({ avatar: '🦊' }, ctx(sid))).code).toBe(200);
    expect((await me()).avatar).toBe('🦊');
    expect((await acc.profile({ avatar: '<img>' }, ctx(sid))).code).toBe(400);
    expect((await acc.profile({ avatar: 'photo' }, ctx(sid))).code).toBe(200);
    expect((await me()).avatar).toMatch(/^https:\/\/avatars\.yandex\.net\//);
    // игрок без фото не может выбрать «фото»
    const r = await acc.register({ email: 'plain@x.ru', password: 'пароль-игрока', consent: true }, ctx());
    expect((await acc.profile({ avatar: 'photo' }, ctx(r.sid as string))).code).toBe(400);
    expect(((await acc.me(ctx(r.sid as string))).body.user as any).avatar).toBeNull();
  });
});
