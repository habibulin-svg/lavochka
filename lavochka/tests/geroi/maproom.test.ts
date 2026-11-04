import { describe, expect, it } from 'vitest';
import { botStep, newMem } from '../../src/geroi/bot/advbot';
import { botAction } from '../../src/geroi/bot/bot';
import { type MapServerMsg, cleanAdvAction, eventsView, worldView } from '../../src/geroi/net/mapproto';
import { MAP_BANK_MS, MAP_GONE_MS, MapRoom, type MapPeer } from '../../src/geroi/net/maproom';
import { currentUnit } from '../../src/geroi/sim/battle';
import { type GenOptions, generateMap } from '../../src/geroi/sim/adv/gen';
import { factionClasses } from '../../src/geroi/sim/heroes';
import { act, heroAt } from '../../src/geroi/sim/adv/world';

const GEN: GenOptions = { template: 'duel', size: 's', water: 'lakes', guard: 'normal', seed: 7 };

function peer(id: number, token: string): MapPeer & { box: MapServerMsg[]; last<T extends MapServerMsg['t']>(t: T): Extract<MapServerMsg, { t: T }> } {
  const box: MapServerMsg[] = [];
  return {
    id, name: token, token, user: null, box,
    send: (m) => box.push(JSON.parse(JSON.stringify(m))),
    last<T extends MapServerMsg['t']>(t: T) {
      const m = [...box].reverse().find((x) => x.t === t);
      if (!m) throw new Error(`нет сообщения ${t}`);
      return m as Extract<MapServerMsg, { t: T }>;
    },
  };
}

function setup() {
  let t = 1000;
  const room = new MapRoom(GEN, () => t);
  const a = peer(1, 'a');
  const b = peer(2, 'b');
  room.add(a);
  room.add(b);
  return { room, a, b, adv: (ms: number) => (t += ms) };
}

