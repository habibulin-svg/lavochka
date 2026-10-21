/*
 * Сервер «Вечером на лавочке»: раздаёт собранный сайт (dist/), держит комнаты (WebSocket /ws)
 * и таблицы рекордов (/api/records, server/records.ts). Комнаты — тот же код Room, что и в браузере, только партию ведёт сервер.
 *
 *   PORT      — порт (по умолчанию 8787)
 *   DATA_DIR  — куда писать рекорды (по умолчанию ./data)
 *   TURN для голосового чата (/api/ice), одно из трёх:
 *     TURN_URLS + TURN_SECRET                     — свой coturn (use-auth-secret): временные логины на сутки
 *     CF_TURN_KEY_ID + CF_TURN_API_TOKEN          — Cloudflare Realtime TURN (временные логины)
 *     TURN_URLS + TURN_USERNAME + TURN_CREDENTIAL — любой TURN с постоянным логином (адреса через запятую)
 */
import { createHmac, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Link } from '../src/core/protocol';
import { cleanLook, Room, setRoomErrorHook } from '../src/core/room';
import type { SeatSpec } from '../src/core/types';
import { DEFS } from '../src/games/defs';
import type { GameDef } from '../src/core/types';
import { FileRecordStore, mayPost, Records } from './records';
import { PERIODS, RECORD_GAMES, type RecordPeriod } from '../src/core/records';
import { MOVED, SLUGS } from '../src/site/routes';
import { accountsFromEnv, authApi, OAuth, oauthApi, providersFromEnv } from './accounts';
import { cookieOf } from './accounts/http';
import { Donate, donateApi } from './donate';
import { Plus, plusApi } from './plus';
import { Player, playerApi } from './player';
import { Support, supportApi } from './support';
import { Backoffice, backofficeApi } from './backoffice';
import { mayPlay } from '../src/core/release';
import { hasRight } from '../src/core/rights';
import { Content, contentApi, prerenderProcess } from './content';
import { robokassaFromEnv } from './pay/robokassa';

const PORT = Number(process.env.PORT) || 8787;
const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..');
const DIST = join(ROOT, 'dist');
const DATA = resolve(process.env.DATA_DIR || join(ROOT, 'data'));
const CODE_ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const EMPTY_ROOM_TTL = 10 * 60 * 1000;

// ------------------------------------------------------------------ комнаты

const rooms = new Map<string, Room>();
const emptyTimers = new Map<string, ReturnType<typeof setTimeout>>();

function genCode(): string {
  for (;;) {
    let s = '';
    const b = randomBytes(6);
    for (let i = 0; i < 6; i++) s += CODE_ALPH[b[i] % CODE_ALPH.length];
    if (!rooms.has(s)) return s;
  }
}

function sanitizeSeats(raw: unknown, maxSeats: number): SeatSpec[] | null {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > maxSeats) return null;
  const seen = new Set<number>();
  const out: SeatSpec[] = [];
  for (const s of raw) {
    if (!s || typeof s !== 'object') return null;
    const seat = Number((s as any).seat);
    const kind = (s as any).kind;
    if (!Number.isInteger(seat) || seat < 0 || seat >= maxSeats || seen.has(seat)) return null;
    if (kind !== 'human' && kind !== 'bot' && kind !== 'remote') return null;
    seen.add(seat);
    out.push({ seat, kind, level: Math.max(0, Math.min(9, Number((s as any).level) || 0)), name: String((s as any).name ?? '').slice(0, 16), look: cleanLook((s as any).look) });
  }
  return out;
}

function wsLink(ws: WebSocket): Link {
  return {
    send: (m) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(m)),
    close: () => ws.close(),
    onMessage: null,
    onClose: null,
  };
}

function scheduleEmpty(code: string) {
  clearTimeout(emptyTimers.get(code));
  emptyTimers.set(
    code,
    setTimeout(() => {
      const r = rooms.get(code);
      if (r) r.close('Комната простояла пустой и закрыта.');
      rooms.delete(code);
      emptyTimers.delete(code);
    }, EMPTY_ROOM_TTL)
  );
}

