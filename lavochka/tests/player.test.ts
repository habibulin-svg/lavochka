// Лайки и история партий: только вошедшим, счётчики сходятся, партия записывается разумно.
import { describe, expect, it } from 'vitest';
import { Accounts } from '../server/accounts/accounts';
import { MemoryMailer } from '../server/accounts/mail';
import { MemoryAccountStore } from '../server/accounts/store';
import { Player } from '../server/player';
import { playOf } from '../src/core/history';
import type { Finished } from '../src/core/table';

let ipN = 0;
const ctx = (sid?: string) => ({ sid, ip: '10.3.0.' + ++ipN, ua: 'test', site: 'https://lavochka-games.ru' });

async function setup() {
  const acc = new Accounts(new MemoryAccountStore(), new MemoryMailer());
  const pl = new Player(acc, (g) => ['durak', 'nardy'].includes(g));
  const reg = async (email: string) => (await acc.register({ email, password: 'пароль-игрока', consent: true }, ctx())).sid as string;
  return { acc, pl, a: await reg('a@x.ru'), b: await reg('b@x.ru') };
}

describe('лайки', () => {
  it('гостю нельзя, неизвестной игре нельзя; повторный лайк не удваивает', async () => {
    const { pl, a, b } = await setup();
    expect((await pl.like({ game: 'durak' }, ctx())).code).toBe(401);
    expect((await pl.like({ game: 'nosuch' }, ctx(a))).code).toBe(400);
    expect((await pl.like({ game: 'durak', on: true }, ctx(a))).body).toMatchObject({ on: true, count: 1 });
    expect((await pl.like({ game: 'durak', on: true }, ctx(a))).body).toMatchObject({ count: 1 });
    expect((await pl.like({ game: 'durak', on: true }, ctx(b))).body).toMatchObject({ count: 2 });
    expect((await pl.like({ game: 'durak', on: false }, ctx(a))).body).toMatchObject({ on: false, count: 1 });
    expect((await pl.mine(ctx(b))).body.mine).toEqual(['durak']);
    expect((await pl.mine(ctx())).body.mine).toEqual([]);
    await pl.refresh();
    expect(pl.likeCounts()).toEqual({ durak: 1 });
  });
});

describe('история партий', () => {
  it('пишется только вошедшему, поля обрезаются, новые первыми', async () => {
    const { pl, a } = await setup();
    expect((await pl.played({ game: 'durak', result: 'win' }, ctx())).body.ok).toBe(false);
    await pl.played({ game: 'durak', result: 'win', players: 2, bots: 1, seconds: 300 }, { ...ctx(a), now: 1000 });
    await pl.played({ game: 'nardy', result: 'взлом', players: 99, score: '<b>7</b>', preset: 'long' }, { ...ctx(a), now: 2000 });
    const h = (await pl.history(ctx(a))).body.plays as any[];
    expect(h.map((p) => p.game)).toEqual(['nardy', 'durak']);
    expect(h[0]).toMatchObject({ result: 'done', players: 20, score: 'b7/b', preset: 'long' });
    expect(h[1]).toMatchObject({ result: 'win', bots: 1, seconds: 300 });
    expect((await pl.history(ctx())).code).toBe(401);
  });

  it('итог партии для игрока: победа, поражение, ничья, место по очкам, вариант правил', () => {
    const seats = [
      { seat: 0, kind: 'human', name: 'Я', level: 0, filled: true, online: true },
      { seat: 1, kind: 'bot', name: 'Бот', level: 1, filled: true, online: true },
      { seat: 2, kind: 'bot', name: 'Бот 2', level: 1, filled: true, online: true },
    ] as Finished['seats'];
    const base: Finished = {
      game: 'durak',
      options: { mode: 'perevod', deck: 36 },
      presets: [
        { id: 'podkidnoy', options: { mode: 'podkid' } },
        { id: 'perevodnoy', options: { mode: 'perevod' } },
      ],
      result: { winners: [0], text: '' },
      mySeats: [0],
      seats,
      network: false,
      seconds: 60,
    };
    expect(playOf(base)).toMatchObject({ result: 'win', preset: 'perevodnoy', players: 3, bots: 2 });
    expect(playOf({ ...base, result: { winners: [1], text: '' } }).result).toBe('lose');
    expect(playOf({ ...base, result: { winners: [], text: '' } }).result).toBe('draw');
    expect(playOf({ ...base, result: { winners: [2], text: '', scores: { 0: 40, 1: 55, 2: 70 } } })).toMatchObject({ result: 'lose', place: 3, score: '40' });
    expect(playOf({ ...base, mySeats: [0, 1, 2] }).result).toBe('done');
  });
});