describe('geroi/maproom: сеть карты', () => {
  it('лобби: двое садятся, хозяин меняет карту и ставит ботов, старт — мир у каждого свой', () => {
    const { room, a, b } = setup();
    expect(a.last('mlobby').host).toBe(true);
    expect(b.last('mlobby').seat).toBe(1);
    // чужой не командует
    room.message(b, { t: 'mgen', gen: { ...GEN, template: 'four', size: 'm' } });
    expect(room.gen.template).toBe('duel');
    room.message(a, { t: 'mgen', gen: { ...GEN, template: 'four', size: 'm' } });
    expect(a.last('mlobby').seats).toHaveLength(4);
    // в занятое человеком место бота не посадить
    room.message(a, { t: 'mbot', seat: 1, bot: 'hard' });
    expect(a.last('mlobby').seats[1].bot).toBeNull();
    room.message(a, { t: 'mbot', seat: 2, bot: 'hard' });
    expect(a.last('mlobby').seats[2].bot).toBe('hard');
    room.message(a, { t: 'mgen', gen: GEN });
    room.message(b, { t: 'mseat', faction: 'kuznya', hero: { cls: factionClasses('kuznya')[1].id, n: 3 } });
    expect(a.last('mlobby').seats[1].faction).toBe('kuznya');
    room.message(a, { t: 'start' });
    expect(room.phase).toBe('map');
    const sa = a.last('mstart');
    const sb = b.last('mstart');
    expect(sa.seat).toBe(0);
    expect(sb.seat).toBe(1);
    // чужие ресурсы и туман не уходят
    expect(sa.world.players[1].explored).toEqual([]);
    expect(sa.world.players[1].res.semki).toBe(0);
    expect(sb.world.players[1].res.semki).toBeGreaterThan(0);
    expect(sa.world.heroes.every((h) => h.owner === 0 || sa.world.players[0].explored[h.cell])).toBe(true);
    expect(sa.world.rng).toBe(0);
  });

  it('ходит только тот, чей ход; действие проверяет сервер', () => {
    const { room, a, b } = setup();
    room.message(a, { t: 'start' });
    room.message(b, { t: 'adv', a: { t: 'end' } });
    expect(b.last('mnope').why).toMatch(/не твой/);
    room.message(a, { t: 'adv', a: { t: 'move', hero: 999, to: 1 } });
    expect(a.last('mnope')).toBeTruthy();
    room.message(a, { t: 'adv', a: { t: 'end' } });
    expect(room.world!.current).toBe(1);
    expect(b.last('mstep').world.current).toBe(1);
  });

  it('бот на месте ходит сам; пропавший человек — тоже через минуту, потом место его', () => {
    const { room, a, b, adv } = setup();
    room.message(a, { t: 'mbot', seat: 1, bot: 'medium' });
    // b сел на место 1 раньше — бота туда нельзя; выходит из лобби, место освобождается
    room.remove(b);
    room.message(a, { t: 'mbot', seat: 1, bot: 'medium' });
    room.message(a, { t: 'start' });
    room.message(a, { t: 'adv', a: { t: 'end' } });
    const day0 = room.world!.day;
    for (let i = 0; i < 400 && room.world!.current === 1; i++) {
      adv(250);
      room.tick();
    }
    expect(room.world!.current).toBe(0);
    expect(room.world!.day).toBe(day0 + 1);
    // человек пропал: ждём минуту, потом за него ходит бот
    room.remove(a);
    adv(MAP_GONE_MS - 1000);
    room.tick();
    expect(room.world!.current).toBe(0);
    adv(2000);
    for (let i = 0; i < 400 && room.world!.current === 0; i++) {
      adv(250);
      room.tick();
    }
    expect(room.world!.current).toBe(1);
    // вернулся — снова сам
    const a2 = peer(3, 'a');
    room.add(a2);
    expect(a2.last('mstart').seat).toBe(0);
  });

  it('кончился запас хода — ход кончается', () => {
    const { room, a, adv } = setup();
    room.message(a, { t: 'start' });
    expect(room.world!.current).toBe(0);
    adv(MAP_BANK_MS + 1000);
    for (let i = 0; i < 400 && room.world!.current === 0; i++) {
      adv(250);
      room.tick();
    }
    expect(room.world!.current).toBe(1);
  });

  it('партия двух людей с ботами за руль доходит до конца; бои людей идут по сети', () => {
    const { room, a, b, adv } = setup();
    room.message(a, { t: 'start' });
    const peers = [a, b];
    const mems = [newMem(), newMem()];
    let fights = 0;
    for (let i = 0; i < 20000 && room.phase === 'map'; i++) {
      const w = room.world!;
      const f = (room as unknown as { fight: { state: Parameters<typeof botAction>[0]; seats: (number | null)[] } | null }).fight;
      if (f) {
        const u = currentUnit(f.state)!;
        const seat = f.seats[u.side];
        if (seat !== null) room.message(peers[seat], { t: 'act', a: botAction(f.state, 'medium') });
        else {
          adv(500);
          room.tick();
        }
        continue;
      }
      // человек действует по своему виду мира, как клиент
      const me = w.current;
      const view = worldView(w, me);
      const a0 = botStep(view, 'medium', mems[me]);
      const before = JSON.stringify(view.heroes.map((h) => [h.cell, h.mp]));
      room.message(peers[me], { t: 'adv', a: a0 });
      if (room.phase !== 'map') break;
      if ((room as unknown as { fight: unknown }).fight) fights++;
      // на всякий случай: действие не прошло — конец хода
      const nope = peers[me].box.at(-1);
      if (nope?.t === 'mnope' && JSON.stringify(worldView(room.world!, me).heroes.map((h) => [h.cell, h.mp])) === before) room.message(peers[me], { t: 'adv', a: { t: 'end' } });
      adv(50);
    }
    expect(room.phase).toBe('over');
    expect(fights).toBeGreaterThan(0);
    expect(a.last('mover').winner).toBeGreaterThanOrEqual(0);
  });

  it('сдача: соперник побеждает', () => {
    const { room, a, b } = setup();
    room.message(a, { t: 'start' });
    room.message(b, { t: 'resign' });
    expect(room.phase).toBe('over');
    expect(a.last('mover').winner).toBe(0);
  });

  it('вид мира и событий: чужой шаг в тумане не уходит, чужой бой не виден', () => {
    const spec = {
      seed: 3,
      players: [
        { name: 'А', faction: 'zatulye' as const, hero: { cls: factionClasses('zatulye')[0].id, n: 1 } },
        { name: 'Б', faction: 'zatonye' as const, hero: { cls: factionClasses('zatonye')[0].id, n: 1 } },
      ],
    };
    const w = generateMap(spec, { ...GEN, seed: 3 });
    const h1 = w.heroes.find((h) => h.owner === 1)!;
    w.current = 1;
    const to = [h1.cell - 1, h1.cell + 1, h1.cell - w.w, h1.cell + w.w].find((c) => !w.block[c] && !heroAt(w, c) && w.terrain[c] !== 6 && w.entries[c] === undefined)!;
    const ev = act(w, { t: 'move', hero: h1.id, to });
    expect(ev.some((e) => e.e === 'step')).toBe(true);
    expect(eventsView(w, ev, 0, 1).some((e) => e.e === 'step')).toBe(false);
    expect(eventsView(w, ev, 1, 1)).toEqual(ev);
    expect(worldView(w, 0).heroes.some((h) => h.id === h1.id)).toBe(false);
  });

  it('сеть: мусор вместо действия отбрасывается', () => {
    expect(cleanAdvAction({ t: 'move', hero: -1, to: 2 })).toBeNull();
    expect(cleanAdvAction({ t: 'market', give: 'gold', get: 'wood', amount: 5 })).toBeNull();
    expect(cleanAdvAction({ t: 'transfer', from: { h: 1 }, fromSlot: 9, to: { t: 0 }, toSlot: 0 })).toBeNull();
    expect(cleanAdvAction({ t: 'tavern', town: 0, hero: null, pick: { cls: 'zatulye-sotnik', n: 2 } })).toEqual({ t: 'tavern', town: 0, hero: null, pick: { cls: 'zatulye-sotnik', n: 2 } });
    expect(cleanAdvAction({ t: '__proto__' })).toBeNull();
  });
});
