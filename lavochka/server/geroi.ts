/* Арена «Героев» на сервере: комнаты по коду, подбор соперника, рейтинг (src/geroi/net/room.ts — сама комната, здесь сокеты и хранение).
 * Рейтинг — файл в DATA_DIR, как рекорды: одна запись на вошедшего игрока. */
import { randomInt } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Link } from '../src/core/protocol';
import { DEFAULT_BUDGET, type NetClientMsg, type NetServerMsg } from '../src/geroi/net/protocol';
import { type Rating, START_RATING, afterGame } from '../src/geroi/net/rating';
import { ArenaRoom, type RoomPeer } from '../src/geroi/net/room';

const rooms = new Map<string, ArenaRoom>();
let waiting: { peer: RoomPeer; attach: (room: ArenaRoom, code: string) => void } | null = null;
let nextPeer = 1;
let clock: NodeJS.Timeout | null = null;
/** Опустевшую начатую партию ждём: вернутся после обновления страницы. */
const GRACE_MS = 150_000;

interface Row extends Rating {
  name: string;
  at: number;
}

export class Ratings {
  private rows: Record<string, Row> = {};
  private timer: NodeJS.Timeout | undefined;
  private file: string;

  constructor(private readonly dir: string, private log: (s: string) => void = console.log) {
    this.file = join(dir, 'geroi-rating.json');
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

  get(user: number): Rating {
    return this.rows[user] ?? START_RATING;
  }

  apply(winner: number, loser: number, names: [string, string]): [Row, Row] {
    const [a, b] = afterGame(this.get(winner), this.get(loser));
    const at = Date.now();
    const rows: [Row, Row] = [{ ...a, name: names[0], at }, { ...b, name: names[1], at }];
    this.rows[winner] = rows[0];
    this.rows[loser] = rows[1];
    this.save();
    return rows;
  }

  top(n: number): { name: string; r: number; wins: number; losses: number }[] {
    return Object.values(this.rows)
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
  }
}

function ensureClock(): void {
  clock ??= setInterval(() => {
    for (const r of rooms.values()) r.tick();
  }, 250);
}

function sweep(code: string, waited = false): void {
  const r = rooms.get(code);
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
  user: { id: number; name: string } | null,
  ratings: Ratings,
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
  const peer: RoomPeer = { id: nextPeer++, name: user?.name ?? given, token, user: user?.id ?? null, send };
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

  let room: ArenaRoom | null = null;
  let code = '';
  const enter = (r: ArenaRoom, c: string) => {
    room = r;
    code = c;
  };
  const link: Link = {
    send: (x) => send(x as NetServerMsg),
    close,
    onMessage: (x) => room?.message(peer, x as NetClientMsg),
    onClose: () => {
      if (waiting?.peer === peer) waiting = null;
      if (room) {
        room.remove(peer);
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
  if (msg.t === 'join') {
    const c = String(msg.code || '').toUpperCase();
    const r = rooms.get(c);
    if (!r) return fail('Комната не найдена. Проверьте код.');
    enter(r, c);
    send({ t: 'joined', code: c });
    ensureClock();
    r.add(peer);
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
