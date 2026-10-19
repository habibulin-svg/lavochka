/* /api/auth/* — HTTP-обвязка аккаунтов. Сессия — cookie lv_sid (httpOnly, SameSite=Lax, Secure по https).
 * Защита от подделки запросов с чужих сайтов: только POST с JSON и (если браузер прислал Origin) — со своего адреса;
 * ответы без access-control-allow-origin, так что чужая страница их не прочитает. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Accounts, SESSION_DAYS, type Ctx, type Reply } from './accounts';

export const COOKIE = 'lv_sid';

export function cookieOf(req: IncomingMessage, name = COOKIE): string | undefined {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

const isHttps = (req: IncomingMessage) => String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';

/** Адрес сайта для ссылок в писмах: свой домен (SITE_URL) или тот, на который пришёл запрос. */
export function siteOf(req: IncomingMessage): string {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/+$/, '');
  return `${isHttps(req) ? 'https' : 'http'}://${String(req.headers.host || 'localhost')}`;
}

function setCookie(req: IncomingMessage, sid: string | null): string {
  const base = `${COOKIE}=${sid ?? ''}; Path=/; HttpOnly; SameSite=Lax${isHttps(req) ? '; Secure' : ''}`;
  return sid ? `${base}; Max-Age=${SESSION_DAYS * 86400}` : `${base}; Max-Age=0`;
}

export function send(req: IncomingMessage, res: ServerResponse, r: Reply) {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'cache-control': 'no-store' };
  if (r.sid !== undefined) headers['set-cookie'] = setCookie(req, r.sid);
  res.writeHead(r.code, headers);
  res.end(JSON.stringify(r.body));
}

/** Запрос со своего сайта? (браузер всегда шлёт Origin у POST через fetch) */
export function sameOrigin(req: IncomingMessage): boolean {
  const o = req.headers.origin;
  if (!o) return true;
  try {
    return new URL(o).host === String(req.headers['x-forwarded-host'] || req.headers.host || '');
  } catch {
    return false;
  }
}

/** Обработать /api/auth/<действие>; false — не наш адрес. */
export async function authApi(
  acc: Accounts,
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  ip: string,
  readBody: (req: IncomingMessage, limit?: number) => Promise<string>
): Promise<boolean> {
  const m = path.match(/^\/api\/auth\/([a-z]+)$/);
  if (!m) return false;
  const action = m[1];
  const ctx: Ctx = { sid: cookieOf(req), ip, ua: String(req.headers['user-agent'] || ''), site: siteOf(req) };
  if (action === 'me' && req.method === 'GET') {
    send(req, res, await acc.me(ctx));
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
  const act: Record<string, () => Promise<Reply>> = {
    register: () => acc.register(b, ctx),
    login: () => acc.login(b, ctx),
    logout: () => acc.logout(ctx),
    resend: () => acc.resend(ctx),
    confirm: () => acc.confirm(b, ctx),
    forgot: () => acc.forgot(b, ctx),
    reset: () => acc.reset(b, ctx),
    profile: () => acc.profile(b, ctx),
  };
  const f = act[action];
  send(req, res, f ? await f() : { code: 404, body: { error: 'not found' } });
  return true;
}
