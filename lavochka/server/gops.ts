/* Комнаты ГОПС на сервере: только ретрансляция кадров (src/gops/net/relay.ts), физику сервер не считает.
 * Отдельно от комнат сборника (Room/DEFS) — ГОПС не стол, а своё приложение со своим протоколом. */
import { randomInt } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { Link } from '../src/core/protocol';
import type { NetClientMsg, NetServerMsg } from '../src/gops/net/protocol';
import { cleanSetup } from '../src/gops/net/protocol';
import { GopsRelay, type RelayPeer } from '../src/gops/net/relay';

const rooms = new Map<string, GopsRelay>();
let nextPeer = 1;
let clock: NodeJS.Timeout | null = null;

/** Часы всех комнат — пока есть хоть одна идущая партия. */
function ensureClock(): void {
  if (clock) return;
  clock = setInterval(() => {
    const t = performance.now();
    for (const r of rooms.values()) r.tick(t);
  }, 8);
}

/** Пустую комнату — убрать; начатую партию ждём две минуты (вернутся после обновления страницы). */
const GRACE_MS = 120_000;

function sweep(code: string, waited = false): void {
  const r = rooms.get(code);
  if (r && r.isEmpty && r.isStarted && !waited) {
    setTimeout(() => sweep(code, true), GRACE_MS);
    return;
  }
  if (r && r.isEmpty) rooms.delete(code);
  if (!rooms.size && clock) {
    clearInterval(clock);
    clock = null;
  }
}

/** Первое сообщение соединения с game: 'gops' — создать или войти. genCode — общий генератор кодов сервера. */
export function gopsFirst(
  send: (m: NetServerMsg) => void,
  close: () => void,
  msg: NetClientMsg,
  genCode: (taken: (c: string) => boolean) => string,
): Link | null {
  const fail = (text: string) => {
    send({ t: 'error', text });
    close();
    return null;
  };
  const name = String((msg as { name?: unknown }).name ?? 'Пацан').trim().slice(0, 24) || 'Пацан';
  let code: string;
  let room: GopsRelay;
  let host = false;
  if (msg.t === 'create') {
    const setup = cleanSetup(msg.setup);
    if (!setup) return fail('Неверная настройка партии.');
    code = genCode((c) => rooms.has(c));
    room = new GopsRelay(setup, randomInt(1, 2 ** 31 - 1));
    rooms.set(code, room);
    host = true;
    send({ t: 'created', code });
  } else if (msg.t === 'join') {
    code = String(msg.code || '').toUpperCase();
    const r = rooms.get(code);
    if (!r) return fail('Комната не найдена. Проверьте код.');
    room = r;
    send({ t: 'joined', code });
  } else return fail('Непонятный запрос.');
  ensureClock();
  const peer: RelayPeer = { id: nextPeer++, name, send };
  room.add(peer, host);
  const link: Link = {
    send: (m) => send(m as NetServerMsg),
    close,
    onMessage: (m) => room.message(peer, m as NetClientMsg),
    onClose: () => {
      room.remove(peer);
      sweep(code);
    },
  };
  return link;
}

/** Комнаты ГОПС (для админки/логов). */
export const gopsRooms = (): number => rooms.size;
