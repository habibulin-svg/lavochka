/* Аккаунты: регистрация, вход, сессии, подтверждение почты, сброс пароля, права.
 * Без HTTP: методы получают разобранный запрос и «контекст» (cookie-сессия, адрес, браузер) и отвечают
 * кодом, телом и, если надо, новой сессией для cookie. HTTP-обвязка — http.ts, тесты — tests/accounts.test.ts. */
import { RIGHTS, type RightGrant } from '../../src/core/rights';
import { checkPassword, checkTotp, hashPassword, newToken, tokenHash } from './crypto';
import type { Mailer } from './mail';
import type { AccountStore, User } from './store';

export const SESSION_DAYS = 90;
const DAY = 86_400_000;
const VERIFY_TTL = 3 * DAY;
const RESET_TTL = 2 * 3600_000;

export interface Ctx {
  /** Токен сессии из cookie. */
  sid?: string;
  ip: string;
  ua: string;
  /** Адрес сайта для ссылок в письмах: https://lavochka-games.ru */
  site: string;
  now?: number;
}

export interface Reply {
  code: number;
  body: Record<string, unknown>;
  /** Новая сессия (строка) — поставить cookie; null — стереть. */
  sid?: string | null;
}

export interface PublicUser {
  id: number;
  name: string;
  email: string | null;
  verified: boolean;
  rights: RightGrant[];
  /** Привязанные входы: yandex, vk. */
  providers: string[];
  /** Есть ли пароль (вход только через Яндекс/VK — нет). */
  password: boolean;
}

/** Кто пришёл через Яндекс ID / VK ID (после обмена кода на сервере). */
export interface ExternalProfile {
  provider: 'yandex' | 'vk';
  subject: string;
  /** Почта, подтверждённая сервисом входа (иначе null). */
  email: string | null;
  name: string;
}

/** Ограничитель частоты: не больше max событий на ключ за окно. */
export class Limiter {
  private hits = new Map<string, number[]>();
  constructor(
    private max: number,
    private windowMs: number
  ) {}
  /** Можно ли ещё (и засчитать попытку). */
  take(key: string, now = Date.now()): boolean {
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (list.length >= this.max) {
      this.hits.set(key, list);
      return false;
    }
    list.push(now);
    this.hits.set(key, list);
    if (this.hits.size > 50_000) this.hits.clear();
    return true;
  }
  /** Сколько уже засчитано за окно. */
  count(key: string, now = Date.now()) {
    return (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs).length;
  }
  reset(key: string) {
    this.hits.delete(key);
  }
}

