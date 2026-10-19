/* Лайки игр и история партий вошедшего игрока (этап 3б). Логика без HTTP — класс Player (тесты — tests/player.test.ts).
 *   GET  /api/likes                 — свои лайки ({ mine }); счётчики всех игр — в /api/stats (likes)
 *   POST /api/likes {game, on}      — поставить/снять (только вошедшему)
 *   GET  /api/history               — свои последние партии
 *   POST /api/history {game, …}     — партия закончилась (пишет браузер игрока; история личная, проверки — по здравому смыслу)
 *   GET  /api/saves[?game=…]        — список своих сохранений / одно с данными
 *   POST /api/saves {game, at, snap} — сохранить (snap: null — партии больше нет); старее записанного — не пишется */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Limiter, type Accounts, type Ctx, type Reply } from './accounts/accounts';
import { cookieOf, sameOrigin, send, siteOf } from './accounts/http';
import type { PlayRecord } from './accounts/store';

const err = (code: number, error: string, message: string): Reply => ({ code, body: { error, message } });
const RESULTS = ['win', 'lose', 'draw', 'done'] as const;
export const HISTORY_LIMIT = 50;
/** Предел снимка партии в базе (байт JSON). */
export const SAVE_MAX = 400_000;

export class Player {
  private counts: Record<string, number> = {};
  private likeLimit = new Limiter(120, 3600_000);
  private playLimit = new Limiter(200, 3600_000);
  private saveLimit = new Limiter(600, 3600_000);

  /** known — есть ли такая игра на сайте. */
  constructor(
    private acc: Accounts,
    private known: (game: string) => boolean
  ) {}

  /** Подтянуть счётчики лайков из базы (при старте и изредка — на случай правок руками). */
  async refresh() {
    this.counts = await this.acc.store.likeCounts();
  }

  likeCounts(): Record<string, number> {
    return this.counts;
  }

  async mine(ctx: Ctx): Promise<Reply> {
    const u = await this.acc.current(ctx);
    return { code: 200, body: { mine: u ? await this.acc.store.likesOf(u.id) : [] } };
  }

  async like(b: any, ctx: Ctx): Promise<Reply> {
    const u = await this.acc.current(ctx);
    if (!u) return err(401, 'auth', 'Лайки ставят вошедшие игроки.');
    const game = String(b?.game ?? '');
    if (!this.known(game)) return err(400, 'game', 'Нет такой игры.');
    if (!this.likeLimit.take(String(u.id), ctx.now)) return err(429, 'often', 'Слишком часто. Подождите немного.');
    const on = b?.on !== false;
    const had = (await this.acc.store.likesOf(u.id)).includes(game);
    if (had !== on) {
      await this.acc.store.setLike(u.id, game, on);
      this.counts[game] = Math.max(0, (this.counts[game] ?? 0) + (on ? 1 : -1));
    }
    return { code: 200, body: { game, on, count: this.counts[game] ?? 0 } };
  }

  async history(ctx: Ctx): Promise<Reply> {
    const u = await this.acc.current(ctx);
    if (!u) return err(401, 'auth', 'Войдите, чтобы видеть свои партии.');
    return { code: 200, body: { plays: await this.acc.store.history(u.id, HISTORY_LIMIT) } };
  }

  async saves(q: URLSearchParams, ctx: Ctx): Promise<Reply> {
    const u = await this.acc.current(ctx);
    if (!u) return err(401, 'auth', 'Войдите заново.');
    const game = q.get('game');
    if (!game) return { code: 200, body: { saves: await this.acc.store.listSaves(u.id) } };
    if (!this.known(game)) return err(400, 'game', 'Нет такой игры.');
    const s = await this.acc.store.getSave(u.id, game);
    let snap: unknown = null;
    try {
      snap = s?.data ? JSON.parse(s.data) : null;
    } catch {
      snap = null;
    }
    return { code: 200, body: { at: s?.at ?? 0, snap } };
  }

  async putSave(b: any, ctx: Ctx): Promise<Reply> {
    const u = await this.acc.current(ctx);
    if (!u) return err(401, 'auth', 'Войдите заново.');
    const game = String(b?.game ?? '');
    if (!this.known(game)) return err(400, 'game', 'Нет такой игры.');
    const now = ctx.now ?? Date.now();
    const at = Math.floor(Number(b?.at));
    // время — из браузера (порядок сохранений одного игрока), но не из будущего
    if (!Number.isFinite(at) || at <= 0 || at > now + 5 * 60_000) return err(400, 'at', 'Неверное время.');
    if (!this.saveLimit.take(String(u.id), now)) return err(429, 'often', 'Слишком часто.');
    const data = b?.snap == null ? null : JSON.stringify(b.snap);
    if (data && data.length > SAVE_MAX) return err(413, 'big', 'Партия слишком большая для сохранения на сервере.');
    return { code: 200, body: { ok: await this.acc.store.putSave(u.id, game, at, data) } };
  }

  async played(b: any, ctx: Ctx): Promise<Reply> {
    const u = await this.acc.current(ctx);
    if (!u) return { code: 200, body: { ok: false } };
    const game = String(b?.game ?? '');
    if (!this.known(game)) return err(400, 'game', 'Нет такой игры.');
    if (!this.playLimit.take(String(u.id), ctx.now)) return err(429, 'often', 'Слишком много партий подряд.');
    const int = (v: unknown, lo: number, hi: number) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Math.round(Number(v)))) : null);
    const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max) : null);
    const p: PlayRecord = {
      game,
      preset: str(b?.preset, 40),
      result: RESULTS.includes(b?.result) ? b.result : 'done',
      place: int(b?.place, 1, 20),
      players: int(b?.players, 1, 20) ?? 1,
      bots: int(b?.bots, 0, 20) ?? 0,
      network: !!b?.network,
      score: str(b?.score, 60),
      seconds: int(b?.seconds, 0, 7 * 86400),
      endedAt: ctx.now ?? Date.now(),
    };
    await this.acc.store.addHistory(u.id, p);
    return { code: 200, body: { ok: true } };
  }
}

/** HTTP: /api/likes, /api/history; false — не наш адрес. */
export async function playerApi(
  pl: Player,
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  ip: string,
  readBody: (req: IncomingMessage, limit?: number) => Promise<string>
): Promise<boolean> {
  if (path !== '/api/likes' && path !== '/api/history' && path !== '/api/saves') return false;
  const ctx: Ctx = { sid: cookieOf(req), ip, ua: String(req.headers['user-agent'] || ''), site: siteOf(req) };
  if (req.method === 'GET') {
    const q = new URL(req.url || '/', 'http://x').searchParams;
    send(req, res, path === '/api/likes' ? await pl.mine(ctx) : path === '/api/saves' ? await pl.saves(q, ctx) : await pl.history(ctx));
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
    b = JSON.parse((await readBody(req, path === '/api/saves' ? SAVE_MAX + 4096 : 2048)) || '{}');
  } catch {
    send(req, res, { code: 400, body: { error: 'bad body' } });
    return true;
  }
  send(req, res, path === '/api/likes' ? await pl.like(b, ctx) : path === '/api/saves' ? await pl.putSave(b, ctx) : await pl.played(b, ctx));
  return true;
}
