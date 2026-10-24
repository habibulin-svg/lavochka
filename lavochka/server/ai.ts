/* Помощники на ИИ (подписка «Лавочка+», право `ai`): Михалыч в шахматах (server/mihalych.ts), Димон в покере
 * (server/dimon.ts), Светка в гадании (server/svetka.ts). Общее у них здесь: вызов модели через шлюз routerai.ru (OpenAI-совместимый, ключ ROUTERAI_API_KEY),
 * учёт расхода (таблица ai_usage — по помощникам), права и лимиты.
 *   Лимит на пользователя — ОДИН на всех помощников (сумма по Михалычу и Димону) за оплаченный месяц подписки (без
 *   подписки, по праву от Мастера, — календарный месяц МСК); общий потолок сайта — тоже один, по календарному месяцу.
 *   Безлимит — право `ai_unlimited` (и Мастер). Частые вопросы притормаживаются тоже общим счётчиком.
 * У каждого помощника свои слова отказов (HelperWords): кончился лимит — Михалыч «в запое», Димон «проигрался в ноль». */
import { hasRight } from '../src/core/rights';
import { plusPeriod } from '../src/core/plus';
import { Limiter, type Accounts, type Ctx, type Reply } from './accounts/accounts';

export type HelperId = 'mihalych' | 'dimon' | 'svetka';
export const HELPERS: HelperId[] = ['mihalych', 'dimon', 'svetka'];

export const AI_MODEL = '~deepseek/deepseek-v4-flash-latest';
const API = 'https://routerai.ru/api/v1/chat/completions';
/** Цены шлюза, ₽ за миллион токенов — если в ответе нет usage.cost. */
const PRICE = { in: 10, out: 21, cached: 2.13 };
export const MICRO = 1_000_000;

export type Msg = { role: 'system' | 'user' | 'assistant'; content: string };

/** Месяц учёта по Москве: 'ГГГГ-ММ'. */
export const monthOf = (now: number) => new Date(now + 3 * 3600_000).toISOString().slice(0, 7);
/** Первое число следующего месяца словами: «1 ноября». */
export function backOn(now: number): string {
  const d = new Date(now + 3 * 3600_000);
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 12));
  return next.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' });
}
/** Дата словами: «22 ноября». */
const dayWords = (t: number) => new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', timeZone: 'Europe/Moscow' });

