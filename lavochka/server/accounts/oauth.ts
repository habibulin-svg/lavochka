/* Вход через Яндекс ID и VK ID: переход на сервис входа (код подтверждения + PKCE), обмен кода на токен
 * и данные игрока — только на сервере (токены странице не попадают).
 *   GET /api/auth/<yandex|vk>/start?back=/путь                      → на страницу сервиса
 *   GET /api/auth/<yandex|vk>/callback                              → вход, cookie сессии, назад на back
 * Ошибки — назад на /vhod/?oshibka=<код>. Ключи: YANDEX_CLIENT_ID/SECRET, VK_APP_ID (+ VK_CLIENT_SECRET).
 * Обратные адреса в кабинетах: https://lavochka-games.ru/api/auth/yandex/callback и …/vk/callback. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import type { Accounts, Ctx, ExternalProfile } from './accounts';
import { cookieOf, sessionCookie, siteOf } from './http';

type Fetch = typeof fetch;

export interface Provider {
  id: 'yandex' | 'vk';
  authorizeUrl(o: { state: string; challenge: string; redirect: string }): string;
  /** Обменять код на данные игрока. q — параметры обратного адреса. */
  profile(q: URLSearchParams, o: { verifier: string; redirect: string; state: string }, f: Fetch): Promise<ExternalProfile>;
}

const b64url = (b: Buffer) => b.toString('base64url');
export const challengeOf = (verifier: string) => b64url(createHash('sha256').update(verifier).digest());

async function jsonOf(r: Response, what: string) {
  const t = await r.text();
  let b: any;
  try {
    b = JSON.parse(t);
  } catch {
    throw new Error(`${what}: ответ не JSON (${r.status})`);
  }
  if (!r.ok || b?.error) throw new Error(`${what}: ${r.status} ${b?.error ?? ''} ${b?.error_description ?? ''}`.trim());
  return b;
}

export function yandexProvider(id: string, secret: string): Provider {
  return {
    id: 'yandex',
    authorizeUrl: (o) =>
      'https://oauth.yandex.ru/authorize?' +
      new URLSearchParams({ response_type: 'code', client_id: id, redirect_uri: o.redirect, state: o.state, code_challenge: o.challenge, code_challenge_method: 'S256' }),
    async profile(q, o, f) {
      const code = q.get('code');
      if (!code) throw new Error('yandex: нет кода');
      const tok = await jsonOf(
        await f('https://oauth.yandex.ru/token', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: id, client_secret: secret, code_verifier: o.verifier }),
        }),
        'yandex token'
      );
      const me = await jsonOf(await f('https://login.yandex.ru/info?format=json', { headers: { authorization: 'OAuth ' + tok.access_token } }), 'yandex info');
      if (!me.id) throw new Error('yandex: нет id');
      return {
        provider: 'yandex',
        subject: String(me.id),
        // почта аккаунта Яндекса подтверждена самим Яндексом
        email: me.default_email || null,
        name: me.display_name || me.first_name || me.real_name || me.login || 'Игрок',
      };
    },
  };
}

export function vkProvider(appId: string, secret?: string): Provider {
  return {
    id: 'vk',
    authorizeUrl: (o) => {
      const p = new URLSearchParams({
        response_type: 'code',
        client_id: appId,
        redirect_uri: o.redirect,
        state: o.state,
        code_challenge: o.challenge,
        code_challenge_method: 'S256',
        scope: 'vkid.personal_info email',
      });
      return 'https://id.vk.ru/authorize?' + p;
    },
    async profile(q, o, f) {
      const code = q.get('code');
      const device = q.get('device_id');
      if (!code || !device) throw new Error('vk: нет кода или device_id');
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        code_verifier: o.verifier,
        client_id: appId,
        device_id: device,
        redirect_uri: o.redirect,
        state: o.state,
      });
      if (secret) body.set('client_secret', secret);
      const tok = await jsonOf(await f('https://id.vk.ru/oauth2/auth', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body }), 'vk token');
      const info = await jsonOf(
        await f('https://id.vk.ru/oauth2/user_info', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ client_id: appId, access_token: tok.access_token }),
        }),
        'vk user_info'
      );
      const u = info.user ?? {};
      const subject = String(u.user_id ?? tok.user_id ?? '');
      if (!subject) throw new Error('vk: нет user_id');
      return {
        provider: 'vk',
        subject,
        email: u.email || tok.email || null,
        name: [u.first_name, u.last_name ? u.last_name[0] + '.' : ''].filter(Boolean).join(' ') || 'Игрок',
      };
    },
  };
}

