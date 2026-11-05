import { describe, expect, it } from 'vitest';
import { botStep, newMem } from '../../src/geroi/bot/advbot';
import { botAction } from '../../src/geroi/bot/bot';
import { type MapServerMsg, cleanAdvAction, eventsView, worldView } from '../../src/geroi/net/mapproto';
import { diffJson, patchJson } from '../../src/geroi/net/record';
import { CONTACT, FREE_GAP, MAIL_TURN_MS, MAP_BANK_MS, MAP_GONE_MS, MapRoom, type MapPeer, enemyGap } from '../../src/geroi/net/maproom';
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
    // 40 дней или победа раньше (партия ботов на этом сиде может и кончиться)
    expect(room.phase === 'over' || room.world!.day >= 40).toBe(true);
    expect(r.freeDays).toBeGreaterThan(10);
    expect(r.fights).toBeGreaterThan(5);
    expect(both).toBeGreaterThan(0);
    // запись 40 дней средней карты — в разумных пределах (сжатая — в разы меньше)
    const size = JSON.stringify(room.rec).length; // ≈ 4 МБ на 40 дней
    expect(size).toBeLessThan(40_000_000);
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

  it('драфт: баны и выбор по очереди, фракции без повторов, недоступное отбрасывается, потом карта', () => {
    const { room, a, b, adv } = setup();
    room.message(a, { t: 'mdraftopt', on: true });
    expect(a.last('mlobby').draft).toBe(true);
    room.message(a, { t: 'start' });
    expect(room.phase).toBe('draft');
    const peers = [a, b];
    const steps = a.last('mdraft').d.steps;
    // дуэль: 2 бана героя, 1 бан фракции (вторым), 2 выбора
    expect(steps.map((s) => s.kind)).toEqual(['hero', 'hero', 'faction', 'pick', 'pick']);
    expect(steps[2].seat).toBe(steps[1].seat);
    expect(new Set(steps.slice(3).map((s) => s.seat)).size).toBe(2);
    const first = peers[steps[0].seat];
    const second = peers[steps[1].seat];
    // не в свой черёд — нельзя
    room.message(second, { t: 'mdraft', hero: { cls: factionClasses('zatulye')[0].id, n: 1 } });
    expect(second.last('mnope').why).toMatch(/другой/);
    const banned = { cls: factionClasses('zatulye')[0].id, n: 1 };
    room.message(first, { t: 'mdraft', hero: banned });
    expect(a.last('mdraft').d.heroes).toEqual([banned]);
    room.message(second, { t: 'mdraft', hero: banned });
    expect(second.last('mnope').why).toMatch(/забанить/);
    room.message(second, { t: 'mdraft', hero: { cls: factionClasses('kuznya')[0].id, n: 2 } });
    room.message(second, { t: 'mdraft', faction: 'akademiya' });
    expect(a.last('mdraft').d.factions).toEqual(['akademiya']);
    // выбор: забаненная фракция и забаненный герой — нельзя
    room.message(first, { t: 'mdraft', faction: 'akademiya', hero: { cls: factionClasses('akademiya')[0].id, n: 1 } });
    expect(first.last('mnope').why).toMatch(/недоступен/);
    room.message(first, { t: 'mdraft', faction: 'zatulye', hero: banned });
    expect(first.last('mnope').why).toMatch(/недоступен/);
    const pick1 = { cls: factionClasses('zatulye')[0].id, n: 2 };
    room.message(first, { t: 'mdraft', faction: 'zatulye', hero: pick1 });
    // второй не может взять ту же фракцию; не успел — выбирают за него
    room.message(second, { t: 'mdraft', faction: 'zatulye', hero: { cls: factionClasses('zatulye')[0].id, n: 3 } });
    expect(second.last('mnope').why).toMatch(/недоступен/);
    adv(29_000);
    room.tick();
    expect(room.phase).toBe('draft');
    adv(2_000);
    room.tick();
    expect(room.phase).toBe('map');
    const w = room.world!;
    const me = steps[0].seat;
    const other = steps[1].seat;
    expect(w.players[me].faction).toBe('zatulye');
    expect(w.heroes.find((h) => h.owner === me)!.pick).toEqual(pick1);
    expect(['zatonye', 'kuznya']).toContain(w.players[other].faction);
    expect(a.last('mstart').world.players.length).toBe(2);
  });

  it('драфт с ботами: бот выбирает сам; четыре места — фракции без банов и без повторов', () => {
    let t = 1000;
    const room = new MapRoom({ ...GEN, template: 'four', size: 'm' }, () => t);
    const a = peer(1, 'a');
    room.add(a);
    for (let i = 1; i < 4; i++) room.message(a, { t: 'mbot', seat: i, bot: 'easy' });
    room.message(a, { t: 'mdraftopt', on: true });
    room.message(a, { t: 'start' });
    const steps = a.last('mdraft').d.steps;
    expect(steps.filter((s) => s.kind === 'faction')).toEqual([]);
    for (let i = 0; i < 40 && room.phase === 'draft'; i++) {
      const d = a.last('mdraft').d;
      if (d.steps[d.i].seat === 0) {
        const f = (['zatulye', 'zatonye', 'kuznya', 'akademiya'] as const).find((x) => !d.steps.slice(0, d.i).some((s) => s.kind === 'pick' && a.last('mdraft').seats[s.seat].faction === x))!;
        const cls = factionClasses(f)[0].id;
        const n = [1, 2, 3, 4].find((k) => !d.heroes.some((x) => x.cls === cls && x.n === k))!;
        room.message(a, { t: 'mdraft', ...(d.steps[d.i].kind === 'pick' ? { faction: f } : {}), hero: { cls, n } });
      } else {
        t += 1_500;
        room.tick();
      }
    }
    expect(room.phase).toBe('map');
    expect(new Set(room.world!.players.map((p) => p.faction)).size).toBe(4);
  });

  it('союзы: хозяин ставит команды, все в одной — не начать; в мире команды и общий обзор', () => {
    let t = 1000;
    const room = new MapRoom({ ...GEN, template: 'four', size: 'm' }, () => t);
    const a = peer(1, 'a');
    room.add(a);
    for (let i = 1; i < 4; i++) room.message(a, { t: 'mbot', seat: i, bot: 'easy' });
    for (let i = 0; i < 4; i++) room.message(a, { t: 'mteam', seat: i, team: 1 });
    room.message(a, { t: 'start' });
    expect(room.phase).toBe('lobby');
    room.message(a, { t: 'mteam', seat: 1, team: 2 });
    room.message(a, { t: 'mteam', seat: 3, team: 2 });
    room.message(a, { t: 'mteam', seat: 9, team: 2 });
    room.message(a, { t: 'mteam', seat: 2, team: 7 });
    expect(a.last('mlobby').seats.map((s) => s.team)).toEqual([1, 2, 1, 2]);
    room.message(a, { t: 'start' });
    expect(room.phase).toBe('map');
    const w = room.world!;
    expect(w.players.map((p) => p.team)).toEqual([1, 2, 1, 2]);
    const ex = (i: number) => w.players[i].explored;
    expect(ex(0).every((v, c) => v === ex(2)[c])).toBe(true);
    expect(ex(0).every((v, c) => v === ex(1)[c])).toBe(false);
    // свой вид: город союзника виден
    const v = room.viewOf(0);
    const allyTown = w.towns.find((x) => x.owner === 2)!;
    expect(v.players[0].explored[allyTown.cell]).toBe(1);
    expect(enemyGap(w)).toBeGreaterThan(0);
  });

  it('запись: мир на старте + заплатки = мир в конце; зритель — с задержкой в день; запись — только после партии', () => {
    const { room, a, b, adv } = setup(true);
    const s = peer(3, 's');
    room.message(a, { t: 'start' });
    room.add(s);
    expect(s.last('mstart').seat).toBeNull();
    room.message(a, { t: 'mrec' });
    expect(a.box.some((m) => m.t === 'mrecord')).toBe(false);
    // зрителю шаги приходят, только когда их день прошёл
    const seen: number[] = [];
    const sBox = s.box;
    const orig = s.send;
    s.send = (m) => {
      if (m.t === 'mspec') for (const st of m.steps) seen.push(st.day);
      if (m.t === 'mspec') expect(m.steps.every((st) => st.day < room.world!.day || room.phase === 'over')).toBe(true);
      orig(m);
      if (sBox.length > 20) sBox.splice(0, sBox.length - 4);
    };
    playOut(room, [a, b], adv, 20000);
    expect(room.phase).toBe('over');
    expect(s.box.some((m) => m.t === 'mstep')).toBe(false);
    const rec = room.rec!;
    expect(seen.length).toBe(rec.steps.length);
    let w = JSON.parse(JSON.stringify(rec.world));
    for (const st of rec.steps) w = patchJson(w, st.d);
    expect(w).toEqual(JSON.parse(JSON.stringify(room.viewOf(null))));
    room.message(a, { t: 'mrec' });
    const got = a.last('mrecord').rec;
    expect(got.steps.length).toBe(rec.steps.length);
    expect(JSON.stringify(got).length).toBeLessThan(20_000_000);
  });

  it('заплатки: поля, удаление, массивы длиннее и короче', () => {
    const x = { a: 1, b: [1, 2, 3], c: { d: 'x', e: [{ f: 1 }] }, g: null as null | number };
    const y = { a: 2, b: [1, 5], c: { e: [{ f: 1 }, { f: 2 }] }, g: 3, h: [0] };
    const ops = diffJson(x, y);
    expect(patchJson(JSON.parse(JSON.stringify(x)), JSON.parse(JSON.stringify(ops)))).toEqual(y);
    expect(diffJson(y, y)).toEqual([]);
  });

  it('рейтинг: только дуэль вошедших людей; сдавшийся проигрывает, счёт приходит всем', () => {
    const calls: [number, number][] = [];
    const room = new MapRoom(GEN, () => 1000, {
      onResult: (w, l) => {
        calls.push([w, l]);
        return [{ r: 1520, delta: 20 }, { r: 1480, delta: -20 }];
      },
    });
    const a = { ...peer(1, 'a'), user: 11 };
    const b = { ...peer(2, 'b'), user: null as number | null };
    room.add(a);
    room.add(b);
    room.message(a, { t: 'mranked', on: true });
    expect(a.last('mlobby').ranked).toBe(true);
    // гость не вошёл — не начать
    room.message(a, { t: 'start' });
    expect(room.phase).toBe('lobby');
    expect(room.rankErr()).toMatch(/войти/);
    room.remove(b);
    const b2 = { ...peer(3, 'b2'), user: 11 };
    room.add(b2);
    expect(room.rankErr()).toMatch(/Сам с собой/);
    room.remove(b2);
    const b3 = { ...peer(4, 'b3'), user: 22 };
    room.add(b3);
    expect(room.rankErr()).toBeNull();
    room.message(a, { t: 'start' });
    expect(room.phase).toBe('map');
    room.message(a, { t: 'resign' });
    expect(room.phase).toBe('over');
    expect(calls).toEqual([[22, 11]]);
    expect(a.last('mover').rating).toEqual([{ r: 1480, delta: -20 }, { r: 1520, delta: 20 }]);
    expect(b3.last('mover').winner).toBe(1);
  });

  it('рейтинг: на четверых не включается; без галочки счёт не идёт', () => {
    const calls: number[] = [];
    const room = new MapRoom({ ...GEN, template: 'four', size: 'm' }, () => 1000, { onResult: () => (calls.push(1), [{ r: 0, delta: 0 }, { r: 0, delta: 0 }]) });
    const a = { ...peer(1, 'a'), user: 1 };
    room.add(a);
    room.message(a, { t: 'mranked', on: true });
    expect(room.ranked).toBe(false);
    // дуэль без галочки: сдача без счёта
    const { room: duel, a: d } = setup();
    duel.message(d, { t: 'start' });
    duel.message(d, { t: 'resign' });
    expect(d.last('mover').rating).toBeUndefined();
    expect(calls).toEqual([]);
  });

  it('по переписке: все вошли; ушедшего бот не заменяет, сутки кончились — ход кончается', () => {
    let t = 1000;
    const room = new MapRoom(GEN, () => t);
    const a = { ...peer(1, 'a'), user: 11 as number | null };
    const b = { ...peer(2, 'b'), user: null as number | null };
    room.add(a);
    room.add(b);
    room.message(a, { t: 'msimul', on: false });
    room.message(a, { t: 'mmail', on: true });
    room.message(a, { t: 'start' });
    expect(room.phase).toBe('lobby');
    expect(room.mailErr()).toMatch(/войти/);
    room.remove(b);
    const b2 = { ...peer(3, 'b2'), user: 22 as number | null };
    room.add(b2);
    room.message(a, { t: 'start' });
    expect(room.phase).toBe('map');
    expect(a.last('mstart').mail).toBe(true);
    // ходит a; он ушёл — через минуту бот за него не ходит
    expect(room.world!.current).toBe(0);
    room.remove(a);
    t += MAP_GONE_MS + 1000;
    room.tick();
    expect(room.world!.current).toBe(0);
    expect(room.summary(11)).toMatchObject({ yours: true, over: false });
    expect(room.summary(22)).toMatchObject({ yours: false });
    // сутки прошли — ход кончился
    t += MAIL_TURN_MS;
    room.tick();
    expect(room.world!.current).toBe(1);
  });

  it('по переписке: комната сохраняется и поднимается; вернуться можно с другого устройства по аккаунту', () => {
    let t = 1000;
    const room = new MapRoom(GEN, () => t);
    const a = { ...peer(1, 'a'), user: 11 as number | null };
    const b = { ...peer(2, 'b'), user: 22 as number | null };
    room.add(a);
    room.add(b);
    room.message(a, { t: 'mmail', on: true });
    room.message(a, { t: 'start' });
    const adv = (ms: number) => (t += ms);
    playOut(room, [a, b], adv, 40);
    const saved = JSON.parse(JSON.stringify(room.save()));
    const day = room.world!.day;
    const r2 = MapRoom.restore(saved, () => t);
    expect(r2.world).toEqual(room.world);
    expect(r2.phase).toBe('map');
    // новое устройство: другой ключ, тот же аккаунт
    const a2 = { ...peer(5, 'a-phone'), user: 11 as number | null };
    const b2 = { ...peer(6, 'b-phone'), user: 22 as number | null };
    r2.add(a2);
    r2.add(b2);
    expect(a2.last('mstart').seat).toBe(0);
    expect(b2.last('mstart').seat).toBe(1);
    // чужой аккаунт — зритель
    const c = { ...peer(7, 'c'), user: 33 as number | null };
    r2.add(c);
    expect(c.last('mstart').seat).toBeNull();
    playOut(r2, [a2, b2], adv, 20000);
    expect(r2.phase).toBe('over');
    expect(r2.world!.day).toBeGreaterThan(day);
    // запись после подъёма сходится с концом
    let w = JSON.parse(JSON.stringify(r2.rec!.world));
    for (const st of r2.rec!.steps) w = patchJson(w, st.d);
    expect(w).toEqual(JSON.parse(JSON.stringify(r2.viewOf(null))));
  });

  it('боты по своему виду (чужой гарнизон — примерно) доигрывают среднюю карту', () => {
    const { room, a, b, adv } = setup(false, { ...GEN, size: 'm' });
    room.message(a, { t: 'start' });
    playOut(room, [a, b], adv, 60000, 150);
    expect(room.phase, `день ${room.world!.day}`).toBe('over');
  }, 180_000);
});
