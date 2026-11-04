import { describe, expect, it } from 'vitest';
import { botStep, newMem } from '../../src/geroi/bot/advbot';
import { botAction } from '../../src/geroi/bot/bot';
import { type MapServerMsg, cleanAdvAction, eventsView, worldView } from '../../src/geroi/net/mapproto';
import { CONTACT, FREE_GAP, MAP_BANK_MS, MAP_GONE_MS, MapRoom, type MapPeer, enemyGap } from '../../src/geroi/net/maproom';
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

/** Комната на двоих; по умолчанию ходы по очереди (одновременные — свои тесты). */
function setup(simul = false, gen = GEN) {
  let t = 1000;
  const room = new MapRoom(gen, () => t);
  const a = peer(1, 'a');
  const b = peer(2, 'b');
  room.add(a);
  room.add(b);
  room.message(a, { t: 'msimul', on: simul });
  return { room, a, b, adv: (ms: number) => (t += ms) };
}

type Fights = { fights: { state: Parameters<typeof botAction>[0]; seats: (number | null)[] }[] };
const fightsOf = (room: MapRoom) => (room as unknown as Fights).fights;

/** Двое людей играют ботами карты, как клиенты: каждый по своему виду мира; бои людей — по сети. */
function playOut(room: MapRoom, peers: ReturnType<typeof peer>[], adv: (ms: number) => void, limit: number, maxDay = Infinity): { fights: number; freeDays: number; lateDays: number } {
  const mems = [newMem(), newMem()];
  let fights = 0;
  const free = new Set<number>();
  const late = new Set<number>();
  for (let i = 0; i < limit && room.phase === 'map' && room.world!.day < maxDay; i++) {
    if (room.day === 'free') free.add(room.world!.day);
    if (room.day === 'late') late.add(room.world!.day);
    let moved = false;
    for (const f of [...fightsOf(room)]) {
      const u = currentUnit(f.state);
      const seat = u ? f.seats[u.side] : null;
      if (seat !== null && seat !== undefined) {
        room.message(peers[seat], { t: 'act', a: botAction(f.state, 'medium') });
        moved = true;
      }
    }
    for (const me of [0, 1]) {
      if (room.phase !== 'map') break;
      const view = room.viewOf(me);
      if (view.current !== me || view.over || fightsOf(room).some((f) => f.seats.includes(me))) continue;
      const n = fightsOf(room).length;
      const box = peers[me].box.length;
      room.message(peers[me], { t: 'adv', a: botStep(view, 'medium', mems[me]) });
      moved = true;
      if (fightsOf(room).length > n) fights++;
      // действие не прошло — конец хода
      if (peers[me].box.slice(box).some((m) => m.t === 'mnope')) room.message(peers[me], { t: 'adv', a: { t: 'end' } });
    }
    adv(moved ? 50 : 500);
    room.tick();
    // в каждом сообщении — мир целиком: старые не копим
    for (const p of peers) if (p.box.length > 40) p.box.splice(0, p.box.length - 8);
  }
  return { fights, freeDays: free.size, lateDays: late.size };
}

/** Свободная клетка суши рядом. */
function freeNear(w: ReturnType<typeof generateMap>, c: number): number {
  return [c - 1, c + 1, c - w.w, c + w.w].find((x) => x >= 0 && !w.block[x] && w.terrain[x] !== 6 && w.entries[x] === undefined && !heroAt(w, x) && !w.towns.some((t) => t.cell === x))!;
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
    const r = playOut(room, [a, b], adv, 20000);
    expect(room.phase).toBe('over');
    expect(r.fights).toBeGreaterThan(0);
    expect(r.freeDays).toBe(0);
    expect(a.last('mover').winner).toBeGreaterThanOrEqual(0);
  });

  it('одновременные ходы: общий день, оба ходят разом; закончили оба — новый день', () => {
    const { room, a, b } = setup(true, { ...GEN, size: 'm' });
    room.message(a, { t: 'start' });
    expect(enemyGap(room.world!)).toBeGreaterThan(FREE_GAP);
    expect(room.day).toBe('free');
    const sa = a.last('mstart');
    expect(sa.clock.free).toBe(true);
    expect(sa.clock.running).toEqual([0, 1]);
    expect(sa.world.current).toBe(0);
    expect(b.last('mstart').world.current).toBe(1);
    const day = room.world!.day;
    // b ходит, не дожидаясь a
    const box = b.box.length;
    room.message(b, { t: 'adv', a: botStep(room.viewOf(1), 'medium', newMem()) });
    expect(b.box.slice(box).some((m) => m.t === 'mnope')).toBe(false);
    room.message(b, { t: 'adv', a: { t: 'end' } });
    expect(room.world!.day).toBe(day);
    expect(b.last('mstep').clock.done[1]).toBe(true);
    expect(b.last('mstep').world.current).toBe(0);
    room.message(b, { t: 'adv', a: { t: 'end' } });
    expect(b.last('mnope').why).toMatch(/закончил/);
    room.message(a, { t: 'adv', a: { t: 'end' } });
    expect(room.world!.day).toBe(day + 1);
    expect(room.day).toBe('free');
    expect(a.last('mstep').clock.done).toEqual([false, false]);
  });

  it('одновременные ходы: армии сблизились — до конца дня по очереди, сблизивший первым', () => {
    const { room, a, b } = setup(true, { ...GEN, size: 'm' });
    room.message(a, { t: 'start' });
    const w = room.world!;
    // герой b у самого города a (как будто дошёл): шаг — и сближение
    const town = w.towns.find((t) => t.owner === 0)!;
    const hb = w.heroes.find((h) => h.owner === 1)!;
    hb.cell = freeNear(w, freeNear(w, freeNear(w, town.cell + 3 * w.w)));
    room.message(b, { t: 'adv', a: { t: 'move', hero: hb.id, to: freeNear(w, hb.cell) } });
    expect(enemyGap(w)).toBeLessThanOrEqual(CONTACT);
    expect(room.day).toBe('late');
    expect(b.last('mnote').text).toMatch(/по очереди/);
    expect(w.current).toBe(1);
    room.message(a, { t: 'adv', a: { t: 'end' } });
    expect(a.last('mnope').why).toMatch(/не твой/);
    room.message(b, { t: 'adv', a: { t: 'end' } });
    expect(w.current).toBe(0);
    expect(room.viewOf(0).current).toBe(0);
    const day = w.day;
    room.message(a, { t: 'adv', a: { t: 'end' } });
    expect(w.day).toBe(day + 1);
    // рядом — новый день сразу по очереди
    expect(room.day).toBe('seq');
  });

  it('одновременные ходы: малая карта — партия людей доходит до конца', () => {
    const { room, a, b, adv } = setup(true);
    room.message(a, { t: 'start' });
    expect(room.day).toBe('free');
    const r = playOut(room, [a, b], adv, 20000);
    expect(room.phase).toBe('over');
    expect(r.freeDays).toBeGreaterThan(0);
  });

  it('одновременные ходы: средняя карта — общие дни, бои с нейтралами разом у обоих, сближения', () => {
    const { room, a, b, adv } = setup(true, { ...GEN, size: 'm' });
    room.message(a, { t: 'start' });
    let both = 0;
    const orig = room.tick.bind(room);
    room.tick = () => {
      if (fightsOf(room).length > 1) both++;
      orig();
    };
    const r = playOut(room, [a, b], adv, 20000, 40);
    expect(room.world!.day).toBeGreaterThanOrEqual(40);
    expect(r.freeDays).toBeGreaterThan(10);
    expect(r.fights).toBeGreaterThan(5);
    expect(both).toBeGreaterThan(0);
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
