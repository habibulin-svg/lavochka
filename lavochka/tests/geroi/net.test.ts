import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Ratings } from '../../server/geroi';
import { botAction } from '../../src/geroi/bot/bot';
import type { BattleState } from '../../src/geroi/sim/battle';
import { currentUnit, createBattle, sideValue } from '../../src/geroi/sim/battle';
import { playOut } from '../../src/geroi/bot/bot';
import { CREATURES } from '../../src/geroi/sim/creatures';
import { ARMY_ROUNDS, armySpent, draftAdvance, draftPick, isHeroCard, newDraft } from '../../src/geroi/sim/draft';
import { classOf } from '../../src/geroi/sim/heroes';
import { type NetServerMsg, cleanAction } from '../../src/geroi/net/protocol';
import { START_RATING, afterGame } from '../../src/geroi/net/rating';
import { ARMY_MS, ArenaRoom, BANK_MS, GONE_MS, HERO_MS, MIN_MOVE_MS, type RoomPeer } from '../../src/geroi/net/room';

function peer(id: number, token: string, user: number | null = null): RoomPeer & { box: NetServerMsg[]; last<T extends NetServerMsg['t']>(t: T): Extract<NetServerMsg, { t: T }> } {
  const box: NetServerMsg[] = [];
  return {
    id, name: token, token, user, box,
    send: (m) => box.push(JSON.parse(JSON.stringify(m))),
    last<T extends NetServerMsg['t']>(t: T) {
      const m = [...box].reverse().find((x) => x.t === t);
      if (!m) throw new Error(`нет сообщения ${t}`);
      return m as Extract<NetServerMsg, { t: T }>;
    },
  };
}

function setup(ranked = false, hooks = {}) {
  let t = 1000;
  const a = peer(1, 'a', 11);
  const b = peer(2, 'b', 22);
  const room = new ArenaRoom(20000, 12345, ranked, hooks, () => t);
  room.add(a);
  room.add(b);
  return { room, a, b, adv: (ms: number) => (t += ms) };
}

/** Пройти драфт: оба выбирают первую карточку. */
function draftThrough(room: ArenaRoom, a: RoomPeer, b: RoomPeer) {
  for (let i = 0; i <= ARMY_ROUNDS; i++) {
    room.message(a, { t: 'pick', i: 0 });
    room.message(b, { t: 'pick', i: 0 });
  }
}

describe('geroi/draft', () => {
  it('детерминированно; герой из разных краёв; у всех 7 отрядов и ровно столько семок', () => {
    const run = (seed: number) => {
      const d = newDraft(seed, 20000);
      for (let i = 0; i <= ARMY_ROUNDS; i++) {
        for (const seat of [0, 1]) expect(draftPick(d, seat, i % 3)).toBe(true);
        draftAdvance(d);
      }
      return d;
    };
    expect(JSON.stringify(run(5))).toBe(JSON.stringify(run(5)));
    for (let seed = 1; seed < 60; seed++) {
      const first = newDraft(seed, 20000);
      for (const s of first.sides) {
        const fs = s.offer.map((c) => (isHeroCard(c) ? classOf(c.hero.cls).faction : ''));
        expect(new Set(fs).size).toBe(3);
      }
      const d = run(seed);
      expect(d.done).toBe(true);
      for (const s of d.sides) {
        expect(s.army).toHaveLength(ARMY_ROUNDS);
        expect(new Set(s.army.map((a) => a.cre)).size).toBe(ARMY_ROUNDS);
        const f = classOf(s.hero!.cls).faction;
        for (const a of s.army) expect(['neutral', f]).toContain(CREATURES[a.cre].faction);
        const spent = armySpent(s.army);
        expect(spent).toBeGreaterThan(20000 * 0.8);
        expect(spent).toBeLessThan(20000 * 1.2);
      }
    }
  });
  it('нельзя выбрать дважды и чужую карточку', () => {
    const d = newDraft(1, 20000);
    expect(draftPick(d, 0, 9)).toBe(false);
    expect(draftPick(d, 0, 1)).toBe(true);
    expect(draftPick(d, 0, 2)).toBe(false);
  });
  it('армии драфта честные: первое место не выигрывает заметно чаще', () => {
    let wins = 0;
    const N = 40;
    for (let seed = 1; seed <= N; seed++) {
      const d = newDraft(seed * 17, 20000);
      for (let i = 0; i <= ARMY_ROUNDS; i++) {
        draftPick(d, 0, seed % 3);
        draftPick(d, 1, (seed + 1) % 3);
        draftAdvance(d);
      }
      const s = createBattle({ seed, field: 'meadow', sides: [{ hero: d.sides[0].hero!, army: d.sides[0].army }, { hero: d.sides[1].hero!, army: d.sides[1].army }] });
      playOut(s, ['medium', 'medium']);
      if (s.winner === 0) wins++;
    }
    expect(wins / N).toBeGreaterThan(0.25);
    expect(wins / N).toBeLessThan(0.75);
  });
});

