/* Арена «Героев» на сервере: комнаты по коду, подбор соперника, рейтинг (src/geroi/net/room.ts — сама комната, здесь сокеты и хранение).
 * Рейтинг — файл в DATA_DIR, как рекорды: одна запись на вошедшего игрока. */
import { randomInt } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Link } from '../src/core/protocol';
import { DEFAULT_BUDGET, type NetClientMsg, type NetServerMsg } from '../src/geroi/net/protocol';
import { type Rating, START_RATING, afterGame } from '../src/geroi/net/rating';
import { ArenaRoom, type RoomPeer } from '../src/geroi/net/room';
import { cleanGen } from '../src/geroi/net/mapproto';
import { type MailSummary, type MapHooks, MapRoom, type MapRoomSave } from '../src/geroi/net/maproom';

/** Комнаты Арены и сетевой карты — одни коды на двоих. */
const rooms = new Map<string, ArenaRoom | MapRoom>();
let waiting: { peer: RoomPeer; attach: (room: ArenaRoom, code: string) => void } | null = null;
let nextPeer = 1;
let clock: NodeJS.Timeout | null = null;
/** Опустевшую начатую партию ждём: вернутся после обновления страницы. */
const GRACE_MS = 150_000;

interface Row extends Rating {
  name: string;
  at: number;
}

