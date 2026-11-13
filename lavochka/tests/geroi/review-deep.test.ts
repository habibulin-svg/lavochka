/* Глубокое ревью «Героев»: скрытое в снимках боя и мира, ловушка и бот, часы комнат, сохранения. */
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { geroiMailOf, initGeroiMail, purgeMail, tickRooms } from '../../server/geroi';
import { MapRoom } from '../../src/geroi/net/maproom';
import { botAction } from '../../src/geroi/bot/bot';
import { worldView } from '../../src/geroi/net/mapproto';
import { type NetServerMsg, battleViewFor } from '../../src/geroi/net/protocol';
import { ARMY_ROUNDS } from '../../src/geroi/sim/draft';
import { ArenaRoom, type RoomPeer } from '../../src/geroi/net/room';
import { type BattleState, createBattle, currentUnit } from '../../src/geroi/sim/battle';
import { type GenOptions, generateMap } from '../../src/geroi/sim/adv/gen';
import { factionClasses } from '../../src/geroi/sim/heroes';
import { loadSaves, writeSave } from '../../src/geroi/save';

function bazarBattle(seed: number): BattleState {
  const side = (cls: string) => ({ hero: { cls, n: 1 }, army: [{ cre: 'zatulye-spearman', count: 10 }] });
  return createBattle({ seed, field: 'meadow', sides: [side(factionClasses('bazar')[0].id), side(factionClasses('zatulye')[0].id)] });
}