async function handleFirst(ws: WebSocket, msg: any, req: IncomingMessage): Promise<Link | null> {
  const fail = (text: string) => {
    ws.send(JSON.stringify({ t: 'error', text }));
    ws.close();
    return null;
  };
  if (msg?.t === 'create') {
    const load = DEFS[String(msg.game)];
    if (!load) return fail('Сервер не знает эту игру — возможно, он старее сайта.');
    // выход игр (админка → «Игры»): скрытую открывает только Мастер, раннюю — с правом; гостей по коду хозяин зовёт сам
    if (backoffice.release[String(msg.game)]) {
      const u = await userOf(req);
      const rights = u ? await accounts.store.rights(u.id, Date.now()).catch(() => []) : [];
      if (!mayPlay(backoffice.release, String(msg.game), rights))
        return fail(backoffice.release[String(msg.game)].state === 'hidden' ? 'Эта игра пока скрыта.' : 'Эта игра пока в раннем доступе — для тех, у кого он есть.');
    }
    const def = await load();
    const seats = sanitizeSeats(msg.seats, def.seats.length);
    if (!seats || seats.length < def.players.min || seats.length > def.players.max) return fail('Неверная рассадка.');
    const options = msg.options && typeof msg.options === 'object' ? msg.options : {};
    const code = genCode();
    const ownerKey = randomBytes(16).toString('hex');
    const room = new Room({
      def,
      options,
      seats,
      code,
      ownerKey,
      onEmpty: () => scheduleEmpty(code),
    });
    rooms.set(code, room);
    ws.send(JSON.stringify({ t: 'created', code, ownerKey }));
    log(`комната ${code}: ${def.id}, мест ${seats.length}`);
    return attach(ws, room, await mayVideo(req));
  }
  if (msg?.t === 'join') {
    const code = String(msg.code || '').toUpperCase();
    const room = rooms.get(code);
    if (!room || room.isClosed) return fail('Комната не найдена. Проверьте код.');
    ws.send(JSON.stringify({ t: 'joined', code }));
    return attach(ws, room, await mayVideo(req));
  }
  return fail('Непонятный запрос.');
}

/** Камера за столом — по праву video (подписка «Лавочка+»); голос — всем. База недоступна — не мешаем. */
async function mayVideo(req: IncomingMessage): Promise<boolean> {
  if (!accountsReady) return true;
  const u = await userOf(req);
  return !!u && hasRight(await accounts.store.rights(u.id, Date.now()).catch(() => []), 'video');
}

function attach(ws: WebSocket, room: Room, video: boolean): Link {
  clearTimeout(emptyTimers.get(room.code));
  emptyTimers.delete(room.code);
  const link = wsLink(ws);
  link.video = video;
  room.connect(link);
  return link;
}

// ------------------------------------------------------------------ рекорды

// Хранение, проверка и выдача — server/records.ts; старый records.json аркад переносится при первом запуске.
const recordStore = new FileRecordStore(DATA, log);
const recordDefs: Record<string, GameDef> = {};
const records = new Records(
  recordStore,
  recordDefs,
  Promise.all(RECORD_GAMES.map((id) => DEFS[id]().then((d) => (recordDefs[id] = d)))).catch((e) => log('рекорды: не загрузились игры: ' + e))
);
// перезапуск при выкладке: записать рекорды, пришедшие в последнюю секунду
for (const sig of ['SIGTERM', 'SIGINT'] as const)
  process.once(sig, () => {
    recordStore.flush();
    process.exit(0);
  });

// ------------------------------------------------------------------ аккаунты (server/accounts)
// База не поднялась — сайт и игры работают, вход отвечает «временно недоступен»; пробуем снова раз в минуту.