export const cut = (v: unknown, n: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b-\u001f]/g, ' ').trim().slice(0, n) : '');
/** Ответ модели — без разметки. */
export const plain = (s: string) => s.replace(/\*\*?|__|^#+\s*/gm, '').trim();

/** Свои слова помощника на отказы. */
export interface HelperWords {
  id: HelperId;
  /** Для журнала сервера: «михалыч». */
  tag: string;
  login: string;
  plus: string;
  off: string;
  often: string;
  /** Кончился личный запас; back — когда обновится, словами. */
  zapoy: (back: string) => string;
  /** Кончился общий потолок сайта; back — 1-е число словами. */
  sick: (back: string) => string;
  silent: string;
  mumble: string;
}

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export interface AiConf {
  key: string | null;
  model?: string;
  /** Лимит на пользователя в месяц на всех помощников, ₽. */
  userRub?: number;
  /** Общий лимит сайта в месяц, ₽. */
  siteRub?: number;
}

export const err = (code: number, error: string, message: string, extra: Record<string, unknown> = {}): Reply => ({ code, body: { error, message, ...extra } });

/** Кто спрашивает: пользователь, безлимит, учётный период (key) и когда он обновится (back). */
export interface Who {
  user: { id: number };
  unlimited: boolean;
  now: number;
  key: string;
  back: string;
}

export class AiDesk {
  private perUser = new Limiter(60, 3600_000);
  private perMinute = new Limiter(6, 60_000);
  readonly model: string;
  readonly userMicro: number;
  readonly siteMicro: number;

  constructor(
    readonly acc: Accounts,
    private conf: AiConf,
    readonly log: (s: string) => void = () => {},
    private http: Fetch = fetch
  ) {
    this.model = conf.model || AI_MODEL;
    this.userMicro = (conf.userRub ?? 30) * MICRO;
    this.siteMicro = (conf.siteRub ?? 3000) * MICRO;
  }

  get enabled() {
    return !!this.conf.key;
  }

  /** Кто спрашивает и можно ли: пользователь, безлимит ли, учётный период — или ответ-отказ. */
  async who(ctx: Ctx, words: HelperWords): Promise<Who | { deny: Reply }> {
    const u = await this.acc.current(ctx);
    if (!u) return { deny: err(401, 'login', words.login) };
    const now = ctx.now ?? Date.now();
    const rights = await this.acc.store.rights(u.id, now);
    if (!hasRight(rights, 'ai', now)) return { deny: err(403, 'plus', words.plus) };
    const { key, back } = await this.period(u.id, now);
    return { user: u, unlimited: hasRight(rights, 'ai_unlimited', now), now, key, back };
  }

  /** Учётный период: оплаченный месяц подписки (ключ «p<день начала>»); без подписки (право от Мастера) —
   * календарный месяц. Общий потолок сайта всегда считается по календарному месяцу (monthOf). */
  private async period(userId: number, now: number): Promise<{ key: string; back: string }> {
    const s = await this.acc.store.subscription(userId);
    const p = plusPeriod(s?.until, now);
    if (p) return { key: 'p' + new Date(p.start + 3 * 3600_000).toISOString().slice(0, 10), back: dayWords(p.end) };
    return { key: monthOf(now), back: backOn(now) };
  }

  /** Сколько осталось от общего запаса (доля 0…1; null — безлимит). */
  async left(w: Who): Promise<number | null> {
    if (w.unlimited) return null;
    const used = await this.acc.store.aiUsage(w.user.id, w.key);
    return Math.max(0, 1 - used.cost / this.userMicro);
  }

  async status(ctx: Ctx, words: HelperWords): Promise<Reply> {
    if (!this.enabled) return { code: 200, body: { enabled: false, allowed: false } };
    const w = await this.who(ctx, words);
    if ('deny' in w) return { code: 200, body: { enabled: true, allowed: false, reason: (w.deny.body as { error: string }).error, message: (w.deny.body as { message: string }).message } };
    const left = await this.left(w);
    return { code: 200, body: { enabled: true, allowed: true, unlimited: w.unlimited, left, zapoy: left === 0 ? words.zapoy(w.back) : null } };
  }

  /** Можно ли спросить сейчас: частота, личный запас, потолок сайта. null — можно. */
  async gate(w: Who, words: HelperWords): Promise<Reply | null> {
    const now = w.now;
    if (!this.perMinute.take('u' + w.user.id, now) || !this.perUser.take('u' + w.user.id, now)) return err(429, 'often', words.often);
    if (!w.unlimited) {
      const used = await this.acc.store.aiUsage(w.user.id, w.key);
      if (used.cost >= this.userMicro) return err(429, 'zapoy', words.zapoy(w.back));
    }
    const total = await this.acc.store.aiTotal(monthOf(now));
    if (total.cost >= this.siteMicro && !w.unlimited) return err(429, 'sick', words.sick(backOn(now)));
    return null;
  }

  /** Запрос к модели и учёт расхода (личный период и календарный месяц, с пометкой помощника). Ответ модели или отказ. */
  async complete(w: Who, words: HelperWords, messages: Msg[], maxTokens: number): Promise<{ text: string } | Reply> {
    const month = monthOf(w.now);
    let res;
    try {
      res = await this.http(API, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.conf.key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: this.model, messages, max_tokens: maxTokens, temperature: 0.5, reasoning: { enabled: false }, usage: { include: true } }),
        signal: AbortSignal.timeout(40_000),
      });
    } catch (e) {
      this.log(`${words.tag}: шлюз не ответил — ${(e as Error).message}`);
      return err(502, 'gateway', words.silent);
    }
    const raw = await res.text();
    if (!res.ok) {
      this.log(`${words.tag}: шлюз ${res.status} ${raw.slice(0, 200)}`);
      return err(502, 'gateway', words.silent);
    }
    let j: any;
    try {
      j = JSON.parse(raw);
    } catch {
      return err(502, 'gateway', words.mumble);
    }
    const u = j?.usage ?? {};
    const tin = Number(u.prompt_tokens) || 0;
    const tout = Number(u.completion_tokens) || 0;
    const cached = Number(u.prompt_tokens_details?.cached_tokens) || 0;
    const rub = Number(u.cost);
    const micro = Number.isFinite(rub) && rub > 0 ? rub * MICRO : (tin - cached) * PRICE.in + cached * PRICE.cached + tout * PRICE.out;
    // строка календарного месяца — для общего потолка и админки, строка периода — личный запас
    await this.acc.store.addAiUsage(w.user.id, month, micro, tin, tout, words.id);
    if (w.key !== month) await this.acc.store.addAiUsage(w.user.id, w.key, micro, tin, tout, words.id);
    return { text: String(j?.choices?.[0]?.message?.content ?? '') };
  }

  /** Мастеру: расход за месяц — всего и по помощникам. */
  async admin(ctx: Ctx): Promise<Reply> {
    const u = await this.acc.current(ctx);
    const now = ctx.now ?? Date.now();
    if (!u || !hasRight(await this.acc.store.rights(u.id, now), 'master', now)) return err(403, 'master', 'Только для Мастера.');
    const t = await this.acc.store.aiTotal(monthOf(now));
    const helpers: Record<string, { rub: number; requests: number }> = {};
    for (const [k, x] of Object.entries(t.helpers ?? {})) helpers[k] = { rub: x.cost / MICRO, requests: x.requests };
    return { code: 200, body: { month: monthOf(now), rub: t.cost / MICRO, requests: t.requests, users: t.users, helpers, siteRub: this.siteMicro / MICRO, userRub: this.userMicro / MICRO } };
  }
}