const EMAIL_RE = /^[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[^\s@<>()"',;:]{2,}$/;
export const normEmail = (s: unknown) => String(s ?? '').trim().toLowerCase();
export const validEmail = (e: string) => e.length <= 120 && EMAIL_RE.test(e);
export const validPassword = (p: unknown): p is string => typeof p === 'string' && p.length >= 8 && p.length <= 200;

/** Имя игрока: без управляющих символов и лишних пробелов, 2–24 знака. */
export function cleanName(s: unknown): string | null {
  const n = String(s ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return n.length >= 2 && n.length <= 24 ? n : null;
}

const err = (code: number, error: string, message: string): Reply => ({ code, body: { error, message } });

export class Accounts {
  private loginByIp = new Limiter(30, 15 * 60_000);
  private loginByEmail = new Limiter(10, 15 * 60_000);
  private registerByIp = new Limiter(6, 3600_000);
  private mailBurst = new Limiter(1, 90_000);
  private mailDay = new Limiter(5, DAY);
  private mailByIp = new Limiter(15, DAY);

  /** Какие внешние входы включены (ставит сервер по ключам: yandex, vk). */
  loginWith: string[] = [];

  constructor(
    readonly store: AccountStore,
    private mail: Mailer,
    private log: (s: string) => void = () => {}
  ) {}

  async publicUser(u: User, now = Date.now()): Promise<PublicUser> {
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      verified: u.emailVerified,
      rights: await this.store.rights(u.id, now),
      providers: await this.store.externalOf(u.id),
      password: !!u.passwordHash,
    };
  }

  /** Пользователь по cookie. */
  async current(ctx: Ctx): Promise<User | null> {
    if (!ctx.sid || ctx.sid.length > 100) return null;
    const u = await this.store.sessionUser(tokenHash(ctx.sid), ctx.now ?? Date.now());
    if (!u || (u.bannedUntil && u.bannedUntil > (ctx.now ?? Date.now()))) return null;
    return u;
  }

  private async openSession(u: User, ctx: Ctx): Promise<string> {
    const now = ctx.now ?? Date.now();
    const sid = newToken();
    await this.store.createSession(tokenHash(sid), u.id, now + SESSION_DAYS * DAY, ctx.ip, ctx.ua);
    await this.store.updateUser(u.id, { lastLoginAt: now });
    return sid;
  }

  async me(ctx: Ctx): Promise<Reply> {
    const u = await this.current(ctx);
    return { code: 200, body: { user: u ? await this.publicUser(u, ctx.now) : null, mail: this.mail.enabled, loginWith: this.loginWith } };
  }

  async register(b: any, ctx: Ctx): Promise<Reply> {
    const email = normEmail(b?.email);
    if (!validEmail(email)) return err(400, 'email', 'Проверьте адрес почты.');
    if (!validPassword(b?.password)) return err(400, 'password', 'Пароль — от 8 знаков.');
    if (b?.consent !== true) return err(400, 'consent', 'Нужно согласие с политикой конфиденциальности.');
    const name = b?.name ? cleanName(b.name) : cleanName(email.split('@')[0]) ?? 'Игрок';
    if (!name) return err(400, 'name', 'Имя — от 2 до 24 знаков.');
    if (!this.registerByIp.take(ctx.ip, ctx.now)) return err(429, 'often', 'Слишком много регистраций с этого адреса. Попробуйте через час.');
    if (await this.store.userByEmail(email)) return err(409, 'exists', 'Эта почта уже зарегистрирована. Войдите или восстановите пароль.');
    let u: User;
    try {
      u = await this.store.createUser({ email, name, passwordHash: await hashPassword(b.password) });
    } catch (e: any) {
      if (e?.code === 'exists') return err(409, 'exists', 'Эта почта уже зарегистрирована. Войдите или восстановите пароль.');
      throw e;
    }
    this.log(`аккаунт: новый игрок #${u.id}`);
    const sid = await this.openSession(u, ctx);
    const sent = await this.sendVerify(u, ctx);
    return { code: 200, body: { user: await this.publicUser(u, ctx.now), mailSent: sent }, sid };
  }

  async login(b: any, ctx: Ctx): Promise<Reply> {
    const email = normEmail(b?.email);
    const pw = typeof b?.password === 'string' ? b.password : '';
    if (!validEmail(email) || !pw) return err(400, 'bad', 'Введите почту и пароль.');
    const now = ctx.now ?? Date.now();
    if (this.loginByIp.count(ctx.ip, now) >= 30 || this.loginByEmail.count(email, now) >= 10)
      return err(429, 'often', 'Слишком много попыток входа. Подождите 15 минут.');
    const u = await this.store.userByEmail(email);
    const ok = u ? await checkPassword(pw, u.passwordHash) : (await hashPassword(pw), false);
    if (!u || !ok) {
      this.loginByIp.take(ctx.ip, now);
      this.loginByEmail.take(email, now);
      return err(401, 'wrong', 'Неверная почта или пароль.');
    }
    if (u.bannedUntil && u.bannedUntil > now) return err(403, 'banned', 'Вход закрыт до ' + new Date(u.bannedUntil).toLocaleDateString('ru-RU') + '.');
    // второй фактор — у Мастера (и у всех, кто его включил)
    const rights = await this.store.rights(u.id, now);
    const needTotp = !!u.totpSecret || rights.some((r) => r.right === 'master');
    if (needTotp) {
      const code = String(b?.totp ?? '').replace(/\s/g, '');
      if (!code) return { code: 200, body: { need: 'totp' } };
      if (!checkTotp(u.totpSecret, code, now)) {
        this.loginByIp.take(ctx.ip, now);
        this.loginByEmail.take(email, now);
        return err(401, 'totp', 'Неверный код из приложения.');
      }
    }
    this.loginByEmail.reset(email);
    const sid = await this.openSession(u, ctx);
    return { code: 200, body: { user: await this.publicUser(u, now) }, sid };
  }

  async logout(ctx: Ctx): Promise<Reply> {
    if (ctx.sid) await this.store.deleteSession(tokenHash(ctx.sid));
    return { code: 200, body: { ok: true }, sid: null };
  }

  /** Письмо со ссылкой подтверждения; false — не ушло (почта выключена, предел, сбой). */
  private async sendVerify(u: User, ctx: Ctx): Promise<boolean> {
    if (!this.mail.enabled || !u.email || u.emailVerified) return false;
    if (!this.mailBurst.take('v' + u.id, ctx.now) || !this.mailDay.take('v' + u.id, ctx.now) || !this.mailByIp.take(ctx.ip, ctx.now)) return false;
    const t = newToken();
    await this.store.createToken(tokenHash(t), u.id, 'verify', (ctx.now ?? Date.now()) + VERIFY_TTL);
    const link = `${ctx.site}/vhod/?podtverdit=${t}`;
    return this.mail.send({
      to: u.email,
      subject: 'Подтвердите почту — Вечером на лавочке',
      text: `Здравствуйте, ${u.name}!\n\nЧтобы подтвердить почту на сайте «Вечером на лавочке», откройте ссылку:\n${link}\n\nСсылка действует трое суток. Если вы не регистрировались — просто не отвечайте на это письмо.`,
      html: letter(u.name, 'Чтобы подтвердить почту на сайте «Вечером на лавочке», нажмите кнопку:', link, 'Подтвердить почту', 'Ссылка действует трое суток. Если вы не регистрировались — просто не отвечайте на это письмо.'),
    });
  }

  async resend(ctx: Ctx): Promise<Reply> {
    const u = await this.current(ctx);
    if (!u) return err(401, 'auth', 'Войдите заново.');
    if (u.emailVerified) return { code: 200, body: { ok: true, verified: true } };
    if (!this.mail.enabled) return err(503, 'nomail', 'Письма сайта пока не отправляются. Играть это не мешает.');
    const sent = await this.sendVerify(u, ctx);
    return sent ? { code: 200, body: { ok: true } } : err(429, 'often', 'Письмо уже отправлено недавно или почта перегружена. Попробуйте позже.');
  }

  async confirm(b: any, ctx: Ctx): Promise<Reply> {
    const t = String(b?.token ?? '');
    const id = t.length < 100 ? await this.store.useToken(tokenHash(t), 'verify', ctx.now ?? Date.now()) : null;
    if (id == null) return err(400, 'token', 'Ссылка устарела или уже использована.');
    await this.store.updateUser(id, { emailVerified: true });
    const u = await this.current(ctx);
    return { code: 200, body: { ok: true, user: u ? await this.publicUser(u, ctx.now) : null } };
  }

  /** «Забыл пароль»: ответ всегда одинаковый — чтобы по нему нельзя было проверить, есть ли такая почта. */
  async forgot(b: any, ctx: Ctx): Promise<Reply> {
    const email = normEmail(b?.email);
    if (!validEmail(email)) return err(400, 'email', 'Проверьте адрес почты.');
    if (!this.mail.enabled) return err(503, 'nomail', 'Письма сайта пока не отправляются — восстановить пароль сейчас нельзя.');
    const u = await this.store.userByEmail(email);
    if (u && this.mailBurst.take('r' + u.id, ctx.now) && this.mailDay.take('r' + u.id, ctx.now) && this.mailByIp.take(ctx.ip, ctx.now)) {
      const t = newToken();
      await this.store.createToken(tokenHash(t), u.id, 'reset', (ctx.now ?? Date.now()) + RESET_TTL);
      const link = `${ctx.site}/vhod/?sbros=${t}`;
      await this.mail.send({
        to: email,
        subject: 'Новый пароль — Вечером на лавочке',
        text: `Здравствуйте, ${u.name}!\n\nЧтобы задать новый пароль, откройте ссылку:\n${link}\n\nСсылка действует два часа. Если вы не просили сменить пароль — ничего не делайте, старый пароль остаётся.`,
        html: letter(u.name, 'Чтобы задать новый пароль на сайте «Вечером на лавочке», нажмите кнопку:', link, 'Задать новый пароль', 'Ссылка действует два часа. Если вы не просили сменить пароль — ничего не делайте, старый пароль остаётся.'),
      });
    }
    return { code: 200, body: { ok: true } };
  }

  async reset(b: any, ctx: Ctx): Promise<Reply> {
    if (!validPassword(b?.password)) return err(400, 'password', 'Пароль — от 8 знаков.');
    const t = String(b?.token ?? '');
    const id = t.length < 100 ? await this.store.useToken(tokenHash(t), 'reset', ctx.now ?? Date.now()) : null;
    if (id == null) return err(400, 'token', 'Ссылка устарела или уже использована. Запросите новую.');
    // ссылка пришла на почту — значит, почта настоящая
    await this.store.updateUser(id, { passwordHash: await hashPassword(b.password), emailVerified: true });
    await this.store.deleteUserSessions(id);
    const u = (await this.store.userById(id))!;
    // Мастер после сброса входит заново, с кодом из приложения
    const rights = await this.store.rights(id, ctx.now ?? Date.now());
    if (u.totpSecret || rights.some((r) => r.right === 'master')) return { code: 200, body: { ok: true, relogin: true } };
    const sid = await this.openSession(u, ctx);
    return { code: 200, body: { ok: true, user: await this.publicUser(u, ctx.now) }, sid };
  }

  async profile(b: any, ctx: Ctx): Promise<Reply> {
    const u = await this.current(ctx);
    if (!u) return err(401, 'auth', 'Войдите заново.');
    const name = cleanName(b?.name);
    if (!name) return err(400, 'name', 'Имя — от 2 до 24 знаков.');
    await this.store.updateUser(u.id, { name });
    return { code: 200, body: { user: await this.publicUser({ ...u, name }, ctx.now) } };
  }

  /** Вход через Яндекс ID / VK ID. Уже вошедшему — привязать вход к его аккаунту.
   * Аккаунт ищется по привязке, затем по почте (сервис входа её подтвердил — значит, почта настоящая: неподтверждённый
   * аккаунт с той же почтой забираем себе, сбросив чужой пароль и сессии). Мастеру этот вход закрыт: только пароль и код. */
  async externalLogin(p: ExternalProfile, ctx: Ctx): Promise<Reply> {
    const now = ctx.now ?? Date.now();
    const isMaster = async (u: User) => !!u.totpSecret || (await this.store.rights(u.id, now)).some((r) => r.right === 'master');
    const masterErr = err(403, 'master', 'Мастер входит только по почте, паролю и коду из приложения.');
    const email = p.email && validEmail(normEmail(p.email)) ? normEmail(p.email) : null;
    const linked = await this.store.userByExternal(p.provider, p.subject);
    const cur = await this.current(ctx);
    if (cur) {
      // привязка к своему аккаунту из профиля
      if (linked && linked.id !== cur.id) return err(409, 'linked', 'Этот вход уже привязан к другому аккаунту.');
      await this.store.linkExternal(p.provider, p.subject, cur.id, email);
      return { code: 200, body: { user: await this.publicUser(cur, now), linked: true } };
    }
    let u = linked;
    if (!u && email) {
      const same = await this.store.userByEmail(email);
      if (same) {
        if (await isMaster(same)) return masterErr;
        if (!same.emailVerified) {
          await this.store.updateUser(same.id, { passwordHash: null, emailVerified: true });
          await this.store.deleteUserSessions(same.id);
          this.log(`аккаунт #${same.id}: почту подтвердил вход ${p.provider}, прежний пароль сброшен`);
        }
        u = (await this.store.userById(same.id))!;
      }
    }
    if (!u) {
      if (!this.registerByIp.take(ctx.ip, ctx.now)) return err(429, 'often', 'Слишком много регистраций с этого адреса. Попробуйте через час.');
      u = await this.store.createUser({ email, name: cleanName(p.name) ?? 'Игрок', passwordHash: null, emailVerified: !!email });
      this.log(`аккаунт: новый игрок #${u.id} через ${p.provider}`);
    }
    if (await isMaster(u)) return masterErr;
    if (u.bannedUntil && u.bannedUntil > now) return err(403, 'banned', 'Вход закрыт до ' + new Date(u.bannedUntil).toLocaleDateString('ru-RU') + '.');
    await this.store.linkExternal(p.provider, p.subject, u.id, email);
    const sid = await this.openSession(u, ctx);
    return { code: 200, body: { user: await this.publicUser(u, now), created: !linked }, sid };
  }

  /** Отвязать вход; последний способ войти отвязать нельзя. */
  async unlink(b: any, ctx: Ctx): Promise<Reply> {
    const u = await this.current(ctx);
    if (!u) return err(401, 'auth', 'Войдите заново.');
    const provider = String(b?.provider ?? '');
    const have = await this.store.externalOf(u.id);
    if (!have.includes(provider)) return err(400, 'provider', 'Этот вход не привязан.');
    if (have.length === 1 && !u.passwordHash) return err(400, 'last', 'Это единственный способ войти. Сначала задайте пароль через «Забыли пароль?».');
    await this.store.unlinkExternal(provider, u.id);
    return { code: 200, body: { user: await this.publicUser(u, ctx.now) } };
  }

  /** Выдать право на срок (дней; 0/undefined — бессрочно). Для админки и команды на сервере. */
  async grant(userId: number, right: string, days: number | undefined, by: number | null, now = Date.now()) {
    if (!Object.hasOwn(RIGHTS, right)) throw new Error('нет такого права: ' + right);
    await this.store.grant(userId, right, days ? now + days * DAY : null, by);
  }
}

const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Простое письмо: обращение, текст, кнопка-ссылка, приписка. */
function letter(name: string, lead: string, link: string, button: string, note: string): string {
  return `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#2a2018;max-width:520px">
<p style="font-size:20px;font-weight:bold;color:#6a3b12">Вечером на лавочке</p>
<p>Здравствуйте, ${escHtml(name)}!</p>
<p>${lead}</p>
<p><a href="${link}" style="display:inline-block;padding:10px 18px;background:#b5482a;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold">${button}</a></p>
<p style="font-size:13px;color:#6b5e50">Если кнопка не нажимается, скопируйте адрес в браузер:<br>${link}</p>
<p style="font-size:13px;color:#6b5e50">${note}</p>
</div>`;
}