const accounts = accountsFromEnv(log);
let accountsReady = false;
async function initAccounts() {
  try {
    await accounts.store.init();
    accountsReady = true;
    log('аккаунты: база готова');
    await player.refresh().catch(() => {});
    await backoffice.loadRelease();
    statsCache = null;
  } catch (e) {
    log('аккаунты: база недоступна — ' + (e as Error).message);
    setTimeout(initAccounts, 60_000).unref();
  }
}
void initAccounts();
// вход через Яндекс ID и VK ID (server/accounts/oauth.ts): включается по ключам
const oauth = new OAuth(accounts, providersFromEnv(), fetch, log);
accounts.loginWith = oauth.enabled;
log('вход через сервисы: ' + (oauth.enabled.join(', ') || 'нет ключей'));
/** Вошедший игрок по cookie (null — гость или база недоступна). */
async function userOf(req: IncomingMessage) {
  if (!accountsReady) return null;
  try {
    return await accounts.current({ sid: cookieOf(req), ip: clientIp(req), ua: '', site: '' });
  } catch {
    return null;
  }
}
// лайки и история партий (server/player.ts)
const player = new Player(accounts, (g) => Object.hasOwn(SLUGS, g));
setInterval(() => accountsReady && player.refresh().catch(() => {}), 600_000).unref();
// донат (server/donate.ts): без ключей Robokassa кнопка есть, но оплата отвечает «ещё не подключена»
const donate = new Donate(accounts, robokassaFromEnv(), log);
if (!donate.enabled) log('донат: ключей Robokassa нет (ROBOKASSA_LOGIN/PASS1/PASS2) — приём платежей выключен');
// подписка «Лавочка+» (server/plus.ts): та же Robokassa; повторные списания — только при ROBOKASSA_RECURRING=1
const plus = new Plus(accounts, robokassaFromEnv(), log, fetch, (process.env.SITE_URL || 'https://lavochka-games.ru').replace(/\/+$/, ''));
log('подписка: ' + (plus.enabled ? (plus.recurring ? 'оплата и автопродление включены' : 'оплата включена, автопродление выключено') : 'оплата выключена'));
setInterval(() => accountsReady && plus.tick().catch((e) => log('подписка: ' + (e as Error).message)), 3600_000).unref();
// обращения (server/support.ts): с сайта и письмами через Postfix (deploy/mail/)
const support = new Support(accounts, log);
setInterval(() => accountsReady && accounts.store.cleanup(Date.now()).catch(() => {}), 3600_000).unref();
// админка (server/backoffice.ts): статистика по дням, автоошибки, игроки и права
const backoffice = new Backoffice(accounts, () => ({ online: onlineNow(), rooms: rooms.size, players: [...rooms.values()].reduce((n, r) => n + r.clientCount, 0) }), log, (g) => Object.hasOwn(SLUGS, g));
setInterval(() => accountsReady && backoffice.sample().catch(() => {}), 5 * 60_000).unref();
setTimeout(() => accountsReady && backoffice.sample().catch(() => {}), 30_000).unref();
// тексты из админки (server/content.ts): новости, блог, «Слово Мастера», картинки; после правки — пререндер страниц
const content = new Content(accounts, ROOT, DATA, existsSync(DIST) ? prerenderProcess(ROOT, DATA, existsSync('/srv/lavochka')) : null, log);
setRoomErrorHook((e, where, game) => accountsReady && backoffice.serverError(e, where, game));
process.on('unhandledRejection', (e) => {
  log('необработанная ошибка: ' + e);
  if (accountsReady) backoffice.serverError(e, 'unhandledRejection');
});

// ------------------------------------------------------------------ счётчики: онлайн и начатые партии
// Онлайн — сколько вкладок отметилось за последние 3 минуты (сайт отмечается раз в минуту, пока вкладка видна).
// Партии — сколько раз начинали каждую игру (клиент сообщает при «Начать игру» и «Сыграть ещё»); ответ кэшируется на минуту.

