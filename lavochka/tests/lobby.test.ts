/* Лобби комнаты: гость пересаживается, хозяин меняет местами, отдаёт место боту, выгоняет, меняет варианты и число мест; аватар и персонаж. */
import { afterEach, describe, expect, it } from 'vitest';
import { localPair, type RoomMsg, type SeatStatus } from '../src/core/protocol';
import { Room } from '../src/core/room';
import type { SeatSpec } from '../src/core/types';
import { DEFS } from '../src/games/defs';
import { AutoClient, until } from './harness';

const rooms: Room[] = [];
afterEach(() => rooms.splice(0).forEach((r) => r.close()));

async function setup() {
  const def = await DEFS.durak();
  const seats: SeatSpec[] = [
    { seat: 0, kind: 'human', name: 'Хозяин', level: 1 },
    { seat: 1, kind: 'remote', name: '', level: 1 },
    { seat: 2, kind: 'remote', name: '', level: 1 },
  ];
  const room = new Room({ def, options: { throwers: 'all' }, seats, code: 'TEST', ownerKey: 'key', botDelay: 0 });
  rooms.push(room);
  const join = (name: string, ownerKey?: string, seed = 1) => {
    const [a, b] = localPair();
    room.connect(a);
    return new AutoClient(def, b, name, ownerKey, seed);
  };
  return { def, room, join };
}

type Lobby = Extract<RoomMsg, { t: 'lobby' }>;
const lastLobby = (c: AutoClient) => c.log.filter((m): m is Lobby => m.t === 'lobby').pop();
const seat = (l: Lobby | undefined, n: number): SeatStatus | undefined => l?.seats.find((s) => s.seat === n);

describe('лобби', () => {
  it('гость садится на свободное место и передаёт аватар и персонажа', async () => {
    const { join } = await setup();
    const owner = join('Хозяин', 'key');
    const guest = join('Гость');
    await until(() => seat(lastLobby(owner), 1)?.filled === true, 3000, 'гость сел');
    guest.client.sit(2);
    await until(() => seat(lastLobby(owner), 2)?.filled === true && !seat(lastLobby(owner), 1)?.filled, 3000, 'пересел');
    expect(lastLobby(guest)!.mySeats).toEqual([2]);
    guest.client.me({ name: 'Петя', avatar: '🦊', look: 'lenka' });
    await until(() => seat(lastLobby(owner), 2)?.name === 'Петя', 3000, 'имя');
    expect(seat(lastLobby(owner), 2)).toMatchObject({ avatar: '🦊', look: 'lenka' });
    // чужой адрес вместо аватара не проходит
    guest.client.me({ avatar: 'https://evil.example/x.png' });
    await until(() => seat(lastLobby(owner), 2)?.avatar === null, 3000, 'аватар отброшен');
  });

  it('хозяин меняет местами, отдаёт место боту и выгоняет', async () => {
    const { join } = await setup();
    const owner = join('Хозяин', 'key');
    const guest = join('Гость');
    await until(() => seat(lastLobby(owner), 1)?.filled === true, 3000, 'гость сел');
    owner.client.host({ op: 'swap', a: 0, b: 1 });
    await until(() => seat(lastLobby(owner), 0)?.kind === 'remote', 3000, 'обмен');
    expect(lastLobby(owner)!.mySeats).toEqual([1]);
    expect(lastLobby(guest)!.mySeats).toEqual([0]);
    owner.client.host({ op: 'kind', seat: 2, kind: 'bot', level: 2 });
    await until(() => seat(lastLobby(owner), 2)?.kind === 'bot', 3000, 'бот');
    expect(seat(lastLobby(owner), 2)!.level).toBe(2);
    owner.client.host({ op: 'kick', seat: 0 });
    await until(() => guest.log.some((m) => m.t === 'closed'), 3000, 'гостя выгнали');
    await until(() => seat(lastLobby(owner), 0)?.filled === false, 3000, 'место свободно');
    // выгнанный не возвращается
    const again = new AutoClient((await DEFS.durak()), (() => {
      const [a, b] = localPair();
      rooms[0].connect(a);
      return b;
    })(), 'Гость', undefined, 1);
    await until(() => again.log.some((m) => m.t === 'closed'), 3000, 'не пустили обратно');
  });

  it('пресет «2 на 2» на трёх местах не проходит, вчетвером — проходит; гость не теряется', async () => {
    const { def, join } = await setup();
    const owner = join('Хозяин', 'key');
    join('Гость');
    await until(() => seat(lastLobby(owner), 1)?.filled === true, 3000, 'гость сел');
    const pairs = def.presets!.find((p) => p.id === 'pairs')!.options;
    owner.client.host({ op: 'setup', options: { ...pairs }, count: 3 });
    await until(() => owner.log.some((m) => m.t === 'error'), 3000, 'отказ на трёх');
    owner.client.host({ op: 'setup', options: { ...pairs }, count: 4 });
    await until(() => lastLobby(owner)?.seats.length === 4, 3000, 'четыре места');
    const l = lastLobby(owner)!;
    expect(l.options.teams).toBe(true);
    expect(seat(l, 1)?.filled).toBe(true);
    expect(def.teams!(l.options, [0, 1, 2, 3])).toEqual([[0, 2], [1, 3]]);
    // обратно на двоих: гость с места 2… остаётся, лишние места убраны
    owner.client.host({ op: 'setup', options: { teams: false }, count: 2 });
    await until(() => lastLobby(owner)?.seats.length === 2, 3000, 'два места');
    expect(lastLobby(owner)!.seats.filter((s) => s.filled && s.kind === 'remote').length).toBe(1);
  });
});
