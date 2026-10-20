/* Виденные задания (данетки, детективы): стол подбирает невиденное, «уже знаю» меняет задание, переподключение партию не сбивает;
 * база хранит виденное вошедшего (/api/seen). */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { freshest } from '../src/core/fresh';
import * as dn from '../src/games/danetki/engine';
import { DANETKI } from '../src/games/danetki/data';
import * as dk from '../src/games/detektiv/engine';
import { Authority } from '../src/core/authority';
import { def as dnDef } from '../src/games/danetki/def';
import { Accounts } from '../server/accounts/accounts';
import { MemoryMailer } from '../server/accounts/mail';
import { MemoryAccountStore } from '../server/accounts/store';
import { Player } from '../server/player';

const rng = () => new SeededRng(3);

describe('подбор свежего', () => {
  it('сперва невиденное, потом — виденное давнее всех', () => {
    const ids = [1, 2, 3, 4];
    expect(freshest(ids, (x) => x, { 1: 5, 2: 5, 3: 5 }, rng())).toBe(4);
    expect(freshest(ids, (x) => x, { 1: 50, 2: 7, 3: 9, 4: 70 }, rng())).toBe(2);
  });
});

describe('данетки', () => {
  const s0 = () => dn.setup([0, 1, 2], { mode: 'rules', host: 'bot', count: 5 } as never, rng(), [0, 1]);
  it('виденную кем-то за столом — сразу меняем; второй раз (переподключение) — нет', () => {
    const s = s0();
    const first = s.id;
    const r = dn.apply(s, 1, { type: 'seen', ids: [[first, 100]] }, rng())!;
    expect(r.events).toEqual([{ type: 'swap', seat: null, id: r.state.id }]);
    expect(r.state.id).not.toBe(first);
    expect(r.state.log).toEqual([]);
    const again = dn.apply(r.state, 1, { type: 'seen', ids: [[r.state.id, 200]] }, rng())!;
    expect(again.state.id).toBe(r.state.id);
  });
  it('следующие данетки — не из виденного, пока есть невиденные', () => {
    let s = s0();
    const seen = DANETKI.filter((d) => d.id !== s.id).slice(0, DANETKI.length - 10).map((d) => [d.id, 1] as [number, number]);
    s = dn.apply(s, 0, { type: 'seen', ids: seen }, rng())!.state;
    const bad = new Set(seen.map((x) => x[0]));
    // пройти ещё четыре данетки: сдаёмся и дальше (в правилах — до конца кругов)
    for (let k = 0; k < 4; k++) {
      expect(bad.has(s.id)).toBe(false);
      s = { ...s, phase: 'reveal', ready: [] };
      for (const x of [0, 1]) s = dn.apply(s, x, { type: 'next' }, rng())!.state;
    }
  });
  it('«уже знаю» — любой за столом и вне очереди; ведущий-бот и круги — заново', () => {
    const a = new Authority(dnDef, [0, 1, 2].map((seat) => ({ seat, kind: seat === 2 ? 'bot' : 'human', name: 'x', level: 0 })) as never, { mode: 'rules', host: 'bot', count: 3 });
    const st = a.state as dn.State;
    const id = st.id;
    const notTurn = st.turn === 0 ? 1 : 0;
    const r = a.act(notTurn, { type: 'swap' });
    expect(r?.events[0]).toMatchObject({ type: 'swap', seat: notTurn });
    expect((a.state as dn.State).id).not.toBe(id);
    expect((a.state as dn.State).used).toContain(id);
  });
});

describe('детективы', () => {
  it('прочитанные дела впереди меняются на нечитанные той же трудности', () => {
    const s = dk.newState(dk.cfgOf({ count: 5, lvl: -1 }), [0, 1], rng(), 0);
    const seen = [s.list[0], s.list[3]];
    const r = dk.apply(s, 1, { t: 'seen', ids: seen.map((id) => [id, 9]) }, rng(), 500)!;
    expect(r.events).toEqual([{ type: 'swap', seat: null, i: 0, n: 2 }]);
    for (const j of [0, 3]) {
      expect(seen).not.toContain(r.state.list[j]);
      expect(dk.keyOf(r.state.list[j]).lv).toBe(dk.keyOf(s.list[j]).lv);
    }
    expect(new Set(r.state.list).size).toBe(5);
    expect(r.state.boards[0].t0).toBe(500);
  });
  it('«уже читал» — пока разгадка закрыта; закрытое дело не меняется', () => {
    let s = dk.newState(dk.cfgOf({ count: 3, lvl: 0, mode: 'team' }), [0, 1], rng(), 0);
    s = dk.apply(s, 0, { t: 'hint' }, rng(), 10)!.state;
    const id = s.list[0];
    const r = dk.apply(s, 1, { t: 'swap' }, rng(), 20)!;
    expect(r.state.list[0]).not.toBe(id);
    expect(r.state.boards[dk.SHARED]).toMatchObject({ hints: 0, t0: 20 });
    const done = dk.apply(r.state, 0, { t: 'skip' }, rng(), 30)!.state;
    expect(dk.apply(done, 1, { t: 'swap' }, rng(), 40)).toBeNull();
    // повторный список от того же места дела не меняет
    const told = dk.apply(r.state, 1, { t: 'seen', ids: [] }, rng(), 50)!.state;
    const again = dk.apply(told, 1, { t: 'seen', ids: [[told.list[1], 1]] }, rng(), 60)!;
    expect(again.state.list).toEqual(r.state.list);
  });
});

describe('виденное в базе', () => {
  it('только вошедшему, копится, не мешает списку сохранений', async () => {
    let ip = 0;
    const ctx = (sid?: string) => ({ sid, ip: '10.9.0.' + ++ip, ua: 't', site: 'https://lavochka-games.ru', now: 1_800_000_000_000 + ip * 1000 });
    const acc = new Accounts(new MemoryAccountStore(), new MemoryMailer());
    const pl = new Player(acc, (g) => g === 'danetki');
    const a = (await acc.register({ email: 'a@x.ru', password: 'пароль-игрока', consent: true }, ctx())).sid as string;
    const q = new URLSearchParams({ game: 'danetki' });
    expect((await pl.addSeen({ game: 'danetki', ids: [5] }, ctx())).code).toBe(401);
    expect((await pl.addSeen({ game: 'nosuch', ids: [5] }, ctx(a))).code).toBe(400);
    expect((await pl.addSeen({ game: 'danetki', ids: [5, 7] }, ctx(a))).body.ok).toBe(true);
    expect((await pl.addSeen({ game: 'danetki', ids: [9] }, ctx(a))).body.ok).toBe(true);
    expect(Object.keys(((await pl.seen(q, ctx(a))).body as { seen: object }).seen).sort()).toEqual(['5', '7', '9']);
    expect((await pl.saves(new URLSearchParams(), ctx(a))).body.saves).toEqual([]);
  });
});