describe('geroi/room', () => {
  it('чужие карточки не уходят, выбор виден только после обоих', () => {
    const { room, a, b } = setup();
    room.message(a, { t: 'start' });
    const da = a.last('draft').d;
    const db = b.last('draft').d;
    expect(JSON.stringify(da)).not.toContain(JSON.stringify(db.offer));
    room.message(a, { t: 'pick', i: 1 });
    expect(b.last('draft').d.sides[0].hero).toBeNull();
    expect(b.last('draft').d.sides[0].thinking).toBe(false);
    room.message(b, { t: 'pick', i: 2 });
    expect(a.last('draft').d.sides[1].hero).not.toBeNull();
    expect(a.last('draft').d.round).toBe(1);
  });

  it('стартовать может только хозяин и только вдвоём', () => {
    let t = 0;
    const a = peer(1, 'a');
    const room = new ArenaRoom(20000, 1, false, {}, () => t++);
    room.add(a);
    room.message(a, { t: 'start' });
    expect(room.phase).toBe('lobby');
    const b = peer(2, 'b');
    room.add(b);
    room.message(b, { t: 'start' });
    expect(room.phase).toBe('lobby');
    room.message(a, { t: 'start' });
    expect(room.phase).toBe('draft');
  });

  it('не выбрал за время — берётся первая карточка, драфт доходит до боя', () => {
    const { room, a, adv } = setup();
    room.message(a, { t: 'start' });
    adv(HERO_MS + 1);
    room.tick();
    for (let i = 0; i < ARMY_ROUNDS; i++) {
      adv(ARMY_MS + 1);
      room.tick();
    }
    expect(room.phase).toBe('battle');
    expect(a.last('start').state.units.filter((u) => u.side === 0)).toHaveLength(ARMY_ROUNDS);
  });

  it('бой: ход не в свою очередь и мусор отвергаются, законный расходится обоим одинаково', () => {
    const { room, a, b } = setup();
    room.message(a, { t: 'start' });
    draftThrough(room, a, b);
    const s = room.state!;
    const seat = currentUnit(s)!.side;
    const [me, foe] = seat === 0 ? [a, b] : [b, a];
    const version = JSON.stringify(s);
    room.message(foe, { t: 'act', a: { t: 'defend' } });
    expect(foe.last('nope').why).toBeTruthy();
    room.message(me, { t: 'act', a: { t: 'attack', target: '__proto__', from: 1 } as never });
    room.message(me, { t: 'act', a: { t: 'cast', spell: 'constructor', cell: 1 } });
    expect(JSON.stringify(room.state)).toBe(version);
    room.message(me, { t: 'act', a: { t: 'defend' } });
    expect(a.last('step').state).toEqual(b.last('step').state);
    expect(a.last('step').state).toEqual(JSON.parse(JSON.stringify(room.state)));
  });

  it('время вышло — за игрока ходит бот, запас не уходит в минус', () => {
    const { room, a, b, adv } = setup();
    room.message(a, { t: 'start' });
    draftThrough(room, a, b);
    adv(BANK_MS + 60_000);
    const before = a.box.filter((m) => m.t === 'step').length;
    room.tick();
    expect(a.box.filter((m) => m.t === 'step').length).toBe(before + 1);
    const c = a.last('step').clock;
    expect(Math.min(...c.bank)).toBeGreaterThanOrEqual(0);
    // запас кончился: на следующий ход всё равно есть минимум
    const side = currentUnit(room.state!)!.side;
    if (c.bank[side] === 0) {
      adv(c.waitMs + MIN_MOVE_MS - 1000);
      const n = a.box.filter((m) => m.t === 'step').length;
      room.tick();
      expect(a.box.filter((m) => m.t === 'step').length).toBe(n);
    }
  });

  it('обрыв и возврат по ключу: то же место, снимок боя; не вернулся — поражение', () => {
    const { room, a, b, adv } = setup();
    room.message(a, { t: 'start' });
    draftThrough(room, a, b);
    room.remove(b);
    expect(a.last('peer').on).toBe(false);
    adv(1000);
    const b2 = peer(3, 'b', 22);
    room.add(b2);
    expect(b2.last('start').seat).toBe(1);
    expect(a.last('peer').on).toBe(true);
    room.remove(b2);
    adv(GONE_MS + 1);
    room.tick();
    expect(room.phase).toBe('over');
    expect(a.last('result').result).toMatchObject({ winner: 0, why: 'gone' });
  });

  it('зритель видит бой, но не ходит и не занимает места', () => {
    const { room, a, b } = setup();
    room.message(a, { t: 'start' });
    draftThrough(room, a, b);
    const w = peer(9, 'w');
    room.add(w);
    expect(w.last('start').seat).toBeNull();
    const version = JSON.stringify(room.state);
    room.message(w, { t: 'act', a: { t: 'defend' } });
    room.message(w, { t: 'resign' });
    expect(JSON.stringify(room.state)).toBe(version);
    expect(room.phase).toBe('battle');
  });

  it('бой ботами доходит до итога; рейтинг только у рейтинговой партии с двумя вошедшими', () => {
    for (const ranked of [false, true]) {
      const calls: number[] = [];
      const { room, a, b } = setup(ranked, {
        onResult: (w: number) => {
          calls.push(w);
          return [{ r: 1600, delta: 100 }, { r: 1400, delta: -100 }];
        },
      });
      if (!ranked) room.message(a, { t: 'start' });
      draftThrough(room, a, b);
      for (let i = 0; i < 20000 && room.phase === 'battle'; i++) {
        const s = room.state as BattleState;
        const side = currentUnit(s)!.side;
        room.message(side === 0 ? a : b, { t: 'act', a: botAction(s, 'medium') });
      }
      expect(room.phase).toBe('over');
      const r = a.last('result').result;
      expect(r.why).toBe('battle');
      expect(sideValue(room.state!, r.winner)).toBeGreaterThan(0);
      expect(calls.length).toBe(ranked ? 1 : 0);
      expect(!!r.rating).toBe(ranked);
    }
  });

  it('сдача: победа сопернику в бою и на драфте', () => {
    const one = setup();
    one.room.message(one.a, { t: 'start' });
    one.room.message(one.b, { t: 'resign' });
    expect(one.a.last('result').result).toMatchObject({ winner: 0, why: 'resign' });
    const two = setup();
    two.room.message(two.a, { t: 'start' });
    draftThrough(two.room, two.a, two.b);
    two.room.message(two.a, { t: 'resign' });
    expect(two.b.last('result').result).toMatchObject({ winner: 1, why: 'resign' });
    expect(two.room.state!.over).toBe(true);
  });

  it('cleanAction пропускает законные формы и режет остальное', () => {
    expect(cleanAction({ t: 'move', to: 5, x: 1 })).toEqual({ t: 'move', to: 5 });
    expect(cleanAction({ t: 'move', to: 999 })).toBeNull();
    expect(cleanAction({ t: 'move', to: 1.5 })).toBeNull();
    expect(cleanAction({ t: 'nonsense' })).toBeNull();
    expect(cleanAction(null)).toBeNull();
  });
});

