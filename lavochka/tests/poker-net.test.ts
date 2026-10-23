/* Sit&Go по сети (покер, этап 8): люди и боты за одним столом, обрыв — «сидит вне игры» (чек/пас), возврат на своё место. */
import { afterEach, describe, expect, it } from 'vitest';
import { localPair } from '../src/core/protocol';
import { Room } from '../src/core/room';
import type { SeatSpec } from '../src/core/types';
import { DEFS } from '../src/games/defs';
import { AutoClient, until } from './harness';

const rooms: Room[] = [];
afterEach(() => rooms.splice(0).forEach((r) => r.close()));

const SNG = { mode: 'holdem', struct: 'auto', tour: 'sng6', speed: 'hyper', tkind: 'freeze', late: false, bank: false, buyin: 100 };

async function setup(dropGraceMs = 0) {
  const def = await DEFS.poker();
  // как собирает лобби «По сети»: хозяин, два места для друзей, остальное — боты
  const seats: SeatSpec[] = [
    { seat: 0, kind: 'human', name: 'Хозяин', level: 1 },
    { seat: 1, kind: 'remote', name: '', level: 1 },
    { seat: 2, kind: 'remote', name: '', level: 1 },
    { seat: 3, kind: 'bot', name: 'Серёга (бот)', level: 2 },
  ];
  const room = new Room({ def, options: SNG, seats, code: 'SNG01', ownerKey: 'key', botDelay: 0, dropGraceMs });
  rooms.push(room);
  const join = (name: string, ownerKey?: string, seed = 1) => {
    const [a, b] = localPair();
    room.connect(a);
    return { client: new AutoClient(def, b, name, ownerKey, seed), link: b };
  };
  return { def, room, join };
}

type Act = { type: 'act'; seat: number; action: { type: string } };
const actsOf = (c: AutoClient, seat: number, from = 0) =>
  c.log
    .slice(from)
    .flatMap((m) => (m.t === 'step' ? (m.events as Act[]) : []))
    .filter((e) => e?.type === 'act' && e.seat === seat)
    .map((e) => e.action.type);

describe('Sit&Go по сети', () => {
  it('друг садится, пустое место занимает бот; турнир доигрывается, у всех один стол и места людей в итоге', async () => {
    const { join } = await setup();
    const owner = join('Хозяин', 'key', 1).client;
    const guest = join('Гость', undefined, 2).client;
    await until(() => owner.log.some((m) => m.t === 'lobby' && m.seats.filter((s) => s.filled).length === 3), 5000, 'гость в лобби');
    owner.client.start(true); // не пришедшего — ботом
    await until(() => owner.has('start') && guest.has('start'), 5000, 'старт у обоих');
    expect(guest.mySeats).toEqual([1]);
    const T = owner.view.tour;
    expect(T.players.filter((p: { human: boolean }) => p.human).map((p: { name: string }) => p.name)).toEqual(['Хозяин', 'Гость']);
    expect(T.players.length).toBe(4);
    await until(() => !!owner.result, 120_000, 'конец турнира');
    await until(() => guest.seq === owner.seq, 5000, 'гость догнал');
    expect(guest.result).toEqual(owner.result);
    // в итоге — места обоих людей
    expect(owner.result.text).toMatch(/Хозяин — \d-е/);
    expect(owner.result.text).toMatch(/Гость — \d-е/);
  }, 150_000);

  it('обрыв — «сидит вне игры»: после ожидания только чек или пас; вернулся — снова играет сам', async () => {
    const { join } = await setup(300);
    const owner = join('Хозяин', 'key', 1).client;
    const g = join('Гость', undefined, 2);
    await until(() => owner.log.some((m) => m.t === 'lobby' && m.seats.filter((s) => s.filled).length === 3), 5000, 'гость в лобби');
    owner.client.start(true);
    await until(() => owner.seq > 10, 20000, 'турнир пошёл');

    g.client.playing = false;
    g.link.close();
    await until(() => owner.log.some((m) => m.t === 'info' && m.text.includes('сидит вне игры')), 5000, 'сообщение об обрыве');
    const from = owner.log.length;
    await until(() => actsOf(owner, 1, from).length >= 4 || !!owner.result, 60000, 'ходы за отключившегося');
    const away = actsOf(owner, 1, from);
    expect(away.length).toBeGreaterThan(0);
    expect(away.every((a) => a === 'check' || a === 'fold')).toBe(true);

    if (!owner.result) {
      const back = join('Гость', undefined, 3).client;
      await until(() => back.has('start'), 5000, 'гость вернулся');
      expect(back.mySeats).toEqual([1]);
      expect(owner.log.some((m) => m.t === 'info' && m.text.includes('снова в игре'))).toBe(true);
      await until(() => !!owner.result, 120_000, 'конец турнира');
      await until(() => back.seq === owner.seq, 5000, 'гость догнал');
      expect(JSON.stringify(back.view.tour.players)).toBe(JSON.stringify(owner.view.tour.players));
    }
  }, 200_000);
});