describe('geroi review: снимок боя', () => {
  it('без счётчика бросков; чужая ловушка видна только хозяину', () => {
    let s: BattleState | null = null;
    for (let seed = 1; seed < 50 && !s?.trap; seed++) s = bazarBattle(seed);
    expect(s!.trap).toBeTruthy();
    expect(s!.rng).not.toBe(0);
    const own = s!.trap!.owner;
    expect(battleViewFor(s!, own).trap).toEqual(s!.trap);
    expect(battleViewFor(s!, 1 - own).trap).toBeUndefined();
    expect(battleViewFor(s!, null).trap).toBeUndefined();
    for (const seat of [0, 1, null]) expect(battleViewFor(s!, seat).rng).toBe(0);
    // сам бой не тронут
    expect(s!.rng).not.toBe(0);
    expect(s!.trap).toBeTruthy();
  });

  it('Арена: старт и шаги не отдают rng и чужую ловушку', () => {
    const mk = (id: number, token: string, user: number): RoomPeer & { box: NetServerMsg[] } => {
      const box: NetServerMsg[] = [];
      return { id, name: token, token, user, full: true, box, send: (m) => box.push(JSON.parse(JSON.stringify(m))) };
    };
    let found = 0;
    for (let seed = 1; seed < 400 && found < 2; seed++) {
      const t = 1000;
      const room = new ArenaRoom(20000, seed, false, {}, () => t);
      const a = mk(1, 'a', 11);
      const b = mk(2, 'b', 22);
      const spec = mk(3, 'spec', 33);
      room.add(a);
      room.add(b);
      room.message(a, { t: 'start' });
      for (let i = 0; i <= ARMY_ROUNDS; i++) {
        room.message(a, { t: 'pick', i: 0 });
        room.message(b, { t: 'pick', i: 0 });
      }
      room.add(spec);
      const real = room.state!;
      if (!real.trap) continue;
      found++;
      room.message(currentUnit(real)!.side === 0 ? a : b, { t: 'act', a: { t: 'defend' } });
      let seen = 0;
      for (const [p, seat] of [[a, 0], [b, 1], [spec, null]] as const) {
        for (const m of p.box) {
          if (m.t !== 'start' && m.t !== 'step') continue;
          seen++;
          expect(m.state.rng).toBe(0);
          if (seat === real.trap.owner) expect(m.state.trap).toBeTruthy();
          else expect(m.state.trap).toBeUndefined();
        }
      }
      expect(seen).toBeGreaterThanOrEqual(5);
    }
    expect(found).toBeGreaterThan(0);
  });

  it('бот не знает чужую ловушку: ход тот же с ловушкой и без неё', () => {
    let checked = 0;
    for (let seed = 1; seed < 40; seed++) {
      const s = bazarBattle(seed);
      if (!s.trap) continue;
      const u = currentUnit(s)!;
      if (u.side === s.trap.owner) continue;
      const without = { ...s, trap: undefined };
      for (const level of ['medium', 'hard'] as const) expect(botAction(s, level)).toEqual(botAction(without, level));
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('geroi review: вид мира для места', () => {
  it('место не видит, где осколок', () => {
    const gen: GenOptions = { template: 'duel', size: 's', water: 'lakes', guard: 'normal', seed: 7 };
    const w = generateMap({ seed: 7, players: [{ name: 'a', faction: 'zatulye', hero: { cls: 'zatulye-sotnik', n: 1 } }, { name: 'b', faction: 'zatonye', hero: { cls: 'zatonye-bolotnik', n: 1 } }] }, gen);
    expect(w.shard).toBeGreaterThanOrEqual(0);
    for (const seat of [0, 1]) {
      const v = worldView(w, seat);
      expect(v.shard).toBe(-1);
      expect(v.shardHint).toEqual([0, 0]);
    }
    expect(w.shard).toBeGreaterThanOrEqual(0);
  });
});

describe('geroi review: часы комнат', () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

  it('сломанная комната с диска не рушит часы и замолкает после порога', () => {
    const dir = mkdtempSync(join(tmpdir(), 'geroi-tick-'));
    dirs.push(dir);
    mkdirSync(join(dir, 'geroi-mail'));
    const seat = (faction: string, cls: string, user: number) => ({ token: `t${user}`, name: `p${user}`, faction, hero: { cls, n: 1 }, bot: null, goneAt: 0, team: null, user });
    const bad = {
      v: 1, gen: { template: 'duel', size: 's', water: 'lakes', guard: 'normal', seed: 1 },
      seats: [seat('zatulye', 'zatulye-sotnik', 5), seat('zatonye', 'zatonye-bolotnik', 6)],
      phase: 'map', simul: false, draftOn: false, draft: null, world: { players: [], current: 0, over: false, day: 0 }, day: 'seq', mems: [], fights: [],
      bank: [1, 1], since: [0, 0], pend: [null, null], done: [], rec: null, specAt: 0, ranked: false, mail: true,
    };
    writeFileSync(join(dir, 'geroi-mail', 'BAD1.json'), JSON.stringify(bad));
    const logs: string[] = [];
    initGeroiMail(dir, undefined, (s) => logs.push(s));
    for (let i = 0; i < 20; i++) expect(() => tickRooms((s) => logs.push(s))).not.toThrow();
    expect(logs.filter((l) => l.includes('упала на часах'))).toHaveLength(8);
  });
});

describe('geroi review: хранение партий по переписке', () => {
  it('кончившаяся партия старше недели уходит из памяти и с диска', () => {
    const dir = mkdtempSync(join(tmpdir(), 'geroi-purge-'));
    try {
      mkdirSync(join(dir, 'geroi-mail'));
      const r = new MapRoom({ template: 'duel', size: 's', water: 'lakes', guard: 'normal', seed: 2 });
      const save = r.save();
      save.phase = 'over';
      save.mail = true;
      save.seats[0].user = 77;
      save.seats[0].token = 'x';
      const file = join(dir, 'geroi-mail', 'OLD1.json');
      writeFileSync(file, JSON.stringify(save));
      initGeroiMail(dir, undefined, () => {});
      expect(geroiMailOf(77).map((x) => x.code)).toContain('OLD1');
      purgeMail();
      expect(existsSync(file)).toBe(true);
      const old = new Date(Date.now() - 8 * 24 * 3600_000);
      utimesSync(file, old, old);
      purgeMail();
      expect(existsSync(file)).toBe(false);
      expect(geroiMailOf(77)).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('geroi review: сохранения', () => {
  it('испорченная ячейка — пустая, а не вылет', () => {
    const store = new Map<string, string>();
    (globalThis as unknown as { localStorage: Storage }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) } as Storage;
    store.set('geroi-saves', JSON.stringify([{ foo: 1 }, null, 'x', { at: 1, title: 't', who: ['human', 'human'], state: {} }]));
    const saves = loadSaves();
    expect(saves[0]).toBeNull();
    expect(saves[2]).toBeNull();
    expect(saves[3]?.title).toBe('t');
    expect(writeSave(1, { at: 2, title: 'ok', who: ['human', 'human'], adv: {} as never })).toBe(true);
    expect(loadSaves()[1]?.title).toBe('ok');
  });
});