describe('geroi/room: рейтинг и пропажа обоих', () => {
  it('пропали оба — без победителя и рейтинга', () => {
    let called = 0;
    const { room, a, b, adv } = setup(true, { onResult: () => (called++, undefined) });
    draftThrough(room, a, b);
    room.remove(a);
    room.remove(b);
    adv(GONE_MS + 1);
    room.tick();
    expect(room.phase).toBe('over');
    expect(called).toBe(0);
  });
  it('один аккаунт из двух вкладок рейтинг не набирает', () => {
    let t = 1000;
    let called = 0;
    const a = peer(1, 'a', 11);
    const b = peer(2, 'b', 11);
    const room = new ArenaRoom(20000, 7, true, { onResult: () => (called++, undefined) }, () => t);
    room.add(a);
    room.add(b);
    draftThrough(room, a, b);
    room.message(a, { t: 'resign' });
    t += 1;
    expect(room.phase).toBe('over');
    expect(called).toBe(0);
  });
});

describe('geroi/ratings: хранение', () => {
  it('победа двигает обоих, таблица по убыванию, файл переживает перезапуск', () => {
    const dir = mkdtempSync(join(tmpdir(), 'geroi-rating-'));
    try {
      const r = new Ratings(dir, () => {});
      r.apply(1, 2, ['Рыжий', 'Гость']);
      r.flush();
      const again = new Ratings(dir, () => {});
      expect(again.get(1).r).toBeGreaterThan(1500);
      expect(again.get(2).r).toBeLessThan(1500);
      expect(again.get(3).r).toBe(1500);
      expect(again.top(5).map((x) => x.name)).toEqual(['Рыжий', 'Гость']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('geroi/rating', () => {
  it('победитель растёт, проигравший падает; новичок двигается сильнее опытного', () => {
    const [w, l] = afterGame(START_RATING, START_RATING);
    expect(w.r).toBeGreaterThan(1500);
    expect(l.r).toBeLessThan(1500);
    expect(w.wins).toBe(1);
    expect(l.losses).toBe(1);
    expect(w.rd).toBeLessThan(350);
    const veteran = { ...START_RATING, rd: 50 };
    const [v] = afterGame(veteran, START_RATING);
    expect(v.r - 1500).toBeLessThan(w.r - 1500);
  });
});
