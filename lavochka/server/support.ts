/* Обращения: поддержка, ошибки, предложения (src/core/support.ts). Логика без HTTP — класс Support
 * (тесты — tests/support.test.ts), HTTP-обвязка — supportApi:
 *   POST /api/support {kind, subject?, text, email?, name?, context?} — новое обращение с сайта (можно и гостю)
 *   GET  /api/support[?id=N]          — свои обращения / одно с перепиской (вошедшему)
 *   POST /api/support/reply {id, text} — дописать в своё обращение
 *   GET  /api/admin/support[?id=N|status=new] — Мастеру: список / одно
 *   POST /api/admin/support {id, text?, status?} — Мастеру: ответить (уходит письмом от support@) и/или сменить состояние
 *   POST /api/mail/in?to=<адрес>      — письмо от почтового сервера (Postfix на этом же сервере, deploy/mail/):
 *                                       только с 127.0.0.1 и с заголовком x-mail-secret = MAIL_IN_SECRET
 * Письмо с «[№N]» в теме от того же адреса дописывается в обращение N, иначе — новое обращение. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import PostalMime from 'postal-mime';
import { Limiter, normEmail, validEmail, type Accounts, type Ctx, type Reply } from './accounts/accounts';
import { cookieOf, sameOrigin, send, siteOf } from './accounts/http';
import type { Ticket, TicketMsg, User } from './accounts/store';
import {
  SUPPORT_EMAIL,
  SUPPORT_LIMITS as L,
  TICKET_KINDS,
  TICKET_STATUS,
  ticketIdOf,
  ticketTag,
  type TicketBrief,
  type TicketFull,
  type TicketKind,
  type TicketStatus,
} from '../src/core/support';

const err = (code: number, error: string, message: string): Reply => ({ code, body: { error, message } });

/** Одна строка без управляющих символов. */
const line = (s: unknown, max: number) =>
  String(s ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

/** Текст: переводы строк сохраняются, лишние пустые строки — нет. */
const body = (s: unknown, max: number) =>
  String(s ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);

const escHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Адрес домена → вид обращения. noreply@ (и всё, чего нет в списке) — не принимается. */
export const MAILBOXES: Record<string, TicketKind> = {
  support: 'question',
  bugs: 'bug',
  admin: 'other',
  abuse: 'other',
  postmaster: 'other',
  privacy: 'data',
  pay: 'pay',
};

/** Ответ из почтовой программы: отрезать цитату старого письма («> …», «… пишет:», «-----Original Message-----»). */
export function stripQuote(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const cut = lines.findIndex(
    (l, i) =>
      /^-{2,}\s*(Original Message|Исходное сообщение|Пересылаемое сообщение)/i.test(l) ||
      (/(wrote|пишет|написал\(а\)|написал):\s*$/i.test(l) && (lines[i + 1] ?? '').startsWith('>')) ||
      (l.startsWith('>') && lines.slice(i).every((x) => x.startsWith('>') || !x.trim()))
  );
  return (cut < 0 ? lines : lines.slice(0, cut)).join('\n').trim();
}

export class Support {
  private byIp = new Limiter(6, 3600_000);
  private byUser = new Limiter(12, 3600_000);
  private bySender = new Limiter(10, 3600_000);
  private mailDay = new Limiter(300, 86_400_000);
  /** Уведомления Мастеру: Unisender даёт 100 писем в сутки на весь сайт. */
  private notifyDay = new Limiter(25, 86_400_000);
  private replyDay = new Limiter(40, 86_400_000);

  constructor(
    private acc: Accounts,
    private log: (s: string) => void = () => {}
  ) {}

  private async master(ctx: Ctx): Promise<User | null> {
    const u = await this.acc.current(ctx);
    if (!u) return null;
    const rights = await this.acc.store.rights(u.id, ctx.now ?? Date.now());
    return rights.some((r) => r.right === 'master') ? u : null;
  }

  /** Новое обращение с сайта. */
  async create(b: any, ctx: Ctx): Promise<Reply> {
    if (String(b?.website ?? '')) return { code: 200, body: { id: 0 } }; // поле-ловушка для роботов
    const kind = (Object.hasOwn(TICKET_KINDS, b?.kind) ? b.kind : 'other') as TicketKind;
    const text = body(b?.text, L.text);
    if (text.length < 5) return err(400, 'text', 'Напишите чуть подробнее, что случилось.');
    const u = await this.acc.current(ctx);
    const now = ctx.now ?? Date.now();
    if (!this.byIp.take(ctx.ip, now) || (u && !this.byUser.take(String(u.id), now)))
      return err(429, 'often', 'Слишком много обращений подряд. Попробуйте через час — или напишите на ' + SUPPORT_EMAIL + '.');
    let email = b?.email ? normEmail(String(b.email)) : null;
    if (email && (!validEmail(email) || email.length > L.email)) return err(400, 'email', 'Проверьте почту — по ней мы ответим.');
    if (!email && u?.email) email = u.email;
    const name = line(b?.name, L.name) || u?.name || null;
    const subject = line(b?.subject, L.subject) || line(text, 60);
    const ctxLines =
      b?.context && typeof b.context === 'object'
        ? Object.entries(b.context as Record<string, unknown>)
            .slice(0, 20)
            .map(([k, v]) => `${line(k, 30)}: ${line(v, 300)}`)
            .join('\n')
            .slice(0, L.context)
        : null;
    const id = await this.acc.store.createTicket(
      { kind, subject, userId: u?.id ?? null, email, name, context: ctxLines || null, source: 'site' },
      { staff: false, author: name ?? email ?? 'гость', text, at: now }
    );
    this.log(`обращение №${id} с сайта: ${TICKET_KINDS[kind]}`);
    void this.notify(id, ctx.site, now);
    return { code: 200, body: { id, email: !!email } };
  }

  /** Письмо от почтового сервера. to — адрес, на который пришло (support@lavochka-games.ru). */
  async fromMail(raw: Buffer | string, to: string, site: string, now = Date.now()): Promise<{ ok: boolean; why?: string; id?: number }> {
    const box = to.toLowerCase().split('@')[0].split('+')[0];
    const kindOf = MAILBOXES[box];
    if (!kindOf) return { ok: false, why: 'ящик ' + box };
    const m = await PostalMime.parse(raw);
    const from = normEmail(m.from?.address ?? '');
    const auto = (m.headers ?? []).some(
      (h) => (h.key === 'auto-submitted' && !/^no\b/i.test(h.value)) || (h.key === 'precedence' && /bulk|junk|list/i.test(h.value))
    );
    if (!validEmail(from) || /^(mailer-daemon|postmaster|noreply|no-reply)@/i.test(from) || auto) return { ok: false, why: 'автоответ или без адреса' };
    if (!this.mailDay.take('all', now) || !this.bySender.take(from, now)) return { ok: false, why: 'слишком часто: ' + from };
    const subject = line(m.subject, L.subject) || '(без темы)';
    let text = stripQuote(m.text ?? (m.html ?? '').replace(/<br\s*\/?>|<\/p>/gi, '\n').replace(/<[^>]+>/g, ''));
    const files = (m.attachments ?? []).filter((a) => a.filename).map((a) => a.filename);
    if (files.length) text += `\n\n[вложения не сохраняются: ${files.join(', ')}]`;
    text = body(text, L.text) || '(пустое письмо)';
    const name = line(m.from?.name, L.name) || null;
    const msg: TicketMsg = { staff: false, author: name ?? from, text, at: now };
    const tid = ticketIdOf(subject);
    if (tid) {
      const t = await this.acc.store.ticket(tid);
      if (t && t.email && t.email.toLowerCase() === from) {
        await this.acc.store.addTicketMessage(tid, msg, 'new');
        this.log(`обращение №${tid}: ответ письмом`);
        void this.notify(tid, site, now);
        return { ok: true, id: tid };
      }
    }
    const u = await this.acc.store.userByEmail(from);
    const id = await this.acc.store.createTicket(
      { kind: kindOf, subject: subject.replace(/^((re|fwd?|ответ|пересл)\s*:\s*)+/i, '') || subject, userId: u?.id ?? null, email: from, name, context: `письмо на ${box}@`, source: 'mail' },
      msg
    );
    this.log(`обращение №${id} письмом на ${box}@`);
    void this.notify(id, site, now);
    return { ok: true, id };
  }

  /** Короткое письмо Мастерам: «новое обращение» — без лишних подробностей (они в админке). */
  private async notify(id: number, site: string, now: number) {
    try {
      if (!this.acc.mail.enabled || !this.notifyDay.take('n', now)) return;
      const t = await this.acc.store.ticket(id);
      if (!t) return;
      const last = t.messages[t.messages.length - 1];
      const link = `${site}/?obrashenie=${id}`;
      for (const m of await this.acc.store.usersWithRight('master', now)) {
        if (!m.email) continue;
        await this.acc.mail.send({
          to: m.email,
          subject: `${ticketTag(id)} ${TICKET_KINDS[t.kind]}: ${t.subject}`,
          text: `${t.messages.length > 1 ? 'Новое сообщение' : 'Новое обращение'} от ${last.author}.\n\n${last.text.slice(0, 600)}\n\nОтветить: ${link}`,
          html: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5"><p><b>${t.messages.length > 1 ? 'Новое сообщение' : 'Новое обращение'}</b> от ${escHtml(last.author)} · ${escHtml(TICKET_KINDS[t.kind])}</p><p style="white-space:pre-wrap">${escHtml(last.text.slice(0, 600))}</p><p><a href="${link}">Открыть и ответить</a></p></div>`,
          tag: 'support-notify',
        });
      }
    } catch (e) {
      this.log('обращения: уведомление не ушло — ' + (e as Error).message);
    }
  }

  private brief(t: Ticket): TicketBrief {
    return { id: t.id, kind: t.kind, status: t.status, subject: t.subject, from: t.name ?? t.email ?? 'гость', createdAt: t.createdAt, updatedAt: t.updatedAt, source: t.source };
  }

  private full(t: Ticket & { messages: TicketMsg[] }, staff: boolean): TicketFull {
    return { ...this.brief(t), email: staff ? t.email : null, context: staff ? t.context : null, messages: t.messages };
  }

  async mine(q: URLSearchParams, ctx: Ctx): Promise<Reply> {
    const u = await this.acc.current(ctx);
    if (!u) return err(401, 'auth', 'Войдите, чтобы видеть свои обращения.');
    const id = Number(q.get('id'));
    if (id) {
      const t = await this.acc.store.ticket(id);
      if (!t || t.userId !== u.id) return err(404, 'none', 'Нет такого обращения.');
      return { code: 200, body: { ticket: this.full(t, false) } };
    }
    return { code: 200, body: { tickets: (await this.acc.store.tickets({ userId: u.id, limit: 30 })).map((t) => this.brief(t)) } };
  }

  async replyMine(b: any, ctx: Ctx): Promise<Reply> {
    const u = await this.acc.current(ctx);
    if (!u) return err(401, 'auth', 'Войдите заново.');
    const t = await this.acc.store.ticket(Number(b?.id));
    if (!t || t.userId !== u.id) return err(404, 'none', 'Нет такого обращения.');
    const text = body(b?.text, L.text);
    if (!text) return err(400, 'text', 'Пустое сообщение.');
    const now = ctx.now ?? Date.now();
    if (!this.byUser.take(String(u.id), now)) return err(429, 'often', 'Слишком часто. Подождите немного.');
    await this.acc.store.addTicketMessage(t.id, { staff: false, author: u.name, text, at: now }, 'new');
    void this.notify(t.id, ctx.site, now);
    return this.mine(new URLSearchParams({ id: String(t.id) }), ctx);
  }

  async adminGet(q: URLSearchParams, ctx: Ctx): Promise<Reply> {
    if (!(await this.master(ctx))) return err(403, 'master', 'Только для Мастера.');
    const id = Number(q.get('id'));
    if (id) {
      const t = await this.acc.store.ticket(id);
      return t ? { code: 200, body: { ticket: this.full(t, true) } } : err(404, 'none', 'Нет такого обращения.');
    }
    const status = q.get('status');
    const list = await this.acc.store.tickets({ status: Object.hasOwn(TICKET_STATUS, status ?? '') ? (status as TicketStatus) : undefined, limit: 100 });
    return { code: 200, body: { tickets: list.map((t) => this.brief(t)), fresh: await this.acc.store.newTickets(), mail: this.acc.mail.enabled } };
  }

  /** Ответ Мастера: в переписку и письмом автору (если есть почта); status — сменить состояние. */
  async adminPost(b: any, ctx: Ctx): Promise<Reply> {
    const me = await this.master(ctx);
    if (!me) return err(403, 'master', 'Только для Мастера.');
    const t = await this.acc.store.ticket(Number(b?.id));
    if (!t) return err(404, 'none', 'Нет такого обращения.');
    const now = ctx.now ?? Date.now();
    const text = body(b?.text, L.text);
    let mailed: boolean | null = null;
    if (text) {
      const status: TicketStatus = Object.hasOwn(TICKET_STATUS, b?.status) ? b.status : 'open';
      await this.acc.store.addTicketMessage(t.id, { staff: true, author: 'Поддержка', text, at: now }, status);
      if (t.email) {
        mailed = false;
        if (this.acc.mail.enabled && this.replyDay.take('r', now)) {
          const link = `${ctx.site}/?obrashenie=${t.id}`;
          const quote = t.messages[t.messages.length - 1];
          mailed = await this.acc.mail.send({
            to: t.email,
            subject: `Re: ${t.subject} ${ticketTag(t.id)}`,
            from: { email: SUPPORT_EMAIL, name: 'Вечером на лавочке — поддержка' },
            replyTo: SUPPORT_EMAIL,
            tag: 'support',
            text: `${text}\n\n—\nПоддержка «Вечером на лавочке». Ответьте на это письмо — ответ попадёт в то же обращение ${ticketTag(t.id)}.${t.userId ? `\nПереписка на сайте: ${link}` : ''}\n\n${quote.author} писал(а):\n${quote.text
              .split('\n')
              .map((l) => '> ' + l)
              .join('\n')}`,
            html: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#2a2018;max-width:560px"><p style="white-space:pre-wrap">${escHtml(text)}</p><p style="font-size:13px;color:#6b5e50">—<br>Поддержка «Вечером на лавочке». Ответьте на это письмо — ответ попадёт в то же обращение ${ticketTag(t.id)}.${t.userId ? `<br><a href="${link}">Переписка на сайте</a>` : ''}</p><blockquote style="margin:12px 0 0;padding-left:10px;border-left:3px solid #d8ccb8;color:#6b5e50;white-space:pre-wrap">${escHtml(quote.text)}</blockquote></div>`,
          });
          if (!mailed) this.log(`обращение №${t.id}: ответ не ушёл письмом`);
        }
      }
    } else if (Object.hasOwn(TICKET_STATUS, b?.status)) {
      await this.acc.store.setTicketStatus(t.id, b.status, now);
    } else return err(400, 'text', 'Пустой ответ.');
    const r = await this.adminGet(new URLSearchParams({ id: String(t.id) }), ctx);
    r.body.mailed = mailed;
    return r;
  }
}

/** Секрет почтового сервера: сравнение без утечки по времени. */
function secretOk(got: string | undefined): boolean {
  const want = process.env.MAIL_IN_SECRET;
  if (!want || !got) return false;
  const a = Buffer.from(got);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Обработать адреса обращений; false — не наш адрес. */
export async function supportApi(
  sup: Support,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ip: string,
  readBody: (req: IncomingMessage, limit?: number) => Promise<string>,
  readRaw: (req: IncomingMessage, limit: number) => Promise<Buffer>
): Promise<boolean> {
  const path = url.pathname;
  const ctx: Ctx = { sid: cookieOf(req), ip, ua: String(req.headers['user-agent'] || ''), site: siteOf(req) };
  if (path === '/api/mail/in') {
    // сокет — с самого сервера, и не через nginx (у проксированного запроса есть x-forwarded-for)
    const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '') && !req.headers['x-forwarded-for'];
    if (req.method !== 'POST' || !local || !secretOk(req.headers['x-mail-secret'] as string | undefined)) {
      send(req, res, { code: 404, body: { error: 'not found' } });
      return true;
    }
    let r: Awaited<ReturnType<Support['fromMail']>>;
    try {
      // запрос идёт мимо nginx — адрес сайта для ссылок в письмах не из заголовков
      r = await sup.fromMail(await readRaw(req, 15_000_000), url.searchParams.get('to') ?? '', (process.env.SITE_URL || 'https://lavochka-games.ru').replace(/\/+$/, ''));
    } catch (e) {
      // 500 — почтовый сервер попробует ещё раз позже
      send(req, res, { code: 500, body: { error: (e as Error).message } });
      return true;
    }
    send(req, res, { code: 200, body: r });
    return true;
  }
  const admin = path === '/api/admin/support';
  if (path !== '/api/support' && path !== '/api/support/reply' && !admin) return false;
  if (req.method === 'GET') {
    send(req, res, admin ? await sup.adminGet(url.searchParams, ctx) : await sup.mine(url.searchParams, ctx));
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
    b = JSON.parse((await readBody(req, 32_768)) || '{}');
  } catch {
    send(req, res, { code: 400, body: { error: 'bad body' } });
    return true;
  }
  send(req, res, admin ? await sup.adminPost(b, ctx) : path === '/api/support' ? await sup.create(b, ctx) : await sup.replyMine(b, ctx));
  return true;
}
