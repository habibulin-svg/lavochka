/*
 * Сервер «Вечером на лавочке»: раздаёт собранный сайт (dist/), держит комнаты (WebSocket /ws)
 * и таблицы рекордов (/api/records/:game). Комнаты — тот же код Room, что и в браузере, только партию ведёт сервер.
 *
 *   PORT      — порт (по умолчанию 8787)
 *   DATA_DIR  — куда писать рекорды (по умолчанию ./data)
 *   TURN для голосового чата (/api/ice), одно из двух:
 *     CF_TURN_KEY_ID + CF_TURN_API_TOKEN          — Cloudflare Realtime TURN (временные логины)
 *     TURN_URLS + TURN_USERNAME + TURN_CREDENTIAL — любой TURN с постоянным логином (адреса через запятую)
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Link } from '../src/core/protocol';
import { Room } from '../src/core/room';
import type { SeatSpec } from '../src/core/types';
import { DEFS } from '../src/games/defs';

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
    out.push({ seat, kind, level: Math.max(0, Math.min(9, Number((s as any).level) || 0)), name: String((s as any).name ?? '').slice(0, 16) });
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

async function handleFirst(ws: WebSocket, msg: any): Promise<Link | null> {
  const fail = (text: string) => {
    ws.send(JSON.stringify({ t: 'error', text }));
    ws.close();
    return null;
  };
  if (msg?.t === 'create') {
    const load = DEFS[String(msg.game)];
    if (!load) return fail('Сервер не знает эту игру — возможно, он старее сайта.');
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
    return attach(ws, room);
  }
  if (msg?.t === 'join') {
    const code = String(msg.code || '').toUpperCase();
    const room = rooms.get(code);
    if (!room || room.isClosed) return fail('Комната не найдена. Проверьте код.');
    ws.send(JSON.stringify({ t: 'joined', code }));
    return attach(ws, room);
  }
  return fail('Непонятный запрос.');
}

function attach(ws: WebSocket, room: Room): Link {
  clearTimeout(emptyTimers.get(room.code));
  emptyTimers.delete(room.code);
  const link = wsLink(ws);
  room.connect(link);
  return link;
}

// ------------------------------------------------------------------ рекорды

interface Rec {
  name: string;
  score: number;
  at: number;
}
const RECORDS_FILE = join(DATA, 'records.json');
let records: Record<string, Rec[]> = {};
try {
  records = JSON.parse(readFileSync(RECORDS_FILE, 'utf8'));
} catch {
  records = {};
}
let saveTimer: ReturnType<typeof setTimeout> | undefined;
function saveRecords() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      mkdirSync(DATA, { recursive: true });
      writeFileSync(RECORDS_FILE, JSON.stringify(records));
    } catch (e) {
      log('не удалось сохранить рекорды: ' + e);
    }
  }, 1000);
}

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
};

function json(res: ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

// ------------------------------------------------------------------ ICE (голосовой чат)
// Без TURN-сервера браузеры за строгим NAT (мобильный интернет, офисы) не соединяются напрямую.
// На Render свой TURN не поднять (нет UDP), поэтому — внешний: Cloudflare (ключ из Realtime → TURN)
// или любой другой с постоянным логином.

const STUN: RTCIceServerLike[] = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];
let iceCache: { at: number; servers: RTCIceServerLike[] } | null = null;

interface RTCIceServerLike {
  urls: string | string[];
  username?: string;
  credential?: string;
}

async function iceServers(): Promise<RTCIceServerLike[]> {
  const env = process.env;
  if (env.TURN_URLS && env.TURN_USERNAME && env.TURN_CREDENTIAL) {
    return [...STUN, { urls: env.TURN_URLS.split(',').map((s) => s.trim()).filter(Boolean), username: env.TURN_USERNAME, credential: env.TURN_CREDENTIAL }];
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
    req.on('end', () => ok(Buffer.concat(parts).toString('utf8')));
    req.on('error', bad);
  });
}

async function api(req: IncomingMessage, res: ServerResponse, path: string) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST', 'access-control-allow-headers': 'content-type' });
    return res.end();
  }
  if (path === '/api/health') return json(res, 200, { ok: true, rooms: rooms.size });
  if (path === '/api/ice') {
    // логины TURN — только своему сайту (без access-control-allow-origin)
    const servers = await iceServers();
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    return res.end(JSON.stringify({ iceServers: servers, turn: servers.some((s) => [s.urls].flat().some((u) => /^turns?:/.test(u))) }));
  }
  const m = path.match(/^\/api\/records\/([\w-]{1,40})$/);
  if (m) {
    const game = m[1];
    if (req.method === 'GET') return json(res, 200, (records[game] || []).slice(0, 20));
    if (req.method === 'POST') {
      try {
        const b = JSON.parse(await readBody(req));
        const name = String(b.name || '').trim().slice(0, 16) || 'Аноним';
        const score = Math.floor(Number(b.score));
        if (!Number.isFinite(score) || score < 0 || score > 1e9) return json(res, 400, { error: 'score' });
        const list = (records[game] ||= []);
        list.push({ name, score, at: Date.now() });
        list.sort((a, c) => c.score - a.score);
        list.length = Math.min(list.length, 100);
        saveRecords();
        return json(res, 200, { ok: true, place: list.findIndex((r) => r.name === name && r.score === score) + 1 });
      } catch {
        return json(res, 400, { error: 'bad body' });
      }
    }
  }
  return json(res, 404, { error: 'not found' });
}

function serveStatic(req: IncomingMessage, res: ServerResponse, path: string) {
  if (!existsSync(DIST)) {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('Сервер «Вечером на лавочке» работает. Сайт не собран (нет dist/) — запустите npm run build.');
  }
  let file = normalize(join(DIST, decodeURIComponent(path)));
  if (!file.startsWith(DIST)) {
    res.writeHead(403);
    return res.end();
  }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  const ext = extname(file);
  const immutable = file.includes(join(DIST, 'assets'));
  res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream', 'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache' });
  res.end(readFileSync(file));
  void req;
}

const server = createServer((req, res) => {
  const path = (req.url || '/').split('?')[0];
  if (path.startsWith('/api/')) {
    api(req, res, path).catch(() => json(res, 500, { error: 'internal' }));
    return;
  }
  serveStatic(req, res, path);
});

// ------------------------------------------------------------------ WebSocket

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });
wss.on('connection', (ws) => {
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
    handleFirst(ws, msg)
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