const ONLINE_MS = 3 * 60_000;
const seen = new Map<string, number>();
const PLAYED_FILE = join(DATA, 'played.json');
let played: Record<string, number> = {};
try {
  played = JSON.parse(readFileSync(PLAYED_FILE, 'utf8'));
} catch {
  played = {};
}
let playedTimer: ReturnType<typeof setTimeout> | undefined;
function savePlayed() {
  clearTimeout(playedTimer);
  playedTimer = setTimeout(() => {
    try {
      mkdirSync(DATA, { recursive: true });
      writeFileSync(PLAYED_FILE, JSON.stringify(played));
    } catch (e) {
      log('не удалось сохранить счётчик партий: ' + e);
    }
  }, 5000);
}
/** Защита от накрутки: с одного адреса — не чаще раза в 15 с на игру и не больше 300 партий в сутки. */
const playLimit = new Map<string, { day: number; n: number; last: Record<string, number> }>();
function mayCount(ip: string, game: string): boolean {
  const now = Date.now();
  const day = Math.floor(now / 86_400_000);
  let l = playLimit.get(ip);
  if (!l || l.day !== day) playLimit.set(ip, (l = { day, n: 0, last: {} }));
  if (l.n >= 300 || now - (l.last[game] ?? 0) < 15_000) return false;
  l.n++;
  l.last[game] = now;
  return true;
}
/** Сейчас на сайте: вкладки за 3 минуты, но не меньше, чем людей за сетевыми столами сервера. */
function onlineNow(now = Date.now()) {
  for (const [id, t] of seen) if (now - t > ONLINE_MS) seen.delete(id);
  return Math.max(seen.size, [...rooms.values()].reduce((n, r) => n + r.clientCount, 0));
}
let statsCache: { at: number; body: string } | null = null;
function statsBody(): string {
  const now = Date.now();
  if (statsCache && now - statsCache.at < 60_000) return statsCache.body;
  statsCache = { at: now, body: JSON.stringify({ online: onlineNow(now), played, likes: player.likeCounts(), release: backoffice.release }) };
  return statsCache.body;
}
setInterval(() => {
  if (playLimit.size > 5000) playLimit.clear();
}, 3600_000).unref();

// nginx дописывает настоящий адрес в конец X-Forwarded-For (начало может подделать сам клиент)
const clientIp = (req: IncomingMessage) => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',').pop()!.trim();

// ------------------------------------------------------------------ HTTP

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.ico': 'image/x-icon',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.mp4': 'video/mp4',
  '.ogg': 'audio/ogg',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
};

function json(res: ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

// ------------------------------------------------------------------ ICE (голосовой чат)
// Без TURN-сервера браузеры за строгим NAT (мобильный интернет, офисы) не соединяются напрямую.
// На своём сервере — coturn рядом (deploy/coturn); на Render свой TURN не поднять (нет UDP),
// там — внешний: Cloudflare (ключ из Realtime → TURN) или любой другой с постоянным логином.

const STUN: RTCIceServerLike[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
let iceCache: { at: number; servers: RTCIceServerLike[] } | null = null;

interface RTCIceServerLike {
  urls: string | string[];
  username?: string;
  credential?: string;
}

async function iceServers(): Promise<RTCIceServerLike[]> {
  const env = process.env;
  // адрес без схемы («free.expressturn.com:3478») браузер не примет — дописываем turn:
  const turnUrls = () =>
    (env.TURN_URLS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((u) => (/^(turns?|stun):/i.test(u) ? u : 'turn:' + u));
  if (env.TURN_URLS && env.TURN_SECRET) {
    // TURN REST API: имя «срок:метка», пароль — base64(HMAC-SHA1(секрет, имя)); coturn проверяет сам
    const username = Math.floor(Date.now() / 1000 + 86400) + ':lavochka';
    const credential = createHmac('sha1', env.TURN_SECRET).update(username).digest('base64');
    return [...STUN, { urls: turnUrls(), username, credential }];
  }
  if (env.TURN_URLS && env.TURN_USERNAME && env.TURN_CREDENTIAL) {
    return [...STUN, { urls: turnUrls(), username: env.TURN_USERNAME, credential: env.TURN_CREDENTIAL }];
  }
  if (env.CF_TURN_KEY_ID && env.CF_TURN_API_TOKEN) {
    // временные логины на сутки, раздаём из кэша полдня
    if (iceCache && Date.now() - iceCache.at < 12 * 3600_000) return iceCache.servers;
    try {
      const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.CF_TURN_KEY_ID)}/credentials/generate-ice-servers`, {
        method: 'POST',
        headers: { authorization: `Bearer ${env.CF_TURN_API_TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ ttl: 86400 }),
        signal: AbortSignal.timeout(5000),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const b = (await r.json()) as { iceServers?: RTCIceServerLike | RTCIceServerLike[] };
      const list = Array.isArray(b.iceServers) ? b.iceServers : b.iceServers ? [b.iceServers] : [];
      if (!list.length) throw new Error('empty');
      iceCache = { at: Date.now(), servers: list };
      return list;
    } catch (e) {
      console.warn('TURN (Cloudflare):', (e as Error).message);
    }
  }
  return STUN;
}