export function providersFromEnv(env = process.env): Provider[] {
  const list: Provider[] = [];
  if (env.YANDEX_CLIENT_ID && env.YANDEX_CLIENT_SECRET) list.push(yandexProvider(env.YANDEX_CLIENT_ID, env.YANDEX_CLIENT_SECRET));
  if (env.VK_APP_ID) list.push(vkProvider(env.VK_APP_ID, env.VK_CLIENT_SECRET || undefined));
  return list;
}

const OA_COOKIE = 'lv_oa';
const TTL = 10 * 60_000;

/** Куда вернуть после входа: только свой путь. */
export const safeBack = (s: string | null) => (s && /^\/(?![/\\])[^\s]*$/.test(s) && s.length < 300 ? s : '/');

export class OAuth {
  private pending = new Map<string, { provider: string; verifier: string; back: string; exp: number }>();

  constructor(
    private acc: Accounts,
    readonly providers: Provider[],
    private f: Fetch = fetch,
    private log: (s: string) => void = () => {}
  ) {}

  get enabled() {
    return this.providers.map((p) => p.id);
  }

  /** Начать вход: адрес сервиса и cookie, связывающая браузер с этим входом. */
  start(provider: string, site: string, back: string | null, now = Date.now()): { location: string; state: string } | null {
    const p = this.providers.find((x) => x.id === provider);
    if (!p) return null;
    for (const [k, v] of this.pending) if (v.exp < now) this.pending.delete(k);
    if (this.pending.size > 5000) this.pending.clear();
    const state = b64url(randomBytes(24));
    const verifier = b64url(randomBytes(48));
    this.pending.set(state, { provider, verifier, back: safeBack(back), exp: now + TTL });
    return { state, location: p.authorizeUrl({ state, challenge: challengeOf(verifier), redirect: `${site}/api/auth/${provider}/callback` }) };
  }

  /** Обратный адрес: куда отправить браузер и какую сессию поставить (sid: undefined — не трогать). */
  async callback(provider: string, q: URLSearchParams, cookieState: string | undefined, ctx: Ctx): Promise<{ location: string; sid?: string | null }> {
    const fail = (code: string) => ({ location: '/vhod/?oshibka=' + code });
    const state = q.get('state') ?? '';
    const pend = this.pending.get(state);
    this.pending.delete(state);
    if (q.get('error')) return fail('otmena');
    if (!pend || pend.provider !== provider || pend.exp < (ctx.now ?? Date.now()) || !cookieState || cookieState !== state) return fail('ustarelo');
    const p = this.providers.find((x) => x.id === provider)!;
    let prof: ExternalProfile;
    try {
      prof = await p.profile(q, { verifier: pend.verifier, redirect: `${ctx.site}/api/auth/${provider}/callback`, state }, this.f);
    } catch (e) {
      this.log(`вход ${provider}: ${(e as Error).message}`);
      return fail('servis');
    }
    const r = await this.acc.externalLogin(prof, ctx);
    if (r.code !== 200) return fail(String(r.body.error ?? 'oshibka'));
    const sep = pend.back.includes('?') ? '&' : '?';
    return { location: pend.back + sep + (r.body.linked ? 'privyazan=' : 'voshel=') + provider, sid: r.sid };
  }
}

/** HTTP: /api/auth/<провайдер>/start|callback; false — не наш адрес. */
export async function oauthApi(oa: OAuth, req: IncomingMessage, res: ServerResponse, url: URL, ip: string): Promise<boolean> {
  const m = url.pathname.match(/^\/api\/auth\/(yandex|vk)\/(start|callback)$/);
  if (!m || req.method !== 'GET') return false;
  const site = siteOf(req);
  const https = site.startsWith('https:');
  const oaCookie = (v: string | null) => `${OA_COOKIE}=${v ?? ''}; Path=/api/auth/; HttpOnly; SameSite=Lax${https ? '; Secure' : ''}; Max-Age=${v ? TTL / 1000 : 0}`;
  const go = (location: string, cookies: string[]) => {
    res.writeHead(302, { location, 'cache-control': 'no-store', 'set-cookie': cookies });
    res.end();
  };
  if (m[2] === 'start') {
    const s = oa.start(m[1], site, url.searchParams.get('back'));
    if (!s) {
      go('/vhod/?oshibka=net-vhoda', []);
      return true;
    }
    go(s.location, [oaCookie(s.state)]);
    return true;
  }
  const ctx: Ctx = { sid: cookieOf(req), ip, ua: String(req.headers['user-agent'] || ''), site };
  const r = await oa.callback(m[1], url.searchParams, cookieOf(req, OA_COOKIE), ctx);
  const cookies = [oaCookie(null)];
  if (r.sid !== undefined) cookies.push(sessionCookie(req, r.sid));
  go(r.location, cookies);
  return true;
}
