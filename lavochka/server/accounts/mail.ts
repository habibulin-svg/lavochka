/* Письма сайта (подтверждение почты, сброс пароля) — Unisender Go. Без ключа писем нет, и это не ошибка:
 * регистрация и вход работают, только без подтверждения почты.
 *   UNISENDER_API_KEY — ключ; UNISENDER_HOST — сервер API аккаунта (go1/go2.unisender.ru, у нас go2).
 * Тариф бесплатный — 100 писем в сутки, превышение запрещено: держим свой предел чуть ниже (MAIL_DAY_LIMIT). */

export interface Mail {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Отправитель (по умолчанию noreply@); адрес — только на нашем домене (его подтвердил Unisender). */
  from?: { email: string; name: string };
  /** Куда отвечать. */
  replyTo?: string;
  /** Метка для статистики Unisender (по умолчанию account). */
  tag?: string;
}

export interface Mailer {
  readonly enabled: boolean;
  /** true — отправлено; false — не вышло (предел на сутки, сбой сервиса). */
  send(m: Mail): Promise<boolean>;
}

export const MAIL_DAY_LIMIT = Number(process.env.MAIL_DAY_LIMIT) || 90;

/** Счётчик писем за сутки (по московскому дню хватает и UTC). */
class DayCounter {
  private day = -1;
  private n = 0;
  take(limit: number): boolean {
    const d = Math.floor(Date.now() / 86_400_000);
    if (d !== this.day) {
      this.day = d;
      this.n = 0;
    }
    if (this.n >= limit) return false;
    this.n++;
    return true;
  }
}

export class UnisenderMailer implements Mailer {
  readonly enabled = true;
  private count = new DayCounter();
  constructor(
    private key: string,
    private host: string,
    private log: (s: string) => void,
    private from = { email: 'noreply@lavochka-games.ru', name: 'Вечером на лавочке' }
  ) {}

  async send(m: Mail) {
    if (!this.count.take(MAIL_DAY_LIMIT)) {
      this.log('почта: дневной предел исчерпан');
      return false;
    }
    try {
      const r = await fetch(`https://${this.host}/ru/transactional/api/v1/email/send.json`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json', 'x-api-key': this.key },
        body: JSON.stringify({
          message: {
            recipients: [{ email: m.to }],
            subject: m.subject,
            body: { html: m.html, plaintext: m.text },
            from_email: (m.from ?? this.from).email,
            from_name: (m.from ?? this.from).name,
            ...(m.replyTo ? { reply_to: m.replyTo } : {}),
            track_links: 0,
            track_read: 0,
            tags: [m.tag ?? 'account'],
          },
        }),
        signal: AbortSignal.timeout(10_000),
      });
      const b = (await r.json().catch(() => ({}))) as { status?: string; message?: string };
      if (!r.ok || b.status !== 'success') {
        this.log(`почта: ${r.status} ${b.message ?? ''}`);
        return false;
      }
      return true;
    } catch (e) {
      this.log('почта: ' + (e as Error).message);
      return false;
    }
  }
}

/** Почта выключена: письма не уходят. */
export const NO_MAIL: Mailer = { enabled: false, send: async () => false };

/** Для тестов: письма складываются в список. */
export class MemoryMailer implements Mailer {
  readonly enabled = true;
  sent: Mail[] = [];
  fail = false;
  async send(m: Mail) {
    if (this.fail) return false;
    this.sent.push(m);
    return true;
  }
}

export function mailerFromEnv(log: (s: string) => void): Mailer {
  const key = process.env.UNISENDER_API_KEY;
  return key ? new UnisenderMailer(key, process.env.UNISENDER_HOST || 'go2.unisender.ru', log) : NO_MAIL;
}