/** Сезон — квартал: «2026-4». */
export function seasonOf(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${Math.trunc(d.getUTCMonth() / 3) + 1}`;
}

const SEASON_NAMES = ['зима', 'весна', 'лето', 'осень'];
/** «осень 2026». */
export function seasonName(id: string): string {
  const [y, q] = id.split('-').map(Number);
  return `${SEASON_NAMES[q - 1] ?? '?'} ${y}`;
}

type Top = { name: string; r: number; wins: number; losses: number }[];

interface Seasons {
  season: string;
  /** Прошлые сезоны: лучшие на конец, новые сверху. */
  past: { season: string; top: Top }[];
}

/** Рейтинг по сезонам: со сменой квартала лучшие уходят в архив, числа сжимаются к 1500 (половина отрыва), неточность растёт, счёт побед — с нуля. */
export class Ratings {
  private rows: Record<string, Row> = {};
  private timer: NodeJS.Timeout | undefined;
  private file: string;
  private seasonFile: string;
  private seasons: Seasons;

  constructor(private readonly dir: string, private log: (s: string) => void = console.log, file = 'geroi-rating.json', private readonly now: () => number = Date.now) {
    this.file = join(dir, file);
    this.seasonFile = join(dir, file.replace(/\.json$/, '-seasons.json'));
    this.seasons = { season: seasonOf(now()), past: [] };
    if (existsSync(this.seasonFile)) {
      try {
        this.seasons = JSON.parse(readFileSync(this.seasonFile, 'utf8'));
      } catch {
        renameSync(this.seasonFile, `${this.seasonFile}.bad`);
      }
    }
    if (existsSync(this.file)) {
      try {
        this.rows = JSON.parse(readFileSync(this.file, 'utf8'));
      } catch (e) {
        // испорченный файл не затираем
        renameSync(this.file, `${this.file}.bad`);
        this.log(`Рейтинг Арены: файл испорчен, отложен (${String(e)})`);
      }
    }
  }

  /** Новый квартал — новый сезон. */
  private roll(): void {
    const cur = seasonOf(this.now());
    if (this.seasons.season === cur) return;
    const top = this.rank(10);
    if (top.length) this.seasons.past = [{ season: this.seasons.season, top }, ...this.seasons.past].slice(0, 8);
    for (const [k, x] of Object.entries(this.rows)) this.rows[k] = { ...x, r: 1500 + (x.r - 1500) / 2, rd: Math.min(350, Math.max(x.rd, 200)), wins: 0, losses: 0 };
    this.log(`Рейтинг (${this.file}): сезон ${this.seasons.season} закрыт, начат ${cur}`);
    this.seasons.season = cur;
    this.save();
  }

  /** Текущий сезон и прошлые (для таблицы). */
  season(): { name: string; past: { name: string; top: Top }[] } {
    this.roll();
    return { name: seasonName(this.seasons.season), past: this.seasons.past.map((p) => ({ name: seasonName(p.season), top: p.top.slice(0, 3) })) };
  }

  get(user: number): Rating {
    this.roll();
    return this.rows[user] ?? START_RATING;
  }

  apply(winner: number, loser: number, names: [string, string]): [Row, Row] {
    this.roll();
    const [a, b] = afterGame(this.get(winner), this.get(loser));
    const at = Date.now();
    const rows: [Row, Row] = [{ ...a, name: names[0], at }, { ...b, name: names[1], at }];
    this.rows[winner] = rows[0];
    this.rows[loser] = rows[1];
    this.save();
    return rows;
  }

  top(n: number): Top {
    this.roll();
    return this.rank(n);
  }

  /** Сезон без игр: в таблице только сыгравшие. */
  private rank(n: number): Top {
    return Object.values(this.rows)
      .filter((x) => x.wins + x.losses > 0)
      .sort((a, b) => b.r - a.r)
      .slice(0, n)
      .map((x) => ({ name: x.name, r: Math.round(x.r), wins: x.wins, losses: x.losses }));
  }

  private save(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 1000);
  }

  flush(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    mkdirSync(this.dir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.rows));
    renameSync(tmp, this.file);
    writeFileSync(`${this.seasonFile}.tmp`, JSON.stringify(this.seasons));
    renameSync(`${this.seasonFile}.tmp`, this.seasonFile);
  }
}

// ------------------------------------------------------------------ по переписке: комнаты на диске

/** Кончившуюся партию по переписке держим столько (посмотреть итог и сохранить запись), потом файл удаляется. */
const MAIL_KEEP_MS = 7 * 24 * 3600_000;
let mailDir = '';
const mailTimers = new Map<string, NodeJS.Timeout>();

/** Рейтинг карты: хуки комнаты (и для поднятых с диска). */
function mapHooksFor(t: Ratings | undefined): MapHooks {
  return {
    onResult: (w, l, names) => {
      if (!t) return [{ r: 0, delta: 0 }, { r: 0, delta: 0 }];
      const before = [t.get(w).r, t.get(l).r];
      const [a, b] = t.apply(w, l, names);
      return [{ r: Math.round(a.r), delta: Math.round(a.r - before[0]) }, { r: Math.round(b.r), delta: Math.round(b.r - before[1]) }];
    },
  };
}

function mailFile(code: string): string {
  return join(mailDir, `${code}.json`);
}

/** Партия по переписке поменялась — записать файл (не чаще раза в 5 с). */
function watchMail(code: string, r: MapRoom): void {
  r.onChange = () => {
    if (!mailDir || !r.mail || r.phase === 'lobby' || mailTimers.has(code)) return;
    mailTimers.set(code, setTimeout(() => writeMail(code, r), 5000));
  };
}

function writeMail(code: string, r: MapRoom): void {
  clearTimeout(mailTimers.get(code));
  mailTimers.delete(code);
  if (rooms.get(code) !== r) return;
  mkdirSync(mailDir, { recursive: true });
  const tmp = `${mailFile(code)}.tmp`;
  writeFileSync(tmp, JSON.stringify(r.save()));
  renameSync(tmp, mailFile(code));
}

/** Поднять партии по переписке с диска (при старте сервера). */
export function initGeroiMail(dir: string, mapRatings: Ratings | undefined, log: (s: string) => void = console.log): void {
  mailDir = join(dir, 'geroi-mail');
  if (!existsSync(mailDir)) return;
  let n = 0;
  for (const f of readdirSync(mailDir)) {
    if (!f.endsWith('.json')) continue;
    const code = f.slice(0, -5);
    const path = join(mailDir, f);
    try {
      const x = JSON.parse(readFileSync(path, 'utf8')) as MapRoomSave;
      if (x.phase === 'over' && Date.now() - statSync(path).mtimeMs > MAIL_KEEP_MS) {
        unlinkSync(path);
        continue;
      }
      const r = MapRoom.restore(x, Date.now, mapHooksFor(mapRatings));
      rooms.set(code, r);
      watchMail(code, r);
      n++;
    } catch (e) {
      renameSync(path, `${path}.bad`);
      log(`Герои по переписке: ${f} испорчен, отложен (${String(e)})`);
    }
  }
  if (n) {
    log(`Герои по переписке: поднято партий ${n}`);
    ensureClock();
  }
}

/** Записать все партии по переписке сейчас (перед выключением). */
export function flushGeroiMail(): void {
  for (const [code, r] of rooms) if (r instanceof MapRoom && r.mail && r.phase !== 'lobby') writeMail(code, r);
}

/** Партии по переписке аккаунта: для списка «Мои партии». */
export function geroiMailOf(user: number): (MailSummary & { code: string })[] {
  const out: (MailSummary & { code: string })[] = [];
  for (const [code, r] of rooms) {
    const s = r instanceof MapRoom ? r.summary(user) : null;
    if (s) out.push({ code, ...s });
  }
  return out.sort((a, b) => Number(b.yours) - Number(a.yours) || Number(a.over) - Number(b.over));
}

/** Сколько раз подряд часы комнаты упали: после порога комнату больше не тикаем (одна сломанная не должна стопорить остальные). */
const tickFails = new WeakMap<object, number>();
const TICK_FAIL_LIMIT = 8;

/** Часы всех комнат: ошибка в одной (например, партия по переписке со старого файла) не прерывает обход и не валит остальные. */
export function tickRooms(log: (s: string) => void = console.log): void {
  for (const [code, r] of rooms) {
    const fails = tickFails.get(r) ?? 0;
    if (fails >= TICK_FAIL_LIMIT) continue;
    try {
      r.tick();
      if (fails) tickFails.set(r, 0);
    } catch (e) {
      tickFails.set(r, fails + 1);
      log(`Герои: комната ${code} упала на часах (${fails + 1}/${TICK_FAIL_LIMIT}): ${(e as Error)?.stack ?? e}`);
    }
  }
}

/** Кончившиеся партии по переписке живут в памяти и на диске неделю (посмотреть итог, скачать запись); потом — убрать, а не ждать перезапуска. */
export function purgeMail(): void {
  if (!mailDir) return;
  for (const [code, r] of rooms) {
    if (!(r instanceof MapRoom) || !r.mail || r.phase !== 'over' || !r.isEmpty) continue;
    const path = mailFile(code);
    try {
      if (existsSync(path) && Date.now() - statSync(path).mtimeMs <= MAIL_KEEP_MS) continue;
      if (existsSync(path)) unlinkSync(path);
    } catch {
      continue;
    }
    rooms.delete(code);
  }
}

let ticks = 0;
function ensureClock(): void {
  clock ??= setInterval(() => {
    tickRooms();
    // раз в минуту
    if (++ticks % 240 === 0) purgeMail();
  }, 250);
}

function sweep(code: string, waited = false): void {
  const r = rooms.get(code);
  // по переписке пустая комната — обычное дело: живёт, пока не кончится (и ещё неделю на диске)
  if (r instanceof MapRoom && r.mail && r.phase !== 'lobby' && (r.phase !== 'over' || (mailDir && existsSync(mailFile(code))))) return;
  if (r?.isEmpty && r.phase !== 'lobby' && r.phase !== 'over' && !waited) {
    setTimeout(() => sweep(code, true), GRACE_MS);
    return;
  }
  if (r?.isEmpty) rooms.delete(code);
  if (!rooms.size && clock) {
    clearInterval(clock);
    clock = null;
  }
}

/** Первое сообщение соединения с game: 'geroi'. user — вошедший игрок (его имя важнее присланного). */
export function geroiFirst(
  send: (m: NetServerMsg) => void,
  close: () => void,
  msg: NetClientMsg,
  genCode: (taken: (c: string) => boolean) => string,
  user: { id: number; name: string; full?: boolean } | null,
  ratings: Ratings,
  mapRatings?: Ratings,
): Link | null {
  const fail = (text: string) => {
    send({ t: 'error', text });
    close();
    return null;
  };
  const m = msg as { name?: unknown; token?: unknown };
  const given = String(m.name ?? 'Пацан').trim().slice(0, 24) || 'Пацан';
  const token = String(m.token ?? '').slice(0, 64);
  if (!token) return fail('Обнови страницу: нет ключа игрока.');
  const peer: RoomPeer = { id: nextPeer++, name: user?.name ?? given, token, user: user?.id ?? null, full: !!user?.full, send };
  const hooks = {
    onResult: (winner: number, users: [number | null, number | null], names: [string, string]) => {
      const w = users[winner]!;
      const l = users[1 - winner]!;
      const before = [ratings.get(w).r, ratings.get(l).r];
      const [a, b] = ratings.apply(w, l, [names[winner], names[1 - winner]]);
      const won = { r: Math.round(a.r), delta: Math.round(a.r - before[0]) };
      const lost = { r: Math.round(b.r), delta: Math.round(b.r - before[1]) };
      return (winner === 0 ? [won, lost] : [lost, won]) as [typeof won, typeof won];
    },
  };

  // рейтинг карты — своя таблица: Арена и карта — разные умения
  const mapHooks = mapHooksFor(mapRatings ?? ratings);

  let room: ArenaRoom | MapRoom | null = null;
  let code = '';
  const enter = (r: ArenaRoom | MapRoom, c: string) => {
    room = r;
    code = c;
  };
  const link: Link = {
    send: (x) => send(x as NetServerMsg),
    close,
    // у Арены и карты свои сообщения: комната сама отбрасывает чужие
    onMessage: (x) => room?.message(peer as never, x as never),
    onClose: () => {
      if (waiting?.peer === peer) waiting = null;
      if (room) {
        room.remove(peer as never);
        sweep(code);
      }
    },
  };

  if (msg.t === 'create') {
    code = genCode((c) => rooms.has(c));
    const r = new ArenaRoom(Number(msg.budget) || DEFAULT_BUDGET, randomInt(1, 2 ** 31 - 1), false, hooks);
    rooms.set(code, r);
    enter(r, code);
    send({ t: 'created', code });
    ensureClock();
    r.add(peer);
    return link;
  }
  if ((msg as { t: string }).t === 'mcreate') {
    const gen = cleanGen((msg as { gen?: unknown }).gen);
    if (!gen) return fail('Непонятные настройки карты.');
    code = genCode((c) => rooms.has(c));
    const r = new MapRoom(gen, Date.now, mapHooks);
    rooms.set(code, r);
    watchMail(code, r);
    enter(r, code);
    send({ t: 'created', code });
    ensureClock();
    r.add(peer as never);
    return link;
  }
  if (msg.t === 'join') {
    const c = String(msg.code || '').toUpperCase();
    const r = rooms.get(c);
    if (!r) return fail('Комната не найдена. Проверьте код.');
    enter(r, c);
    send({ t: 'joined', code: c });
    ensureClock();
    r.add(peer as never);
    return link;
  }
  if (msg.t === 'queue') {
    if (waiting && waiting.peer.token !== token) {
      const first = waiting;
      waiting = null;
      const c = genCode((x) => rooms.has(x));
      const r = new ArenaRoom(DEFAULT_BUDGET, randomInt(1, 2 ** 31 - 1), true, hooks);
      rooms.set(c, r);
      ensureClock();
      first.attach(r, c);
      enter(r, c);
      first.peer.send({ t: 'joined', code: c });
      send({ t: 'joined', code: c });
      r.add(first.peer);
      r.add(peer);
      return link;
    }
    waiting = { peer, attach: enter };
    send({ t: 'queued' });
    return link;
  }
  return fail('Непонятный запрос.');
}

export const geroiRooms = (): number => rooms.size;