function readBody(req: IncomingMessage, limit = 4096): Promise<string> {
  return readRaw(req, limit).then((b) => b.toString('utf8'));
}

function readRaw(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((ok, bad) => {
    const parts: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      parts.push(c);
      size += c.length;
      if (size > limit) {
        bad(new Error('too big'));
        req.destroy();
      }
    });
    req.on('end', () => ok(Buffer.concat(parts)));
    req.on('error', bad);
  });
}

async function api(req: IncomingMessage, res: ServerResponse, path: string) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST', 'access-control-allow-headers': 'content-type' });
    return res.end();
  }
  if (path === '/api/health') return json(res, 200, { ok: true, rooms: rooms.size, accounts: accountsReady });
  if (path.startsWith('/api/auth/')) {
    if (!accountsReady) {
      res.writeHead(503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      return res.end(JSON.stringify({ error: 'down', message: 'Вход временно недоступен. Играть можно и без него.' }));
    }
    if (await oauthApi(oauth, req, res, new URL(req.url || '/', 'http://x'), clientIp(req))) return;
    if (await authApi(accounts, req, res, path, clientIp(req), readBody)) return;
  }
  if (path === '/api/likes' || path === '/api/history' || path === '/api/saves' || path === '/api/seen') {
    if (!accountsReady) return json(res, 503, { error: 'down', message: 'Сервер временно недоступен. Попробуйте чуть позже.' });
    if (await playerApi(player, req, res, path, clientIp(req), readBody)) return;
  }
  if (path === '/api/donate' || path === '/api/admin/donate' || path.startsWith('/api/pay/')) {
    if (!accountsReady) return json(res, 503, { error: 'down', message: 'Сервер временно недоступен. Попробуйте чуть позже.' });
    if (await donateApi(donate, req, res, new URL(req.url || '/', 'http://x'), clientIp(req), readBody, plus)) return;
  }
  if (path === '/api/plus' || path === '/api/plus/autorenew' || path === '/api/admin/plus') {
    if (!accountsReady) return json(res, 503, { error: 'down', message: 'Сервер временно недоступен. Попробуйте чуть позже.' });
    if (await plusApi(plus, req, res, new URL(req.url || '/', 'http://x'), clientIp(req), readBody)) return;
  }
  if (path === '/api/support' || path === '/api/support/reply' || path === '/api/admin/support' || path === '/api/mail/in') {
    if (!accountsReady) return json(res, 503, { error: 'down', message: 'Сервер временно недоступен. Напишите на почту или попробуйте чуть позже.' });
    if (await supportApi(support, req, res, new URL(req.url || '/', 'http://x'), clientIp(req), readBody, readRaw)) return;
  }
  if (path === '/api/master-word' || path === '/api/admin/posts' || path === '/api/admin/pages' || path === '/api/admin/upload') {
    if (!accountsReady) return json(res, 503, { error: 'down', message: 'Сервер временно недоступен. Попробуйте чуть позже.' });
    if (await contentApi(content, req, res, new URL(req.url || '/', 'http://x'), clientIp(req), readBody, readRaw)) return;
  }
  if (path === '/api/errors' || path === '/api/admin/dash' || path === '/api/admin/users' || path === '/api/admin/errors' || path === '/api/admin/games' || path === '/api/admin/groups') {
    if (!accountsReady) return json(res, 503, { error: 'down', message: 'Сервер временно недоступен. Попробуйте чуть позже.' });
    if (await backofficeApi(backoffice, req, res, new URL(req.url || '/', 'http://x'), clientIp(req), readBody)) {
      if (path === '/api/admin/games') statsCache = null; // выход игр — всем сразу
      return;
    }
  }
  if (path === '/api/stats') {
    // ?v=<метка вкладки> — вкладка отмечается «во дворе»
    const v = new URL(req.url || '', 'http://x').searchParams.get('v');
    if (v && /^[\w-]{6,40}$/.test(v) && (seen.has(v) || seen.size < 100_000)) {
      seen.set(v, Date.now());
      backoffice.visit(v);
    }
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    return res.end(statsBody());
  }
  if (path === '/api/played' && req.method === 'POST') {
    try {
      const b = JSON.parse(await readBody(req, 256));
      const game = String(b.game || '');
      if (!Object.hasOwn(SLUGS, game)) return json(res, 400, { error: 'game' });
      if (mayCount(clientIp(req), game)) {
        played[game] = (played[game] || 0) + 1;
        savePlayed();
        if (accountsReady) backoffice.played(game, String(b.mode || 'local'));
      }
      return json(res, 200, { ok: true });
    } catch {
      return json(res, 400, { error: 'bad body' });
    }
  }
  if (path === '/api/ice') {
    // логины TURN — только своему сайту (без access-control-allow-origin)
    const servers = await iceServers();
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    return res.end(JSON.stringify({ iceServers: servers, turn: servers.some((s) => [s.urls].flat().some((u) => /^turns?:/.test(u))) }));
  }
  if (path === '/api/records') {
    if (req.method === 'GET') {
      const q = new URL(req.url || '', 'http://x').searchParams;
      // свои рекорды во всех играх (профиль)
      if (q.get('mine') === '1') {
        const u = await userOf(req);
        if (!u) return json(res, 401, { error: 'auth' });
        return json(res, 200, { rows: await records.ofPlayer(String(u.id)) });
      }
      const game = q.get('game') || '';
      const period = (PERIODS.some((p) => p.id === q.get('period')) ? q.get('period') : 'all') as RecordPeriod;
      const device = q.get('device') || undefined;
      const tables = records.tablesOf(game);
      const table = q.get('table') || tables[0]?.id || '';
      const u = await userOf(req);
      const r = table ? records.list(game, table, period, device, 20, u ? String(u.id) : undefined) : null;
      return json(res, 200, { table, tables, columns: r?.columns ?? [], rows: r?.rows ?? [] });
    }
    if (req.method === 'POST') {
      if (!mayPost(clientIp(req))) return json(res, 429, { error: 'often' });
      try {
        const u = await userOf(req);
        const r = await records.add(JSON.parse(await readBody(req, 512 * 1024)), u ? { id: String(u.id), name: u.name } : undefined);
        return json(res, r.ok ? 200 : 400, r);
      } catch {
        return json(res, 400, { error: 'bad body' });
      }
    }
  }
  // старый адрес аркад (вкладки, открытые до обновления): /api/records/<аркада>-<режим>
  const m = path.match(/^\/api\/records\/([a-z]\w*)-([\w.-]{1,40})$/);
  if (m) {
    if (req.method === 'GET') return json(res, 200, (records.list(m[1], m[2], 'all')?.rows ?? []).map((r) => ({ name: r.name, score: r.values.score, at: r.at })));
    if (req.method === 'POST') {
      if (!mayPost(clientIp(req))) return json(res, 429, { error: 'often' });
      try {
        const b = JSON.parse(await readBody(req));
        const r = await records.add({ game: m[1], table: m[2], name: b.name, values: { score: Number(b.score) } });
        return json(res, r.ok ? 200 : 400, r);
      } catch {
        return json(res, 400, { error: 'bad body' });
      }
    }
  }
  return json(res, 404, { error: 'not found' });
}