describe('сохранения в базе', () => {
  it('новее — записывается, старее — нет; null — партии больше нет; список; чужому и гостю нельзя', async () => {
    const { pl, a, b } = await setup();
    const now = 1_800_000_000_000;
    const c = (sid?: string) => ({ ...ctx(sid), now });
    const q = (game?: string) => new URLSearchParams(game ? { game } : {});
    expect((await pl.putSave({ game: 'durak', at: now - 1000, snap: { seq: 5 } }, c())).code).toBe(401);
    expect((await pl.putSave({ game: 'durak', at: now - 1000, snap: { seq: 5 } }, c(a))).body.ok).toBe(true);
    expect((await pl.putSave({ game: 'durak', at: now - 2000, snap: { seq: 3 } }, c(a))).body.ok).toBe(false);
    expect((await pl.saves(q('durak'), c(a))).body).toEqual({ at: now - 1000, snap: { seq: 5 } });
    expect((await pl.saves(q('durak'), c(b))).body).toEqual({ at: 0, snap: null });
    // из будущего и неизвестная игра — отказ
    expect((await pl.putSave({ game: 'durak', at: now + 3600_000, snap: {} }, c(a))).code).toBe(400);
    expect((await pl.putSave({ game: 'nosuch', at: now, snap: {} }, c(a))).code).toBe(400);
    // слишком большая партия
    expect((await pl.putSave({ game: 'nardy', at: now, snap: { x: 'я'.repeat(500_000) } }, c(a))).code).toBe(413);
    await pl.putSave({ game: 'durak', at: now, snap: null }, c(a));
    expect((await pl.saves(q(), c(a))).body.saves).toEqual([{ game: 'durak', at: now, has: false }]);
  });
});

describe('тренажёр покера в профиле (/api/poker)', () => {
  it('гостю нельзя; новее — записывается, старее — нет; у каждого своё; в список сохранений не попадает', async () => {
    const { pl, a, b } = await setup();
    const now = 1_800_000_000_000;
    const c = (sid?: string) => ({ ...ctx(sid), now });
    const data = { hud: { v: 1, me: { hands: 3 } }, bank: { base: 1000 } };
    expect((await pl.putPoker({ at: now - 1000, data }, c())).code).toBe(401);
    expect((await pl.poker(c())).code).toBe(401);
    expect((await pl.putPoker({ at: now - 1000, data }, c(a))).body.ok).toBe(true);
    expect((await pl.putPoker({ at: now - 2000, data: { hud: {} } }, c(a))).body.ok).toBe(false);
    expect((await pl.poker(c(a))).body).toEqual({ at: now - 1000, data });
    expect((await pl.poker(c(b))).body).toEqual({ at: 0, data: null });
    expect((await pl.putPoker({ at: now, data: [] }, c(a))).code).toBe(400);
    expect((await pl.putPoker({ at: now + 3600_000, data }, c(a))).code).toBe(400);
    expect((await pl.saves(new URLSearchParams(), c(a))).body.saves).toEqual([]);
    // журнал кружка рядом — свой, не путается
    expect((await pl.kruzhok(c(a))).body).toEqual({ at: 0, data: null });
  });
});
