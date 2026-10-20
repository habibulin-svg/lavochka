/* Комната: лобби, старт, бот вместо отключившегося, возврат на своё место, синхронность у всех. */
import { afterEach, describe, expect, it } from 'vitest';
import { localPair, type RoomMsg } from '../src/core/protocol';
import type { Snapshot } from '../src/core/authority';
import { Room, noVideoSend } from '../src/core/room';
import type { SeatSpec } from '../src/core/types';
import { DEFS } from '../src/games/defs';
import { AutoClient, until } from './harness';

const rooms: Room[] = [];
const CRLF = String.fromCharCode(13, 10);
afterEach(() => rooms.splice(0).forEach((r) => r.close()));

async function setup(dropGraceMs = 0) {
  const def = await DEFS.shishbesh();
  const seats: SeatSpec[] = [
    { seat: 3, kind: 'human', name: 'Хозяин', level: 1 },
    { seat: 1, kind: 'remote', name: '', level: 1 },
  ];
  const room = new Room({ def, options: {}, seats, code: 'TEST', ownerKey: 'key', botDelay: 0, dropGraceMs });
  rooms.push(room);
  const join = (name: string, ownerKey?: string, seed = 1, video?: boolean) => {
    const [a, b] = localPair();
    // право на камеру сервер пишет в канал со стороны комнаты
    if (video !== undefined) a.video = video;
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

  it('за отключившегося бот садится не сразу — сначала его ждут', async () => {
    const { join } = await setup(2500);
    const owner = join('Хозяин', 'key', 1).client;
    const g = join('Гость', undefined, 2);
    await until(() => owner.log.some((m) => m.t === 'lobby' && m.seats.every((s) => s.filled)));
    g.client.playing = false;
    owner.client.start(false);
    await until(() => owner.has('start'), 5000, 'старт');
    g.link.close();
    await until(() => owner.log.some((m) => m.t === 'info' && m.text.includes('ждём')), 5000, 'сообщение об ожидании');
    // хозяин доходит до хода гостя, а дальше стол стоит: бот за гостя пока не ходит
    const last = () => owner.log.filter((m) => m.t === 'start' || m.t === 'step').pop() as { toAct: number[]; seq: number };
    await until(() => last().toAct.includes(1), 5000, 'ход гостя');
    const at = owner.seq;
    await new Promise((r) => setTimeout(r, 700));
    expect(owner.seq).toBe(at);
    await until(() => owner.seq > at, 6000, 'после ожидания ходит бот');
  }, 30_000);

  it('по запросу «sync» комната присылает тот же стол заново', async () => {
    const { join } = await setup();
    const owner = join('Хозяин', 'key', 1).client;
    join('Гость', undefined, 2);
    await until(() => owner.log.some((m) => m.t === 'lobby' && m.seats.every((s) => s.filled)));
    owner.client.start(false);
    await until(() => owner.seq > 3, 10000);
    owner.client.sync();
    await until(() => owner.log.some((m) => m.t === 'start' && m.resync), 5000, 'стол заново');
  }, 30_000);

  it('если хозяин вышел из лобби — комната закрывается у всех', async () => {
    const { join } = await setup();
    const o = join('Хозяин', 'key', 1);
    const guest = join('Гость', undefined, 2).client;
    await until(() => guest.has('lobby'));
    o.client.client.leave();
    await until(() => guest.has('closed'), 5000, 'гостю пришло закрытие');
  });

  it('хозяин потерял связь в лобби (обновил страницу) — комната ждёт, он возвращается по ключу', async () => {
    const { join } = await setup();
    const o = join('Хозяин', 'key', 1);
    const guest = join('Гость', undefined, 2).client;
    await until(() => guest.has('lobby'));
    o.link.close();
    await until(() => guest.log.some((m) => m.t === 'info' && /ждём минуту/.test(m.text)), 5000, 'гостю сказали, что ждём');
    const back = join('Хозяин', 'key', 1).client;
    await until(() => back.has('welcome'), 5000, 'хозяин вернулся');
    expect(back.log.find((m) => m.t === 'welcome')).toMatchObject({ owner: true });
    expect(guest.has('closed')).toBe(false);
  });

  it('партия из сохранения на ходу бота: бот ходит, когда хозяин вернулся', async () => {
    const def = await DEFS.shishbesh();
    const seats: SeatSpec[] = [
      { seat: 3, kind: 'human', name: 'Хозяин', level: 1 },
      { seat: 1, kind: 'bot', name: 'Бот', level: 1 },
    ];
    let saved: Snapshot | null = null;
    const first: Room = new Room({
      def, options: {}, seats, code: 'TEST', ownerKey: 'key', botDelay: 0,
      onSnapshot: (s) => {
        if (s && !saved && first.auth?.toAct().includes(1)) saved = JSON.parse(JSON.stringify(s));
      },
    });
    rooms.push(first);
    const [a, b] = localPair();
    first.connect(a);
    const owner = new AutoClient(def, b, 'Хозяин', 'key', 1);
    owner.client.start(false);
    await until(() => !!saved || !!owner.result, 20000, 'ход бота в сохранении');
    expect(saved).not.toBeNull();
    first.close();

    // перезагрузка страницы: комната заново из сохранения, хозяин сам не ходит
    const room = new Room({ def, options: {}, seats, code: 'TEST', ownerKey: 'key', botDelay: 0, snapshot: saved! });
    rooms.push(room);
    const [c, d] = localPair();
    room.connect(c);
    const back = new AutoClient(def, d, 'Хозяин', 'key', 2);
    back.playing = false;
    await until(() => back.has('start'), 5000, 'стол из сохранения');
    // seq стола из сохранения (а не текущий: бот мог походить, пока мы ждали start)
    const st = back.log.find((m) => m.t === 'start') as Extract<RoomMsg, { t: 'start' }>;
    await until(() => back.seq > st.seq, 10000, 'бот пошёл');
  }, 30_000);

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

  it('без права на камеру: в списке без видео, своё видео в SDP — только на приём', async () => {
    const { join } = await setup();
    const owner = join('Хозяин', 'key', 1, true).client;
    const guest = join('Гость', undefined, 2, false).client;
    await until(() => owner.log.some((m) => m.t === 'lobby' && m.seats.every((s) => s.filled)), 5000, 'гость в лобби');
    owner.client.voice(true, true);
    guest.client.voice(true, true);
    await until(() => owner.log.some((m) => m.t === 'voice' && m.members.length === 2), 5000, 'оба в чате');
    const list = owner.log.filter((m) => m.t === 'voice').pop() as { members: { id: string; video: boolean }[] };
    expect(list.members.find((m) => m.id === 'Хозяин')?.video).toBe(true);
    expect(list.members.find((m) => m.id === 'Гость')?.video).toBe(false);
    const sdp = ['v=0', 'm=audio 9 UDP', 'a=sendrecv', 'm=video 9 UDP', 'a=sendrecv', 'm=video 9 UDP', 'a=sendonly', ''].join(CRLF);
    guest.client.rtc('Хозяин', { description: { type: 'offer', sdp } });
    owner.client.rtc('Гость', { description: { type: 'answer', sdp } });
    await until(() => owner.log.some((m) => m.t === 'rtc') && guest.log.some((m) => m.t === 'rtc'), 5000, 'сигналы дошли');
    const got = (c: typeof owner) => (c.log.find((m) => m.t === 'rtc') as any).data.description.sdp as string;
    expect(got(owner)).toBe(['v=0', 'm=audio 9 UDP', 'a=sendrecv', 'm=video 9 UDP', 'a=recvonly', 'm=video 9 UDP', 'a=inactive', ''].join(CRLF));
    // у подписчика SDP не трогаем
    expect(got(guest)).toBe(sdp);
    expect(noVideoSend({ candidate: { candidate: 'x' } })).toEqual({ candidate: { candidate: 'x' } });
  });
});