function serveStatic(req: IncomingMessage, res: ServerResponse, path: string) {
  // картинки записей из админки (DATA_DIR/uploads): имя — отпечаток содержимого, поэтому кэш навсегда
  const up = path.match(/^\/uploads\/([0-9a-f]{16}\.(webp|png|jpg|gif))$/);
  if (up) {
    const f = join(DATA, 'uploads', up[1]);
    if (!existsSync(f)) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { 'content-type': up[2] === 'jpg' ? 'image/jpeg' : 'image/' + up[2], 'cache-control': 'public, max-age=31536000, immutable' });
    return res.end(readFileSync(f));
  }
  if (!existsSync(DIST)) {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('Сервер «Вечером на лавочке» работает. Сайт не собран (нет dist/) — запустите npm run build.');
  }
  let file: string;
  try {
    file = normalize(join(DIST, decodeURIComponent(path)));
  } catch {
    res.writeHead(400);
    return res.end();
  }
  if (!file.startsWith(DIST)) {
    res.writeHead(403);
    return res.end();
  }
  const headers: Record<string, string> = {};
  // старый адрес на Render не индексируем: сайт переезжает на свой домен
  if (/\.onrender\.com$/i.test(String(req.headers.host || '').split(':')[0])) headers['x-robots-tag'] = 'noindex';
  // переехавший адрес — насовсем на новый
  const moved = MOVED[path.replace(/^\/+|\/+$/g, '')];
  if (moved) {
    res.writeHead(301, { location: `/${moved}/` + (req.url || '').slice(path.length), ...headers });
    return res.end();
  }
  let status = 200;
  const isDir = existsSync(file) && statSync(file).isDirectory();
  if (isDir && existsSync(join(file, 'index.html'))) {
    // страница игры (пререндер): /nardy → /nardy/
    if (!path.endsWith('/')) {
      const q = (req.url || '').slice(path.length);
      res.writeHead(301, { location: path + '/' + q, ...headers });
      return res.end();
    }
    file = join(file, 'index.html');
  } else if (!existsSync(file) || isDir) {
    // адреса без своей страницы — оболочка сайта: стол /stol/<код> и поиск — экраны, остальное — 404 (роутер покажет двор)
    if (extname(path)) {
      res.writeHead(404, headers);
      return res.end();
    }
    const spa = join(DIST, '_spa.html');
    file = existsSync(spa) ? spa : join(DIST, 'index.html');
    headers['x-robots-tag'] = 'noindex';
    if (!/^\/(stol\/[\w-]+|poisk|vhod|admin(\/[\w-]+)?)\/?$/.test(path)) status = 404;
  }
  const ext = extname(file);
  const immutable = file.includes(join(DIST, 'assets'));
  res.writeHead(status, { 'content-type': MIME[ext] || 'application/octet-stream', 'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache', ...headers });
  let body: Buffer | string = readFileSync(file);
  // страница игры: пререндер оставил место под рекорды — вписываем свежие (живой текст для поисковиков)
  if (ext === '.html' && body.includes('<!--records:')) body = body.toString('utf8').replace(/<!--records:([a-z]\w*)-->/g, (_, g: string) => records.html(g));
  res.end(body);
}

