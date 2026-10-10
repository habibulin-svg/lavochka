/* Комната: лобби, старт, бот вместо отключившегося, возврат на своё место, синхронность у всех. */
import { afterEach, describe, expect, it } from 'vitest';
import { localPair } from '../src/core/protocol';
import { Room } from '../src/core/room';
import type { SeatSpec } from '../src/core/types';
import { DEFS } from '../src/games/defs';
import { AutoClient, until } from './harness';

const rooms: Room[] = [];
afterEach(() => rooms.splice(0).forEach((r) => r.close()));

async function setup() {
  const def = await DEFS.shishbesh();
  const seats: SeatSpec[] = [
    { seat: 3, kind: 'human', name: 'Хозяин', level: 1 },
    { seat: 1, kind: 'remote', name: '', level: 1 },
  ];
  const room = new Room({ def, options: {}, seats, code: 'TEST', ownerKey: 'key', botDelay: 0 });
  rooms.push(room);
  const join = (name: string, ownerKey?: string, seed = 1) => {
    const [a, b] = localPair();
    room.connect(a);
    return { client: new AutoClient(def, b, name, ownerKey, seed), link: b };
  };
  return { def, room, join };
}

describe('комната', () => {
  it('гость занимает место, хозяин начинает, партия идёт до конца у обоих одинаково', async () => {
    const { join } = await setup();
    const owner = join('Хозяин', 'key', 1).client;
    const guest = join('Гость', undefined, 2).client;
    await until(() => owner.log.some((m) => m.t === 'lobby' && m.seats.every((s) => s.filled)), 5000, 'гость в лобби');
    owner.client.start(false);
    await until(() => owner.has('start') && guest.has('start'), 5000, 'старт у обоих');
    expect(owner.mySeats).toEqual([3]);
    expect(guest.mySeats).toEqual([1]);
    await until(() => !!owner.result, 60000, 'конец партии');
    await until(() => guest.seq === owner.seq, 5000, 'гость догнал');
    expect(JSON.stringify(guest.view)).toBe(JSON.stringify(owner.view));
  }, 90_000);

  it('за отключившегося ходит бот, вернувшийся получает своё место', async () => {
    const { join } = await setup();
    const owner = join('Хозяин', 'key', 1).client;
    const g = join('Гость', undefined, 2);
    await until(() => owner.log.some((m) => m.t === 'lobby' && m.seats.every((s) => s.filled)));
    owner.client.start(false);
    await until(() => owner.seq > 20, 20000, '20 ходов');

    g.client.playing = false;
    g.link.close();
    await until(() => owner.log.some((m) => m.t === 'info' && m.text.includes('потерял связь')), 5000, 'сообщение об обрыве');
    const at = owner.seq;
    await until(() => owner.seq > at + 15 || !!owner.result, 20000, 'бот играет за гостя');

    const back = join('Гость', undefined, 3).client;
    await until(() => back.has('start'), 5000, 'гость вернулся');
    expect(back.mySeats).toEqual([1]);
    expect(owner.log.some((m) => m.t === 'info' && m.text.includes('снова в игре'))).toBe(true);
    await until(() => !!owner.result, 60000, 'конец партии');
    await until(() => back.seq === owner.seq, 5000, 'гость догнал');
    expect(JSON.stringify(back.view)).toBe(JSON.stringify(owner.view));
  }, 120_000);

  it('если хозяин ушёл из лобби — комната закрывается у всех', async () => {
    const { join } = await setup();
    const o = join('Хозяин', 'key', 1);
    const guest = join('Гость', undefined, 2).client;
    await until(() => guest.has('lobby'));
    o.link.close();
    await until(() => guest.has('closed'), 5000, 'гостю пришло закрытие');
  });

  it('третий лишний становится зрителем и видит партию', async () => {
    const { join } = await setup();
    const owner = join('Хозяин', 'key', 1).client;
    join('Гость', undefined, 2);
    const extra = join('Сосед', undefined, 3).client;
    await until(() => extra.log.some((m) => m.t === 'info' && m.text.includes('зритель')), 5000, 'зритель');
    owner.client.start(false);
    await until(() => extra.has('start'), 5000);
    expect(extra.mySeats).toEqual([]);
    await until(() => owner.seq > 5, 10000);
    await until(() => extra.seq === owner.seq, 5000);
  }, 30_000);
});

describe('голосовой чат', () => {
  it('комната ведёт список участников и пересылает сигналы только между ними', async () => {
    const { join } = await setup();
    const owner = join('Хозяин', 'key', 1).client;
    const guest = join('Гость', undefined, 2).client;
    await until(() => owner.log.some((m) => m.t === 'lobby' && m.seats.every((s) => s.filled)), 5000, 'гость в лобби');
    // не в чате — сигнал не уходит
    guest.client.rtc('Хозяин', { candidate: { candidate: 'x' } });
    owner.client.voice(true, true);
    await until(() => guest.log.some((m) => m.t === 'voice' && m.members.length === 1), 5000, 'список у гостя');
    const list = guest.log.filter((m) => m.t === 'voice').pop();
    expect(list && list.t === 'voice' && list.members[0]).toMatchObject({ id: 'Хозяин', video: true });
    guest.client.voice(true);
    await until(() => owner.log.some((m) => m.t === 'voice' && m.members.length === 2), 5000, 'оба в чате');
    guest.client.rtc('Хозяин', { description: { type: 'offer', sdp: 'v=0' } });
    await until(() => owner.log.some((m) => m.t === 'rtc'), 5000, 'сигнал дошёл');
    const sig = owner.log.filter((m) => m.t === 'rtc');
    expect(sig.length).toBe(1);
    expect(sig[0]).toMatchObject({ from: 'Гость', data: { description: { type: 'offer' } } });
    // гость вышел — список обновился
    guest.client.voice(false);
    await until(() => owner.log.filter((m) => m.t === 'voice').pop()?.t === 'voice' && (owner.log.filter((m) => m.t === 'voice').pop() as { members: unknown[] }).members.length === 1, 5000, 'гость вышел из чата');
  });
});