const server = createServer((req, res) => {
  const path = (req.url || '/').split('?')[0];
  // старый адрес на Render — насовсем на свой домен (проверку здоровья Render оставляем)
  if (/\.onrender\.com$/i.test(String(req.headers.host || '').split(':')[0]) && path !== '/api/health') {
    res.writeHead(301, { location: 'https://lavochka-games.ru' + (req.url || '/') });
    return res.end();
  }
  if (path.startsWith('/api/')) {
    api(req, res, path).catch((e) => {
      if (accountsReady) backoffice.serverError(e, 'API ' + path);
      json(res, 500, { error: 'internal' });
    });
    return;
  }
  serveStatic(req, res, path);
});

// ------------------------------------------------------------------ WebSocket

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });
wss.on('connection', (ws, req) => {
  let link: Link | null = null;
  let pending = true;
  ws.on('message', (data) => {
    let msg: any;
    try {
      msg = JSON.parse(String(data));
    } catch {
      return;
    }
    if (link) return link.onMessage?.(msg);
    if (!pending) return;
    pending = false;
    handleFirst(ws, msg, req)
      .then((l) => (link = l))
      .catch((e) => {
        log('ошибка: ' + e);
        ws.close();
      });
  });
  ws.on('close', () => link?.onClose?.());
  ws.on('error', () => link?.onClose?.());
});

function log(s: string) {
  console.log(new Date().toISOString().slice(11, 19), s);
}

server.listen(PORT, () => log(`Сервер на http://localhost:${PORT} (ws: /ws)`));
